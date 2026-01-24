/**
 * Webhook Dispatcher
 * Dispatches trading signals to Discord webhooks with rich embeds
 */

import { logger } from '../utils/logger';
import { SIGNALS } from '../constants';
import type {
  TradingSignal,
  WebhookConfig,
  DiscordEmbed,
  DiscordWebhookPayload,
  WebhookDispatchResult,
  SignalType,
} from './types';

export class WebhookDispatcher {
  private webhooks: Map<number, WebhookConfig> = new Map();
  private nextWebhookId: number = 1;
  private dispatchHistory: Map<string, WebhookDispatchResult[]> = new Map(); // signalId -> results

  /**
   * Add a webhook
   */
  addWebhook(url: string, name: string, options: Partial<WebhookConfig> = {}): WebhookConfig {
    const id = this.nextWebhookId++;
    const now = Math.floor(Date.now() / 1000);

    const webhook: WebhookConfig = {
      id,
      url,
      name,
      enabled: options.enabled ?? true,
      events: options.events ?? ['BUY', 'SELL', 'TAKE_PROFIT', 'STOP_LOSS'],
      minConfidence: options.minConfidence ?? 60,
      createdAt: now,
      totalSent: 0,
      failureCount: 0,
    };

    this.webhooks.set(id, webhook);
    logger.info('WebhookDispatcher', `Added webhook "${name}" (ID: ${id})`);

    return webhook;
  }

  /**
   * Remove a webhook
   */
  removeWebhook(id: number): boolean {
    const deleted = this.webhooks.delete(id);
    if (deleted) {
      logger.info('WebhookDispatcher', `Removed webhook ID: ${id}`);
    }
    return deleted;
  }

  /**
   * Get a webhook by ID
   */
  getWebhook(id: number): WebhookConfig | undefined {
    return this.webhooks.get(id);
  }

  /**
   * Get all webhooks
   */
  getAllWebhooks(): WebhookConfig[] {
    return Array.from(this.webhooks.values());
  }

  /**
   * Update a webhook
   */
  updateWebhook(id: number, updates: Partial<Omit<WebhookConfig, 'id' | 'createdAt'>>): boolean {
    const webhook = this.webhooks.get(id);
    if (!webhook) return false;

    Object.assign(webhook, updates, { updatedAt: Math.floor(Date.now() / 1000) });
    return true;
  }

  /**
   * Dispatch a signal to all matching webhooks
   */
  async dispatchSignal(signal: TradingSignal): Promise<WebhookDispatchResult[]> {
    const results: WebhookDispatchResult[] = [];

    for (const webhook of this.webhooks.values()) {
      // Check if webhook should receive this signal
      if (!this.shouldDispatch(webhook, signal)) {
        continue;
      }

      const result = await this.sendToWebhook(webhook, signal);
      results.push(result);

      // Update webhook stats
      if (result.success) {
        webhook.totalSent++;
        webhook.lastTriggeredAt = Math.floor(Date.now() / 1000);
      } else {
        webhook.failureCount++;
      }
    }

    // Store dispatch history
    this.dispatchHistory.set(signal.id, results);

    return results;
  }

  /**
   * Check if webhook should receive this signal
   */
  private shouldDispatch(webhook: WebhookConfig, signal: TradingSignal): boolean {
    if (!webhook.enabled) return false;
    if (!webhook.events.includes(signal.type)) return false;
    if (signal.confidence < webhook.minConfidence) return false;
    return true;
  }

  /**
   * Send signal to a specific webhook with retry logic
   */
  private async sendToWebhook(
    webhook: WebhookConfig,
    signal: TradingSignal
  ): Promise<WebhookDispatchResult> {
    const payload = this.createDiscordPayload(signal);
    let retryCount = 0;
    let lastError: string | undefined;
    let statusCode: number | undefined;

    while (retryCount <= SIGNALS.WEBHOOK_MAX_RETRIES) {
      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(SIGNALS.WEBHOOK_TIMEOUT_MS),
        });

        statusCode = response.status;

        if (response.ok || response.status === 204) {
          logger.debug('WebhookDispatcher', `Sent signal to webhook "${webhook.name}"`);
          return {
            webhookId: webhook.id,
            success: true,
            statusCode,
            retryCount,
            dispatchedAt: Math.floor(Date.now() / 1000),
          };
        }

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after');
          const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 5000;
          logger.warn('WebhookDispatcher', `Rate limited by Discord, waiting ${waitMs}ms`);
          await this.sleep(waitMs);
        } else {
          lastError = `HTTP ${response.status}: ${response.statusText}`;
        }

      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        logger.debug('WebhookDispatcher', `Webhook send attempt ${retryCount + 1} failed: ${lastError}`);
      }

      retryCount++;

      if (retryCount <= SIGNALS.WEBHOOK_MAX_RETRIES) {
        // Exponential backoff
        const delay = SIGNALS.WEBHOOK_RETRY_DELAY_MS * Math.pow(SIGNALS.WEBHOOK_BACKOFF_MULTIPLIER, retryCount - 1);
        await this.sleep(delay);
      }
    }

    logger.warn('WebhookDispatcher', `Failed to send to webhook "${webhook.name}" after ${retryCount} attempts`);

    return {
      webhookId: webhook.id,
      success: false,
      statusCode,
      error: lastError,
      retryCount,
      dispatchedAt: Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Create Discord webhook payload with rich embed
   */
  private createDiscordPayload(signal: TradingSignal): DiscordWebhookPayload {
    const embed = this.createSignalEmbed(signal);

    return {
      username: 'Solana Signal Bot',
      embeds: [embed],
    };
  }

  /**
   * Create a Discord embed for the signal
   */
  private createSignalEmbed(signal: TradingSignal): DiscordEmbed {
    const color = this.getSignalColor(signal.type);
    const emoji = this.getSignalEmoji(signal.type);

    const fields = [
      {
        name: 'Confidence',
        value: `${signal.confidence}%`,
        inline: true,
      },
      {
        name: 'Risk Score',
        value: `${signal.riskScore}/100`,
        inline: true,
      },
      {
        name: 'Rug Probability',
        value: `${(signal.rugProbability * 100).toFixed(1)}%`,
        inline: true,
      },
      {
        name: 'Entry Price',
        value: this.formatPrice(signal.entryPrice),
        inline: true,
      },
    ];

    // Add target and stop loss for BUY signals
    if (signal.type === 'BUY') {
      if (signal.targetPrice) {
        fields.push({
          name: 'Target',
          value: `${this.formatPrice(signal.targetPrice)} (+${((signal.targetPrice / signal.entryPrice - 1) * 100).toFixed(0)}%)`,
          inline: true,
        });
      }
      if (signal.stopLossPrice) {
        fields.push({
          name: 'Stop Loss',
          value: `${this.formatPrice(signal.stopLossPrice)} (${((signal.stopLossPrice / signal.entryPrice - 1) * 100).toFixed(0)}%)`,
          inline: true,
        });
      }
    }

    // Position size
    fields.push({
      name: 'Position Size',
      value: signal.positionSizeType === 'percentage'
        ? `${signal.suggestedPositionSize}% of portfolio`
        : `${signal.suggestedPositionSize} SOL`,
      inline: true,
    });

    // Smart money score
    fields.push({
      name: 'Smart Money',
      value: `${(signal.smartMoneyScore * 100).toFixed(0)}%`,
      inline: true,
    });

    // Reasons
    if (signal.reasons.length > 0) {
      fields.push({
        name: 'Reasons',
        value: signal.reasons.map(r => `• ${r}`).join('\n'),
        inline: false,
      });
    }

    // Warnings
    if (signal.warnings.length > 0) {
      fields.push({
        name: 'Warnings',
        value: signal.warnings.map(w => `• ${w}`).join('\n'),
        inline: false,
      });
    }

    // Links
    const links = [
      `[DexScreener](https://dexscreener.com/solana/${signal.mint})`,
      `[Birdeye](https://birdeye.so/token/${signal.mint}?chain=solana)`,
      `[Solscan](https://solscan.io/token/${signal.mint})`,
    ].join(' | ');

    fields.push({
      name: 'Links',
      value: links,
      inline: false,
    });

    return {
      title: `${emoji} ${signal.type} Signal: ${signal.symbol}`,
      description: signal.name || signal.symbol,
      color,
      fields,
      footer: {
        text: `Signal ID: ${signal.id.slice(0, 8)} | Expires in ${this.formatExpiry(signal.expiresAt)}`,
      },
      timestamp: new Date(signal.generatedAt * 1000).toISOString(),
    };
  }

  /**
   * Get color for signal type
   */
  private getSignalColor(type: SignalType): number {
    switch (type) {
      case 'BUY': return SIGNALS.COLORS.BUY;
      case 'SELL': return SIGNALS.COLORS.SELL;
      case 'TAKE_PROFIT': return SIGNALS.COLORS.TAKE_PROFIT;
      case 'STOP_LOSS': return SIGNALS.COLORS.STOP_LOSS;
      default: return SIGNALS.COLORS.INFO;
    }
  }

  /**
   * Get emoji for signal type
   */
  private getSignalEmoji(type: SignalType): string {
    switch (type) {
      case 'BUY': return '🟢';
      case 'SELL': return '🔴';
      case 'TAKE_PROFIT': return '🎯';
      case 'STOP_LOSS': return '🛑';
      default: return '📊';
    }
  }

  /**
   * Format price for display
   */
  private formatPrice(price: number): string {
    if (price < 0.00001) {
      return `$${price.toExponential(2)}`;
    } else if (price < 0.01) {
      return `$${price.toFixed(6)}`;
    } else if (price < 1) {
      return `$${price.toFixed(4)}`;
    } else {
      return `$${price.toFixed(2)}`;
    }
  }

  /**
   * Format expiry time
   */
  private formatExpiry(expiresAt: number): string {
    const now = Math.floor(Date.now() / 1000);
    const remaining = expiresAt - now;

    if (remaining <= 0) return 'Expired';
    if (remaining < 60) return `${remaining}s`;
    if (remaining < 3600) return `${Math.floor(remaining / 60)}m`;
    return `${Math.floor(remaining / 3600)}h`;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get dispatch history for a signal
   */
  getDispatchHistory(signalId: string): WebhookDispatchResult[] {
    return this.dispatchHistory.get(signalId) || [];
  }

  /**
   * Load webhooks from database
   */
  loadWebhooks(webhooks: WebhookConfig[]): void {
    for (const webhook of webhooks) {
      this.webhooks.set(webhook.id, webhook);
      if (webhook.id >= this.nextWebhookId) {
        this.nextWebhookId = webhook.id + 1;
      }
    }
    logger.info('WebhookDispatcher', `Loaded ${webhooks.length} webhooks`);
  }

  /**
   * Clear all webhooks (for testing)
   */
  clear(): void {
    this.webhooks.clear();
    this.dispatchHistory.clear();
    this.nextWebhookId = 1;
  }
}

// Export singleton instance
export const webhookDispatcher = new WebhookDispatcher();
