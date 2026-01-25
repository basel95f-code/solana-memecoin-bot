/**
 * Alert Batcher
 * Consolidates multiple similar alerts into summary batches
 * Reduces notification spam for non-critical alerts
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import type { Alert, AlertBatch, BatchConfig, AlertType, AlertPriority } from './types';

interface BatchBuffer {
  type: AlertType;
  alerts: Alert[];
  timer: NodeJS.Timeout;
  createdAt: number;
}

export class AlertBatcher {
  private buffers: Map<AlertType, BatchBuffer> = new Map();
  private config: BatchConfig;
  private onBatchReady: (batch: AlertBatch) => void;

  constructor(config: Partial<BatchConfig>, onBatchReady: (batch: AlertBatch) => void) {
    this.config = {
      enabled: config.enabled ?? true,
      windowMs: config.windowMs ?? 30 * 1000, // 30 seconds default
      maxSize: config.maxSize ?? 10,
      minSize: config.minSize ?? 2,
      types: config.types ?? [
        'new_token',
        'volume_spike',
        'price_alert',
        'wallet_activity',
      ],
    };
    this.onBatchReady = onBatchReady;
  }

  /**
   * Add alert to batch buffer or return immediately
   */
  add(alert: Alert): { batched: boolean; batchId?: string } {
    // Don't batch if disabled
    if (!this.config.enabled) {
      return { batched: false };
    }

    // Don't batch critical alerts
    if (alert.priority === 'critical') {
      return { batched: false };
    }

    // Don't batch if type not in batch list
    if (!this.config.types.includes(alert.type)) {
      return { batched: false };
    }

    // Get or create buffer for this type
    let buffer = this.buffers.get(alert.type);

    if (!buffer) {
      buffer = this.createBuffer(alert.type);
      this.buffers.set(alert.type, buffer);
    }

    // Add to buffer
    buffer.alerts.push(alert);

    logger.debug('AlertBatcher', `Added ${alert.type} to batch (${buffer.alerts.length}/${this.config.maxSize})`);

    // Check if we should flush immediately
    if (buffer.alerts.length >= this.config.maxSize) {
      this.flushBuffer(alert.type);
    }

    return { batched: true };
  }

  /**
   * Create new batch buffer
   */
  private createBuffer(type: AlertType): BatchBuffer {
    const timer = setTimeout(() => {
      this.flushBuffer(type);
    }, this.config.windowMs);

    return {
      type,
      alerts: [],
      timer,
      createdAt: Date.now(),
    };
  }

  /**
   * Flush buffer and create batch
   */
  private flushBuffer(type: AlertType): void {
    const buffer = this.buffers.get(type);
    if (!buffer) return;

    // Clear timer
    clearTimeout(buffer.timer);
    this.buffers.delete(type);

    // Check if we have enough alerts
    if (buffer.alerts.length < this.config.minSize) {
      // Not enough alerts - send individually
      logger.debug('AlertBatcher', `Buffer for ${type} has ${buffer.alerts.length} alerts (min: ${this.config.minSize}), sending individually`);
      return;
    }

    // Create batch
    const batch = this.createBatch(buffer);
    
    logger.info('AlertBatcher', `Flushed batch for ${type}: ${buffer.alerts.length} alerts`);
    
    // Send batch
    this.onBatchReady(batch);
  }

  /**
   * Create batch from buffer
   */
  private createBatch(buffer: BatchBuffer): AlertBatch {
    const alerts = buffer.alerts;
    const type = buffer.type;
    
    // Determine priority (highest in batch)
    const priority = this.getHighestPriority(alerts);

    // Generate summary
    const summary = this.generateSummary(type, alerts);

    return {
      id: uuidv4(),
      type,
      priority,
      alerts,
      summary,
      timestamp: Date.now(),
    };
  }

  /**
   * Get highest priority from alerts
   */
  private getHighestPriority(alerts: Alert[]): AlertPriority {
    const priorities: AlertPriority[] = ['low', 'normal', 'high', 'critical'];
    const maxPriorityIndex = Math.max(
      ...alerts.map(a => priorities.indexOf(a.priority))
    );
    return priorities[maxPriorityIndex];
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(type: AlertType, alerts: Alert[]): string {
    const count = alerts.length;

    switch (type) {
      case 'new_token':
        return `${count} new tokens discovered`;

      case 'volume_spike':
        return `${count} volume spikes detected`;

      case 'price_alert':
        return `${count} price alerts triggered`;

      case 'wallet_activity':
        return `${count} tracked wallet activities`;

      case 'whale_movement':
        return `${count} whale movements detected`;

      case 'smart_money':
        return `${count} smart money activities`;

      default:
        return `${count} ${type.replace('_', ' ')} alerts`;
    }
  }

  /**
   * Flush all buffers immediately
   */
  flushAll(): void {
    const types = Array.from(this.buffers.keys());
    logger.info('AlertBatcher', `Flushing all buffers (${types.length})`);
    
    for (const type of types) {
      this.flushBuffer(type);
    }
  }

  /**
   * Flush specific alert type
   */
  flush(type: AlertType): void {
    this.flushBuffer(type);
  }

  /**
   * Get batch statistics
   */
  getStats() {
    const bufferStats: Record<string, number> = {};
    
    for (const [type, buffer] of this.buffers.entries()) {
      bufferStats[type] = buffer.alerts.length;
    }

    return {
      activeBuffers: this.buffers.size,
      bufferStats,
      config: this.config,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BatchConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('AlertBatcher', `Config updated: ${JSON.stringify(this.config)}`);
  }

  /**
   * Stop batcher and flush all buffers
   */
  stop(): void {
    logger.info('AlertBatcher', 'Stopping and flushing all buffers');
    this.flushAll();
  }
}
