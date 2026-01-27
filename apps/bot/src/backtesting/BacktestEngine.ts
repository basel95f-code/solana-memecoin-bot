/**
 * Backtest Engine
 * Simulates trading strategies on historical data
 */

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import type {
  BacktestConfig,
  BacktestRun,
  BacktestTrade,
  BacktestMetrics,
  HistoricalToken,
  EntryCondition,
  ExitCondition,
} from './types';

export class BacktestEngine extends EventEmitter {
  private currentRun: BacktestRun | null = null;

  /**
   * Run backtest on historical data
   */
  async runBacktest(
    config: BacktestConfig,
    historicalTokens: HistoricalToken[]
  ): Promise<BacktestRun> {
    logger.info('BacktestEngine', `Starting backtest: ${config.startDate} - ${config.endDate}`);

    const run: BacktestRun = {
      id: uuidv4(),
      config,
      startedAt: Date.now(),
      status: 'running',
      trades: [],
    };

    this.currentRun = run;
    this.emit('backtest_started', run);

    try {
      // Filter tokens by date range
      const tokensInRange = historicalTokens.filter(
        t => t.launchTimestamp >= config.startDate && t.launchTimestamp <= config.endDate
      );

      logger.info('BacktestEngine', `Testing ${tokensInRange.length} tokens`);

      // Simulate trading on each token
      for (const token of tokensInRange) {
        const trade = this.simulateTrade(token, config);
        if (trade) {
          run.trades.push(trade);
          this.emit('trade_executed', trade);
        }
      }

      // Calculate metrics
      run.metrics = this.calculateMetrics(run.trades);
      run.completedAt = Date.now();
      run.status = 'completed';

      logger.info('BacktestEngine', `Backtest completed: ${run.trades.length} trades, ${(run.metrics.winRate * 100).toFixed(1)}% win rate`);
      
      this.emit('backtest_completed', run);
      return run;
    } catch (error: any) {
      run.status = 'failed';
      logger.error('BacktestEngine', 'Backtest failed:', error);
      this.emit('backtest_failed', { run, error: error.message });
      throw error;
    } finally {
      this.currentRun = null;
    }
  }

  /**
   * Simulate a single trade
   */
  private simulateTrade(
    token: HistoricalToken,
    config: BacktestConfig
  ): BacktestTrade | null {
    // Check if token passes filters
    if (!this.passesFilters(token, config.filterConfig)) {
      return null;
    }

    // Check entry conditions
    if (!this.checkEntryConditions(token, config.entryConditions)) {
      return null;
    }

    // Simulate entry
    const trade: BacktestTrade = {
      tokenMint: token.mint,
      entryTimestamp: token.launchTimestamp,
      entryPrice: token.initialPrice,
      outcome: 'open',
    };

    // Simulate holding period
    this.simulateHolding(trade, token, config.exitConditions);

    return trade;
  }

  /**
   * Check if token passes filter criteria
   */
  private passesFilters(token: HistoricalToken, filters: any): boolean {
    if (token.initialLiquidity < filters.minLiquidity) return false;
    if (token.initialHolderCount < filters.minHolders) return false;
    
    // Additional filter checks would go here
    // (in real implementation, would check ML predictions, risk scores, etc.)
    
    return true;
  }

  /**
   * Check entry conditions
   */
  private checkEntryConditions(
    token: HistoricalToken,
    conditions: EntryCondition[]
  ): boolean {
    if (conditions.length === 0) return true;

    return conditions.every(condition => {
      const value = this.getTokenValue(token, condition.type);
      return this.evaluateCondition(value, condition.operator, condition.value);
    });
  }

  /**
   * Get token value for condition
   */
  private getTokenValue(token: HistoricalToken, field: string): number {
    switch (field) {
      case 'liquidity':
        return token.initialLiquidity;
      case 'holder_growth':
        return token.holderHistory.length > 1
          ? ((token.holderHistory[1].holderCount - token.holderHistory[0].holderCount) /
              token.holderHistory[0].holderCount) *
            100
          : 0;
      case 'risk_score':
        return 50; // Placeholder
      case 'ml_prediction':
        return 0.5; // Placeholder
      default:
        return 0;
    }
  }

  /**
   * Evaluate condition
   */
  private evaluateCondition(
    actual: number,
    operator: string,
    expected: number
  ): boolean {
    switch (operator) {
      case '>':
        return actual > expected;
      case '<':
        return actual < expected;
      case '>=':
        return actual >= expected;
      case '<=':
        return actual <= expected;
      case '==':
        return actual === expected;
      default:
        return false;
    }
  }

  /**
   * Simulate holding period and exit
   */
  private simulateHolding(
    trade: BacktestTrade,
    token: HistoricalToken,
    exitConditions: ExitCondition[]
  ): void {
    // Find exit point based on conditions
    for (const snapshot of token.priceHistory) {
      const currentPrice = snapshot.price;
      const multiplier = currentPrice / trade.entryPrice;

      // Check exit conditions
      for (const condition of exitConditions) {
        if (this.shouldExit(condition, multiplier, snapshot.timestamp - trade.entryTimestamp)) {
          trade.exitTimestamp = snapshot.timestamp;
          trade.exitPrice = currentPrice;
          trade.multiplier = multiplier;
          trade.outcome = multiplier >= 1.0 ? 'win' : 'loss';
          trade.exitReason = condition.type === 'time_based' ? 'time_limit' : condition.type;
          return;
        }
      }

      // Check for rug
      if (token.outcome.wasRug && snapshot.timestamp >= token.outcome.rugTimestamp!) {
        trade.exitTimestamp = snapshot.timestamp;
        trade.exitPrice = currentPrice;
        trade.multiplier = multiplier;
        trade.outcome = 'loss';
        trade.exitReason = 'rug';
        return;
      }
    }

    // If no exit triggered, use final outcome
    const finalSnapshot = token.priceHistory[token.priceHistory.length - 1];
    trade.exitTimestamp = finalSnapshot.timestamp;
    trade.exitPrice = finalSnapshot.price;
    trade.multiplier = finalSnapshot.price / trade.entryPrice;
    trade.outcome = trade.multiplier! >= 1.0 ? 'win' : 'loss';
    trade.exitReason = 'time_limit';
  }

  /**
   * Check if should exit
   */
  private shouldExit(
    condition: ExitCondition,
    multiplier: number,
    holdTime: number
  ): boolean {
    switch (condition.type) {
      case 'take_profit':
        return multiplier >= condition.value;
      case 'stop_loss':
        return multiplier <= condition.value;
      case 'time_based':
        return holdTime >= condition.value;
      default:
        return false;
    }
  }

  /**
   * Calculate backtest metrics
   */
  private calculateMetrics(trades: BacktestTrade[]): BacktestMetrics {
    if (trades.length === 0) {
      return this.getEmptyMetrics();
    }

    const wins = trades.filter(t => t.outcome === 'win');
    const losses = trades.filter(t => t.outcome === 'loss');
    
    const winMultipliers = wins.map(t => t.multiplier || 1);
    const lossMultipliers = losses.map(t => t.multiplier || 1);

    const totalReturn = trades.reduce((sum, t) => sum + ((t.multiplier || 1) - 1), 0);
    const avgReturn = totalReturn / trades.length;

    const returns = trades.map(t => (t.multiplier || 1) - 1);
    const sharpeRatio = this.calculateSharpeRatio(returns);
    const maxDrawdown = this.calculateMaxDrawdown(returns);

    const avgWinSize = winMultipliers.length > 0
      ? winMultipliers.reduce((a, b) => a + b, 0) / winMultipliers.length - 1
      : 0;

    const avgLossSize = lossMultipliers.length > 0
      ? 1 - lossMultipliers.reduce((a, b) => a + b, 0) / lossMultipliers.length
      : 0;

    const profitFactor = avgLossSize !== 0 ? avgWinSize / avgLossSize : 0;

    const avgHoldTime =
      trades.reduce(
        (sum, t) => sum + (t.exitTimestamp && t.entryTimestamp ? t.exitTimestamp - t.entryTimestamp : 0),
        0
      ) / trades.length;

    const hitRugs = trades.filter(t => t.exitReason === 'rug').length;
    
    // Estimate missed moons (tokens that 2x+ but we didn't enter)
    const missedMoons = 0; // Would need full token set to calculate

    return {
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: wins.length / trades.length,
      avgReturn,
      maxReturn: Math.max(...returns),
      maxLoss: Math.min(...returns),
      totalReturn,
      sharpeRatio,
      maxDrawdown,
      profitFactor,
      avgWinSize,
      avgLossSize,
      avgHoldTime,
      hitRugs,
      missedMoons,
    };
  }

  /**
   * Calculate Sharpe ratio
   */
  private calculateSharpeRatio(returns: number[]): number {
    if (returns.length === 0) return 0;

    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev !== 0 ? avgReturn / stdDev : 0;
  }

  /**
   * Calculate maximum drawdown
   */
  private calculateMaxDrawdown(returns: number[]): number {
    let peak = 1.0;
    let maxDrawdown = 0;
    let cumulative = 1.0;

    for (const ret of returns) {
      cumulative *= 1 + ret;
      if (cumulative > peak) {
        peak = cumulative;
      }
      const drawdown = (peak - cumulative) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }

  /**
   * Get empty metrics
   */
  private getEmptyMetrics(): BacktestMetrics {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      avgReturn: 0,
      maxReturn: 0,
      maxLoss: 0,
      totalReturn: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      profitFactor: 0,
      avgWinSize: 0,
      avgLossSize: 0,
      avgHoldTime: 0,
      hitRugs: 0,
      missedMoons: 0,
    };
  }

  /**
   * Get current run
   */
  getCurrentRun(): BacktestRun | null {
    return this.currentRun;
  }
}
