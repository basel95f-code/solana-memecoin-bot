/**
 * Base Alert Channel
 * Abstract base class for all channel implementations
 */

import { v4 as uuidv4 } from 'uuid';
import type { Alert, AlertBatch, DeliveryResult, IAlertChannel, ChannelType } from '../types';

export abstract class BaseChannel implements IAlertChannel {
  public readonly id: string;
  public readonly type: ChannelType;
  public readonly name: string;

  protected retryCount: number = 0;
  protected maxRetries: number = 3;

  constructor(id: string, type: ChannelType, name: string) {
    this.id = id;
    this.type = type;
    this.name = name;
  }

  /**
   * Send single alert (must be implemented by subclasses)
   */
  abstract send(alert: Alert): Promise<DeliveryResult>;

  /**
   * Send batch alert (can be overridden by subclasses)
   */
  async sendBatch(batch: AlertBatch): Promise<DeliveryResult> {
    // Default implementation: format batch and send as single alert
    const formattedAlert = this.formatBatchAsAlert(batch);
    return this.send(formattedAlert);
  }

  /**
   * Health check (can be overridden by subclasses)
   */
  async healthCheck(): Promise<boolean> {
    return true; // Default: assume healthy
  }

  /**
   * Format batch as single alert
   */
  protected formatBatchAsAlert(batch: AlertBatch): Alert {
    return {
      id: batch.id,
      type: batch.type,
      priority: batch.priority,
      title: batch.summary,
      message: this.formatBatchMessage(batch),
      data: { isBatch: true, alertCount: batch.alerts.length },
      timestamp: batch.timestamp,
    };
  }

  /**
   * Format batch message (can be overridden)
   */
  protected formatBatchMessage(batch: AlertBatch): string {
    const lines = [batch.summary, ''];
    
    for (const alert of batch.alerts.slice(0, 5)) {
      lines.push(`• ${alert.title}`);
    }

    if (batch.alerts.length > 5) {
      lines.push(`... and ${batch.alerts.length - 5} more`);
    }

    return lines.join('\n');
  }

  /**
   * Create success result
   */
  protected createSuccessResult(deliveryId?: string): DeliveryResult {
    return {
      deliveryId: deliveryId || uuidv4(),
      channelId: this.id,
      channelType: this.type,
      success: true,
      retryCount: this.retryCount,
      timestamp: Date.now(),
    };
  }

  /**
   * Create failure result
   */
  protected createFailureResult(error: string, deliveryId?: string): DeliveryResult {
    return {
      deliveryId: deliveryId || uuidv4(),
      channelId: this.id,
      channelType: this.type,
      success: false,
      error,
      retryCount: this.retryCount,
      timestamp: Date.now(),
    };
  }
}
