/**
 * Signal Correlation Analyzer
 * Detects and warns about correlated trading signals to help diversify risk
 *
 * Correlation is detected based on:
 * 1. Price movement correlation (historical)
 * 2. Similar token characteristics (liquidity, holder patterns)
 * 3. Same sector/category if detectable
 */

import { logger } from '../utils/logger';
import type { TradingSignal, SignalGenerationInput } from './types';

// ============================================
// Types
// ============================================

export interface CorrelationConfig {
  // Enable correlation checking
  enabled: boolean;

  // Correlation threshold (0-1) above which to warn
  // 0.7 = "strongly correlated"
  correlationThreshold: number;

  // Maximum number of correlated signals before blocking
  // Set to 0 to warn but never block
  maxCorrelatedSignals: number;

  // Weight factors for correlation calculation
  weights: {
    priceMovement: number; // Historical price correlation
    liquidity: number; // Similar liquidity levels
    holderPattern: number; // Similar holder distribution
    riskProfile: number; // Similar risk scores
  };

  // Lookback period for price correlation (in data points)
  priceLookbackPeriods: number;
}

export interface CorrelationResult {
  // Is this signal correlated with existing signals?
  isCorrelated: boolean;

  // Overall correlation score (0-1)
  correlationScore: number;

  // Correlated signals
  correlatedWith: Array<{
    signalId: string;
    symbol: string;
    correlationScore: number;
    factors: string[];
  }>;

  // Warning message if correlated
  warning?: string;

  // Should this signal be blocked?
  shouldBlock: boolean;
  blockReason?: string;
}

export interface SignalCharacteristics {
  mint: string;
  symbol: string;
  liquidityUsd: number;
  holderCount?: number;
  top10Percent?: number;
  riskScore: number;
  priceChange1h?: number;
  priceChange24h?: number;
  momentumScore: number;
}

export const DEFAULT_CORRELATION_CONFIG: CorrelationConfig = {
  enabled: true,
  correlationThreshold: 0.7,
  maxCorrelatedSignals: 3,
  weights: {
    priceMovement: 0.40,
    liquidity: 0.20,
    holderPattern: 0.20,
    riskProfile: 0.20,
  },
  priceLookbackPeriods: 24,
};

// ============================================
// Correlation Analyzer Class
// ============================================

export class CorrelationAnalyzer {
  private config: CorrelationConfig;
  private priceHistory: Map<string, number[]> = new Map(); // mint -> price history

  constructor(config: Partial<CorrelationConfig> = {}) {
    this.config = { ...DEFAULT_CORRELATION_CONFIG, ...config };
  }

  /**
   * Analyze correlation of a new signal against existing active signals
   */
  analyzeCorrelation(
    input: SignalGenerationInput,
    newSignalScores: { momentumScore: number; smartMoneyScore: number; holderScore: number },
    activeSignals: TradingSignal[]
  ): CorrelationResult {
    if (!this.config.enabled || activeSignals.length === 0) {
      return {
        isCorrelated: false,
        correlationScore: 0,
        correlatedWith: [],
        shouldBlock: false,
      };
    }

    const newCharacteristics: SignalCharacteristics = {
      mint: input.mint,
      symbol: input.symbol,
      liquidityUsd: input.liquidityUsd,
      holderCount: input.holderCount,
      top10Percent: input.top10Percent,
      riskScore: input.riskScore,
      priceChange1h: input.priceChange1h,
      priceChange24h: input.priceChange24h,
      momentumScore: newSignalScores.momentumScore,
    };

    const correlatedSignals: CorrelationResult['correlatedWith'] = [];

    // Compare with each active signal
    for (const signal of activeSignals) {
      const existingCharacteristics: SignalCharacteristics = {
        mint: signal.mint,
        symbol: signal.symbol,
        liquidityUsd: 0, // Not stored in signal, use approximation
        riskScore: signal.riskScore,
        momentumScore: signal.momentumScore,
      };

      const { score, factors } = this.calculateCorrelation(
        newCharacteristics,
        existingCharacteristics
      );

      if (score >= this.config.correlationThreshold) {
        correlatedSignals.push({
          signalId: signal.id,
          symbol: signal.symbol,
          correlationScore: score,
          factors,
        });
      }
    }

    // Calculate overall correlation
    const isCorrelated = correlatedSignals.length > 0;
    const maxCorrelation =
      correlatedSignals.length > 0
        ? Math.max(...correlatedSignals.map((c) => c.correlationScore))
        : 0;

    // Determine if we should block
    const shouldBlock =
      this.config.maxCorrelatedSignals > 0 &&
      correlatedSignals.length >= this.config.maxCorrelatedSignals;

    // Build warning message
    let warning: string | undefined;
    let blockReason: string | undefined;

    if (isCorrelated) {
      const symbolList = correlatedSignals.map((c) => c.symbol).join(', ');
      warning = `⚠️ Correlated with ${correlatedSignals.length} active signal(s): ${symbolList}`;

      if (shouldBlock) {
        blockReason = `Too many correlated signals (${correlatedSignals.length}/${this.config.maxCorrelatedSignals})`;
      }
    }

    logger.debug(
      'CorrelationAnalyzer',
      `${input.symbol}: correlation=${maxCorrelation.toFixed(2)}, ` +
        `correlated=${correlatedSignals.length}, block=${shouldBlock}`
    );

    return {
      isCorrelated,
      correlationScore: maxCorrelation,
      correlatedWith: correlatedSignals,
      warning,
      shouldBlock,
      blockReason,
    };
  }

  /**
   * Calculate correlation between two signals
   */
  private calculateCorrelation(
    a: SignalCharacteristics,
    b: SignalCharacteristics
  ): { score: number; factors: string[] } {
    const weights = this.config.weights;
    let totalScore = 0;
    const factors: string[] = [];

    // 1. Price movement correlation
    const priceCorrelation = this.calculatePriceCorrelation(a, b);
    if (priceCorrelation > 0.6) {
      factors.push('similar price movement');
    }
    totalScore += priceCorrelation * weights.priceMovement;

    // 2. Liquidity similarity
    if (a.liquidityUsd > 0 && b.liquidityUsd > 0) {
      const liquiditySimilarity = this.calculateSimilarity(
        a.liquidityUsd,
        b.liquidityUsd,
        10 // Allow 10x difference
      );
      if (liquiditySimilarity > 0.7) {
        factors.push('similar liquidity');
      }
      totalScore += liquiditySimilarity * weights.liquidity;
    } else {
      // Can't compare, use neutral
      totalScore += 0.5 * weights.liquidity;
    }

    // 3. Holder pattern similarity
    const holderSimilarity = this.calculateHolderSimilarity(a, b);
    if (holderSimilarity > 0.7) {
      factors.push('similar holder distribution');
    }
    totalScore += holderSimilarity * weights.holderPattern;

    // 4. Risk profile similarity
    const riskSimilarity = this.calculateSimilarity(
      a.riskScore,
      b.riskScore,
      30 // Allow 30 point difference
    );
    if (riskSimilarity > 0.8) {
      factors.push('similar risk profile');
    }
    totalScore += riskSimilarity * weights.riskProfile;

    return {
      score: Math.min(1, totalScore),
      factors,
    };
  }

  /**
   * Calculate price movement correlation
   */
  private calculatePriceCorrelation(
    a: SignalCharacteristics,
    b: SignalCharacteristics
  ): number {
    // Use stored price history if available
    const historyA = this.priceHistory.get(a.mint);
    const historyB = this.priceHistory.get(b.mint);

    if (historyA && historyB && historyA.length >= 5 && historyB.length >= 5) {
      // Calculate Pearson correlation coefficient
      return this.pearsonCorrelation(historyA, historyB);
    }

    // Fall back to comparing recent price changes
    if (a.priceChange1h !== undefined && b.priceChange1h !== undefined) {
      // If both are moving in the same direction with similar magnitude
      const direction1h =
        Math.sign(a.priceChange1h) === Math.sign(b.priceChange1h) ? 0.5 : 0;
      const magnitude1h = this.calculateSimilarity(
        Math.abs(a.priceChange1h),
        Math.abs(b.priceChange1h),
        50
      );
      return (direction1h + magnitude1h) / 2;
    }

    // If no price data, compare momentum scores
    return this.calculateSimilarity(a.momentumScore, b.momentumScore, 0.5);
  }

  /**
   * Calculate holder pattern similarity
   */
  private calculateHolderSimilarity(
    a: SignalCharacteristics,
    b: SignalCharacteristics
  ): number {
    let similarity = 0;
    let factors = 0;

    if (a.holderCount !== undefined && b.holderCount !== undefined) {
      similarity += this.calculateSimilarity(a.holderCount, b.holderCount, 500);
      factors++;
    }

    if (a.top10Percent !== undefined && b.top10Percent !== undefined) {
      similarity += this.calculateSimilarity(a.top10Percent, b.top10Percent, 30);
      factors++;
    }

    return factors > 0 ? similarity / factors : 0.5;
  }

  /**
   * Calculate similarity between two values
   * Returns 1 for identical values, decreasing to 0 as difference increases
   */
  private calculateSimilarity(a: number, b: number, tolerance: number): number {
    const diff = Math.abs(a - b);
    return Math.max(0, 1 - diff / tolerance);
  }

  /**
   * Calculate Pearson correlation coefficient between two arrays
   */
  private pearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < 3) return 0;

    // Use the last n values
    const xSlice = x.slice(-n);
    const ySlice = y.slice(-n);

    const sumX = xSlice.reduce((a, b) => a + b, 0);
    const sumY = ySlice.reduce((a, b) => a + b, 0);
    const sumXY = xSlice.reduce((total, xi, i) => total + xi * ySlice[i], 0);
    const sumX2 = xSlice.reduce((a, b) => a + b * b, 0);
    const sumY2 = ySlice.reduce((a, b) => a + b * b, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt(
      (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
    );

    if (denominator === 0) return 0;

    // Return absolute correlation (we care about correlation, not direction)
    return Math.abs(numerator / denominator);
  }

  /**
   * Update price history for a token
   */
  updatePriceHistory(mint: string, price: number): void {
    let history = this.priceHistory.get(mint);
    if (!history) {
      history = [];
      this.priceHistory.set(mint, history);
    }

    history.push(price);

    // Keep only recent history
    if (history.length > this.config.priceLookbackPeriods) {
      history.shift();
    }
  }

  /**
   * Get correlation summary for active signals
   */
  getCorrelationSummary(activeSignals: TradingSignal[]): {
    totalSignals: number;
    correlationPairs: number;
    highCorrelationPairs: Array<{
      signalA: string;
      signalB: string;
      correlation: number;
    }>;
    diversificationScore: number; // 0-100, higher is more diversified
  } {
    if (activeSignals.length < 2) {
      return {
        totalSignals: activeSignals.length,
        correlationPairs: 0,
        highCorrelationPairs: [],
        diversificationScore: 100,
      };
    }

    const highCorrelationPairs: Array<{
      signalA: string;
      signalB: string;
      correlation: number;
    }> = [];

    let totalCorrelation = 0;
    let pairCount = 0;

    // Compare all pairs
    for (let i = 0; i < activeSignals.length; i++) {
      for (let j = i + 1; j < activeSignals.length; j++) {
        const a = activeSignals[i];
        const b = activeSignals[j];

        const charA: SignalCharacteristics = {
          mint: a.mint,
          symbol: a.symbol,
          liquidityUsd: 0,
          riskScore: a.riskScore,
          momentumScore: a.momentumScore,
        };

        const charB: SignalCharacteristics = {
          mint: b.mint,
          symbol: b.symbol,
          liquidityUsd: 0,
          riskScore: b.riskScore,
          momentumScore: b.momentumScore,
        };

        const { score } = this.calculateCorrelation(charA, charB);
        totalCorrelation += score;
        pairCount++;

        if (score >= this.config.correlationThreshold) {
          highCorrelationPairs.push({
            signalA: a.symbol,
            signalB: b.symbol,
            correlation: score,
          });
        }
      }
    }

    // Diversification score: 100 - (avgCorrelation * 100)
    const avgCorrelation = pairCount > 0 ? totalCorrelation / pairCount : 0;
    const diversificationScore = Math.round((1 - avgCorrelation) * 100);

    return {
      totalSignals: activeSignals.length,
      correlationPairs: highCorrelationPairs.length,
      highCorrelationPairs,
      diversificationScore,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CorrelationConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info(
      'CorrelationAnalyzer',
      `Config updated: enabled=${this.config.enabled}, threshold=${this.config.correlationThreshold}`
    );
  }

  /**
   * Get current configuration
   */
  getConfig(): CorrelationConfig {
    return { ...this.config };
  }

  /**
   * Clear price history
   */
  clearHistory(): void {
    this.priceHistory.clear();
  }
}

// Export singleton instance
export const correlationAnalyzer = new CorrelationAnalyzer();
