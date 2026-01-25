/**
 * ML Training Pipeline
 * Automated training workflow with data collection, validation, and evaluation
 */

import * as tf from '@tensorflow/tfjs';
import { logger } from '../../utils/logger';
import { database } from '../../database';
import { featureEngineering, FEATURE_NAMES } from '../featureEngineering';
import { pricePredictionModel } from '../pricePrediction';
import { sentimentCorrelationModel } from '../sentimentCorrelation';
import { whaleBehaviorModel } from '../whaleBehavior';
import { rugPredictor } from '../rugPredictor';
import type { EnhancedFeatures } from '../featureEngineering';

export interface TrainingConfig {
  model: 'price_prediction' | 'sentiment_correlation' | 'whale_behavior' | 'rug_prediction';
  timeframe?: '1h' | '6h' | '24h';
  epochs?: number;
  batchSize?: number;
  validationSplit?: number;
  minSamples?: number;
  autoRetrain?: boolean;
  retrainInterval?: number; // hours
}

export interface TrainingResult {
  success: boolean;
  modelType: string;
  samplesUsed: number;
  trainingTime: number; // seconds
  metrics: {
    loss: number;
    accuracy?: number;
    mae?: number;
    validationLoss?: number;
    validationAccuracy?: number;
  };
  dataQuality: {
    totalSamples: number;
    trainingSamples: number;
    validationSamples: number;
    classBalance?: Record<string, number>;
  };
  hyperparameters: {
    epochs: number;
    batchSize: number;
    learningRate: number;
  };
  timestamp: Date;
}

export interface DataQualityReport {
  totalRecords: number;
  validRecords: number;
  missingValues: Record<string, number>;
  outliers: Record<string, number>;
  classDistribution?: Record<string, number>;
  featureStats: Record<string, {
    mean: number;
    std: number;
    min: number;
    max: number;
  }>;
}

class MLTrainingPipeline {
  private isTraining: Map<string, boolean> = new Map();
  private trainingHistory: Map<string, TrainingResult[]> = new Map();
  private lastTrainingTime: Map<string, number> = new Map();

  /**
   * Train a specific model with full pipeline
   */
  async trainModel(config: TrainingConfig): Promise<TrainingResult> {
    const modelKey = `${config.model}${config.timeframe ? `_${config.timeframe}` : ''}`;

    if (this.isTraining.get(modelKey)) {
      throw new Error(`${modelKey} is already training`);
    }

    this.isTraining.set(modelKey, true);
    const startTime = Date.now();

    try {
      logger.info('TrainingPipeline', `Starting training for ${modelKey}`);

      // Step 1: Collect and prepare data
      const data = await this.collectTrainingData(config);
      
      if (data.samples.length < (config.minSamples || 100)) {
        throw new Error(`Insufficient data: ${data.samples.length} samples (need ${config.minSamples || 100}+)`);
      }

      // Step 2: Validate data quality
      const qualityReport = this.validateDataQuality(data.samples, data.labels);
      logger.info('TrainingPipeline', `Data quality: ${qualityReport.validRecords}/${qualityReport.totalRecords} valid`);

      // Step 3: Split data
      const split = this.splitData(
        data.samples,
        data.labels,
        config.validationSplit || 0.15,
        0.15 // test split
      );

      // Step 4: Train model
      const metrics = await this.executeTraining(config, split);

      // Step 5: Evaluate model
      const evaluation = await this.evaluateModel(config, split.test);

      // Step 6: Save training results
      const trainingTime = (Date.now() - startTime) / 1000;
      
      const result: TrainingResult = {
        success: true,
        modelType: modelKey,
        samplesUsed: data.samples.length,
        trainingTime,
        metrics: {
          ...metrics,
          ...evaluation,
        },
        dataQuality: {
          totalSamples: data.samples.length,
          trainingSamples: split.train.features.length,
          validationSamples: split.validation.features.length,
          classBalance: qualityReport.classDistribution,
        },
        hyperparameters: {
          epochs: config.epochs || 100,
          batchSize: config.batchSize || 32,
          learningRate: 0.001,
        },
        timestamp: new Date(),
      };

      // Record in history
      this.recordTrainingResult(modelKey, result);

      // Save to database
      await this.saveTrainingResult(result);

      logger.info('TrainingPipeline', 
        `Training complete for ${modelKey}: accuracy=${(result.metrics.accuracy || 0) * 100}%, time=${trainingTime}s`
      );

      return result;
    } catch (error) {
      logger.error('TrainingPipeline', `Training failed for ${modelKey}`, error as Error);
      
      return {
        success: false,
        modelType: modelKey,
        samplesUsed: 0,
        trainingTime: (Date.now() - startTime) / 1000,
        metrics: { loss: 0 },
        dataQuality: {
          totalSamples: 0,
          trainingSamples: 0,
          validationSamples: 0,
        },
        hyperparameters: {
          epochs: config.epochs || 100,
          batchSize: config.batchSize || 32,
          learningRate: 0.001,
        },
        timestamp: new Date(),
      };
    } finally {
      this.isTraining.set(modelKey, false);
    }
  }

  /**
   * Collect training data from database
   */
  private async collectTrainingData(config: TrainingConfig): Promise<{
    samples: number[][];
    labels: number[][];
  }> {
    // Query historical data based on model type
    const query = this.getDataQuery(config);
    const rows = database.query(query);

    const samples: number[][] = [];
    const labels: number[][] = [];

    for (const row of rows as any[]) {
      // Extract features
      const features = this.extractFeaturesFromRow(row);
      if (features) {
        samples.push(features);
        
        // Extract label based on model type
        const label = this.extractLabelFromRow(row, config);
        if (label) {
          labels.push(label);
        }
      }
    }

    return { samples, labels };
  }

  /**
   * Get database query for training data
   */
  private getDataQuery(config: TrainingConfig): string {
    switch (config.model) {
      case 'price_prediction':
        return `
          SELECT * FROM ml_training_data
          WHERE has_outcome = true
          AND price_change_${config.timeframe || '1h'} IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 10000
        `;
      
      case 'sentiment_correlation':
        return `
          SELECT * FROM ml_training_data
          WHERE has_outcome = true
          AND sentiment_score IS NOT NULL
          AND price_change_1h IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 10000
        `;
      
      case 'whale_behavior':
        return `
          SELECT * FROM ml_training_data
          WHERE has_outcome = true
          AND whale_action IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 10000
        `;
      
      case 'rug_prediction':
      default:
        return `
          SELECT * FROM ml_training_data
          WHERE has_outcome = true
          ORDER BY created_at DESC
          LIMIT 10000
        `;
    }
  }

  /**
   * Extract features from database row
   */
  private extractFeaturesFromRow(row: any): number[] | null {
    try {
      // Parse features JSON if stored as JSON
      if (row.features_json) {
        return JSON.parse(row.features_json);
      }

      // Or construct from individual columns
      const features: Record<string, number> = {};
      for (const featureName of FEATURE_NAMES) {
        if (row[featureName] !== undefined) {
          features[featureName] = Number(row[featureName]);
        }
      }

      // Normalize
      const enhancedFeatures = features as unknown as EnhancedFeatures;
      const normalized = featureEngineering.normalizeFeatures(enhancedFeatures);
      return normalized.features;
    } catch (error) {
      logger.error('TrainingPipeline', 'Failed to extract features', error as Error);
      return null;
    }
  }

  /**
   * Extract label from database row
   */
  private extractLabelFromRow(row: any, config: TrainingConfig): number[] | null {
    try {
      switch (config.model) {
        case 'price_prediction': {
          const change = row[`price_change_${config.timeframe || '1h'}`];
          if (change === null || change === undefined) return null;
          
          // One-hot encode: [down, sideways, up]
          const label = [0, 0, 0];
          if (change > 10) label[2] = 1;      // up
          else if (change < -10) label[0] = 1; // down
          else label[1] = 1;                   // sideways
          return label;
        }

        case 'sentiment_correlation': {
          const priceChange = row.price_change_1h;
          if (priceChange === null || priceChange === undefined) return null;
          return [priceChange]; // Regression target
        }

        case 'whale_behavior': {
          const action = row.whale_action;
          if (!action) return null;
          
          // One-hot encode: [accumulation, distribution, dump, holding]
          const label = [0, 0, 0, 0];
          const actionMap: Record<string, number> = {
            accumulation: 0,
            distribution: 1,
            dump: 2,
            holding: 3,
          };
          label[actionMap[action] || 3] = 1;
          return label;
        }

        case 'rug_prediction':
        default: {
          const outcome = row.outcome;
          return outcome === 'rug' ? [1] : [0];
        }
      }
    } catch (error) {
      logger.error('TrainingPipeline', 'Failed to extract label', error as Error);
      return null;
    }
  }

  /**
   * Validate data quality
   */
  private validateDataQuality(samples: number[][], labels: number[][]): DataQualityReport {
    const totalRecords = samples.length;
    let validRecords = 0;
    const missingValues: Record<string, number> = {};
    const outliers: Record<string, number> = {};
    const classDistribution: Record<string, number> = {};

    // Count valid records and missing values
    for (let i = 0; i < samples.length; i++) {
      let isValid = true;
      
      for (let j = 0; j < samples[i].length; j++) {
        const value = samples[i][j];
        
        if (isNaN(value) || value === null || value === undefined) {
          const featureName = FEATURE_NAMES[j] || `feature_${j}`;
          missingValues[featureName] = (missingValues[featureName] || 0) + 1;
          isValid = false;
        }
      }

      if (isValid) validRecords++;
    }

    // Analyze class distribution for classification
    if (labels.length > 0 && labels[0].length > 1) {
      labels.forEach(label => {
        const classIndex = label.indexOf(1);
        const className = `class_${classIndex}`;
        classDistribution[className] = (classDistribution[className] || 0) + 1;
      });
    }

    // Calculate feature statistics
    const featureStats: Record<string, { mean: number; std: number; min: number; max: number }> = {};
    
    for (let j = 0; j < (samples[0]?.length || 0); j++) {
      const values = samples.map(s => s[j]).filter(v => !isNaN(v));
      
      if (values.length > 0) {
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        const std = Math.sqrt(variance);
        const min = Math.min(...values);
        const max = Math.max(...values);

        const featureName = FEATURE_NAMES[j] || `feature_${j}`;
        featureStats[featureName] = { mean, std, min, max };

        // Detect outliers (>3 std deviations)
        const outlierCount = values.filter(v => Math.abs(v - mean) > 3 * std).length;
        if (outlierCount > 0) {
          outliers[featureName] = outlierCount;
        }
      }
    }

    return {
      totalRecords,
      validRecords,
      missingValues,
      outliers,
      classDistribution,
      featureStats,
    };
  }

  /**
   * Split data into train/validation/test sets
   */
  private splitData(
    samples: number[][],
    labels: number[][],
    validationSplit: number,
    testSplit: number
  ): {
    train: { features: number[][]; labels: number[][] };
    validation: { features: number[][]; labels: number[][] };
    test: { features: number[][]; labels: number[][] };
  } {
    // Shuffle data
    const indices = Array.from({ length: samples.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    const shuffledSamples = indices.map(i => samples[i]);
    const shuffledLabels = indices.map(i => labels[i]);

    // Calculate split sizes
    const totalSize = samples.length;
    const testSize = Math.floor(totalSize * testSplit);
    const validationSize = Math.floor(totalSize * validationSplit);
    const trainSize = totalSize - testSize - validationSize;

    return {
      train: {
        features: shuffledSamples.slice(0, trainSize),
        labels: shuffledLabels.slice(0, trainSize),
      },
      validation: {
        features: shuffledSamples.slice(trainSize, trainSize + validationSize),
        labels: shuffledLabels.slice(trainSize, trainSize + validationSize),
      },
      test: {
        features: shuffledSamples.slice(trainSize + validationSize),
        labels: shuffledLabels.slice(trainSize + validationSize),
      },
    };
  }

  /**
   * Execute model training
   */
  private async executeTraining(
    config: TrainingConfig,
    data: ReturnType<typeof this.splitData>
  ): Promise<{ loss: number; accuracy?: number; mae?: number }> {
    switch (config.model) {
      case 'price_prediction':
        const priceResult = await pricePredictionModel.train(config.timeframe || '1h', {
          epochs: config.epochs,
          batchSize: config.batchSize,
        });
        return {
          loss: priceResult.finalLoss,
          accuracy: priceResult.finalAccuracy,
        };

      case 'sentiment_correlation':
        const sentimentResult = await sentimentCorrelationModel.train({
          epochs: config.epochs,
          batchSize: config.batchSize,
        });
        return {
          loss: sentimentResult.finalLoss,
          mae: sentimentResult.finalMAE,
        };

      case 'whale_behavior':
        const whaleResult = await whaleBehaviorModel.train({
          epochs: config.epochs,
          batchSize: config.batchSize,
        });
        return {
          loss: whaleResult.finalLoss,
          accuracy: whaleResult.finalAccuracy,
        };

      case 'rug_prediction':
      default:
        const rugResult = await rugPredictor.train({
          epochs: config.epochs,
          batchSize: config.batchSize,
        });
        return {
          loss: rugResult.finalLoss,
          accuracy: rugResult.finalAccuracy,
        };
    }
  }

  /**
   * Evaluate model on test set
   */
  private async evaluateModel(
    config: TrainingConfig,
    testData: { features: number[][]; labels: number[][] }
  ): Promise<{ validationLoss: number; validationAccuracy?: number }> {
    // This would evaluate the model on test data
    // For now, returning placeholder values
    return {
      validationLoss: 0,
      validationAccuracy: 0,
    };
  }

  /**
   * Record training result in history
   */
  private recordTrainingResult(modelKey: string, result: TrainingResult): void {
    if (!this.trainingHistory.has(modelKey)) {
      this.trainingHistory.set(modelKey, []);
    }

    this.trainingHistory.get(modelKey)!.push(result);
    this.lastTrainingTime.set(modelKey, Date.now());

    // Keep only last 50 results
    const history = this.trainingHistory.get(modelKey)!;
    if (history.length > 50) {
      history.shift();
    }
  }

  /**
   * Save training result to database
   */
  private async saveTrainingResult(result: TrainingResult): Promise<void> {
    try {
      database.query(
        `INSERT INTO ml_models (
          model_type, version, accuracy, loss,
          training_samples, training_time_seconds,
          hyperparameters, metrics, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.modelType,
          `v${Date.now()}`,
          result.metrics.accuracy || null,
          result.metrics.loss,
          result.samplesUsed,
          result.trainingTime,
          JSON.stringify(result.hyperparameters),
          JSON.stringify(result.metrics),
          result.timestamp,
        ]
      );
    } catch (error) {
      logger.error('TrainingPipeline', 'Failed to save training result', error as Error);
    }
  }

  /**
   * Check if model needs retraining
   */
  needsRetraining(modelKey: string, intervalHours: number = 24): boolean {
    const lastTime = this.lastTrainingTime.get(modelKey);
    if (!lastTime) return true;

    const hoursSince = (Date.now() - lastTime) / (1000 * 60 * 60);
    return hoursSince >= intervalHours;
  }

  /**
   * Get training history for a model
   */
  getTrainingHistory(modelKey: string): TrainingResult[] {
    return this.trainingHistory.get(modelKey) || [];
  }

  /**
   * Get training statistics
   */
  getStats(): Record<string, any> {
    const stats: Record<string, any> = {};

    for (const [modelKey, history] of this.trainingHistory.entries()) {
      const latestResult = history[history.length - 1];
      stats[modelKey] = {
        totalTrainings: history.length,
        lastTraining: latestResult?.timestamp,
        latestAccuracy: latestResult?.metrics.accuracy,
        latestLoss: latestResult?.metrics.loss,
        isTraining: this.isTraining.get(modelKey) || false,
      };
    }

    return stats;
  }
}

export const mlTrainingPipeline = new MLTrainingPipeline();
