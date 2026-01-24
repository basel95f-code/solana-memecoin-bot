/**
 * Kelly Criterion Calculator
 * Implements optimal position sizing based on historical performance
 *
 * Kelly Formula: f* = (bp - q) / b
 * Where:
 *   f* = optimal fraction of capital to bet
 *   b = win/loss ratio (average win / average loss)
 *   p = probability of winning (win rate)
 *   q = probability of losing (1 - p)
 *
 * In trading terms:
 *   f* = (winLossRatio * winRate - lossRate) / winLossRatio
 */

import { logger } from '../utils/logger';
import type {
  KellyConfig,
  KellyCalculationResult,
  KellyHistoricalMetrics,
  SignalOutcome,
} from './types';
import { DEFAULT_KELLY_CONFIG } from './types';

export class KellyCriterion {
  private config: KellyConfig;

  constructor(config: Partial<KellyConfig> = {}) {
    this.config = { ...DEFAULT_KELLY_CONFIG, ...config };
  }

  /**
   * Calculate optimal position size using Kelly criterion
   * @param outcomes - Historical trade outcomes
   * @param signalConfidence - Current signal confidence (0-100)
   */
  calculate(
    outcomes: SignalOutcome[],
    signalConfidence?: number
  ): KellyCalculationResult {
    // Check if Kelly is enabled
    if (!this.config.enabled) {
      return this.createFallbackResult('Kelly criterion disabled');
    }

    // Filter to outcomes with actual results
    const completedOutcomes = outcomes.filter(
      (o) => o.profitLossPercent !== undefined && o.profitLossPercent !== null
    );

    // Get recent trades based on lookback
    const recentOutcomes = completedOutcomes
      .sort((a, b) => (b.exitRecordedAt || 0) - (a.exitRecordedAt || 0))
      .slice(0, this.config.lookbackTrades);

    // Check minimum trade requirement
    if (recentOutcomes.length < this.config.minTradesRequired) {
      return this.createFallbackResult(
        `Insufficient trades: ${recentOutcomes.length}/${this.config.minTradesRequired}`
      );
    }

    // Calculate historical metrics
    const metrics = this.calculateHistoricalMetrics(recentOutcomes);

    // Check minimum win rate
    if (metrics.winRate < this.config.minWinRate) {
      return this.createFallbackResult(
        `Win rate too low: ${(metrics.winRate * 100).toFixed(1)}% < ${(this.config.minWinRate * 100).toFixed(1)}%`
      );
    }

    // Calculate Kelly fraction
    // f* = (bp - q) / b
    // where b = avgWin/avgLoss, p = winRate, q = 1-p
    const b = metrics.winLossRatio;
    const p = metrics.winRate;
    const q = 1 - p;

    // Avoid division by zero
    if (b <= 0) {
      return this.createFallbackResult('Invalid win/loss ratio');
    }

    // Calculate optimal Kelly fraction
    const optimalFraction = (b * p - q) / b;

    // If Kelly is negative, don't bet (edge is negative)
    if (optimalFraction <= 0) {
      return this.createFallbackResult(
        `Negative edge: Kelly = ${(optimalFraction * 100).toFixed(2)}%`
      );
    }

    // Apply Kelly fraction multiplier (e.g., half Kelly, quarter Kelly)
    let adjustedFraction = optimalFraction * this.config.fraction;

    // Apply confidence adjustment if enabled
    if (this.config.useConfidenceAdjustment && signalConfidence !== undefined) {
      // Scale by confidence (60% confidence = 60% of Kelly position)
      const confidenceMultiplier = signalConfidence / 100;
      adjustedFraction *= confidenceMultiplier;
    }

    // Calculate position size as percentage
    let suggestedPositionPercent = adjustedFraction * 100;

    // Apply caps
    suggestedPositionPercent = Math.max(
      this.config.minPositionPercent,
      Math.min(this.config.maxPositionPercent, suggestedPositionPercent)
    );

    logger.debug(
      'KellyCriterion',
      `Calculated: optimal=${(optimalFraction * 100).toFixed(2)}%, ` +
        `adjusted=${(adjustedFraction * 100).toFixed(2)}%, ` +
        `position=${suggestedPositionPercent.toFixed(2)}%`
    );

    return {
      optimalFraction,
      adjustedFraction,
      suggestedPositionPercent: Math.round(suggestedPositionPercent * 10) / 10,
      winRate: metrics.winRate,
      winLossRatio: metrics.winLossRatio,
      avgWinPercent: metrics.avgWinPercent,
      avgLossPercent: metrics.avgLossPercent,
      tradeCount: recentOutcomes.length,
      kellyUsed: true,
    };
  }

  /**
   * Calculate historical metrics from trade outcomes
   */
  calculateHistoricalMetrics(outcomes: SignalOutcome[]): KellyHistoricalMetrics {
    const winningTrades = outcomes.filter(
      (o) => (o.profitLossPercent || 0) > 0
    );
    const losingTrades = outcomes.filter(
      (o) => (o.profitLossPercent || 0) <= 0
    );

    const totalTrades = outcomes.length;
    const winCount = winningTrades.length;
    const lossCount = losingTrades.length;

    // Calculate win rate
    const winRate = totalTrades > 0 ? winCount / totalTrades : 0;

    // Calculate average win percentage (absolute value)
    const avgWinPercent =
      winCount > 0
        ? winningTrades.reduce((sum, o) => sum + (o.profitLossPercent || 0), 0) /
          winCount
        : 0;

    // Calculate average loss percentage (absolute value)
    const avgLossPercent =
      lossCount > 0
        ? Math.abs(
            losingTrades.reduce((sum, o) => sum + (o.profitLossPercent || 0), 0) /
              lossCount
          )
        : 1; // Default to 1 to avoid division by zero

    // Calculate win/loss ratio
    const winLossRatio = avgLossPercent > 0 ? avgWinPercent / avgLossPercent : 1;

    return {
      totalTrades,
      winningTrades: winCount,
      losingTrades: lossCount,
      winRate,
      avgWinPercent,
      avgLossPercent,
      winLossRatio,
      calculatedAt: Date.now(),
    };
  }

  /**
   * Create a fallback result when Kelly can't be used
   */
  private createFallbackResult(reason: string): KellyCalculationResult {
    logger.debug('KellyCriterion', `Fallback: ${reason}`);
    return {
      optimalFraction: 0,
      adjustedFraction: 0,
      suggestedPositionPercent: 0, // Caller should use default sizing
      winRate: 0,
      winLossRatio: 0,
      avgWinPercent: 0,
      avgLossPercent: 0,
      tradeCount: 0,
      kellyUsed: false,
      fallbackReason: reason,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<KellyConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('KellyCriterion', `Config updated: enabled=${this.config.enabled}, fraction=${this.config.fraction}`);
  }

  /**
   * Get current configuration
   */
  getConfig(): KellyConfig {
    return { ...this.config };
  }

  /**
   * Get a human-readable description of current Kelly settings
   */
  getDescription(): string {
    if (!this.config.enabled) {
      return 'Kelly criterion: Disabled';
    }

    const fractionName =
      this.config.fraction >= 1
        ? 'Full Kelly'
        : this.config.fraction >= 0.5
          ? 'Half Kelly'
          : this.config.fraction >= 0.25
            ? 'Quarter Kelly'
            : `${(this.config.fraction * 100).toFixed(0)}% Kelly`;

    return (
      `Kelly criterion: ${fractionName}\n` +
      `• Min trades: ${this.config.minTradesRequired}\n` +
      `• Lookback: ${this.config.lookbackTrades} trades\n` +
      `• Position limits: ${this.config.minPositionPercent}% - ${this.config.maxPositionPercent}%\n` +
      `• Min win rate: ${(this.config.minWinRate * 100).toFixed(0)}%\n` +
      `• Confidence adjustment: ${this.config.useConfidenceAdjustment ? 'Yes' : 'No'}`
    );
  }
}

// Export singleton instance
export const kellyCriterion = new KellyCriterion();
