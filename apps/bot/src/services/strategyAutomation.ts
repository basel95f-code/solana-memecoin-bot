/**
 * Strategy Automation Service
 * Automates the complete pipeline: Discovery → Analysis → Decision → Action
 */

import { database } from '../database';
import { contractAnalyzer } from '../analysis/contractAnalyzer';
import { analyzeSentiment } from '../analysis/sentimentAnalysis';
import { rugPredictor } from '../ml/rugPredictor';
import { dexScreenerService } from './dexscreener';
import { telegramService } from './telegram';
import { logger } from '../utils/logger';
import type { TokenAnalysis } from '../types';

export type AutomationAction = 'alert' | 'categorize' | 'generate_signal' | 'auto_trade' | 'blacklist';
export type TokenCategory = 'gem' | 'watch' | 'avoid' | 'unknown';

export interface StrategyRule {
  id?: number;
  name: string;
  description: string;
  enabled: boolean;
  priority: number; // Higher = runs first
  
  // Conditions (ALL must be true)
  conditions: StrategyCondition[];
  
  // Actions to take when conditions met
  actions: StrategyActionConfig[];
  
  // Metadata
  matchCount: number;
  successCount: number;
  createdAt: number;
}

export interface StrategyCondition {
  type: 'scanner_match' | 'ml_confidence' | 'risk_score' | 'sentiment' | 'security' | 'liquidity' | 'holders';
  operator: '>' | '<' | '=' | '>=' | '<=' | '!=';
  value: number | string | boolean;
  // Optional sub-conditions
  field?: string; // e.g., 'filter_name' for scanner_match
}

export interface StrategyActionConfig {
  type: AutomationAction;
  params?: Record<string, any>;
}

export interface AutomationDecision {
  tokenMint: string;
  symbol: string;
  category: TokenCategory;
  confidence: number;
  reasons: string[];
  actions: AutomationAction[];
  ruleName?: string;
  timestamp: number;
}

class StrategyAutomation {
  private rules: Map<number, StrategyRule> = new Map();
  private isRunning: boolean = false;

  /**
   * Initialize and load rules
   */
  async initialize(): Promise<void> {
    this.loadRules();
    logger.info('StrategyAutomation', `Loaded ${this.rules.size} automation rules`);
  }

  /**
   * Load rules from database
   */
  private loadRules(): void {
    const rows = database.all<any>(
      'SELECT * FROM automation_rules WHERE enabled = 1 ORDER BY priority DESC'
    );

    for (const row of rows) {
      const rule: StrategyRule = {
        id: row.id,
        name: row.name,
        description: row.description,
        enabled: row.enabled === 1,
        priority: row.priority,
        conditions: JSON.parse(row.conditions || '[]'),
        actions: JSON.parse(row.actions || '[]'),
        matchCount: row.match_count || 0,
        successCount: row.success_count || 0,
        createdAt: row.created_at,
      };

      this.rules.set(rule.id!, rule);
    }
  }

  /**
   * Process a token through automation pipeline
   */
  async processToken(analysis: TokenAnalysis): Promise<AutomationDecision> {
    const decision: AutomationDecision = {
      tokenMint: analysis.token.mint,
      symbol: analysis.token.symbol,
      category: 'unknown',
      confidence: 0,
      reasons: [],
      actions: [],
      timestamp: Date.now(),
    };

    try {
      // Gather additional data (first batch - no dependencies)
      const [sentiment, securityAnalysis, pairData] = await Promise.all([
        this.getSentiment(analysis.token).catch(() => null),
        contractAnalyzer.analyzeContract(analysis.token.mint).catch(() => null),
        dexScreenerService.getTokenData(analysis.token.mint).catch(() => null),
      ]);

      // Get ML prediction after we have pairData
      const mlPrediction = await this.getMLPrediction(analysis, pairData).catch(() => null);

      // Build context for rule evaluation
      const context = {
        analysis,
        sentiment,
        securityAnalysis,
        pairData,
        mlPrediction,
      };

      // Evaluate rules in priority order
      for (const [, rule] of this.rules) {
        if (!rule.enabled) continue;

        const matches = this.evaluateRule(rule, context);
        
        if (matches) {
          // Rule matched - execute actions
          decision.ruleName = rule.name;
          decision.reasons.push(`Matched rule: ${rule.name}`);

          for (const actionConfig of rule.actions) {
            await this.executeAction(actionConfig, analysis, decision);
          }

          // Update rule stats
          this.updateRuleStats(rule.id!, true);

          // Stop after first match (highest priority wins)
          break;
        }
      }

      // Fallback categorization if no rule matched
      if (decision.category === 'unknown') {
        decision.category = this.defaultCategorize(analysis, mlPrediction, securityAnalysis);
        decision.reasons.push('Default categorization (no rules matched)');
      }

      // Record decision
      this.recordDecision(decision);

    } catch (error) {
      logger.error('StrategyAutomation', 'Token processing failed', error as Error);
      decision.reasons.push(`Processing error: ${(error as Error).message}`);
    }

    return decision;
  }

  /**
   * Evaluate if a rule matches the current context
   */
  private evaluateRule(rule: StrategyRule, context: any): boolean {
    // All conditions must be true (AND logic)
    for (const condition of rule.conditions) {
      if (!this.evaluateCondition(condition, context)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(condition: StrategyCondition, context: any): boolean {
    let actualValue: any;

    switch (condition.type) {
      case 'ml_confidence':
        actualValue = context.mlPrediction?.confidence || 0;
        break;
      case 'risk_score':
        actualValue = context.analysis.risk.score;
        break;
      case 'sentiment':
        actualValue = context.sentiment?.sentimentScore || 0;
        break;
      case 'security':
        actualValue = context.securityAnalysis?.securityScore || 0;
        break;
      case 'liquidity':
        actualValue = context.analysis.liquidity.totalLiquidityUsd;
        break;
      case 'holders':
        actualValue = context.analysis.holders.totalHolders;
        break;
      case 'scanner_match':
        // Check if token matched a scanner filter
        const matches = database.get<any>(
          'SELECT * FROM scan_matches WHERE token_mint = ? AND filter_name = ?',
          [context.analysis.token.mint, condition.value]
        );
        return matches !== undefined;
      default:
        return false;
    }

    // Compare using operator
    switch (condition.operator) {
      case '>': return actualValue > condition.value;
      case '<': return actualValue < condition.value;
      case '>=': return actualValue >= condition.value;
      case '<=': return actualValue <= condition.value;
      case '=': return actualValue === condition.value;
      case '!=': return actualValue !== condition.value;
      default: return false;
    }
  }

  /**
   * Execute an action
   */
  private async executeAction(
    actionConfig: StrategyActionConfig,
    analysis: TokenAnalysis,
    decision: AutomationDecision
  ): Promise<void> {
    decision.actions.push(actionConfig.type);

    switch (actionConfig.type) {
      case 'alert':
        await this.sendAlert(analysis, decision, actionConfig.params);
        break;

      case 'categorize':
        const category = (actionConfig.params?.category || 'watch') as TokenCategory;
        decision.category = category;
        decision.reasons.push(`Categorized as: ${category}`);
        break;

      case 'generate_signal':
        decision.reasons.push('Signal generation triggered');
        // Signal generation happens in signal service
        break;

      case 'blacklist':
        database.run(
          'INSERT OR IGNORE INTO blacklist (token_mint, reason, added_at) VALUES (?, ?, ?)',
          [analysis.token.mint, 'Auto-blacklisted by strategy', Date.now()]
        );
        decision.category = 'avoid';
        decision.reasons.push('Added to blacklist');
        break;

      case 'auto_trade':
        // Would trigger auto-trading logic here
        decision.reasons.push('Auto-trade triggered (not implemented yet)');
        break;
    }
  }

  /**
   * Send alert via Telegram
   */
  private async sendAlert(
    analysis: TokenAnalysis,
    decision: AutomationDecision,
    params?: Record<string, any>
  ): Promise<void> {
    const emoji = {
      gem: '💎',
      watch: '👀',
      avoid: '🚫',
      unknown: '❓',
    }[decision.category];

    let message = `${emoji} <b>Automation Alert: ${decision.ruleName}</b>\n\n`;
    message += `<b>${analysis.token.symbol}</b>\n`;
    message += `Category: ${decision.category}\n`;
    message += `Confidence: ${(decision.confidence * 100).toFixed(0)}%\n\n`;
    message += `<b>Reasons:</b>\n`;
    for (const reason of decision.reasons) {
      message += `• ${reason}\n`;
    }
    message += `\n<code>${analysis.token.mint}</code>`;

    await telegramService.sendMessage(message);
  }

  /**
   * Get sentiment analysis
   */
  private async getSentiment(token: any): Promise<any> {
    return await analyzeSentiment(token);
  }

  /**
   * Get ML prediction
   */
  private async getMLPrediction(analysis: TokenAnalysis, pairData: any): Promise<any> {
    return await rugPredictor.predictEnhanced({
      liquidityUsd: analysis.liquidity.totalLiquidityUsd,
      riskScore: analysis.risk.score,
      holderCount: analysis.holders.totalHolders,
      top10Percent: analysis.holders.top10HoldersPercent,
      mintRevoked: analysis.contract.mintAuthorityRevoked,
      freezeRevoked: analysis.contract.freezeAuthorityRevoked,
      lpBurnedPercent: analysis.liquidity.lpBurnedPercent,
      hasSocials: analysis.social.hasTwitter || analysis.social.hasTelegram,
      tokenAgeHours: 1,
      priceChange1h: pairData?.priceChange?.h1,
      priceChange24h: pairData?.priceChange?.h24,
    });
  }

  /**
   * Default categorization logic
   */
  private defaultCategorize(
    analysis: TokenAnalysis,
    mlPrediction: any,
    securityAnalysis: any
  ): TokenCategory {
    // Avoid if security is dangerous
    if (securityAnalysis?.safetyLevel === 'dangerous') {
      return 'avoid';
    }

    // Avoid if high rug probability
    if (mlPrediction && mlPrediction.rugProbability > 0.7) {
      return 'avoid';
    }

    // Gem if high risk score, safe, and good ML
    if (
      analysis.risk.score >= 70 &&
      securityAnalysis?.safetyLevel === 'safe' &&
      mlPrediction?.rugProbability < 0.3
    ) {
      return 'gem';
    }

    // Watch for everything else decent
    if (analysis.risk.score >= 50) {
      return 'watch';
    }

    return 'avoid';
  }

  /**
   * Update rule statistics
   */
  private updateRuleStats(ruleId: number, success: boolean): void {
    database.run(
      `UPDATE automation_rules SET 
        match_count = match_count + 1,
        success_count = success_count + ?
      WHERE id = ?`,
      [success ? 1 : 0, ruleId]
    );
  }

  /**
   * Record decision in database
   */
  private recordDecision(decision: AutomationDecision): void {
    database.run(
      `INSERT INTO automation_decisions (
        token_mint, symbol, category, confidence,
        reasons, actions, rule_name, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        decision.tokenMint,
        decision.symbol,
        decision.category,
        decision.confidence,
        JSON.stringify(decision.reasons),
        JSON.stringify(decision.actions),
        decision.ruleName || null,
        decision.timestamp,
      ]
    );
  }

  /**
   * Add a new strategy rule
   */
  addRule(rule: Omit<StrategyRule, 'id' | 'matchCount' | 'successCount' | 'createdAt'>): number {
    const result = database.run(
      `INSERT INTO automation_rules (
        name, description, enabled, priority,
        conditions, actions, match_count, success_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      [
        rule.name,
        rule.description,
        rule.enabled ? 1 : 0,
        rule.priority,
        JSON.stringify(rule.conditions),
        JSON.stringify(rule.actions),
        Date.now(),
      ]
    );

    logger.info('StrategyAutomation', `Added rule: ${rule.name}`);
    this.loadRules(); // Reload
    return result.lastInsertRowid;
  }

  /**
   * Create preset rules
   */
  createPresetRules(): void {
    // Rule 1: Gem Finder Match + High Confidence = Alert & Categorize
    this.addRule({
      name: 'High-Confidence Gem',
      description: 'Scanner found a gem with high ML confidence',
      enabled: true,
      priority: 100,
      conditions: [
        { type: 'scanner_match', operator: '=', value: 'Gem Finder', field: 'filter_name' },
        { type: 'ml_confidence', operator: '>', value: 0.7 },
        { type: 'security', operator: '>', value: 60 },
      ],
      actions: [
        { type: 'categorize', params: { category: 'gem' } },
        { type: 'alert', params: { priority: 'high' } },
        { type: 'generate_signal' },
      ],
    });

    // Rule 2: Dangerous Security = Blacklist
    this.addRule({
      name: 'Security Threat',
      description: 'Token failed security analysis',
      enabled: true,
      priority: 200, // Higher priority
      conditions: [
        { type: 'security', operator: '<', value: 30 },
      ],
      actions: [
        { type: 'blacklist' },
        { type: 'categorize', params: { category: 'avoid' } },
      ],
    });

    // Rule 3: High Sentiment + Good Risk = Watch
    this.addRule({
      name: 'Positive Sentiment',
      description: 'Good sentiment and decent risk score',
      enabled: true,
      priority: 50,
      conditions: [
        { type: 'sentiment', operator: '>', value: 0.5 },
        { type: 'risk_score', operator: '>', value: 60 },
      ],
      actions: [
        { type: 'categorize', params: { category: 'watch' } },
        { type: 'alert', params: { priority: 'medium' } },
      ],
    });

    logger.info('StrategyAutomation', 'Created preset rules');
  }

  /**
   * Get rule statistics
   */
  getRuleStats(): Array<{ name: string; matches: number; success: number; winRate: number }> {
    const rules = Array.from(this.rules.values());
    return rules.map(rule => ({
      name: rule.name,
      matches: rule.matchCount,
      success: rule.successCount,
      winRate: rule.matchCount > 0 ? (rule.successCount / rule.matchCount) * 100 : 0,
    }));
  }
}

// Export singleton
export const strategyAutomation = new StrategyAutomation();
