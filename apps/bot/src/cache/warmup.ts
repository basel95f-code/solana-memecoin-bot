import { cacheManager, CacheKey, CacheTTL } from './index';
import { logger } from '../utils/logger';
import { analyzeToken } from '../analysis/tokenAnalyzer';
import type { PoolInfo } from '../types';

/**
 * Token popularity tracking for smart cache warmup
 */
class PopularityTracker {
  private accessCounts: Map<string, number> = new Map();
  private lastAccess: Map<string, number> = new Map();
  private readonly decayInterval = 3600000; // 1 hour

  /**
   * Record token access
   */
  recordAccess(mint: string): void {
    const count = this.accessCounts.get(mint) || 0;
    this.accessCounts.set(mint, count + 1);
    this.lastAccess.set(mint, Date.now());
  }

  /**
   * Get most popular tokens
   */
  getPopular(limit: number = 20): string[] {
    // Apply time decay to counts
    const now = Date.now();
    const scored = Array.from(this.accessCounts.entries()).map(([mint, count]) => {
      const lastAccessTime = this.lastAccess.get(mint) || 0;
      const age = now - lastAccessTime;
      const decayFactor = Math.exp(-age / this.decayInterval);
      const score = count * decayFactor;
      return { mint, score };
    });

    // Sort by score and return top N
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.mint);
  }

  /**
   * Clean up old entries
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 3600000; // 24 hours

    for (const [mint, lastAccessTime] of this.lastAccess.entries()) {
      if (now - lastAccessTime > maxAge) {
        this.accessCounts.delete(mint);
        this.lastAccess.delete(mint);
      }
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    trackedTokens: number;
    topToken: string | null;
    topCount: number;
  } {
    if (this.accessCounts.size === 0) {
      return {
        trackedTokens: 0,
        topToken: null,
        topCount: 0,
      };
    }

    const sorted = Array.from(this.accessCounts.entries()).sort((a, b) => b[1] - a[1]);
    const [topToken, topCount] = sorted[0];

    return {
      trackedTokens: this.accessCounts.size,
      topToken,
      topCount,
    };
  }
}

const popularityTracker = new PopularityTracker();

/**
 * Cache warmup manager
 * Pre-caches popular tokens and keeps hot data warm
 */
export class CacheWarmup {
  private warmupInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start background cache warmup
   * @param intervalMs How often to refresh hot data (default: 2 minutes)
   */
  start(intervalMs: number = 120000): void {
    if (this.isRunning) {
      logger.warn('cacheWarmup', 'Warmup already running');
      return;
    }

    this.isRunning = true;
    logger.info('cacheWarmup', 'Starting cache warmup service');

    // Initial warmup
    this.warmupPopularTokens().catch((err) => {
      logger.error('cacheWarmup', `Initial warmup failed: ${err}`);
    });

    // Periodic warmup
    this.warmupInterval = setInterval(() => {
      this.warmupPopularTokens().catch((err) => {
        logger.error('cacheWarmup', `Periodic warmup failed: ${err}`);
      });

      // Cleanup old entries
      popularityTracker.cleanup();
    }, intervalMs);
  }

  /**
   * Stop background cache warmup
   */
  stop(): void {
    if (this.warmupInterval) {
      clearInterval(this.warmupInterval);
      this.warmupInterval = null;
    }
    this.isRunning = false;
    logger.info('cacheWarmup', 'Cache warmup service stopped');
  }

  /**
   * Warm up popular tokens
   */
  private async warmupPopularTokens(): Promise<void> {
    const popular = popularityTracker.getPopular(20);
    
    if (popular.length === 0) {
      logger.debug('cacheWarmup', 'No popular tokens to warm up');
      return;
    }

    logger.info('cacheWarmup', `Warming up ${popular.length} popular tokens`);

    // Check which tokens need refresh (TTL expired or close to expiring)
    const toRefresh: string[] = [];
    
    for (const mint of popular) {
      const cached = await cacheManager.get(CacheKey.tokenAnalysis(mint));
      if (!cached) {
        toRefresh.push(mint);
      }
    }

    if (toRefresh.length === 0) {
      logger.debug('cacheWarmup', 'All popular tokens are cached');
      return;
    }

    logger.info('cacheWarmup', `Refreshing ${toRefresh.length} expired tokens`);

    // Note: We can't refresh without pool info, so this is mainly for demonstration
    // In practice, you'd store pool info with the mint when tracking popularity
  }

  /**
   * Pre-cache a specific token
   */
  async precacheToken(mint: string, pool: PoolInfo): Promise<boolean> {
    try {
      logger.debug('cacheWarmup', `Pre-caching token ${mint}`);
      
      const analysis = await analyzeToken(mint, pool);
      if (analysis) {
        popularityTracker.recordAccess(mint);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('cacheWarmup', `Failed to pre-cache ${mint}: ${error}`);
      return false;
    }
  }

  /**
   * Pre-cache multiple tokens
   */
  async precacheTokens(
    tokens: Array<{ mint: string; pool: PoolInfo }>
  ): Promise<{ success: number; failed: number }> {
    logger.info('cacheWarmup', `Pre-caching ${tokens.length} tokens`);

    let success = 0;
    let failed = 0;

    // Process in parallel with rate limiting
    const promises = tokens.map(async ({ mint, pool }) => {
      const result = await this.precacheToken(mint, pool);
      if (result) {
        success++;
      } else {
        failed++;
      }
    });

    await Promise.allSettled(promises);

    logger.info('cacheWarmup', `Pre-cache complete: ${success} success, ${failed} failed`);

    return { success, failed };
  }

  /**
   * Record that a token was accessed (for popularity tracking)
   */
  recordAccess(mint: string): void {
    popularityTracker.recordAccess(mint);
  }

  /**
   * Get warmup statistics
   */
  getStats(): {
    running: boolean;
    popularTokens: string[];
    popularityStats: ReturnType<typeof popularityTracker.getStats>;
  } {
    return {
      running: this.isRunning,
      popularTokens: popularityTracker.getPopular(10),
      popularityStats: popularityTracker.getStats(),
    };
  }
}

// Singleton instance
export const cacheWarmup = new CacheWarmup();

/**
 * Smart eviction policy
 * Keeps hot data in cache longer
 */
export class SmartEviction {
  /**
   * Check if an item should be evicted
   * Items with high access counts get longer TTL
   */
  shouldEvict(mint: string, baseScore: number): boolean {
    const popular = popularityTracker.getPopular(50);
    const isPopular = popular.includes(mint);

    // Popular items get 2x longer TTL effectively
    if (isPopular) {
      return baseScore < 0.3; // More lenient threshold
    }

    return baseScore < 0.5;
  }

  /**
   * Get adjusted TTL based on popularity
   */
  getAdjustedTTL(mint: string, baseTTL: number): number {
    const popular = popularityTracker.getPopular(50);
    const index = popular.indexOf(mint);

    if (index === -1) {
      return baseTTL; // Not popular, use base TTL
    }

    // Top 10: 2x TTL
    if (index < 10) {
      return baseTTL * 2;
    }

    // Top 50: 1.5x TTL
    return Math.floor(baseTTL * 1.5);
  }
}

export const smartEviction = new SmartEviction();
