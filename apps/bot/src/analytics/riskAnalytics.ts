/**
 * Risk Score Validation Analytics
 * Analyzes accuracy and calibration of risk scores
 */

import { database } from '../database';
import { logger } from '../utils/logger';

export interface RiskScoreAccuracy {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  scoreRange: { min: number; max: number };
  
  totalTokens: number;
  successfulTokens: number;
  failedTokens: number;
  
  actualSuccessRate: number;
  expectedSuccessRate: number;
  calibrationError: number;
  
  avgReturn: number;
  avgPeakMultiplier: number;
}

export interface FeatureImportance {
  feature: string;
  importance: number;
  correlation: number;
  description: string;
}

export interface RiskDistribution {
  scoreRange: string;
  count: number;
  percentage: number;
  avgOutcome: string;
}

export interface ThresholdOptimization {
  threshold: number;
  precision: number;
  recall: number;
  f1Score: number;
  accuracy: number;
}

export interface CalibrationCurve {
  predictedProbability: number;
  actualProbability: number;
  sampleSize: number;
}

class RiskAnalytics {
  /**
   * Validate risk score accuracy by risk level
   */
  async getRiskScoreAccuracy(): Promise<RiskScoreAccuracy[]> {
    try {
      const riskLevels: Array<{
        level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
        min: number;
        max: number;
        expected: number;
      }> = [
        { level: 'CRITICAL', min: 0, max: 30, expected: 10 },
        { level: 'HIGH', min: 30, max: 50, expected: 30 },
        { level: 'MEDIUM', min: 50, max: 70, expected: 55 },
        { level: 'LOW', min: 70, max: 100, expected: 85 },
      ];

      const accuracyResults: RiskScoreAccuracy[] = [];

      for (const level of riskLevels) {
        // Get all tokens in this risk range
        const tokens = database.all<any>(
          `SELECT 
            ta.risk_score,
            to2.outcome_type,
            to2.max_price,
            to2.initial_price,
            to2.price_change_24h
           FROM token_analysis ta
           LEFT JOIN token_outcomes_v2 to2 ON ta.mint = to2.token_mint
           WHERE ta.risk_score >= ? AND ta.risk_score < ?
           AND to2.outcome_type IS NOT NULL`,
          [level.min, level.max]
        );

        if (tokens.length === 0) {
          accuracyResults.push({
            riskLevel: level.level,
            scoreRange: { min: level.min, max: level.max },
            totalTokens: 0,
            successfulTokens: 0,
            failedTokens: 0,
            actualSuccessRate: 0,
            expectedSuccessRate: level.expected,
            calibrationError: 0,
            avgReturn: 0,
            avgPeakMultiplier: 0,
          });
          continue;
        }

        const successfulTokens = tokens.filter(t => 
          t.outcome_type === 'moon' || t.outcome_type === 'pump'
        );

        const failedTokens = tokens.filter(t => 
          t.outcome_type === 'rug' || t.outcome_type === 'decline'
        );

        const actualSuccessRate = (successfulTokens.length / tokens.length) * 100;
        const calibrationError = Math.abs(actualSuccessRate - level.expected);

        // Calculate average returns
        const returns = tokens
          .filter(t => t.max_price && t.initial_price)
          .map(t => ((t.max_price / t.initial_price) - 1) * 100);

        const avgReturn = returns.length > 0
          ? returns.reduce((sum, r) => sum + r, 0) / returns.length
          : 0;

        const multipliers = tokens
          .filter(t => t.max_price && t.initial_price)
          .map(t => t.max_price / t.initial_price);

        const avgPeakMultiplier = multipliers.length > 0
          ? multipliers.reduce((sum, m) => sum + m, 0) / multipliers.length
          : 0;

        accuracyResults.push({
          riskLevel: level.level,
          scoreRange: { min: level.min, max: level.max },
          totalTokens: tokens.length,
          successfulTokens: successfulTokens.length,
          failedTokens: failedTokens.length,
          actualSuccessRate,
          expectedSuccessRate: level.expected,
          calibrationError,
          avgReturn,
          avgPeakMultiplier,
        });
      }

      return accuracyResults;
    } catch (error) {
      logger.error('RiskAnalytics', 'Failed to get risk score accuracy', error);
      return [];
    }
  }

  /**
   * Calculate feature importance for risk scoring
   */
  async getFeatureImportance(): Promise<FeatureImportance[]> {
    try {
      // Key features used in risk scoring
      const features = [
        { name: 'liquidity_usd', description: 'Token liquidity in USD' },
        { name: 'lp_burned_percent', description: 'Percentage of LP burned' },
        { name: 'lp_locked_percent', description: 'Percentage of LP locked' },
        { name: 'mint_revoked', description: 'Mint authority revoked' },
        { name: 'freeze_revoked', description: 'Freeze authority revoked' },
        { name: 'top10_percent', description: 'Top 10 holders ownership %' },
        { name: 'total_holders', description: 'Total number of holders' },
        { name: 'is_honeypot', description: 'Honeypot detection' },
        { name: 'has_transfer_fee', description: 'Transfer fee present' },
        { name: 'has_twitter', description: 'Has Twitter presence' },
        { name: 'has_telegram', description: 'Has Telegram channel' },
      ];

      const featureImportance: FeatureImportance[] = [];

      for (const feature of features) {
        // Calculate correlation with success
        const correlation = await this.calculateFeatureCorrelation(feature.name);

        // Estimate importance (simplified - based on correlation strength)
        const importance = Math.abs(correlation) * 100;

        featureImportance.push({
          feature: feature.name,
          importance,
          correlation,
          description: feature.description,
        });
      }

      // Sort by importance descending
      featureImportance.sort((a, b) => b.importance - a.importance);

      return featureImportance;
    } catch (error) {
      logger.error('RiskAnalytics', 'Failed to get feature importance', error);
      return [];
    }
  }

  /**
   * Get distribution of risk scores
   */
  async getRiskDistribution(): Promise<RiskDistribution[]> {
    try {
      const scoreRanges = [
        { min: 0, max: 20, label: '0-20' },
        { min: 20, max: 40, label: '20-40' },
        { min: 40, max: 60, label: '40-60' },
        { min: 60, max: 80, label: '60-80' },
        { min: 80, max: 100, label: '80-100' },
      ];

      const totalTokens = database.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM token_analysis WHERE risk_score IS NOT NULL'
      )?.count || 0;

      const distribution: RiskDistribution[] = [];

      for (const range of scoreRanges) {
        const tokens = database.all<any>(
          `SELECT ta.risk_score, to2.outcome_type
           FROM token_analysis ta
           LEFT JOIN token_outcomes_v2 to2 ON ta.mint = to2.token_mint
           WHERE ta.risk_score >= ? AND ta.risk_score < ?`,
          [range.min, range.max]
        );

        const count = tokens.length;
        const percentage = totalTokens > 0 ? (count / totalTokens) * 100 : 0;

        // Determine average outcome
        const outcomes = tokens.filter(t => t.outcome_type).map(t => t.outcome_type);
        const successCount = outcomes.filter(o => o === 'moon' || o === 'pump').length;
        const rugCount = outcomes.filter(o => o === 'rug').length;

        let avgOutcome = 'Unknown';
        if (outcomes.length > 0) {
          if (successCount > rugCount) {
            avgOutcome = 'Success';
          } else if (rugCount > successCount) {
            avgOutcome = 'Rug';
          } else {
            avgOutcome = 'Mixed';
          }
        }

        distribution.push({
          scoreRange: range.label,
          count,
          percentage,
          avgOutcome,
        });
      }

      return distribution;
    } catch (error) {
      logger.error('RiskAnalytics', 'Failed to get risk distribution', error);
      return [];
    }
  }

  /**
   * Find optimal threshold for risk score cutoff
   */
  async getOptimalThresholds(): Promise<ThresholdOptimization[]> {
    try {
      const tokens = database.all<any>(
        `SELECT ta.risk_score, to2.outcome_type
         FROM token_analysis ta
         LEFT JOIN token_outcomes_v2 to2 ON ta.mint = to2.token_mint
         WHERE ta.risk_score IS NOT NULL
         AND to2.outcome_type IS NOT NULL`
      );

      if (tokens.length === 0) return [];

      const thresholds: ThresholdOptimization[] = [];

      // Test thresholds from 50 to 90
      for (let threshold = 50; threshold <= 90; threshold += 5) {
        const predictedPositive = tokens.filter(t => t.risk_score >= threshold);
        const predictedNegative = tokens.filter(t => t.risk_score < threshold);

        const actualPositive = tokens.filter(t => 
          t.outcome_type === 'moon' || t.outcome_type === 'pump'
        );

        const actualNegative = tokens.filter(t => 
          t.outcome_type === 'rug' || t.outcome_type === 'decline'
        );

        // Calculate confusion matrix
        const truePositives = predictedPositive.filter(t => 
          t.outcome_type === 'moon' || t.outcome_type === 'pump'
        ).length;

        const falsePositives = predictedPositive.filter(t => 
          t.outcome_type === 'rug' || t.outcome_type === 'decline'
        ).length;

        const trueNegatives = predictedNegative.filter(t => 
          t.outcome_type === 'rug' || t.outcome_type === 'decline'
        ).length;

        const falseNegatives = predictedNegative.filter(t => 
          t.outcome_type === 'moon' || t.outcome_type === 'pump'
        ).length;

        // Calculate metrics
        const precision = (truePositives + falsePositives) > 0
          ? (truePositives / (truePositives + falsePositives)) * 100
          : 0;

        const recall = (truePositives + falseNegatives) > 0
          ? (truePositives / (truePositives + falseNegatives)) * 100
          : 0;

        const f1Score = (precision + recall) > 0
          ? (2 * precision * recall) / (precision + recall)
          : 0;

        const accuracy = tokens.length > 0
          ? ((truePositives + trueNegatives) / tokens.length) * 100
          : 0;

        thresholds.push({
          threshold,
          precision,
          recall,
          f1Score,
          accuracy,
        });
      }

      // Sort by F1 score
      thresholds.sort((a, b) => b.f1Score - a.f1Score);

      return thresholds;
    } catch (error) {
      logger.error('RiskAnalytics', 'Failed to get optimal thresholds', error);
      return [];
    }
  }

  /**
   * Get calibration curve (predicted vs actual probabilities)
   */
  async getCalibrationCurve(): Promise<CalibrationCurve[]> {
    try {
      const tokens = database.all<any>(
        `SELECT ta.risk_score, to2.outcome_type
         FROM token_analysis ta
         LEFT JOIN token_outcomes_v2 to2 ON ta.mint = to2.token_mint
         WHERE ta.risk_score IS NOT NULL
         AND to2.outcome_type IS NOT NULL`
      );

      if (tokens.length === 0) return [];

      // Group tokens by risk score bins
      const bins = [
        { min: 0, max: 20, predicted: 10 },
        { min: 20, max: 40, predicted: 30 },
        { min: 40, max: 60, predicted: 50 },
        { min: 60, max: 80, predicted: 70 },
        { min: 80, max: 100, predicted: 90 },
      ];

      const calibrationCurve: CalibrationCurve[] = [];

      for (const bin of bins) {
        const binTokens = tokens.filter(t => 
          t.risk_score >= bin.min && t.risk_score < bin.max
        );

        if (binTokens.length === 0) continue;

        const successCount = binTokens.filter(t => 
          t.outcome_type === 'moon' || t.outcome_type === 'pump'
        ).length;

        const actualProbability = (successCount / binTokens.length) * 100;

        calibrationCurve.push({
          predictedProbability: bin.predicted,
          actualProbability,
          sampleSize: binTokens.length,
        });
      }

      return calibrationCurve;
    } catch (error) {
      logger.error('RiskAnalytics', 'Failed to get calibration curve', error);
      return [];
    }
  }

  /**
   * Get overall risk score validation summary
   */
  async getRiskValidationSummary(): Promise<{
    overallAccuracy: number;
    avgCalibrationError: number;
    optimalThreshold: number;
    totalSamples: number;
    wellCalibratedRanges: number;
  }> {
    try {
      const accuracyResults = await this.getRiskScoreAccuracy();
      const thresholds = await this.getOptimalThresholds();

      if (accuracyResults.length === 0) {
        return {
          overallAccuracy: 0,
          avgCalibrationError: 0,
          optimalThreshold: 70,
          totalSamples: 0,
          wellCalibratedRanges: 0,
        };
      }

      const totalSamples = accuracyResults.reduce((sum, r) => sum + r.totalTokens, 0);

      const weightedAccuracy = accuracyResults.reduce((sum, r) => {
        const weight = r.totalTokens / totalSamples;
        return sum + (r.actualSuccessRate * weight);
      }, 0);

      const avgCalibrationError = accuracyResults.reduce((sum, r) => 
        sum + r.calibrationError, 0
      ) / accuracyResults.length;

      const wellCalibratedRanges = accuracyResults.filter(r => 
        r.calibrationError < 15 // Within 15% of expected
      ).length;

      const optimalThreshold = thresholds.length > 0 ? thresholds[0].threshold : 70;

      return {
        overallAccuracy: weightedAccuracy,
        avgCalibrationError,
        optimalThreshold,
        totalSamples,
        wellCalibratedRanges,
      };
    } catch (error) {
      logger.error('RiskAnalytics', 'Failed to get risk validation summary', error);
      return {
        overallAccuracy: 0,
        avgCalibrationError: 0,
        optimalThreshold: 70,
        totalSamples: 0,
        wellCalibratedRanges: 0,
      };
    }
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Calculate correlation between a feature and success
   */
  private async calculateFeatureCorrelation(featureName: string): Promise<number> {
    try {
      const tokens = database.all<any>(
        `SELECT ta.${featureName} as feature_value, to2.outcome_type
         FROM token_analysis ta
         LEFT JOIN token_outcomes_v2 to2 ON ta.mint = to2.token_mint
         WHERE ta.${featureName} IS NOT NULL
         AND to2.outcome_type IS NOT NULL`
      );

      if (tokens.length < 10) return 0;

      // Calculate correlation (simplified)
      const successes = tokens.filter(t => 
        t.outcome_type === 'moon' || t.outcome_type === 'pump'
      );

      const avgFeatureSuccess = successes.reduce((sum, t) => {
        const val = typeof t.feature_value === 'boolean' 
          ? (t.feature_value ? 1 : 0) 
          : (t.feature_value || 0);
        return sum + val;
      }, 0) / successes.length;

      const avgFeatureAll = tokens.reduce((sum, t) => {
        const val = typeof t.feature_value === 'boolean' 
          ? (t.feature_value ? 1 : 0) 
          : (t.feature_value || 0);
        return sum + val;
      }, 0) / tokens.length;

      // Positive correlation if successful tokens have higher feature values
      const correlation = (avgFeatureSuccess - avgFeatureAll) / (avgFeatureAll || 1);

      return Math.max(-1, Math.min(1, correlation)); // Clamp to [-1, 1]
    } catch (error) {
      logger.silentError('RiskAnalytics', `Failed to calculate correlation for ${featureName}`, error);
      return 0;
    }
  }
}

export const riskAnalytics = new RiskAnalytics();
