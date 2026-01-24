/**
 * Training Metrics
 * Calculate and track ML model performance metrics
 */

import { logger } from '../utils/logger';

// ============================================
// Types
// ============================================

export interface ConfusionMatrix {
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
}

export interface ClassificationMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  specificity: number;
  auc?: number;
}

export interface TrainingMetrics extends ClassificationMetrics {
  trainLoss: number;
  validationLoss: number;
  epochs: number;
  trainingDurationMs: number;
  confusionMatrix: ConfusionMatrix;
  featureImportance?: Record<string, number>;
}

export interface PerClassMetrics {
  className: string;
  precision: number;
  recall: number;
  f1Score: number;
  support: number; // Number of samples
}

// ============================================
// Metrics Calculator
// ============================================

export class MetricsCalculator {
  /**
   * Build confusion matrix from predictions
   * @param predictions Array of predicted labels (0 or 1)
   * @param actuals Array of actual labels (0 or 1)
   */
  buildConfusionMatrix(predictions: number[], actuals: number[]): ConfusionMatrix {
    if (predictions.length !== actuals.length) {
      throw new Error('Predictions and actuals must have same length');
    }

    let tp = 0, fp = 0, tn = 0, fn = 0;

    for (let i = 0; i < predictions.length; i++) {
      const predicted = predictions[i] >= 0.5 ? 1 : 0;
      const actual = actuals[i];

      if (predicted === 1 && actual === 1) tp++;
      else if (predicted === 1 && actual === 0) fp++;
      else if (predicted === 0 && actual === 0) tn++;
      else if (predicted === 0 && actual === 1) fn++;
    }

    return {
      truePositives: tp,
      falsePositives: fp,
      trueNegatives: tn,
      falseNegatives: fn,
    };
  }

  /**
   * Calculate classification metrics from confusion matrix
   */
  calculateMetrics(cm: ConfusionMatrix): ClassificationMetrics {
    const { truePositives: tp, falsePositives: fp, trueNegatives: tn, falseNegatives: fn } = cm;
    const total = tp + fp + tn + fn;

    // Accuracy: (TP + TN) / Total
    const accuracy = total > 0 ? (tp + tn) / total : 0;

    // Precision: TP / (TP + FP)
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;

    // Recall (Sensitivity): TP / (TP + FN)
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;

    // Specificity: TN / (TN + FP)
    const specificity = (tn + fp) > 0 ? tn / (tn + fp) : 0;

    // F1 Score: 2 * (Precision * Recall) / (Precision + Recall)
    const f1Score = (precision + recall) > 0
      ? 2 * (precision * recall) / (precision + recall)
      : 0;

    return {
      accuracy,
      precision,
      recall,
      f1Score,
      specificity,
    };
  }

  /**
   * Calculate AUC-ROC using trapezoidal rule
   * @param predictions Array of predicted probabilities
   * @param actuals Array of actual labels (0 or 1)
   */
  calculateAUC(predictions: number[], actuals: number[]): number {
    if (predictions.length !== actuals.length) {
      throw new Error('Predictions and actuals must have same length');
    }

    // Create pairs and sort by prediction descending
    const pairs = predictions.map((pred, i) => ({
      prediction: pred,
      actual: actuals[i],
    })).sort((a, b) => b.prediction - a.prediction);

    // Count positives and negatives
    const totalPositives = actuals.filter(a => a === 1).length;
    const totalNegatives = actuals.length - totalPositives;

    if (totalPositives === 0 || totalNegatives === 0) {
      return 0.5; // Can't calculate AUC
    }

    // Calculate ROC curve points and integrate
    let auc = 0;
    let tpSoFar = 0;
    let fpSoFar = 0;
    let lastTpr = 0;
    let lastFpr = 0;

    for (const pair of pairs) {
      if (pair.actual === 1) {
        tpSoFar++;
      } else {
        fpSoFar++;
      }

      const tpr = tpSoFar / totalPositives;
      const fpr = fpSoFar / totalNegatives;

      // Trapezoidal rule
      auc += (fpr - lastFpr) * (tpr + lastTpr) / 2;

      lastTpr = tpr;
      lastFpr = fpr;
    }

    return auc;
  }

  /**
   * Calculate metrics for multi-class classification
   * @param predictions Array of predicted class indices
   * @param actuals Array of actual class indices
   * @param classNames Names of classes
   */
  calculateMultiClassMetrics(
    predictions: number[],
    actuals: number[],
    classNames: string[]
  ): PerClassMetrics[] {
    const numClasses = classNames.length;
    const metrics: PerClassMetrics[] = [];

    for (let c = 0; c < numClasses; c++) {
      // One-vs-all confusion matrix
      const binaryPreds = predictions.map(p => p === c ? 1 : 0);
      const binaryActuals = actuals.map(a => a === c ? 1 : 0);

      const cm = this.buildConfusionMatrix(binaryPreds, binaryActuals);
      const classMetrics = this.calculateMetrics(cm);

      metrics.push({
        className: classNames[c],
        precision: classMetrics.precision,
        recall: classMetrics.recall,
        f1Score: classMetrics.f1Score,
        support: binaryActuals.filter(a => a === 1).length,
      });
    }

    return metrics;
  }

  /**
   * Calculate macro-averaged F1 score
   */
  calculateMacroF1(perClassMetrics: PerClassMetrics[]): number {
    const sum = perClassMetrics.reduce((acc, m) => acc + m.f1Score, 0);
    return perClassMetrics.length > 0 ? sum / perClassMetrics.length : 0;
  }

  /**
   * Calculate weighted F1 score (weighted by support)
   */
  calculateWeightedF1(perClassMetrics: PerClassMetrics[]): number {
    const totalSupport = perClassMetrics.reduce((acc, m) => acc + m.support, 0);
    if (totalSupport === 0) return 0;

    const weightedSum = perClassMetrics.reduce(
      (acc, m) => acc + m.f1Score * m.support,
      0
    );
    return weightedSum / totalSupport;
  }

  /**
   * Format confusion matrix as 2D array for display/storage
   */
  formatConfusionMatrix(cm: ConfusionMatrix): number[][] {
    return [
      [cm.trueNegatives, cm.falsePositives],
      [cm.falseNegatives, cm.truePositives],
    ];
  }

  /**
   * Format metrics for display
   */
  formatMetricsForDisplay(metrics: ClassificationMetrics): string {
    return [
      `Accuracy:    ${(metrics.accuracy * 100).toFixed(2)}%`,
      `Precision:   ${(metrics.precision * 100).toFixed(2)}%`,
      `Recall:      ${(metrics.recall * 100).toFixed(2)}%`,
      `F1 Score:    ${(metrics.f1Score * 100).toFixed(2)}%`,
      `Specificity: ${(metrics.specificity * 100).toFixed(2)}%`,
      metrics.auc !== undefined ? `AUC-ROC:     ${(metrics.auc * 100).toFixed(2)}%` : '',
    ].filter(Boolean).join('\n');
  }

  /**
   * Format confusion matrix for display
   */
  formatConfusionMatrixForDisplay(cm: ConfusionMatrix): string {
    const matrix = this.formatConfusionMatrix(cm);
    return [
      '              Predicted',
      '              Neg   Pos',
      `Actual Neg   ${matrix[0][0].toString().padStart(4)}  ${matrix[0][1].toString().padStart(4)}`,
      `       Pos   ${matrix[1][0].toString().padStart(4)}  ${matrix[1][1].toString().padStart(4)}`,
    ].join('\n');
  }
}

// Export singleton
export const metricsCalculator = new MetricsCalculator();
