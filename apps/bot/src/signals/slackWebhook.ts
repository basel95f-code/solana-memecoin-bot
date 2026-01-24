/**
 * Slack Webhook Dispatcher
 * Sends trading signals to Slack channels via incoming webhooks
 *
 * Uses Slack's Block Kit format for rich message formatting
 */

import { logger } from '../utils/logger';
import type { TradingSignal, SignalType, WebhookDispatchResult } from './types';

// ============================================
// Slack Types
// ============================================

export interface SlackWebhookConfig {
  id: number;
  url: string; // Slack webhook URL
  name: string;
  channel?: string; // Optional channel override
  enabled: boolean;

  // Filter settings
  events: SignalType[];
  minConfidence: number;

  // Timestamps
  createdAt: number;
  updatedAt?: number;
  lastTriggeredAt?: number;

  // Stats
  totalSent: number;
  failureCount: number;
}

interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{
    type: string;
    text: string;
  }>;
  elements?: Array<{
    type: string;
    text?: { type: string; text: string };
    url?: string;
    action_id?: string;
  }>;
  accessory?: {
    type: string;
    image_url: string;
    alt_text: string;
  };
}

interface SlackWebhookPayload {
  text?: string;
  blocks?: SlackBlock[];
  channel?: string;
  username?: string;
  icon_emoji?: string;
}

export const DEFAULT_SLACK_WEBHOOK_CONFIG: Partial<SlackWebhookConfig> = {
  enabled: true,
  events: ['BUY', 'SELL', 'TAKE_PROFIT', 'STOP_LOSS'],
  minConfidence: 60,
  totalSent: 0,
  failureCount: 0,
};

// ============================================
// Slack Webhook Dispatcher Class
// ============================================

export class SlackWebhookDispatcher {
  private webhooks: Map<number, SlackWebhookConfig> = new Map();
  private nextId: number = 1;

  /**
   * Add a new Slack webhook
   */
  addWebhook(
    url: string,
    name: string,
    options: Partial<SlackWebhookConfig> = {}
  ): SlackWebhookConfig {
    const id = this.nextId++;
    const webhook: SlackWebhookConfig = {
      id,
      url,
      name,
      ...DEFAULT_SLACK_WEBHOOK_CONFIG,
      ...options,
      createdAt: Date.now(),
      totalSent: 0,
      failureCount: 0,
    } as SlackWebhookConfig;

    this.webhooks.set(id, webhook);
    logger.info('SlackWebhookDispatcher', `Added webhook: ${name} (id=${id})`);

    return webhook;
  }

  /**
   * Remove a webhook
   */
  removeWebhook(id: number): boolean {
    const removed = this.webhooks.delete(id);
    if (removed) {
      logger.info('SlackWebhookDispatcher', `Removed webhook: ${id}`);
    }
    return removed;
  }

  /**
   * Update webhook configuration
   */
  updateWebhook(
    id: number,
    updates: Partial<Omit<SlackWebhookConfig, 'id' | 'createdAt'>>
  ): boolean {
    const webhook = this.webhooks.get(id);
    if (!webhook) return false;

    Object.assign(webhook, updates, { updatedAt: Date.now() });
    return true;
  }

  /**
   * Get a webhook by ID
   */
  getWebhook(id: number): SlackWebhookConfig | undefined {
    return this.webhooks.get(id);
  }

  /**
   * Get all webhooks
   */
  getAllWebhooks(): SlackWebhookConfig[] {
    return Array.from(this.webhooks.values());
  }

  /**
   * Dispatch signal to all eligible webhooks
   */
  async dispatchSignal(signal: TradingSignal): Promise<WebhookDispatchResult[]> {
    const results: WebhookDispatchResult[] = [];

    for (const webhook of this.webhooks.values()) {
      // Skip disabled webhooks
      if (!webhook.enabled) continue;

      // Check event filter
      if (!webhook.events.includes(signal.type)) continue;

      // Check confidence filter
      if (signal.confidence < webhook.minConfidence) continue;

      // Dispatch to this webhook
      const result = await this.sendToWebhook(webhook, signal);
      results.push(result);

      // Update webhook stats
      webhook.lastTriggeredAt = Date.now();
      webhook.totalSent++;
      if (!result.success) {
        webhook.failureCount++;
      }
    }

    return results;
  }

  /**
   * Send signal to a specific webhook
   */
  private async sendToWebhook(
    webhook: SlackWebhookConfig,
    signal: TradingSignal
  ): Promise<WebhookDispatchResult> {
    const payload = this.buildPayload(signal);
    if (webhook.channel) {
      payload.channel = webhook.channel;
    }

    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          return {
            webhookId: webhook.id,
            success: true,
            statusCode: response.status,
            retryCount,
            dispatchedAt: Date.now(),
          };
        }

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
          await this.delay(waitMs);
          retryCount++;
          continue;
        }

        // Non-retryable error
        const errorText = await response.text();
        logger.error(
          'SlackWebhookDispatcher',
          `Webhook ${webhook.id} failed: ${response.status} - ${errorText}`
        );

        return {
          webhookId: webhook.id,
          success: false,
          statusCode: response.status,
          error: errorText,
          retryCount,
          dispatchedAt: Date.now(),
        };
      } catch (error) {
        logger.error(
          'SlackWebhookDispatcher',
          `Webhook ${webhook.id} error`,
          error as Error
        );

        retryCount++;
        if (retryCount < maxRetries) {
          await this.delay(1000 * retryCount);
        }
      }
    }

    return {
      webhookId: webhook.id,
      success: false,
      error: 'Max retries exceeded',
      retryCount,
      dispatchedAt: Date.now(),
    };
  }

  /**
   * Build Slack Block Kit payload
   */
  private buildPayload(signal: TradingSignal): SlackWebhookPayload {
    const emoji = this.getSignalEmoji(signal.type);
    const color = this.getSignalColor(signal.type);
    const confidenceBar = this.buildConfidenceBar(signal.confidence);

    // Header text
    const headerText = `${emoji} *${signal.type} Signal: ${signal.symbol}*`;

    // Build blocks
    const blocks: SlackBlock[] = [
      // Header
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${emoji} ${signal.type} Signal: ${signal.symbol}`,
          emoji: true,
        },
      },
      // Signal details section
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Confidence:*\n${confidenceBar} ${signal.confidence}%` },
          { type: 'mrkdwn', text: `*Risk Score:*\n${signal.riskScore}/100` },
          { type: 'mrkdwn', text: `*Entry Price:*\n$${signal.entryPrice.toFixed(8)}` },
          { type: 'mrkdwn', text: `*Position Size:*\n${signal.suggestedPositionSize}${signal.positionSizeType === 'percentage' ? '%' : ' SOL'}` },
        ],
      },
    ];

    // Price targets for BUY signals
    if (signal.type === 'BUY' && (signal.targetPrice || signal.stopLossPrice)) {
      const targetPct = signal.targetPrice
        ? ((signal.targetPrice - signal.entryPrice) / signal.entryPrice * 100).toFixed(1)
        : 'N/A';
      const stopPct = signal.stopLossPrice
        ? ((signal.stopLossPrice - signal.entryPrice) / signal.entryPrice * 100).toFixed(1)
        : 'N/A';

      blocks.push({
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Target Price:*\n$${signal.targetPrice?.toFixed(8) || 'N/A'} (+${targetPct}%)` },
          { type: 'mrkdwn', text: `*Stop Loss:*\n$${signal.stopLossPrice?.toFixed(8) || 'N/A'} (${stopPct}%)` },
        ],
      });
    }

    // Reasons
    if (signal.reasons.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Reasons:*\n${signal.reasons.map(r => `• ${r}`).join('\n')}`,
        },
      });
    }

    // Warnings
    if (signal.warnings.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:warning: *Warnings:*\n${signal.warnings.map(w => `• ${w}`).join('\n')}`,
        },
      });
    }

    // Divider
    blocks.push({ type: 'divider' });

    // Action buttons
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '📊 Chart' },
          url: `https://dexscreener.com/solana/${signal.mint}`,
          action_id: 'view_chart',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '💱 Trade' },
          url: `https://jup.ag/swap/SOL-${signal.mint}`,
          action_id: 'trade',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔍 RugCheck' },
          url: `https://rugcheck.xyz/tokens/${signal.mint}`,
          action_id: 'rugcheck',
        },
      ],
    });

    // Context footer
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Signal ID: \`${signal.id.slice(0, 8)}\` | ${new Date(signal.generatedAt * 1000).toLocaleString()}`,
        },
      ],
    } as any);

    return {
      text: headerText, // Fallback text for notifications
      blocks,
      username: 'Memecoin Bot',
      icon_emoji: ':robot_face:',
    };
  }

  /**
   * Get emoji for signal type
   */
  private getSignalEmoji(type: SignalType): string {
    switch (type) {
      case 'BUY':
        return '🟢';
      case 'SELL':
        return '🔴';
      case 'TAKE_PROFIT':
        return '💰';
      case 'STOP_LOSS':
        return '🛑';
      default:
        return '📊';
    }
  }

  /**
   * Get color for signal type (for attachments)
   */
  private getSignalColor(type: SignalType): string {
    switch (type) {
      case 'BUY':
        return '#00ff00';
      case 'SELL':
        return '#ff0000';
      case 'TAKE_PROFIT':
        return '#ffd700';
      case 'STOP_LOSS':
        return '#ff4500';
      default:
        return '#808080';
    }
  }

  /**
   * Build visual confidence bar
   */
  private buildConfidenceBar(confidence: number): string {
    const filled = Math.round(confidence / 10);
    const empty = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Load webhooks from storage
   */
  loadWebhooks(webhooks: SlackWebhookConfig[]): void {
    this.webhooks.clear();
    for (const webhook of webhooks) {
      this.webhooks.set(webhook.id, webhook);
      if (webhook.id >= this.nextId) {
        this.nextId = webhook.id + 1;
      }
    }
    logger.info('SlackWebhookDispatcher', `Loaded ${webhooks.length} webhooks`);
  }
}

// Export singleton instance
export const slackWebhookDispatcher = new SlackWebhookDispatcher();
