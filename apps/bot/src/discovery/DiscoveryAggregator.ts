/**
 * Discovery Aggregator
 * Main orchestrator for multi-source token discovery
 * Coordinates sources, deduplicates, scores, and emits discovery events
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { SourceManager } from './SourceManager';
import { ScoringEngine } from './ScoringEngine';
import type {
  IDiscoverySource
} from './interfaces/IDiscoverySource';
import type {
  DiscoveredToken,
  DiscoveryRecord,
  DiscoveryConfirmation,
  AggregatorConfig,
  DeduplicationResult,
  DiscoveryEvent,
  DiscoveryStats,
  SourceConfig,
} from './interfaces/DiscoveryTypes';

export class DiscoveryAggregator extends EventEmitter {
  private sourceManager: SourceManager;
  private scoringEngine: ScoringEngine;
  private config: AggregatorConfig;

  // In-memory cache for deduplication
  private seenTokens: Map<string, DiscoveryRecord> = new Map();
  
  // Statistics
  private stats = {
    totalDiscovered: 0,
    uniqueTokens: 0,
    duplicatesFiltered: 0,
    confirmations: 0,
  };

  constructor(config: Partial<AggregatorConfig> = {}) {
    super();

    this.config = {
      dedupWindowMs: config.dedupWindowMs || 24 * 60 * 60 * 1000, // 24 hours
      minConfirmations: config.minConfirmations || 2,
      confirmationWeightThreshold: config.confirmationWeightThreshold || 2.0,
    };

    this.sourceManager = new SourceManager();
    this.scoringEngine = new ScoringEngine();

    // Listen to source health events
    this.sourceManager.on('source_unhealthy', (event) => {
      logger.warn('DiscoveryAggregator', `Source became unhealthy: ${event.sourceId}`);
      this.emit('source_unhealthy', event);
    });

    this.sourceManager.on('source_recovered', (event) => {
      logger.info('DiscoveryAggregator', `Source recovered: ${event.sourceId}`);
      this.emit('source_recovered', event);
    });

    logger.info('DiscoveryAggregator', 'Initialized with config:', this.config);
  }

  /**
   * Register a discovery source
   */
  async registerSource(source: IDiscoverySource, config: SourceConfig): Promise<void> {
    // Register with source manager
    this.sourceManager.registerSource(source, config.rateLimitConfig);

    // Initialize scoring
    this.scoringEngine.initializeSource(source.id, config.baseWeight);

    // Start the source
    try {
      await source.start();
      logger.info('DiscoveryAggregator', `Started source: ${source.name}`);
    } catch (error: any) {
      logger.error('DiscoveryAggregator', `Failed to start source ${source.name}:`, error);
      this.sourceManager.recordFailure(source.id, error.message);
    }
  }

  /**
   * Unregister a source
   */
  async unregisterSource(sourceId: string): Promise<void> {
    const sources = this.sourceManager.getHealthySources();
    const source = sources.find(s => s.id === sourceId);

    if (source) {
      try {
        await source.stop();
        logger.info('DiscoveryAggregator', `Stopped source: ${source.name}`);
      } catch (error) {
        logger.error('DiscoveryAggregator', `Error stopping source ${source.name}:`, error);
      }
    }

    this.sourceManager.unregisterSource(sourceId);
  }

  /**
   * Process discovered token from a source
   */
  async processDiscovery(token: DiscoveredToken): Promise<void> {
    this.stats.totalDiscovered++;

    logger.debug('DiscoveryAggregator', `Processing discovery: ${token.symbol} from ${token.source}`);

    // Check for duplicates
    const dedupResult = this.checkDuplicates(token);

    if (dedupResult.isDuplicate && dedupResult.originalDiscovery) {
      this.stats.duplicatesFiltered++;

      if (dedupResult.isConfirmation) {
        // It's a confirmation from another source
        this.handleConfirmation(token, dedupResult.originalDiscovery);
      } else {
        logger.debug('DiscoveryAggregator', `Duplicate filtered: ${token.mint} (within dedup window)`);
      }
      return;
    }

    // New unique token
    this.stats.uniqueTokens++;

    // Create discovery record
    const record: DiscoveryRecord = {
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      firstSourceId: token.source,
      discoveredAt: token.timestamp,
      initialLiquidity: token.initialLiquidity,
      initialMarketCap: token.initialMarketCap,
      status: 'pending_analysis',
      wasRug: false,
      confirmations: [],
    };

    // Store in cache
    this.seenTokens.set(token.mint, record);

    // Record discovery in scoring engine
    this.scoringEngine.recordDiscovery(token.source);

    // Record success in source manager
    this.sourceManager.recordSuccess(token.source);

    // Calculate initial token score
    const tokenScore = this.scoringEngine.calculateTokenScore(record);

    // Emit discovery event
    this.emitDiscoveryEvent('discovered', token, record, tokenScore);

    logger.info('DiscoveryAggregator', `New token discovered: ${token.symbol} (${token.mint}) from ${token.source}`);
  }

  /**
   * Check for duplicates
   */
  private checkDuplicates(token: DiscoveredToken): DeduplicationResult {
    const existing = this.seenTokens.get(token.mint);

    if (!existing) {
      return { isDuplicate: false, isConfirmation: false };
    }

    // Check if within dedup window
    const age = Date.now() - existing.discoveredAt;
    if (age > this.config.dedupWindowMs) {
      // Outside window, treat as new
      return { isDuplicate: false, isConfirmation: false };
    }

    // It's a duplicate, but could be a confirmation from different source
    const isConfirmation = token.source !== existing.firstSourceId &&
      !existing.confirmations.some(c => c.sourceId === token.source);

    return {
      isDuplicate: true,
      originalDiscovery: existing,
      isConfirmation,
    };
  }

  /**
   * Handle confirmation from another source
   */
  private handleConfirmation(token: DiscoveredToken, record: DiscoveryRecord): void {
    this.stats.confirmations++;

    const confirmation: DiscoveryConfirmation = {
      tokenMint: token.mint,
      sourceId: token.source,
      confirmedAt: token.timestamp,
      latencyFromFirstMs: token.timestamp - record.discoveredAt,
    };

    record.confirmations.push(confirmation);

    // Record in scoring engine
    this.scoringEngine.recordDiscovery(token.source);
    this.sourceManager.recordSuccess(token.source);

    // Recalculate token score
    const tokenScore = this.scoringEngine.calculateTokenScore(record);

    // Emit confirmation event
    this.emitDiscoveryEvent('confirmed', token, record, tokenScore);

    logger.info('DiscoveryAggregator', `Token confirmed: ${token.symbol} by ${token.source} (${record.confirmations.length + 1} sources)`);

    // Check if token meets confirmation threshold
    if (this.meetsConfirmationThreshold(record, tokenScore)) {
      logger.info('DiscoveryAggregator', `Token ${token.symbol} meets confirmation threshold!`);
      this.emit('high_confidence_discovery', { token, record, score: tokenScore });
    }
  }

  /**
   * Check if token meets confirmation threshold
   */
  private meetsConfirmationThreshold(record: DiscoveryRecord, tokenScore: any): boolean {
    // At least N sources confirmed it
    if (record.confirmations.length + 1 < this.config.minConfirmations) {
      return false;
    }

    // Total credibility weight meets threshold
    if (tokenScore.totalWeight < this.config.confirmationWeightThreshold) {
      return false;
    }

    return true;
  }

  /**
   * Emit discovery event
   */
  private emitDiscoveryEvent(
    type: 'discovered' | 'confirmed' | 'analyzed',
    token: DiscoveredToken,
    record: DiscoveryRecord,
    score?: any
  ): void {
    const event: DiscoveryEvent = {
      type,
      token,
      record,
      score,
      timestamp: Date.now(),
    };

    this.emit('discovery_event', event);
    this.emit(type, event);
  }

  /**
   * Get statistics
   */
  getStats(): DiscoveryStats {
    const sourceStats: Record<string, any> = {};
    const healthySources = this.sourceManager.getHealthySources();

    for (const source of healthySources) {
      const health = this.sourceManager.getHealth(source.id);
      const score = this.scoringEngine.getSourceScore(source.id, source.weight);

      sourceStats[source.id] = {
        sourceId: source.id,
        tokensFound: score.successRate > 0 ? Math.floor(score.successRate * 100) : 0,
        avgLatency: score.averageLatency,
        credibilityScore: score.credibilityScore,
        isHealthy: health?.isHealthy || false,
        lastSeen: health?.lastSuccessfulDiscovery,
      };
    }

    const avgConfirmations = this.stats.uniqueTokens > 0
      ? this.stats.confirmations / this.stats.uniqueTokens
      : 0;

    return {
      totalDiscovered: this.stats.totalDiscovered,
      uniqueTokens: this.stats.uniqueTokens,
      duplicatesFiltered: this.stats.duplicatesFiltered,
      avgConfirmations,
      bySource: sourceStats,
    };
  }

  /**
   * Get discovery record
   */
  getDiscoveryRecord(mint: string): DiscoveryRecord | undefined {
    return this.seenTokens.get(mint);
  }

  /**
   * Cleanup old entries from cache
   */
  cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [mint, record] of this.seenTokens.entries()) {
      const age = now - record.discoveredAt;
      if (age > this.config.dedupWindowMs) {
        this.seenTokens.delete(mint);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info('DiscoveryAggregator', `Cleaned up ${removed} old discovery records`);
    }
  }

  /**
   * Stop all sources and cleanup
   */
  async stop(): Promise<void> {
    logger.info('DiscoveryAggregator', 'Stopping all sources');

    const sources = this.sourceManager.getHealthySources();
    
    for (const source of sources) {
      try {
        await source.stop();
      } catch (error) {
        logger.error('DiscoveryAggregator', `Error stopping source ${source.name}:`, error);
      }
    }

    this.sourceManager.stop();
    logger.info('DiscoveryAggregator', 'All sources stopped');
  }
}
