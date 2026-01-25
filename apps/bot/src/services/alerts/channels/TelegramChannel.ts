/**
 * Telegram Alert Channel
 * Sends alerts via Telegram bot
 */

import { Telegraf } from 'telegraf';
import { logger } from '../../../utils/logger';
import { BaseChannel } from './BaseChannel';
import type { Alert, AlertBatch, DeliveryResult, TelegramConfig, ChannelType } from '../types';

export class TelegramChannel extends BaseChannel {
  private bot: Telegraf;
  private config: TelegramConfig;

  constructor(id: string, name: string, config: TelegramConfig, bot: Telegraf) {
    super(id, 'telegram' as ChannelType, name);
    this.config = config;
    this.bot = bot;
  }

  /**
   * Send alert to Telegram
   */
  async send(alert: Alert): Promise<DeliveryResult> {
    try {
      const message = this.formatAlert(alert);
      const options = this.getMessageOptions(alert);

      await this.bot.telegram.sendMessage(
        this.config.chatId,
        message,
        options
      );

      logger.info('TelegramChannel', `Sent alert ${alert.id} to chat ${this.config.chatId}`);
      
      return this.createSuccessResult(alert.id);
    } catch (error: any) {
      logger.error('TelegramChannel', `Failed to send alert ${alert.id}:`, error);
      return this.createFailureResult(error.message, alert.id);
    }
  }

  /**
   * Send batch to Telegram
   */
  async sendBatch(batch: AlertBatch): Promise<DeliveryResult> {
    try {
      const message = this.formatBatch(batch);
      const options = this.getBatchMessageOptions(batch);

      await this.bot.telegram.sendMessage(
        this.config.chatId,
        message,
        options
      );

      logger.info('TelegramChannel', `Sent batch ${batch.id} with ${batch.alerts.length} alerts`);
      
      return this.createSuccessResult(batch.id);
    } catch (error: any) {
      logger.error('TelegramChannel', `Failed to send batch ${batch.id}:`, error);
      return this.createFailureResult(error.message, batch.id);
    }
  }

  /**
   * Format single alert for Telegram
   */
  private formatAlert(alert: Alert): string {
    const emoji = this.getEmojiForType(alert.type);
    const priorityTag = this.getPriorityTag(alert.priority);
    
    let message = `${emoji} <b>${alert.title}</b> ${priorityTag}\n\n`;
    message += alert.message;

    // Add relevant data fields
    if (Object.keys(alert.data).length > 0) {
      message += '\n\n';
      message += this.formatDataFields(alert.data);
    }

    return message;
  }

  /**
   * Format batch for Telegram
   */
  private formatBatch(batch: AlertBatch): string {
    const emoji = this.getEmojiForType(batch.type);
    const priorityTag = this.getPriorityTag(batch.priority);

    let message = `${emoji} <b>${batch.summary}</b> ${priorityTag}\n\n`;

    // List alerts (show first 5)
    for (const alert of batch.alerts.slice(0, 5)) {
      message += `• ${alert.title}\n`;
    }

    if (batch.alerts.length > 5) {
      message += `\n<i>... and ${batch.alerts.length - 5} more</i>`;
    }

    return message;
  }

  /**
   * Get emoji for alert type
   */
  private getEmojiForType(type: string): string {
    const emojiMap: Record<string, string> = {
      new_token: '✨',
      volume_spike: '📊',
      whale_movement: '🐋',
      liquidity_drain: '💧',
      authority_change: '🔐',
      price_alert: '💰',
      smart_money: '🧠',
      wallet_activity: '👛',
      trading_signal: '📡',
      rug_detected: '🚨',
      system: 'ℹ️',
    };

    return emojiMap[type] || '🔔';
  }

  /**
   * Get priority tag
   */
  private getPriorityTag(priority: string): string {
    switch (priority) {
      case 'critical':
        return '🔴 <b>CRITICAL</b>';
      case 'high':
        return '🟠 <b>HIGH</b>';
      case 'normal':
        return '🟡';
      case 'low':
        return '🟢';
      default:
        return '';
    }
  }

  /**
   * Format data fields for display
   */
  private formatDataFields(data: Record<string, any>): string {
    const lines: string[] = [];

    // Common fields
    if (data.mint) lines.push(`<code>${data.mint}</code>`);
    if (data.symbol) lines.push(`Symbol: <b>${data.symbol}</b>`);
    if (data.price) lines.push(`Price: $${data.price}`);
    if (data.liquidity) lines.push(`Liquidity: $${data.liquidity.toLocaleString()}`);
    if (data.volume) lines.push(`Volume: $${data.volume.toLocaleString()}`);

    return lines.join('\n');
  }

  /**
   * Get message options for alert
   */
  private getMessageOptions(alert: Alert): any {
    const options: any = {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };

    // Use thread if configured
    if (this.config.threadId) {
      options.message_thread_id = parseInt(this.config.threadId);
    }

    return options;
  }

  /**
   * Get message options for batch
   */
  private getBatchMessageOptions(batch: AlertBatch): any {
    return this.getMessageOptions(this.formatBatchAsAlert(batch));
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.bot.telegram.getMe();
      return true;
    } catch (error) {
      logger.error('TelegramChannel', 'Health check failed:', error);
      return false;
    }
  }
}
