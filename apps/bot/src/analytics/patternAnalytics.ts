/**
 * Pattern Performance Analytics
 * Analyzes win rates, accuracy, and correlations of detected patterns
 */

import { database } from '../database';
import { logger } from '../utils/logger';

export interface PatternPerformanceMetrics {
  patternName: string;
  patternType: 'success' | 'rug' | 'neutral';
  
  // Win rate metrics
  totalMatches: number;
  successfulMatches: number;
  failedMatches: number;
  winRate: number;
  
  // Accuracy metrics
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  
  // Financial performance
  averageReturnPercent: number;
  medianReturnPercent: number;
  bestReturnPercent: number;
  worstReturnPercent: number;
  
  // Timing
  averageHoldTime: number;
  averageTimeToPeak: number;
  
  // Confidence
  confidenceScore: number;
  sampleSize: number;
}

export interface PatternCorrelation {
  pattern1: string;
  pattern2: string;
  coOccurrenceCount: number;
  coOccurrenceRate: number;
  combinedWinRate: number;
  combinedAvgReturn: number;
  correlation: number;
}

export interface PatternCombination {
  patterns: string[];
  matchCount: number;
  winRate: number;
  avgReturn: number;
  significance: number;
}

class PatternAnalytics {
  /**
   * Get performance metrics for a specific pattern
   */
  async getPatternPerformance(patternName: string): Promise<PatternPerformanceMetrics | null> {
    try {
      const pattern = database.get<any>(
        'SELECT * FROM success_patterns WHERE pattern_name = ?',
        [patternName]
      );

      if (!pattern) return null;

      // Get all matches for this pattern with outcomes
      const matches = database.all<any>(
        `SELECT tpm.*, to2.outcome_type, to2.price_change_24h, to2.max_price, to2.initial_price
         FROM token_pattern_matches tpm
         LEFT JOIN token_outcomes_v2 to2 ON tpm.token_mint = to2.token_mint
         WHERE tpm.pattern_name = ?
         AND tpm.actual_outcome IS NOT NULL
         AND tpm.actual_outcome != 'pending'`,
        [patternName]
      );

      if (matches.length === 0) {
        return this.getDefaultMetrics(pattern);
      }

      // Calculate metrics
      const successfulMatches = matches.filter(m => 
        m.actual_outcome === 'success' || 
        m.actual_outcome === 'moon' ||
        (m.outcome_type === 'moon' || m.outcome_type === 'pump')
      );

      const failedMatches = matches.filter(m => 
        m.actual_outcome === 'rug' || 
        m.outcome_type === 'rug'
      );

      const winRate = (successfulMatches.length / matches.length) * 100;

      // Calculate confusion matrix for accuracy
      const isSuccessPattern = pattern.pattern_type === 'success';
      const truePositives = isSuccessPattern ? successfulMatches.length : failedMatches.length;
      const falsePositives = isSuccessPattern ? failedMatches.length : successfulMatches.length;
      const trueNegatives = 0; // Would need negative examples
      const falseNegatives = 0; // Would need negative examples

      const accuracy = matches.length > 0 
        ? (truePositives / matches.length) * 100 
        : 0;

      const precision = (truePositives + falsePositives) > 0
        ? (truePositives / (truePositives + falsePositives)) * 100
        : 0;

      const recall = (truePositives + falseNegatives) > 0
        ? (truePositives / (truePositives + falseNegatives)) * 100
        : 0;

      const f1Score = (precision + recall) > 0
        ? (2 * precision * recall) / (precision + recall)
        : 0;

      // Calculate returns
      const returns = matches
        .filter(m => m.peak_multiplier || m.max_price)
        .map(m => {
          if (m.peak_multiplier) return (m.peak_multiplier - 1) * 100;
          if (m.max_price && m.initial_price) {
            return ((m.max_price / m.initial_price) - 1) * 100;
          }
          return m.price_change_24h || 0;
        })
        .sort((a, b) => a - b);

      const averageReturn = returns.length > 0
        ? returns.reduce((sum, r) => sum + r, 0) / returns.length
        : 0;

      const medianReturn = returns.length > 0
        ? returns[Math.floor(returns.length / 2)]
        : 0;

      const bestReturn = returns.length > 0 ? Math.max(...returns) : 0;
      const worstReturn = returns.length > 0 ? Math.min(...returns) : 0;

      // Calculate timing metrics
      const holdTimes = matches
        .filter(m => m.hold_time_hours)
        .map(m => m.hold_time_hours);

      const avgHoldTime = holdTimes.length > 0
        ? holdTimes.reduce((sum, t) => sum + t, 0) / holdTimes.length
        : 0;

      return {
        patternName: pattern.pattern_name,
        patternType: pattern.pattern_type,
        totalMatches: matches.length,
        successfulMatches: successfulMatches.length,
        failedMatches: failedMatches.length,
        winRate,
        truePositives,
        falsePositives,
        trueNegatives,
        falseNegatives,
        accuracy,
        precision,
        recall,
        f1Score,
        averageReturnPercent: averageReturn,
        medianReturnPercent: medianReturn,
        bestReturnPercent: bestReturn,
        worstReturnPercent: worstReturn,
        averageHoldTime: avgHoldTime,
        averageTimeToPeak: pattern.average_time_to_peak_hours || 0,
        confidenceScore: pattern.confidence_score || 0,
        sampleSize: matches.length,
      };
    } catch (error) {
      logger.error('PatternAnalytics', 'Failed to get pattern performance', error);
      return null;
    }
  }

  /**
   * Get performance metrics for all patterns
   */
  async getAllPatternPerformance(): Promise<PatternPerformanceMetrics[]> {
    try {
      const patterns = database.all<any>('SELECT pattern_name FROM success_patterns');
      const metrics: PatternPerformanceMetrics[] = [];

      for (const pattern of patterns) {
        const perf = await this.getPatternPerformance(pattern.pattern_name);
        if (perf) metrics.push(perf);
      }

      // Sort by win rate descending
      metrics.sort((a, b) => b.winRate - a.winRate);

      return metrics;
    } catch (error) {
      logger.error('PatternAnalytics', 'Failed to get all pattern performance', error);
      return [];
    }
  }

  /**
   * Find patterns that frequently appear together
   */
  async getPatternCorrelations(minCoOccurrence = 5): Promise<PatternCorrelation[]> {
    try {
      // Get all tokens with multiple pattern matches
      const tokensWithPatterns = database.all<any>(
        `SELECT token_mint, 
         GROUP_CONCAT(pattern_name, '|') as patterns,
         GROUP_CONCAT(actual_outcome, '|') as outcomes
         FROM token_pattern_matches
         WHERE actual_outcome IS NOT NULL AND actual_outcome != 'pending'
         GROUP BY token_mint
         HAVING COUNT(*) > 1`
      );

      // Build correlation map
      const correlationMap = new Map<string, {
        count: number;
        successCount: number;
        returns: number[];
      }>();

      for (const token of tokensWithPatterns) {
        const patterns = token.patterns.split('|');
        const outcomes = token.outcomes.split('|');

        // Get all pattern pairs
        for (let i = 0; i < patterns.length; i++) {
          for (let j = i + 1; j < patterns.length; j++) {
            const pair = [patterns[i], patterns[j]].sort().join('::');
            const isSuccess = outcomes[i] === 'success' || outcomes[i] === 'moon';

            if (!correlationMap.has(pair)) {
              correlationMap.set(pair, { count: 0, successCount: 0, returns: [] });
            }

            const stats = correlationMap.get(pair)!;
            stats.count++;
            if (isSuccess) stats.successCount++;
          }
        }
      }

      // Convert to correlation objects
      const correlations: PatternCorrelation[] = [];

      for (const [pair, stats] of correlationMap.entries()) {
        if (stats.count < minCoOccurrence) continue;

        const [pattern1, pattern2] = pair.split('::');

        const coOccurrenceRate = (stats.count / tokensWithPatterns.length) * 100;
        const combinedWinRate = (stats.successCount / stats.count) * 100;

        // Calculate correlation coefficient (simplified)
        const pattern1WinRate = await this.getPatternWinRate(pattern1);
        const pattern2WinRate = await this.getPatternWinRate(pattern2);
        const expectedCombinedWinRate = (pattern1WinRate + pattern2WinRate) / 2;
        const correlation = combinedWinRate - expectedCombinedWinRate;

        correlations.push({
          pattern1,
          pattern2,
          coOccurrenceCount: stats.count,
          coOccurrenceRate,
          combinedWinRate,
          combinedAvgReturn: 0, // TODO: Calculate from actual returns
          correlation,
        });
      }

      // Sort by correlation strength
      correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

      return correlations;
    } catch (error) {
      logger.error('PatternAnalytics', 'Failed to get pattern correlations', error);
      return [];
    }
  }

  /**
   * Find best performing pattern combinations
   */
  async getBestPatternCombinations(minMatches = 5): Promise<PatternCombination[]> {
    try {
      // Get all tokens with their patterns
      const tokensWithPatterns = database.all<any>(
        `SELECT 
          tpm.token_mint,
          GROUP_CONCAT(tpm.pattern_name, '|') as patterns,
          to2.outcome_type,
          to2.price_change_24h,
          to2.max_price,
          to2.initial_price
         FROM token_pattern_matches tpm
         LEFT JOIN token_outcomes_v2 to2 ON tpm.token_mint = to2.token_mint
         WHERE tpm.actual_outcome IS NOT NULL
         GROUP BY tpm.token_mint
         HAVING COUNT(*) >= 2`
      );

      // Build combination stats
      const combinationMap = new Map<string, {
        matchCount: number;
        successCount: number;
        returns: number[];
      }>();

      for (const token of tokensWithPatterns) {
        const patterns = token.patterns.split('|').sort();
        const combo = patterns.join('::');

        if (!combinationMap.has(combo)) {
          combinationMap.set(combo, { matchCount: 0, successCount: 0, returns: [] });
        }

        const stats = combinationMap.get(combo)!;
        stats.matchCount++;

        const isSuccess = token.outcome_type === 'moon' || token.outcome_type === 'pump';
        if (isSuccess) stats.successCount++;

        // Calculate return
        let returnPercent = token.price_change_24h || 0;
        if (token.max_price && token.initial_price) {
          returnPercent = ((token.max_price / token.initial_price) - 1) * 100;
        }
        stats.returns.push(returnPercent);
      }

      // Convert to combination objects
      const combinations: PatternCombination[] = [];

      for (const [combo, stats] of combinationMap.entries()) {
        if (stats.matchCount < minMatches) continue;

        const patterns = combo.split('::');
        const winRate = (stats.successCount / stats.matchCount) * 100;
        const avgReturn = stats.returns.reduce((sum, r) => sum + r, 0) / stats.returns.length;

        // Calculate statistical significance (chi-square test simplified)
        const expected = stats.matchCount / 2;
        const chiSquare = Math.pow(stats.successCount - expected, 2) / expected;
        const significance = chiSquare;

        combinations.push({
          patterns,
          matchCount: stats.matchCount,
          winRate,
          avgReturn,
          significance,
        });
      }

      // Sort by win rate and sample size
      combinations.sort((a, b) => {
        const scoreA = a.winRate * Math.log(a.matchCount);
        const scoreB = b.winRate * Math.log(b.matchCount);
        return scoreB - scoreA;
      });

      return combinations.slice(0, 20);
    } catch (error) {
      logger.error('PatternAnalytics', 'Failed to get pattern combinations', error);
      return [];
    }
  }

  /**
   * Get statistical summary for all patterns
   */
  async getPatternStatsSummary(): Promise<{
    totalPatterns: number;
    activePatterns: number;
    avgWinRate: number;
    avgAccuracy: number;
    bestPattern: string;
    worstPattern: string;
    totalMatches: number;
  }> {
    try {
      const allMetrics = await this.getAllPatternPerformance();

      if (allMetrics.length === 0) {
        return {
          totalPatterns: 0,
          activePatterns: 0,
          avgWinRate: 0,
          avgAccuracy: 0,
          bestPattern: 'N/A',
          worstPattern: 'N/A',
          totalMatches: 0,
        };
      }

      const activeMetrics = allMetrics.filter(m => m.sampleSize >= 10);

      const avgWinRate = allMetrics.reduce((sum, m) => sum + m.winRate, 0) / allMetrics.length;
      const avgAccuracy = allMetrics.reduce((sum, m) => sum + m.accuracy, 0) / allMetrics.length;

      const bestPattern = allMetrics[0]?.patternName || 'N/A';
      const worstPattern = allMetrics[allMetrics.length - 1]?.patternName || 'N/A';

      const totalMatches = allMetrics.reduce((sum, m) => sum + m.totalMatches, 0);

      return {
        totalPatterns: allMetrics.length,
        activePatterns: activeMetrics.length,
        avgWinRate,
        avgAccuracy,
        bestPattern,
        worstPattern,
        totalMatches,
      };
    } catch (error) {
      logger.error('PatternAnalytics', 'Failed to get pattern stats summary', error);
      return {
        totalPatterns: 0,
        activePatterns: 0,
        avgWinRate: 0,
        avgAccuracy: 0,
        bestPattern: 'N/A',
        worstPattern: 'N/A',
        totalMatches: 0,
      };
    }
  }

  // ============================================
  // Helper Methods
  // ============================================

  private async getPatternWinRate(patternName: string): Promise<number> {
    const perf = await this.getPatternPerformance(patternName);
    return perf?.winRate || 0;
  }

  private getDefaultMetrics(pattern: any): PatternPerformanceMetrics {
    return {
      patternName: pattern.pattern_name,
      patternType: pattern.pattern_type,
      totalMatches: 0,
      successfulMatches: 0,
      failedMatches: 0,
      winRate: 0,
      truePositives: 0,
      falsePositives: 0,
      trueNegatives: 0,
      falseNegatives: 0,
      accuracy: 0,
      precision: 0,
      recall: 0,
      f1Score: 0,
      averageReturnPercent: 0,
      medianReturnPercent: 0,
      bestReturnPercent: 0,
      worstReturnPercent: 0,
      averageHoldTime: 0,
      averageTimeToPeak: pattern.average_time_to_peak_hours || 0,
      confidenceScore: pattern.confidence_score || 0,
      sampleSize: 0,
    };
  }
}

export const patternAnalytics = new PatternAnalytics();
