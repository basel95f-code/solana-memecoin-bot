/**
 * Discord Alert Channel
 * Sends alerts via Discord webhooks
 */

import axios from 'axios';
import { logger } from '../../../utils/logger';
import { BaseChannel } from './BaseChannel';
import type { Alert, AlertBatch, DeliveryResult, DiscordConfig, ChannelType } from '../types';

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

interface DiscordPayload {
  username?: string;
  avatar_url?: string;
  content?: string;
  embeds?: DiscordEmbed[];
}

export class DiscordChannel extends BaseChannel {
  private config: DiscordConfig;
  private rateLimitReset: number = 0;
  private requestCount: number = 0;

  constructor(id: string, name: string, config: DiscordConfig) {
    super(id, 'discord' as ChannelType, name);
    this.config = config;
  }

  /**
   * Send alert to Discord
   */
  async send(alert: Alert): Promise<DeliveryResult> {
    // Check rate limit
    if (!this.checkRateLimit()) {
      return this.createFailureResult('Rate limit exceeded', alert.id);
    }

    try {
      const payload = this.formatAlert(alert);

      const response = await axios.post(this.config.webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      // Track rate limit headers
      this.updateRateLimit(response.headers);

      logger.info('DiscordChannel', `Sent alert ${alert.id} to Discord webhook`);
      
      return this.createSuccessResult(alert.id);
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message;
      logger.error('DiscordChannel', `Failed to send alert ${alert.id}:`, errorMsg);
      
      // Check if rate limited
      if (error.response?.status === 429) {
        const retryAfter = error.response.data?.retry_after || 60;
        this.rateLimitReset = Date.now() + (retryAfter * 1000);
        return this.createFailureResult(`Rate limited, retry after ${retryAfter}s`, alert.id);
      }
      
      return this.createFailureResult(errorMsg, alert.id);
    }
  }

  /**
   * Send batch to Discord
   */
  async sendBatch(batch: AlertBatch): Promise<DeliveryResult> {
    if (!this.checkRateLimit()) {
      return this.createFailureResult('Rate limit exceeded', batch.id);
    }

    try {
      const payload = this.formatBatch(batch);

      const response = await axios.post(this.config.webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      this.updateRateLimit(response.headers);

      logger.info('DiscordChannel', `Sent batch ${batch.id} with ${batch.alerts.length} alerts`);
      
      return this.createSuccessResult(batch.id);
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message;
      logger.error('DiscordChannel', `Failed to send batch ${batch.id}:`, errorMsg);
      return this.createFailureResult(errorMsg, batch.id);
    }
  }

  /**
   * Format single alert as Discord embed
   */
  private formatAlert(alert: Alert): DiscordPayload {
    const embed: DiscordEmbed = {
      title: `${this.getEmojiForType(alert.type)} ${alert.title}`,
      description: alert.message,
      color: this.getColorForPriority(alert.priority),
      timestamp: new Date(alert.timestamp).toISOString(),
      fields: this.extractFields(alert.data),
      footer: { text: `Priority: ${alert.priority.toUpperCase()}` },
    };

    return {
      username: this.config.username || 'Solana Alert Bot',
      avatar_url: this.config.avatarUrl,
      embeds: [embed],
    };
  }

  /**
   * Format batch as Discord embed
   */
  private formatBatch(batch: AlertBatch): DiscordPayload {
    const embed: DiscordEmbed = {
      title: `${this.getEmojiForType(batch.type)} ${batch.summary}`,
      description: this.formatBatchDescription(batch),
      color: this.getColorForPriority(batch.priority),
      timestamp: new Date(batch.timestamp).toISOString(),
      footer: { text: `${batch.alerts.length} alerts • Priority: ${batch.priority.toUpperCase()}` },
    };

    return {
      username: this.config.username || 'Solana Alert Bot',
      avatar_url: this.config.avatarUrl,
      embeds: [embed],
    };
  }

  /**
   * Format batch description
   */
  private formatBatchDescription(batch: AlertBatch): string {
    const lines: string[] = [];

    for (const alert of batch.alerts.slice(0, 5)) {
      lines.push(`• **${alert.title}**`);
      if (alert.data.symbol) {
        lines.push(`  Symbol: ${alert.data.symbol}`);
      }
    }

    if (batch.alerts.length > 5) {
      lines.push(`\n*... and ${batch.alerts.length - 5} more alerts*`);
    }

    return lines.join('\n');
  }

  /**
   * Extract fields from alert data
   */
  private extractFields(data: Record<string, any>): Array<{ name: string; value: string; inline?: boolean }> {
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

    // Common fields
    if (data.symbol) {
      fields.push({ name: 'Symbol', value: `**${data.symbol}**`, inline: true });
    }

    if (data.mint) {
      const shortMint = `${data.mint.slice(0, 6)}...${data.mint.slice(-6)}`;
      fields.push({ name: 'Mint', value: `\`${shortMint}\``, inline: true });
    }

    if (data.price !== undefined) {
      fields.push({ name: 'Price', value: `$${this.formatNumber(data.price)}`, inline: true });
    }

    if (data.liquidity !== undefined) {
      fields.push({ name: 'Liquidity', value: `$${this.formatNumber(data.liquidity)}`, inline: true });
    }

    if (data.volume !== undefined) {
      fields.push({ name: 'Volume', value: `$${this.formatNumber(data.volume)}`, inline: true });
    }

    if (data.marketCap !== undefined) {
      fields.push({ name: 'Market Cap', value: `$${this.formatNumber(data.marketCap)}`, inline: true });
    }

    // Limit to 25 fields (Discord limit)
    return fields.slice(0, 25);
  }

  /**
   * Format number with K/M/B suffix
   */
  private formatNumber(num: number): string {
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
    return num.toFixed(2);
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
   * Get Discord color for priority
   */
  private getColorForPriority(priority: string): number {
    const colorMap: Record<string, number> = {
      critical: 0xFF0000, // Red
      high: 0xFF9900,     // Orange
      normal: 0xFFFF00,   // Yellow
      low: 0x00FF00,      // Green
    };

    return colorMap[priority] || 0x0099FF; // Blue default
  }

  /**
   * Check if we're rate limited
   */
  private checkRateLimit(): boolean {
    const now = Date.now();
    
    if (now < this.rateLimitReset) {
      const waitSeconds = Math.ceil((this.rateLimitReset - now) / 1000);
      logger.warn('DiscordChannel', `Rate limited, wait ${waitSeconds}s`);
      return false;
    }

    return true;
  }

  /**
   * Update rate limit from response headers
   */
  private updateRateLimit(headers: any): void {
    const remaining = parseInt(headers['x-ratelimit-remaining'], 10);
    const resetTimestamp = parseInt(headers['x-ratelimit-reset'], 10);

    if (!isNaN(remaining) && remaining === 0 && !isNaN(resetTimestamp)) {
      this.rateLimitReset = resetTimestamp * 1000;
      logger.warn('DiscordChannel', `Rate limit reached, reset at ${new Date(this.rateLimitReset).toISOString()}`);
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Discord doesn't have a direct health check endpoint
      // Just verify the webhook URL is valid
      const url = new URL(this.config.webhookUrl);
      return url.hostname === 'discord.com' || url.hostname === 'discordapp.com';
    } catch (error) {
      logger.error('DiscordChannel', 'Health check failed:', error);
      return false;
    }
  }
}
