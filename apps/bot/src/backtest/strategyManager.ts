/**
 * Strategy Manager
 * CRUD operations for custom backtest strategies
 */

import { database } from '../database';
import type {
  BacktestStrategy,
  EntryConditions,
  ExitConditions,
  PositionSizing
} from './types';
import { PRESET_STRATEGIES, getPresetStrategy } from './presets';
import { validateStrategy } from './engine';
import { logger } from '../utils/logger';

/**
 * Strategy creation wizard state
 */
export interface StrategyWizardState {
  step: 'name' | 'entry' | 'exit' | 'sizing' | 'confirm';
  name?: string;
  description?: string;
  entry: Partial<EntryConditions>;
  exit: Partial<ExitConditions>;
  sizing: Partial<PositionSizing>;
}

/**
 * Create initial wizard state
 */
export function createWizardState(): StrategyWizardState {
  return {
    step: 'name',
    entry: {},
    exit: {
      takeProfitLevels: [],
      stopLossPercent: -25, // Default
    },
    sizing: {
      method: 'percent_of_capital',
      percentOfCapital: 5,
    },
  };
}

class StrategyManager {
  /**
   * Get all strategies (presets + custom)
   */
  getAllStrategies(): BacktestStrategy[] {
    const presets = PRESET_STRATEGIES;
    const custom = database.getAllBacktestStrategies().filter(s => !s.isPreset);
    return [...presets, ...custom];
  }

  /**
   * Get strategy by name
   */
  getStrategy(name: string): BacktestStrategy | null {
    // Check presets first
    const preset = getPresetStrategy(name);
    if (preset) return preset;

    // Check database
    return database.getBacktestStrategy(name);
  }

  /**
   * Create a new custom strategy
   */
  createStrategy(strategy: BacktestStrategy): { success: boolean; errors: string[]; id?: number } {
    // Validate name
    if (!strategy.name || strategy.name.trim().length === 0) {
      return { success: false, errors: ['Strategy name is required'] };
    }

    // Check for duplicate name
    const existing = this.getStrategy(strategy.name);
    if (existing) {
      return { success: false, errors: [`Strategy "${strategy.name}" already exists`] };
    }

    // Validate strategy configuration
    const errors = validateStrategy(strategy);
    if (errors.length > 0) {
      return { success: false, errors };
    }

    // Save to database
    const id = database.saveBacktestStrategy({
      ...strategy,
      isPreset: false,
      createdAt: Math.floor(Date.now() / 1000),
    });

    if (id > 0) {
      logger.info('StrategyManager', `Created strategy: ${strategy.name}`);
      return { success: true, errors: [], id };
    }

    return { success: false, errors: ['Failed to save strategy to database'] };
  }

  /**
   * Update an existing custom strategy
   */
  updateStrategy(name: string, updates: Partial<BacktestStrategy>): { success: boolean; errors: string[] } {
    const existing = database.getBacktestStrategy(name);
    if (!existing) {
      return { success: false, errors: [`Strategy "${name}" not found`] };
    }

    if (existing.isPreset) {
      return { success: false, errors: ['Cannot modify preset strategies'] };
    }

    const updated: BacktestStrategy = {
      ...existing,
      ...updates,
      name: existing.name, // Don't allow name changes
      isPreset: false,
      updatedAt: Math.floor(Date.now() / 1000),
    };

    const errors = validateStrategy(updated);
    if (errors.length > 0) {
      return { success: false, errors };
    }

    database.saveBacktestStrategy(updated);
    logger.info('StrategyManager', `Updated strategy: ${name}`);
    return { success: true, errors: [] };
  }

  /**
   * Delete a custom strategy
   */
  deleteStrategy(name: string): { success: boolean; error?: string } {
    const existing = database.getBacktestStrategy(name);
    if (!existing) {
      return { success: false, error: `Strategy "${name}" not found` };
    }

    if (existing.isPreset) {
      return { success: false, error: 'Cannot delete preset strategies' };
    }

    database.deleteBacktestStrategy(name);
    logger.info('StrategyManager', `Deleted strategy: ${name}`);
    return { success: true };
  }

  /**
   * Clone an existing strategy
   */
  cloneStrategy(sourceName: string, newName: string): { success: boolean; errors: string[]; id?: number } {
    const source = this.getStrategy(sourceName);
    if (!source) {
      return { success: false, errors: [`Strategy "${sourceName}" not found`] };
    }

    const cloned: BacktestStrategy = {
      ...source,
      id: undefined,
      name: newName,
      description: `Clone of ${source.name}: ${source.description}`,
      isPreset: false,
      createdAt: undefined,
      updatedAt: undefined,
    };

    return this.createStrategy(cloned);
  }

  /**
   * Build a strategy from wizard state
   */
  buildFromWizard(state: StrategyWizardState): BacktestStrategy | null {
    if (!state.name) return null;

    // Ensure we have at least one take profit level
    const takeProfitLevels = state.exit.takeProfitLevels || [];
    if (takeProfitLevels.length === 0) {
      takeProfitLevels.push({ percent: 100, sellPercent: 100 }); // Default: 2x, sell all
    }

    const strategy: BacktestStrategy = {
      name: state.name,
      description: state.description || `Custom strategy: ${state.name}`,
      entry: state.entry as EntryConditions,
      exit: {
        takeProfitLevels,
        stopLossPercent: state.exit.stopLossPercent ?? -25,
        trailingStopPercent: state.exit.trailingStopPercent,
        trailingStopActivation: state.exit.trailingStopActivation,
        maxHoldTimeHours: state.exit.maxHoldTimeHours,
        exitOnRugSignal: state.exit.exitOnRugSignal ?? true,
      },
      sizing: {
        method: state.sizing.method || 'percent_of_capital',
        percentOfCapital: state.sizing.percentOfCapital,
        fixedAmount: state.sizing.fixedAmount,
        maxPositionSize: state.sizing.maxPositionSize,
        maxConcurrentPositions: state.sizing.maxConcurrentPositions,
      },
    };

    return strategy;
  }

  /**
   * Parse entry conditions from text input
   */
  parseEntryInput(input: string): Partial<EntryConditions> {
    const conditions: Partial<EntryConditions> = {};
    const lower = input.toLowerCase();

    // Parse risk score (e.g., "risk 50+" or "risk 30-70")
    const riskMatch = lower.match(/risk\s*(\d+)(?:\s*[-+]?\s*(\d+)?)?/);
    if (riskMatch) {
      conditions.minRiskScore = parseInt(riskMatch[1]);
      if (riskMatch[2]) {
        conditions.maxRiskScore = parseInt(riskMatch[2]);
      }
    }

    // Parse liquidity (e.g., "liq 5k+" or "liquidity $10000")
    const liqMatch = lower.match(/(?:liq|liquidity)\s*\$?(\d+)([km])?/i);
    if (liqMatch) {
      let amount = parseInt(liqMatch[1]);
      if (liqMatch[2]?.toLowerCase() === 'k') amount *= 1000;
      if (liqMatch[2]?.toLowerCase() === 'm') amount *= 1000000;
      conditions.minLiquidity = amount;
    }

    // Parse holders (e.g., "holders 50+" or "50+ holders")
    const holdersMatch = lower.match(/(?:holders?\s*)?(\d+)\+?\s*(?:holders?)?/);
    if (holdersMatch && lower.includes('holder')) {
      conditions.minHolders = parseInt(holdersMatch[1]);
    }

    // Parse safety requirements
    if (lower.includes('mint revoked') || lower.includes('revoke mint')) {
      conditions.requireMintRevoked = true;
    }
    if (lower.includes('freeze revoked') || lower.includes('revoke freeze')) {
      conditions.requireFreezeRevoked = true;
    }
    if (lower.includes('lp burned') || lower.includes('burned lp')) {
      conditions.requireLPBurned = true;
    }
    if (lower.includes('social') || lower.includes('twitter') || lower.includes('telegram')) {
      conditions.requireSocials = true;
    }

    return conditions;
  }

  /**
   * Parse exit conditions from text input
   */
  parseExitInput(input: string): Partial<ExitConditions> {
    const conditions: Partial<ExitConditions> = {
      takeProfitLevels: [],
    };
    const lower = input.toLowerCase();

    // Parse take profit levels (e.g., "tp 50% 100% 200%" or "take profit at 2x 3x")
    const tpMatches = lower.matchAll(/(?:tp|take\s*profit)?\s*(\d+)(?:%|x)/gi);
    for (const match of tpMatches) {
      let percent = parseInt(match[1]);
      // If using "x" notation (2x, 3x), convert to percent
      if (match[0].includes('x') && percent <= 20) {
        percent = (percent - 1) * 100;
      }
      conditions.takeProfitLevels!.push({
        percent,
        sellPercent: 50, // Default to 50% sell at each level
      });
    }

    // Adjust sell percentages - last level should be 100%
    if (conditions.takeProfitLevels!.length > 0) {
      const levels = conditions.takeProfitLevels!;
      levels[levels.length - 1].sellPercent = 100;
    }

    // Parse stop loss (e.g., "sl -20%" or "stop loss 30%")
    const slMatch = lower.match(/(?:sl|stop\s*loss)\s*-?(\d+)/);
    if (slMatch) {
      conditions.stopLossPercent = -Math.abs(parseInt(slMatch[1]));
    }

    // Parse trailing stop (e.g., "trailing 15%")
    const trailMatch = lower.match(/trail(?:ing)?\s*(\d+)/);
    if (trailMatch) {
      conditions.trailingStopPercent = parseInt(trailMatch[1]);
    }

    return conditions;
  }

  /**
   * Format strategy summary for display
   */
  formatStrategySummary(strategy: BacktestStrategy): string {
    const lines: string[] = [
      `*${strategy.name}*`,
      strategy.description || '',
      '',
    ];

    // Entry conditions
    lines.push('*Entry Conditions:*');
    if (strategy.entry.minRiskScore !== undefined) {
      lines.push(`  Risk Score: ${strategy.entry.minRiskScore}+`);
    }
    if (strategy.entry.minLiquidity !== undefined) {
      lines.push(`  Min Liquidity: $${strategy.entry.minLiquidity.toLocaleString()}`);
    }
    if (strategy.entry.minHolders !== undefined) {
      lines.push(`  Min Holders: ${strategy.entry.minHolders}`);
    }
    if (strategy.entry.requireMintRevoked) {
      lines.push(`  Mint Revoked: Required`);
    }
    if (strategy.entry.requireLPBurned) {
      lines.push(`  LP Burned: Required`);
    }

    // Exit conditions
    lines.push('');
    lines.push('*Exit Conditions:*');
    for (const tp of strategy.exit.takeProfitLevels) {
      lines.push(`  TP ${tp.percent}%: Sell ${tp.sellPercent}%`);
    }
    lines.push(`  Stop Loss: ${strategy.exit.stopLossPercent}%`);
    if (strategy.exit.trailingStopPercent) {
      lines.push(`  Trailing Stop: ${strategy.exit.trailingStopPercent}%`);
    }

    // Position sizing
    lines.push('');
    lines.push('*Position Sizing:*');
    lines.push(`  Method: ${strategy.sizing.method.replace('_', ' ')}`);
    if (strategy.sizing.percentOfCapital) {
      lines.push(`  Size: ${strategy.sizing.percentOfCapital}% of capital`);
    }
    if (strategy.sizing.maxPositionSize) {
      lines.push(`  Max: $${strategy.sizing.maxPositionSize}`);
    }

    return lines.join('\n');
  }
}

export const strategyManager = new StrategyManager();
