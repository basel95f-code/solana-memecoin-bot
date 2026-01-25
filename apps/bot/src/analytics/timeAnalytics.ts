/**
 * Time-Based Analytics
 * Analyzes best entry times, hold durations, and temporal patterns
 */

import { database } from '../database';
import { logger } from '../utils/logger';

export interface HourlyPerformance {
  hour: number;
  totalTrades: number;
  successfulTrades: number;
  winRate: number;
  avgReturn: number;
  avgHoldTime: number;
}

export interface DayOfWeekPerformance {
  dayOfWeek: number; // 0 = Sunday, 6 = Saturday
  dayName: string;
  totalTrades: number;
  successfulTrades: number;
  winRate: number;
  avgReturn: number;
}

export interface HoldTimeAnalysis {
  holdTimeRange: string;
  count: number;
  winRate: number;
  avgReturn: number;
  avgProfit: number;
}

export interface TimeToPumpAnalysis {
  avgTimeToPump: number; // Hours
  medianTimeToPump: number;
  fastestPump: number;
  slowestPump: number;
  distribution: { range: string; count: number; percentage: number }[];
}

export interface WeekdayWeekendComparison {
  weekday: {
    totalTrades: number;
    winRate: number;
    avgReturn: number;
  };
  weekend: {
    totalTrades: number;
    winRate: number;
    avgReturn: number;
  };
  difference: {
    winRateDiff: number;
    avgReturnDiff: number;
  };
}

class TimeAnalytics {
  /**
   * Analyze performance by hour of day
   */
  async getHourlyPerformance(): Promise<HourlyPerformance[]> {
    try {
      const trades = database.all<any>(
        `SELECT 
          to2.*,
          tpm.matched_at,
          tpm.peak_multiplier,
          tpm.actual_outcome
         FROM token_outcomes_v2 to2
         LEFT JOIN token_pattern_matches tpm ON to2.token_mint = tpm.token_mint
         WHERE to2.discovered_at > 0
         AND to2.outcome_type IS NOT NULL
         ORDER BY to2.discovered_at`
      );

      // Group by hour
      const hourlyMap = new Map<number, {
        total: number;
        success: number;
        returns: number[];
        holdTimes: number[];
      }>();

      for (let hour = 0; hour < 24; hour++) {
        hourlyMap.set(hour, { total: 0, success: 0, returns: [], holdTimes: [] });
      }

      for (const trade of trades) {
        const date = new Date(trade.discovered_at * 1000);
        const hour = date.getUTCHours();

        const stats = hourlyMap.get(hour)!;
        stats.total++;

        const isSuccess = trade.outcome_type === 'moon' || trade.outcome_type === 'pump';
        if (isSuccess) stats.success++;

        // Calculate return
        let returnPercent = trade.price_change_24h || 0;
        if (trade.max_price && trade.initial_price) {
          returnPercent = ((trade.max_price / trade.initial_price) - 1) * 100;
        }
        stats.returns.push(returnPercent);

        // Hold time (simplified - using 24h as default)
        stats.holdTimes.push(24);
      }

      // Convert to array
      const hourlyPerformance: HourlyPerformance[] = [];

      for (let hour = 0; hour < 24; hour++) {
        const stats = hourlyMap.get(hour)!;

        if (stats.total === 0) {
          hourlyPerformance.push({
            hour,
            totalTrades: 0,
            successfulTrades: 0,
            winRate: 0,
            avgReturn: 0,
            avgHoldTime: 0,
          });
          continue;
        }

        const winRate = (stats.success / stats.total) * 100;
        const avgReturn = stats.returns.reduce((sum, r) => sum + r, 0) / stats.returns.length;
        const avgHoldTime = stats.holdTimes.reduce((sum, t) => sum + t, 0) / stats.holdTimes.length;

        hourlyPerformance.push({
          hour,
          totalTrades: stats.total,
          successfulTrades: stats.success,
          winRate,
          avgReturn,
          avgHoldTime,
        });
      }

      return hourlyPerformance;
    } catch (error) {
      logger.error('TimeAnalytics', 'Failed to get hourly performance', error);
      return [];
    }
  }

  /**
   * Analyze performance by day of week
   */
  async getDayOfWeekPerformance(): Promise<DayOfWeekPerformance[]> {
    try {
      const trades = database.all<any>(
        `SELECT 
          to2.*,
          tpm.matched_at,
          tpm.peak_multiplier
         FROM token_outcomes_v2 to2
         LEFT JOIN token_pattern_matches tpm ON to2.token_mint = tpm.token_mint
         WHERE to2.discovered_at > 0
         AND to2.outcome_type IS NOT NULL`
      );

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      // Group by day of week
      const dayMap = new Map<number, {
        total: number;
        success: number;
        returns: number[];
      }>();

      for (let day = 0; day < 7; day++) {
        dayMap.set(day, { total: 0, success: 0, returns: [] });
      }

      for (const trade of trades) {
        const date = new Date(trade.discovered_at * 1000);
        const dayOfWeek = date.getUTCDay();

        const stats = dayMap.get(dayOfWeek)!;
        stats.total++;

        const isSuccess = trade.outcome_type === 'moon' || trade.outcome_type === 'pump';
        if (isSuccess) stats.success++;

        // Calculate return
        let returnPercent = trade.price_change_24h || 0;
        if (trade.max_price && trade.initial_price) {
          returnPercent = ((trade.max_price / trade.initial_price) - 1) * 100;
        }
        stats.returns.push(returnPercent);
      }

      // Convert to array
      const dayPerformance: DayOfWeekPerformance[] = [];

      for (let day = 0; day < 7; day++) {
        const stats = dayMap.get(day)!;

        if (stats.total === 0) {
          dayPerformance.push({
            dayOfWeek: day,
            dayName: dayNames[day],
            totalTrades: 0,
            successfulTrades: 0,
            winRate: 0,
            avgReturn: 0,
          });
          continue;
        }

        const winRate = (stats.success / stats.total) * 100;
        const avgReturn = stats.returns.reduce((sum, r) => sum + r, 0) / stats.returns.length;

        dayPerformance.push({
          dayOfWeek: day,
          dayName: dayNames[day],
          totalTrades: stats.total,
          successfulTrades: stats.success,
          winRate,
          avgReturn,
        });
      }

      return dayPerformance;
    } catch (error) {
      logger.error('TimeAnalytics', 'Failed to get day of week performance', error);
      return [];
    }
  }

  /**
   * Analyze optimal hold times
   */
  async getHoldTimeAnalysis(): Promise<HoldTimeAnalysis[]> {
    try {
      // Get closed trades with hold times
      const trades = database.all<any>(
        `SELECT 
          smt.hold_time_hours,
          smt.profit_percent,
          smt.status
         FROM smart_money_trades smt
         WHERE smt.status = 'closed'
         AND smt.hold_time_hours IS NOT NULL`
      );

      // Define hold time ranges (in hours)
      const ranges = [
        { min: 0, max: 1, label: '<1h' },
        { min: 1, max: 4, label: '1-4h' },
        { min: 4, max: 12, label: '4-12h' },
        { min: 12, max: 24, label: '12-24h' },
        { min: 24, max: 72, label: '1-3d' },
        { min: 72, max: 168, label: '3-7d' },
        { min: 168, max: Infinity, label: '>7d' },
      ];

      const analysis: HoldTimeAnalysis[] = [];

      for (const range of ranges) {
        const rangeTrades = trades.filter(t => 
          t.hold_time_hours >= range.min && t.hold_time_hours < range.max
        );

        if (rangeTrades.length === 0) {
          analysis.push({
            holdTimeRange: range.label,
            count: 0,
            winRate: 0,
            avgReturn: 0,
            avgProfit: 0,
          });
          continue;
        }

        const successCount = rangeTrades.filter(t => t.profit_percent > 0).length;
        const winRate = (successCount / rangeTrades.length) * 100;
        const avgReturn = rangeTrades.reduce((sum, t) => sum + (t.profit_percent || 0), 0) / rangeTrades.length;
        const avgProfit = avgReturn; // Simplified

        analysis.push({
          holdTimeRange: range.label,
          count: rangeTrades.length,
          winRate,
          avgReturn,
          avgProfit,
        });
      }

      return analysis;
    } catch (error) {
      logger.error('TimeAnalytics', 'Failed to get hold time analysis', error);
      return [];
    }
  }

  /**
   * Analyze time from launch to peak
   */
  async getTimeToPumpAnalysis(): Promise<TimeToPumpAnalysis> {
    try {
      const tokens = database.all<any>(
        `SELECT 
          to2.discovered_at,
          to2.checked_at,
          to2.max_price,
          to2.initial_price
         FROM token_outcomes_v2 to2
         WHERE to2.outcome_type IN ('moon', 'pump')
         AND to2.discovered_at > 0
         AND to2.checked_at > 0`
      );

      const timesToPump: number[] = [];

      for (const token of tokens) {
        // Time to pump in hours (simplified - using checked_at as peak time)
        const timeToPump = (token.checked_at - token.discovered_at) / 3600;
        if (timeToPump > 0 && timeToPump < 168) { // Max 7 days
          timesToPump.push(timeToPump);
        }
      }

      if (timesToPump.length === 0) {
        return {
          avgTimeToPump: 0,
          medianTimeToPump: 0,
          fastestPump: 0,
          slowestPump: 0,
          distribution: [],
        };
      }

      timesToPump.sort((a, b) => a - b);

      const avgTimeToPump = timesToPump.reduce((sum, t) => sum + t, 0) / timesToPump.length;
      const medianTimeToPump = timesToPump[Math.floor(timesToPump.length / 2)];
      const fastestPump = timesToPump[0];
      const slowestPump = timesToPump[timesToPump.length - 1];

      // Create distribution
      const ranges = [
        { min: 0, max: 1, label: '<1h' },
        { min: 1, max: 4, label: '1-4h' },
        { min: 4, max: 12, label: '4-12h' },
        { min: 12, max: 24, label: '12-24h' },
        { min: 24, max: 72, label: '1-3d' },
        { min: 72, max: 168, label: '3-7d' },
      ];

      const distribution = ranges.map(range => {
        const count = timesToPump.filter(t => t >= range.min && t < range.max).length;
        const percentage = (count / timesToPump.length) * 100;
        return { range: range.label, count, percentage };
      });

      return {
        avgTimeToPump,
        medianTimeToPump,
        fastestPump,
        slowestPump,
        distribution,
      };
    } catch (error) {
      logger.error('TimeAnalytics', 'Failed to get time to pump analysis', error);
      return {
        avgTimeToPump: 0,
        medianTimeToPump: 0,
        fastestPump: 0,
        slowestPump: 0,
        distribution: [],
      };
    }
  }

  /**
   * Compare weekday vs weekend performance
   */
  async getWeekdayWeekendComparison(): Promise<WeekdayWeekendComparison> {
    try {
      const trades = database.all<any>(
        `SELECT 
          to2.*
         FROM token_outcomes_v2 to2
         WHERE to2.discovered_at > 0
         AND to2.outcome_type IS NOT NULL`
      );

      const weekdayTrades: any[] = [];
      const weekendTrades: any[] = [];

      for (const trade of trades) {
        const date = new Date(trade.discovered_at * 1000);
        const dayOfWeek = date.getUTCDay();

        if (dayOfWeek === 0 || dayOfWeek === 6) {
          weekendTrades.push(trade);
        } else {
          weekdayTrades.push(trade);
        }
      }

      const calculateStats = (trades: any[]) => {
        if (trades.length === 0) {
          return { totalTrades: 0, winRate: 0, avgReturn: 0 };
        }

        const successCount = trades.filter(t => 
          t.outcome_type === 'moon' || t.outcome_type === 'pump'
        ).length;

        const winRate = (successCount / trades.length) * 100;

        const returns = trades.map(t => {
          if (t.max_price && t.initial_price) {
            return ((t.max_price / t.initial_price) - 1) * 100;
          }
          return t.price_change_24h || 0;
        });

        const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

        return { totalTrades: trades.length, winRate, avgReturn };
      };

      const weekday = calculateStats(weekdayTrades);
      const weekend = calculateStats(weekendTrades);

      return {
        weekday,
        weekend,
        difference: {
          winRateDiff: weekday.winRate - weekend.winRate,
          avgReturnDiff: weekday.avgReturn - weekend.avgReturn,
        },
      };
    } catch (error) {
      logger.error('TimeAnalytics', 'Failed to get weekday/weekend comparison', error);
      return {
        weekday: { totalTrades: 0, winRate: 0, avgReturn: 0 },
        weekend: { totalTrades: 0, winRate: 0, avgReturn: 0 },
        difference: { winRateDiff: 0, avgReturnDiff: 0 },
      };
    }
  }

  /**
   * Get best entry times (hours with highest win rate and avg return)
   */
  async getBestEntryTimes(topN = 5): Promise<HourlyPerformance[]> {
    try {
      const hourlyPerf = await this.getHourlyPerformance();

      // Filter out hours with too few samples
      const significantHours = hourlyPerf.filter(h => h.totalTrades >= 5);

      // Sort by combined score (win rate + avg return)
      significantHours.sort((a, b) => {
        const scoreA = a.winRate + (a.avgReturn / 10); // Normalize return
        const scoreB = b.winRate + (b.avgReturn / 10);
        return scoreB - scoreA;
      });

      return significantHours.slice(0, topN);
    } catch (error) {
      logger.error('TimeAnalytics', 'Failed to get best entry times', error);
      return [];
    }
  }

  /**
   * Get worst entry times
   */
  async getWorstEntryTimes(topN = 5): Promise<HourlyPerformance[]> {
    try {
      const hourlyPerf = await this.getHourlyPerformance();

      // Filter out hours with too few samples
      const significantHours = hourlyPerf.filter(h => h.totalTrades >= 5);

      // Sort by combined score ascending
      significantHours.sort((a, b) => {
        const scoreA = a.winRate + (a.avgReturn / 10);
        const scoreB = b.winRate + (b.avgReturn / 10);
        return scoreA - scoreB;
      });

      return significantHours.slice(0, topN);
    } catch (error) {
      logger.error('TimeAnalytics', 'Failed to get worst entry times', error);
      return [];
    }
  }
}

export const timeAnalytics = new TimeAnalytics();
