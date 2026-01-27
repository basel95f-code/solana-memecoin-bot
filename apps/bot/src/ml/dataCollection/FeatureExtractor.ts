/**
 * Feature Extractor
 * Comprehensive feature extraction for ML training data
 * 
 * Extracts all 28 ML features with proper normalization and validation
 */

import { logger } from '../../utils/logger';
import { database } from '../../database';
import { smartMoneyTracker } from '../../services/smartMoney/tracker';
import { SentimentTracker } from '../../services/sentiment';

// Initialize sentiment tracker
const sentimentAnalyzer = new SentimentTracker();
import type { TokenSnapshot, MLFeatureVector } from './types';
import type { DexScreenerPair, SmartMoneyActivity, MultiPlatformSentimentAnalysis } from '../../types';

// ============================================
// Feature Names (in order)
// ============================================

export const FEATURE_NAMES: (keyof MLFeatureVector)[] = [
  // Core (9)
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
// Normalization Configuration
// ============================================

const NORMALIZATION = {
  // Log scale normalization
  MAX_LIQUIDITY_USD: 1_000_000, // $1M
  MAX_HOLDER_COUNT: 100_000,
  MAX_TOKEN_AGE_HOURS: 720, // 30 days
  
  // Price change normalization (-100% to +500%)
  PRICE_CHANGE_MIN: -100,
  PRICE_CHANGE_MAX: 500,
  
  // Smart money normalization
  SMART_MONEY_NET_BUYS_MAX: 50,
  SMART_MONEY_HOLDING_MAX: 50, // 50% of supply
  
  // Velocity/Acceleration bounds
  VELOCITY_RANGE: 100, // -100 to +100
  ACCELERATION_RANGE: 10, // -10 to +10
  
  // Trend bounds
  TREND_RANGE: 2, // -2 to +2 (200% change)
};

// ============================================
// Feature Extractor
// ============================================

export class FeatureExtractor {
  
  /**
   * Create a full snapshot with all features
   */
  async createSnapshot(
    mint: string,
    symbol: string,
    options: {
      dexData?: any;
      gmgnData?: any;
      includeSmartMoney?: boolean;
      includeSentiment?: boolean;
    }
  ): Promise<TokenSnapshot | null> {
    try {
      const now = Date.now();
      const { dexData, gmgnData, includeSmartMoney, includeSentiment } = options;
      
      // Get previous snapshot for trend calculations
      const previousSnapshot = this.getPreviousSnapshot(mint);
      
      // Extract smart money data if requested
      let smartMoneyData: SmartMoneyActivity | null = null;
      if (includeSmartMoney) {
        try {
          smartMoneyData = await smartMoneyTracker.getTokenActivity(mint);
        } catch (e) {
          // Continue without smart money data
        }
      }
      
      // Extract sentiment data if requested
      // TODO: Implement sentiment analysis method in SentimentTracker
      let sentimentData: MultiPlatformSentimentAnalysis | null = null;
      // if (includeSentiment) {
      //   try {
      //     sentimentData = await sentimentAnalyzer.getSentiment(mint);
      //   } catch (e) {
      //     // Continue without sentiment data
      //   }
      // }
      
      // Merge data sources (prioritize GMGN for real-time data)
      const mergedData = this.mergeDataSources(dexData, gmgnData);
      
      if (!mergedData.priceUsd) {
        return null;
      }
      
      // Create snapshot
      const snapshot: TokenSnapshot = {
        mint,
        symbol,
        name: mergedData.name,
        
        // Price/Market
        priceUsd: mergedData.priceUsd,
        priceSol: mergedData.priceSol,
        marketCap: mergedData.marketCap,
        fdv: mergedData.fdv,
        
        // Volume
        volume5m: mergedData.volume5m || 0,
        volume1h: mergedData.volume1h || 0,
        volume24h: mergedData.volume24h || 0,
        
        // Liquidity
        liquidityUsd: mergedData.liquidityUsd || 0,
        lpBurnedPercent: mergedData.lpBurnedPercent || 0,
        lpLockedPercent: mergedData.lpLockedPercent || 0,
        
        // Holders
        holderCount: mergedData.holderCount || 0,
        top10Percent: mergedData.top10Percent || 0,
        top20Percent: mergedData.top20Percent,
        largestHolderPercent: mergedData.largestHolderPercent,
        
        // Contract
        mintRevoked: mergedData.mintRevoked ?? false,
        freezeRevoked: mergedData.freezeRevoked ?? false,
        isHoneypot: mergedData.isHoneypot ?? false,
        
        // Social
        hasTwitter: mergedData.hasTwitter ?? false,
        hasTelegram: mergedData.hasTelegram ?? false,
        hasWebsite: mergedData.hasWebsite ?? false,
        twitterFollowers: mergedData.twitterFollowers,
        telegramMembers: mergedData.telegramMembers,
        
        // Momentum
        priceChange5m: mergedData.priceChange5m || 0,
        priceChange1h: mergedData.priceChange1h || 0,
        priceChange24h: mergedData.priceChange24h || 0,
        buys5m: mergedData.buys5m || 0,
        sells5m: mergedData.sells5m || 0,
        buys1h: mergedData.buys1h || 0,
        sells1h: mergedData.sells1h || 0,
        
        // Smart Money
        smartMoneyNetBuys: smartMoneyData?.netSmartMoney,
        smartMoneyHolding: smartMoneyData?.smartMoneyHolding,
        isSmartMoneyBullish: smartMoneyData?.isSmartMoneyBullish,
        
        // Sentiment
        sentimentScore: sentimentData?.sentimentScore,
        sentimentConfidence: sentimentData?.confidence,
        
        // Risk
        riskScore: mergedData.riskScore || 50,
        rugProbability: mergedData.rugProbability,
        
        // Metadata
        source: mergedData.source || 'mixed',
        poolAddress: mergedData.poolAddress,
        createdAt: new Date(mergedData.createdAt || now),
        recordedAt: Math.floor(now / 1000),
      };
      
      // Extract ML features
      snapshot.features = this.extractFeatures(snapshot, previousSnapshot, smartMoneyData, sentimentData);
      snapshot.normalizedFeatures = this.normalizeFeatures(snapshot.features);
      
      return snapshot;
      
    } catch (error) {
      logger.silentError('FeatureExtractor', `Failed to create snapshot for ${symbol}`, error as Error);
      return null;
    }
  }

  /**
   * Merge data from multiple sources
   */
  private mergeDataSources(dexData: any, gmgnData: any): any {
    const merged: any = {};
    
    // Prioritize GMGN for real-time data, fall back to DEXScreener
    if (gmgnData) {
      merged.priceUsd = gmgnData.price || gmgnData.priceUsd;
      merged.priceSol = gmgnData.priceSol;
      merged.marketCap = gmgnData.marketCap || gmgnData.mc;
      merged.fdv = gmgnData.fdv;
      merged.volume5m = gmgnData.volume5m || gmgnData.v5m;
      merged.volume1h = gmgnData.volume1h || gmgnData.v1h;
      merged.volume24h = gmgnData.volume24h || gmgnData.v24h;
      merged.liquidityUsd = gmgnData.liquidity || gmgnData.liquidityUsd;
      merged.holderCount = gmgnData.holderCount || gmgnData.holders;
      merged.top10Percent = gmgnData.top10Percent || gmgnData.top10;
      merged.priceChange5m = gmgnData.priceChange5m || gmgnData.change5m;
      merged.priceChange1h = gmgnData.priceChange1h || gmgnData.change1h;
      merged.priceChange24h = gmgnData.priceChange24h || gmgnData.change24h;
      merged.buys5m = gmgnData.buys5m || gmgnData.buys?.m5;
      merged.sells5m = gmgnData.sells5m || gmgnData.sells?.m5;
      merged.buys1h = gmgnData.buys1h || gmgnData.buys?.h1;
      merged.sells1h = gmgnData.sells1h || gmgnData.sells?.h1;
      merged.lpBurnedPercent = gmgnData.lpBurnedPercent || gmgnData.lpBurned;
      merged.mintRevoked = gmgnData.mintRevoked ?? gmgnData.renounced;
      merged.freezeRevoked = gmgnData.freezeRevoked;
      merged.name = gmgnData.name;
      merged.poolAddress = gmgnData.poolAddress;
      merged.createdAt = gmgnData.createdAt;
      merged.source = 'gmgn';
    }
    
    // Fill missing from DEXScreener
    if (dexData) {
      merged.priceUsd = merged.priceUsd || dexData.priceUsd;
      merged.marketCap = merged.marketCap || dexData.marketCap || dexData.fdv;
      merged.fdv = merged.fdv || dexData.fdv;
      merged.volume5m = merged.volume5m || dexData.volume?.m5;
      merged.volume1h = merged.volume1h || dexData.volume?.h1;
      merged.volume24h = merged.volume24h || dexData.volume?.h24;
      merged.liquidityUsd = merged.liquidityUsd || dexData.liquidity?.usd;
      merged.priceChange5m = merged.priceChange5m || dexData.priceChange?.m5;
      merged.priceChange1h = merged.priceChange1h || dexData.priceChange?.h1;
      merged.priceChange24h = merged.priceChange24h || dexData.priceChange?.h24;
      merged.buys5m = merged.buys5m || dexData.txns?.m5?.buys;
      merged.sells5m = merged.sells5m || dexData.txns?.m5?.sells;
      merged.buys1h = merged.buys1h || dexData.txns?.h1?.buys;
      merged.sells1h = merged.sells1h || dexData.txns?.h1?.sells;
      merged.name = merged.name || dexData.baseToken?.name;
      merged.poolAddress = merged.poolAddress || dexData.pairAddress;
      merged.createdAt = merged.createdAt || dexData.pairCreatedAt;
      merged.hasTwitter = dexData.info?.socials?.some((s: any) => s.type === 'twitter');
      merged.hasTelegram = dexData.info?.socials?.some((s: any) => s.type === 'telegram');
      merged.hasWebsite = !!dexData.info?.websites?.length;
      
      if (!merged.source) merged.source = 'dexscreener';
    }
    
    return merged;
  }

  /**
   * Get previous snapshot for trend calculations
   */
  private getPreviousSnapshot(mint: string): any {
    try {
      const snapshots = database.getTokenSnapshots(mint, 2);
      if (snapshots.length >= 2) {
        return snapshots[1]; // Return the second most recent
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extract all ML features
   */
  extractFeatures(
    snapshot: TokenSnapshot,
    previousSnapshot: any,
    smartMoney?: SmartMoneyActivity | null,
    sentiment?: MultiPlatformSentimentAnalysis | null
  ): MLFeatureVector {
    const tokenAgeHours = snapshot.createdAt
      ? (Date.now() - snapshot.createdAt.getTime()) / (1000 * 60 * 60)
      : 0;
    
    return {
      // === Core Features (9) ===
      liquidityUsd: snapshot.liquidityUsd,
      riskScore: snapshot.riskScore,
      holderCount: snapshot.holderCount,
      top10Percent: snapshot.top10Percent,
      mintRevoked: snapshot.mintRevoked ? 1 : 0,
      freezeRevoked: snapshot.freezeRevoked ? 1 : 0,
      lpBurnedPercent: snapshot.lpBurnedPercent,
      hasSocials: (snapshot.hasTwitter || snapshot.hasTelegram || snapshot.hasWebsite) ? 1 : 0,
      tokenAgeHours,
      
      // === Momentum Features (6) ===
      priceChange5m: snapshot.priceChange5m,
      priceChange1h: snapshot.priceChange1h,
      priceChange24h: snapshot.priceChange24h,
      volumeChange1h: this.calculateVolumeChange(snapshot, previousSnapshot),
      volumeChange24h: this.calculateVolumeChange24h(snapshot),
      buyPressure1h: this.calculateBuyPressure(snapshot.buys1h, snapshot.sells1h),
      
      // === Smart Money Features (3) ===
      smartMoneyNetBuys: smartMoney?.netSmartMoney ?? snapshot.smartMoneyNetBuys ?? 0,
      smartMoneyHolding: smartMoney?.smartMoneyHolding ?? snapshot.smartMoneyHolding ?? 0,
      isSmartMoneyBullish: (smartMoney?.isSmartMoneyBullish ?? snapshot.isSmartMoneyBullish) ? 1 : 0,
      
      // === Trend Features (4) ===
      priceVelocity: this.calculatePriceVelocity(snapshot.priceChange5m, snapshot.priceChange1h),
      volumeAcceleration: this.calculateVolumeAcceleration(snapshot),
      liquidityTrend: this.calculateTrend(snapshot.liquidityUsd, previousSnapshot?.liquidity_usd),
      holderTrend: this.calculateTrend(snapshot.holderCount, previousSnapshot?.holder_count),
      
      // === Pattern Features (3) ===
      hasVolumeSpike: this.detectVolumeSpike(snapshot) ? 1 : 0,
      isPumping: this.detectPumping(snapshot) ? 1 : 0,
      isDumping: this.detectDumping(snapshot) ? 1 : 0,
      
      // === Sentiment Features (3) ===
      sentimentScore: sentiment?.sentimentScore ?? snapshot.sentimentScore ?? 0,
      sentimentConfidence: sentiment?.confidence ?? snapshot.sentimentConfidence ?? 0,
      hasSentimentData: (sentiment?.hasSentimentData ?? (snapshot.sentimentScore !== undefined)) ? 1 : 0,
    };
  }

  /**
   * Normalize features to 0-1 range
   */
  normalizeFeatures(features: MLFeatureVector): number[] {
    const normalized: number[] = [];
    
    // Core features
    normalized.push(this.normalizeLogScale(features.liquidityUsd, NORMALIZATION.MAX_LIQUIDITY_USD));
    normalized.push(features.riskScore / 100);
    normalized.push(this.normalizeLogScale(features.holderCount, NORMALIZATION.MAX_HOLDER_COUNT));
    normalized.push(features.top10Percent / 100);
    normalized.push(features.mintRevoked);
    normalized.push(features.freezeRevoked);
    normalized.push(features.lpBurnedPercent / 100);
    normalized.push(features.hasSocials);
    normalized.push(Math.min(1, features.tokenAgeHours / NORMALIZATION.MAX_TOKEN_AGE_HOURS));
    
    // Momentum features
    normalized.push(this.normalizePriceChange(features.priceChange5m));
    normalized.push(this.normalizePriceChange(features.priceChange1h));
    normalized.push(this.normalizePriceChange(features.priceChange24h));
    normalized.push(this.normalizePriceChange(features.volumeChange1h));
    normalized.push(this.normalizePriceChange(features.volumeChange24h));
    normalized.push(features.buyPressure1h); // Already 0-1
    
    // Smart money features
    normalized.push(this.normalizeSmartMoney(features.smartMoneyNetBuys, NORMALIZATION.SMART_MONEY_NET_BUYS_MAX));
    normalized.push(Math.min(1, features.smartMoneyHolding / NORMALIZATION.SMART_MONEY_HOLDING_MAX));
    normalized.push(features.isSmartMoneyBullish);
    
    // Trend features
    normalized.push(this.normalizeBounded(features.priceVelocity, NORMALIZATION.VELOCITY_RANGE));
    normalized.push(this.normalizeBounded(features.volumeAcceleration, NORMALIZATION.ACCELERATION_RANGE));
    normalized.push(this.normalizeBounded(features.liquidityTrend, NORMALIZATION.TREND_RANGE));
    normalized.push(this.normalizeBounded(features.holderTrend, NORMALIZATION.TREND_RANGE));
    
    // Pattern features
    normalized.push(features.hasVolumeSpike);
    normalized.push(features.isPumping);
    normalized.push(features.isDumping);
    
    // Sentiment features
    normalized.push((features.sentimentScore + 1) / 2); // -1 to 1 -> 0 to 1
    normalized.push(features.sentimentConfidence);
    normalized.push(features.hasSentimentData);
    
    // Clamp all values to 0-1
    return normalized.map(v => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)));
  }

  /**
   * Convert feature vector to array in correct order
   */
  featuresToArray(features: MLFeatureVector): number[] {
    return FEATURE_NAMES.map(name => features[name] ?? 0);
  }

  /**
   * Convert normalized array back to feature object
   */
  arrayToFeatures(arr: number[]): MLFeatureVector {
    const features: Partial<MLFeatureVector> = {};
    FEATURE_NAMES.forEach((name, i) => {
      (features as any)[name] = arr[i] ?? 0;
    });
    return features as MLFeatureVector;
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  private normalizeLogScale(value: number, maxValue: number): number {
    if (value <= 0) return 0;
    const logValue = Math.log10(value + 1);
    const logMax = Math.log10(maxValue + 1);
    return Math.min(1, logValue / logMax);
  }

  private normalizePriceChange(change: number): number {
    const clamped = Math.max(
      NORMALIZATION.PRICE_CHANGE_MIN,
      Math.min(NORMALIZATION.PRICE_CHANGE_MAX, change)
    );
    return (clamped - NORMALIZATION.PRICE_CHANGE_MIN) / 
           (NORMALIZATION.PRICE_CHANGE_MAX - NORMALIZATION.PRICE_CHANGE_MIN);
  }

  private normalizeSmartMoney(value: number, maxValue: number): number {
    const clamped = Math.max(-maxValue, Math.min(maxValue, value));
    return (clamped + maxValue) / (2 * maxValue);
  }

  private normalizeBounded(value: number, range: number): number {
    const clamped = Math.max(-range, Math.min(range, value));
    return (clamped + range) / (2 * range);
  }

  private calculateVolumeChange(current: TokenSnapshot, previous: any): number {
    if (!previous?.volume_1h || previous.volume_1h === 0) return 0;
    return ((current.volume1h - previous.volume_1h) / previous.volume_1h) * 100;
  }

  private calculateVolumeChange24h(snapshot: TokenSnapshot): number {
    // Estimate 24h volume change based on current vs average
    if (snapshot.volume24h === 0) return 0;
    const avgHourly = snapshot.volume24h / 24;
    if (avgHourly === 0) return 0;
    return ((snapshot.volume1h - avgHourly) / avgHourly) * 100;
  }

  private calculateBuyPressure(buys: number, sells: number): number {
    const total = buys + sells;
    if (total === 0) return 0.5;
    return buys / total;
  }

  private calculatePriceVelocity(change5m: number, change1h: number): number {
    // If 5m change is greater than proportional 1h change, price is accelerating
    const expected5m = change1h / 12; // 1h has 12 5-minute periods
    return change5m - expected5m;
  }

  private calculateVolumeAcceleration(snapshot: TokenSnapshot): number {
    if (snapshot.volume24h === 0) return 0;
    const avgHourly = snapshot.volume24h / 24;
    if (avgHourly === 0) return 0;
    return (snapshot.volume1h - avgHourly) / avgHourly;
  }

  private calculateTrend(current: number | undefined, previous: number | undefined): number {
    if (!previous || previous === 0) return 0;
    if (!current) return -1;
    return (current - previous) / previous;
  }

  private detectVolumeSpike(snapshot: TokenSnapshot): boolean {
    if (snapshot.volume24h === 0) return false;
    const avgHourly = snapshot.volume24h / 24;
    return snapshot.volume1h > avgHourly * 5;
  }

  private detectPumping(snapshot: TokenSnapshot): boolean {
    return snapshot.priceChange5m > 10 && snapshot.priceChange1h > 30;
  }

  private detectDumping(snapshot: TokenSnapshot): boolean {
    return snapshot.priceChange5m < -10 && snapshot.priceChange1h < -30;
  }

  /**
   * Get feature display names
   */
  getFeatureDisplayNames(): Record<string, string> {
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
      smartMoneyHolding: 'Smart Money Holding %',
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

  /**
   * Validate features are complete and valid
   */
  validateFeatures(features: MLFeatureVector): {
    valid: boolean;
    missingCount: number;
    invalidCount: number;
    issues: string[];
  } {
    const issues: string[] = [];
    let missingCount = 0;
    let invalidCount = 0;
    
    for (const name of FEATURE_NAMES) {
      const value = features[name];
      
      if (value === null || value === undefined) {
        missingCount++;
        issues.push(`Missing: ${name}`);
      } else if (typeof value !== 'number' || !Number.isFinite(value)) {
        invalidCount++;
        issues.push(`Invalid: ${name} = ${value}`);
      }
    }
    
    return {
      valid: missingCount === 0 && invalidCount === 0,
      missingCount,
      invalidCount,
      issues,
    };
  }
}

// Export singleton
export const featureExtractor = new FeatureExtractor();
