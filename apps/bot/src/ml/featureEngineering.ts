/**
 * Feature Engineering
 * Enhanced feature extraction with 25 features for ML training
 */

import { logger } from '../utils/logger';
import { ML_TRAINING } from '../constants';
import type { TokenAnalysis, SmartMoneyActivity, DexScreenerPair, MultiPlatformSentimentAnalysis } from '../types';

// ============================================
// Feature Types
// ============================================

export interface EnhancedFeatures {
  // Existing features (9)
  liquidityUsd: number;
  riskScore: number;
  holderCount: number;
  top10Percent: number;
  mintRevoked: number; // 0 or 1
  freezeRevoked: number; // 0 or 1
  lpBurnedPercent: number;
  hasSocials: number; // 0 or 1
  tokenAgeHours: number;

  // New Momentum features (6)
  priceChange5m: number;
  priceChange1h: number;
  priceChange24h: number;
  volumeChange1h: number;
  volumeChange24h: number;
  buyPressure1h: number; // buys / total trades

  // New Smart Money features (3)
  smartMoneyNetBuys: number;
  smartMoneyHolding: number;
  isSmartMoneyBullish: number; // 0 or 1

  // New Trend features (4)
  priceVelocity: number;
  volumeAcceleration: number;
  liquidityTrend: number;
  holderTrend: number;

  // New Pattern features (3)
  hasVolumeSpike: number; // 0 or 1
  isPumping: number; // 0 or 1
  isDumping: number; // 0 or 1

  // Sentiment features (3)
  sentimentScore: number; // -1 to +1
  sentimentConfidence: number; // 0 to 1
  hasSentimentData: number; // 0 or 1
}

export interface NormalizedFeatures {
  features: number[];
  featureNames: string[];
  raw: EnhancedFeatures;
}

// Feature names in order
export const FEATURE_NAMES: (keyof EnhancedFeatures)[] = [
  // Existing (9)
  'liquidityUsd',
  'riskScore',
  'holderCount',
  'top10Percent',
  'mintRevoked',
  'freezeRevoked',
  'lpBurnedPercent',
  'hasSocials',
  'tokenAgeHours',
  // Momentum (6)
  'priceChange5m',
  'priceChange1h',
  'priceChange24h',
  'volumeChange1h',
  'volumeChange24h',
  'buyPressure1h',
  // Smart Money (3)
  'smartMoneyNetBuys',
  'smartMoneyHolding',
  'isSmartMoneyBullish',
  // Trends (4)
  'priceVelocity',
  'volumeAcceleration',
  'liquidityTrend',
  'holderTrend',
  // Patterns (3)
  'hasVolumeSpike',
  'isPumping',
  'isDumping',
  // Sentiment (3)
  'sentimentScore',
  'sentimentConfidence',
  'hasSentimentData',
];

export const FEATURE_COUNT = FEATURE_NAMES.length; // 28

// ============================================
// Feature Extraction
// ============================================

export class FeatureEngineering {
  /**
   * Extract features from token analysis
   */
  extractFeatures(
    analysis: TokenAnalysis,
    dexData?: DexScreenerPair | null,
    smartMoney?: SmartMoneyActivity | null,
    previousSnapshot?: { priceUsd: number; volume1h: number; liquidityUsd: number; holderCount: number } | null,
    sentiment?: MultiPlatformSentimentAnalysis | null
  ): EnhancedFeatures {
    const now = Date.now();
    const tokenAgeHours = analysis.pool?.createdAt
      ? (now - analysis.pool.createdAt.getTime()) / (1000 * 60 * 60)
      : 0;

    // Existing features
    const features: EnhancedFeatures = {
      liquidityUsd: analysis.liquidity?.totalLiquidityUsd ?? 0,
      riskScore: analysis.risk?.score ?? 0,
      holderCount: analysis.holders?.totalHolders ?? 0,
      top10Percent: analysis.holders?.top10HoldersPercent ?? 0,
      mintRevoked: analysis.contract?.mintAuthorityRevoked ? 1 : 0,
      freezeRevoked: analysis.contract?.freezeAuthorityRevoked ? 1 : 0,
      lpBurnedPercent: analysis.liquidity?.lpBurnedPercent ?? 0,
      hasSocials: (analysis.social?.hasTwitter || analysis.social?.hasTelegram || analysis.social?.hasWebsite) ? 1 : 0,
      tokenAgeHours,

      // Momentum features - default to 0 if not available
      priceChange5m: dexData?.priceChange?.m5 ?? 0,
      priceChange1h: dexData?.priceChange?.h1 ?? 0,
      priceChange24h: dexData?.priceChange?.h24 ?? 0,
      volumeChange1h: this.calculateVolumeChange(dexData?.volume?.h1, previousSnapshot?.volume1h),
      volumeChange24h: 0, // Would need 24h historical data
      buyPressure1h: this.calculateBuyPressure(dexData?.txns?.h1),

      // Smart money features
      smartMoneyNetBuys: smartMoney?.netSmartMoney ?? 0,
      smartMoneyHolding: smartMoney?.smartMoneyHolding ?? 0,
      isSmartMoneyBullish: smartMoney?.isSmartMoneyBullish ? 1 : 0,

      // Trend features
      priceVelocity: this.calculateVelocity(dexData?.priceChange?.m5, dexData?.priceChange?.h1),
      volumeAcceleration: this.calculateAcceleration(dexData?.volume),
      liquidityTrend: this.calculateTrend(analysis.liquidity?.totalLiquidityUsd, previousSnapshot?.liquidityUsd),
      holderTrend: this.calculateTrend(analysis.holders?.totalHolders, previousSnapshot?.holderCount),

      // Pattern features
      hasVolumeSpike: this.detectVolumeSpike(dexData?.volume) ? 1 : 0,
      isPumping: this.detectPumping(dexData?.priceChange) ? 1 : 0,
      isDumping: this.detectDumping(dexData?.priceChange) ? 1 : 0,

      // Sentiment features
      sentimentScore: sentiment?.sentimentScore ?? 0,
      sentimentConfidence: sentiment?.confidence ?? 0,
      hasSentimentData: sentiment?.hasSentimentData ? 1 : 0,
    };

    return features;
  }

  /**
   * Extract features from basic input data (for labeling and simple cases)
   */
  extractFeaturesBasic(input: {
    liquidityUsd: number;
    riskScore: number;
    holderCount: number;
    top10Percent: number;
    mintRevoked: boolean;
    freezeRevoked: boolean;
    lpBurnedPercent: number;
    hasSocials: boolean;
    tokenAgeHours: number;
  }): EnhancedFeatures {
    return {
      // Core features from input
      liquidityUsd: input.liquidityUsd,
      riskScore: input.riskScore,
      holderCount: input.holderCount,
      top10Percent: input.top10Percent,
      mintRevoked: input.mintRevoked ? 1 : 0,
      freezeRevoked: input.freezeRevoked ? 1 : 0,
      lpBurnedPercent: input.lpBurnedPercent,
      hasSocials: input.hasSocials ? 1 : 0,
      tokenAgeHours: input.tokenAgeHours,

      // Default values for momentum features
      priceChange5m: 0,
      priceChange1h: 0,
      priceChange24h: 0,
      volumeChange1h: 0,
      volumeChange24h: 0,
      buyPressure1h: 0.5,

      // Default values for smart money features
      smartMoneyNetBuys: 0,
      smartMoneyHolding: 0,
      isSmartMoneyBullish: 0,

      // Default values for trend features
      priceVelocity: 0,
      volumeAcceleration: 0,
      liquidityTrend: 0,
      holderTrend: 0,

      // Default values for pattern features
      hasVolumeSpike: 0,
      isPumping: 0,
      isDumping: 0,

      // Default values for sentiment features
      sentimentScore: 0,
      sentimentConfidence: 0,
      hasSentimentData: 0,
    };
  }

  /**
   * Convert EnhancedFeatures to Record<string, number> for storage
   */
  featuresToRecord(features: EnhancedFeatures): Record<string, number> {
    const record: Record<string, number> = {};
    for (const name of FEATURE_NAMES) {
      record[name] = features[name];
    }
    return record;
  }

  /**
   * Calculate volume change percentage
   */
  private calculateVolumeChange(current?: number, previous?: number): number {
    if (!previous || previous === 0) return 0;
    if (!current) return -100;
    return ((current - previous) / previous) * 100;
  }

  /**
   * Calculate buy pressure (buys / total trades)
   */
  private calculateBuyPressure(txns?: { buys: number; sells: number }): number {
    if (!txns) return 0.5;
    const total = txns.buys + txns.sells;
    if (total === 0) return 0.5;
    return txns.buys / total;
  }

  /**
   * Calculate price velocity (rate of change acceleration)
   */
  private calculateVelocity(change5m?: number, change1h?: number): number {
    if (change5m === undefined || change1h === undefined) return 0;
    // If 5m change is greater than proportional 1h change, price is accelerating
    const expected5m = change1h / 12; // 1h has 12 5-minute periods
    return change5m - expected5m;
  }

  /**
   * Calculate volume acceleration
   */
  private calculateAcceleration(volume?: { m5: number; h1: number; h6: number; h24: number }): number {
    if (!volume) return 0;
    // Compare recent volume to average
    const avgHourly = volume.h24 / 24;
    if (avgHourly === 0) return 0;
    return (volume.h1 - avgHourly) / avgHourly;
  }

  /**
   * Calculate trend between current and previous values
   */
  private calculateTrend(current?: number, previous?: number): number {
    if (!previous || previous === 0) return 0;
    if (!current) return -1;
    return (current - previous) / previous;
  }

  /**
   * Detect volume spike (5x normal volume)
   */
  private detectVolumeSpike(volume?: { m5: number; h1: number; h6: number; h24: number }): boolean {
    if (!volume) return false;
    const avgHourly = volume.h24 / 24;
    return volume.h1 > avgHourly * 5;
  }

  /**
   * Detect pumping pattern (strong upward momentum)
   */
  private detectPumping(priceChange?: { m5: number; h1: number; h6: number; h24: number }): boolean {
    if (!priceChange) return false;
    return priceChange.m5 > 10 && priceChange.h1 > 30;
  }

  /**
   * Detect dumping pattern (strong downward momentum)
   */
  private detectDumping(priceChange?: { m5: number; h1: number; h6: number; h24: number }): boolean {
    if (!priceChange) return false;
    return priceChange.m5 < -10 && priceChange.h1 < -30;
  }

  /**
   * Normalize features to 0-1 range for ML model
   */
  normalizeFeatures(features: EnhancedFeatures): NormalizedFeatures {
    const normalized: number[] = [];

    // Existing features
    normalized.push(this.normalizeLogScale(features.liquidityUsd, ML_TRAINING.MAX_LIQUIDITY_USD));
    normalized.push(features.riskScore / 100);
    normalized.push(this.normalizeLogScale(features.holderCount, ML_TRAINING.MAX_HOLDER_COUNT));
    normalized.push(features.top10Percent / 100);
    normalized.push(features.mintRevoked);
    normalized.push(features.freezeRevoked);
    normalized.push(features.lpBurnedPercent / 100);
    normalized.push(features.hasSocials);
    normalized.push(Math.min(1, features.tokenAgeHours / ML_TRAINING.MAX_TOKEN_AGE_HOURS));

    // Momentum features (clamp to -100 to +200 range, then normalize)
    normalized.push(this.normalizePriceChange(features.priceChange5m));
    normalized.push(this.normalizePriceChange(features.priceChange1h));
    normalized.push(this.normalizePriceChange(features.priceChange24h));
    normalized.push(this.normalizePriceChange(features.volumeChange1h));
    normalized.push(this.normalizePriceChange(features.volumeChange24h));
    normalized.push(features.buyPressure1h); // Already 0-1

    // Smart money features
    normalized.push(this.normalizeSmartMoney(features.smartMoneyNetBuys));
    normalized.push(Math.min(1, features.smartMoneyHolding / 30)); // Cap at 30%
    normalized.push(features.isSmartMoneyBullish);

    // Trend features (normalize -1 to +1 range to 0-1)
    normalized.push((features.priceVelocity + 50) / 100); // Assume -50 to +50 range
    normalized.push((features.volumeAcceleration + 5) / 10); // Assume -5 to +5 range
    normalized.push((features.liquidityTrend + 1) / 2); // -1 to +1 -> 0 to 1
    normalized.push((features.holderTrend + 1) / 2);

    // Pattern features (binary)
    normalized.push(features.hasVolumeSpike);
    normalized.push(features.isPumping);
    normalized.push(features.isDumping);

    // Sentiment features
    normalized.push((features.sentimentScore + 1) / 2); // -1 to +1 -> 0 to 1
    normalized.push(features.sentimentConfidence); // Already 0-1
    normalized.push(features.hasSentimentData); // Binary 0 or 1

    // Clamp all values to 0-1
    const clampedNormalized = normalized.map(v => Math.max(0, Math.min(1, v)));

    return {
      features: clampedNormalized,
      featureNames: FEATURE_NAMES as string[],
      raw: features,
    };
  }

  /**
   * Normalize using log scale for large value ranges
   */
  private normalizeLogScale(value: number, maxValue: number): number {
    if (value <= 0) return 0;
    const logValue = Math.log10(value + 1);
    const logMax = Math.log10(maxValue + 1);
    return Math.min(1, logValue / logMax);
  }

  /**
   * Normalize price change (-100 to +200 -> 0 to 1)
   */
  private normalizePriceChange(change: number): number {
    const clamped = Math.max(-100, Math.min(200, change));
    return (clamped + 100) / 300;
  }

  /**
   * Normalize smart money net buys (-20 to +20 -> 0 to 1)
   */
  private normalizeSmartMoney(netBuys: number): number {
    const clamped = Math.max(-20, Math.min(20, netBuys));
    return (clamped + 20) / 40;
  }

  /**
   * Get feature importance weights (for display purposes)
   */
  getFeatureImportanceDisplay(): Record<string, string> {
    return {
      liquidityUsd: 'Liquidity USD',
      riskScore: 'Risk Score',
      holderCount: 'Holder Count',
      top10Percent: 'Top 10% Holdings',
      mintRevoked: 'Mint Revoked',
      freezeRevoked: 'Freeze Revoked',
      lpBurnedPercent: 'LP Burned %',
      hasSocials: 'Has Socials',
      tokenAgeHours: 'Token Age',
      priceChange5m: 'Price Change 5m',
      priceChange1h: 'Price Change 1h',
      priceChange24h: 'Price Change 24h',
      volumeChange1h: 'Volume Change 1h',
      volumeChange24h: 'Volume Change 24h',
      buyPressure1h: 'Buy Pressure 1h',
      smartMoneyNetBuys: 'Smart Money Net Buys',
      smartMoneyHolding: 'Smart Money Holding',
      isSmartMoneyBullish: 'Smart Money Bullish',
      priceVelocity: 'Price Velocity',
      volumeAcceleration: 'Volume Acceleration',
      liquidityTrend: 'Liquidity Trend',
      holderTrend: 'Holder Trend',
      hasVolumeSpike: 'Volume Spike',
      isPumping: 'Is Pumping',
      isDumping: 'Is Dumping',
      sentimentScore: 'Sentiment Score',
      sentimentConfidence: 'Sentiment Confidence',
      hasSentimentData: 'Has Sentiment Data',
    };
  }
}

// Export singleton instance
export const featureEngineering = new FeatureEngineering();
