import { logger } from '../utils/logger';

export interface LRUEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  size: number; // Estimated size in bytes
}

export interface LRUNode<T> {
  key: string;
  entry: LRUEntry<T>;
  prev: LRUNode<T> | null;
  next: LRUNode<T> | null;
}

export interface LRUConfig {
  maxSize?: number; // Maximum number of items
  maxMemoryMB?: number; // Maximum memory in MB
  onEvict?: (key: string, entry: LRUEntry<any>) => void;
}

/**
 * In-memory LRU cache with TTL and memory limits
 * Fallback when Redis is unavailable
 */
export class LRUCache {
  private cache: Map<string, LRUNode<any>> = new Map();
  private head: LRUNode<any> | null = null;
  private tail: LRUNode<any> | null = null;
  private currentMemoryBytes = 0;
  private readonly maxSize: number;
  private readonly maxMemoryBytes: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private onEvict?: (key: string, entry: LRUEntry<any>) => void;

  constructor(config: LRUConfig = {}) {
    this.maxSize = config.maxSize || 10000;
    this.maxMemoryBytes = (config.maxMemoryMB || 100) * 1024 * 1024;
    this.onEvict = config.onEvict;
  }

  /**
   * Get value from cache
   */
  get<T>(key: string): T | null {
    const node = this.cache.get(key);

    if (!node) {
      this.misses++;
      return null;
    }

    // Check if expired
    const now = Date.now();
    if (node.entry.timestamp + node.entry.ttl < now) {
      this.delete(key);
      this.misses++;
      return null;
    }

    // Move to front (most recently used)
    this.moveToFront(node);
    this.hits++;

    return node.entry.data as T;
  }

  /**
   * Set value in cache with TTL (milliseconds)
   */
  set<T>(key: string, value: T, ttlMs: number): boolean {
    try {
      // Estimate size
      const size = this.estimateSize(value);

      // Check if this single item exceeds max memory
      if (size > this.maxMemoryBytes) {
        logger.warn('LRUCache', `Item ${key} size (${this.formatBytes(size)}) exceeds max memory`);
        return false;
      }

      // If key exists, update it
      const existing = this.cache.get(key);
      if (existing) {
        this.currentMemoryBytes -= existing.entry.size;
        existing.entry = {
          data: value,
          timestamp: Date.now(),
          ttl: ttlMs,
          size,
        };
        this.currentMemoryBytes += size;
        this.moveToFront(existing);
        return true;
      }

      // Evict if necessary
      while (
        (this.cache.size >= this.maxSize || this.currentMemoryBytes + size > this.maxMemoryBytes) &&
        this.tail
      ) {
        this.evictLRU();
      }

      // Create new node
      const entry: LRUEntry<T> = {
        data: value,
        timestamp: Date.now(),
        ttl: ttlMs,
        size,
      };

      const node: LRUNode<T> = {
        key,
        entry,
        prev: null,
        next: this.head,
      };

      // Add to cache
      this.cache.set(key, node);
      this.currentMemoryBytes += size;

      // Update linked list
      if (this.head) {
        this.head.prev = node;
      }
      this.head = node;

      if (!this.tail) {
        this.tail = node;
      }

      return true;
    } catch (error) {
      logger.error('LRUCache', `Failed to set ${key}: ${error}`);
      return false;
    }
  }

  /**
   * Delete key from cache
   */
  delete(key: string): boolean {
    const node = this.cache.get(key);
    if (!node) {
      return false;
    }

    this.removeNode(node);
    this.cache.delete(key);
    this.currentMemoryBytes -= node.entry.size;

    return true;
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const node = this.cache.get(key);
    if (!node) {
      return false;
    }

    // Check if expired
    const now = Date.now();
    if (node.entry.timestamp + node.entry.ttl < now) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Get multiple keys at once
   */
  mget<T>(keys: string[]): Map<string, T> {
    const result = new Map<string, T>();

    for (const key of keys) {
      const value = this.get<T>(key);
      if (value !== null) {
        result.set(key, value);
      }
    }

    return result;
  }

  /**
   * Set multiple keys at once
   */
  mset<T>(entries: Map<string, { value: T; ttl: number }>): boolean {
    let success = true;

    for (const [key, { value, ttl }] of entries.entries()) {
      if (!this.set(key, value, ttl)) {
        success = false;
      }
    }

    return success;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
    this.currentMemoryBytes = 0;
    logger.info('LRUCache', 'Cache cleared');
  }

  /**
   * Remove expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    // Iterate from tail (least recently used) to head
    let current = this.tail;
    while (current) {
      const next = current.prev; // Save next before potential removal

      if (current.entry.timestamp + current.entry.ttl < now) {
        this.delete(current.key);
        removed++;
      }

      current = next;
    }

    if (removed > 0) {
      logger.info('LRUCache', `Cleaned up ${removed} expired entries`);
    }

    return removed;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    memoryUsed: string;
    maxMemory: string;
    hitRate: number;
    hits: number;
    misses: number;
    evictions: number;
  } {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? (this.hits / totalRequests) * 100 : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      memoryUsed: this.formatBytes(this.currentMemoryBytes),
      maxMemory: this.formatBytes(this.maxMemoryBytes),
      hitRate: Math.round(hitRate * 100) / 100,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  // ============================================
  // Private Methods
  // ============================================

  private moveToFront(node: LRUNode<any>): void {
    if (node === this.head) {
      return;
    }

    // Remove from current position
    this.removeNode(node);

    // Move to front
    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }

    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: LRUNode<any>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  private evictLRU(): void {
    if (!this.tail) {
      return;
    }

    const evicted = this.tail;

    // Call eviction callback
    if (this.onEvict) {
      try {
        this.onEvict(evicted.key, evicted.entry);
      } catch (error) {
        logger.error('LRUCache', `Eviction callback failed: ${error}`);
      }
    }

    this.delete(evicted.key);
    this.evictions++;
  }

  private estimateSize(value: any): number {
    try {
      const json = JSON.stringify(value);
      // Rough estimate: UTF-16 encoding = 2 bytes per char + overhead
      return json.length * 2 + 100; // 100 bytes overhead per entry
    } catch (error) {
      // Fallback estimate
      return 1000;
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
}

// Singleton instance
export const lruCache = new LRUCache({
  maxSize: 10000,
  maxMemoryMB: 100,
  onEvict: (key) => {
    logger.debug('LRUCache', `Evicted ${key}`);
  },
});
