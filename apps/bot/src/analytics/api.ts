/**
 * Analytics API
 * Unified interface for all analytics modules
 */

import { patternAnalytics, PatternPerformanceMetrics, PatternCorrelation, PatternCombination } from './patternAnalytics';
import { timeAnalytics, HourlyPerformance, DayOfWeekPerformance, HoldTimeAnalysis, TimeToPumpAnalysis, WeekdayWeekendComparison } from './timeAnalytics';
import { lifecycleAnalytics, LifecycleStats, LiquidityPattern, SmartMoneyTiming, SurvivalRate } from './lifecycleAnalytics';
import { riskAnalytics, RiskScoreAccuracy, FeatureImportance, RiskDistribution, ThresholdOptimization, CalibrationCurve } from './riskAnalytics';
import { logger } from '../utils/logger';

export interface AnalyticsSummary {
  patterns: {
    totalPatterns: number;
    avgWinRate: number;
    bestPattern: string;
    totalMatches: number;
  };
  
  time: {
    bestEntryHour: number;
    bestEntryDay: string;
    avgHoldTime: number;
    weekdayVsWeekend: { preferred: string; winRateDiff: number };
  };
  
  lifecycle: {
    avgTimeToPeak: number;
    successRate: number;
    avgPeakMultiplier: number;
    survivalRate24h: number;
  };
  
  risk: {
    overallAccuracy: number;
    optimalThreshold: number;
    topFeature: string;
  };
  
  timestamp: number;
}

export interface TopPerformingSignals {
  patterns: PatternPerformanceMetrics[];
  entryTimes: HourlyPerformance[];
  combinations: PatternCombination[];
}

export interface VisualizationData {
  heatmap: {
    hours: number[];
    days: string[];
    data: number[][]; // [hour][day] = win rate
  };
  
  distributions: {
    riskScores: RiskDistribution[];
    holdTimes: HoldTimeAnalysis[];
    timeToPump: TimeToPumpAnalysis;
  };
  
  timelines: {
    lifecycle: LifecycleStats;
    smartMoney: SmartMoneyTiming;
  };
  
  correlations: {
    patterns: PatternCorrelation[];
    features: FeatureImportance[];
  };
}

class AnalyticsAPI {
  /**
   * Get pattern performance metrics
   */
  async getPatternPerformance(patternName?: string): Promise<PatternPerformanceMetrics | PatternPerformanceMetrics[]> {
    try {
      if (patternName) {
        const performance = await patternAnalytics.getPatternPerformance(patternName);
        return performance || [];
      }

      return await patternAnalytics.getAllPatternPerformance();
    } catch (error) {
      logger.error('AnalyticsAPI', 'Failed to get pattern performance', error as Error);
      return [];
    }
  }

  /**
   * Get time-based insights
   */
  async getTimeBasedInsights(): Promise<{
    hourly: HourlyPerformance[];
    daily: DayOfWeekPerformance[];
    holdTime: HoldTimeAnalysis[];
    timeToPump: TimeToPumpAnalysis;
    weekdayWeekend: WeekdayWeekendComparison;
    bestTimes: HourlyPerformance[];
    worstTimes: HourlyPerformance[];
  }> {
    try {
      const [hourly, daily, holdTime, timeToPump, weekdayWeekend, bestTimes, worstTimes] = await Promise.all([
        timeAnalytics.getHourlyPerformance(),
        timeAnalytics.getDayOfWeekPerformance(),
        timeAnalytics.getHoldTimeAnalysis(),
        timeAnalytics.getTimeToPumpAnalysis(),
        timeAnalytics.getWeekdayWeekendComparison(),
        timeAnalytics.getBestEntryTimes(),
        timeAnalytics.getWorstEntryTimes(),
      ]);

      return {
        hourly,
        daily,
        holdTime,
        timeToPump,
        weekdayWeekend,
        bestTimes,
        worstTimes,
      };
    } catch (error) {
      logger.error('AnalyticsAPI', 'Failed to get time-based insights', error as Error);
      throw error;
    }
  }

  /**
   * Get lifecycle statistics
   */
  async getLifecycleStats(): Promise<{
    stats: LifecycleStats;
    liquidityPatterns: LiquidityPattern[];
    smartMoneyTiming: SmartMoneyTiming;
    survivalRates: SurvivalRate;
  }> {
    try {
      const [stats, liquidityPatterns, smartMoneyTiming, survivalRates] = await Promise.all([
        lifecycleAnalytics.getLifecycleStats(),
        lifecycleAnalytics.getLiquidityPatterns(),
        lifecycleAnalytics.getSmartMoneyTiming(),
        lifecycleAnalytics.getSurvivalRates(),
      ]);

      return {
        stats,
        liquidityPatterns,
        smartMoneyTiming,
        survivalRates,
      };
    } catch (error) {
      logger.error('AnalyticsAPI', 'Failed to get lifecycle stats', error as Error);
      throw error;
    }
  }

  /**
   * Get risk score validation metrics
   */
  async getRiskScoreAccuracy(): Promise<{
    byLevel: RiskScoreAccuracy[];
    featureImportance: FeatureImportance[];
    distribution: RiskDistribution[];
    optimalThresholds: ThresholdOptimization[];
    calibrationCurve: CalibrationCurve[];
    summary: Awaited<ReturnType<typeof riskAnalytics.getRiskValidationSummary>>;
  }> {
    try {
      const [byLevel, featureImportance, distribution, optimalThresholds, calibrationCurve, summary] = await Promise.all([
        riskAnalytics.getRiskScoreAccuracy(),
        riskAnalytics.getFeatureImportance(),
        riskAnalytics.getRiskDistribution(),
        riskAnalytics.getOptimalThresholds(),
        riskAnalytics.getCalibrationCurve(),
        riskAnalytics.getRiskValidationSummary(),
      ]);

      return {
        byLevel,
        featureImportance,
        distribution,
        optimalThresholds,
        calibrationCurve,
        summary,
      };
    } catch (error) {
      logger.error('AnalyticsAPI', 'Failed to get risk score accuracy', error as Error);
      throw error;
    }
  }

  /**
   * Get top performing signals
   */
  async getTopPerformingSignals(limit = 10): Promise<TopPerformingSignals> {
    try {
      const [patterns, entryTimes, combinations] = await Promise.all([
        patternAnalytics.getAllPatternPerformance(),
        timeAnalytics.getBestEntryTimes(limit),
        patternAnalytics.getBestPatternCombinations(5),
      ]);

      return {
        patterns: patterns.slice(0, limit),
        entryTimes,
        combinations,
      };
    } catch (error) {
      logger.error('AnalyticsAPI', 'Failed to get top performing signals', error as Error);
      throw error;
    }
  }

  /**
   * Get comprehensive analytics summary
   */
  async getAnalyticsSummary(): Promise<AnalyticsSummary> {
    try {
      const [patternStats, timeInsights, lifecycleData, riskData] = await Promise.all([
        patternAnalytics.getPatternStatsSummary(),
        this.getTimeBasedInsights(),
        this.getLifecycleStats(),
        riskAnalytics.getRiskValidationSummary(),
      ]);

      const bestEntryHour = timeInsights.bestTimes.length > 0 
        ? timeInsights.bestTimes[0].hour 
        : 0;

      const bestDay = timeInsights.daily
        .filter(d => d.totalTrades >= 5)
        .sort((a, b) => b.winRate - a.winRate)[0];

      const bestEntryDay = bestDay?.dayName || 'Unknown';

      const avgHoldTime = timeInsights.holdTime
        .filter(h => h.count > 0)
        .reduce((sum, h, _, arr) => sum + (h.avgReturn * h.count) / arr.reduce((s, a) => s + a.count, 0), 0);

      const weekdayPreferred = timeInsights.weekdayWeekend.difference.winRateDiff > 0 
        ? 'Weekday' 
        : 'Weekend';

      const topFeature = (await riskAnalytics.getFeatureImportance())[0]?.feature || 'Unknown';

      return {
        patterns: {
          totalPatterns: patternStats.totalPatterns,
          avgWinRate: patternStats.avgWinRate,
          bestPattern: patternStats.bestPattern,
          totalMatches: patternStats.totalMatches,
        },
        time: {
          bestEntryHour,
          bestEntryDay,
          avgHoldTime: avgHoldTime || 0,
          weekdayVsWeekend: {
            preferred: weekdayPreferred,
            winRateDiff: Math.abs(timeInsights.weekdayWeekend.difference.winRateDiff),
          },
        },
        lifecycle: {
          avgTimeToPeak: lifecycleData.stats.avgLaunchToPeak,
          successRate: lifecycleData.stats.successRate,
          avgPeakMultiplier: lifecycleData.stats.avgPeakMultiplier,
          survivalRate24h: lifecycleData.survivalRates.after24h,
        },
        risk: {
          overallAccuracy: riskData.overallAccuracy,
          optimalThreshold: riskData.optimalThreshold,
          topFeature,
        },
        timestamp: Math.floor(Date.now() / 1000),
      };
    } catch (error) {
      logger.error('AnalyticsAPI', 'Failed to get analytics summary', error as Error);
      throw error;
    }
  }

  /**
   * Get visualization-ready data
   */
  async getVisualizationData(): Promise<VisualizationData> {
    try {
      const [
        hourlyPerf,
        dailyPerf,
        riskDist,
        holdTime,
        timeToPump,
        lifecycle,
        smartMoney,
        patternCorr,
        featureImp,
      ] = await Promise.all([
        timeAnalytics.getHourlyPerformance(),
        timeAnalytics.getDayOfWeekPerformance(),
        riskAnalytics.getRiskDistribution(),
        timeAnalytics.getHoldTimeAnalysis(),
        timeAnalytics.getTimeToPumpAnalysis(),
        lifecycleAnalytics.getLifecycleStats(),
        lifecycleAnalytics.getSmartMoneyTiming(),
        patternAnalytics.getPatternCorrelations(),
        riskAnalytics.getFeatureImportance(),
      ]);

      // Build heatmap data (hour x day)
      const hours = Array.from({ length: 24 }, (_, i) => i);
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const data: number[][] = [];

      for (let hour = 0; hour < 24; hour++) {
        data[hour] = [];
        for (let day = 0; day < 7; day++) {
          // Simplified - use hourly win rate (could be refined with day-specific data)
          const hourData = hourlyPerf.find(h => h.hour === hour);
          data[hour][day] = hourData?.winRate || 0;
        }
      }

      return {
        heatmap: { hours, days, data },
        distributions: {
          riskScores: riskDist,
          holdTimes: holdTime,
          timeToPump,
        },
        timelines: {
          lifecycle,
          smartMoney,
        },
        correlations: {
          patterns: patternCorr,
          features: featureImp,
        },
      };
    } catch (error) {
      logger.error('AnalyticsAPI', 'Failed to get visualization data', error as Error);
      throw error;
    }
  }

  /**
   * Get pattern correlations
   */
  async getPatternCorrelations(minCoOccurrence = 5): Promise<PatternCorrelation[]> {
    return await patternAnalytics.getPatternCorrelations(minCoOccurrence);
  }

  /**
   * Get pattern combinations
   */
  async getPatternCombinations(minMatches = 5): Promise<PatternCombination[]> {
    return await patternAnalytics.getBestPatternCombinations(minMatches);
  }
}

export const analyticsAPI = new AnalyticsAPI();

// Export all types
export * from './patternAnalytics';
export * from './timeAnalytics';
export * from './lifecycleAnalytics';
export * from './riskAnalytics';
