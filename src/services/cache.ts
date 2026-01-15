import { CachedToken, TokenAnalysis } from '../types';

interface CachedTokenWithAccess extends CachedToken {
  lastAccessed: number;
}

/**
 * Token cache with LRU eviction and size limits
 */
class TokenCache {
  private cache: Map<string, CachedTokenWithAccess> = new Map();
  private maxAge: number = 24 * 60 * 60 * 1000; // 24 hours
  private maxSize: number = 10000; // Maximum number of tokens to cache
  private evictionBatchSize: number = 100; // Number of items to evict at once

  has(mint: string): boolean {
    const cached = this.cache.get(mint);
    if (!cached) return false;

    // Check if cache is still valid
    const age = Date.now() - cached.firstSeen.getTime();
    if (age > this.maxAge) {
      this.cache.delete(mint);
      return false;
    }

    // Update last accessed time for LRU
    cached.lastAccessed = Date.now();
    return true;
  }

  get(mint: string): CachedToken | undefined {
    if (!this.has(mint)) return undefined;
    const cached = this.cache.get(mint);
    if (cached) {
      cached.lastAccessed = Date.now();
    }
    return cached;
  }

  add(mint: string): void {
    if (this.cache.has(mint)) return;

    // Check if we need to evict before adding
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(mint, {
      mint,
      firstSeen: new Date(),
      alertSent: false,
      lastAccessed: Date.now(),
    });
  }

  updateAnalysis(mint: string, analysis: TokenAnalysis): void {
    const cached = this.cache.get(mint);
    if (cached) {
      cached.lastAnalysis = analysis;
      cached.lastAccessed = Date.now();
    }
  }

  markAlertSent(mint: string): void {
    const cached = this.cache.get(mint);
    if (cached) {
      cached.alertSent = true;
      cached.lastAccessed = Date.now();
    }
  }

  wasAlertSent(mint: string): boolean {
    const cached = this.cache.get(mint);
    return cached?.alertSent || false;
  }

  getAll(): CachedToken[] {
    return Array.from(this.cache.values());
  }

  size(): number {
    return this.cache.size;
  }

  /**
   * Evict least recently used entries when cache is full
   */
  private evictLRU(): void {
    // Get all entries sorted by last accessed time (oldest first)
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

    // Evict the oldest entries
    const toEvict = entries.slice(0, this.evictionBatchSize);
    for (const [mint] of toEvict) {
      this.cache.delete(mint);
    }

    console.log(`Cache eviction: removed ${toEvict.length} LRU entries, size now ${this.cache.size}`);
  }

  /**
   * Cleanup expired entries
   */
  cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [mint, cached] of this.cache.entries()) {
      const age = now - cached.firstSeen.getTime();
      if (age > this.maxAge) {
        this.cache.delete(mint);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`Cache cleanup: removed ${removed} expired entries, size now ${this.cache.size}`);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): { total: number; alertsSent: number; averageAge: number; memoryUsage: string } {
    const tokens = this.getAll();
    const now = Date.now();

    const alertsSent = tokens.filter((t) => t.alertSent).length;
    const totalAge = tokens.reduce(
      (sum, t) => sum + (now - t.firstSeen.getTime()),
      0
    );
    const averageAge = tokens.length > 0 ? totalAge / tokens.length : 0;

    // Estimate memory usage
    const estimatedBytes = this.cache.size * 500; // ~500 bytes per entry estimate
    const memoryUsage = estimatedBytes > 1024 * 1024
      ? `${(estimatedBytes / 1024 / 1024).toFixed(2)} MB`
      : `${(estimatedBytes / 1024).toFixed(2)} KB`;

    return {
      total: tokens.length,
      alertsSent,
      averageAge: Math.round(averageAge / 1000 / 60), // in minutes
      memoryUsage,
    };
  }

  /**
   * Set maximum cache size
   */
  setMaxSize(size: number): void {
    this.maxSize = size;
    if (this.cache.size > size) {
      this.evictLRU();
    }
  }

  /**
   * Set maximum age for cache entries
   */
  setMaxAge(ageMs: number): void {
    this.maxAge = ageMs;
    this.cleanup();
  }
}

export const tokenCache = new TokenCache();
