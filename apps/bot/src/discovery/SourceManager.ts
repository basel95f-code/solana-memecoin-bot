/**
 * Source Manager
 * Manages health, rate limiting, and fallback for discovery sources
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import type { IDiscoverySource } from './interfaces/IDiscoverySource';
import type { RateLimitConfig } from './interfaces/DiscoveryTypes';

interface SourceHealth {
  sourceId: string;
  isHealthy: boolean;
  lastCheck: number;
  consecutiveFailures: number;
  lastSuccessfulDiscovery: number;
}

interface RateLimitState {
  tokens: number;
  lastRefill: number;
  minuteCount: number;
  hourCount: number;
  minuteReset: number;
  hourReset: number;
}

export class SourceManager extends EventEmitter {
  private sources: Map<string, IDiscoverySource> = new Map();
  private healthStatus: Map<string, SourceHealth> = new Map();
  private rateLimits: Map<string, RateLimitState> = new Map();
  private rateLimitConfigs: Map<string, RateLimitConfig> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  private readonly MAX_CONSECUTIVE_FAILURES = 5;
  private readonly HEALTH_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

  constructor() {
    super();
    this.startHealthMonitoring();
  }

  /**
   * Register a discovery source
   */
  registerSource(source: IDiscoverySource, rateLimitConfig: RateLimitConfig): void {
    this.sources.set(source.id, source);
    
    this.healthStatus.set(source.id, {
      sourceId: source.id,
      isHealthy: true,
      lastCheck: Date.now(),
      consecutiveFailures: 0,
      lastSuccessfulDiscovery: Date.now(),
    });

    this.rateLimitConfigs.set(source.id, rateLimitConfig);
    this.rateLimits.set(source.id, this.createRateLimitState(rateLimitConfig));

    logger.info('SourceManager', `Registered source: ${source.name} (${source.id})`);
  }

  /**
   * Unregister a source
   */
  unregisterSource(sourceId: string): void {
    this.sources.delete(sourceId);
    this.healthStatus.delete(sourceId);
    this.rateLimits.delete(sourceId);
    this.rateLimitConfigs.delete(sourceId);
    logger.info('SourceManager', `Unregistered source: ${sourceId}`);
  }

  /**
   * Check if source is allowed to make a request (rate limiting)
   */
  canMakeRequest(sourceId: string): boolean {
    const state = this.rateLimits.get(sourceId);
    const config = this.rateLimitConfigs.get(sourceId);

    if (!state || !config) return false;

    const now = Date.now();

    // Refill tokens
    this.refillTokens(sourceId, state, config, now);

    // Check minute limit
    if (state.minuteCount >= config.maxPerMinute) {
      return false;
    }

    // Check hour limit
    if (state.hourCount >= config.maxPerHour) {
      return false;
    }

    // Check token bucket
    if (state.tokens < 1) {
      return false;
    }

    return true;
  }

  /**
   * Record a request made by source
   */
  recordRequest(sourceId: string): void {
    const state = this.rateLimits.get(sourceId);
    if (!state) return;

    const now = Date.now();

    // Consume token
    state.tokens = Math.max(0, state.tokens - 1);

    // Increment counters
    state.minuteCount++;
    state.hourCount++;

    // Reset minute counter if needed
    if (now >= state.minuteReset) {
      state.minuteCount = 0;
      state.minuteReset = now + 60 * 1000;
    }

    // Reset hour counter if needed
    if (now >= state.hourReset) {
      state.hourCount = 0;
      state.hourReset = now + 60 * 60 * 1000;
    }
  }

  /**
   * Record successful discovery
   */
  recordSuccess(sourceId: string): void {
    const health = this.healthStatus.get(sourceId);
    if (!health) return;

    health.consecutiveFailures = 0;
    health.isHealthy = true;
    health.lastSuccessfulDiscovery = Date.now();
    health.lastCheck = Date.now();

    this.emit('source_healthy', { sourceId, timestamp: Date.now() });
  }

  /**
   * Record failed discovery
   */
  recordFailure(sourceId: string, error: string): void {
    const health = this.healthStatus.get(sourceId);
    if (!health) return;

    health.consecutiveFailures++;
    health.lastCheck = Date.now();

    if (health.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      health.isHealthy = false;
      logger.error('SourceManager', `Source ${sourceId} marked unhealthy after ${health.consecutiveFailures} failures`);
      this.emit('source_unhealthy', { sourceId, error, timestamp: Date.now() });
    }
  }

  /**
   * Get health status for a source
   */
  getHealth(sourceId: string): SourceHealth | undefined {
    return this.healthStatus.get(sourceId);
  }

  /**
   * Get all healthy sources
   */
  getHealthySources(): IDiscoverySource[] {
    const healthy: IDiscoverySource[] = [];

    for (const [id, source] of this.sources.entries()) {
      const health = this.healthStatus.get(id);
      if (health && health.isHealthy) {
        healthy.push(source);
      }
    }

    return healthy;
  }

  /**
   * Get all unhealthy sources
   */
  getUnhealthySources(): IDiscoverySource[] {
    const unhealthy: IDiscoverySource[] = [];

    for (const [id, source] of this.sources.entries()) {
      const health = this.healthStatus.get(id);
      if (health && !health.isHealthy) {
        unhealthy.push(source);
      }
    }

    return unhealthy;
  }

  /**
   * Force health check on all sources
   */
  async checkAllHealth(): Promise<void> {
    logger.debug('SourceManager', 'Running health checks on all sources');

    for (const [id, source] of this.sources.entries()) {
      try {
        const isHealthy = source.isHealthy();
        const health = this.healthStatus.get(id);

        if (health) {
          health.lastCheck = Date.now();

          if (!isHealthy && health.isHealthy) {
            // Was healthy, now unhealthy
            health.isHealthy = false;
            logger.warn('SourceManager', `Source ${id} became unhealthy`);
            this.emit('source_unhealthy', { sourceId: id, timestamp: Date.now() });
          } else if (isHealthy && !health.isHealthy) {
            // Was unhealthy, now healthy
            health.isHealthy = true;
            health.consecutiveFailures = 0;
            logger.info('SourceManager', `Source ${id} recovered`);
            this.emit('source_recovered', { sourceId: id, timestamp: Date.now() });
          }
        }
      } catch (error: any) {
        logger.error('SourceManager', `Health check failed for ${id}:`, error);
        this.recordFailure(id, error.message);
      }
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    const stats: Record<string, any> = {
      totalSources: this.sources.size,
      healthySources: 0,
      unhealthySources: 0,
      sources: {},
    };

    for (const [id, health] of this.healthStatus.entries()) {
      if (health.isHealthy) stats.healthySources++;
      else stats.unhealthySources++;

      const rateLimit = this.rateLimits.get(id);
      stats.sources[id] = {
        healthy: health.isHealthy,
        consecutiveFailures: health.consecutiveFailures,
        lastSuccess: health.lastSuccessfulDiscovery,
        rateLimitTokens: rateLimit?.tokens || 0,
      };
    }

    return stats;
  }

  /**
   * Create initial rate limit state
   */
  private createRateLimitState(config: RateLimitConfig): RateLimitState {
    const now = Date.now();
    return {
      tokens: config.burstSize,
      lastRefill: now,
      minuteCount: 0,
      hourCount: 0,
      minuteReset: now + 60 * 1000,
      hourReset: now + 60 * 60 * 1000,
    };
  }

  /**
   * Refill token bucket
   */
  private refillTokens(
    sourceId: string,
    state: RateLimitState,
    config: RateLimitConfig,
    now: number
  ): void {
    const timeSinceRefill = now - state.lastRefill;
    const refillRate = config.maxPerMinute / 60000; // tokens per millisecond

    const tokensToAdd = timeSinceRefill * refillRate;
    state.tokens = Math.min(config.burstSize, state.tokens + tokensToAdd);
    state.lastRefill = now;
  }

  /**
   * Start periodic health monitoring
   */
  private startHealthMonitoring(): void {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(() => {
      this.checkAllHealth();
    }, this.HEALTH_CHECK_INTERVAL_MS);

    logger.info('SourceManager', 'Started health monitoring');
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    logger.info('SourceManager', 'Stopped health monitoring');
  }
}
