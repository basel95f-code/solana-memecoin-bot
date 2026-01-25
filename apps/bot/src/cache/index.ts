import { redisCache, RedisCache } from './redis';
import { lruCache, LRUCache } from './lru';
import { logger } from '../utils/logger';

/**
 * Cache TTL constants (milliseconds)
 */
export const CacheTTL = {
  TOKEN_ANALYSIS: 5 * 60 * 1000, // 5 minutes
  DEXSCREENER: 2 * 60 * 1000, // 2 minutes
  SMART_MONEY: 10 * 60 * 1000, // 10 minutes
  ML_PREDICTION: 1 * 60 * 1000, // 1 minute
  RUGCHECK: 5 * 60 * 1000, // 5 minutes
  TOKEN_INFO: 10 * 60 * 1000, // 10 minutes
  HOLDER_DATA: 5 * 60 * 1000, // 5 minutes
  SOCIAL_DATA: 15 * 60 * 1000, // 15 minutes
} as const;

/**
 * Cache key prefixes for organization
 */
export const CacheKey = {
  tokenAnalysis: (mint: string) => `analysis:${mint}`,
  dexScreener: (mint: string) => `dex:${mint}`,
  smartMoney: (mint: string) => `smartmoney:${mint}`,
  mlPrediction: (mint: string) => `ml:${mint}`,
  rugCheck: (mint: string) => `rugcheck:${mint}`,
  tokenInfo: (mint: string) => `token:${mint}`,
  holderData: (mint: string) => `holders:${mint}`,
  socialData: (mint: string) => `social:${mint}`,
  contractData: (mint: string) => `contract:${mint}`,
  liquidityData: (mint: string) => `liquidity:${mint}`,
} as const;

/**
 * Unified cache manager with Redis primary and LRU fallback
 * Automatically falls back to in-memory cache when Redis is unavailable
 */
export class CacheManager {
  private redis: RedisCache;
  private lru: LRUCache;
  private useRedis: boolean = true;
  private lastRedisCheck: number = 0;
  private redisCheckInterval: number = 30000; // Check every 30s

  constructor(redis: RedisCache, lru: LRUCache) {
    this.redis = redis;
    this.lru = lru;
    this.checkRedisAvailability();
  }

  /**
   * Periodically check if Redis is available
   */
  private async checkRedisAvailability(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRedisCheck < this.redisCheckInterval) {
      return;
    }

    this.lastRedisCheck = now;
    this.useRedis = this.redis.isAvailable();

    if (!this.useRedis) {
      logger.warn('CacheManager', 'Redis unavailable, using LRU fallback');
    }
  }

  /**
   * Get value from cache (Redis first, then LRU)
   */
  async get<T>(key: string): Promise<T | null> {
    await this.checkRedisAvailability();

    if (this.useRedis) {
      try {
        const value = await this.redis.get<T>(key);
        if (value !== null) {
          // Also cache in LRU for faster subsequent access
          this.lru.set(key, value, CacheTTL.TOKEN_ANALYSIS);
          return value;
        }
      } catch (error) {
        logger.warn('CacheManager', `Redis get failed for ${key}: ${error}`);
      }
    }

    // Fallback to LRU
    return this.lru.get<T>(key);
  }

  /**
   * Set value in cache (both Redis and LRU)
   */
  async set<T>(key: string, value: T, ttlMs: number): Promise<boolean> {
    await this.checkRedisAvailability();

    let redisSuccess = false;
    let lruSuccess = false;

    // Always set in LRU for fast local access
    lruSuccess = this.lru.set(key, value, ttlMs);

    // Also set in Redis if available
    if (this.useRedis) {
      try {
        redisSuccess = await this.redis.set(key, value, ttlMs);
      } catch (error) {
        logger.warn('CacheManager', `Redis set failed for ${key}: ${error}`);
      }
    }

    return lruSuccess || redisSuccess;
  }

  /**
   * Delete from both caches
   */
  async delete(key: string): Promise<boolean> {
    const lruResult = this.lru.delete(key);

    if (this.useRedis) {
      try {
        await this.redis.delete(key);
      } catch (error) {
        logger.warn('CacheManager', `Redis delete failed for ${key}: ${error}`);
      }
    }

    return lruResult;
  }

  /**
   * Check if key exists
   */
  async has(key: string): Promise<boolean> {
    if (this.lru.has(key)) {
      return true;
    }

    if (this.useRedis) {
      try {
        return await this.redis.has(key);
      } catch (error) {
        logger.warn('CacheManager', `Redis has failed for ${key}: ${error}`);
      }
    }

    return false;
  }

  /**
   * Get multiple keys at once (parallel)
   */
  async mget<T>(keys: string[]): Promise<Map<string, T>> {
    await this.checkRedisAvailability();

    if (this.useRedis) {
      try {
        const redisResults = await this.redis.mget<T>(keys);
        
        // Cache Redis results in LRU
        for (const [key, value] of redisResults.entries()) {
          this.lru.set(key, value, CacheTTL.TOKEN_ANALYSIS);
        }

        // Check LRU for any missing keys
        const missingKeys = keys.filter(k => !redisResults.has(k));
        if (missingKeys.length > 0) {
          const lruResults = this.lru.mget<T>(missingKeys);
          for (const [key, value] of lruResults.entries()) {
            redisResults.set(key, value);
          }
        }

        return redisResults;
      } catch (error) {
        logger.warn('CacheManager', `Redis mget failed: ${error}`);
      }
    }

    // Fallback to LRU
    return this.lru.mget<T>(keys);
  }

  /**
   * Set multiple keys at once (parallel)
   */
  async mset<T>(entries: Map<string, { value: T; ttl: number }>): Promise<boolean> {
    await this.checkRedisAvailability();

    let lruSuccess = false;
    let redisSuccess = false;

    // Always set in LRU
    lruSuccess = this.lru.mset(entries);

    // Also set in Redis if available
    if (this.useRedis) {
      try {
        redisSuccess = await this.redis.mset(entries);
      } catch (error) {
        logger.warn('CacheManager', `Redis mset failed: ${error}`);
      }
    }

    return lruSuccess || redisSuccess;
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    this.lru.clear();

    if (this.useRedis) {
      try {
        await this.redis.clear();
      } catch (error) {
        logger.warn('CacheManager', `Redis clear failed: ${error}`);
      }
    }
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    this.lru.cleanup();
  }

  /**
   * Get combined cache statistics
   */
  async getStats(): Promise<{
    redis: any;
    lru: any;
    usingRedis: boolean;
  }> {
    const lruStats = this.lru.getStats();
    let redisStats = null;

    if (this.useRedis) {
      try {
        redisStats = await this.redis.getStats();
      } catch (error) {
        logger.warn('CacheManager', `Failed to get Redis stats: ${error}`);
      }
    }

    return {
      redis: redisStats,
      lru: lruStats,
      usingRedis: this.useRedis,
    };
  }

  /**
   * Get or compute value with automatic caching
   * @param key Cache key
   * @param ttl TTL in milliseconds
   * @param compute Function to compute value if not cached
   */
  async getOrCompute<T>(
    key: string,
    ttl: number,
    compute: () => Promise<T>
  ): Promise<T | null> {
    // Try to get from cache
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Compute value
    try {
      const value = await compute();
      if (value !== null && value !== undefined) {
        await this.set(key, value, ttl);
      }
      return value;
    } catch (error) {
      logger.error('CacheManager', `Failed to compute ${key}: ${error}`);
      return null;
    }
  }

  /**
   * Batch get-or-compute for multiple keys
   */
  async batchGetOrCompute<T>(
    keys: string[],
    ttl: number,
    compute: (missingKeys: string[]) => Promise<Map<string, T>>
  ): Promise<Map<string, T>> {
    // Get cached values
    const cached = await this.mget<T>(keys);

    // Find missing keys
    const missingKeys = keys.filter(k => !cached.has(k));

    if (missingKeys.length === 0) {
      return cached;
    }

    // Compute missing values
    try {
      const computed = await compute(missingKeys);

      // Cache computed values
      const toCache = new Map<string, { value: T; ttl: number }>();
      for (const [key, value] of computed.entries()) {
        toCache.set(key, { value, ttl });
        cached.set(key, value);
      }

      if (toCache.size > 0) {
        await this.mset(toCache);
      }

      return cached;
    } catch (error) {
      logger.error('CacheManager', `Batch compute failed: ${error}`);
      return cached;
    }
  }
}

// Singleton instance
export const cacheManager = new CacheManager(redisCache, lruCache);

// Export everything
export { redisCache, lruCache, RedisCache, LRUCache };
export default cacheManager;
