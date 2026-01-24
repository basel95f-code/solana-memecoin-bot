/**
 * Signal Generator
 * Core logic for generating BUY/SELL trading signals based on ML predictions and market data
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { SIGNALS } from '../constants';
import type {
  TradingSignal,
  SignalType,
  SignalConfig,
  SignalGenerationInput,
  PositionSizeConfig,
  KellyConfig,
  SignalOutcome,
  KellyCalculationResult,
} from './types';
import {
  DEFAULT_SIGNAL_CONFIG,
  DEFAULT_POSITION_SIZE_CONFIG,
  DEFAULT_KELLY_CONFIG,
} from './types';
import { KellyCriterion } from './kellyCriterion';
import { correlationAnalyzer, CorrelationAnalyzer, CorrelationResult, CorrelationConfig } from './correlationAnalyzer';

export class SignalGenerator {
  private config: SignalConfig;
  private positionConfig: PositionSizeConfig;
  private kellyCalculator: KellyCriterion;
  private correlationChecker: CorrelationAnalyzer;
  private historicalOutcomes: SignalOutcome[] = [];
  private activeSignals: TradingSignal[] = [];
  private lastSignalTime: Map<string, number> = new Map(); // mint -> timestamp
  private lastKellyResult: KellyCalculationResult | null = null;
  private lastCorrelationResult: CorrelationResult | null = null;

  constructor(
    config: Partial<SignalConfig> = {},
    positionConfig: Partial<PositionSizeConfig> = {},
    kellyConfig: Partial<KellyConfig> = {},
    correlationConfig: Partial<CorrelationConfig> = {}
  ) {
    this.config = { ...DEFAULT_SIGNAL_CONFIG, ...config };
    this.positionConfig = { ...DEFAULT_POSITION_SIZE_CONFIG, ...positionConfig };
    this.kellyCalculator = new KellyCriterion({ ...DEFAULT_KELLY_CONFIG, ...kellyConfig });
    this.correlationChecker = new CorrelationAnalyzer(correlationConfig);
  }

  /**
   * Calculate confidence score for a potential signal
   * Formula:
   * CONFIDENCE = (
   *   (1 - rugProbability) * 0.30 +    // ML rug predictor
   *   (riskScore / 100) * 0.15 +       // Risk score
   *   smartMoneyScore * 0.25 +         // GMGN activity
   *   momentumScore * 0.20 +           // Volume/price momentum
   *   holderScore * 0.10               // Holder distribution
   * ) * 100
   */
  calculateConfidence(input: SignalGenerationInput): {
    confidence: number;
    smartMoneyScore: number;
    momentumScore: number;
    holderScore: number;
  } {
    const weights = this.config.weights;

    // Component 1: Rug probability (inverted - lower is better)
    const rugComponent = (1 - input.rugProbability) * weights.rugProbability;

    // Component 2: Risk score (higher is better, normalized to 0-1)
    const riskComponent = (input.riskScore / 100) * weights.riskScore;

    // Component 3: Smart money score
    const smartMoneyScore = this.calculateSmartMoneyScore(input);
    const smartMoneyComponent = smartMoneyScore * weights.smartMoney;

    // Component 4: Momentum score
    const momentumScore = this.calculateMomentumScore(input);
    const momentumComponent = momentumScore * weights.momentum;

    // Component 5: Holder score
    const holderScore = this.calculateHolderScore(input);
    const holderComponent = holderScore * weights.holders;

    // Total confidence (0-100)
    const confidence = Math.round(
      (rugComponent + riskComponent + smartMoneyComponent + momentumComponent + holderComponent) * 100
    );

    return {
      confidence: Math.max(0, Math.min(100, confidence)),
      smartMoneyScore,
      momentumScore,
      holderScore,
    };
  }

  /**
   * Calculate smart money score (0-1)
   */
  private calculateSmartMoneyScore(input: SignalGenerationInput): number {
    // If smart money data not available, return neutral
    if (input.isSmartMoneyBullish === undefined &&
        input.smartMoneyNetBuys === undefined &&
        input.smartMoneyHolding === undefined) {
      return 0.5;
    }

    let score = 0;
    let factors = 0;

    // Factor 1: Is smart money bullish?
    if (input.isSmartMoneyBullish !== undefined) {
      score += input.isSmartMoneyBullish ? 1 : 0;
      factors++;
    }

    // Factor 2: Net buys (positive = more buys than sells)
    if (input.smartMoneyNetBuys !== undefined) {
      // Normalize: assume typical range is -10 to +10
      const normalizedNetBuys = Math.max(-1, Math.min(1, input.smartMoneyNetBuys / 10));
      score += (normalizedNetBuys + 1) / 2; // Convert -1..1 to 0..1
      factors++;
    }

    // Factor 3: Smart money holding percentage
    if (input.smartMoneyHolding !== undefined) {
      // Higher holding is generally positive, normalize to 0-1
      score += Math.min(1, input.smartMoneyHolding / 20); // Cap at 20%
      factors++;
    }

    return factors > 0 ? score / factors : 0.5;
  }

  /**
   * Calculate momentum score (0-1)
   */
  private calculateMomentumScore(input: SignalGenerationInput): number {
    let score = 0;
    let factors = 0;

    // Factor 1: 1h price change (positive momentum)
    if (input.priceChange1h !== undefined) {
      // Normalize: -50% to +100% range mapped to 0-1
      const normalized = Math.max(0, Math.min(1, (input.priceChange1h + 50) / 150));
      score += normalized;
      factors++;
    }

    // Factor 2: 24h price change
    if (input.priceChange24h !== undefined) {
      const normalized = Math.max(0, Math.min(1, (input.priceChange24h + 50) / 200));
      score += normalized;
      factors++;
    }

    // Factor 3: Volume (higher volume = stronger momentum)
    if (input.volume1h !== undefined && input.liquidityUsd > 0) {
      // Volume to liquidity ratio (healthy range 0.5-5x)
      const volumeRatio = input.volume1h / input.liquidityUsd;
      const normalized = Math.max(0, Math.min(1, volumeRatio / 5));
      score += normalized;
      factors++;
    }

    return factors > 0 ? score / factors : 0.5;
  }

  /**
   * Calculate holder score (0-1)
   */
  private calculateHolderScore(input: SignalGenerationInput): number {
    let score = 0;
    let factors = 0;

    // Factor 1: Holder count (more holders = better distribution)
    if (input.holderCount !== undefined) {
      // Normalize: 10-1000 holders mapped to 0-1
      const normalized = Math.max(0, Math.min(1, Math.log10(input.holderCount + 1) / 3));
      score += normalized;
      factors++;
    }

    // Factor 2: Top 10% concentration (lower is better)
    if (input.top10Percent !== undefined) {
      // Invert: 100% = 0 score, 0% = 1 score
      const normalized = 1 - (input.top10Percent / 100);
      score += normalized;
      factors++;
    }

    // Factor 3: LP burned (safety indicator)
    if (input.lpBurnedPercent !== undefined) {
      const normalized = Math.min(1, input.lpBurnedPercent / 100);
      score += normalized;
      factors++;
    }

    // Factor 4: Authority revoked (safety indicator)
    if (input.mintRevoked) score += 1;
    factors++;

    return factors > 0 ? score / factors : 0.5;
  }

  /**
   * Generate a trading signal if conditions are met
   */
  generateSignal(input: SignalGenerationInput): TradingSignal | null {
    // Check cooldown for this token
    const lastSignal = this.lastSignalTime.get(input.mint);
    if (lastSignal) {
      const cooldownMs = this.config.tokenCooldownSeconds * 1000;
      if (Date.now() - lastSignal < cooldownMs) {
        logger.debug('SignalGenerator', `Token ${input.symbol} is in cooldown`);
        return null;
      }
    }

    // Calculate confidence
    const { confidence, smartMoneyScore, momentumScore, holderScore } = this.calculateConfidence(input);

    // Determine signal type
    const signalType = this.determineSignalType(input, confidence);
    if (!signalType) {
      return null;
    }

    // Check if signal meets thresholds
    if (!this.meetsThresholds(signalType, confidence, input)) {
      return null;
    }

    // Check correlation with active signals
    const correlationResult = this.correlationChecker.analyzeCorrelation(
      input,
      { momentumScore, smartMoneyScore, holderScore },
      this.activeSignals
    );
    this.lastCorrelationResult = correlationResult;

    // Block if too many correlated signals
    if (correlationResult.shouldBlock) {
      logger.info(
        'SignalGenerator',
        `Blocked ${input.symbol} due to correlation: ${correlationResult.blockReason}`
      );
      return null;
    }

    // Generate reasons and warnings
    const { reasons, warnings } = this.generateReasonsAndWarnings(input, confidence, signalType);

    // Add correlation warning if applicable
    if (correlationResult.isCorrelated && correlationResult.warning) {
      warnings.push(correlationResult.warning);
    }

    // Calculate position size
    const { size, sizeType } = this.calculatePositionSize(confidence, input.riskScore);

    // Calculate price targets
    const { targetPrice, stopLossPrice } = this.calculatePriceTargets(input, signalType);

    const now = Math.floor(Date.now() / 1000);
    const signal: TradingSignal = {
      id: uuidv4(),
      mint: input.mint,
      symbol: input.symbol,
      name: input.name,
      type: signalType,
      confidence,
      suggestedPositionSize: size,
      positionSizeType: sizeType,
      rugProbability: input.rugProbability,
      riskScore: input.riskScore,
      smartMoneyScore,
      momentumScore,
      holderScore,
      entryPrice: input.priceUsd,
      targetPrice,
      stopLossPrice,
      reasons,
      warnings,
      generatedAt: now,
      expiresAt: now + this.config.signalExpirySeconds,
      status: 'active',
    };

    // Update cooldown
    this.lastSignalTime.set(input.mint, Date.now());

    logger.info('SignalGenerator', `Generated ${signalType} signal for ${input.symbol} with ${confidence}% confidence`);

    return signal;
  }

  /**
   * Determine what type of signal to generate
   */
  private determineSignalType(input: SignalGenerationInput, confidence: number): SignalType | null {
    // Primary: BUY signals for new/promising tokens
    if (confidence >= this.config.minBuyConfidence &&
        input.rugProbability < this.config.maxRugProbability &&
        input.riskScore >= this.config.minRiskScore) {
      return 'BUY';
    }

    // SELL signals for high rug probability or declining metrics
    if (input.rugProbability > 0.7 || input.riskScore < 20) {
      if (confidence >= this.config.minSellConfidence) {
        return 'SELL';
      }
    }

    // Strong downward momentum can trigger SELL
    if (input.priceChange1h !== undefined && input.priceChange1h < -30) {
      return 'SELL';
    }

    return null;
  }

  /**
   * Check if signal meets all thresholds
   */
  private meetsThresholds(type: SignalType, confidence: number, input: SignalGenerationInput): boolean {
    if (type === 'BUY') {
      return (
        confidence >= this.config.minBuyConfidence &&
        input.rugProbability < this.config.maxRugProbability &&
        input.riskScore >= this.config.minRiskScore
      );
    }

    if (type === 'SELL') {
      return confidence >= this.config.minSellConfidence;
    }

    return true;
  }

  /**
   * Generate reasons and warnings for the signal
   */
  private generateReasonsAndWarnings(
    input: SignalGenerationInput,
    confidence: number,
    signalType: SignalType
  ): { reasons: string[]; warnings: string[] } {
    const reasons: string[] = [];
    const warnings: string[] = [];

    if (signalType === 'BUY') {
      // Positive reasons
      if (input.rugProbability < 0.15) {
        reasons.push('Very low rug probability');
      } else if (input.rugProbability < 0.25) {
        reasons.push('Low rug probability');
      }

      if (input.riskScore >= 70) {
        reasons.push('High safety score');
      } else if (input.riskScore >= 50) {
        reasons.push('Moderate safety score');
      }

      if (input.isSmartMoneyBullish) {
        reasons.push('Smart money is buying');
      }

      if (input.smartMoneyNetBuys !== undefined && input.smartMoneyNetBuys > 5) {
        reasons.push('Strong smart money accumulation');
      }

      if (input.priceChange1h !== undefined && input.priceChange1h > 20) {
        reasons.push('Positive momentum (1h)');
      }

      if (input.mintRevoked && input.freezeRevoked) {
        reasons.push('Contract authorities revoked');
      }

      if (input.lpBurnedPercent !== undefined && input.lpBurnedPercent > 50) {
        reasons.push('Significant LP burned');
      }

      // Warnings
      if (input.top10Percent !== undefined && input.top10Percent > 50) {
        warnings.push('High holder concentration');
      }

      if (input.holderCount !== undefined && input.holderCount < 50) {
        warnings.push('Low holder count');
      }

      if (input.liquidityUsd < 5000) {
        warnings.push('Low liquidity');
      }

      if (!input.mintRevoked) {
        warnings.push('Mint authority not revoked');
      }

    } else if (signalType === 'SELL') {
      // Sell reasons
      if (input.rugProbability > 0.6) {
        reasons.push('High rug probability detected');
      }

      if (input.riskScore < 30) {
        reasons.push('Low safety score');
      }

      if (input.priceChange1h !== undefined && input.priceChange1h < -30) {
        reasons.push('Significant price drop (1h)');
      }

      if (input.isSmartMoneyBullish === false) {
        reasons.push('Smart money is selling');
      }

      // Warnings
      if (confidence < 70) {
        warnings.push('Signal confidence is moderate');
      }
    }

    return { reasons, warnings };
  }

  /**
   * Calculate suggested position size
   * Uses Kelly criterion when enabled, otherwise falls back to default logic
   */
  private calculatePositionSize(confidence: number, riskScore: number): {
    size: number;
    sizeType: 'percentage' | 'fixed_sol';
    kellyUsed?: boolean;
  } {
    const config = this.positionConfig;

    // Try Kelly criterion first if enabled
    const kellyConfig = this.kellyCalculator.getConfig();
    if (kellyConfig.enabled && config.type === 'percentage') {
      const kellyResult = this.kellyCalculator.calculate(
        this.historicalOutcomes,
        confidence
      );
      this.lastKellyResult = kellyResult;

      if (kellyResult.kellyUsed && kellyResult.suggestedPositionPercent > 0) {
        logger.debug(
          'SignalGenerator',
          `Using Kelly position: ${kellyResult.suggestedPositionPercent}% ` +
            `(optimal: ${(kellyResult.optimalFraction * 100).toFixed(1)}%, ` +
            `WR: ${(kellyResult.winRate * 100).toFixed(1)}%, ` +
            `W/L: ${kellyResult.winLossRatio.toFixed(2)})`
        );
        return {
          size: kellyResult.suggestedPositionPercent,
          sizeType: 'percentage',
          kellyUsed: true,
        };
      }
    }

    // Fall back to default position sizing
    let baseSize: number;

    if (config.type === 'percentage') {
      baseSize = config.defaultPercentage;

      // Adjust by confidence if enabled
      if (config.adjustByConfidence) {
        // Higher confidence = larger position (scale 0.5-1.5x)
        const confidenceMultiplier = 0.5 + (confidence / 100);
        baseSize *= confidenceMultiplier;
      }

      // Adjust by risk if enabled
      if (config.adjustByRisk) {
        // Higher risk score = larger position (scale 0.5-1.5x)
        const riskMultiplier = 0.5 + (riskScore / 100);
        baseSize *= riskMultiplier;
      }

      // Clamp to min/max
      baseSize = Math.max(config.minPercentage, Math.min(config.maxPercentage, baseSize));
      return { size: Math.round(baseSize * 10) / 10, sizeType: 'percentage', kellyUsed: false };

    } else {
      baseSize = config.defaultSol;

      if (config.adjustByConfidence) {
        const confidenceMultiplier = 0.5 + (confidence / 100);
        baseSize *= confidenceMultiplier;
      }

      if (config.adjustByRisk) {
        const riskMultiplier = 0.5 + (riskScore / 100);
        baseSize *= riskMultiplier;
      }

      baseSize = Math.max(config.minSol, Math.min(config.maxSol, baseSize));
      return { size: Math.round(baseSize * 1000) / 1000, sizeType: 'fixed_sol', kellyUsed: false };
    }
  }

  /**
   * Calculate price targets based on signal type
   */
  private calculatePriceTargets(input: SignalGenerationInput, signalType: SignalType): {
    targetPrice?: number;
    stopLossPrice?: number;
  } {
    if (signalType !== 'BUY') {
      return {};
    }

    // Default targets based on risk
    // Higher risk = higher potential reward but also higher stop loss
    let targetMultiplier = 1.5; // 50% gain target
    let stopLossMultiplier = 0.8; // 20% stop loss

    // Adjust based on confidence
    if (input.riskScore >= 70) {
      // Safer token - more conservative targets
      targetMultiplier = 1.3;
      stopLossMultiplier = 0.85;
    } else if (input.riskScore < 40) {
      // Riskier token - wider targets
      targetMultiplier = 2.0;
      stopLossMultiplier = 0.7;
    }

    return {
      targetPrice: input.priceUsd * targetMultiplier,
      stopLossPrice: input.priceUsd * stopLossMultiplier,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SignalConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Update position sizing configuration
   */
  updatePositionConfig(config: Partial<PositionSizeConfig>): void {
    this.positionConfig = { ...this.positionConfig, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): SignalConfig {
    return { ...this.config };
  }

  /**
   * Clear cooldowns (for testing)
   */
  clearCooldowns(): void {
    this.lastSignalTime.clear();
  }

  /**
   * Update Kelly criterion configuration
   */
  updateKellyConfig(config: Partial<KellyConfig>): void {
    this.kellyCalculator.updateConfig(config);
  }

  /**
   * Get Kelly criterion configuration
   */
  getKellyConfig(): KellyConfig {
    return this.kellyCalculator.getConfig();
  }

  /**
   * Get Kelly criterion description
   */
  getKellyDescription(): string {
    return this.kellyCalculator.getDescription();
  }

  /**
   * Get last Kelly calculation result
   */
  getLastKellyResult(): KellyCalculationResult | null {
    return this.lastKellyResult;
  }

  /**
   * Update historical outcomes for Kelly calculation
   * @param outcomes - Array of signal outcomes with P&L data
   */
  updateHistoricalOutcomes(outcomes: SignalOutcome[]): void {
    this.historicalOutcomes = outcomes;
    logger.debug('SignalGenerator', `Updated historical outcomes: ${outcomes.length} trades`);
  }

  /**
   * Add a single outcome to historical data
   */
  addOutcome(outcome: SignalOutcome): void {
    this.historicalOutcomes.push(outcome);
    // Keep only recent outcomes (based on lookback config)
    const lookback = this.kellyCalculator.getConfig().lookbackTrades;
    if (this.historicalOutcomes.length > lookback * 2) {
      this.historicalOutcomes = this.historicalOutcomes
        .sort((a, b) => (b.exitRecordedAt || 0) - (a.exitRecordedAt || 0))
        .slice(0, lookback * 2);
    }
  }

  /**
   * Get Kelly historical metrics
   */
  getKellyMetrics(): {
    enabled: boolean;
    tradeCount: number;
    winRate: number;
    winLossRatio: number;
    suggestedPosition: number;
    fallbackReason?: string;
  } {
    const config = this.kellyCalculator.getConfig();
    if (!config.enabled) {
      return {
        enabled: false,
        tradeCount: 0,
        winRate: 0,
        winLossRatio: 0,
        suggestedPosition: 0,
        fallbackReason: 'Kelly criterion disabled',
      };
    }

    const result = this.kellyCalculator.calculate(this.historicalOutcomes);
    return {
      enabled: true,
      tradeCount: result.tradeCount,
      winRate: result.winRate,
      winLossRatio: result.winLossRatio,
      suggestedPosition: result.suggestedPositionPercent,
      fallbackReason: result.fallbackReason,
    };
  }

  // ============================================
  // Correlation Methods
  // ============================================

  /**
   * Update active signals for correlation checking
   */
  updateActiveSignals(signals: TradingSignal[]): void {
    this.activeSignals = signals;
    logger.debug('SignalGenerator', `Updated active signals: ${signals.length}`);
  }

  /**
   * Add a signal to active signals
   */
  addActiveSignal(signal: TradingSignal): void {
    this.activeSignals.push(signal);
  }

  /**
   * Remove a signal from active signals
   */
  removeActiveSignal(signalId: string): void {
    this.activeSignals = this.activeSignals.filter((s) => s.id !== signalId);
  }

  /**
   * Update correlation configuration
   */
  updateCorrelationConfig(config: Partial<CorrelationConfig>): void {
    this.correlationChecker.updateConfig(config);
  }

  /**
   * Get correlation configuration
   */
  getCorrelationConfig(): CorrelationConfig {
    return this.correlationChecker.getConfig();
  }

  /**
   * Get last correlation result
   */
  getLastCorrelationResult(): CorrelationResult | null {
    return this.lastCorrelationResult;
  }

  /**
   * Get correlation summary for active signals
   */
  getCorrelationSummary(): {
    totalSignals: number;
    correlationPairs: number;
    highCorrelationPairs: Array<{
      signalA: string;
      signalB: string;
      correlation: number;
    }>;
    diversificationScore: number;
  } {
    return this.correlationChecker.getCorrelationSummary(this.activeSignals);
  }

  /**
   * Update price history for correlation calculation
   */
  updatePriceHistory(mint: string, price: number): void {
    this.correlationChecker.updatePriceHistory(mint, price);
  }
}

// Export singleton instance
export const signalGenerator = new SignalGenerator();
