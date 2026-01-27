/**
 * Delivery Manager
 * Tracks alert delivery status and handles retry logic with exponential backoff
 * Maintains in-memory delivery records and statistics
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import type { DeliveryRecord, RetryConfig } from './types';
import { DeliveryStatus } from './types';

export interface DeliveryStats {
  totalDeliveries: number;
  successful: number;
  failed: number;
  pending: number;
  retrying: number;
  successRate: number;
  avgDeliveryTimeMs: number;
  byChannel: Record<string, {
    total: number;
    successful: number;
    failed: number;
    avgDeliveryTimeMs: number;
  }>;
}

export interface DeliveryManagerEvents {
  'delivery:success': (record: DeliveryRecord) => void;
  'delivery:failure': (record: DeliveryRecord) => void;
  'delivery:retry': (record: DeliveryRecord) => void;
  'delivery:cancelled': (record: DeliveryRecord) => void;
}

export declare interface DeliveryManager {
  on<U extends keyof DeliveryManagerEvents>(
    event: U,
    listener: DeliveryManagerEvents[U]
  ): this;
  emit<U extends keyof DeliveryManagerEvents>(
    event: U,
    ...args: Parameters<DeliveryManagerEvents[U]>
  ): boolean;
}

export class DeliveryManager extends EventEmitter {
  private deliveries: Map<string, DeliveryRecord> = new Map();
  private config: RetryConfig;
  private deliveryTimes: number[] = []; // Track delivery times for stats
  private maxDeliveryTimeSamples = 1000; // Keep last 1000 samples

  constructor(config: Partial<RetryConfig> = {}) {
    super();
    
    this.config = {
      enabled: config.enabled ?? true,
      maxRetries: config.maxRetries ?? 3,
      initialDelayMs: config.initialDelayMs ?? 1000, // 1 second
      maxDelayMs: config.maxDelayMs ?? 30000, // 30 seconds
      backoffMultiplier: config.backoffMultiplier ?? 2,
    };

    logger.info('DeliveryManager', 'Initialized with config:', this.config);
  }

  /**
   * Create a new delivery record for an alert+channel combination
   */
  createDelivery(alertId: string, channelId: string): DeliveryRecord {
    const delivery: DeliveryRecord = {
      id: uuidv4(),
      alertId,
      channelId,
      status: DeliveryStatus.PENDING,
      retryCount: 0,
      sentAt: Date.now(),
    };

    this.deliveries.set(delivery.id, delivery);
    
    logger.debug('DeliveryManager', `Created delivery ${delivery.id} for alert ${alertId} -> channel ${channelId}`);
    
    return delivery;
  }

  /**
   * Record successful delivery
   */
  recordSuccess(deliveryId: string, timestamp: number = Date.now()): void {
    const delivery = this.deliveries.get(deliveryId);
    
    if (!delivery) {
      logger.warn('DeliveryManager', `Delivery ${deliveryId} not found for success record`);
      return;
    }

    // Calculate delivery time
    const deliveryTime = timestamp - delivery.sentAt!;
    this.trackDeliveryTime(deliveryTime);

    // Update delivery record
    delivery.status = DeliveryStatus.SENT;
    delivery.deliveredAt = timestamp;
    delivery.lastError = undefined;
    delivery.nextRetryAt = undefined;

    logger.info('DeliveryManager', `Delivery ${deliveryId} succeeded (${deliveryTime}ms, ${delivery.retryCount} retries)`);
    
    // Emit success event
    this.emit('delivery:success', delivery);
  }

  /**
   * Record failed delivery
   */
  recordFailure(deliveryId: string, error: string): void {
    const delivery = this.deliveries.get(deliveryId);
    
    if (!delivery) {
      logger.warn('DeliveryManager', `Delivery ${deliveryId} not found for failure record`);
      return;
    }

    delivery.lastError = error;
    delivery.retryCount++;

    // Check if we should retry
    if (this.config.enabled && delivery.retryCount <= this.config.maxRetries) {
      // Schedule retry
      const nextRetryAt = this.calculateNextRetry(delivery.retryCount);
      this.scheduleRetry(deliveryId, nextRetryAt);
      
      logger.warn('DeliveryManager', `Delivery ${deliveryId} failed (attempt ${delivery.retryCount}/${this.config.maxRetries}): ${error}`);
      
      // Emit retry event
      this.emit('delivery:retry', delivery);
    } else {
      // Max retries exceeded - mark as failed
      delivery.status = DeliveryStatus.FAILED;
      
      logger.error('DeliveryManager', `Delivery ${deliveryId} failed permanently after ${delivery.retryCount} attempts: ${error}`);
      
      // Emit failure event
      this.emit('delivery:failure', delivery);
    }
  }

  /**
   * Get deliveries that need to be retried
   */
  getDeliveriesForRetry(): DeliveryRecord[] {
    const now = Date.now();
    const retryableDeliveries: DeliveryRecord[] = [];

    for (const delivery of this.deliveries.values()) {
      if (
        delivery.status === 'retrying' &&
        delivery.nextRetryAt &&
        delivery.nextRetryAt <= now
      ) {
        retryableDeliveries.push(delivery);
      }
    }

    if (retryableDeliveries.length > 0) {
      logger.debug('DeliveryManager', `Found ${retryableDeliveries.length} deliveries ready for retry`);
    }

    return retryableDeliveries;
  }

  /**
   * Schedule a retry for a delivery
   */
  scheduleRetry(deliveryId: string, nextRetryAt: number): void {
    const delivery = this.deliveries.get(deliveryId);
    
    if (!delivery) {
      logger.warn('DeliveryManager', `Delivery ${deliveryId} not found for retry scheduling`);
      return;
    }

    delivery.status = 'retrying';
    delivery.nextRetryAt = nextRetryAt;

    const delaySeconds = Math.floor((nextRetryAt - Date.now()) / 1000);
    logger.debug('DeliveryManager', `Scheduled retry for ${deliveryId} in ${delaySeconds}s (attempt ${delivery.retryCount + 1})`);
  }

  /**
   * Calculate next retry timestamp using exponential backoff
   */
  private calculateNextRetry(retryCount: number): number {
    const delay = Math.min(
      this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, retryCount - 1),
      this.config.maxDelayMs
    );
    
    return Date.now() + delay;
  }

  /**
   * Track delivery time for statistics
   */
  private trackDeliveryTime(timeMs: number): void {
    this.deliveryTimes.push(timeMs);
    
    // Keep only recent samples
    if (this.deliveryTimes.length > this.maxDeliveryTimeSamples) {
      this.deliveryTimes.shift();
    }
  }

  /**
   * Calculate average delivery time
   */
  private calculateAvgDeliveryTime(): number {
    if (this.deliveryTimes.length === 0) return 0;
    
    const sum = this.deliveryTimes.reduce((acc, time) => acc + time, 0);
    return Math.round(sum / this.deliveryTimes.length);
  }

  /**
   * Get delivery statistics
   */
  getStats(): DeliveryStats {
    const stats: DeliveryStats = {
      totalDeliveries: this.deliveries.size,
      successful: 0,
      failed: 0,
      pending: 0,
      retrying: 0,
      successRate: 0,
      avgDeliveryTimeMs: this.calculateAvgDeliveryTime(),
      byChannel: {},
    };

    // Aggregate stats
    for (const delivery of this.deliveries.values()) {
      // Count by status
      switch (delivery.status) {
        case 'sent':
          stats.successful++;
          break;
        case 'failed':
          stats.failed++;
          break;
        case 'pending':
        case 'sending':
          stats.pending++;
          break;
        case 'retrying':
          stats.retrying++;
          break;
      }

      // Aggregate by channel
      if (!stats.byChannel[delivery.channelId]) {
        stats.byChannel[delivery.channelId] = {
          total: 0,
          successful: 0,
          failed: 0,
          avgDeliveryTimeMs: 0,
        };
      }

      const channelStats = stats.byChannel[delivery.channelId];
      channelStats.total++;

      if (delivery.status === 'sent') {
        channelStats.successful++;
        
        // Track delivery time for this channel
        if (delivery.sentAt && delivery.deliveredAt) {
          const deliveryTime = delivery.deliveredAt - delivery.sentAt;
          const currentAvg = channelStats.avgDeliveryTimeMs;
          const currentCount = channelStats.successful;
          
          // Running average
          channelStats.avgDeliveryTimeMs = Math.round(
            (currentAvg * (currentCount - 1) + deliveryTime) / currentCount
          );
        }
      } else if (delivery.status === 'failed') {
        channelStats.failed++;
      }
    }

    // Calculate overall success rate
    const completed = stats.successful + stats.failed;
    stats.successRate = completed > 0 ? stats.successful / completed : 0;

    return stats;
  }

  /**
   * Get a specific delivery record
   */
  getDelivery(deliveryId: string): DeliveryRecord | undefined {
    return this.deliveries.get(deliveryId);
  }

  /**
   * Get all deliveries for an alert
   */
  getDeliveriesForAlert(alertId: string): DeliveryRecord[] {
    return Array.from(this.deliveries.values()).filter(
      d => d.alertId === alertId
    );
  }

  /**
   * Get all deliveries for a channel
   */
  getDeliveriesForChannel(channelId: string): DeliveryRecord[] {
    return Array.from(this.deliveries.values()).filter(
      d => d.channelId === channelId
    );
  }

  /**
   * Manually trigger retry for a specific delivery
   */
  retryDelivery(deliveryId: string): boolean {
    const delivery = this.deliveries.get(deliveryId);
    
    if (!delivery) {
      logger.warn('DeliveryManager', `Delivery ${deliveryId} not found for manual retry`);
      return false;
    }

    if (delivery.status !== 'failed' && delivery.status !== 'retrying') {
      logger.warn('DeliveryManager', `Delivery ${deliveryId} cannot be retried (status: ${delivery.status})`);
      return false;
    }

    // Reset to pending and clear retry timestamp
    delivery.status = 'pending';
    delivery.nextRetryAt = undefined;
    
    logger.info('DeliveryManager', `Manual retry triggered for delivery ${deliveryId}`);
    
    return true;
  }

  /**
   * Cancel a delivery
   */
  cancelDelivery(deliveryId: string): boolean {
    const delivery = this.deliveries.get(deliveryId);
    
    if (!delivery) {
      logger.warn('DeliveryManager', `Delivery ${deliveryId} not found for cancellation`);
      return false;
    }

    if (delivery.status === 'sent') {
      logger.warn('DeliveryManager', `Delivery ${deliveryId} already sent, cannot cancel`);
      return false;
    }

    delivery.status = 'cancelled';
    delivery.nextRetryAt = undefined;
    
    logger.info('DeliveryManager', `Delivery ${deliveryId} cancelled`);
    
    // Emit cancelled event
    this.emit('delivery:cancelled', delivery);
    
    return true;
  }

  /**
   * Clean up old delivery records
   */
  cleanup(olderThanMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;

    for (const [id, delivery] of this.deliveries.entries()) {
      // Only remove completed deliveries (sent, failed, cancelled)
      if (
        (delivery.status === 'sent' || delivery.status === 'failed' || delivery.status === 'cancelled') &&
        (delivery.deliveredAt || delivery.sentAt || 0) < cutoff
      ) {
        this.deliveries.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info('DeliveryManager', `Cleaned up ${removed} old delivery records`);
    }

    return removed;
  }

  /**
   * Update retry configuration
   */
  updateConfig(config: Partial<RetryConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('DeliveryManager', `Config updated: ${JSON.stringify(this.config)}`);
  }

  /**
   * Get current configuration
   */
  getConfig(): RetryConfig {
    return { ...this.config };
  }

  /**
   * Clear all delivery records (use with caution)
   */
  clear(): void {
    const count = this.deliveries.size;
    this.deliveries.clear();
    this.deliveryTimes = [];
    logger.warn('DeliveryManager', `Cleared all ${count} delivery records`);
  }
}

