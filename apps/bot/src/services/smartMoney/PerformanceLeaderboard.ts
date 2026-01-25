/**
 * Performance Leaderboard
 * Real-time rankings of top-performing wallets
 * Category winners and historical tracking
 */

import { logger } from '../../utils/logger';
import type { WalletProfile, WalletCategory } from './WalletProfiler';

export interface LeaderboardEntry {
  rank: number;
  walletAddress: string;
  label?: string;
  profile: WalletProfile;
  
  // Key metrics
  winRate: number;
  avgReturn: number;
  totalRoi: number;
  
  // Recent performance
  last7DaysWinRate: number;
  last30DaysWinRate: number;
  recentStreak: number;
  
  // Score
  overallScore: number;          // Combined performance score
  
  // Change
  rankChange?: number;           // vs last update
  isRising: boolean;
}

export interface CategoryLeaderboard {
  category: WalletCategory;
  entries: LeaderboardEntry[];
  lastUpdate: number;
}

export interface HistoricalRanking {
  walletAddress: string;
  rank: number;
  score: number;
  timestamp: number;
}

export class PerformanceLeaderboard {
  private globalLeaderboard: LeaderboardEntry[] = [];
  private categoryLeaderboards: Map<WalletCategory, CategoryLeaderboard> = new Map();
  private historicalRankings: Map<string, HistoricalRanking[]> = new Map(); // walletAddress -> rankings
  private lastUpdate: number = 0;

  /**
   * Update leaderboard with current wallet data
   */
  update(profiles: WalletProfile[]): void {
    logger.info('PerformanceLeaderboard', `Updating leaderboard with ${profiles.length} wallets`);

    // Store previous ranks
    const previousRanks = new Map(
      this.globalLeaderboard.map(e => [e.walletAddress, e.rank])
    );

    // Calculate scores and create entries
    const entries: LeaderboardEntry[] = profiles
      .map(profile => this.createEntry(profile, previousRanks))
      .filter(e => e.profile.sampleSize >= 10); // Min 10 trades

    // Sort by overall score
    entries.sort((a, b) => b.overallScore - a.overallScore);

    // Assign ranks
    entries.forEach((entry, index) => {
      entry.rank = index + 1;
      entry.rankChange = previousRanks.has(entry.walletAddress)
        ? previousRanks.get(entry.walletAddress)! - entry.rank
        : undefined;
      entry.isRising = (entry.rankChange || 0) > 0;
    });

    this.globalLeaderboard = entries;

    // Update category leaderboards
    this.updateCategoryLeaderboards(entries);

    // Store historical rankings
    this.storeHistoricalRankings(entries);

    this.lastUpdate = Date.now();
    logger.info('PerformanceLeaderboard', `Leaderboard updated: top wallet has ${(entries[0]?.overallScore * 100).toFixed(1)} score`);
  }

  /**
   * Create leaderboard entry from profile
   */
  private createEntry(
    profile: WalletProfile,
    previousRanks: Map<string, number>
  ): LeaderboardEntry {
    // Calculate overall score (0-1)
    const overallScore = this.calculateOverallScore(profile);

    // Estimate recent performance (would need actual data in real implementation)
    const last7DaysWinRate = profile.earlyEntryWinRate * 0.95; // Placeholder
    const last30DaysWinRate = profile.earlyEntryWinRate;

    return {
      rank: 0, // Will be assigned later
      walletAddress: profile.walletAddress,
      label: undefined, // Would come from labels system
      profile,
      winRate: profile.earlyEntryWinRate,
      avgReturn: profile.avgRoiOnNewTokens,
      totalRoi: profile.avgRoiOnNewTokens * profile.sampleSize,
      last7DaysWinRate,
      last30DaysWinRate,
      recentStreak: 0, // Placeholder
      overallScore,
      rankChange: undefined,
      isRising: false,
    };
  }

  /**
   * Calculate overall performance score
   */
  private calculateOverallScore(profile: WalletProfile): number {
    // Weighted combination of metrics
    const weights = {
      winRate: 0.3,
      avgReturn: 0.25,
      confidence: 0.2,
      newTokenSuccess: 0.15,
      speed: 0.1,
    };

    // Win rate component (0-1)
    const winRateScore = Math.max(0, (profile.earlyEntryWinRate - 0.4) / 0.6); // 40% = 0, 100% = 1

    // Average return component (0-1)
    const avgReturnScore = Math.min(1, Math.max(0, profile.avgRoiOnNewTokens / 200)); // 200% = 1

    // Confidence component (already 0-1)
    const confidenceScore = profile.confidenceScore;

    // New token success component (0-1)
    const newTokenScore = Math.max(0, (profile.newTokenSuccessRate - 0.4) / 0.6);

    // Speed component (0-1) - faster = better for snipers
    const speedScore = profile.category === 'sniper'
      ? Math.max(0, 1 - (profile.avgTimeToEntry / (10 * 60 * 1000))) // 10 min = 0, 0 min = 1
      : 0.5; // Neutral for non-snipers

    const score =
      weights.winRate * winRateScore +
      weights.avgReturn * avgReturnScore +
      weights.confidence * confidenceScore +
      weights.newTokenSuccess * newTokenScore +
      weights.speed * speedScore;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Update category-specific leaderboards
   */
  private updateCategoryLeaderboards(entries: LeaderboardEntry[]): void {
    const categories: WalletCategory[] = [
      'sniper',
      'swing',
      'hodler',
      'scalper',
      'whale',
    ];

    for (const category of categories) {
      const categoryEntries = entries
        .filter(e => e.profile.category === category)
        .slice(0, 20); // Top 20 per category

      // Re-rank within category
      categoryEntries.forEach((entry, index) => {
        entry.rank = index + 1;
      });

      this.categoryLeaderboards.set(category, {
        category,
        entries: categoryEntries,
        lastUpdate: Date.now(),
      });
    }
  }

  /**
   * Store historical rankings
   */
  private storeHistoricalRankings(entries: LeaderboardEntry[]): void {
    const now = Date.now();

    for (const entry of entries) {
      if (!this.historicalRankings.has(entry.walletAddress)) {
        this.historicalRankings.set(entry.walletAddress, []);
      }

      const history = this.historicalRankings.get(entry.walletAddress)!;
      history.push({
        walletAddress: entry.walletAddress,
        rank: entry.rank,
        score: entry.overallScore,
        timestamp: now,
      });

      // Keep last 100 entries
      if (history.length > 100) {
        history.shift();
      }
    }
  }

  /**
   * Get global leaderboard
   */
  getGlobalLeaderboard(limit: number = 50): LeaderboardEntry[] {
    return this.globalLeaderboard.slice(0, limit);
  }

  /**
   * Get category leaderboard
   */
  getCategoryLeaderboard(category: WalletCategory, limit: number = 20): LeaderboardEntry[] {
    const leaderboard = this.categoryLeaderboards.get(category);
    return leaderboard ? leaderboard.entries.slice(0, limit) : [];
  }

  /**
   * Get wallet rank
   */
  getWalletRank(walletAddress: string): LeaderboardEntry | undefined {
    return this.globalLeaderboard.find(e => e.walletAddress === walletAddress);
  }

  /**
   * Get top performers
   */
  getTopPerformers(count: number = 10): LeaderboardEntry[] {
    return this.globalLeaderboard.slice(0, count);
  }

  /**
   * Get rising stars (biggest rank improvements)
   */
  getRisingStars(count: number = 10): LeaderboardEntry[] {
    return this.globalLeaderboard
      .filter(e => e.rankChange && e.rankChange > 0)
      .sort((a, b) => (b.rankChange || 0) - (a.rankChange || 0))
      .slice(0, count);
  }

  /**
   * Get falling wallets (biggest rank drops)
   */
  getFallingWallets(count: number = 10): LeaderboardEntry[] {
    return this.globalLeaderboard
      .filter(e => e.rankChange && e.rankChange < 0)
      .sort((a, b) => (a.rankChange || 0) - (b.rankChange || 0))
      .slice(0, count);
  }

  /**
   * Get wallet historical rankings
   */
  getWalletHistory(walletAddress: string, limit: number = 30): HistoricalRanking[] {
    const history = this.historicalRankings.get(walletAddress);
    return history ? history.slice(-limit) : [];
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalWallets: this.globalLeaderboard.length,
      categoryBreakdown: {
        sniper: this.getCategoryLeaderboard('sniper').length,
        swing: this.getCategoryLeaderboard('swing').length,
        hodler: this.getCategoryLeaderboard('hodler').length,
        scalper: this.getCategoryLeaderboard('scalper').length,
        whale: this.getCategoryLeaderboard('whale').length,
      },
      topScore: this.globalLeaderboard[0]?.overallScore || 0,
      avgScore: this.globalLeaderboard.length > 0
        ? this.globalLeaderboard.reduce((sum, e) => sum + e.overallScore, 0) / this.globalLeaderboard.length
        : 0,
      lastUpdate: this.lastUpdate,
    };
  }

  /**
   * Format leaderboard for display
   */
  formatForDisplay(entries: LeaderboardEntry[], limit: number = 10): string {
    let output = '';

    for (let i = 0; i < Math.min(limit, entries.length); i++) {
      const entry = entries[i];
      const trend = entry.rankChange
        ? entry.rankChange > 0
          ? `📈 +${entry.rankChange}`
          : `📉 ${entry.rankChange}`
        : '➖';

      output += `${entry.rank}. ${entry.walletAddress.slice(0, 8)}... ${trend}\n`;
      output += `   Win: ${(entry.winRate * 100).toFixed(1)}% | Avg: ${entry.avgReturn.toFixed(1)}% | Score: ${(entry.overallScore * 100).toFixed(1)}\n`;
      output += `   ${entry.profile.category.toUpperCase()} | ${entry.profile.sampleSize} trades\n\n`;
    }

    return output;
  }
}
