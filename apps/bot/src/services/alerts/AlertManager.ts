/**
 * Alert Manager
 * Main orchestrator for the multi-channel alert system
 * Coordinates deduplication, batching, routing, and delivery
 */

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { AlertDeduplicator } from './AlertDeduplicator';
import { AlertBatcher } from './AlertBatcher';
import { AlertRouter } from './AlertRouter';
import type {
  Alert,
  AlertBatch,
  AlertManagerConfig,
  AlertStats,
  AlertEvent,
  IAlertChannel,
  ChannelConfig,
} from './types';

export class AlertManager extends EventEmitter {
  private deduplicator: AlertDeduplicator;
  private batcher: AlertBatcher;
  private router: AlertRouter;
  private channels: Map<string, IAlertChannel> = new Map();
  private config: AlertManagerConfig;

  // Statistics
  private stats = {
    totalAlerts: 0,
    deduplicated: 0,
    batched: 0,
    sent: 0,
    failed: 0,
    pending: 0,
  };

  constructor(config: Partial<AlertManagerConfig> = {}) {
    super();

    this.config = {
      dedup: config.dedup || {
        enabled: true,
        windowMs: 5 * 60 * 1000,
        algorithm: 'hash',
      },
      batch: config.batch || {
        enabled: true,
        windowMs: 30 * 1000,
        maxSize: 10,
        minSize: 2,
        types: ['new_token', 'volume_spike', 'price_alert', 'wallet_activity'],
      },
      retryConfig: config.retryConfig || {
        enabled: true,
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      },
      defaultChannels: config.defaultChannels || [],
    };

    // Initialize components
    this.deduplicator = new AlertDeduplicator(this.config.dedup);
    this.batcher = new AlertBatcher(this.config.batch, (batch) => this.handleBatch(batch));
    this.router = new AlertRouter();

    logger.info('AlertManager', 'Initialized with config:', this.config);
  }

  /**
   * Send an alert through the system
   */
  async sendAlert(alert: Partial<Alert>): Promise<void> {
    // Generate ID if not provided
    const fullAlert: Alert = {
      id: alert.id || uuidv4(),
      type: alert.type!,
      priority: alert.priority || 'normal',
      title: alert.title!,
      message: alert.message!,
      data: alert.data || {},
      timestamp: alert.timestamp || Date.now(),
      dedupKey: alert.dedupKey,
      userId: alert.userId,
      chatId: alert.chatId,
    };

    this.stats.totalAlerts++;

    logger.debug('AlertManager', `Processing alert ${fullAlert.id}: ${fullAlert.type}`);

    // Step 1: Check for duplicates
    const dedupResult = this.deduplicator.check(fullAlert);
    if (dedupResult.isDuplicate) {
      this.stats.deduplicated++;
      this.emitEvent({
        type: 'deduplicated',
        alertId: fullAlert.id,
        timestamp: Date.now(),
        data: dedupResult,
      });
      logger.debug('AlertManager', `Alert ${fullAlert.id} is duplicate, skipping`);
      return;
    }

    // Step 2: Try to batch (if applicable)
    const batchResult = this.batcher.add(fullAlert);
    if (batchResult.batched) {
      this.stats.batched++;
      this.emitEvent({
        type: 'batched',
        alertId: fullAlert.id,
        timestamp: Date.now(),
        data: { batchId: batchResult.batchId },
      });
      logger.debug('AlertManager', `Alert ${fullAlert.id} added to batch`);
      return;
    }

    // Step 3: Route and deliver immediately
    await this.deliverAlert(fullAlert);
  }

  /**
   * Handle batch ready for delivery
   */
  private async handleBatch(batch: AlertBatch): Promise<void> {
    logger.info('AlertManager', `Delivering batch ${batch.id} with ${batch.alerts.length} alerts`);

    // Route batch
    const routing = this.router.routeBatch(batch);

    if (!routing.shouldRoute || routing.channelIds.length === 0) {
      logger.warn('AlertManager', `No channels available for batch ${batch.id}`);
      return;
    }

    // Deliver to each channel
    const deliveries = routing.channelIds.map(channelId =>
      this.deliverToChannel(batch.id, channelId, batch)
    );

    await Promise.allSettled(deliveries);
  }

  /**
   * Deliver single alert
   */
  private async deliverAlert(alert: Alert): Promise<void> {
    // Route alert
    const routing = this.router.route(alert);

    if (!routing.shouldRoute || routing.channelIds.length === 0) {
      logger.warn('AlertManager', `No channels available for alert ${alert.id}: ${routing.reason || 'unknown'}`);
      return;
    }

    logger.debug('AlertManager', `Routing alert ${alert.id} to ${routing.channelIds.length} channels`);

    // Deliver to each channel
    const deliveries = routing.channelIds.map(channelId =>
      this.deliverToChannel(alert.id, channelId, alert)
    );

    await Promise.allSettled(deliveries);
  }

  /**
   * Deliver to specific channel
   */
  private async deliverToChannel(
    alertId: string,
    channelId: string,
    payload: Alert | AlertBatch
  ): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      logger.error('AlertManager', `Channel ${channelId} not found`);
      return;
    }

    try {
      this.stats.pending++;

      const result = 'alerts' in payload
        ? await channel.sendBatch(payload)
        : await channel.send(payload);

      if (result.success) {
        this.stats.sent++;
        this.stats.pending--;
        this.emitEvent({
          type: 'sent',
          alertId,
          channelId,
          timestamp: Date.now(),
          data: result,
        });
        logger.info('AlertManager', `Alert ${alertId} delivered to ${channel.name}`);
      } else {
        this.stats.failed++;
        this.stats.pending--;
        this.emitEvent({
          type: 'failed',
          alertId,
          channelId,
          timestamp: Date.now(),
          data: result,
        });
        logger.error('AlertManager', `Alert ${alertId} failed on ${channel.name}: ${result.error}`);
      }
    } catch (error: any) {
      this.stats.failed++;
      this.stats.pending--;
      logger.error('AlertManager', `Delivery error for ${alertId} on ${channelId}:`, error);
      this.emitEvent({
        type: 'failed',
        alertId,
        channelId,
        timestamp: Date.now(),
        data: { error: error.message },
      });
    }
  }

  /**
   * Register a channel
   */
  registerChannel(channel: IAlertChannel, config?: ChannelConfig): void {
    this.channels.set(channel.id, channel);

    if (config) {
      this.router.registerChannel(config);
    }

    logger.info('AlertManager', `Registered channel: ${channel.name} (${channel.type})`);
  }

  /**
   * Unregister a channel
   */
  unregisterChannel(channelId: string): void {
    this.channels.delete(channelId);
    this.router.unregisterChannel(channelId);
    logger.info('AlertManager', `Unregistered channel: ${channelId}`);
  }

  /**
   * Get channel by ID
   */
  getChannel(channelId: string): IAlertChannel | undefined {
    return this.channels.get(channelId);
  }

  /**
   * Get all channels
   */
  getAllChannels(): IAlertChannel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Get statistics
   */
  getStats(): AlertStats {
    return {
      ...this.stats,
      byType: {} as any,
      byPriority: {} as any,
      byChannel: {} as any,
    };
  }

  /**
   * Emit event
   */
  private emitEvent(event: AlertEvent): void {
    this.emit('alert_event', event);
    this.emit(event.type, event);
  }

  /**
   * Flush all batches immediately
   */
  flushBatches(): void {
    logger.info('AlertManager', 'Flushing all batches');
    this.batcher.flushAll();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AlertManagerConfig>): void {
    if (config.dedup) {
      this.deduplicator.updateConfig(config.dedup);
    }
    if (config.batch) {
      this.batcher.updateConfig(config.batch);
    }
    this.config = { ...this.config, ...config };
    logger.info('AlertManager', 'Configuration updated');
  }

  /**
   * Stop alert manager
   */
  stop(): void {
    logger.info('AlertManager', 'Stopping AlertManager');
    this.batcher.stop();
    this.deduplicator.stop();
    this.channels.clear();
  }
}
