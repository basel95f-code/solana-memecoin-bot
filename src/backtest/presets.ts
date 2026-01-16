/**
 * Preset Backtest Strategies
 * Pre-configured strategies for common trading approaches
 */

import type { BacktestStrategy } from './types';

/**
 * Conservative Trader Strategy
 * - High risk score requirement (70+)
 * - LP must be burned
 * - Moderate take profits with tight stop loss
 * - Good for risk-averse traders
 */
export const CONSERVATIVE_TRADER: BacktestStrategy = {
  name: 'conservative_trader',
  description: 'Safe plays with high risk scores, burned LP. TP at 50%/100%, SL -20%.',
  isPreset: true,
  entry: {
    minRiskScore: 70,
    minLiquidity: 5000,
    minHolders: 50,
    maxTop10Percent: 40,
    requireMintRevoked: true,
    requireFreezeRevoked: true,
    requireLPBurned: true,
    lpBurnedMinPercent: 50,
  },
  exit: {
    takeProfitLevels: [
      { percent: 50, sellPercent: 50 },   // Sell 50% at 1.5x
      { percent: 100, sellPercent: 100 }, // Sell remaining at 2x
    ],
    stopLossPercent: -20,
    trailingStopPercent: 15,
    trailingStopActivation: 30, // Activate trailing after 30% gain
    exitOnRugSignal: true,
  },
  sizing: {
    method: 'percent_of_capital',
    percentOfCapital: 5,
    maxPositionSize: 1000,
    maxConcurrentPositions: 10,
  },
};

/**
 * Degen Sniper Strategy
 * - Very low risk score tolerance
 * - Catches tokens early (< 5 min old)
 * - High take profits, wide stop loss
 * - High risk, high reward approach
 */
export const DEGEN_SNIPER: BacktestStrategy = {
  name: 'degen_sniper',
  description: 'Early entry degen plays. Risk 20+, <5min old. TP 100%/300%/500%, SL -50%.',
  isPreset: true,
  entry: {
    minRiskScore: 20,
    minLiquidity: 500,
    minHolders: 5,
    maxTokenAge: 300, // 5 minutes
    requireMintRevoked: false, // Don't wait for revoke
    requireFreezeRevoked: false,
    requireLPBurned: false,
  },
  exit: {
    takeProfitLevels: [
      { percent: 100, sellPercent: 30 },  // Sell 30% at 2x
      { percent: 300, sellPercent: 40 },  // Sell 40% at 4x
      { percent: 500, sellPercent: 100 }, // Sell remaining at 6x
    ],
    stopLossPercent: -50,
    maxHoldTimeHours: 24, // Exit after 24 hours max
    exitOnRugSignal: true,
  },
  sizing: {
    method: 'percent_of_capital',
    percentOfCapital: 2, // Smaller position due to high risk
    maxPositionSize: 500,
    maxConcurrentPositions: 20,
  },
};

/**
 * Smart Money Follower Strategy
 * - Requires smart money buys
 * - Follows whale activity
 * - Moderate take profits with trailing stop
 */
export const SMART_MONEY_FOLLOWER: BacktestStrategy = {
  name: 'smart_money_follower',
  description: 'Follow smart money. 3+ smart buys required. TP 75%/150%, trailing stop.',
  isPreset: true,
  entry: {
    minRiskScore: 40,
    minLiquidity: 3000,
    minHolders: 30,
    maxTop10Percent: 50,
    minSmartBuys: 3,
    requireMintRevoked: true,
  },
  exit: {
    takeProfitLevels: [
      { percent: 75, sellPercent: 40 },   // Sell 40% at 1.75x
      { percent: 150, sellPercent: 100 }, // Sell remaining at 2.5x
    ],
    stopLossPercent: -25,
    trailingStopPercent: 20,
    trailingStopActivation: 50, // Activate after 50% gain
    exitOnRugSignal: true,
  },
  sizing: {
    method: 'percent_of_capital',
    percentOfCapital: 4,
    maxPositionSize: 800,
    maxConcurrentPositions: 15,
  },
};

/**
 * All preset strategies
 */
export const PRESET_STRATEGIES: BacktestStrategy[] = [
  CONSERVATIVE_TRADER,
  DEGEN_SNIPER,
  SMART_MONEY_FOLLOWER,
];

/**
 * Get preset by name
 */
export function getPresetStrategy(name: string): BacktestStrategy | undefined {
  return PRESET_STRATEGIES.find(s => s.name.toLowerCase() === name.toLowerCase());
}

/**
 * List all preset names
 */
export function getPresetNames(): string[] {
  return PRESET_STRATEGIES.map(s => s.name);
}

/**
 * Format preset for display
 */
export function formatPresetInfo(strategy: BacktestStrategy): string {
  const lines: string[] = [
    `${strategy.name}`,
    `${strategy.description}`,
    '',
    'Entry:',
    `  Min Risk Score: ${strategy.entry.minRiskScore ?? 'Any'}`,
    `  Min Liquidity: $${strategy.entry.minLiquidity ?? 0}`,
    `  Min Holders: ${strategy.entry.minHolders ?? 1}`,
  ];

  if (strategy.entry.maxTokenAge) {
    lines.push(`  Max Token Age: ${Math.floor(strategy.entry.maxTokenAge / 60)}min`);
  }
  if (strategy.entry.requireLPBurned) {
    lines.push(`  LP Burned: Required (${strategy.entry.lpBurnedMinPercent ?? 0}%+)`);
  }
  if (strategy.entry.minSmartBuys) {
    lines.push(`  Smart Buys: ${strategy.entry.minSmartBuys}+ required`);
  }

  lines.push('');
  lines.push('Exit:');

  for (const tp of strategy.exit.takeProfitLevels) {
    lines.push(`  TP ${tp.percent}%: Sell ${tp.sellPercent}%`);
  }
  lines.push(`  Stop Loss: ${strategy.exit.stopLossPercent}%`);

  if (strategy.exit.trailingStopPercent) {
    lines.push(`  Trailing Stop: ${strategy.exit.trailingStopPercent}% (after ${strategy.exit.trailingStopActivation}% gain)`);
  }

  lines.push('');
  lines.push('Position Sizing:');
  lines.push(`  Method: ${strategy.sizing.method.replace('_', ' ')}`);
  if (strategy.sizing.percentOfCapital) {
    lines.push(`  Size: ${strategy.sizing.percentOfCapital}% of capital`);
  }
  lines.push(`  Max Position: $${strategy.sizing.maxPositionSize}`);

  return lines.join('\n');
}
