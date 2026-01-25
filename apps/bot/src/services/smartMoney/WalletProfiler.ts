/**
 * Wallet Profiler
 * Classifies wallets by trading style and specialization
 * Identifies snipers, swing traders, and their strengths
 */

import { logger } from '../../utils/logger';

export enum WalletCategory {
  SNIPER = 'sniper',           // Enters within minutes of launch
  SWING_TRADER = 'swing',      // Holds 1-7 days
  HODLER = 'hodler',           // Holds >7 days
  SCALPER = 'scalper',         // Quick in/out (<1 hour)
  WHALE = 'whale',             // Large positions (>100 SOL)
  UNKNOWN = 'unknown',
}

export interface WalletProfile {
  walletAddress: string;
  category: WalletCategory;
  
  // Timing metrics
  avgTimeToEntry: number;        // Average ms from token launch to entry
  avgHoldDuration: number;       // Average hold time in hours
  fastEntryRate: number;         // % of trades entered within 5 min
  
  // Performance by speed
  earlyEntryWinRate: number;     // Win rate on entries <5 min
  lateEntryWinRate: number;      // Win rate on entries >5 min
  
  // Specialization
  bestTokenType: string;         // e.g., 'meme', 'defi', 'nft'
  avgRoiOnNewTokens: number;     // ROI specifically on new token launches
  newTokenSuccessRate: number;   // % wins on tokens <24h old
  
  // Discovery metrics
  uniqueTokensFound: number;     // How many tokens they were first to find
  avgDiscoveryRank: number;      // Average position among all buyers (1 = first)
  
  // Confidence
  sampleSize: number;            // Total closed trades
  confidenceScore: number;       // 0-1, based on sample size + consistency
  
  // Risk profile
  avgPositionSize: number;       // In SOL
  maxPositionSize: number;
  riskTolerance: 'conservative' | 'moderate' | 'aggressive';
  
  lastUpdated: number;
}

export interface ProfileUpdate {
  walletAddress: string;
  changes: {
    category?: { old: WalletCategory; new: WalletCategory };
    confidenceScore?: { old: number; new: number };
    newTokenSuccessRate?: { old: number; new: number };
  };
  timestamp: number;
}

export class WalletProfiler {
  private profiles: Map<string, WalletProfile> = new Map();

  /**
   * Profile a wallet based on trade history
   */
  profileWallet(
    walletAddress: string,
    trades: any[]
  ): WalletProfile {
    const closedTrades = trades.filter(t => t.status === 'closed');

    if (closedTrades.length === 0) {
      return this.getDefaultProfile(walletAddress);
    }

    // Calculate timing metrics
    const avgTimeToEntry = this.calculateAvgTimeToEntry(closedTrades);
    const avgHoldDuration = this.calculateAvgHoldDuration(closedTrades);
    const fastEntryRate = this.calculateFastEntryRate(closedTrades);

    // Calculate performance by speed
    const earlyEntryWinRate = this.calculateEarlyEntryWinRate(closedTrades);
    const lateEntryWinRate = this.calculateLateEntryWinRate(closedTrades);

    // Determine category
    const category = this.determineCategory(avgTimeToEntry, avgHoldDuration, closedTrades);

    // Calculate specialization
    const avgRoiOnNewTokens = this.calculateNewTokenRoi(closedTrades);
    const newTokenSuccessRate = this.calculateNewTokenSuccessRate(closedTrades);

    // Discovery metrics
    const uniqueTokensFound = this.calculateUniqueTokensFound(closedTrades);
    const avgDiscoveryRank = this.calculateAvgDiscoveryRank(closedTrades);

    // Risk profile
    const avgPositionSize = this.calculateAvgPositionSize(closedTrades);
    const maxPositionSize = this.calculateMaxPositionSize(closedTrades);
    const riskTolerance = this.determineRiskTolerance(avgPositionSize, trades);

    // Confidence
    const confidenceScore = this.calculateConfidence(closedTrades, earlyEntryWinRate);

    const profile: WalletProfile = {
      walletAddress,
      category,
      avgTimeToEntry,
      avgHoldDuration,
      fastEntryRate,
      earlyEntryWinRate,
      lateEntryWinRate,
      bestTokenType: 'meme', // Placeholder
      avgRoiOnNewTokens,
      newTokenSuccessRate,
      uniqueTokensFound,
      avgDiscoveryRank,
      sampleSize: closedTrades.length,
      confidenceScore,
      avgPositionSize,
      maxPositionSize,
      riskTolerance,
      lastUpdated: Date.now(),
    };

    this.profiles.set(walletAddress, profile);

    logger.info('WalletProfiler', `Profiled ${walletAddress.slice(0, 8)}... as ${category} (confidence: ${(confidenceScore * 100).toFixed(1)}%)`);

    return profile;
  }

  /**
   * Calculate average time from token launch to entry
   */
  private calculateAvgTimeToEntry(trades: any[]): number {
    // In real implementation, would compare entryTimestamp to token launch timestamp
    // For now, use a placeholder
    const times = trades.map(() => Math.random() * 30 * 60 * 1000); // 0-30 minutes
    return times.reduce((a, b) => a + b, 0) / times.length;
  }

  /**
   * Calculate average hold duration
   */
  private calculateAvgHoldDuration(trades: any[]): number {
    const durations = trades
      .filter(t => t.holdDuration !== undefined)
      .map(t => t.holdDuration);

    return durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
  }

  /**
   * Calculate % of fast entries (within 5 min)
   */
  private calculateFastEntryRate(trades: any[]): number {
    const fastEntries = trades.filter(t => {
      // Check if entered within 5 minutes of launch
      // Placeholder: assume 30% are fast
      return Math.random() < 0.3;
    });

    return trades.length > 0 ? fastEntries.length / trades.length : 0;
  }

  /**
   * Calculate win rate on early entries
   */
  private calculateEarlyEntryWinRate(trades: any[]): number {
    const earlyTrades = trades.filter(() => Math.random() < 0.3); // Fast entries
    const wins = earlyTrades.filter(t => t.isWin);

    return earlyTrades.length > 0 ? wins.length / earlyTrades.length : 0;
  }

  /**
   * Calculate win rate on late entries
   */
  private calculateLateEntryWinRate(trades: any[]): number {
    const lateTrades = trades.filter(() => Math.random() >= 0.3); // Slow entries
    const wins = lateTrades.filter(t => t.isWin);

    return lateTrades.length > 0 ? wins.length / lateTrades.length : 0;
  }

  /**
   * Determine wallet category
   */
  private determineCategory(
    avgTimeToEntry: number,
    avgHoldDuration: number,
    trades: any[]
  ): WalletCategory {
    const avgPositionSize = this.calculateAvgPositionSize(trades);

    // Whale: large positions
    if (avgPositionSize > 100) {
      return WalletCategory.WHALE;
    }

    // Sniper: enters within 5 minutes
    if (avgTimeToEntry < 5 * 60 * 1000) {
      return WalletCategory.SNIPER;
    }

    // Scalper: holds <1 hour
    if (avgHoldDuration < 1) {
      return WalletCategory.SCALPER;
    }

    // HODLer: holds >7 days
    if (avgHoldDuration > 7 * 24) {
      return WalletCategory.HODLER;
    }

    // Swing trader: 1-7 days
    if (avgHoldDuration >= 24 && avgHoldDuration <= 7 * 24) {
      return WalletCategory.SWING_TRADER;
    }

    return WalletCategory.UNKNOWN;
  }

  /**
   * Calculate ROI on new tokens (<24h old)
   */
  private calculateNewTokenRoi(trades: any[]): number {
    // Filter for new token trades
    const newTokenTrades = trades.filter(() => Math.random() < 0.5); // Placeholder

    if (newTokenTrades.length === 0) return 0;

    const totalRoi = newTokenTrades.reduce((sum, t) => sum + (t.profitLossPercent || 0), 0);
    return totalRoi / newTokenTrades.length;
  }

  /**
   * Calculate success rate on new tokens
   */
  private calculateNewTokenSuccessRate(trades: any[]): number {
    const newTokenTrades = trades.filter(() => Math.random() < 0.5);
    const wins = newTokenTrades.filter(t => t.isWin);

    return newTokenTrades.length > 0 ? wins.length / newTokenTrades.length : 0;
  }

  /**
   * Calculate unique tokens found first
   */
  private calculateUniqueTokensFound(trades: any[]): number {
    // In real implementation, check if wallet was first buyer
    // Placeholder: estimate 10%
    return Math.floor(trades.length * 0.1);
  }

  /**
   * Calculate average discovery rank
   */
  private calculateAvgDiscoveryRank(trades: any[]): number {
    // Average position among all buyers (1 = first, 2 = second, etc.)
    // Placeholder
    return 15; // Average of ~15th buyer
  }

  /**
   * Calculate average position size
   */
  private calculateAvgPositionSize(trades: any[]): number {
    const sizes = trades.map(t => t.entrySolValue || 0);
    return sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
  }

  /**
   * Calculate max position size
   */
  private calculateMaxPositionSize(trades: any[]): number {
    const sizes = trades.map(t => t.entrySolValue || 0);
    return sizes.length > 0 ? Math.max(...sizes) : 0;
  }

  /**
   * Determine risk tolerance
   */
  private determineRiskTolerance(
    avgPositionSize: number,
    trades: any[]
  ): 'conservative' | 'moderate' | 'aggressive' {
    if (avgPositionSize < 5) return 'conservative';
    if (avgPositionSize < 20) return 'moderate';
    return 'aggressive';
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    trades: any[],
    earlyEntryWinRate: number
  ): number {
    // Sample size component (0-1)
    const sampleSizeScore = Math.min(1, trades.length / 50); // 50 trades = full confidence

    // Performance component (0-1)
    const performanceScore = Math.max(0, (earlyEntryWinRate - 0.4) * 2.5); // 40% break-even

    // Combined
    return (sampleSizeScore * 0.4 + performanceScore * 0.6);
  }

  /**
   * Get default profile
   */
  private getDefaultProfile(walletAddress: string): WalletProfile {
    return {
      walletAddress,
      category: WalletCategory.UNKNOWN,
      avgTimeToEntry: 0,
      avgHoldDuration: 0,
      fastEntryRate: 0,
      earlyEntryWinRate: 0,
      lateEntryWinRate: 0,
      bestTokenType: 'unknown',
      avgRoiOnNewTokens: 0,
      newTokenSuccessRate: 0,
      uniqueTokensFound: 0,
      avgDiscoveryRank: 0,
      sampleSize: 0,
      confidenceScore: 0,
      avgPositionSize: 0,
      maxPositionSize: 0,
      riskTolerance: 'conservative',
      lastUpdated: Date.now(),
    };
  }

  /**
   * Get profile for wallet
   */
  getProfile(walletAddress: string): WalletProfile | undefined {
    return this.profiles.get(walletAddress);
  }

  /**
   * Get top snipers
   */
  getTopSnipers(minConfidence: number = 0.6): WalletProfile[] {
    return Array.from(this.profiles.values())
      .filter(p => p.category === WalletCategory.SNIPER && p.confidenceScore >= minConfidence)
      .sort((a, b) => b.earlyEntryWinRate - a.earlyEntryWinRate)
      .slice(0, 10);
  }

  /**
   * Get profiles by category
   */
  getByCategory(category: WalletCategory): WalletProfile[] {
    return Array.from(this.profiles.values()).filter(p => p.category === category);
  }
}
