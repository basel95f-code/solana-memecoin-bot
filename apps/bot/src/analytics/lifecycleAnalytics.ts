/**
 * Token Lifecycle Analytics
 * Analyzes token behavior from launch to peak to dump
 */

import { database } from '../database';
import { logger } from '../utils/logger';

export interface LifecycleStats {
  avgLaunchToPeak: number; // Hours
  avgPeakToDump: number; // Hours
  avgTotalLifecycle: number; // Hours
  
  medianLaunchToPeak: number;
  medianPeakToDump: number;
  medianTotalLifecycle: number;
  
  successRate: number;
  avgPeakMultiplier: number;
  medianPeakMultiplier: number;
}

export interface LiquidityPattern {
  phase: 'launch' | 'growth' | 'peak' | 'decline' | 'death';
  avgLiquidity: number;
  avgDuration: number; // Hours in this phase
  typicalBehavior: string;
}

export interface HolderBehavior {
  accumulationPhase: {
    avgNewHolders: number;
    avgTop10Change: number;
    duration: number;
  };
  distributionPhase: {
    avgExitingHolders: number;
    avgTop10Change: number;
    duration: number;
  };
}

export interface SmartMoneyTiming {
  avgEntryTime: number; // Hours after launch
  avgExitTime: number; // Hours after launch
  avgHoldDuration: number;
  entryDistribution: { range: string; count: number; percentage: number }[];
  exitDistribution: { range: string; count: number; percentage: number }[];
}

export interface SurvivalRate {
  after24h: number; // Percentage still liquid
  after7d: number;
  after30d: number;
  totalTokens: number;
}

export interface LifecycleTimeline {
  tokenMint: string;
  symbol: string;
  events: {
    timestamp: number;
    event: string;
    price?: number;
    liquidity?: number;
    holders?: number;
  }[];
}

class LifecycleAnalytics {
  /**
   * Get overall lifecycle statistics
   */
  async getLifecycleStats(): Promise<LifecycleStats> {
    try {
      const tokens = database.all<any>(
        `SELECT 
          to2.discovered_at,
          to2.checked_at,
          to2.max_price,
          to2.initial_price,
          to2.final_price,
          to2.outcome_type
         FROM token_outcomes_v2 to2
         WHERE to2.discovered_at > 0
         AND to2.outcome_type IS NOT NULL`
      );

      if (tokens.length === 0) {
        return this.getDefaultLifecycleStats();
      }

      const launchToPeakTimes: number[] = [];
      const peakToDumpTimes: number[] = [];
      const totalLifecycleTimes: number[] = [];
      const peakMultipliers: number[] = [];

      const now = Math.floor(Date.now() / 1000);

      for (const token of tokens) {
        // Launch to peak (simplified - using checked_at as reference)
        if (token.checked_at && token.discovered_at) {
          const timeToPeak = (token.checked_at - token.discovered_at) / 3600;
          if (timeToPeak > 0 && timeToPeak < 720) { // Max 30 days
            launchToPeakTimes.push(timeToPeak);
          }
        }

        // Peak to dump (estimate - if token failed, assume dump within 24h of check)
        if (token.outcome_type === 'rug' || token.outcome_type === 'decline') {
          const dumpTime = 24; // Simplified
          peakToDumpTimes.push(dumpTime);
          
          if (launchToPeakTimes.length > 0) {
            totalLifecycleTimes.push(launchToPeakTimes[launchToPeakTimes.length - 1] + dumpTime);
          }
        }

        // Peak multiplier
        if (token.max_price && token.initial_price && token.initial_price > 0) {
          const multiplier = token.max_price / token.initial_price;
          if (multiplier > 0 && multiplier < 1000) {
            peakMultipliers.push(multiplier);
          }
        }
      }

      const calculateStats = (arr: number[]) => {
        if (arr.length === 0) return { avg: 0, median: 0 };
        arr.sort((a, b) => a - b);
        const avg = arr.reduce((sum, v) => sum + v, 0) / arr.length;
        const median = arr[Math.floor(arr.length / 2)];
        return { avg, median };
      };

      const launchToPeakStats = calculateStats(launchToPeakTimes);
      const peakToDumpStats = calculateStats(peakToDumpTimes);
      const lifecycleStats = calculateStats(totalLifecycleTimes);
      const multiplierStats = calculateStats(peakMultipliers);

      const successCount = tokens.filter(t => 
        t.outcome_type === 'moon' || t.outcome_type === 'pump'
      ).length;

      const successRate = (successCount / tokens.length) * 100;

      return {
        avgLaunchToPeak: launchToPeakStats.avg,
        avgPeakToDump: peakToDumpStats.avg,
        avgTotalLifecycle: lifecycleStats.avg,
        medianLaunchToPeak: launchToPeakStats.median,
        medianPeakToDump: peakToDumpStats.median,
        medianTotalLifecycle: lifecycleStats.median,
        successRate,
        avgPeakMultiplier: multiplierStats.avg,
        medianPeakMultiplier: multiplierStats.median,
      };
    } catch (error) {
      logger.error('LifecycleAnalytics', 'Failed to get lifecycle stats', error as Error);
      return this.getDefaultLifecycleStats();
    }
  }

  /**
   * Analyze liquidity patterns over token lifecycle
   */
  async getLiquidityPatterns(): Promise<LiquidityPattern[]> {
    try {
      // Get token snapshots to analyze liquidity changes
      const snapshots = database.all<any>(
        `SELECT 
          ts.mint,
          ts.liquidity_usd,
          ts.recorded_at,
          to2.discovered_at,
          to2.outcome_type
         FROM token_snapshots ts
         LEFT JOIN token_outcomes_v2 to2 ON ts.mint = to2.token_mint
         WHERE ts.liquidity_usd IS NOT NULL
         ORDER BY ts.mint, ts.recorded_at`
      );

      // Group by token and phase
      const phaseMap = new Map<string, {
        liquidities: number[];
        durations: number[];
      }>();

      const phases: Array<'launch' | 'growth' | 'peak' | 'decline' | 'death'> = [
        'launch', 'growth', 'peak', 'decline', 'death'
      ];

      for (const phase of phases) {
        phaseMap.set(phase, { liquidities: [], durations: [] });
      }

      // Categorize snapshots by phase
      const tokenMap = new Map<string, any[]>();

      for (const snapshot of snapshots) {
        if (!tokenMap.has(snapshot.mint)) {
          tokenMap.set(snapshot.mint, []);
        }
        tokenMap.get(snapshot.mint)!.push(snapshot);
      }

      for (const [mint, snaps] of tokenMap.entries()) {
        if (snaps.length < 2) continue;

        snaps.sort((a, b) => a.recorded_at - b.recorded_at);

        const firstSnap = snaps[0];
        const lastSnap = snaps[snaps.length - 1];
        const maxLiq = Math.max(...snaps.map(s => s.liquidity_usd));

        for (let i = 0; i < snaps.length; i++) {
          const snap = snaps[i];
          const timeSinceLaunch = (snap.recorded_at - snap.discovered_at) / 3600;

          let phase: 'launch' | 'growth' | 'peak' | 'decline' | 'death';

          if (timeSinceLaunch < 1) {
            phase = 'launch';
          } else if (snap.liquidity_usd > maxLiq * 0.8) {
            phase = 'peak';
          } else if (snap.liquidity_usd > maxLiq * 0.5) {
            phase = 'growth';
          } else if (snap.liquidity_usd > maxLiq * 0.1) {
            phase = 'decline';
          } else {
            phase = 'death';
          }

          const stats = phaseMap.get(phase)!;
          stats.liquidities.push(snap.liquidity_usd);

          if (i > 0) {
            const duration = (snap.recorded_at - snaps[i - 1].recorded_at) / 3600;
            stats.durations.push(duration);
          }
        }
      }

      // Build patterns
      const patterns: LiquidityPattern[] = [];

      const behaviors: Record<string, string> = {
        launch: 'Initial liquidity provision, high volatility',
        growth: 'Liquidity increasing, accumulation phase',
        peak: 'Maximum liquidity, highest activity',
        decline: 'Liquidity decreasing, distribution phase',
        death: 'Minimal liquidity, token dying/dead',
      };

      for (const phase of phases) {
        const stats = phaseMap.get(phase)!;

        const avgLiquidity = stats.liquidities.length > 0
          ? stats.liquidities.reduce((sum, l) => sum + l, 0) / stats.liquidities.length
          : 0;

        const avgDuration = stats.durations.length > 0
          ? stats.durations.reduce((sum, d) => sum + d, 0) / stats.durations.length
          : 0;

        patterns.push({
          phase,
          avgLiquidity,
          avgDuration,
          typicalBehavior: behaviors[phase],
        });
      }

      return patterns;
    } catch (error) {
      logger.error('LifecycleAnalytics', 'Failed to get liquidity patterns', error as Error);
      return [];
    }
  }

  /**
   * Analyze holder behavior (accumulation vs distribution)
   */
  async getHolderBehavior(): Promise<HolderBehavior | null> {
    try {
      // This requires historical holder data which we may not have
      // Returning placeholder for now

      return {
        accumulationPhase: {
          avgNewHolders: 0,
          avgTop10Change: 0,
          duration: 0,
        },
        distributionPhase: {
          avgExitingHolders: 0,
          avgTop10Change: 0,
          duration: 0,
        },
      };
    } catch (error) {
      logger.error('LifecycleAnalytics', 'Failed to get holder behavior', error as Error);
      return null;
    }
  }

  /**
   * Analyze smart money entry/exit timing
   */
  async getSmartMoneyTiming(): Promise<SmartMoneyTiming> {
    try {
      const trades = database.all<any>(
        `SELECT 
          smt.*,
          to2.discovered_at as token_discovered_at
         FROM smart_money_trades smt
         LEFT JOIN token_outcomes_v2 to2 ON smt.token_mint = to2.token_mint
         WHERE smt.entry_time IS NOT NULL
         AND to2.discovered_at IS NOT NULL`
      );

      if (trades.length === 0) {
        return {
          avgEntryTime: 0,
          avgExitTime: 0,
          avgHoldDuration: 0,
          entryDistribution: [],
          exitDistribution: [],
        };
      }

      const entryTimes: number[] = [];
      const exitTimes: number[] = [];
      const holdDurations: number[] = [];

      for (const trade of trades) {
        const entryTime = (trade.entry_time - trade.token_discovered_at) / 3600;
        if (entryTime >= 0 && entryTime < 168) { // Max 7 days
          entryTimes.push(entryTime);
        }

        if (trade.exit_time && trade.status === 'closed') {
          const exitTime = (trade.exit_time - trade.token_discovered_at) / 3600;
          if (exitTime >= 0 && exitTime < 168) {
            exitTimes.push(exitTime);
          }

          if (trade.hold_time_hours) {
            holdDurations.push(trade.hold_time_hours);
          }
        }
      }

      const avgEntryTime = entryTimes.length > 0
        ? entryTimes.reduce((sum, t) => sum + t, 0) / entryTimes.length
        : 0;

      const avgExitTime = exitTimes.length > 0
        ? exitTimes.reduce((sum, t) => sum + t, 0) / exitTimes.length
        : 0;

      const avgHoldDuration = holdDurations.length > 0
        ? holdDurations.reduce((sum, d) => sum + d, 0) / holdDurations.length
        : 0;

      // Create distributions
      const timeRanges = [
        { min: 0, max: 1, label: '<1h' },
        { min: 1, max: 4, label: '1-4h' },
        { min: 4, max: 12, label: '4-12h' },
        { min: 12, max: 24, label: '12-24h' },
        { min: 24, max: 72, label: '1-3d' },
        { min: 72, max: 168, label: '3-7d' },
      ];

      const createDistribution = (times: number[]) => {
        return timeRanges.map(range => {
          const count = times.filter(t => t >= range.min && t < range.max).length;
          const percentage = times.length > 0 ? (count / times.length) * 100 : 0;
          return { range: range.label, count, percentage };
        });
      };

      return {
        avgEntryTime,
        avgExitTime,
        avgHoldDuration,
        entryDistribution: createDistribution(entryTimes),
        exitDistribution: createDistribution(exitTimes),
      };
    } catch (error) {
      logger.error('LifecycleAnalytics', 'Failed to get smart money timing', error as Error);
      return {
        avgEntryTime: 0,
        avgExitTime: 0,
        avgHoldDuration: 0,
        entryDistribution: [],
        exitDistribution: [],
      };
    }
  }

  /**
   * Calculate survival rates
   */
  async getSurvivalRates(): Promise<SurvivalRate> {
    try {
      const allTokens = database.all<any>(
        `SELECT 
          token_mint,
          discovered_at
         FROM token_outcomes_v2
         WHERE discovered_at > 0`
      );

      if (allTokens.length === 0) {
        return { after24h: 0, after7d: 0, after30d: 0, totalTokens: 0 };
      }

      const now = Math.floor(Date.now() / 1000);

      // Check which tokens are still "alive" (have liquidity)
      const checkSurvival = (hoursAgo: number) => {
        const cutoffTime = now - (hoursAgo * 3600);
        const eligibleTokens = allTokens.filter(t => t.discovered_at < cutoffTime);

        if (eligibleTokens.length === 0) return 0;

        // Check current liquidity (simplified - check if they have recent snapshots)
        const aliveCount = eligibleTokens.filter(token => {
          const recentSnapshot = database.get<any>(
            `SELECT liquidity_usd FROM token_snapshots
             WHERE mint = ? AND recorded_at > ?
             ORDER BY recorded_at DESC LIMIT 1`,
            [token.token_mint, cutoffTime]
          );

          return recentSnapshot && recentSnapshot.liquidity_usd > 1000;
        }).length;

        return (aliveCount / eligibleTokens.length) * 100;
      };

      return {
        after24h: checkSurvival(24),
        after7d: checkSurvival(24 * 7),
        after30d: checkSurvival(24 * 30),
        totalTokens: allTokens.length,
      };
    } catch (error) {
      logger.error('LifecycleAnalytics', 'Failed to get survival rates', error as Error);
      return { after24h: 0, after7d: 0, after30d: 0, totalTokens: 0 };
    }
  }

  /**
   * Get detailed lifecycle timeline for a specific token
   */
  async getTokenLifecycleTimeline(tokenMint: string): Promise<LifecycleTimeline | null> {
    try {
      const token = database.get<any>(
        'SELECT * FROM token_outcomes_v2 WHERE token_mint = ?',
        [tokenMint]
      );

      if (!token) return null;

      const snapshots = database.all<any>(
        `SELECT * FROM token_snapshots
         WHERE mint = ?
         ORDER BY recorded_at`,
        [tokenMint]
      );

      const events: LifecycleTimeline['events'] = [];

      // Add discovery event
      events.push({
        timestamp: token.discovered_at,
        event: 'Token Discovered',
        price: token.initial_price,
        liquidity: token.initial_liquidity,
      });

      // Add snapshot events
      for (const snap of snapshots) {
        events.push({
          timestamp: snap.recorded_at,
          event: 'Price Update',
          price: snap.price_usd,
          liquidity: snap.liquidity_usd,
          holders: snap.holder_count,
        });
      }

      // Add peak event
      if (token.max_price) {
        events.push({
          timestamp: token.checked_at || token.discovered_at,
          event: 'Peak Price',
          price: token.max_price,
        });
      }

      // Add outcome event
      if (token.outcome_type) {
        events.push({
          timestamp: token.checked_at,
          event: `Outcome: ${token.outcome_type}`,
          price: token.final_price,
        });
      }

      // Sort by timestamp
      events.sort((a, b) => a.timestamp - b.timestamp);

      return {
        tokenMint,
        symbol: token.symbol,
        events,
      };
    } catch (error) {
      logger.error('LifecycleAnalytics', 'Failed to get token lifecycle timeline', error as Error);
      return null;
    }
  }

  // ============================================
  // Helper Methods
  // ============================================

  private getDefaultLifecycleStats(): LifecycleStats {
    return {
      avgLaunchToPeak: 0,
      avgPeakToDump: 0,
      avgTotalLifecycle: 0,
      medianLaunchToPeak: 0,
      medianPeakToDump: 0,
      medianTotalLifecycle: 0,
      successRate: 0,
      avgPeakMultiplier: 0,
      medianPeakMultiplier: 0,
    };
  }
}

export const lifecycleAnalytics = new LifecycleAnalytics();
