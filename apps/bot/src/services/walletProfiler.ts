/**
 * Wallet Profiler
 * Analyzes wallet trading patterns to create detailed trader profiles
 */

import { smartMoneyTracker } from './smartMoneyTracker';
import type { WalletTrade, SmartMoneyMetrics } from './smartMoneyTracker';
import { whaleActivityTracker } from './whaleActivityTracker';
import { logger } from '../utils/logger';

export type TradingStyle = 'day_trader' | 'swing_trader' | 'long_term_holder' | 'scalper' | 'inactive';
export type EntryTiming = 'early_bird' | 'dip_buyer' | 'fomo' | 'mixed';
export type RiskAppetite = 'conservative' | 'moderate' | 'aggressive' | 'degen';

export interface WalletProfile {
  walletAddress: string;
  walletLabel?: string;
  
  // Trading style
  tradingStyle: TradingStyle;
  tradingStyleConfidence: number; // 0-100
  tradingStyleDescription: string;
  
  // Timing patterns
  entryTiming: EntryTiming;
  entryTimingConfidence: number; // 0-100
  avgHoldDuration: number; // hours
  medianHoldDuration: number; // hours
  shortestTrade: number; // hours
  longestTrade: number; // hours
  
  // Risk profile
  riskAppetite: RiskAppetite;
  riskAppetiteConfidence: number; // 0-100
  avgPositionSize: number; // SOL
  largestPosition: number; // SOL
  smallestPosition: number; // SOL
  positionSizeVariance: number; // coefficient of variation
  
  // Token preferences
  favoriteCategories: string[]; // ['memecoin', 'defi', 'nft', etc]
  mostTradedTokens: { symbol: string; count: number }[];
  tokenDiversity: number; // 0-100 (higher = trades many different tokens)
  
  // Behavioral patterns
  tradingHours: { [hour: number]: number }; // Activity by hour (0-23)
  preferredDays: string[]; // Days with most activity
  streakiness: number; // 0-100 (tendency to have long streaks)
  consistency: number; // 0-100 (regularity of trading activity)
  
  // Performance context
  metrics?: SmartMoneyMetrics;
  
  // Metadata
  profileConfidence: number; // 0-100 overall confidence in profile
  dataPoints: number; // Number of trades analyzed
  lastUpdated: number;
}

export class WalletProfiler {
  private profiles: Map<string, WalletProfile> = new Map();

  /**
   * Generate or update profile for a wallet
   */
  async generateProfile(walletAddress: string): Promise<WalletProfile | null> {
    // Get metrics and trades from smart money tracker
    const metrics = smartMoneyTracker.getMetrics(walletAddress);
    
    if (!metrics || metrics.closedTrades < 3) {
      // Need at least 3 trades for meaningful profile
      return null;
    }

    // Get all trades (access via smartMoneyTracker's internal data)
    // For now, we'll work with metrics only and estimate from there
    
    const profile: WalletProfile = {
      walletAddress,
      walletLabel: metrics.label,
      
      // Will be calculated
      tradingStyle: 'inactive',
      tradingStyleConfidence: 0,
      tradingStyleDescription: '',
      entryTiming: 'mixed',
      entryTimingConfidence: 0,
      avgHoldDuration: metrics.avgHoldDuration,
      medianHoldDuration: 0,
      shortestTrade: 0,
      longestTrade: 0,
      riskAppetite: 'moderate',
      riskAppetiteConfidence: 0,
      avgPositionSize: 0,
      largestPosition: 0,
      smallestPosition: 0,
      positionSizeVariance: 0,
      favoriteCategories: [],
      mostTradedTokens: [],
      tokenDiversity: 0,
      tradingHours: {},
      preferredDays: [],
      streakiness: 0,
      consistency: 0,
      metrics,
      profileConfidence: 0,
      dataPoints: metrics.closedTrades,
      lastUpdated: Date.now(),
    };

    // Analyze trading style based on hold duration
    this.analyzeTradingStyle(profile);
    
    // Analyze risk appetite based on metrics
    this.analyzeRiskAppetite(profile);
    
    // Analyze entry timing patterns
    this.analyzeEntryTiming(profile);
    
    // Analyze behavioral patterns
    this.analyzeBehavioralPatterns(profile);
    
    // Calculate overall profile confidence
    profile.profileConfidence = this.calculateProfileConfidence(profile);

    // Store profile
    this.profiles.set(walletAddress, profile);

    logger.debug('WalletProfiler', `Generated profile for ${metrics.label || walletAddress.slice(0, 8)}... - ${profile.tradingStyle}, ${profile.riskAppetite}`);

    return profile;
  }

  /**
   * Analyze trading style based on hold duration and trade frequency
   */
  private analyzeTradingStyle(profile: WalletProfile): void {
    const avgHold = profile.avgHoldDuration;
    const metrics = profile.metrics!;
    
    // Calculate trades per day (approximate)
    const daysActive = 30; // Assume tracked for 30 days for now
    const tradesPerDay = metrics.closedTrades / daysActive;

    let style: TradingStyle;
    let confidence = 0;
    let description = '';

    if (avgHold < 2) {
      // Holds < 2 hours
      style = 'scalper';
      confidence = 80;
      description = 'Quick in-and-out trades, rarely holds positions';
    } else if (avgHold < 24) {
      // Holds < 1 day
      style = 'day_trader';
      confidence = 75;
      description = 'Closes positions within same day, active intraday';
    } else if (avgHold < 72) {
      // Holds < 3 days
      style = 'swing_trader';
      confidence = 70;
      description = 'Holds for several days, captures medium-term moves';
    } else {
      // Holds 3+ days
      style = 'long_term_holder';
      confidence = 65;
      description = 'Patient holder, waits for larger moves';
    }

    // Boost confidence if trade frequency matches style
    if (style === 'scalper' && tradesPerDay > 5) confidence += 15;
    if (style === 'day_trader' && tradesPerDay > 2) confidence += 10;
    if (style === 'swing_trader' && tradesPerDay <= 2) confidence += 10;
    if (style === 'long_term_holder' && tradesPerDay < 1) confidence += 10;

    profile.tradingStyle = style;
    profile.tradingStyleConfidence = Math.min(100, confidence);
    profile.tradingStyleDescription = description;
  }

  /**
   * Analyze risk appetite based on performance metrics
   */
  private analyzeRiskAppetite(profile: WalletProfile): void {
    const metrics = profile.metrics!;
    
    let riskScore = 0;
    let confidence = 60;

    // Factor 1: Win rate (lower = more aggressive)
    if (metrics.winRate < 50) riskScore += 30;
    else if (metrics.winRate < 60) riskScore += 20;
    else if (metrics.winRate < 70) riskScore += 10;
    else confidence += 10; // High win rate = conservative

    // Factor 2: Average profit vs loss (bigger swings = aggressive)
    const avgSwing = (metrics.avgProfitPercent + metrics.avgLossPercent) / 2;
    if (avgSwing > 100) riskScore += 30; // 100%+ avg swings
    else if (avgSwing > 50) riskScore += 20;
    else if (avgSwing > 25) riskScore += 10;

    // Factor 3: Max streak length (high streaks = degen behavior)
    const maxStreak = Math.max(metrics.maxWinStreak, metrics.maxLossStreak);
    if (maxStreak > 10) riskScore += 20;
    else if (maxStreak > 5) riskScore += 10;

    // Factor 4: Total ROI volatility
    if (metrics.totalRoi > 500) riskScore += 20; // 500%+ = very aggressive
    else if (metrics.totalRoi > 200) riskScore += 10;

    // Classify
    let appetite: RiskAppetite;
    if (riskScore >= 70) appetite = 'degen';
    else if (riskScore >= 50) appetite = 'aggressive';
    else if (riskScore >= 30) appetite = 'moderate';
    else appetite = 'conservative';

    profile.riskAppetite = appetite;
    profile.riskAppetiteConfidence = Math.min(100, confidence);
  }

  /**
   * Analyze entry timing patterns
   */
  private analyzeEntryTiming(profile: WalletProfile): void {
    const metrics = profile.metrics!;
    
    let timing: EntryTiming;
    let confidence = 50; // Default lower confidence without granular data

    // Heuristic based on win rate and holding patterns
    // Early birds tend to have higher win rates and longer holds
    if (metrics.winRate > 70 && profile.avgHoldDuration > 48) {
      timing = 'early_bird';
      confidence = 65;
    }
    // Dip buyers have good win rates but shorter holds
    else if (metrics.winRate > 60 && profile.avgHoldDuration < 48) {
      timing = 'dip_buyer';
      confidence = 60;
    }
    // FOMO traders have lower win rates
    else if (metrics.winRate < 50) {
      timing = 'fomo';
      confidence = 70;
    }
    // Mixed
    else {
      timing = 'mixed';
      confidence = 55;
    }

    profile.entryTiming = timing;
    profile.entryTimingConfidence = confidence;
  }

  /**
   * Analyze behavioral patterns (streaks, consistency)
   */
  private analyzeBehavioralPatterns(profile: WalletProfile): void {
    const metrics = profile.metrics!;
    
    // Streakiness (tendency to have long win/loss streaks)
    const maxStreak = Math.max(metrics.maxWinStreak, metrics.maxLossStreak);
    const avgStreak = metrics.closedTrades > 0 ? maxStreak / metrics.closedTrades : 0;
    profile.streakiness = Math.min(100, avgStreak * 100);

    // Consistency (regularity - for now, estimate from data points)
    // More data points over same period = more consistent
    if (metrics.closedTrades > 50) profile.consistency = 90;
    else if (metrics.closedTrades > 20) profile.consistency = 70;
    else if (metrics.closedTrades > 10) profile.consistency = 50;
    else profile.consistency = 30;

    // Trading hours (placeholder - would need timestamp data)
    profile.tradingHours = {};
    profile.preferredDays = ['Mon-Fri']; // Placeholder
  }

  /**
   * Calculate overall profile confidence
   */
  private calculateProfileConfidence(profile: WalletProfile): number {
    let confidence = 0;
    let weights = 0;

    // Weight by confidence of each component
    confidence += profile.tradingStyleConfidence * 0.3;
    weights += 0.3;

    confidence += profile.riskAppetiteConfidence * 0.3;
    weights += 0.3;

    confidence += profile.entryTimingConfidence * 0.2;
    weights += 0.2;

    // Boost for more data points
    const dataBoost = Math.min(20, profile.dataPoints * 2);
    confidence += dataBoost * 0.2;
    weights += 0.2;

    return Math.round(confidence / weights);
  }

  /**
   * Get profile for a wallet
   */
  getProfile(walletAddress: string): WalletProfile | null {
    return this.profiles.get(walletAddress) || null;
  }

  /**
   * Get all profiles
   */
  getAllProfiles(): WalletProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Find wallets by trading style
   */
  findByTradingStyle(style: TradingStyle, minConfidence: number = 60): WalletProfile[] {
    const results = Array.from(this.profiles.values()).filter(
      p => p.tradingStyle === style && p.tradingStyleConfidence >= minConfidence
    );
    
    // Sort by confidence
    results.sort((a, b) => b.tradingStyleConfidence - a.tradingStyleConfidence);
    
    return results;
  }

  /**
   * Find wallets by risk appetite
   */
  findByRiskAppetite(appetite: RiskAppetite, minConfidence: number = 60): WalletProfile[] {
    const results = Array.from(this.profiles.values()).filter(
      p => p.riskAppetite === appetite && p.riskAppetiteConfidence >= minConfidence
    );
    
    // Sort by confidence
    results.sort((a, b) => b.riskAppetiteConfidence - a.riskAppetiteConfidence);
    
    return results;
  }

  /**
   * Get similar wallets (similar trading style + risk)
   */
  findSimilarWallets(walletAddress: string, limit: number = 5): WalletProfile[] {
    const profile = this.getProfile(walletAddress);
    if (!profile) return [];

    const similar = Array.from(this.profiles.values())
      .filter(p => p.walletAddress !== walletAddress)
      .map(p => {
        let similarity = 0;
        
        // Trading style match
        if (p.tradingStyle === profile.tradingStyle) similarity += 40;
        
        // Risk appetite match
        if (p.riskAppetite === profile.riskAppetite) similarity += 40;
        
        // Entry timing match
        if (p.entryTiming === profile.entryTiming) similarity += 20;
        
        return { profile: p, similarity };
      })
      .filter(s => s.similarity > 50) // At least 50% similar
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map(s => s.profile);

    return similar;
  }

  /**
   * Refresh profile (recalculate based on latest data)
   */
  async refreshProfile(walletAddress: string): Promise<WalletProfile | null> {
    return await this.generateProfile(walletAddress);
  }

  /**
   * Refresh all profiles
   */
  async refreshAllProfiles(): Promise<void> {
    const addresses = Array.from(this.profiles.keys());
    
    for (const address of addresses) {
      try {
        await this.generateProfile(address);
      } catch (error) {
        logger.silentError('WalletProfiler', `Failed to refresh profile for ${address.slice(0, 8)}...`, error as Error);
      }
    }

    logger.info('WalletProfiler', `Refreshed ${addresses.length} profiles`);
  }
}

// Singleton instance
export const walletProfiler = new WalletProfiler();
