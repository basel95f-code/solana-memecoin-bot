/**
 * Token Snapshot Collector
 * Captures comprehensive ML features for every token with smart buffering and batch inserts
 * 
 * This is the core of the self-learning pipeline - capturing high-quality training data
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { database } from '../../database';
import { gmgnService } from '../../services/gmgn';
import { dexScreenerService } from '../../services/dexscreener';
import type { TokenSnapshot, MLFeatureVector, SamplingTier, TokenSamplingState } from './types';
import { FeatureExtractor, featureExtractor } from './FeatureExtractor';
import { AdaptiveSampler, adaptiveSampler } from '../sampling/AdaptiveSampler';

// ============================================
// Configuration
// ============================================

const CONFIG = {
  // Buffering
  BUFFER_SIZE: 100, // Batch insert when buffer reaches this size
  BUFFER_FLUSH_INTERVAL_MS: 30_000, // Force flush every 30 seconds
  
  // Deduplication
  MIN_SNAPSHOT_INTERVAL_MS: 60_000, // Minimum 1 minute between snapshots for same token
  
  // Concurrency
  MAX_CONCURRENT_FETCHES: 10,
  FETCH_TIMEOUT_MS: 10_000,
  
  // Quality
  MAX_MISSING_FEATURES_PERCENT: 20, // Skip if >20% features missing
  
  // Cleanup
  MAX_TRACKED_TOKENS: 5000,
  TRACKING_EXPIRY_HOURS: 48,
  
  // Rate Limits
  RATE_LIMIT_REQUESTS_PER_MIN: 60,
  RATE_LIMIT_WINDOW_MS: 60_000,
};

// ============================================
// Token Snapshot Collector
// ============================================

export class TokenSnapshotCollector extends EventEmitter {
  private buffer: TokenSnapshot[] = [];
  private lastFlushAt: number = Date.now();
  private flushInterval: NodeJS.Timeout | null = null;
  
  // Tracking state
  private trackedTokens: Map<string, TokenSamplingState> = new Map();
  private lastSnapshotTimes: Map<string, number> = new Map();
  
  // Rate limiting
  private requestCount: number = 0;
  private rateLimitWindowStart: number = Date.now();
  
  // Stats
  private stats = {
    snapshotsCollected: 0,
    snapshotsSkippedDuplicate: 0,
    snapshotsSkippedQuality: 0,
    batchInserts: 0,
    errors: 0,
    lastCollectionAt: 0,
  };

  constructor() {
    super();
  }

  /**
   * Initialize the collector
   */
  async initialize(): Promise<void> {
    // Start periodic buffer flush
    this.flushInterval = setInterval(() => {
      this.flushBuffer().catch(err => {
        logger.silentError('TokenSnapshotCollector', 'Buffer flush failed', err);
      });
    }, CONFIG.BUFFER_FLUSH_INTERVAL_MS);
    
    // Load existing tracked tokens from database
    await this.loadTrackedTokens();
    
    logger.info('TokenSnapshotCollector', `Initialized with ${this.trackedTokens.size} tracked tokens`);
  }

  /**
   * Shutdown gracefully
   */
  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    // Final flush
    await this.flushBuffer();
    
    logger.info('TokenSnapshotCollector', 'Shutdown complete');
  }

  /**
   * Load tracked tokens from database
   */
  private async loadTrackedTokens(): Promise<void> {
    try {
      const watchList = database.getSnapshotWatchList();
      
      for (const item of watchList) {
        if (item.isActive) {
          this.trackedTokens.set(item.mint, {
            mint: item.mint,
            symbol: item.symbol || 'UNKNOWN',
            tier: 'medium' as SamplingTier,
            currentConfig: adaptiveSampler.getSamplingConfig('medium'),
            snapshotCount: item.snapshotCount || 0,
            hasPrediction: false,
            hasInterestingEvent: false,
            liquidityUsd: 0,
            addedAt: item.addedAt * 1000,
            expiresAt: item.expiresAt ? item.expiresAt * 1000 : undefined,
            isActive: true,
            lastSnapshotAt: item.lastSnapshotAt ? item.lastSnapshotAt * 1000 : undefined,
          });
        }
      }
    } catch (error) {
      logger.silentError('TokenSnapshotCollector', 'Failed to load tracked tokens', error as Error);
    }
  }

  /**
   * Add a token to tracking
   */
  addToken(
    mint: string, 
    symbol: string, 
    options?: {
      tier?: SamplingTier;
      liquidityUsd?: number;
      hasPrediction?: boolean;
      expiresInHours?: number;
    }
  ): void {
    const now = Date.now();
    const tier = options?.tier || adaptiveSampler.determineTier(options?.liquidityUsd || 0);
    
    const state: TokenSamplingState = {
      mint,
      symbol,
      tier,
      currentConfig: adaptiveSampler.getSamplingConfig(tier),
      snapshotCount: 0,
      hasPrediction: options?.hasPrediction || false,
      hasInterestingEvent: false,
      liquidityUsd: options?.liquidityUsd || 0,
      addedAt: now,
      expiresAt: options?.expiresInHours 
        ? now + (options.expiresInHours * 60 * 60 * 1000)
        : now + (CONFIG.TRACKING_EXPIRY_HOURS * 60 * 60 * 1000),
      isActive: true,
    };
    
    this.trackedTokens.set(mint, state);
    
    // Also add to database
    database.addToSnapshotWatchList(
      mint, 
      symbol, 
      state.expiresAt ? Math.floor(state.expiresAt / 1000) : undefined
    );
    
    this.emit('tokenAdded', { mint, symbol, tier });
    
    // Enforce max tracked tokens
    this.enforceMaxTrackedTokens();
  }

  /**
   * Remove a token from tracking
   */
  removeToken(mint: string): void {
    const state = this.trackedTokens.get(mint);
    if (state) {
      state.isActive = false;
      this.trackedTokens.delete(mint);
      database.removeFromSnapshotWatchList(mint);
      this.emit('tokenRemoved', { mint, symbol: state.symbol });
    }
  }

  /**
   * Mark token as having an interesting event (increases sampling frequency)
   */
  markInterestingEvent(mint: string, eventType: string): void {
    const state = this.trackedTokens.get(mint);
    if (state) {
      state.hasInterestingEvent = true;
      state.lastEventAt = Date.now();
      state.eventType = eventType;
      
      // Upgrade to high tier temporarily
      state.tier = 'high';
      state.currentConfig = adaptiveSampler.getSamplingConfig('high');
      
      this.emit('interestingEvent', { mint, eventType });
    }
  }

  /**
   * Mark token as having a prediction (we want to track its outcome)
   */
  markHasPrediction(mint: string): void {
    const state = this.trackedTokens.get(mint);
    if (state) {
      state.hasPrediction = true;
      
      // Extend tracking duration
      state.expiresAt = Date.now() + (48 * 60 * 60 * 1000); // Track for 48 more hours
      
      // Upgrade tier if not already high
      if (state.tier !== 'high') {
        state.tier = 'medium';
        state.currentConfig = adaptiveSampler.getSamplingConfig('medium');
      }
    }
  }

  /**
   * Collect snapshots for all active tokens
   */
  async collectAllSnapshots(): Promise<{
    collected: number;
    skipped: number;
    errors: number;
  }> {
    const startTime = Date.now();
    let collected = 0;
    let skipped = 0;
    let errors = 0;
    
    // Get tokens that need snapshots
    const tokensToSnapshot = this.getTokensNeedingSnapshot();
    
    if (tokensToSnapshot.length === 0) {
      return { collected, skipped, errors };
    }
    
    logger.debug('TokenSnapshotCollector', `Collecting snapshots for ${tokensToSnapshot.length} tokens`);
    
    // Process in batches with concurrency limit
    const batchSize = CONFIG.MAX_CONCURRENT_FETCHES;
    
    for (let i = 0; i < tokensToSnapshot.length; i += batchSize) {
      const batch = tokensToSnapshot.slice(i, i + batchSize);
      
      const results = await Promise.allSettled(
        batch.map(state => this.collectSnapshot(state))
      );
      
      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value.success) {
            collected++;
          } else if (result.value.skipped) {
            skipped++;
          }
        } else {
          errors++;
          this.stats.errors++;
        }
      }
      
      // Rate limit between batches
      if (i + batchSize < tokensToSnapshot.length) {
        await this.waitForRateLimit();
      }
    }
    
    // Update stats
    this.stats.snapshotsCollected += collected;
    this.stats.lastCollectionAt = Date.now();
    
    const duration = Date.now() - startTime;
    logger.info('TokenSnapshotCollector', 
      `Collected ${collected} snapshots, skipped ${skipped}, errors ${errors} in ${duration}ms`
    );
    
    this.emit('collectionComplete', { collected, skipped, errors, durationMs: duration });
    
    return { collected, skipped, errors };
  }

  /**
   * Get tokens that need a snapshot based on their sampling config
   */
  private getTokensNeedingSnapshot(): TokenSamplingState[] {
    const now = Date.now();
    const tokensNeeding: TokenSamplingState[] = [];
    
    for (const [mint, state] of this.trackedTokens) {
      // Check if expired
      if (state.expiresAt && now > state.expiresAt) {
        this.removeToken(mint);
        continue;
      }
      
      if (!state.isActive) continue;
      
      // Check if enough time has passed since last snapshot
      const lastSnapshot = state.lastSnapshotAt || 0;
      const intervalMs = state.currentConfig.intervalSeconds * 1000;
      
      if (now - lastSnapshot >= intervalMs) {
        // Also check max snapshots
        if (state.snapshotCount < state.currentConfig.maxSnapshotsPerToken) {
          tokensNeeding.push(state);
        }
      }
    }
    
    // Sort by priority (higher priority first)
    tokensNeeding.sort((a, b) => b.currentConfig.priority - a.currentConfig.priority);
    
    return tokensNeeding;
  }

  /**
   * Collect a single snapshot for a token
   */
  private async collectSnapshot(state: TokenSamplingState): Promise<{
    success: boolean;
    skipped: boolean;
    error?: string;
  }> {
    const { mint, symbol } = state;
    
    try {
      // Check for duplicate (safety check)
      const lastSnapshot = this.lastSnapshotTimes.get(mint) || 0;
      if (Date.now() - lastSnapshot < CONFIG.MIN_SNAPSHOT_INTERVAL_MS) {
        this.stats.snapshotsSkippedDuplicate++;
        return { success: false, skipped: true };
      }
      
      // Fetch token data from multiple sources
      const [dexData, gmgnData] = await Promise.all([
        dexScreenerService.getPair(mint).catch(() => null),
        gmgnService.getTokenInfo(mint).catch(() => null),
      ]);
      
      // Skip if no data available
      if (!dexData && !gmgnData) {
        return { success: false, skipped: true, error: 'No data available' };
      }
      
      // Extract features using the FeatureExtractor
      const snapshot = await featureExtractor.createSnapshot(mint, symbol, {
        dexData,
        gmgnData,
        includeSmartMoney: state.hasPrediction || state.hasInterestingEvent,
        includeSentiment: state.hasPrediction,
      });
      
      if (!snapshot) {
        return { success: false, skipped: true, error: 'Failed to create snapshot' };
      }
      
      // Validate quality
      const qualityCheck = this.validateSnapshotQuality(snapshot);
      if (!qualityCheck.valid) {
        this.stats.snapshotsSkippedQuality++;
        return { success: false, skipped: true, error: qualityCheck.reason };
      }
      
      // Add to buffer
      this.addToBuffer(snapshot);
      
      // Update tracking state
      state.lastSnapshotAt = Date.now();
      state.snapshotCount++;
      state.liquidityUsd = snapshot.liquidityUsd;
      
      // Update tier based on new liquidity
      const newTier = adaptiveSampler.determineTier(snapshot.liquidityUsd, {
        hasPrediction: state.hasPrediction,
        hasInterestingEvent: state.hasInterestingEvent,
      });
      
      if (newTier !== state.tier && !state.hasInterestingEvent) {
        state.tier = newTier;
        state.currentConfig = adaptiveSampler.getSamplingConfig(newTier);
      }
      
      // Update last snapshot time
      this.lastSnapshotTimes.set(mint, Date.now());
      
      // Update database
      database.updateSnapshotWatchEntry(mint);
      
      return { success: true, skipped: false };
      
    } catch (error) {
      this.stats.errors++;
      return { success: false, skipped: false, error: (error as Error).message };
    }
  }

  /**
   * Validate snapshot quality
   */
  private validateSnapshotQuality(snapshot: TokenSnapshot): {
    valid: boolean;
    reason?: string;
  } {
    // Check for required fields
    if (!snapshot.priceUsd || snapshot.priceUsd <= 0) {
      return { valid: false, reason: 'Missing or invalid price' };
    }
    
    if (!snapshot.liquidityUsd || snapshot.liquidityUsd < 100) {
      return { valid: false, reason: 'Liquidity too low' };
    }
    
    // Check feature completeness
    if (snapshot.features) {
      const features = snapshot.features;
      const featureValues = Object.values(features);
      const missingCount = featureValues.filter(v => v === null || v === undefined || Number.isNaN(v)).length;
      const missingPercent = (missingCount / featureValues.length) * 100;
      
      if (missingPercent > CONFIG.MAX_MISSING_FEATURES_PERCENT) {
        return { valid: false, reason: `Too many missing features: ${missingPercent.toFixed(1)}%` };
      }
    }
    
    return { valid: true };
  }

  /**
   * Add snapshot to buffer
   */
  private addToBuffer(snapshot: TokenSnapshot): void {
    this.buffer.push(snapshot);
    
    // Flush if buffer is full
    if (this.buffer.length >= CONFIG.BUFFER_SIZE) {
      this.flushBuffer().catch(err => {
        logger.silentError('TokenSnapshotCollector', 'Buffer flush failed', err);
      });
    }
  }

  /**
   * Flush buffer to database
   */
  async flushBuffer(): Promise<number> {
    if (this.buffer.length === 0) return 0;
    
    const toFlush = [...this.buffer];
    this.buffer = [];
    
    const startTime = Date.now();
    let inserted = 0;
    
    try {
      // Batch insert
      for (const snapshot of toFlush) {
        try {
          database.saveTokenSnapshot({
            mint: snapshot.mint,
            symbol: snapshot.symbol,
            priceUsd: snapshot.priceUsd,
            priceSol: snapshot.priceSol,
            volume5m: snapshot.volume5m,
            volume1h: snapshot.volume1h,
            volume24h: snapshot.volume24h,
            liquidityUsd: snapshot.liquidityUsd,
            marketCap: snapshot.marketCap,
            holderCount: snapshot.holderCount,
            priceChange5m: snapshot.priceChange5m,
            priceChange1h: snapshot.priceChange1h,
            priceChange24h: snapshot.priceChange24h,
            buys5m: snapshot.buys5m,
            sells5m: snapshot.sells5m,
            buys1h: snapshot.buys1h,
            sells1h: snapshot.sells1h,
            recordedAt: snapshot.recordedAt,
          });
          
          // Also save to ML training data table with features
          if (snapshot.features && snapshot.normalizedFeatures) {
            this.saveMLTrainingSnapshot(snapshot);
          }
          
          inserted++;
        } catch (err) {
          // Continue on individual errors
          logger.silentError('TokenSnapshotCollector', `Failed to save snapshot for ${snapshot.symbol}`, err as Error);
        }
      }
      
      this.stats.batchInserts++;
      this.lastFlushAt = Date.now();
      
      const duration = Date.now() - startTime;
      logger.debug('TokenSnapshotCollector', `Flushed ${inserted}/${toFlush.length} snapshots in ${duration}ms`);
      
      this.emit('bufferFlushed', { count: inserted, durationMs: duration });
      
      return inserted;
      
    } catch (error) {
      logger.error('TokenSnapshotCollector', 'Buffer flush failed', error as Error);
      
      // Put failed items back in buffer (up to limit)
      const remainingCapacity = CONFIG.BUFFER_SIZE - this.buffer.length;
      if (remainingCapacity > 0) {
        this.buffer.unshift(...toFlush.slice(0, remainingCapacity));
      }
      
      return inserted;
    }
  }

  /**
   * Save snapshot with ML features to training data table
   */
  private saveMLTrainingSnapshot(snapshot: TokenSnapshot): void {
    try {
      const db = database.getDb();
      if (!db) return;
      
      db.run(`
        INSERT OR REPLACE INTO ml_training_data (
          mint, symbol, features_json, feature_version,
          price_usd, liquidity_usd, risk_score,
          price_change_1h, price_change_6h, price_change_24h,
          sentiment_score, whale_action, has_outcome,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        snapshot.mint,
        snapshot.symbol,
        JSON.stringify(snapshot.features),
        'v2',
        snapshot.priceUsd,
        snapshot.liquidityUsd,
        snapshot.riskScore,
        snapshot.priceChange1h,
        null, // Will be filled by outcome tracker
        snapshot.priceChange24h,
        snapshot.sentimentScore ?? null,
        null, // Will be filled by outcome tracker
        0, // No outcome yet
        Math.floor(Date.now() / 1000),
      ]);
    } catch (error) {
      // Silently ignore - this is supplementary data
    }
  }

  /**
   * Rate limit management
   */
  private async waitForRateLimit(): Promise<void> {
    this.requestCount++;
    
    const now = Date.now();
    const windowElapsed = now - this.rateLimitWindowStart;
    
    // Reset window if needed
    if (windowElapsed >= CONFIG.RATE_LIMIT_WINDOW_MS) {
      this.rateLimitWindowStart = now;
      this.requestCount = 1;
      return;
    }
    
    // Check if we've exceeded rate limit
    if (this.requestCount >= CONFIG.RATE_LIMIT_REQUESTS_PER_MIN) {
      const waitTime = CONFIG.RATE_LIMIT_WINDOW_MS - windowElapsed + 100;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.rateLimitWindowStart = Date.now();
      this.requestCount = 0;
    }
  }

  /**
   * Enforce maximum tracked tokens
   */
  private enforceMaxTrackedTokens(): void {
    if (this.trackedTokens.size <= CONFIG.MAX_TRACKED_TOKENS) return;
    
    // Sort by priority (lowest first) and remove excess
    const sorted = [...this.trackedTokens.entries()]
      .sort((a, b) => a[1].currentConfig.priority - b[1].currentConfig.priority);
    
    const toRemove = sorted.slice(0, this.trackedTokens.size - CONFIG.MAX_TRACKED_TOKENS);
    
    for (const [mint] of toRemove) {
      this.removeToken(mint);
    }
    
    logger.info('TokenSnapshotCollector', `Removed ${toRemove.length} low-priority tokens`);
  }

  /**
   * Cleanup expired watches
   */
  cleanupExpired(): number {
    const now = Date.now();
    let removed = 0;
    
    for (const [mint, state] of this.trackedTokens) {
      if (state.expiresAt && now > state.expiresAt) {
        this.removeToken(mint);
        removed++;
      }
    }
    
    // Also cleanup in database
    database.cleanupExpiredSnapshotWatches(Math.floor(now / 1000));
    
    return removed;
  }

  /**
   * Get statistics
   */
  getStats(): typeof this.stats & {
    trackedTokens: number;
    bufferSize: number;
    tokensByTier: Record<SamplingTier, number>;
  } {
    const tokensByTier: Record<SamplingTier, number> = {
      high: 0,
      medium: 0,
      low: 0,
      minimal: 0,
    };
    
    for (const state of this.trackedTokens.values()) {
      tokensByTier[state.tier]++;
    }
    
    return {
      ...this.stats,
      trackedTokens: this.trackedTokens.size,
      bufferSize: this.buffer.length,
      tokensByTier,
    };
  }

  /**
   * Get tracking state for a token
   */
  getTokenState(mint: string): TokenSamplingState | undefined {
    return this.trackedTokens.get(mint);
  }

  /**
   * Get all tracked tokens
   */
  getTrackedTokens(): TokenSamplingState[] {
    return [...this.trackedTokens.values()];
  }
}

// Export singleton
export const tokenSnapshotCollector = new TokenSnapshotCollector();
