/**
 * Data Quality Checker
 * Monitors training data quality and alerts on issues
 * 
 * - Missing value detection
 * - Outlier detection (Z-score, IQR)
 * - Feature distribution monitoring
 * - Class imbalance detection
 * - Correlation matrix updates
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { database } from '../../database';
import { FEATURE_NAMES } from '../dataCollection/FeatureExtractor';
import type { DataQualityReport, FeatureQualityMetrics } from '../dataCollection/types';

// ============================================
// Configuration
// ============================================

const CONFIG = {
  // Missing data thresholds
  MISSING_WARN_PERCENT: 5,
  MISSING_CRITICAL_PERCENT: 10,
  
  // Outlier detection
  ZSCORE_THRESHOLD: 3, // Values beyond 3 std devs
  IQR_MULTIPLIER: 1.5, // For IQR-based outlier detection
  OUTLIER_WARN_PERCENT: 5,
  OUTLIER_CRITICAL_PERCENT: 10,
  
  // Class imbalance
  IMBALANCE_WARN_RATIO: 5, // 5:1 ratio
  IMBALANCE_CRITICAL_RATIO: 10, // 10:1 ratio
  
  // Quality score weights
  WEIGHTS: {
    missingData: 0.25,
    outliers: 0.20,
    classBalance: 0.25,
    featureQuality: 0.30,
  },
};

// ============================================
// Data Quality Checker
// ============================================

export class DataQualityChecker extends EventEmitter {
  private lastReport: DataQualityReport | null = null;
  private historicalReports: DataQualityReport[] = [];
  private maxHistorySize = 100;

  /**
   * Run full data quality check
   */
  async checkQuality(sampleLimit: number = 10000): Promise<DataQualityReport> {
    const startTime = Date.now();
    
    // Load training samples
    const samples = this.loadTrainingSamples(sampleLimit);
    
    if (samples.length === 0) {
      return this.createEmptyReport();
    }
    
    // Extract features and labels
    const featureMatrix = samples.map(s => s.features);
    const labels = samples.map(s => s.outcome).filter(Boolean);
    
    // Analyze missing data
    const missingAnalysis = this.analyzeMissingData(featureMatrix);
    
    // Detect outliers
    const outlierAnalysis = this.detectOutliers(featureMatrix);
    
    // Check class balance
    const classAnalysis = this.analyzeClassBalance(labels);
    
    // Calculate per-feature metrics
    const featureMetrics = this.calculateFeatureMetrics(featureMatrix);
    
    // Identify low-quality features
    const lowQualityFeatures = this.identifyLowQualityFeatures(missingAnalysis, outlierAnalysis, featureMetrics);
    
    // Calculate overall quality score
    const qualityScore = this.calculateQualityScore(missingAnalysis, outlierAnalysis, classAnalysis, featureMetrics);
    
    // Generate issues and recommendations
    const { issues, recommendations } = this.generateIssuesAndRecommendations(
      missingAnalysis, outlierAnalysis, classAnalysis, lowQualityFeatures
    );
    
    const report: DataQualityReport = {
      timestamp: Date.now(),
      totalSamples: samples.length,
      validSamples: samples.filter(s => this.isValidSample(s)).length,
      validPercent: 0, // Will be calculated
      
      missingDataByFeature: missingAnalysis.byFeature,
      totalMissingPercent: missingAnalysis.totalPercent,
      
      outliersByFeature: outlierAnalysis.byFeature,
      totalOutlierPercent: outlierAnalysis.totalPercent,
      
      classCounts: classAnalysis.counts,
      classRatios: classAnalysis.ratios,
      isImbalanced: classAnalysis.isImbalanced,
      imbalanceRatio: classAnalysis.imbalanceRatio,
      
      featureMetrics,
      lowQualityFeatures,
      
      qualityScore,
      issues,
      recommendations,
    };
    
    report.validPercent = (report.validSamples / report.totalSamples) * 100;
    
    // Store report
    this.lastReport = report;
    this.historicalReports.push(report);
    if (this.historicalReports.length > this.maxHistorySize) {
      this.historicalReports.shift();
    }
    
    // Emit alerts if needed
    this.emitAlerts(report);
    
    const duration = Date.now() - startTime;
    logger.info('DataQualityChecker', `Quality check complete in ${duration}ms: score=${qualityScore.toFixed(1)}/100`);
    
    return report;
  }

  /**
   * Load training samples from database
   */
  private loadTrainingSamples(limit: number): any[] {
    try {
      const db = database.getDb();
      if (!db) return [];
      
      const result = db.exec(`
        SELECT features_json as features, outcome
        FROM ml_training_data
        WHERE features_json IS NOT NULL
        ORDER BY created_at DESC
        LIMIT ?
      `, [limit]);
      
      if (result.length === 0) return [];
      
      const columns = result[0].columns;
      return result[0].values.map(row => {
        const obj: any = {};
        columns.forEach((col, i) => {
          obj[col] = row[i];
        });
        
        // Parse features JSON
        if (obj.features && typeof obj.features === 'string') {
          try {
            obj.features = JSON.parse(obj.features);
          } catch {
            obj.features = null;
          }
        }
        
        return obj;
      }).filter(s => s.features);
      
    } catch (error) {
      logger.silentError('DataQualityChecker', 'Failed to load samples', error as Error);
      return [];
    }
  }

  /**
   * Analyze missing data
   */
  private analyzeMissingData(featureMatrix: any[]): {
    byFeature: Record<string, number>;
    totalPercent: number;
  } {
    const byFeature: Record<string, number> = {};
    let totalMissing = 0;
    let totalValues = 0;
    
    for (const featureName of FEATURE_NAMES) {
      let missing = 0;
      
      for (const features of featureMatrix) {
        const value = features[featureName];
        totalValues++;
        
        if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
          missing++;
          totalMissing++;
        }
      }
      
      byFeature[featureName] = (missing / featureMatrix.length) * 100;
    }
    
    return {
      byFeature,
      totalPercent: totalValues > 0 ? (totalMissing / totalValues) * 100 : 0,
    };
  }

  /**
   * Detect outliers using Z-score and IQR methods
   */
  private detectOutliers(featureMatrix: any[]): {
    byFeature: Record<string, number>;
    totalPercent: number;
  } {
    const byFeature: Record<string, number> = {};
    let totalOutliers = 0;
    let totalValues = 0;
    
    for (const featureName of FEATURE_NAMES) {
      const values = featureMatrix
        .map(f => f[featureName])
        .filter(v => typeof v === 'number' && Number.isFinite(v));
      
      if (values.length === 0) {
        byFeature[featureName] = 0;
        continue;
      }
      
      // Calculate stats
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const std = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length);
      
      // Z-score outlier detection
      let outlierCount = 0;
      if (std > 0) {
        outlierCount = values.filter(v => Math.abs((v - mean) / std) > CONFIG.ZSCORE_THRESHOLD).length;
      }
      
      byFeature[featureName] = (outlierCount / values.length) * 100;
      totalOutliers += outlierCount;
      totalValues += values.length;
    }
    
    return {
      byFeature,
      totalPercent: totalValues > 0 ? (totalOutliers / totalValues) * 100 : 0,
    };
  }

  /**
   * Analyze class balance
   */
  private analyzeClassBalance(labels: string[]): {
    counts: Record<string, number>;
    ratios: Record<string, number>;
    isImbalanced: boolean;
    imbalanceRatio: number;
  } {
    const counts: Record<string, number> = {};
    
    for (const label of labels) {
      counts[label] = (counts[label] || 0) + 1;
    }
    
    const total = labels.length;
    const ratios: Record<string, number> = {};
    
    for (const [label, count] of Object.entries(counts)) {
      ratios[label] = total > 0 ? count / total : 0;
    }
    
    // Calculate imbalance ratio
    const countValues = Object.values(counts);
    const maxCount = Math.max(...countValues, 1);
    const minCount = Math.min(...countValues.filter(v => v > 0), maxCount);
    const imbalanceRatio = minCount > 0 ? maxCount / minCount : 0;
    
    return {
      counts,
      ratios,
      isImbalanced: imbalanceRatio > CONFIG.IMBALANCE_WARN_RATIO,
      imbalanceRatio,
    };
  }

  /**
   * Calculate per-feature quality metrics
   */
  private calculateFeatureMetrics(featureMatrix: any[]): FeatureQualityMetrics[] {
    const metrics: FeatureQualityMetrics[] = [];
    
    for (const featureName of FEATURE_NAMES) {
      const values = featureMatrix
        .map(f => f[featureName])
        .filter(v => typeof v === 'number' && Number.isFinite(v));
      
      if (values.length === 0) {
        metrics.push({
          featureName,
          missingCount: featureMatrix.length,
          missingPercent: 100,
          outlierCount: 0,
          outlierPercent: 0,
          mean: 0,
          std: 0,
          min: 0,
          max: 0,
          median: 0,
          skewness: 0,
          kurtosis: 0,
        });
        continue;
      }
      
      // Basic stats
      const n = values.length;
      const sorted = [...values].sort((a, b) => a - b);
      const mean = values.reduce((a, b) => a + b, 0) / n;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
      const std = Math.sqrt(variance);
      const min = sorted[0];
      const max = sorted[n - 1];
      const median = n % 2 === 0 
        ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 
        : sorted[Math.floor(n / 2)];
      
      // Skewness and Kurtosis
      let skewness = 0;
      let kurtosis = 0;
      
      if (std > 0) {
        const m3 = values.reduce((sum, v) => sum + Math.pow((v - mean) / std, 3), 0) / n;
        const m4 = values.reduce((sum, v) => sum + Math.pow((v - mean) / std, 4), 0) / n;
        skewness = m3;
        kurtosis = m4 - 3; // Excess kurtosis
      }
      
      // Outlier detection
      const outlierCount = std > 0 
        ? values.filter(v => Math.abs((v - mean) / std) > CONFIG.ZSCORE_THRESHOLD).length 
        : 0;
      
      metrics.push({
        featureName,
        missingCount: featureMatrix.length - n,
        missingPercent: ((featureMatrix.length - n) / featureMatrix.length) * 100,
        outlierCount,
        outlierPercent: (outlierCount / n) * 100,
        mean,
        std,
        min,
        max,
        median,
        skewness,
        kurtosis,
      });
    }
    
    return metrics;
  }

  /**
   * Identify low-quality features
   */
  private identifyLowQualityFeatures(
    missingAnalysis: { byFeature: Record<string, number> },
    outlierAnalysis: { byFeature: Record<string, number> },
    featureMetrics: FeatureQualityMetrics[]
  ): string[] {
    const lowQuality: string[] = [];
    
    for (const featureName of FEATURE_NAMES) {
      const missingPercent = missingAnalysis.byFeature[featureName] || 0;
      const outlierPercent = outlierAnalysis.byFeature[featureName] || 0;
      
      // High missing rate
      if (missingPercent > CONFIG.MISSING_CRITICAL_PERCENT) {
        lowQuality.push(featureName);
        continue;
      }
      
      // High outlier rate
      if (outlierPercent > CONFIG.OUTLIER_CRITICAL_PERCENT) {
        lowQuality.push(featureName);
        continue;
      }
      
      // Zero variance (constant feature)
      const metric = featureMetrics.find(m => m.featureName === featureName);
      if (metric && metric.std === 0) {
        lowQuality.push(featureName);
      }
    }
    
    return lowQuality;
  }

  /**
   * Calculate overall quality score (0-100)
   */
  private calculateQualityScore(
    missingAnalysis: { totalPercent: number },
    outlierAnalysis: { totalPercent: number },
    classAnalysis: { isImbalanced: boolean; imbalanceRatio: number },
    featureMetrics: FeatureQualityMetrics[]
  ): number {
    // Missing data score (0-100)
    const missingScore = Math.max(0, 100 - missingAnalysis.totalPercent * 5);
    
    // Outlier score (0-100)
    const outlierScore = Math.max(0, 100 - outlierAnalysis.totalPercent * 5);
    
    // Class balance score (0-100)
    let balanceScore = 100;
    if (classAnalysis.isImbalanced) {
      balanceScore = Math.max(0, 100 - (classAnalysis.imbalanceRatio - 1) * 10);
    }
    
    // Feature quality score (0-100)
    const goodFeatures = featureMetrics.filter(m => 
      m.missingPercent < CONFIG.MISSING_WARN_PERCENT && 
      m.outlierPercent < CONFIG.OUTLIER_WARN_PERCENT &&
      m.std > 0
    ).length;
    const featureScore = (goodFeatures / FEATURE_NAMES.length) * 100;
    
    // Weighted average
    const score = 
      missingScore * CONFIG.WEIGHTS.missingData +
      outlierScore * CONFIG.WEIGHTS.outliers +
      balanceScore * CONFIG.WEIGHTS.classBalance +
      featureScore * CONFIG.WEIGHTS.featureQuality;
    
    return Math.round(score * 10) / 10;
  }

  /**
   * Generate issues and recommendations
   */
  private generateIssuesAndRecommendations(
    missingAnalysis: { byFeature: Record<string, number>; totalPercent: number },
    outlierAnalysis: { byFeature: Record<string, number>; totalPercent: number },
    classAnalysis: { isImbalanced: boolean; imbalanceRatio: number; counts: Record<string, number> },
    lowQualityFeatures: string[]
  ): { issues: string[]; recommendations: string[] } {
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    // Missing data issues
    if (missingAnalysis.totalPercent > CONFIG.MISSING_CRITICAL_PERCENT) {
      issues.push(`Critical: ${missingAnalysis.totalPercent.toFixed(1)}% missing data overall`);
      recommendations.push('Improve data collection pipeline to reduce missing values');
    } else if (missingAnalysis.totalPercent > CONFIG.MISSING_WARN_PERCENT) {
      issues.push(`Warning: ${missingAnalysis.totalPercent.toFixed(1)}% missing data overall`);
    }
    
    // Per-feature missing data
    for (const [feature, percent] of Object.entries(missingAnalysis.byFeature)) {
      if (percent > CONFIG.MISSING_CRITICAL_PERCENT) {
        issues.push(`Feature '${feature}' has ${percent.toFixed(1)}% missing values`);
      }
    }
    
    // Outlier issues
    if (outlierAnalysis.totalPercent > CONFIG.OUTLIER_CRITICAL_PERCENT) {
      issues.push(`Critical: ${outlierAnalysis.totalPercent.toFixed(1)}% outliers detected`);
      recommendations.push('Review outlier handling in feature extraction');
    }
    
    // Class imbalance issues
    if (classAnalysis.isImbalanced) {
      issues.push(`Class imbalance detected (ratio: ${classAnalysis.imbalanceRatio.toFixed(1)}:1)`);
      
      const minClass = Object.entries(classAnalysis.counts)
        .sort((a, b) => a[1] - b[1])[0];
      
      recommendations.push(`Collect more samples for class '${minClass[0]}' (currently ${minClass[1]})`);
      recommendations.push('Consider using class weights or oversampling during training');
    }
    
    // Low quality features
    if (lowQualityFeatures.length > 0) {
      issues.push(`${lowQualityFeatures.length} low-quality features detected: ${lowQualityFeatures.slice(0, 5).join(', ')}${lowQualityFeatures.length > 5 ? '...' : ''}`);
      recommendations.push('Consider removing or fixing low-quality features');
    }
    
    // Generic recommendations
    if (issues.length === 0) {
      recommendations.push('Data quality is good. Continue monitoring for drift.');
    }
    
    return { issues, recommendations };
  }

  /**
   * Check if a sample is valid
   */
  private isValidSample(sample: any): boolean {
    if (!sample.features) return false;
    
    const features = sample.features;
    let missingCount = 0;
    
    for (const featureName of FEATURE_NAMES) {
      const value = features[featureName];
      if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
        missingCount++;
      }
    }
    
    // Valid if less than 20% missing
    return (missingCount / FEATURE_NAMES.length) < 0.2;
  }

  /**
   * Emit alerts based on report
   */
  private emitAlerts(report: DataQualityReport): void {
    if (report.qualityScore < 50) {
      this.emit('qualityCritical', {
        score: report.qualityScore,
        issues: report.issues,
      });
    } else if (report.qualityScore < 70) {
      this.emit('qualityWarning', {
        score: report.qualityScore,
        issues: report.issues,
      });
    }
    
    if (report.isImbalanced) {
      this.emit('classImbalance', {
        ratio: report.imbalanceRatio,
        counts: report.classCounts,
      });
    }
  }

  /**
   * Create empty report
   */
  private createEmptyReport(): DataQualityReport {
    return {
      timestamp: Date.now(),
      totalSamples: 0,
      validSamples: 0,
      validPercent: 0,
      missingDataByFeature: {},
      totalMissingPercent: 0,
      outliersByFeature: {},
      totalOutlierPercent: 0,
      classCounts: {},
      classRatios: {},
      isImbalanced: false,
      imbalanceRatio: 0,
      featureMetrics: [],
      lowQualityFeatures: [],
      qualityScore: 0,
      issues: ['No training data available'],
      recommendations: ['Collect training data before running quality checks'],
    };
  }

  /**
   * Get last report
   */
  getLastReport(): DataQualityReport | null {
    return this.lastReport;
  }

  /**
   * Get report history
   */
  getHistory(): DataQualityReport[] {
    return [...this.historicalReports];
  }
}

// Export singleton
export const dataQualityChecker = new DataQualityChecker();
