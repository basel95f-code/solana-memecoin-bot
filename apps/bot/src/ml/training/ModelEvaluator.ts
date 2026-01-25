/**
 * Model Evaluator
 * Comprehensive model evaluation with A/B testing and statistical significance
 * 
 * Metrics: Accuracy, Precision, Recall, F1, ROC-AUC, Calibration
 * Statistical tests: t-test, chi-square
 */

import * as tf from '@tensorflow/tfjs';
import { logger } from '../../utils/logger';

// ============================================
// Types
// ============================================

export interface ModelMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  auc: number;
  specificity: number;
  npv: number; // Negative Predictive Value
  
  // Confusion matrix
  truePositives: number;
  trueNegatives: number;
  falsePositives: number;
  falseNegatives: number;
  
  // Calibration
  calibrationError: number;
  brierScore: number;
}

export interface ModelComparison {
  productionMetrics: ModelMetrics;
  challengerMetrics: ModelMetrics;
  
  // Deltas
  accuracyDelta: number;
  f1Delta: number;
  aucDelta: number;
  
  // Statistical significance
  pValue?: number;
  isSignificant: boolean;
  chiSquareStatistic?: number;
  
  // Winner
  winnerVersion: 'production' | 'challenger' | 'tie';
  confidence: number;
}

export interface CalibrationBin {
  binStart: number;
  binEnd: number;
  meanPredicted: number;
  actualPositiveRate: number;
  count: number;
}

// ============================================
// Model Evaluator
// ============================================

export class ModelEvaluator {
  
  /**
   * Calculate comprehensive metrics from predictions
   */
  calculateMetrics(predictions: number[], labels: number[], threshold: number = 0.5): ModelMetrics {
    const n = predictions.length;
    if (n === 0 || n !== labels.length) {
      return this.emptyMetrics();
    }
    
    // Confusion matrix counts
    let tp = 0, tn = 0, fp = 0, fn = 0;
    
    for (let i = 0; i < n; i++) {
      const predicted = predictions[i] >= threshold ? 1 : 0;
      const actual = labels[i];
      
      if (predicted === 1 && actual === 1) tp++;
      else if (predicted === 0 && actual === 0) tn++;
      else if (predicted === 1 && actual === 0) fp++;
      else if (predicted === 0 && actual === 1) fn++;
    }
    
    // Basic metrics
    const accuracy = (tp + tn) / n;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const specificity = tn + fp > 0 ? tn / (tn + fp) : 0;
    const npv = tn + fn > 0 ? tn / (tn + fn) : 0;
    const f1Score = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    
    // AUC-ROC
    const auc = this.calculateAUC(predictions, labels);
    
    // Calibration metrics
    const brierScore = this.calculateBrierScore(predictions, labels);
    const calibrationError = this.calculateCalibrationError(predictions, labels);
    
    return {
      accuracy,
      precision,
      recall,
      f1Score,
      auc,
      specificity,
      npv,
      truePositives: tp,
      trueNegatives: tn,
      falsePositives: fp,
      falseNegatives: fn,
      calibrationError,
      brierScore,
    };
  }

  /**
   * Calculate AUC-ROC using trapezoidal rule
   */
  calculateAUC(predictions: number[], labels: number[]): number {
    const n = predictions.length;
    if (n === 0) return 0;
    
    // Sort by prediction descending
    const sorted = predictions
      .map((pred, i) => ({ pred, label: labels[i] }))
      .sort((a, b) => b.pred - a.pred);
    
    // Count positives and negatives
    const P = labels.filter(l => l === 1).length;
    const N = n - P;
    
    if (P === 0 || N === 0) return 0.5;
    
    // Calculate ROC curve points and AUC
    let auc = 0;
    let tpCount = 0;
    let fpCount = 0;
    let prevTPR = 0;
    let prevFPR = 0;
    
    for (const { label } of sorted) {
      if (label === 1) {
        tpCount++;
      } else {
        fpCount++;
      }
      
      const tpr = tpCount / P;
      const fpr = fpCount / N;
      
      // Trapezoidal integration
      auc += (fpr - prevFPR) * (tpr + prevTPR) / 2;
      
      prevTPR = tpr;
      prevFPR = fpr;
    }
    
    return auc;
  }

  /**
   * Calculate Brier Score (mean squared error for probability predictions)
   */
  calculateBrierScore(predictions: number[], labels: number[]): number {
    if (predictions.length === 0) return 1;
    
    let sum = 0;
    for (let i = 0; i < predictions.length; i++) {
      sum += Math.pow(predictions[i] - labels[i], 2);
    }
    
    return sum / predictions.length;
  }

  /**
   * Calculate Expected Calibration Error (ECE)
   */
  calculateCalibrationError(predictions: number[], labels: number[], bins: number = 10): number {
    const calibrationBins = this.getCalibrationBins(predictions, labels, bins);
    const n = predictions.length;
    
    if (n === 0) return 1;
    
    let ece = 0;
    for (const bin of calibrationBins) {
      if (bin.count > 0) {
        const error = Math.abs(bin.meanPredicted - bin.actualPositiveRate);
        ece += (bin.count / n) * error;
      }
    }
    
    return ece;
  }

  /**
   * Get calibration bins
   */
  getCalibrationBins(predictions: number[], labels: number[], numBins: number = 10): CalibrationBin[] {
    const bins: CalibrationBin[] = [];
    const binWidth = 1 / numBins;
    
    for (let i = 0; i < numBins; i++) {
      const binStart = i * binWidth;
      const binEnd = (i + 1) * binWidth;
      
      const binIndices = predictions
        .map((p, idx) => ({ p, idx }))
        .filter(x => x.p >= binStart && (i === numBins - 1 ? x.p <= binEnd : x.p < binEnd))
        .map(x => x.idx);
      
      if (binIndices.length > 0) {
        const binPreds = binIndices.map(idx => predictions[idx]);
        const binLabels = binIndices.map(idx => labels[idx]);
        
        bins.push({
          binStart,
          binEnd,
          meanPredicted: binPreds.reduce((a, b) => a + b, 0) / binPreds.length,
          actualPositiveRate: binLabels.filter(l => l === 1).length / binLabels.length,
          count: binIndices.length,
        });
      } else {
        bins.push({
          binStart,
          binEnd,
          meanPredicted: (binStart + binEnd) / 2,
          actualPositiveRate: 0,
          count: 0,
        });
      }
    }
    
    return bins;
  }

  /**
   * Compare two models with statistical significance testing
   */
  async compareModels(
    productionModel: tf.LayersModel,
    challengerModel: tf.LayersModel,
    testFeatures: number[][],
    testLabels: number[]
  ): Promise<ModelComparison> {
    // Get predictions from both models
    const testTensor = tf.tensor2d(testFeatures);
    
    const prodPred = productionModel.predict(testTensor) as tf.Tensor;
    const challPred = challengerModel.predict(testTensor) as tf.Tensor;
    
    const prodPredArray = Array.from(await prodPred.data());
    const challPredArray = Array.from(await challPred.data());
    
    // Cleanup tensors
    testTensor.dispose();
    prodPred.dispose();
    challPred.dispose();
    
    // Calculate metrics
    const productionMetrics = this.calculateMetrics(prodPredArray, testLabels);
    const challengerMetrics = this.calculateMetrics(challPredArray, testLabels);
    
    // Calculate deltas
    const accuracyDelta = challengerMetrics.accuracy - productionMetrics.accuracy;
    const f1Delta = challengerMetrics.f1Score - productionMetrics.f1Score;
    const aucDelta = challengerMetrics.auc - productionMetrics.auc;
    
    // Statistical significance test (McNemar's test for paired data)
    const { pValue, chiSquareStatistic, isSignificant } = this.mcNemarsTest(
      prodPredArray, 
      challPredArray, 
      testLabels
    );
    
    // Determine winner
    let winnerVersion: 'production' | 'challenger' | 'tie' = 'tie';
    let confidence = 0.5;
    
    if (isSignificant) {
      if (accuracyDelta > 0.01 && f1Delta > 0.01) {
        winnerVersion = 'challenger';
        confidence = Math.min(0.99, 0.5 + Math.abs(accuracyDelta) + Math.abs(f1Delta));
      } else if (accuracyDelta < -0.01 && f1Delta < -0.01) {
        winnerVersion = 'production';
        confidence = Math.min(0.99, 0.5 + Math.abs(accuracyDelta) + Math.abs(f1Delta));
      }
    } else {
      // Use average of deltas for weak signal
      const avgDelta = (accuracyDelta + f1Delta + aucDelta) / 3;
      if (avgDelta > 0.02) {
        winnerVersion = 'challenger';
        confidence = 0.5 + avgDelta;
      } else if (avgDelta < -0.02) {
        winnerVersion = 'production';
        confidence = 0.5 - avgDelta;
      }
    }
    
    return {
      productionMetrics,
      challengerMetrics,
      accuracyDelta,
      f1Delta,
      aucDelta,
      pValue,
      isSignificant,
      chiSquareStatistic,
      winnerVersion,
      confidence: Math.min(0.99, confidence),
    };
  }

  /**
   * McNemar's test for comparing paired binary predictions
   */
  private mcNemarsTest(
    pred1: number[], 
    pred2: number[], 
    labels: number[],
    threshold: number = 0.5
  ): { pValue: number; chiSquareStatistic: number; isSignificant: boolean } {
    let b = 0; // Model 1 correct, Model 2 incorrect
    let c = 0; // Model 1 incorrect, Model 2 correct
    
    for (let i = 0; i < labels.length; i++) {
      const p1 = pred1[i] >= threshold ? 1 : 0;
      const p2 = pred2[i] >= threshold ? 1 : 0;
      const actual = labels[i];
      
      const m1Correct = p1 === actual;
      const m2Correct = p2 === actual;
      
      if (m1Correct && !m2Correct) b++;
      if (!m1Correct && m2Correct) c++;
    }
    
    // McNemar's chi-square statistic with continuity correction
    const chiSquare = b + c > 0 ? Math.pow(Math.abs(b - c) - 1, 2) / (b + c) : 0;
    
    // Approximate p-value from chi-square distribution with 1 df
    const pValue = this.chiSquarePValue(chiSquare, 1);
    
    return {
      pValue,
      chiSquareStatistic: chiSquare,
      isSignificant: pValue < 0.05,
    };
  }

  /**
   * Approximate chi-square p-value
   */
  private chiSquarePValue(chiSquare: number, df: number): number {
    // Simplified approximation for df=1
    if (df !== 1) {
      // For other degrees of freedom, use approximation
      return Math.exp(-chiSquare / 2);
    }
    
    // For df=1, use normal approximation
    const z = Math.sqrt(chiSquare);
    return 2 * (1 - this.normalCDF(z));
  }

  /**
   * Standard normal CDF approximation
   */
  private normalCDF(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);
    
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    
    return 0.5 * (1.0 + sign * y);
  }

  /**
   * Generate evaluation report
   */
  generateReport(metrics: ModelMetrics): string {
    const lines = [
      '=== Model Evaluation Report ===',
      '',
      `Accuracy:    ${(metrics.accuracy * 100).toFixed(2)}%`,
      `Precision:   ${(metrics.precision * 100).toFixed(2)}%`,
      `Recall:      ${(metrics.recall * 100).toFixed(2)}%`,
      `F1 Score:    ${(metrics.f1Score * 100).toFixed(2)}%`,
      `AUC-ROC:     ${(metrics.auc * 100).toFixed(2)}%`,
      `Specificity: ${(metrics.specificity * 100).toFixed(2)}%`,
      '',
      'Confusion Matrix:',
      `  TP: ${metrics.truePositives}  FP: ${metrics.falsePositives}`,
      `  FN: ${metrics.falseNegatives}  TN: ${metrics.trueNegatives}`,
      '',
      'Calibration:',
      `  Brier Score: ${metrics.brierScore.toFixed(4)}`,
      `  ECE:         ${(metrics.calibrationError * 100).toFixed(2)}%`,
    ];
    
    return lines.join('\n');
  }

  /**
   * Generate comparison report
   */
  generateComparisonReport(comparison: ModelComparison): string {
    const { productionMetrics: prod, challengerMetrics: chal } = comparison;
    
    const formatDelta = (delta: number) => {
      const sign = delta >= 0 ? '+' : '';
      return `${sign}${(delta * 100).toFixed(2)}%`;
    };
    
    const lines = [
      '=== Model Comparison Report ===',
      '',
      'Metric          Production   Challenger   Delta',
      '─'.repeat(55),
      `Accuracy        ${(prod.accuracy * 100).toFixed(2).padEnd(10)}%  ${(chal.accuracy * 100).toFixed(2).padEnd(10)}%  ${formatDelta(comparison.accuracyDelta)}`,
      `Precision       ${(prod.precision * 100).toFixed(2).padEnd(10)}%  ${(chal.precision * 100).toFixed(2)}%`,
      `Recall          ${(prod.recall * 100).toFixed(2).padEnd(10)}%  ${(chal.recall * 100).toFixed(2)}%`,
      `F1 Score        ${(prod.f1Score * 100).toFixed(2).padEnd(10)}%  ${(chal.f1Score * 100).toFixed(2).padEnd(10)}%  ${formatDelta(comparison.f1Delta)}`,
      `AUC-ROC         ${(prod.auc * 100).toFixed(2).padEnd(10)}%  ${(chal.auc * 100).toFixed(2).padEnd(10)}%  ${formatDelta(comparison.aucDelta)}`,
      '',
      'Statistical Significance:',
      `  Chi-Square: ${comparison.chiSquareStatistic?.toFixed(4) ?? 'N/A'}`,
      `  p-value:    ${comparison.pValue?.toFixed(4) ?? 'N/A'}`,
      `  Significant: ${comparison.isSignificant ? 'Yes (p < 0.05)' : 'No'}`,
      '',
      `Winner: ${comparison.winnerVersion.toUpperCase()} (confidence: ${(comparison.confidence * 100).toFixed(1)}%)`,
    ];
    
    return lines.join('\n');
  }

  /**
   * Empty metrics for error cases
   */
  private emptyMetrics(): ModelMetrics {
    return {
      accuracy: 0,
      precision: 0,
      recall: 0,
      f1Score: 0,
      auc: 0,
      specificity: 0,
      npv: 0,
      truePositives: 0,
      trueNegatives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      calibrationError: 1,
      brierScore: 1,
    };
  }
}

// Export singleton
export const modelEvaluator = new ModelEvaluator();
