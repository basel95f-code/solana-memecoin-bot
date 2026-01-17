/**
 * Backtesting Framework
 * Test trading strategies against historical token data
 */

// Export types
export * from './types';

// Export engine
export { runBacktest, validateStrategy } from './engine';

// Export metrics
export { calculateMetrics, formatResultsSummary } from './metrics';

// Export presets
export {
  PRESET_STRATEGIES,
  CONSERVATIVE_TRADER,
  DEGEN_SNIPER,
  SMART_MONEY_FOLLOWER,
  getPresetStrategy,
  getPresetNames,
  formatPresetInfo,
} from './presets';

// Export strategy manager
export {
  strategyManager,
  StrategyWizardState,
  createWizardState,
} from './strategyManager';

// Export snapshot collector
export {
  snapshotCollector,
  TokenSnapshot,
  WatchedToken,
} from './snapshotCollector';
