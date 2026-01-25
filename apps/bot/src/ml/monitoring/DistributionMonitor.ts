/**
 * Distribution Monitor
 * Detects concept drift by tracking feature distribution changes over time
 * 
 * - Tracks feature distributions over time
 * - Detects distribution shifts (concept drift)
 * - Alerts when training data ≠ production data
 * - Suggests retraining when drift is detected
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { database } from '../../database';
import { FEATURE_NAMES } from '../dataCollection/FeatureExtractor';
import type { DistributionSnapshot, DriftReport } from '../dataCollection/types';

// ============================================
// Configuration
// ============================================

const CONFIG = {
  // Drift detection thresholds
  DRIFT_THRESHOLD_LOW: 0.1,
  DRIFT_THRESHOLD_MEDIUM: 0.25,
  DRIFT_THRESHOLD_HIGH: 0.4,
  DRIFT_THRESHOLD_CRITICAL: 0.6,
  
  // Statistical significance
  MIN_SAMPLES_FOR_COMPARISON: 100,
  COMPARISON_PERIOD_DAYS: 7,
  
  // Alert thresholds
  DRIFTED_FEATURES_WARN: 3,
  DRIFTED_FEATURES_CRITICAL: 7,
  
  // History
  MAX_SNAPSHOTS_PER_FEATURE: 30, // Keep 30 days of daily snapshots
};

// ============================================
// Distribution Monitor
// ============================================

export class DistributionMonitor extends EventEmitter {
  private baselineSnapshots: Map<string, DistributionSnapshot> = new Map();
  private historicalSnapshots: Map<string, DistributionSnapshot[]> = new Map();
  private lastDriftReport: DriftReport | null = null;

  /**
   * Initialize with baseline distributions
   */
  async initialize(): Promise<void> {
    await this.loadBaselines();
    logger.info('DistributionMonitor', `Initialized with ${this.baselineSnapshots.size} baseline distributions`);
  }

  /**
   * Load baseline distributions from database
   */
  private async loadBaselines(): Promise<void> {
    try {
      const db = database.getDb();
      if (!db) return;
      
      // Try to load saved baselines
      const result = db.exec(`
        SELECT * FROM feature_distribution_baselines
        ORDER BY timestamp DESC
        LIMIT ${FEATURE_NAMES.length}
      `);
      
      if (result.length > 0) {
        const columns = result[0].columns;
        for (const row of result[0].values) {
          const record: any = {};
          columns.forEach((col, i) => {
            record[col] = row[i];
          });
          
          if (record.feature_name && record.mean !== undefined) {
            this.baselineSnapshots.set(record.feature_name, {
              featureName: record.feature_name,
              timestamp: record.timestamp * 1000,
              mean: record.mean,
              std: record.std,
              percentiles: JSON.parse(record.percentiles || '[]'),
              histogram: JSON.parse(record.histogram || '[]'),
            });
          }
        }
      }
      
      // If no baselines, calculate from current data
      if (this.baselineSnapshots.size === 0) {
        await this.calculateBaselines();
      }
      
    } catch (error) {
      logger.silentError('DistributionMonitor', 'Failed to load baselines', error as Error);
      // Calculate baselines from scratch
      await this.calculateBaselines();
    }
  }

  /**
   * Calculate baseline distributions from current training data
   */
  async calculateBaselines(): Promise<void> {
    try {
      const samples = this.loadRecentSamples(5000); // Use last 5000 samples
      
      if (samples.length < CONFIG.MIN_SAMPLES_FOR_COMPARISON) {
        logger.warn('DistributionMonitor', `Not enough samples for baselines: ${samples.length}`);
        return;
      }
      
      const now = Date.now();
      
      for (const featureName of FEATURE_NAMES) {
        const values = samples
          .map(s => s.features?.[featureName])
          .filter(v => typeof v === 'number' && Number.isFinite(v));
        
        if (values.length === 0) continue;
        
        const snapshot = this.calculateDistributionSnapshot(featureName, values, now);
        this.baselineSnapshots.set(featureName, snapshot);
      }
      
      // Save baselines
      await this.saveBaselines();
      
      logger.info('DistributionMonitor', `Calculated baselines for ${this.baselineSnapshots.size} features`);
      
    } catch (error) {
      logger.silentError('DistributionMonitor', 'Failed to calculate baselines', error as Error);
    }
  }

  /**
   * Calculate distribution snapshot for a feature
   */
  private calculateDistributionSnapshot(
    featureName: string, 
    values: number[], 
    timestamp: number
  ): DistributionSnapshot {
    const n = values.length;
    const sorted = [...values].sort((a, b) => a - b);
    
    // Mean and std
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n);
    
    // Percentiles
    const percentiles = [
      sorted[Math.floor(n * 0.05)], // p5
      sorted[Math.floor(n * 0.25)], // p25
      sorted[Math.floor(n * 0.50)], // p50 (median)
      sorted[Math.floor(n * 0.75)], // p75
      sorted[Math.floor(n * 0.95)], // p95
    ];
    
    // Histogram (10 bins)
    const min = sorted[0];
    const max = sorted[n - 1];
    const binWidth = (max - min) / 10 || 1;
    const histogram: { bin: number; count: number }[] = [];
    
    for (let i = 0; i < 10; i++) {
      const binStart = min + i * binWidth;
      const binEnd = binStart + binWidth;
      const count = values.filter(v => v >= binStart && (i === 9 ? v <= binEnd : v < binEnd)).length;
      histogram.push({ bin: binStart, count });
    }
    
    return {
      featureName,
      timestamp,
      mean,
      std,
      percentiles,
      histogram,
    };
  }

  /**
   * Check for distribution drift
   */
  async checkDrift(comparisonPeriodDays: number = CONFIG.COMPARISON_PERIOD_DAYS): Promise<DriftReport> {
    const startTime = Date.now();
    
    // Load recent samples (last N days)
    const cutoffTimestamp = startTime - (comparisonPeriodDays * 24 * 60 * 60 * 1000);
    const recentSamples = this.loadRecentSamples(5000, cutoffTimestamp);
    
    if (recentSamples.length < CONFIG.MIN_SAMPLES_FOR_COMPARISON) {
      return this.createEmptyDriftReport(comparisonPeriodDays, 'Insufficient recent samples');
    }
    
    const featureDrift: DriftReport['featureDrift'] = [];
    
    for (const featureName of FEATURE_NAMES) {
      const baseline = this.baselineSnapshots.get(featureName);
      if (!baseline) continue;
      
      const values = recentSamples
        .map(s => s.features?.[featureName])
        .filter(v => typeof v === 'number' && Number.isFinite(v));
      
      if (values.length === 0) continue;
      
      const currentSnapshot = this.calculateDistributionSnapshot(featureName, values, startTime);
      
      // Calculate drift score
      const driftScore = this.calculateDriftScore(baseline, currentSnapshot);
      const driftType = this.classifyDriftType(baseline, currentSnapshot);
      const significance = this.classifySignificance(driftScore);
      
      featureDrift.push({
        featureName,
        driftScore,
        driftType,
        significance,
        currentMean: currentSnapshot.mean,
        baselineMean: baseline.mean,
        currentStd: currentSnapshot.std,
        baselineStd: baseline.std,
        pValue: this.calculatePValue(baseline, currentSnapshot, values.length),
      });
      
      // Store historical snapshot
      this.storeHistoricalSnapshot(featureName, currentSnapshot);
    }
    
    // Calculate overall drift
    const driftedFeatures = featureDrift.filter(f => f.significance !== 'low');
    const overallDriftScore = featureDrift.length > 0
      ? featureDrift.reduce((sum, f) => sum + f.driftScore, 0) / featureDrift.length
      : 0;
    
    // Determine urgency
    const criticalCount = featureDrift.filter(f => f.significance === 'critical').length;
    const highCount = featureDrift.filter(f => f.significance === 'high').length;
    
    let urgency: DriftReport['urgency'] = 'none';
    if (criticalCount >= 3 || overallDriftScore > CONFIG.DRIFT_THRESHOLD_CRITICAL) {
      urgency = 'critical';
    } else if (criticalCount >= 1 || highCount >= 3 || overallDriftScore > CONFIG.DRIFT_THRESHOLD_HIGH) {
      urgency = 'high';
    } else if (highCount >= 1 || driftedFeatures.length >= CONFIG.DRIFTED_FEATURES_WARN) {
      urgency = 'medium';
    } else if (driftedFeatures.length > 0) {
      urgency = 'low';
    }
    
    const retrainingRecommended = urgency === 'high' || urgency === 'critical';
    
    // Generate suggested actions
    const suggestedActions = this.generateSuggestedActions(featureDrift, urgency);
    
    const report: DriftReport = {
      timestamp: startTime,
      comparisonPeriodDays,
      featureDrift,
      overallDriftScore,
      driftedFeatureCount: driftedFeatures.length,
      retrainingRecommended,
      urgency,
      suggestedActions,
    };
    
    this.lastDriftReport = report;
    
    // Emit alerts
    this.emitDriftAlerts(report);
    
    const duration = Date.now() - startTime;
    logger.info('DistributionMonitor', 
      `Drift check complete in ${duration}ms: score=${overallDriftScore.toFixed(3)}, drifted=${driftedFeatures.length}, urgency=${urgency}`
    );
    
    return report;
  }

  /**
   * Calculate drift score using Jensen-Shannon divergence approximation
   */
  private calculateDriftScore(baseline: DistributionSnapshot, current: DistributionSnapshot): number {
    // Combine mean shift and std change
    const meanShift = baseline.mean !== 0 
      ? Math.abs(current.mean - baseline.mean) / Math.abs(baseline.mean)
      : Math.abs(current.mean - baseline.mean);
    
    const stdChange = baseline.std > 0 
      ? Math.abs(current.std - baseline.std) / baseline.std
      : Math.abs(current.std - baseline.std);
    
    // Compare histogram distributions
    let histogramDivergence = 0;
    if (baseline.histogram.length === current.histogram.length) {
      const totalBaseline = baseline.histogram.reduce((sum, h) => sum + h.count, 0);
      const totalCurrent = current.histogram.reduce((sum, h) => sum + h.count, 0);
      
      for (let i = 0; i < baseline.histogram.length; i++) {
        const p = (baseline.histogram[i].count + 1) / (totalBaseline + baseline.histogram.length);
        const q = (current.histogram[i].count + 1) / (totalCurrent + current.histogram.length);
        const m = (p + q) / 2;
        
        // KL divergence components
        histogramDivergence += 0.5 * (
          p * Math.log(p / m) + 
          q * Math.log(q / m)
        );
      }
    }
    
    // Combined score (weighted)
    const score = 0.4 * Math.min(1, meanShift) + 
                  0.3 * Math.min(1, stdChange) + 
                  0.3 * Math.min(1, histogramDivergence);
    
    return Math.min(1, score);
  }

  /**
   * Classify drift type
   */
  private classifyDriftType(
    baseline: DistributionSnapshot, 
    current: DistributionSnapshot
  ): 'gradual' | 'sudden' | 'seasonal' | 'none' {
    const meanShift = Math.abs(current.mean - baseline.mean) / (baseline.std || 1);
    const stdRatio = baseline.std > 0 ? current.std / baseline.std : 1;
    
    if (meanShift > 2) {
      return 'sudden';
    }
    
    if (meanShift > 0.5 && stdRatio > 0.8 && stdRatio < 1.2) {
      return 'gradual';
    }
    
    if (stdRatio > 1.5 || stdRatio < 0.67) {
      return 'seasonal'; // Variance change might indicate seasonal patterns
    }
    
    return 'none';
  }

  /**
   * Classify significance level
   */
  private classifySignificance(driftScore: number): 'low' | 'medium' | 'high' | 'critical' {
    if (driftScore >= CONFIG.DRIFT_THRESHOLD_CRITICAL) return 'critical';
    if (driftScore >= CONFIG.DRIFT_THRESHOLD_HIGH) return 'high';
    if (driftScore >= CONFIG.DRIFT_THRESHOLD_MEDIUM) return 'medium';
    return 'low';
  }

  /**
   * Calculate approximate p-value using Welch's t-test approximation
   */
  private calculatePValue(
    baseline: DistributionSnapshot, 
    current: DistributionSnapshot,
    n: number
  ): number {
    if (baseline.std === 0 && current.std === 0) return 1;
    
    const se = Math.sqrt((baseline.std ** 2 + current.std ** 2) / n);
    if (se === 0) return 1;
    
    const t = Math.abs(current.mean - baseline.mean) / se;
    
    // Approximate p-value from t-statistic
    // Using simple approximation for demonstration
    const df = n - 1;
    const pValue = Math.exp(-0.5 * t * t) * Math.min(1, 1 / Math.sqrt(df));
    
    return Math.min(1, pValue);
  }

  /**
   * Generate suggested actions based on drift report
   */
  private generateSuggestedActions(
    featureDrift: DriftReport['featureDrift'],
    urgency: DriftReport['urgency']
  ): string[] {
    const actions: string[] = [];
    
    if (urgency === 'critical') {
      actions.push('🚨 CRITICAL: Trigger immediate model retraining');
      actions.push('Pause automated trading signals until model is updated');
    } else if (urgency === 'high') {
      actions.push('⚠️ Schedule model retraining within 24 hours');
      actions.push('Monitor prediction accuracy closely');
    } else if (urgency === 'medium') {
      actions.push('Consider retraining model within the next week');
    }
    
    // Specific feature recommendations
    const criticalFeatures = featureDrift.filter(f => f.significance === 'critical');
    if (criticalFeatures.length > 0) {
      const names = criticalFeatures.slice(0, 3).map(f => f.featureName).join(', ');
      actions.push(`Review feature extraction for: ${names}`);
    }
    
    // Check for systematic shifts
    const allIncreasedMean = featureDrift.filter(f => f.currentMean > f.baselineMean * 1.1);
    const allDecreasedMean = featureDrift.filter(f => f.currentMean < f.baselineMean * 0.9);
    
    if (allIncreasedMean.length > FEATURE_NAMES.length / 2) {
      actions.push('Systematic increase detected across features - check data source');
    }
    if (allDecreasedMean.length > FEATURE_NAMES.length / 2) {
      actions.push('Systematic decrease detected across features - check data source');
    }
    
    if (actions.length === 0) {
      actions.push('✅ No immediate action required - continue monitoring');
    }
    
    return actions;
  }

  /**
   * Store historical snapshot
   */
  private storeHistoricalSnapshot(featureName: string, snapshot: DistributionSnapshot): void {
    if (!this.historicalSnapshots.has(featureName)) {
      this.historicalSnapshots.set(featureName, []);
    }
    
    const history = this.historicalSnapshots.get(featureName)!;
    history.push(snapshot);
    
    // Keep only recent snapshots
    while (history.length > CONFIG.MAX_SNAPSHOTS_PER_FEATURE) {
      history.shift();
    }
  }

  /**
   * Emit drift alerts
   */
  private emitDriftAlerts(report: DriftReport): void {
    if (report.urgency === 'critical') {
      this.emit('driftCritical', report);
    } else if (report.urgency === 'high') {
      this.emit('driftHigh', report);
    } else if (report.retrainingRecommended) {
      this.emit('retrainingRecommended', report);
    }
  }

  /**
   * Create empty drift report
   */
  private createEmptyDriftReport(comparisonPeriodDays: number, reason: string): DriftReport {
    return {
      timestamp: Date.now(),
      comparisonPeriodDays,
      featureDrift: [],
      overallDriftScore: 0,
      driftedFeatureCount: 0,
      retrainingRecommended: false,
      urgency: 'none',
      suggestedActions: [reason],
    };
  }

  /**
   * Load recent samples from database
   */
  private loadRecentSamples(limit: number, sinceTimestamp?: number): any[] {
    try {
      const db = database.getDb();
      if (!db) return [];
      
      let query = `
        SELECT features_json as features
        FROM ml_training_data
        WHERE features_json IS NOT NULL
      `;
      
      const params: any[] = [];
      
      if (sinceTimestamp) {
        query += ` AND created_at >= ?`;
        params.push(Math.floor(sinceTimestamp / 1000));
      }
      
      query += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(limit);
      
      const result = db.exec(query, params);
      
      if (result.length === 0) return [];
      
      return result[0].values.map(row => {
        try {
          return { features: JSON.parse(row[0] as string) };
        } catch {
          return null;
        }
      }).filter(Boolean);
      
    } catch (error) {
      logger.silentError('DistributionMonitor', 'Failed to load samples', error as Error);
      return [];
    }
  }

  /**
   * Save baselines to database
   */
  private async saveBaselines(): Promise<void> {
    try {
      const db = database.getDb();
      if (!db) return;
      
      // Create table if not exists
      db.run(`
        CREATE TABLE IF NOT EXISTS feature_distribution_baselines (
          feature_name TEXT PRIMARY KEY,
          timestamp INTEGER,
          mean REAL,
          std REAL,
          percentiles TEXT,
          histogram TEXT
        )
      `);
      
      for (const [featureName, snapshot] of this.baselineSnapshots) {
        db.run(`
          INSERT OR REPLACE INTO feature_distribution_baselines 
          (feature_name, timestamp, mean, std, percentiles, histogram)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
          featureName,
          Math.floor(snapshot.timestamp / 1000),
          snapshot.mean,
          snapshot.std,
          JSON.stringify(snapshot.percentiles),
          JSON.stringify(snapshot.histogram),
        ]);
      }
      
    } catch (error) {
      logger.silentError('DistributionMonitor', 'Failed to save baselines', error as Error);
    }
  }

  /**
   * Update baselines with current data
   */
  async updateBaselines(): Promise<void> {
    await this.calculateBaselines();
    logger.info('DistributionMonitor', 'Baselines updated');
  }

  /**
   * Get last drift report
   */
  getLastReport(): DriftReport | null {
    return this.lastDriftReport;
  }

  /**
   * Get baseline for a feature
   */
  getBaseline(featureName: string): DistributionSnapshot | undefined {
    return this.baselineSnapshots.get(featureName);
  }

  /**
   * Get historical snapshots for a feature
   */
  getHistory(featureName: string): DistributionSnapshot[] {
    return this.historicalSnapshots.get(featureName) || [];
  }
}

// Export singleton
export const distributionMonitor = new DistributionMonitor();
