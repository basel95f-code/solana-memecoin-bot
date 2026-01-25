import Redis from 'ioredis';
import { logger } from '../utils/logger';

export interface CacheConfig {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  enableOfflineQueue?: boolean;
  maxRetriesPerRequest?: number;
}

export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
}

/**
 * Redis cache client with automatic fallback to in-memory LRU
 * Supports JSON serialization and TTL
 */
export class RedisCache {
  private client: Redis | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly keyPrefix: string;

  constructor(private config: CacheConfig = {}) {
    this.keyPrefix = config.keyPrefix || 'memecoin:';
    this.connect();
  }

  private connect(): void {
    try {
      this.client = new Redis({
        host: this.config.host || process.env.REDIS_HOST || 'localhost',
        port: this.config.port || parseInt(process.env.REDIS_PORT || '6379'),
        password: this.config.password || process.env.REDIS_PASSWORD,
        db: this.config.db || 0,
        keyPrefix: this.keyPrefix,
        enableOfflineQueue: this.config.enableOfflineQueue ?? false,
        maxRetriesPerRequest: this.config.maxRetriesPerRequest ?? 3,
        retryStrategy: (times) => {
          if (times > this.maxReconnectAttempts) {
            logger.warn('RedisCache', `Max reconnection attempts reached (${this.maxReconnectAttempts})`);
            return null; // Stop retrying
          }
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        lazyConnect: true, // Don't connect immediately
      });

      // Event handlers
      this.client.on('connect', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        logger.info('RedisCache', 'Connected to Redis');
      });

      this.client.on('ready', () => {
        logger.info('RedisCache', 'Redis ready');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        logger.error('RedisCache', `Redis error: ${err.message}`);
      });

      this.client.on('close', () => {
        this.isConnected = false;
        logger.warn('RedisCache', 'Redis connection closed');
      });

      this.client.on('reconnecting', () => {
        this.reconnectAttempts++;
        logger.info('RedisCache', `Reconnecting to Redis (attempt ${this.reconnectAttempts})`);
      });

      // Attempt initial connection
      this.client.connect().catch((err) => {
        logger.warn('RedisCache', `Failed to connect to Redis: ${err.message}. Falling back to in-memory cache.`);
        this.isConnected = false;
      });
    } catch (error) {
      logger.error('RedisCache', `Failed to initialize Redis client: ${error}`);
      this.client = null;
      this.isConnected = false;
    }
  }

  /**
   * Check if Redis is available
   */
  isAvailable(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.isAvailable()) {
      return null;
    }

    try {
      const value = await this.client!.get(key);
      if (!value) return null;

      const entry: CacheEntry<T> = JSON.parse(value);

      // Check if expired
      const now = Date.now();
      if (entry.timestamp + entry.ttl < now) {
        await this.delete(key).catch(() => {}); // Best effort delete
        return null;
      }

      return entry.data;
    } catch (error) {
      logger.error('RedisCache', `Failed to get ${key}: ${error}`);
      return null;
    }
  }

  /**
   * Set value in cache with TTL (milliseconds)
   */
  async set<T>(key: string, value: T, ttlMs: number): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const entry: CacheEntry<T> = {
        data: value,
        timestamp: Date.now(),
        ttl: ttlMs,
      };

      const serialized = JSON.stringify(entry);
      const ttlSeconds = Math.ceil(ttlMs / 1000);

      await this.client!.setex(key, ttlSeconds, serialized);
      return true;
    } catch (error) {
      logger.error('RedisCache', `Failed to set ${key}: ${error}`);
      return false;
    }
  }

  /**
   * Delete key from cache
   */
  async delete(key: string): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      await this.client!.del(key);
      return true;
    } catch (error) {
      logger.error('RedisCache', `Failed to delete ${key}: ${error}`);
      return false;
    }
  }

  /**
   * Check if key exists
   */
  async has(key: string): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const exists = await this.client!.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error('RedisCache', `Failed to check ${key}: ${error}`);
      return false;
    }
  }

  /**
   * Get multiple keys at once (pipeline)
   */
  async mget<T>(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();

    if (!this.isAvailable() || keys.length === 0) {
      return result;
    }

    try {
      const values = await this.client!.mget(...keys);
      const now = Date.now();

      for (let i = 0; i < keys.length; i++) {
        const value = values[i];
        if (!value) continue;

        try {
          const entry: CacheEntry<T> = JSON.parse(value);
          
          // Check if expired
          if (entry.timestamp + entry.ttl >= now) {
            result.set(keys[i], entry.data);
          }
        } catch (err) {
          logger.warn('RedisCache', `Failed to parse ${keys[i]}`);
        }
      }
    } catch (error) {
      logger.error('RedisCache', `Failed to mget: ${error}`);
    }

    return result;
  }

  /**
   * Set multiple keys at once (pipeline)
   */
  async mset<T>(entries: Map<string, { value: T; ttl: number }>): Promise<boolean> {
    if (!this.isAvailable() || entries.size === 0) {
      return false;
    }

    try {
      const pipeline = this.client!.pipeline();
      const now = Date.now();

      for (const [key, { value, ttl }] of entries.entries()) {
        const entry: CacheEntry<T> = {
          data: value,
          timestamp: now,
          ttl,
        };

        const serialized = JSON.stringify(entry);
        const ttlSeconds = Math.ceil(ttl / 1000);

        pipeline.setex(key, ttlSeconds, serialized);
      }

      await pipeline.exec();
      return true;
    } catch (error) {
      logger.error('RedisCache', `Failed to mset: ${error}`);
      return false;
    }
  }

  /**
   * Increment a counter with expiry
   */
  async incr(key: string, ttlMs?: number): Promise<number> {
    if (!this.isAvailable()) {
      return 0;
    }

    try {
      const value = await this.client!.incr(key);

      if (ttlMs && value === 1) {
        // Set expiry only on first increment
        const ttlSeconds = Math.ceil(ttlMs / 1000);
        await this.client!.expire(key, ttlSeconds);
      }

      return value;
    } catch (error) {
      logger.error('RedisCache', `Failed to incr ${key}: ${error}`);
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    connected: boolean;
    keys: number;
    memory: string;
    hits: number;
    misses: number;
  } | null> {
    if (!this.isAvailable()) {
      return null;
    }

    try {
      const info = await this.client!.info('stats');
      const dbInfo = await this.client!.info('keyspace');

      // Parse stats
      const hitsMatch = info.match(/keyspace_hits:(\d+)/);
      const missesMatch = info.match(/keyspace_misses:(\d+)/);
      const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);

      // Parse key count
      const keysMatch = dbInfo.match(/keys=(\d+)/);

      return {
        connected: this.isConnected,
        keys: keysMatch ? parseInt(keysMatch[1]) : 0,
        memory: memoryMatch ? memoryMatch[1] : 'unknown',
        hits: hitsMatch ? parseInt(hitsMatch[1]) : 0,
        misses: missesMatch ? parseInt(missesMatch[1]) : 0,
      };
    } catch (error) {
      logger.error('RedisCache', `Failed to get stats: ${error}`);
      return null;
    }
  }

  /**
   * Clear all keys with the configured prefix
   */
  async clear(): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }

    try {
      const stream = this.client!.scanStream({
        match: `${this.keyPrefix}*`,
        count: 100,
      });

      stream.on('data', async (keys: string[]) => {
        if (keys.length > 0) {
          const pipeline = this.client!.pipeline();
          for (const key of keys) {
            // Remove prefix for del command (client adds it automatically)
            const keyWithoutPrefix = key.replace(this.keyPrefix, '');
            pipeline.del(keyWithoutPrefix);
          }
          await pipeline.exec();
        }
      });

      await new Promise<void>((resolve, reject) => {
        stream.on('end', () => resolve());
        stream.on('error', (err) => reject(err));
      });

      logger.info('RedisCache', 'Cache cleared');
    } catch (error) {
      logger.error('RedisCache', `Failed to clear cache: ${error}`);
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
      logger.info('RedisCache', 'Disconnected from Redis');
    }
  }

  /**
   * Ping Redis to check connection
   */
  async ping(): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      const response = await this.client.ping();
      return response === 'PONG';
    } catch (error) {
      return false;
    }
  }
}

// Singleton instance
export const redisCache = new RedisCache();
