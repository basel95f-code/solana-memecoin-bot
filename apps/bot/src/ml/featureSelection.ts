/**
 * Feature Selection Service
 * Analyzes feature importance and identifies low-impact features for removal
 */

import { logger } from '../utils/logger';
import { database } from '../database';
import { FEATURE_NAMES, FEATURE_COUNT } from './featureEngineering';

export interface FeatureImportance {
  featureName: string;
  importance: number;
  rank: number;
  isLowImpact: boolean;
}

export interface FeatureSelectionResult {
  totalFeatures: number;
  analyzedSamples: number;
  importanceScores: FeatureImportance[];
  recommendedFeatures: string[];
  lowImpactFeatures: string[];
  improvementEstimate: number; // Estimated accuracy improvement if low-impact removed
}

/**
 * Feature Selection Service
 * Uses correlation analysis and statistical methods to determine feature importance
 */
class FeatureSelection {
  // Thresholds for feature selection
  private readonly LOW_IMPORTANCE_THRESHOLD = 0.05; // Features below 5% importance
  private readonly MIN_SAMPLES_FOR_ANALYSIS = 100;

  /**
   * Calculate feature importance using correlation with outcome
   * More sophisticated than simple correlation - uses multiple metrics
   */
  async analyzeFeatureImportance(): Promise<FeatureSelectionResult> {
    // Get training samples from database
    const samples = database.getMLTrainingData(10000);

    if (samples.length < this.MIN_SAMPLES_FOR_ANALYSIS) {
      throw new Error(`Need at least ${this.MIN_SAMPLES_FOR_ANALYSIS} samples for feature analysis (got ${samples.length})`);
    }

    logger.info('FeatureSelection', `Analyzing ${samples.length} samples across ${FEATURE_COUNT} features`);

    // Extract features and outcomes
    const features: number[][] = [];
    const outcomes: number[] = [];

    for (const sample of samples) {
      const featureRecord = sample.features as Record<string, number> | null;
      if (!featureRecord) continue;

      const featureArray: number[] = [];
      for (const featureName of FEATURE_NAMES) {
        featureArray.push(featureRecord[featureName] || 0);
      }

      features.push(featureArray);
      outcomes.push(sample.outcome === 'rug' ? 1 : 0);
    }

    // Calculate importance for each feature
    const importanceScores: FeatureImportance[] = [];

    for (let i = 0; i < FEATURE_COUNT; i++) {
      const featureName = FEATURE_NAMES[i];
      const featureValues = features.map(f => f[i]);

      // Calculate multiple importance metrics
      const correlation = this.calculateCorrelation(featureValues, outcomes);
      const variance = this.calculateVariance(featureValues);
      const informationGain = this.calculateInformationGain(featureValues, outcomes);

      // Combined importance score (weighted average)
      const importance = Math.abs(correlation) * 0.5 + variance * 0.2 + informationGain * 0.3;

      importanceScores.push({
        featureName,
        importance,
        rank: 0, // Will be set after sorting
        isLowImpact: importance < this.LOW_IMPORTANCE_THRESHOLD,
      });
    }

    // Sort by importance (descending)
    importanceScores.sort((a, b) => b.importance - a.importance);

    // Assign ranks
    importanceScores.forEach((score, index) => {
      score.rank = index + 1;
    });

    // Identify low-impact features
    const lowImpactFeatures = importanceScores
      .filter(s => s.isLowImpact)
      .map(s => s.featureName);

    // Recommended features (keep high-impact ones)
    const recommendedFeatures = importanceScores
      .filter(s => !s.isLowImpact)
      .map(s => s.featureName);

    // Estimate improvement if low-impact features are removed
    const totalImportance = importanceScores.reduce((sum, s) => sum + s.importance, 0);
    const lowImpactTotalImportance = importanceScores
      .filter(s => s.isLowImpact)
      .reduce((sum, s) => sum + s.importance, 0);

    const improvementEstimate = (lowImpactTotalImportance / totalImportance) * 100;

    const result: FeatureSelectionResult = {
      totalFeatures: FEATURE_COUNT,
      analyzedSamples: samples.length,
      importanceScores,
      recommendedFeatures,
      lowImpactFeatures,
      improvementEstimate,
    };

    // Save to database
    this.saveFeatureImportance(result);

    return result;
  }

  /**
   * Calculate Pearson correlation coefficient
   */
  private calculateCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    if (n === 0) return 0;

    const meanX = x.reduce((sum, val) => sum + val, 0) / n;
    const meanY = y.reduce((sum, val) => sum + val, 0) / n;

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < n; i++) {
      const diffX = x[i] - meanX;
      const diffY = y[i] - meanY;
      numerator += diffX * diffY;
      denomX += diffX * diffX;
      denomY += diffY * diffY;
    }

    if (denomX === 0 || denomY === 0) return 0;

    return numerator / Math.sqrt(denomX * denomY);
  }

  /**
   * Calculate variance (normalized)
   */
  private calculateVariance(values: number[]): number {
    const n = values.length;
    if (n === 0) return 0;

    const mean = values.reduce((sum, val) => sum + val, 0) / n;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;

    // Normalize to 0-1 range
    return Math.min(1, variance * 4); // Scale factor based on typical variance ranges
  }

  /**
   * Calculate information gain (simplified)
   * Measures how much knowing this feature reduces uncertainty about the outcome
   */
  private calculateInformationGain(values: number[], outcomes: number[]): number {
    const n = values.length;
    if (n === 0) return 0;

    // Split into bins (quartiles)
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(n * 0.25)];
    const q2 = sorted[Math.floor(n * 0.5)];
    const q3 = sorted[Math.floor(n * 0.75)];

    // Calculate entropy for each bin
    const bins: { values: number[]; outcomes: number[] }[] = [
      { values: [], outcomes: [] },
      { values: [], outcomes: [] },
      { values: [], outcomes: [] },
      { values: [], outcomes: [] },
    ];

    for (let i = 0; i < n; i++) {
      const val = values[i];
      let binIndex = 0;
      if (val > q3) binIndex = 3;
      else if (val > q2) binIndex = 2;
      else if (val > q1) binIndex = 1;

      bins[binIndex].values.push(val);
      bins[binIndex].outcomes.push(outcomes[i]);
    }

    // Calculate weighted entropy
    let totalEntropy = 0;

    for (const bin of bins) {
      if (bin.outcomes.length === 0) continue;

      const positives = bin.outcomes.filter(o => o === 1).length;
      const negatives = bin.outcomes.length - positives;
      const total = bin.outcomes.length;

      const pPos = positives / total;
      const pNeg = negatives / total;

      let entropy = 0;
      if (pPos > 0) entropy -= pPos * Math.log2(pPos);
      if (pNeg > 0) entropy -= pNeg * Math.log2(pNeg);

      const weight = total / n;
      totalEntropy += weight * entropy;
    }

    // Information gain = 1 - normalized entropy
    return 1 - totalEntropy;
  }

  /**
   * Save feature importance analysis to database
   */
  private saveFeatureImportance(result: FeatureSelectionResult): void {
    try {
      const timestamp = Date.now();

      // Create JSON payload
      const data = {
        timestamp,
        totalFeatures: result.totalFeatures,
        analyzedSamples: result.analyzedSamples,
        improvementEstimate: result.improvementEstimate,
        scores: result.importanceScores.map(s => ({
          feature: s.featureName,
          importance: s.importance,
          rank: s.rank,
          lowImpact: s.isLowImpact,
        })),
      };

      // Save to database (you'll need to create this table)
      database.run(
        `INSERT INTO feature_importance_analysis (timestamp, total_features, analyzed_samples, improvement_estimate, importance_scores)
         VALUES (?, ?, ?, ?, ?)`,
        [
          timestamp,
          result.totalFeatures,
          result.analyzedSamples,
          result.improvementEstimate,
          JSON.stringify(data.scores),
        ]
      );

      logger.info('FeatureSelection', 'Saved feature importance analysis');
    } catch (error) {
      logger.silentError('FeatureSelection', 'Failed to save feature importance', error as Error);
    }
  }

  /**
   * Get latest feature importance analysis
   */
  getLatestAnalysis(): FeatureSelectionResult | null {
    try {
      const row = database.get<{
        timestamp: number;
        total_features: number;
        analyzed_samples: number;
        improvement_estimate: number;
        importance_scores: string;
      }>(`
        SELECT * FROM feature_importance_analysis
        ORDER BY timestamp DESC
        LIMIT 1
      `);

      if (!row) return null;

      const scores = JSON.parse(row.importance_scores) as Array<{
        feature: string;
        importance: number;
        rank: number;
        lowImpact: boolean;
      }>;

      const importanceScores: FeatureImportance[] = scores.map(s => ({
        featureName: s.feature,
        importance: s.importance,
        rank: s.rank,
        isLowImpact: s.lowImpact,
      }));

      return {
        totalFeatures: row.total_features,
        analyzedSamples: row.analyzed_samples,
        importanceScores,
        recommendedFeatures: importanceScores.filter(s => !s.isLowImpact).map(s => s.featureName),
        lowImpactFeatures: importanceScores.filter(s => s.isLowImpact).map(s => s.featureName),
        improvementEstimate: row.improvement_estimate,
      };
    } catch (error) {
      logger.silentError('FeatureSelection', 'Failed to get latest analysis', error as Error);
      return null;
    }
  }

  /**
   * Format feature importance for display
   */
  formatForDisplay(result: FeatureSelectionResult): string {
    let output = `📊 Feature Importance Analysis\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    output += `📦 Total Features: ${result.totalFeatures}\n`;
    output += `📝 Samples Analyzed: ${result.analyzedSamples}\n`;
    output += `✨ High-Impact Features: ${result.recommendedFeatures.length}\n`;
    output += `⚠️ Low-Impact Features: ${result.lowImpactFeatures.length}\n`;
    output += `📈 Est. Improvement: ${result.improvementEstimate.toFixed(1)}%\n\n`;

    output += `🏆 Top 10 Features:\n`;
    const top10 = result.importanceScores.slice(0, 10);
    for (const feature of top10) {
      const bar = this.createBar(feature.importance, 20);
      output += `${feature.rank}. ${feature.featureName}\n`;
      output += `   ${bar} ${(feature.importance * 100).toFixed(1)}%\n`;
    }

    if (result.lowImpactFeatures.length > 0) {
      output += `\n⚠️ Low Impact Features:\n`;
      for (const featureName of result.lowImpactFeatures) {
        const feature = result.importanceScores.find(s => s.featureName === featureName)!;
        output += `${feature.rank}. ${featureName} (${(feature.importance * 100).toFixed(1)}%)\n`;
      }
    }

    return output;
  }

  /**
   * Create a simple bar chart
   */
  private createBar(value: number, maxLength: number): string {
    const filled = Math.round(value * maxLength);
    return '█'.repeat(filled) + '░'.repeat(maxLength - filled);
  }
}

// Export singleton
export const featureSelection = new FeatureSelection();
