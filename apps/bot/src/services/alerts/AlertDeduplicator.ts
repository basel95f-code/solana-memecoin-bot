/**
 * Alert Deduplicator
 * Prevents duplicate alerts from spamming users
 * Uses content hashing with configurable time windows
 */

import crypto from 'crypto';
import { logger } from '../../utils/logger';
import type { Alert, DedupConfig, DedupResult } from './types';

interface DedupEntry {
  alertId: string;
  hash: string;
  timestamp: number;
  content: string;
}

export class AlertDeduplicator {
  private cache: Map<string, DedupEntry> = new Map();
  private config: DedupConfig;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<DedupConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      windowMs: config.windowMs ?? 5 * 60 * 1000, // 5 minutes default
      algorithm: config.algorithm ?? 'hash',
    };

    // Start cleanup task
    this.startCleanup();
  }

  /**
   * Check if alert is a duplicate
   */
  check(alert: Alert): DedupResult {
    if (!this.config.enabled) {
      return { isDuplicate: false };
    }

    const hash = this.generateHash(alert);
    const now = Date.now();
    const existing = this.cache.get(hash);

    if (existing && now - existing.timestamp < this.config.windowMs) {
      logger.debug('AlertDeduplicator', `Duplicate detected: ${alert.type} (original: ${existing.alertId})`);
      
      return {
        isDuplicate: true,
        originalAlertId: existing.alertId,
        similarity: 1.0,
        reason: `Duplicate of alert ${existing.alertId} from ${Math.floor((now - existing.timestamp) / 1000)}s ago`,
      };
    }

    // Not a duplicate - store it
    this.cache.set(hash, {
      alertId: alert.id,
      hash,
      timestamp: now,
      content: this.getContentForHash(alert),
    });

    return { isDuplicate: false };
  }

  /**
   * Generate hash for alert based on algorithm
   */
  private generateHash(alert: Alert): string {
    const content = this.getContentForHash(alert);

    switch (this.config.algorithm) {
      case 'exact':
        // Exact match on all fields
        return this.hashString(JSON.stringify(alert));

      case 'hash':
        // Hash based on type + key content
        return this.hashString(content);

      case 'fuzzy':
        // Fuzzy matching (normalize content)
        return this.hashString(this.normalizeContent(content));

      default:
        return this.hashString(content);
    }
  }

  /**
   * Get content to use for hashing
   */
  private getContentForHash(alert: Alert): string {
    // Use custom dedupKey if provided
    if (alert.dedupKey) {
      return alert.dedupKey;
    }

    // Otherwise build key from type + important data
    const parts = [alert.type];

    // Add data-specific keys based on alert type
    switch (alert.type) {
      case 'new_token':
      case 'trading_signal':
      case 'rug_detected':
        parts.push(alert.data.mint || alert.data.tokenAddress || '');
        break;

      case 'whale_movement':
      case 'wallet_activity':
        parts.push(alert.data.wallet || '');
        parts.push(alert.data.tokenMint || '');
        break;

      case 'price_alert':
        parts.push(alert.data.symbol || '');
        parts.push(alert.data.trigger || '');
        break;

      case 'volume_spike':
      case 'liquidity_drain':
        parts.push(alert.data.mint || '');
        parts.push(alert.data.changePercent?.toString() || '');
        break;

      default:
        // For unknown types, use title + truncated message
        parts.push(alert.title);
        parts.push(alert.message.substring(0, 100));
    }

    return parts.filter(Boolean).join('|');
  }

  /**
   * Normalize content for fuzzy matching
   */
  private normalizeContent(content: string): string {
    return content
      .toLowerCase()
      .replace(/[^\w\s|]/g, '') // Remove special chars
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Hash a string using SHA256
   */
  private hashString(str: string): string {
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  /**
   * Clear expired entries from cache
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [hash, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= this.config.windowMs) {
        this.cache.delete(hash);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('AlertDeduplicator', `Cleaned up ${removed} expired entries`);
    }
  }

  /**
   * Start periodic cleanup task
   */
  private startCleanup(): void {
    if (this.cleanupInterval) return;

    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }

  /**
   * Stop cleanup task
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      windowMs: this.config.windowMs,
      algorithm: this.config.algorithm,
      enabled: this.config.enabled,
    };
  }

  /**
   * Clear cache manually
   */
  clear(): void {
    this.cache.clear();
    logger.info('AlertDeduplicator', 'Cache cleared manually');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<DedupConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('AlertDeduplicator', `Config updated: ${JSON.stringify(this.config)}`);
  }
}
