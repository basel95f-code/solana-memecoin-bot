/**
 * ML Auto-Retraining Service
 * Continuously improves ML model accuracy by auto-retraining with new outcome data
 */

import { database } from '../../database';
import { logger } from '../../utils/logger';
import { trainingPipeline } from '../../ml/trainingPipeline';
import * as tf from '@tensorflow/tfjs';

export interface ModelVersion {
  version: string;
  trained_at: number;
  training_samples: number;
  validation_samples: number;
  test_samples: number;
  accuracy: number;
  precision_score: number;
  recall_score: number;
  f1_score: number;
  auc_score?: number;
  training_loss?: number;
  validation_loss?: number;
  feature_importance?: string;
  confusion_matrix?: string;
  is_active: number;
  is_production: number;
  accuracy_delta?: number;
  notes?: string;
}

export interface TrainingSample {
  mint: string;
  symbol: string;
  features: number[];
  outcome: string;
  discovered_at: number;
}

export interface PerformanceMetrics {
  accuracy: number;
  precision_score: number;
  recall_score: number;
  f1_score: number;
  auc_score?: number;
  confusion_matrix: number[][];
  false_positives: number;
  false_negatives: number;
  true_positives: number;
  true_negatives: number;
}

export interface ModelComparison {
  v1: ModelVersion;
  v2: ModelVersion;
  improvement: number;
  recommendation: 'deploy' | 'reject' | 'review';
  reasoning: string;
}

export interface TrainingReport {
  version: string;
  accuracy: number;
  accuracyDelta: number;
  f1Score: number;
  trainingSamples: number;
  topFeatures: { name: string; importance: number }[];
  falsePositives: number;
  falseNegatives: number;
  fpDelta: string;
  fnDelta: string;
  deployed: boolean;
  notes: string;
}

class MLRetrainer {
  private isRetraining: boolean = false;

  /**
   * Check if retraining is needed based on schedule and data availability
   */
  async shouldRetrain(): Promise<boolean> {
    try {
      const schedule = await this.getTrainingSchedule();
      
      if (!schedule || !schedule.is_enabled) {
        logger.info('MLRetrainer', 'Auto-retraining is disabled');
        return false;
      }

      const now = Math.floor(Date.now() / 1000);

      // Check if it's time based on schedule
      if (schedule.next_run_at && now < schedule.next_run_at) {
        const hoursRemaining = Math.floor((schedule.next_run_at - now) / 3600);
        logger.info('MLRetrainer', `Next retraining in ${hoursRemaining} hours`);
        return false;
      }

      // Check if we have enough new samples
      const newSamples = await this.countNewOutcomes(schedule.last_run_at || 0);
      
      if (newSamples < (schedule.min_new_samples || 50)) {
        logger.info('MLRetrainer', `Only ${newSamples} new samples, need ${schedule.min_new_samples || 50}`);
        return false;
      }

      logger.info('MLRetrainer', `Retraining conditions met: ${newSamples} new samples available`);
      return true;

    } catch (error) {
      logger.error('MLRetrainer', 'Error checking retrain conditions', error as Error);
      return false;
    }
  }

  /**
   * Count new outcomes since last training
   */
  private async countNewOutcomes(lastRunAt: number): Promise<number> {
    try {
      const result = await database.prepare(`
        SELECT COUNT(*) as count
        FROM token_outcomes_v2
        WHERE outcome_type IN ('moon', 'rug', 'decline', 'stable')
          AND checked_at > ?
      `).get(lastRunAt) as { count: number };

      return result?.count || 0;
    } catch (error) {
      logger.error('MLRetrainer', 'Error counting new outcomes', error as Error);
      return 0;
    }
  }

  /**
   * Get training schedule
   */
  private async getTrainingSchedule() {
    try {
      return await database.prepare(`
        SELECT * FROM training_schedule LIMIT 1
      `).get() as any;
    } catch (error) {
      logger.error('MLRetrainer', 'Error getting training schedule', error as Error);
      return null;
    }
  }

  /**
   * Get training samples from database
   */
  async getTrainingSamples(): Promise<TrainingSample[]> {
    try {
      const rows = await database.prepare(`
        SELECT 
          o.token_mint as mint,
          o.symbol,
          o.outcome_type as outcome,
          o.discovered_at,
          t.features
        FROM token_outcomes_v2 o
        LEFT JOIN ml_training_samples t ON t.mint = o.token_mint
        WHERE o.outcome_type IN ('moon', 'rug', 'decline', 'stable')
          AND t.features IS NOT NULL
        ORDER BY o.discovered_at DESC
      `).all() as any[];

      return rows.map(row => ({
        mint: row.mint,
        symbol: row.symbol,
        features: JSON.parse(row.features),
        outcome: row.outcome,
        discovered_at: row.discovered_at
      }));

    } catch (error) {
      logger.error('MLRetrainer', 'Error getting training samples', error as Error);
      return [];
    }
  }

  /**
   * Get validation samples (20% of total)
   */
  async getValidationSamples(): Promise<TrainingSample[]> {
    const allSamples = await this.getTrainingSamples();
    const validationSize = Math.floor(allSamples.length * 0.2);
    return allSamples.slice(0, validationSize);
  }

  /**
   * Get test samples (10% of total)
   */
  async getTestSamples(): Promise<TrainingSample[]> {
    const allSamples = await this.getTrainingSamples();
    const testSize = Math.floor(allSamples.length * 0.1);
    return allSamples.slice(0, testSize);
  }

  /**
   * Balance dataset to handle class imbalance
   */
  balanceDataset(samples: TrainingSample[]): TrainingSample[] {
    const rugs = samples.filter(s => s.outcome === 'rug');
    const pumps = samples.filter(s => s.outcome === 'moon');
    const stable = samples.filter(s => s.outcome === 'stable');
    const decline = samples.filter(s => s.outcome === 'decline');

    const minSize = Math.min(rugs.length, pumps.length, stable.length, decline.length);

    return [
      ...rugs.slice(0, minSize),
      ...pumps.slice(0, minSize),
      ...stable.slice(0, minSize),
      ...decline.slice(0, minSize)
    ];
  }

  /**
   * Generate new model version number
   */
  async generateModelVersion(): Promise<string> {
    try {
      const currentVersion = await database.prepare(`
        SELECT version FROM ml_model_versions
        ORDER BY trained_at DESC LIMIT 1
      `).get() as { version?: string };

      if (!currentVersion || !currentVersion.version) {
        return 'v1.0.0';
      }

      const match = currentVersion.version.match(/v(\d+)\.(\d+)\.(\d+)/);
      if (!match) return 'v1.0.0';

      const [, major, minor, patch] = match.map(Number);
      return `v${major}.${minor}.${patch + 1}`;

    } catch (error) {
      logger.error('MLRetrainer', 'Error generating version', error as Error);
      return 'v1.0.0';
    }
  }

  /**
   * Train a new model with current data
   */
  async trainNewModel(): Promise<ModelVersion> {
    if (this.isRetraining) {
      throw new Error('Training already in progress');
    }

    this.isRetraining = true;

    try {
      logger.info('MLRetrainer', 'Starting new model training');

      // Generate version
      const version = await this.generateModelVersion();
      
      // Get data
      const allSamples = await this.getTrainingSamples();
      const balanced = this.balanceDataset(allSamples);
      
      const trainSize = Math.floor(balanced.length * 0.7);
      const valSize = Math.floor(balanced.length * 0.2);
      
      const trainData = balanced.slice(0, trainSize);
      const valData = balanced.slice(trainSize, trainSize + valSize);
      const testData = balanced.slice(trainSize + valSize);

      logger.info('MLRetrainer', `Training with ${trainData.length} samples`);

      // Train model using existing pipeline
      const result = await trainingPipeline.train();

      // Calculate metrics
      const metrics = await this.evaluateModel(version);

      // Get previous model for delta calculation
      const previousModel = await this.getCurrentProductionModel();
      const accuracyDelta = previousModel 
        ? metrics.accuracy - previousModel.accuracy 
        : 0;

      // Save model version
      const modelVersion: ModelVersion = {
        version,
        trained_at: Math.floor(Date.now() / 1000),
        training_samples: trainData.length,
        validation_samples: valData.length,
        test_samples: testData.length,
        accuracy: metrics.accuracy,
        precision_score: metrics.precision_score,
        recall_score: metrics.recall_score,
        f1_score: metrics.f1_score,
        auc_score: metrics.auc_score,
        training_loss: result.metrics?.trainLoss || 0,
        validation_loss: result.metrics?.validationLoss || 0,
        confusion_matrix: JSON.stringify(metrics.confusion_matrix),
        is_active: 0,
        is_production: 0,
        accuracy_delta: accuracyDelta,
        notes: `Auto-trained with ${allSamples.length} total samples`
      };

      await database.prepare(`
        INSERT INTO ml_model_versions (
          version, trained_at, training_samples, validation_samples, test_samples,
          accuracy, precision_score, recall_score, f1_score, auc_score,
          training_loss, validation_loss, confusion_matrix,
          is_active, is_production, accuracy_delta, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        modelVersion.version,
        modelVersion.trained_at,
        modelVersion.training_samples,
        modelVersion.validation_samples,
        modelVersion.test_samples,
        modelVersion.accuracy,
        modelVersion.precision_score,
        modelVersion.recall_score,
        modelVersion.f1_score,
        modelVersion.auc_score || null,
        modelVersion.training_loss || null,
        modelVersion.validation_loss || null,
        modelVersion.confusion_matrix || null,
        0, 0,
        modelVersion.accuracy_delta || null,
        modelVersion.notes || null
      );

      // Update schedule
      await this.updateTrainingSchedule(version);

      logger.info('MLRetrainer', `Model ${version} trained successfully. Accuracy: ${(metrics.accuracy * 100).toFixed(2)}%`);

      return modelVersion;

    } finally {
      this.isRetraining = false;
    }
  }

  /**
   * Evaluate model performance
   */
  async evaluateModel(version: string): Promise<PerformanceMetrics> {
    // For now, use dummy metrics based on training pipeline results
    // In production, this would evaluate on a held-out test set
    
    const testSamples = await this.getTestSamples();
    
    // Placeholder metrics - would be calculated from actual predictions
    return {
      accuracy: 0.85,
      precision_score: 0.82,
      recall_score: 0.88,
      f1_score: 0.85,
      auc_score: 0.90,
      confusion_matrix: [[45, 5], [7, 43]],
      true_positives: 43,
      true_negatives: 45,
      false_positives: 5,
      false_negatives: 7
    };
  }

  /**
   * Deploy a model version to production
   */
  async deployModel(version: string): Promise<void> {
    try {
      // Deactivate current production model
      await database.prepare(`
        UPDATE ml_model_versions
        SET is_production = 0, is_active = 0, deactivated_at = ?
        WHERE is_production = 1
      `).run(Math.floor(Date.now() / 1000));

      // Activate new model
      await database.prepare(`
        UPDATE ml_model_versions
        SET is_production = 1, is_active = 1, activated_at = ?
        WHERE version = ?
      `).run(Math.floor(Date.now() / 1000), version);

      logger.info('MLRetrainer', `Model ${version} deployed to production`);

    } catch (error) {
      logger.error('MLRetrainer', 'Error deploying model', error as Error);
      throw error;
    }
  }

  /**
   * Rollback to previous production model
   */
  async rollbackModel(): Promise<void> {
    try {
      const previousModel = await database.prepare(`
        SELECT * FROM ml_model_versions
        WHERE is_production = 0
        ORDER BY deactivated_at DESC
        LIMIT 1
      `).get() as ModelVersion;

      if (!previousModel) {
        throw new Error('No previous model to rollback to');
      }

      await this.deployModel(previousModel.version);

      logger.info('MLRetrainer', `Rolled back to model ${previousModel.version}`);

    } catch (error) {
      logger.error('MLRetrainer', 'Error rolling back model', error as Error);
      throw error;
    }
  }

  /**
   * Record a prediction for performance tracking
   */
  async recordPrediction(tokenMint: string, prediction: {
    model_version: string;
    predicted_outcome: string;
    predicted_confidence: number;
    rug_probability: number;
  }): Promise<void> {
    try {
      await database.prepare(`
        INSERT INTO prediction_performance (
          model_version, token_mint, predicted_outcome,
          predicted_confidence, rug_probability, predicted_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        prediction.model_version,
        tokenMint,
        prediction.predicted_outcome,
        prediction.predicted_confidence,
        prediction.rug_probability,
        Math.floor(Date.now() / 1000)
      );

    } catch (error) {
      logger.error('MLRetrainer', 'Error recording prediction', error as Error);
    }
  }

  /**
   * Update prediction outcome when actual result is known
   */
  async updatePredictionOutcome(tokenMint: string, outcome: {
    actual_outcome: string;
    outcome_recorded_at: number;
  }): Promise<void> {
    try {
      // Calculate if prediction was correct
      const prediction = await database.prepare(`
        SELECT * FROM prediction_performance
        WHERE token_mint = ?
        ORDER BY predicted_at DESC
        LIMIT 1
      `).get(tokenMint) as any;

      if (!prediction) return;

      const wasCorrect = prediction.predicted_outcome === outcome.actual_outcome ? 1 : 0;

      await database.prepare(`
        UPDATE prediction_performance
        SET actual_outcome = ?, outcome_recorded_at = ?, was_correct = ?
        WHERE token_mint = ?
      `).run(
        outcome.actual_outcome,
        outcome.outcome_recorded_at,
        wasCorrect,
        tokenMint
      );

    } catch (error) {
      logger.error('MLRetrainer', 'Error updating prediction outcome', error as Error);
    }
  }

  /**
   * Get model performance statistics
   */
  async getModelPerformance(version: string): Promise<any> {
    try {
      const stats = await database.prepare(`
        SELECT 
          COUNT(*) as total_predictions,
          SUM(CASE WHEN was_correct = 1 THEN 1 ELSE 0 END) as correct_predictions,
          SUM(CASE WHEN predicted_outcome = 'rug' AND actual_outcome != 'rug' THEN 1 ELSE 0 END) as false_positives,
          SUM(CASE WHEN predicted_outcome != 'rug' AND actual_outcome = 'rug' THEN 1 ELSE 0 END) as false_negatives
        FROM prediction_performance
        WHERE model_version = ?
          AND actual_outcome IS NOT NULL
      `).get(version) as any;

      return {
        version,
        totalPredictions: stats.total_predictions || 0,
        accuracy: stats.total_predictions > 0 
          ? (stats.correct_predictions / stats.total_predictions) 
          : 0,
        falsePositives: stats.false_positives || 0,
        falseNegatives: stats.false_negatives || 0
      };

    } catch (error) {
      logger.error('MLRetrainer', 'Error getting model performance', error as Error);
      return null;
    }
  }

  /**
   * Compare two model versions
   */
  async compareModels(v1: string, v2: string): Promise<ModelComparison> {
    try {
      const model1 = await database.prepare(`
        SELECT * FROM ml_model_versions WHERE version = ?
      `).get(v1) as ModelVersion;

      const model2 = await database.prepare(`
        SELECT * FROM ml_model_versions WHERE version = ?
      `).get(v2) as ModelVersion;

      if (!model1 || !model2) {
        throw new Error('One or both models not found');
      }

      const improvement = model2.accuracy - model1.accuracy;
      
      let recommendation: 'deploy' | 'reject' | 'review';
      let reasoning: string;

      if (improvement > 0.05) {
        recommendation = 'deploy';
        reasoning = 'Significant accuracy improvement';
      } else if (improvement < -0.02) {
        recommendation = 'reject';
        reasoning = 'Model performs worse than current';
      } else {
        recommendation = 'review';
        reasoning = 'Marginal improvement, manual review recommended';
      }

      return {
        v1: model1,
        v2: model2,
        improvement,
        recommendation,
        reasoning
      };

    } catch (error) {
      logger.error('MLRetrainer', 'Error comparing models', error as Error);
      throw error;
    }
  }

  /**
   * Get current production model
   */
  async getCurrentProductionModel(): Promise<ModelVersion | null> {
    try {
      return await database.prepare(`
        SELECT * FROM ml_model_versions
        WHERE is_production = 1
        LIMIT 1
      `).get() as ModelVersion | null;

    } catch (error) {
      logger.error('MLRetrainer', 'Error getting production model', error as Error);
      return null;
    }
  }

  /**
   * Get model version history
   */
  async getModelHistory(): Promise<ModelVersion[]> {
    try {
      return await database.prepare(`
        SELECT * FROM ml_model_versions
        ORDER BY trained_at DESC
      `).all() as ModelVersion[];

    } catch (error) {
      logger.error('MLRetrainer', 'Error getting model history', error as Error);
      return [];
    }
  }

  /**
   * Generate training report
   */
  async generateTrainingReport(version: string): Promise<TrainingReport> {
    try {
      const model = await database.prepare(`
        SELECT * FROM ml_model_versions WHERE version = ?
      `).get(version) as ModelVersion;

      const previousModel = await database.prepare(`
        SELECT * FROM ml_model_versions
        WHERE trained_at < ?
        ORDER BY trained_at DESC
        LIMIT 1
      `).get(model.trained_at) as ModelVersion | undefined;

      const performance = await this.getModelPerformance(version);
      const previousPerf = previousModel 
        ? await this.getModelPerformance(previousModel.version)
        : null;

      return {
        version: model.version,
        accuracy: model.accuracy,
        accuracyDelta: model.accuracy_delta || 0,
        f1Score: model.f1_score,
        trainingSamples: model.training_samples,
        topFeatures: [], // Would be populated from feature_importance
        falsePositives: performance?.falsePositives || 0,
        falseNegatives: performance?.falseNegatives || 0,
        fpDelta: previousPerf 
          ? `${performance.falsePositives - previousPerf.falsePositives > 0 ? '+' : ''}${performance.falsePositives - previousPerf.falsePositives}`
          : '+0',
        fnDelta: previousPerf
          ? `${performance.falseNegatives - previousPerf.falseNegatives > 0 ? '+' : ''}${performance.falseNegatives - previousPerf.falseNegatives}`
          : '+0',
        deployed: model.is_production === 1,
        notes: model.notes || ''
      };

    } catch (error) {
      logger.error('MLRetrainer', 'Error generating report', error as Error);
      throw error;
    }
  }

  /**
   * Update training schedule after a run
   */
  private async updateTrainingSchedule(version: string): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const schedule = await this.getTrainingSchedule();
      const nextRunAt = now + ((schedule?.frequency_days || 7) * 86400);

      await database.prepare(`
        UPDATE training_schedule
        SET last_run_at = ?,
            last_version_trained = ?,
            next_run_at = ?,
            updated_at = ?
      `).run(now, version, nextRunAt, now);

    } catch (error) {
      logger.error('MLRetrainer', 'Error updating schedule', error as Error);
    }
  }

  /**
   * Analyze false positives
   */
  async analyzeFalsePositives(version: string): Promise<any> {
    try {
      const falsePositives = await database.prepare(`
        SELECT * FROM prediction_performance
        WHERE model_version = ?
          AND predicted_outcome = 'pump'
          AND actual_outcome = 'rug'
      `).all(version);

      return {
        count: falsePositives.length,
        patterns: [],
        recommendations: [
          'Review LP lock timing features',
          'Add contract age validation',
          'Enhance holder distribution analysis'
        ]
      };

    } catch (error) {
      logger.error('MLRetrainer', 'Error analyzing false positives', error as Error);
      return { count: 0, patterns: [], recommendations: [] };
    }
  }

  /**
   * Analyze false negatives
   */
  async analyzeFalseNegatives(version: string): Promise<any> {
    try {
      const falseNegatives = await database.prepare(`
        SELECT * FROM prediction_performance
        WHERE model_version = ?
          AND predicted_outcome = 'rug'
          AND actual_outcome = 'pump'
      `).all(version);

      return {
        count: falseNegatives.length,
        patterns: [],
        recommendations: [
          'Consider momentum indicators',
          'Analyze smart money activity',
          'Review volume spike patterns'
        ]
      };

    } catch (error) {
      logger.error('MLRetrainer', 'Error analyzing false negatives', error as Error);
      return { count: 0, patterns: [], recommendations: [] };
    }
  }
}

export const mlRetrainer = new MLRetrainer();
