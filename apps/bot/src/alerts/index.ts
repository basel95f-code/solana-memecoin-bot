/**
 * Alert System - Main Exports
 * Multi-channel alert delivery with rule engine
 */

// Main system
export { AlertSystem, getAlertSystem, initializeAlertSystem } from './AlertSystem';
export type { AlertSystemConfig } from './AlertSystem';

// Rule engine
export { RuleEngine, ruleEngine } from './RuleEngine';
export type {
  AlertRule,
  Condition,
  SimpleCondition,
  PercentCondition,
  TimeframeCondition,
  CompositeCondition,
  EvaluationContext,
  EvaluationResult,
  RuleTemplate,
  AlertPriority as RulePriority,
} from './RuleEngine';

// Dispatcher
export { Dispatcher } from './Dispatcher';
export type { DispatchConfig, DispatchResult } from './Dispatcher';

// Templates
export * from './templates';
