/**
 * Alert Rules Engine
 * Allows users to create custom alert conditions for token analysis
 *
 * Rules are evaluated against token analysis results and can trigger
 * custom alerts, modify signals, or block signals entirely.
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import type { TokenAnalysis, DexScreenerPair } from '../types';

// ============================================
// Types
// ============================================

export type ComparisonOperator = '>' | '<' | '>=' | '<=' | '==' | '!=' | 'contains' | 'not_contains';
export type LogicalOperator = 'AND' | 'OR';
export type RuleAction = 'alert' | 'block' | 'boost' | 'tag';

export interface RuleCondition {
  field: string; // e.g., 'liquidity.totalLiquidityUsd', 'risk.score', 'holders.totalHolders'
  operator: ComparisonOperator;
  value: number | string | boolean;
}

export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;

  // Conditions
  conditions: RuleCondition[];
  logicalOperator: LogicalOperator; // How to combine conditions

  // Actions
  action: RuleAction;
  actionConfig: {
    // For 'alert' action
    message?: string; // Custom alert message
    priority?: 'low' | 'normal' | 'high';

    // For 'boost' action
    confidenceBoost?: number; // Add/subtract from confidence

    // For 'tag' action
    tag?: string; // Tag to add to signal

    // For 'block' action
    blockReason?: string;
  };

  // Metadata
  createdAt: number;
  updatedAt?: number;
  triggeredCount: number;
  lastTriggeredAt?: number;

  // Scope
  chatId?: string; // If set, rule only applies to this chat
}

export interface RuleEvaluationResult {
  ruleId: string;
  ruleName: string;
  matched: boolean;
  action: RuleAction;
  actionConfig: AlertRule['actionConfig'];
  matchedConditions: string[];
}

export interface RulesEngineConfig {
  enabled: boolean;
  maxRulesPerUser: number;
  maxConditionsPerRule: number;
}

// Available fields for rule conditions
export const RULE_FIELDS = {
  // Liquidity
  'liquidity.totalLiquidityUsd': { type: 'number', description: 'Total liquidity in USD' },
  'liquidity.lpBurnedPercent': { type: 'number', description: 'LP burned percentage' },

  // Risk
  'risk.score': { type: 'number', description: 'Risk/safety score (0-100)' },

  // Holders
  'holders.totalHolders': { type: 'number', description: 'Total holder count' },
  'holders.top10HoldersPercent': { type: 'number', description: 'Top 10 holders percentage' },

  // Contract
  'contract.mintAuthorityRevoked': { type: 'boolean', description: 'Mint authority revoked' },
  'contract.freezeAuthorityRevoked': { type: 'boolean', description: 'Freeze authority revoked' },

  // Token
  'token.symbol': { type: 'string', description: 'Token symbol' },
  'token.name': { type: 'string', description: 'Token name' },

  // Social
  'social.hasTwitter': { type: 'boolean', description: 'Has Twitter/X account' },
  'social.hasTelegram': { type: 'boolean', description: 'Has Telegram group' },
  'social.hasWebsite': { type: 'boolean', description: 'Has website' },

  // Price (from DexScreener)
  'price.priceUsd': { type: 'number', description: 'Current price in USD' },
  'price.priceChange1h': { type: 'number', description: '1-hour price change %' },
  'price.priceChange24h': { type: 'number', description: '24-hour price change %' },
  'price.volume24h': { type: 'number', description: '24-hour volume in USD' },
} as const;

export const DEFAULT_RULES_CONFIG: RulesEngineConfig = {
  enabled: true,
  maxRulesPerUser: 20,
  maxConditionsPerRule: 5,
};

// ============================================
// Alert Rules Engine Class
// ============================================

export class AlertRulesEngine {
  private rules: Map<string, AlertRule> = new Map();
  private config: RulesEngineConfig;

  constructor(config: Partial<RulesEngineConfig> = {}) {
    this.config = { ...DEFAULT_RULES_CONFIG, ...config };
  }

  /**
   * Create a new alert rule
   */
  createRule(
    name: string,
    conditions: RuleCondition[],
    action: RuleAction,
    options: {
      description?: string;
      logicalOperator?: LogicalOperator;
      actionConfig?: AlertRule['actionConfig'];
      chatId?: string;
    } = {}
  ): AlertRule {
    // Validate conditions
    if (conditions.length === 0) {
      throw new Error('At least one condition is required');
    }
    if (conditions.length > this.config.maxConditionsPerRule) {
      throw new Error(`Maximum ${this.config.maxConditionsPerRule} conditions allowed`);
    }

    // Validate fields
    for (const condition of conditions) {
      if (!(condition.field in RULE_FIELDS)) {
        throw new Error(`Invalid field: ${condition.field}`);
      }
    }

    const rule: AlertRule = {
      id: uuidv4(),
      name,
      description: options.description,
      enabled: true,
      conditions,
      logicalOperator: options.logicalOperator || 'AND',
      action,
      actionConfig: options.actionConfig || {},
      createdAt: Date.now(),
      triggeredCount: 0,
      chatId: options.chatId,
    };

    this.rules.set(rule.id, rule);
    logger.info('AlertRulesEngine', `Created rule: ${name} (${rule.id})`);

    return rule;
  }

  /**
   * Update an existing rule
   */
  updateRule(
    id: string,
    updates: Partial<Omit<AlertRule, 'id' | 'createdAt'>>
  ): boolean {
    const rule = this.rules.get(id);
    if (!rule) return false;

    Object.assign(rule, updates, { updatedAt: Date.now() });
    logger.info('AlertRulesEngine', `Updated rule: ${rule.name}`);
    return true;
  }

  /**
   * Delete a rule
   */
  deleteRule(id: string): boolean {
    const rule = this.rules.get(id);
    if (!rule) return false;

    this.rules.delete(id);
    logger.info('AlertRulesEngine', `Deleted rule: ${rule.name}`);
    return true;
  }

  /**
   * Get a rule by ID
   */
  getRule(id: string): AlertRule | undefined {
    return this.rules.get(id);
  }

  /**
   * Get all rules (optionally filtered by chatId)
   */
  getRules(chatId?: string): AlertRule[] {
    const allRules = Array.from(this.rules.values());
    if (chatId) {
      return allRules.filter(r => !r.chatId || r.chatId === chatId);
    }
    return allRules;
  }

  /**
   * Evaluate rules against token analysis
   */
  evaluate(
    analysis: TokenAnalysis,
    dexData?: DexScreenerPair | null,
    chatId?: string
  ): RuleEvaluationResult[] {
    if (!this.config.enabled) {
      return [];
    }

    const results: RuleEvaluationResult[] = [];

    // Build data object for evaluation
    const data = this.buildDataObject(analysis, dexData);

    // Evaluate each applicable rule
    for (const rule of this.rules.values()) {
      // Skip disabled rules
      if (!rule.enabled) continue;

      // Skip rules that don't apply to this chat
      if (rule.chatId && rule.chatId !== chatId) continue;

      const matchedConditions: string[] = [];
      const conditionResults: boolean[] = [];

      // Evaluate each condition
      for (const condition of rule.conditions) {
        const value = this.getFieldValue(data, condition.field);
        const matched = this.evaluateCondition(value, condition.operator, condition.value);
        conditionResults.push(matched);

        if (matched) {
          matchedConditions.push(`${condition.field} ${condition.operator} ${condition.value}`);
        }
      }

      // Combine results based on logical operator
      const ruleMatched =
        rule.logicalOperator === 'AND'
          ? conditionResults.every(r => r)
          : conditionResults.some(r => r);

      if (ruleMatched) {
        // Update rule stats
        rule.triggeredCount++;
        rule.lastTriggeredAt = Date.now();

        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          matched: true,
          action: rule.action,
          actionConfig: rule.actionConfig,
          matchedConditions,
        });

        logger.debug(
          'AlertRulesEngine',
          `Rule "${rule.name}" matched for ${analysis.token?.symbol || 'unknown'}`
        );
      }
    }

    return results;
  }

  /**
   * Build data object from analysis for rule evaluation
   */
  private buildDataObject(
    analysis: TokenAnalysis,
    dexData?: DexScreenerPair | null
  ): Record<string, any> {
    return {
      liquidity: {
        totalLiquidityUsd: analysis.liquidity?.totalLiquidityUsd || 0,
        lpBurnedPercent: analysis.liquidity?.lpBurnedPercent || 0,
      },
      risk: {
        score: analysis.risk?.score || 0,
      },
      holders: {
        totalHolders: analysis.holders?.totalHolders || 0,
        top10HoldersPercent: analysis.holders?.top10HoldersPercent || 0,
      },
      contract: {
        mintAuthorityRevoked: analysis.contract?.mintAuthorityRevoked || false,
        freezeAuthorityRevoked: analysis.contract?.freezeAuthorityRevoked || false,
      },
      token: {
        symbol: analysis.token?.symbol || '',
        name: analysis.token?.name || '',
      },
      social: {
        hasTwitter: analysis.social?.hasTwitter || false,
        hasTelegram: analysis.social?.hasTelegram || false,
        hasWebsite: analysis.social?.hasWebsite || false,
      },
      price: {
        priceUsd: dexData?.priceUsd ? parseFloat(dexData.priceUsd) : 0,
        priceChange1h: dexData?.priceChange?.h1 || 0,
        priceChange24h: dexData?.priceChange?.h24 || 0,
        volume24h: dexData?.volume?.h24 || 0,
      },
    };
  }

  /**
   * Get nested field value from object
   */
  private getFieldValue(data: Record<string, any>, field: string): any {
    const parts = field.split('.');
    let value = data;

    for (const part of parts) {
      if (value === undefined || value === null) return undefined;
      value = value[part];
    }

    return value;
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(
    actual: any,
    operator: ComparisonOperator,
    expected: any
  ): boolean {
    if (actual === undefined || actual === null) {
      return false;
    }

    switch (operator) {
      case '>':
        return Number(actual) > Number(expected);
      case '<':
        return Number(actual) < Number(expected);
      case '>=':
        return Number(actual) >= Number(expected);
      case '<=':
        return Number(actual) <= Number(expected);
      case '==':
        return actual == expected;
      case '!=':
        return actual != expected;
      case 'contains':
        return String(actual).toLowerCase().includes(String(expected).toLowerCase());
      case 'not_contains':
        return !String(actual).toLowerCase().includes(String(expected).toLowerCase());
      default:
        return false;
    }
  }

  /**
   * Get available fields for rule creation
   */
  getAvailableFields(): typeof RULE_FIELDS {
    return RULE_FIELDS;
  }

  /**
   * Create a preset rule (helper)
   */
  createPresetRule(
    preset: 'high_liquidity' | 'whale_alert' | 'rug_risk' | 'pump_detector',
    chatId?: string
  ): AlertRule {
    switch (preset) {
      case 'high_liquidity':
        return this.createRule(
          'High Liquidity Alert',
          [{ field: 'liquidity.totalLiquidityUsd', operator: '>=', value: 100000 }],
          'alert',
          {
            description: 'Alert when token has >$100k liquidity',
            actionConfig: { message: '💰 High liquidity token detected!', priority: 'high' },
            chatId,
          }
        );

      case 'whale_alert':
        return this.createRule(
          'Whale Concentration Alert',
          [{ field: 'holders.top10HoldersPercent', operator: '>=', value: 70 }],
          'alert',
          {
            description: 'Alert when top 10 holders own >70%',
            actionConfig: { message: '🐋 High whale concentration!', priority: 'high' },
            chatId,
          }
        );

      case 'rug_risk':
        return this.createRule(
          'Rug Risk Block',
          [
            { field: 'contract.mintAuthorityRevoked', operator: '==', value: false },
            { field: 'risk.score', operator: '<', value: 30 },
          ],
          'block',
          {
            description: 'Block signals with high rug risk',
            logicalOperator: 'AND',
            actionConfig: { blockReason: 'High rug risk detected' },
            chatId,
          }
        );

      case 'pump_detector':
        return this.createRule(
          'Pump Detector',
          [
            { field: 'price.priceChange1h', operator: '>=', value: 50 },
            { field: 'price.volume24h', operator: '>=', value: 50000 },
          ],
          'alert',
          {
            description: 'Detect potential pumps (>50% 1h gain + volume)',
            logicalOperator: 'AND',
            actionConfig: { message: '🚀 Potential pump detected!', priority: 'high' },
            chatId,
          }
        );

      default:
        throw new Error(`Unknown preset: ${preset}`);
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RulesEngineConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('AlertRulesEngine', `Config updated: enabled=${this.config.enabled}`);
  }

  /**
   * Get configuration
   */
  getConfig(): RulesEngineConfig {
    return { ...this.config };
  }

  /**
   * Load rules from storage
   */
  loadRules(rules: AlertRule[]): void {
    this.rules.clear();
    for (const rule of rules) {
      this.rules.set(rule.id, rule);
    }
    logger.info('AlertRulesEngine', `Loaded ${rules.length} rules`);
  }

  /**
   * Export rules for storage
   */
  exportRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }
}

// Export singleton instance
export const alertRulesEngine = new AlertRulesEngine();
