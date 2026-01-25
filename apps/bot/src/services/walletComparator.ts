/**
 * Wallet Comparator
 * Compare multiple wallets side-by-side for performance and strategy analysis
 */

import { smartMoneyTracker } from './smartMoneyTracker';
import { walletProfiler } from './walletProfiler';
import type { SmartMoneyMetrics } from './smartMoneyTracker';
import type { WalletProfile } from './walletProfiler';

export interface WalletComparison {
  wallet1: {
    address: string;
    label?: string;
    metrics: SmartMoneyMetrics | null;
    profile: WalletProfile | null;
  };
  wallet2: {
    address: string;
    label?: string;
    metrics: SmartMoneyMetrics | null;
    profile: WalletProfile | null;
  };
  
  // Comparison metrics
  performance: {
    winRateDiff: number; // wallet1 - wallet2
    roiDiff: number;
    pnlDiff: number;
    profitFactorDiff: number;
    better: 'wallet1' | 'wallet2' | 'similar';
  };
  
  // Trading patterns
  tradingStyle: {
    wallet1Style: string;
    wallet2Style: string;
    similar: boolean;
  };
  
  riskAppetite: {
    wallet1Risk: string;
    wallet2Risk: string;
    similar: boolean;
  };
  
  // Token overlap
  commonTokens: {
    count: number;
    percentage: number; // % of total unique tokens
    tokens: string[];
  };
  
  // Strategy similarity
  strategySimilarity: number; // 0-100
  
  // Recommendations
  betterFor: {
    consistency: 'wallet1' | 'wallet2' | 'similar';
    profitability: 'wallet1' | 'wallet2' | 'similar';
    riskManagement: 'wallet1' | 'wallet2' | 'similar';
  };
  
  timestamp: number;
}

export interface LeaderboardComparison {
  wallet: {
    address: string;
    label?: string;
    metrics: SmartMoneyMetrics | null;
    rank?: number;
  };
  leader: {
    address: string;
    label?: string;
    metrics: SmartMoneyMetrics | null;
    rank: number;
  };
  
  // Gap analysis
  gaps: {
    winRate: number; // How much to improve
    roi: number;
    profitFactor: number;
  };
  
  // Areas to improve
  improvements: string[];
  
  // Strengths
  strengths: string[];
  
  timestamp: number;
}

export class WalletComparator {
  /**
   * Compare two wallets side-by-side
   */
  async compareWallets(wallet1Address: string, wallet2Address: string): Promise<WalletComparison | null> {
    const metrics1 = smartMoneyTracker.getMetrics(wallet1Address);
    const metrics2 = smartMoneyTracker.getMetrics(wallet2Address);
    
    // Need at least one wallet with data
    if (!metrics1 && !metrics2) {
      return null;
    }

    const profile1 = walletProfiler.getProfile(wallet1Address);
    const profile2 = walletProfiler.getProfile(wallet2Address);

    // Performance comparison
    const winRateDiff = (metrics1?.winRate || 0) - (metrics2?.winRate || 0);
    const roiDiff = (metrics1?.totalRoi || 0) - (metrics2?.totalRoi || 0);
    const pnlDiff = (metrics1?.totalPnl || 0) - (metrics2?.totalPnl || 0);
    const profitFactorDiff = (metrics1?.profitFactor || 0) - (metrics2?.profitFactor || 0);

    // Determine who performs better (need significant difference)
    let better: 'wallet1' | 'wallet2' | 'similar';
    const totalScore1 = (metrics1?.winRate || 0) + (metrics1?.totalRoi || 0) / 10 + (metrics1?.profitFactor || 0) * 10;
    const totalScore2 = (metrics2?.winRate || 0) + (metrics2?.totalRoi || 0) / 10 + (metrics2?.profitFactor || 0) * 10;
    
    if (totalScore1 > totalScore2 * 1.1) better = 'wallet1';
    else if (totalScore2 > totalScore1 * 1.1) better = 'wallet2';
    else better = 'similar';

    // Trading style comparison
    const style1 = profile1?.tradingStyle || 'unknown';
    const style2 = profile2?.tradingStyle || 'unknown';
    const stylesSimilar = style1 === style2;

    // Risk appetite comparison
    const risk1 = profile1?.riskAppetite || 'unknown';
    const risk2 = profile2?.riskAppetite || 'unknown';
    const riskSimilar = risk1 === risk2;

    // Calculate strategy similarity (0-100)
    let strategySimilarity = 0;
    
    if (stylesSimilar) strategySimilarity += 40;
    if (riskSimilar) strategySimilarity += 40;
    
    // Hold duration similarity
    if (profile1 && profile2) {
      const holdDiff = Math.abs(profile1.avgHoldDuration - profile2.avgHoldDuration);
      const maxHold = Math.max(profile1.avgHoldDuration, profile2.avgHoldDuration);
      if (maxHold > 0) {
        const holdSimilarity = 1 - Math.min(1, holdDiff / maxHold);
        strategySimilarity += holdSimilarity * 20;
      }
    }

    // Better for...
    const betterFor = {
      consistency: this.compareStat(profile1?.consistency || 0, profile2?.consistency || 0),
      profitability: this.compareStat(metrics1?.totalRoi || 0, metrics2?.totalRoi || 0),
      riskManagement: this.compareStat(metrics1?.profitFactor || 0, metrics2?.profitFactor || 0),
    };

    const comparison: WalletComparison = {
      wallet1: {
        address: wallet1Address,
        label: metrics1?.label,
        metrics: metrics1,
        profile: profile1,
      },
      wallet2: {
        address: wallet2Address,
        label: metrics2?.label,
        metrics: metrics2,
        profile: profile2,
      },
      performance: {
        winRateDiff,
        roiDiff,
        pnlDiff,
        profitFactorDiff,
        better,
      },
      tradingStyle: {
        wallet1Style: style1,
        wallet2Style: style2,
        similar: stylesSimilar,
      },
      riskAppetite: {
        wallet1Risk: risk1,
        wallet2Risk: risk2,
        similar: riskSimilar,
      },
      commonTokens: {
        count: 0,
        percentage: 0,
        tokens: [],
      },
      strategySimilarity,
      betterFor,
      timestamp: Date.now(),
    };

    return comparison;
  }

  /**
   * Compare wallet against leaderboard #1
   */
  async compareWithLeader(walletAddress: string): Promise<LeaderboardComparison | null> {
    const metrics = smartMoneyTracker.getMetrics(walletAddress);
    if (!metrics) return null;

    const leaderboard = smartMoneyTracker.getLeaderboard(1);
    if (leaderboard.length === 0) return null;

    const leader = leaderboard[0];

    // Calculate gaps
    const gaps = {
      winRate: leader.winRate - metrics.winRate,
      roi: leader.totalRoi - metrics.totalRoi,
      profitFactor: leader.profitFactor - metrics.profitFactor,
    };

    // Identify areas to improve
    const improvements: string[] = [];
    
    if (gaps.winRate > 5) {
      improvements.push(`Improve win rate by ${gaps.winRate.toFixed(1)}% (current: ${metrics.winRate.toFixed(1)}%)`);
    }
    
    if (gaps.roi > 20) {
      improvements.push(`Increase ROI by ${gaps.roi.toFixed(1)}% (current: ${metrics.totalRoi > 0 ? '+' : ''}${metrics.totalRoi.toFixed(1)}%)`);
    }
    
    if (gaps.profitFactor > 0.5) {
      improvements.push(`Better risk/reward ratio (PF: ${metrics.profitFactor.toFixed(2)} vs ${leader.profitFactor.toFixed(2)})`);
    }
    
    if (metrics.avgLossPercent > leader.avgLossPercent) {
      improvements.push(`Reduce average loss (${metrics.avgLossPercent.toFixed(1)}% vs ${leader.avgLossPercent.toFixed(1)}%)`);
    }

    // Identify strengths (where wallet beats or matches leader)
    const strengths: string[] = [];
    
    if (metrics.winRate >= leader.winRate * 0.9) {
      strengths.push(`Good win rate (${metrics.winRate.toFixed(1)}%)`);
    }
    
    if (metrics.profitFactor >= leader.profitFactor * 0.8) {
      strengths.push(`Solid profit factor (${metrics.profitFactor.toFixed(2)}x)`);
    }
    
    if (metrics.currentStreak > 0 && metrics.currentStreak >= 3) {
      strengths.push(`On a winning streak (${metrics.currentStreak}W)`);
    }
    
    if (metrics.last7DaysPnl > 0) {
      strengths.push(`Profitable last 7 days (+${metrics.last7DaysPnl.toFixed(2)} SOL)`);
    }

    const comparison: LeaderboardComparison = {
      wallet: {
        address: walletAddress,
        label: metrics.label,
        metrics,
        rank: metrics.rank,
      },
      leader: {
        address: leader.walletAddress,
        label: leader.label,
        metrics: leader,
        rank: 1,
      },
      gaps,
      improvements,
      strengths,
      timestamp: Date.now(),
    };

    return comparison;
  }

  /**
   * Helper to compare stats
   */
  private compareStat(stat1: number, stat2: number): 'wallet1' | 'wallet2' | 'similar' {
    if (stat1 > stat2 * 1.1) return 'wallet1';
    if (stat2 > stat1 * 1.1) return 'wallet2';
    return 'similar';
  }
}

// Singleton instance
export const walletComparator = new WalletComparator();
