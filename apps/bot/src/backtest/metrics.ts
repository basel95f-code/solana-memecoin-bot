/**
 * Backtest Metrics Calculator
 * Calculates performance metrics from backtest trades
 */

import type { BacktestTrade, EquityPoint, BacktestResults } from './types';

// Risk-free rate for Sharpe calculation (annual, e.g., 5%)
const RISK_FREE_RATE = 0.05;
// Days in year for annualization
const DAYS_PER_YEAR = 365;

/**
 * Calculate all metrics from a list of trades
 */
export function calculateMetrics(
  trades: BacktestTrade[],
  initialCapital: number,
  strategyId: number,
  strategyName: string,
  startDate: number,
  endDate: number
): BacktestResults {
  const startTime = Date.now();

  // Sort trades by exit time
  const sortedTrades = [...trades].sort((a, b) => a.exitTime - b.exitTime);

  // Basic counts
  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => t.profitLoss > 0).length;
  const losingTrades = trades.filter(t => t.profitLoss < 0).length;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

  // Profit/Loss calculations
  const wins = trades.filter(t => t.profitLoss > 0);
  const losses = trades.filter(t => t.profitLoss < 0);

  const totalProfitLoss = trades.reduce((sum, t) => sum + t.profitLoss, 0);
  const finalCapital = initialCapital + totalProfitLoss;
  const totalReturn = (totalProfitLoss / initialCapital) * 100;

  const averageWin = wins.length > 0
    ? wins.reduce((sum, t) => sum + t.profitLoss, 0) / wins.length
    : 0;
  const averageLoss = losses.length > 0
    ? losses.reduce((sum, t) => sum + t.profitLoss, 0) / losses.length
    : 0;

  const largestWin = wins.length > 0
    ? Math.max(...wins.map(t => t.profitLoss))
    : 0;
  const largestLoss = losses.length > 0
    ? Math.min(...losses.map(t => t.profitLoss))
    : 0;

  // Time metrics
  const averageHoldTime = totalTrades > 0
    ? trades.reduce((sum, t) => sum + t.holdTimeSeconds, 0) / totalTrades
    : 0;

  // Streaks
  const { longestWinningStreak, longestLosingStreak } = calculateStreaks(sortedTrades);

  // Build equity curve and calculate drawdown
  const { equityCurve, maxDrawdown, maxDrawdownDuration } = buildEquityCurve(
    sortedTrades,
    initialCapital
  );

  // Risk-adjusted metrics
  const daysAnalyzed = Math.ceil((endDate - startDate) / (24 * 60 * 60));
  const sharpeRatio = calculateSharpeRatio(sortedTrades, initialCapital, daysAnalyzed);
  const sortinoRatio = calculateSortinoRatio(sortedTrades, initialCapital, daysAnalyzed);
  const profitFactor = calculateProfitFactor(trades);

  const executionTimeMs = Date.now() - startTime;

  return {
    strategyId,
    strategyName,
    startDate,
    endDate,
    daysAnalyzed,
    initialCapital,
    finalCapital,
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    totalProfitLoss,
    totalReturn,
    averageWin,
    averageLoss,
    largestWin,
    largestLoss,
    maxDrawdown,
    maxDrawdownDuration,
    sharpeRatio,
    sortinoRatio,
    profitFactor,
    averageHoldTime,
    longestWinningStreak,
    longestLosingStreak,
    equityCurve,
    executedAt: Math.floor(Date.now() / 1000),
    executionTimeMs,
  };
}

/**
 * Build equity curve from trades
 */
function buildEquityCurve(
  trades: BacktestTrade[],
  initialCapital: number
): {
  equityCurve: EquityPoint[];
  maxDrawdown: number;
  maxDrawdownDuration: number;
} {
  const equityCurve: EquityPoint[] = [];
  let equity = initialCapital;
  let peak = initialCapital;
  let maxDrawdown = 0;
  let maxDrawdownDuration = 0;
  let drawdownStart = 0;

  // Add initial point
  if (trades.length > 0) {
    equityCurve.push({
      timestamp: trades[0].entryTime,
      equity: initialCapital,
      drawdown: 0,
    });
  }

  for (const trade of trades) {
    equity += trade.profitLoss;

    // Update peak
    if (equity > peak) {
      peak = equity;
      drawdownStart = 0;
    }

    // Calculate drawdown
    const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;

    // Track max drawdown
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }

    // Track drawdown duration
    if (drawdown > 0) {
      if (drawdownStart === 0) {
        drawdownStart = trade.exitTime;
      }
      const duration = trade.exitTime - drawdownStart;
      if (duration > maxDrawdownDuration) {
        maxDrawdownDuration = duration;
      }
    }

    equityCurve.push({
      timestamp: trade.exitTime,
      equity,
      drawdown,
    });
  }

  return { equityCurve, maxDrawdown, maxDrawdownDuration };
}

/**
 * Calculate winning/losing streaks
 */
function calculateStreaks(trades: BacktestTrade[]): {
  longestWinningStreak: number;
  longestLosingStreak: number;
} {
  let longestWinningStreak = 0;
  let longestLosingStreak = 0;
  let currentWinStreak = 0;
  let currentLoseStreak = 0;

  for (const trade of trades) {
    if (trade.profitLoss > 0) {
      currentWinStreak++;
      currentLoseStreak = 0;
      if (currentWinStreak > longestWinningStreak) {
        longestWinningStreak = currentWinStreak;
      }
    } else if (trade.profitLoss < 0) {
      currentLoseStreak++;
      currentWinStreak = 0;
      if (currentLoseStreak > longestLosingStreak) {
        longestLosingStreak = currentLoseStreak;
      }
    }
  }

  return { longestWinningStreak, longestLosingStreak };
}

/**
 * Calculate Sharpe Ratio
 * Sharpe = (Return - Risk-Free Rate) / Standard Deviation of Returns
 */
function calculateSharpeRatio(
  trades: BacktestTrade[],
  initialCapital: number,
  daysAnalyzed: number
): number {
  if (trades.length < 2) return 0;

  // Calculate daily returns
  const returns = trades.map(t => t.profitLossPercent / 100);

  // Average return
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

  // Standard deviation
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  // Annualize
  const tradesPerYear = (returns.length / daysAnalyzed) * DAYS_PER_YEAR;
  const annualizedReturn = avgReturn * tradesPerYear;
  const annualizedStdDev = stdDev * Math.sqrt(tradesPerYear);

  return (annualizedReturn - RISK_FREE_RATE) / annualizedStdDev;
}

/**
 * Calculate Sortino Ratio
 * Like Sharpe but only considers downside deviation
 */
function calculateSortinoRatio(
  trades: BacktestTrade[],
  initialCapital: number,
  daysAnalyzed: number
): number {
  if (trades.length < 2) return 0;

  const returns = trades.map(t => t.profitLossPercent / 100);
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

  // Only consider negative returns for downside deviation
  const negativeReturns = returns.filter(r => r < 0);
  if (negativeReturns.length === 0) return avgReturn > 0 ? Infinity : 0;

  const downsideVariance = negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / returns.length;
  const downsideDev = Math.sqrt(downsideVariance);

  if (downsideDev === 0) return 0;

  // Annualize
  const tradesPerYear = (returns.length / daysAnalyzed) * DAYS_PER_YEAR;
  const annualizedReturn = avgReturn * tradesPerYear;
  const annualizedDownsideDev = downsideDev * Math.sqrt(tradesPerYear);

  return (annualizedReturn - RISK_FREE_RATE) / annualizedDownsideDev;
}

/**
 * Calculate Profit Factor
 * Gross Profit / Gross Loss
 */
function calculateProfitFactor(trades: BacktestTrade[]): number {
  const grossProfit = trades
    .filter(t => t.profitLoss > 0)
    .reduce((sum, t) => sum + t.profitLoss, 0);

  const grossLoss = Math.abs(
    trades
      .filter(t => t.profitLoss < 0)
      .reduce((sum, t) => sum + t.profitLoss, 0)
  );

  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;

  return grossProfit / grossLoss;
}

/**
 * Format metrics for display
 */
export function formatResultsSummary(results: BacktestResults): string {
  const lines: string[] = [
    `Strategy: ${results.strategyName}`,
    `Period: ${results.daysAnalyzed} days`,
    '',
    'Performance:',
    `  Total Return: ${results.totalReturn >= 0 ? '+' : ''}${results.totalReturn.toFixed(2)}%`,
    `  Final Capital: $${results.finalCapital.toFixed(2)}`,
    `  P&L: ${results.totalProfitLoss >= 0 ? '+' : ''}$${results.totalProfitLoss.toFixed(2)}`,
    '',
    'Trade Stats:',
    `  Total Trades: ${results.totalTrades}`,
    `  Win Rate: ${results.winRate.toFixed(1)}%`,
    `  Winners: ${results.winningTrades} | Losers: ${results.losingTrades}`,
    `  Avg Win: $${results.averageWin.toFixed(2)}`,
    `  Avg Loss: $${results.averageLoss.toFixed(2)}`,
    '',
    'Risk Metrics:',
    `  Max Drawdown: ${results.maxDrawdown.toFixed(2)}%`,
    `  Sharpe Ratio: ${results.sharpeRatio.toFixed(2)}`,
    `  Profit Factor: ${results.profitFactor === Infinity ? '∞' : results.profitFactor.toFixed(2)}`,
    '',
    `Avg Hold Time: ${formatDuration(results.averageHoldTime)}`,
  ];

  return lines.join('\n');
}

/**
 * Format duration in human-readable form
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}
