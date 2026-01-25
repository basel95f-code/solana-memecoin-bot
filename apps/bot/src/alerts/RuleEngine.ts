/**
 * Advanced Alert Rule Engine
 * Flexible condition builder with change-over-time operators
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

// ============================================
// Advanced Rule Types
// ============================================

export type FieldPath = string; // e.g., 'price', 'volume24h', 'liquidity', 'riskScore'

export type ComparisonOperator =
  | '>' | '<' | '>=' | '<=' | '==' | '!='
  | 'contains' | 'not_contains'
  | 'in' | 'not_in';

export type PercentOperator =
  | 'percent_increase' | 'percent_decrease'
  | 'percent_change_abs';

export type TimeframeOperator =
  | 'change_1m' | 'change_5m' | 'change_15m' | 'change_1h' | 'change_24h';

export type CombinatorOperator = 'AND' | 'OR' | 'NOT';

export type AlertPriority = 'low' | 'medium' | 'high' | 'critical';

export interface BaseCondition {
  id: string;
  type: 'simple' | 'percent' | 'timeframe' | 'composite';
}

export interface SimpleCondition extends BaseCondition {
  type: 'simple';
  field: FieldPath;
  operator: ComparisonOperator;
  value: number | string | boolean | string[];
}

export interface PercentCondition extends BaseCondition {
  type: 'percent';
  field: FieldPath;
  operator: PercentOperator;
  threshold: number; // Percentage threshold
  timeframe: '1m' | '5m' | '15m' | '1h' | '24h';
}

export interface TimeframeCondition extends BaseCondition {
  type: 'timeframe';
  field: FieldPath;
  operator: TimeframeOperator;
  compareOperator: ComparisonOperator;
  value: number;
}

export interface CompositeCondition extends BaseCondition {
  type: 'composite';
  combinator: CombinatorOperator;
  conditions: Condition[];
}

export type Condition = SimpleCondition | PercentCondition | TimeframeCondition | CompositeCondition;

export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  
  // Conditions
  rootCondition: Condition;
  
  // Actions & Metadata
  priority: AlertPriority;
  channels: string[]; // Channel IDs to deliver to
  message?: string; // Custom alert message template
  
  // Cooldown & Rate Limiting
  cooldownSeconds: number; // Min time between alerts
  maxAlertsPerHour: number;
  
  // Tracking
  createdAt: number;
  createdBy: string; // userId
  updatedAt?: number;
  lastTriggeredAt?: number;
  triggerCount: number;
  
  // Tags & Metadata
  tags: string[];
  metadata: Record<string, any>;
}

export interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  category: 'discovery' | 'risk' | 'opportunity' | 'whale' | 'custom';
  icon: string;
  buildRule: (params?: Record<string, any>) => Partial<AlertRule>;
}

export interface EvaluationContext {
  tokenMint: string;
  symbol?: string;
  currentData: Record<string, any>;
  historicalData?: Map<string, Record<string, any>>; // timestamp -> data
  timestamp: number;
}

export interface EvaluationResult {
  matched: boolean;
  ruleId: string;
  ruleName: string;
  matchedConditions: string[];
  failedConditions: string[];
  evaluatedAt: number;
}

// ============================================
// Rule Engine
// ============================================

export class RuleEngine {
  private rules: Map<string, AlertRule> = new Map();
  private cooldownCache: Map<string, number> = new Map(); // ruleId:tokenMint -> lastTriggered
  private hourlyTriggers: Map<string, number[]> = new Map(); // ruleId -> timestamps
  
  constructor() {
    logger.info('RuleEngine', 'Initialized advanced rule engine');
  }
  
  // ========================================
  // Rule Management
  // ========================================
  
  createRule(rule: Omit<AlertRule, 'id' | 'createdAt' | 'triggerCount'>): AlertRule {
    const fullRule: AlertRule = {
      ...rule,
      id: uuidv4(),
      createdAt: Date.now(),
      triggerCount: 0,
    };
    
    this.validateRule(fullRule);
    this.rules.set(fullRule.id, fullRule);
    
    logger.info('RuleEngine', `Created rule: ${fullRule.name} (${fullRule.id})`);
    return fullRule;
  }
  
  updateRule(id: string, updates: Partial<Omit<AlertRule, 'id' | 'createdAt' | 'createdBy'>>): AlertRule | null {
    const rule = this.rules.get(id);
    if (!rule) return null;
    
    const updated = {
      ...rule,
      ...updates,
      updatedAt: Date.now(),
    };
    
    this.validateRule(updated);
    this.rules.set(id, updated);
    
    logger.info('RuleEngine', `Updated rule: ${updated.name}`);
    return updated;
  }
  
  deleteRule(id: string): boolean {
    const deleted = this.rules.delete(id);
    if (deleted) {
      logger.info('RuleEngine', `Deleted rule: ${id}`);
      // Clean up cache
      for (const key of this.cooldownCache.keys()) {
        if (key.startsWith(id + ':')) {
          this.cooldownCache.delete(key);
        }
      }
      this.hourlyTriggers.delete(id);
    }
    return deleted;
  }
  
  getRule(id: string): AlertRule | null {
    return this.rules.get(id) || null;
  }
  
  listRules(filter?: { userId?: string; enabled?: boolean; tags?: string[] }): AlertRule[] {
    let rules = Array.from(this.rules.values());
    
    if (filter?.userId) {
      rules = rules.filter(r => r.createdBy === filter.userId);
    }
    
    if (filter?.enabled !== undefined) {
      rules = rules.filter(r => r.enabled === filter.enabled);
    }
    
    if (filter?.tags && filter.tags.length > 0) {
      rules = rules.filter(r => 
        filter.tags!.some(tag => r.tags.includes(tag))
      );
    }
    
    return rules;
  }
  
  toggleRule(id: string): AlertRule | null {
    const rule = this.rules.get(id);
    if (!rule) return null;
    
    rule.enabled = !rule.enabled;
    rule.updatedAt = Date.now();
    
    logger.info('RuleEngine', `Toggled rule ${rule.name}: ${rule.enabled ? 'enabled' : 'disabled'}`);
    return rule;
  }
  
  // ========================================
  // Evaluation
  // ========================================
  
  async evaluate(context: EvaluationContext): Promise<EvaluationResult[]> {
    const results: EvaluationResult[] = [];
    const now = Date.now();
    
    for (const rule of this.rules.values()) {
      // Skip disabled rules
      if (!rule.enabled) continue;
      
      // Check cooldown
      const cooldownKey = `${rule.id}:${context.tokenMint}`;
      const lastTriggered = this.cooldownCache.get(cooldownKey);
      if (lastTriggered && now - lastTriggered < rule.cooldownSeconds * 1000) {
        logger.debug('RuleEngine', `Rule ${rule.name} in cooldown for ${context.symbol || context.tokenMint}`);
        continue;
      }
      
      // Check hourly rate limit
      if (!this.checkRateLimit(rule.id, rule.maxAlertsPerHour)) {
        logger.debug('RuleEngine', `Rule ${rule.name} hit rate limit`);
        continue;
      }
      
      // Evaluate conditions
      const matchedConditions: string[] = [];
      const failedConditions: string[] = [];
      
      const matched = await this.evaluateCondition(
        rule.rootCondition,
        context,
        matchedConditions,
        failedConditions
      );
      
      if (matched) {
        // Update tracking
        this.cooldownCache.set(cooldownKey, now);
        this.recordTrigger(rule.id);
        rule.lastTriggeredAt = now;
        rule.triggerCount++;
        
        results.push({
          matched: true,
          ruleId: rule.id,
          ruleName: rule.name,
          matchedConditions,
          failedConditions,
          evaluatedAt: now,
        });
        
        logger.info('RuleEngine', `Rule "${rule.name}" triggered for ${context.symbol || context.tokenMint}`);
      }
    }
    
    return results;
  }
  
  private async evaluateCondition(
    condition: Condition,
    context: EvaluationContext,
    matchedConditions: string[],
    failedConditions: string[]
  ): Promise<boolean> {
    switch (condition.type) {
      case 'simple':
        return this.evaluateSimple(condition, context, matchedConditions, failedConditions);
      
      case 'percent':
        return this.evaluatePercent(condition, context, matchedConditions, failedConditions);
      
      case 'timeframe':
        return this.evaluateTimeframe(condition, context, matchedConditions, failedConditions);
      
      case 'composite':
        return this.evaluateComposite(condition, context, matchedConditions, failedConditions);
      
      default:
        return false;
    }
  }
  
  private evaluateSimple(
    condition: SimpleCondition,
    context: EvaluationContext,
    matchedConditions: string[],
    failedConditions: string[]
  ): boolean {
    const actual = this.getFieldValue(context.currentData, condition.field);
    const expected = condition.value;
    
    const result = this.compare(actual, condition.operator, expected);
    const desc = `${condition.field} ${condition.operator} ${expected}`;
    
    if (result) {
      matchedConditions.push(desc);
    } else {
      failedConditions.push(desc);
    }
    
    return result;
  }
  
  private evaluatePercent(
    condition: PercentCondition,
    context: EvaluationContext,
    matchedConditions: string[],
    failedConditions: string[]
  ): boolean {
    if (!context.historicalData) {
      failedConditions.push(`${condition.field} percent change (no historical data)`);
      return false;
    }
    
    const timeframeMs = this.timeframeToMs(condition.timeframe);
    const targetTime = context.timestamp - timeframeMs;
    
    // Find closest historical data point
    let closestData: Record<string, any> | null = null;
    let minDiff = Infinity;
    
    for (const [ts, data] of context.historicalData.entries()) {
      const timestamp = parseInt(ts, 10);
      const diff = Math.abs(timestamp - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closestData = data;
      }
    }
    
    if (!closestData) {
      failedConditions.push(`${condition.field} percent change (no data at ${condition.timeframe})`);
      return false;
    }
    
    const currentValue = this.getFieldValue(context.currentData, condition.field);
    const pastValue = this.getFieldValue(closestData, condition.field);
    
    if (typeof currentValue !== 'number' || typeof pastValue !== 'number' || pastValue === 0) {
      failedConditions.push(`${condition.field} percent change (invalid values)`);
      return false;
    }
    
    const percentChange = ((currentValue - pastValue) / pastValue) * 100;
    
    let result = false;
    let desc = '';
    
    switch (condition.operator) {
      case 'percent_increase':
        result = percentChange >= condition.threshold;
        desc = `${condition.field} increased ${percentChange.toFixed(2)}% in ${condition.timeframe} (>= ${condition.threshold}%)`;
        break;
      
      case 'percent_decrease':
        result = percentChange <= -condition.threshold;
        desc = `${condition.field} decreased ${Math.abs(percentChange).toFixed(2)}% in ${condition.timeframe} (>= ${condition.threshold}%)`;
        break;
      
      case 'percent_change_abs':
        result = Math.abs(percentChange) >= condition.threshold;
        desc = `${condition.field} changed ${Math.abs(percentChange).toFixed(2)}% in ${condition.timeframe} (>= ${condition.threshold}%)`;
        break;
    }
    
    if (result) {
      matchedConditions.push(desc);
    } else {
      failedConditions.push(desc);
    }
    
    return result;
  }
  
  private evaluateTimeframe(
    condition: TimeframeCondition,
    context: EvaluationContext,
    matchedConditions: string[],
    failedConditions: string[]
  ): boolean {
    if (!context.historicalData) {
      failedConditions.push(`${condition.field} change (no historical data)`);
      return false;
    }
    
    const timeframe = condition.operator.replace('change_', '');
    const timeframeMs = this.timeframeToMs(timeframe as any);
    const targetTime = context.timestamp - timeframeMs;
    
    // Find closest historical data point
    let closestData: Record<string, any> | null = null;
    let minDiff = Infinity;
    
    for (const [ts, data] of context.historicalData.entries()) {
      const timestamp = parseInt(ts, 10);
      const diff = Math.abs(timestamp - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closestData = data;
      }
    }
    
    if (!closestData) {
      failedConditions.push(`${condition.field} change (no data at timeframe)`);
      return false;
    }
    
    const currentValue = this.getFieldValue(context.currentData, condition.field);
    const pastValue = this.getFieldValue(closestData, condition.field);
    
    if (typeof currentValue !== 'number' || typeof pastValue !== 'number') {
      failedConditions.push(`${condition.field} change (invalid values)`);
      return false;
    }
    
    const change = currentValue - pastValue;
    const result = this.compare(change, condition.compareOperator, condition.value);
    const desc = `${condition.field} ${timeframe} change ${condition.compareOperator} ${condition.value}`;
    
    if (result) {
      matchedConditions.push(desc);
    } else {
      failedConditions.push(desc);
    }
    
    return result;
  }
  
  private async evaluateComposite(
    condition: CompositeCondition,
    context: EvaluationContext,
    matchedConditions: string[],
    failedConditions: string[]
  ): Promise<boolean> {
    const results: boolean[] = [];
    
    for (const subCondition of condition.conditions) {
      const result = await this.evaluateCondition(
        subCondition,
        context,
        matchedConditions,
        failedConditions
      );
      results.push(result);
    }
    
    switch (condition.combinator) {
      case 'AND':
        return results.every(r => r);
      case 'OR':
        return results.some(r => r);
      case 'NOT':
        return !results[0]; // NOT only applies to first condition
      default:
        return false;
    }
  }
  
  // ========================================
  // Helper Methods
  // ========================================
  
  private compare(actual: any, operator: ComparisonOperator, expected: any): boolean {
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
      case 'in':
        return Array.isArray(expected) && expected.includes(actual);
      case 'not_in':
        return Array.isArray(expected) && !expected.includes(actual);
      default:
        return false;
    }
  }
  
  private getFieldValue(data: Record<string, any>, path: string): any {
    const parts = path.split('.');
    let value: any = data;
    
    for (const part of parts) {
      if (value === undefined || value === null) return undefined;
      value = value[part];
    }
    
    return value;
  }
  
  private timeframeToMs(timeframe: '1m' | '5m' | '15m' | '1h' | '24h'): number {
    const map: Record<string, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
    };
    return map[timeframe] || 0;
  }
  
  private checkRateLimit(ruleId: string, maxPerHour: number): boolean {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    
    let triggers = this.hourlyTriggers.get(ruleId) || [];
    // Remove old triggers
    triggers = triggers.filter(t => t > hourAgo);
    
    return triggers.length < maxPerHour;
  }
  
  private recordTrigger(ruleId: string): void {
    const triggers = this.hourlyTriggers.get(ruleId) || [];
    triggers.push(Date.now());
    
    // Keep only last hour
    const hourAgo = Date.now() - 60 * 60 * 1000;
    this.hourlyTriggers.set(ruleId, triggers.filter(t => t > hourAgo));
  }
  
  private validateRule(rule: AlertRule): void {
    if (!rule.name || rule.name.trim().length === 0) {
      throw new Error('Rule name is required');
    }
    
    if (!rule.rootCondition) {
      throw new Error('Rule must have at least one condition');
    }
    
    if (rule.channels.length === 0) {
      throw new Error('Rule must have at least one channel');
    }
    
    if (rule.cooldownSeconds < 0) {
      throw new Error('Cooldown must be non-negative');
    }
    
    if (rule.maxAlertsPerHour < 1) {
      throw new Error('Max alerts per hour must be at least 1');
    }
  }
  
  // ========================================
  // Persistence
  // ========================================
  
  exportRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }
  
  importRules(rules: AlertRule[]): void {
    this.rules.clear();
    for (const rule of rules) {
      this.rules.set(rule.id, rule);
    }
    logger.info('RuleEngine', `Imported ${rules.length} rules`);
  }
}

export const ruleEngine = new RuleEngine();
