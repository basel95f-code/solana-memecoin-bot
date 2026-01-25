/**
 * Alert Dispatcher
 * Bridges RuleEngine with multi-channel alert delivery system
 * Takes triggered rules and dispatches to configured channels
 */

import { logger } from '../utils/logger';
import { AlertManager } from '../services/alerts/AlertManager';
import type { Alert, AlertType, AlertPriority } from '../services/alerts/types';
import type { AlertRule, EvaluationResult } from './RuleEngine';

export interface DispatchConfig {
  enableDeduplication?: boolean;
  enableBatching?: boolean;
  dedupWindowMs?: number;
  batchWindowMs?: number;
}

export interface DispatchResult {
  ruleId: string;
  alertId: string;
  dispatched: boolean;
  channels: string[];
  errors: Array<{ channel: string; error: string }>;
}

export class Dispatcher {
  private alertManager: AlertManager;
  private config: DispatchConfig;
  private lastDispatch: Map<string, number> = new Map(); // ruleId:tokenMint -> timestamp

  constructor(alertManager: AlertManager, config: DispatchConfig = {}) {
    this.alertManager = alertManager;
    this.config = {
      enableDeduplication: config.enableDeduplication ?? true,
      enableBatching: config.enableBatching ?? true,
      dedupWindowMs: config.dedupWindowMs ?? 5 * 60 * 1000, // 5 minutes
      batchWindowMs: config.batchWindowMs ?? 30 * 1000, // 30 seconds
    };

    logger.info('Dispatcher', 'Initialized with config:', this.config);
  }

  /**
   * Dispatch alert for triggered rule
   */
  async dispatch(
    rule: AlertRule,
    result: EvaluationResult,
    context: Record<string, any>
  ): Promise<DispatchResult> {
    const alertId = `${rule.id}-${Date.now()}`;

    logger.info('Dispatcher', `Dispatching alert for rule "${rule.name}" (${rule.id})`);

    // Check deduplication
    if (this.config.enableDeduplication && this.isDuplicate(rule, context)) {
      logger.debug('Dispatcher', `Skipping duplicate alert for rule ${rule.id}`);
      return {
        ruleId: rule.id,
        alertId,
        dispatched: false,
        channels: [],
        errors: [],
      };
    }

    // Build alert
    const alert = this.buildAlert(rule, result, context, alertId);

    // Record dispatch time
    this.recordDispatch(rule, context);

    // Send through AlertManager
    try {
      await this.alertManager.sendAlert(alert);

      logger.info('Dispatcher', `Successfully dispatched alert ${alertId} to ${rule.channels.length} channels`);

      return {
        ruleId: rule.id,
        alertId,
        dispatched: true,
        channels: rule.channels,
        errors: [],
      };
    } catch (error: any) {
      logger.error('Dispatcher', `Failed to dispatch alert ${alertId}:`, error);

      return {
        ruleId: rule.id,
        alertId,
        dispatched: false,
        channels: [],
        errors: [{ channel: 'all', error: error.message }],
      };
    }
  }

  /**
   * Batch dispatch multiple rules
   */
  async batchDispatch(
    dispatches: Array<{
      rule: AlertRule;
      result: EvaluationResult;
      context: Record<string, any>;
    }>
  ): Promise<DispatchResult[]> {
    logger.info('Dispatcher', `Batch dispatching ${dispatches.length} alerts`);

    const results: DispatchResult[] = [];

    for (const { rule, result, context } of dispatches) {
      const dispatchResult = await this.dispatch(rule, result, context);
      results.push(dispatchResult);
    }

    return results;
  }

  /**
   * Build alert from rule and context
   */
  private buildAlert(
    rule: AlertRule,
    result: EvaluationResult,
    context: Record<string, any>,
    alertId: string
  ): Partial<Alert> {
    // Map rule priority to alert priority
    const priority = this.mapPriority(rule.priority);

    // Build title
    const title = rule.message || rule.name;

    // Build message
    const message = this.formatMessage(rule, result, context);

    // Extract relevant data
    const data = this.extractData(context);

    // Determine alert type from rule tags or metadata
    const type = this.determineAlertType(rule);

    return {
      id: alertId,
      type,
      priority,
      title,
      message,
      data,
      timestamp: Date.now(),
      dedupKey: `${rule.id}:${data.tokenMint || data.mint}`,
      userId: rule.createdBy,
      chatId: context.chatId,
    };
  }

  /**
   * Format message with rule details and matched conditions
   */
  private formatMessage(
    rule: AlertRule,
    result: EvaluationResult,
    context: Record<string, any>
  ): string {
    let message = rule.description || rule.name;
    message += '\n\n';

    // Add matched conditions
    if (result.matchedConditions.length > 0) {
      message += '✅ Matched:\n';
      for (const condition of result.matchedConditions.slice(0, 5)) {
        message += `  • ${condition}\n`;
      }
      if (result.matchedConditions.length > 5) {
        message += `  ... and ${result.matchedConditions.length - 5} more\n`;
      }
    }

    // Add token info if available
    if (context.symbol) {
      message += `\nToken: ${context.symbol}`;
      if (context.tokenMint) {
        message += ` (${context.tokenMint.slice(0, 8)}...)`;
      }
    }

    return message;
  }

  /**
   * Extract data from context for alert
   */
  private extractData(context: Record<string, any>): Record<string, any> {
    const data: Record<string, any> = {};

    // Common fields
    const fields = [
      'tokenMint',
      'mint',
      'symbol',
      'price',
      'liquidity',
      'volume',
      'volume24h',
      'marketCap',
      'riskScore',
      'holders',
      'priceChange1h',
      'priceChange24h',
      'topHolderPercent',
      'lpLocked',
      'mintDisabled',
      'freezeDisabled',
    ];

    for (const field of fields) {
      if (context.currentData?.[field] !== undefined) {
        data[field] = context.currentData[field];
      } else if (context[field] !== undefined) {
        data[field] = context[field];
      }
    }

    return data;
  }

  /**
   * Determine alert type from rule
   */
  private determineAlertType(rule: AlertRule): AlertType {
    // Check tags first
    if (rule.tags.includes('whale')) return 'whale_movement' as AlertType;
    if (rule.tags.includes('smart_money')) return 'smart_money' as AlertType;
    if (rule.tags.includes('liquidity')) return 'liquidity_drain' as AlertType;
    if (rule.tags.includes('volume')) return 'volume_spike' as AlertType;
    if (rule.tags.includes('price')) return 'price_alert' as AlertType;
    if (rule.tags.includes('authority')) return 'authority_change' as AlertType;
    if (rule.tags.includes('rug')) return 'rug_detected' as AlertType;

    // Check metadata
    if (rule.metadata.alertType) {
      return rule.metadata.alertType as AlertType;
    }

    // Default based on category
    if (rule.metadata.category === 'discovery') return 'new_token' as AlertType;
    if (rule.metadata.category === 'risk') return 'rug_detected' as AlertType;
    if (rule.metadata.category === 'whale') return 'whale_movement' as AlertType;
    if (rule.metadata.category === 'opportunity') return 'trading_signal' as AlertType;

    // Default
    return 'trading_signal' as AlertType;
  }

  /**
   * Map rule priority to alert priority
   */
  private mapPriority(rulePriority: string): AlertPriority {
    const priorityMap: Record<string, AlertPriority> = {
      critical: 'critical' as AlertPriority,
      high: 'high' as AlertPriority,
      medium: 'normal' as AlertPriority,
      normal: 'normal' as AlertPriority,
      low: 'low' as AlertPriority,
    };

    return priorityMap[rulePriority] || ('normal' as AlertPriority);
  }

  /**
   * Check if this alert is a duplicate
   */
  private isDuplicate(rule: AlertRule, context: Record<string, any>): boolean {
    const tokenMint = context.tokenMint || context.currentData?.tokenMint || context.currentData?.mint;
    if (!tokenMint) return false;

    const key = `${rule.id}:${tokenMint}`;
    const lastDispatchTime = this.lastDispatch.get(key);

    if (!lastDispatchTime) return false;

    const timeSinceLastDispatch = Date.now() - lastDispatchTime;
    return timeSinceLastDispatch < this.config.dedupWindowMs!;
  }

  /**
   * Record dispatch time for deduplication
   */
  private recordDispatch(rule: AlertRule, context: Record<string, any>): void {
    const tokenMint = context.tokenMint || context.currentData?.tokenMint || context.currentData?.mint;
    if (!tokenMint) return;

    const key = `${rule.id}:${tokenMint}`;
    this.lastDispatch.set(key, Date.now());

    // Cleanup old entries
    this.cleanupOldDispatches();
  }

  /**
   * Cleanup old dispatch records
   */
  private cleanupOldDispatches(): void {
    const cutoff = Date.now() - (this.config.dedupWindowMs! * 2);
    const toDelete: string[] = [];

    for (const [key, timestamp] of this.lastDispatch.entries()) {
      if (timestamp < cutoff) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.lastDispatch.delete(key);
    }
  }

  /**
   * Test delivery to all channels for a rule
   */
  async testDelivery(rule: AlertRule, context?: Record<string, any>): Promise<DispatchResult> {
    logger.info('Dispatcher', `Testing delivery for rule ${rule.name}`);

    const testContext = context || {
      tokenMint: 'TEST123456789',
      symbol: 'TEST',
      currentData: {
        price: 0.001,
        liquidity: 10000,
        volume24h: 5000,
      },
    };

    const testResult: EvaluationResult = {
      matched: true,
      ruleId: rule.id,
      ruleName: rule.name,
      matchedConditions: ['Test condition'],
      failedConditions: [],
      evaluatedAt: Date.now(),
    };

    return await this.dispatch(rule, testResult, testContext);
  }

  /**
   * Get dispatcher statistics
   */
  getStats(): {
    totalDispatches: number;
    uniqueTokens: number;
    uniqueRules: number;
  } {
    const uniqueTokens = new Set<string>();
    const uniqueRules = new Set<string>();

    for (const key of this.lastDispatch.keys()) {
      const [ruleId, tokenMint] = key.split(':');
      uniqueRules.add(ruleId);
      uniqueTokens.add(tokenMint);
    }

    return {
      totalDispatches: this.lastDispatch.size,
      uniqueTokens: uniqueTokens.size,
      uniqueRules: uniqueRules.size,
    };
  }

  /**
   * Clear dispatch history
   */
  clearHistory(): void {
    this.lastDispatch.clear();
    logger.info('Dispatcher', 'Cleared dispatch history');
  }
}
