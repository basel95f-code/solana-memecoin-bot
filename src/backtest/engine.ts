/**
 * Backtest Engine
 * Core simulation engine for backtesting trading strategies
 */

import type {
  BacktestStrategy,
  BacktestConfig,
  BacktestTrade,
  BacktestResults,
  TokenWithOutcome,
  TradeOutcome,
  EntryConditions,
  ExitConditions,
  PositionSizing,
} from './types';
import { calculateMetrics } from './metrics';
import { logger } from '../utils/logger';

// Default configuration
const DEFAULT_INITIAL_CAPITAL = 10000;

/**
 * Position tracker for managing open trades
 */
interface OpenPosition {
  tokenMint: string;
  tokenSymbol: string;
  tokenName?: string;
  entryPrice: number;
  entryTime: number;
  positionSize: number;
  remainingPercent: number; // Tracks partial exits (100 = full position)
  entryRiskScore?: number;
  entryLiquidity?: number;
  entryHolders?: number;
}

/**
 * Run a backtest simulation
 */
export async function runBacktest(
  config: BacktestConfig,
  getTokensWithOutcomes: (startDate: number, endDate: number) => Promise<TokenWithOutcome[]>
): Promise<BacktestResults> {
  const { strategy, initialCapital = DEFAULT_INITIAL_CAPITAL } = config;

  // Calculate date range
  const endDate = config.endDate
    ? Math.floor(config.endDate.getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  const startDate = config.startDate
    ? Math.floor(config.startDate.getTime() / 1000)
    : endDate - (config.days || 30) * 24 * 60 * 60;

  logger.info('Backtest', `Running ${strategy.name} from ${new Date(startDate * 1000).toISOString()} to ${new Date(endDate * 1000).toISOString()}`);

  // Load tokens with outcomes
  const tokens = await getTokensWithOutcomes(startDate, endDate);
  logger.info('Backtest', `Loaded ${tokens.length} tokens with outcomes`);

  if (tokens.length === 0) {
    return createEmptyResults(strategy, startDate, endDate, initialCapital);
  }

  // Sort tokens by discovery time
  const sortedTokens = [...tokens].sort((a, b) => a.discoveredAt - b.discoveredAt);

  // Simulate trading
  const trades = simulateTrades(sortedTokens, strategy, initialCapital);

  logger.info('Backtest', `Completed ${trades.length} trades`);

  // Calculate metrics
  const results = calculateMetrics(
    trades,
    initialCapital,
    strategy.id ?? 0,
    strategy.name,
    startDate,
    endDate
  );

  return results;
}

/**
 * Simulate trades through token list
 */
function simulateTrades(
  tokens: TokenWithOutcome[],
  strategy: BacktestStrategy,
  initialCapital: number
): BacktestTrade[] {
  const trades: BacktestTrade[] = [];
  const openPositions: Map<string, OpenPosition> = new Map();
  let currentCapital = initialCapital;

  for (const token of tokens) {
    // Check if we should enter this trade
    if (checkEntryConditions(token, strategy.entry)) {
      // Calculate position size
      const positionSize = calculatePositionSize(
        strategy.sizing,
        currentCapital,
        openPositions.size
      );

      if (positionSize > 0 && positionSize <= currentCapital) {
        // Open position
        openPositions.set(token.mint, {
          tokenMint: token.mint,
          tokenSymbol: token.symbol,
          tokenName: token.name,
          entryPrice: token.initialPrice,
          entryTime: token.discoveredAt,
          positionSize,
          remainingPercent: 100,
          entryRiskScore: token.initialRiskScore,
          entryLiquidity: token.initialLiquidity,
          entryHolders: token.initialHolders,
        });

        currentCapital -= positionSize;
      }
    }

    // Simulate exit for this token if we have a position
    const position = openPositions.get(token.mint);
    if (position) {
      const tradeResults = simulateExit(position, token, strategy.exit);

      for (const trade of tradeResults) {
        trades.push(trade);
        currentCapital += trade.positionSize + trade.profitLoss;
      }

      openPositions.delete(token.mint);
    }
  }

  return trades;
}

/**
 * Check if token meets entry conditions
 */
function checkEntryConditions(token: TokenWithOutcome, conditions: EntryConditions): boolean {
  // Risk score
  if (conditions.minRiskScore !== undefined && token.initialRiskScore < conditions.minRiskScore) {
    return false;
  }
  if (conditions.maxRiskScore !== undefined && token.initialRiskScore > conditions.maxRiskScore) {
    return false;
  }

  // Liquidity
  if (conditions.minLiquidity !== undefined && token.initialLiquidity < conditions.minLiquidity) {
    return false;
  }
  if (conditions.maxLiquidity !== undefined && token.initialLiquidity > conditions.maxLiquidity) {
    return false;
  }

  // Holders
  if (conditions.minHolders !== undefined && token.initialHolders < conditions.minHolders) {
    return false;
  }
  if (conditions.maxHolders !== undefined && token.initialHolders > conditions.maxHolders) {
    return false;
  }

  // Top 10 concentration
  if (conditions.maxTop10Percent !== undefined && token.initialTop10Percent !== undefined) {
    if (token.initialTop10Percent > conditions.maxTop10Percent) {
      return false;
    }
  }

  // Contract requirements
  if (conditions.requireMintRevoked && !token.mintRevoked) {
    return false;
  }
  if (conditions.requireFreezeRevoked && !token.freezeRevoked) {
    return false;
  }
  if (conditions.requireLPBurned && !token.lpBurned) {
    return false;
  }
  if (conditions.lpBurnedMinPercent !== undefined && token.lpBurnedPercent !== undefined) {
    if (token.lpBurnedPercent < conditions.lpBurnedMinPercent) {
      return false;
    }
  }

  // Social requirements
  if (conditions.requireSocials) {
    if (!token.hasTwitter && !token.hasTelegram && !token.hasWebsite) {
      return false;
    }
  }
  if (conditions.requireTwitter && !token.hasTwitter) {
    return false;
  }
  if (conditions.requireTelegram && !token.hasTelegram) {
    return false;
  }

  // Smart money
  if (conditions.minSmartBuys !== undefined) {
    if (!token.smartBuys || token.smartBuys < conditions.minSmartBuys) {
      return false;
    }
  }

  return true;
}

/**
 * Calculate position size based on sizing rules
 */
function calculatePositionSize(
  sizing: PositionSizing,
  currentCapital: number,
  openPositionCount: number
): number {
  // Check max concurrent positions
  if (sizing.maxConcurrentPositions !== undefined) {
    if (openPositionCount >= sizing.maxConcurrentPositions) {
      return 0;
    }
  }

  let size = 0;

  switch (sizing.method) {
    case 'fixed':
      size = sizing.fixedAmount ?? 100;
      break;

    case 'percent_of_capital':
      size = currentCapital * ((sizing.percentOfCapital ?? 5) / 100);
      break;

    case 'risk_based':
      // For risk-based, we'd need stop loss info - fallback to percent
      size = currentCapital * ((sizing.riskPercent ?? 2) / 100);
      break;
  }

  // Apply max position size limit
  if (sizing.maxPositionSize !== undefined && size > sizing.maxPositionSize) {
    size = sizing.maxPositionSize;
  }

  return Math.max(0, Math.min(size, currentCapital));
}

/**
 * Simulate exit based on outcome data
 */
function simulateExit(
  position: OpenPosition,
  token: TokenWithOutcome,
  exitConditions: ExitConditions
): BacktestTrade[] {
  const trades: BacktestTrade[] = [];
  let remainingPercent = position.remainingPercent;

  // Calculate multipliers
  const peakMultiplier = token.peakMultiplier;
  const finalMultiplier = token.finalPrice / token.initialPrice;

  // Check for rug exit first
  if (exitConditions.exitOnRugSignal && token.outcome === 'rug') {
    const trade = createTrade(
      position,
      token.finalPrice,
      token.outcomeRecordedAt ?? token.discoveredAt + 3600,
      'rug_exit',
      remainingPercent,
      token.peakPrice,
      peakMultiplier
    );
    return [trade];
  }

  // Process take profit levels
  const sortedTPLevels = [...exitConditions.takeProfitLevels].sort((a, b) => a.percent - b.percent);

  for (const tp of sortedTPLevels) {
    const tpMultiplier = 1 + tp.percent / 100;

    // Check if peak reached this TP level
    if (peakMultiplier >= tpMultiplier && remainingPercent > 0) {
      const sellPercent = Math.min(tp.sellPercent, remainingPercent);
      const exitPrice = position.entryPrice * tpMultiplier;

      // Estimate exit time (proportional to time_to_peak)
      const exitTime = token.peakAt ?? token.discoveredAt + (token.timeToPeak ?? 3600);

      const trade = createTrade(
        position,
        exitPrice,
        exitTime,
        'win',
        sellPercent,
        token.peakPrice,
        peakMultiplier
      );
      trades.push(trade);

      remainingPercent -= sellPercent;
    }
  }

  // Handle remaining position
  if (remainingPercent > 0) {
    // Check stop loss
    const stopLossMultiplier = 1 + exitConditions.stopLossPercent / 100;

    // Check trailing stop
    let trailingStopPrice: number | null = null;
    if (exitConditions.trailingStopPercent !== undefined) {
      const activationMultiplier = 1 + (exitConditions.trailingStopActivation ?? 0) / 100;
      if (peakMultiplier >= activationMultiplier) {
        trailingStopPrice = token.peakPrice * (1 - exitConditions.trailingStopPercent / 100);
      }
    }

    // Determine exit price for remaining position
    let exitPrice: number;
    let exitReason: TradeOutcome;
    let exitTime: number;

    // Check if final price hit stop loss
    if (finalMultiplier <= stopLossMultiplier) {
      exitPrice = position.entryPrice * stopLossMultiplier;
      exitReason = 'stopped_out';
      exitTime = token.outcomeRecordedAt ?? token.discoveredAt + 3600;
    }
    // Check if trailing stop was hit
    else if (trailingStopPrice !== null && token.finalPrice <= trailingStopPrice) {
      exitPrice = trailingStopPrice;
      exitReason = finalMultiplier > 1 ? 'win' : 'loss';
      exitTime = token.outcomeRecordedAt ?? token.discoveredAt + 3600;
    }
    // Time exit
    else if (exitConditions.maxHoldTimeHours !== undefined) {
      exitPrice = token.finalPrice;
      exitReason = 'time_exit';
      exitTime = position.entryTime + exitConditions.maxHoldTimeHours * 3600;
    }
    // Final exit at market price
    else {
      exitPrice = token.finalPrice;
      exitReason = finalMultiplier > 1 ? 'win' : finalMultiplier < 1 ? 'loss' : 'breakeven';
      exitTime = token.outcomeRecordedAt ?? token.discoveredAt + 86400; // Default 24h
    }

    const trade = createTrade(
      position,
      exitPrice,
      exitTime,
      exitReason,
      remainingPercent,
      token.peakPrice,
      peakMultiplier
    );
    trades.push(trade);
  }

  return trades;
}

/**
 * Create a trade record
 */
function createTrade(
  position: OpenPosition,
  exitPrice: number,
  exitTime: number,
  exitReason: TradeOutcome,
  sellPercent: number,
  peakPrice: number,
  peakMultiplier: number
): BacktestTrade {
  const positionValue = position.positionSize * (sellPercent / 100);
  const exitValue = positionValue * (exitPrice / position.entryPrice);
  const profitLoss = exitValue - positionValue;
  const profitLossPercent = ((exitPrice / position.entryPrice) - 1) * 100;

  return {
    runId: 0, // Will be set when saving
    tokenMint: position.tokenMint,
    tokenSymbol: position.tokenSymbol,
    tokenName: position.tokenName,
    entryPrice: position.entryPrice,
    entryTime: position.entryTime,
    positionSize: positionValue,
    exitPrice,
    exitTime,
    exitReason,
    profitLoss,
    profitLossPercent,
    holdTimeSeconds: exitTime - position.entryTime,
    peakPrice,
    peakMultiplier,
    entryRiskScore: position.entryRiskScore,
    entryLiquidity: position.entryLiquidity,
    entryHolders: position.entryHolders,
  };
}

/**
 * Create empty results when no tokens found
 */
function createEmptyResults(
  strategy: BacktestStrategy,
  startDate: number,
  endDate: number,
  initialCapital: number
): BacktestResults {
  return {
    strategyId: strategy.id ?? 0,
    strategyName: strategy.name,
    startDate,
    endDate,
    daysAnalyzed: Math.ceil((endDate - startDate) / (24 * 60 * 60)),
    initialCapital,
    finalCapital: initialCapital,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    totalProfitLoss: 0,
    totalReturn: 0,
    averageWin: 0,
    averageLoss: 0,
    largestWin: 0,
    largestLoss: 0,
    maxDrawdown: 0,
    maxDrawdownDuration: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    profitFactor: 0,
    averageHoldTime: 0,
    longestWinningStreak: 0,
    longestLosingStreak: 0,
    equityCurve: [],
    executedAt: Math.floor(Date.now() / 1000),
    executionTimeMs: 0,
  };
}

/**
 * Validate strategy configuration
 */
export function validateStrategy(strategy: BacktestStrategy): string[] {
  const errors: string[] = [];

  if (!strategy.name) {
    errors.push('Strategy name is required');
  }

  if (!strategy.exit.takeProfitLevels || strategy.exit.takeProfitLevels.length === 0) {
    errors.push('At least one take profit level is required');
  }

  if (strategy.exit.stopLossPercent === undefined || strategy.exit.stopLossPercent >= 0) {
    errors.push('Stop loss must be a negative percentage');
  }

  for (const tp of strategy.exit.takeProfitLevels) {
    if (tp.percent <= 0) {
      errors.push('Take profit percentages must be positive');
    }
    if (tp.sellPercent <= 0 || tp.sellPercent > 100) {
      errors.push('Sell percentages must be between 1 and 100');
    }
  }

  if (!strategy.sizing.method) {
    errors.push('Position sizing method is required');
  }

  return errors;
}
