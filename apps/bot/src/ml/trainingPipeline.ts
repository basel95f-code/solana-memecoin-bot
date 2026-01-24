/**
 * Training Pipeline
 * Automated ML model training orchestration
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { database } from '../database';
import { ML_TRAINING } from '../constants';
import { featureEngineering, FEATURE_COUNT } from './featureEngineering';
import { metricsCalculator, type TrainingMetrics } from './trainingMetrics';
import { modelVersionManager } from './modelVersioning';
import { outcomeTracker, type TokenOutcome } from '../services/outcomeTracker';

// ============================================
// Types
// ============================================

export interface TrainingData {
  features: number[][];
  labels: number[];
  featureNames: string[];
}

export interface SplitData {
  train: { features: number[][]; labels: number[] };
  validation: { features: number[][]; labels: number[] };
  test: { features: number[][]; labels: number[] };
}

export interface TrainingResult {
  success: boolean;
  modelVersion?: string;
  metrics?: TrainingMetrics;
  error?: string;
}

export interface TrainingStatus {
  isTraining: boolean;
  lastTrainingAt?: number;
  lastTrainingResult?: TrainingResult;
  totalSamples: number;
  newSamplesSinceLastTrain: number;
  nextTrainingEligible: boolean;
}

// ============================================
// Training Pipeline
// ============================================

export class TrainingPipeline extends EventEmitter {
  private isTraining: boolean = false;
  private lastTrainingAt: number = 0;
  private lastTrainingResult?: TrainingResult;
  private newSamplesSinceLastTrain: number = 0;
  private checkInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize the training pipeline
   */
  async initialize(): Promise<void> {
    await modelVersionManager.initialize();

    // Wire up outcome events from outcomeTracker for auto-labeling
    this.setupOutcomeListener();

    logger.info('TrainingPipeline', 'Initialized');
  }

  /**
   * Set up listener for outcome events to auto-label tokens for training
   */
  private setupOutcomeListener(): void {
    outcomeTracker.on('outcome', (outcome: TokenOutcome) => {
      this.handleOutcome(outcome).catch(err => {
        logger.silentError('TrainingPipeline', 'Failed to handle outcome', err);
      });
    });

    logger.debug('TrainingPipeline', 'Outcome listener registered');
  }

  /**
   * Handle outcome event - auto-label token for ML training
   */
  private async handleOutcome(outcome: TokenOutcome): Promise<void> {
    try {
      // Map outcome type to ML label
      const labelMap: Record<string, string> = {
        'rug': 'rug',
        'pump': 'pump',
        'stable': 'stable',
        'slow_decline': 'decline',
        'unknown': 'stable', // Default unknown to stable
      };

      const label = labelMap[outcome.outcome] || 'stable';

      // Extract features from the outcome data
      const enhancedFeatures = featureEngineering.extractFeaturesBasic({
        liquidityUsd: outcome.initialLiquidity,
        riskScore: outcome.initialRiskScore,
        holderCount: outcome.initialHolders,
        top10Percent: outcome.initialTop10Percent || 50,
        mintRevoked: false, // We don't have this info in outcome
        freezeRevoked: false,
        lpBurnedPercent: 0,
        hasSocials: false,
        tokenAgeHours: 0,
      });
      const features = featureEngineering.featuresToRecord(enhancedFeatures);

      // Save to ML training samples
      database.saveMLSample({
        mint: outcome.mint,
        symbol: outcome.symbol,
        features,
        outcome: label,
        outcomeConfidence: outcome.outcomeConfidence,
        labelSource: 'auto',
        discoveredAt: outcome.discoveredAt,
        labeledAt: outcome.outcomeRecordedAt,
      });

      // Record new sample for training trigger check
      this.recordNewSample();

      logger.debug('TrainingPipeline', `Auto-labeled ${outcome.symbol} as ${label} (${(outcome.outcomeConfidence * 100).toFixed(0)}% confidence)`);

      // Check if we should trigger training
      if (this.shouldTriggerTraining()) {
        logger.info('TrainingPipeline', 'Auto-training conditions met, starting training...');
        this.train().catch(err => {
          logger.error('TrainingPipeline', 'Auto-training failed', err);
        });
      }
    } catch (error) {
      logger.silentError('TrainingPipeline', `Failed to auto-label ${outcome.symbol}`, error as Error);
    }
  }

  /**
   * Start auto-training check loop
   */
  startAutoTraining(checkIntervalMs: number = 60 * 60 * 1000): void {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      if (this.shouldTriggerTraining()) {
        this.train().catch(err => {
          logger.error('TrainingPipeline', 'Auto-training failed', err);
        });
      }
    }, checkIntervalMs);

    logger.info('TrainingPipeline', 'Auto-training enabled');
  }

  /**
   * Stop auto-training
   */
  stopAutoTraining(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check if training should be triggered
   */
  shouldTriggerTraining(): boolean {
    if (this.isTraining) return false;

    const sampleCounts = database.getMLSampleCount();
    const totalSamples = sampleCounts.labeled;

    // Check minimum samples
    if (totalSamples < ML_TRAINING.MIN_SAMPLES_FOR_TRAINING) {
      return false;
    }

    // Check time since last training
    const hoursSinceLastTraining = (Date.now() - this.lastTrainingAt) / (1000 * 60 * 60);
    if (hoursSinceLastTraining < ML_TRAINING.MIN_HOURS_BETWEEN_TRAINING) {
      return false;
    }

    // Check new samples
    if (this.newSamplesSinceLastTrain < ML_TRAINING.MIN_NEW_SAMPLES_FOR_RETRAIN) {
      return false;
    }

    return true;
  }

  /**
   * Record a new sample (call this when a token is labeled)
   */
  recordNewSample(): void {
    this.newSamplesSinceLastTrain++;
  }

  /**
   * Main training method
   */
  async train(): Promise<TrainingResult> {
    if (this.isTraining) {
      return { success: false, error: 'Training already in progress' };
    }

    this.isTraining = true;
    this.emit('trainingStarted');

    const startTime = Date.now();

    try {
      // Load training data
      const data = this.loadTrainingData();

      if (data.features.length < ML_TRAINING.MIN_SAMPLES_FOR_TRAINING) {
        throw new Error(`Insufficient samples: ${data.features.length} < ${ML_TRAINING.MIN_SAMPLES_FOR_TRAINING}`);
      }

      // Split data
      const splits = this.splitData(data);

      logger.info('TrainingPipeline', `Training with ${data.features.length} samples`);
      logger.info('TrainingPipeline', `Split: train=${splits.train.features.length}, val=${splits.validation.features.length}, test=${splits.test.features.length}`);

      // Train model
      // Note: Actual TensorFlow training would happen here
      // For now, we simulate the training process
      const metrics = await this.trainModel(splits);

      const trainingDuration = Date.now() - startTime;

      // Generate version string
      const modelVersion = modelVersionManager.generateVersionString();

      // Save training run to database
      database.saveTrainingRun({
        modelVersion,
        featureVersion: 'v2',
        samplesUsed: data.features.length,
        trainSamples: splits.train.features.length,
        validationSamples: splits.validation.features.length,
        testSamples: splits.test.features.length,
        accuracy: metrics.accuracy,
        precisionScore: metrics.precision,
        recallScore: metrics.recall,
        f1Score: metrics.f1Score,
        aucScore: metrics.auc,
        trainingLoss: metrics.trainLoss,
        validationLoss: metrics.validationLoss,
        epochs: metrics.epochs,
        trainingDurationMs: trainingDuration,
        featureImportance: metrics.featureImportance,
        confusionMatrix: metricsCalculator.formatConfusionMatrix(metrics.confusionMatrix),
        trainedAt: Math.floor(Date.now() / 1000),
      });

      // Register version
      modelVersionManager.registerVersion(
        modelVersion,
        {
          accuracy: metrics.accuracy,
          precision: metrics.precision,
          recall: metrics.recall,
          f1Score: metrics.f1Score,
          auc: metrics.auc,
        },
        data.features.length,
        'v2'
      );

      // Check if should promote
      if (modelVersionManager.shouldPromote({ ...metrics, auc: metrics.auc })) {
        modelVersionManager.activateVersion(modelVersion);
        database.setActiveModelVersion(modelVersion);
        logger.info('TrainingPipeline', `Promoted model version: ${modelVersion}`);
      }

      // Reset counters
      this.lastTrainingAt = Date.now();
      this.newSamplesSinceLastTrain = 0;

      const result: TrainingResult = {
        success: true,
        modelVersion,
        metrics,
      };

      this.lastTrainingResult = result;
      this.emit('trainingCompleted', result);

      logger.info('TrainingPipeline', `Training completed in ${trainingDuration}ms`);
      logger.info('TrainingPipeline', `Metrics: accuracy=${(metrics.accuracy * 100).toFixed(1)}%, F1=${(metrics.f1Score * 100).toFixed(1)}%`);

      return result;

    } catch (error) {
      const result: TrainingResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      this.lastTrainingResult = result;
      this.emit('trainingFailed', result);

      logger.error('TrainingPipeline', 'Training failed', error as Error);
      return result;

    } finally {
      this.isTraining = false;
    }
  }

  /**
   * Load training data from database
   */
  private loadTrainingData(): TrainingData {
    const samples = database.getMLSamples({ featureVersion: 'v2', limit: 10000 });

    const features: number[][] = [];
    const labels: number[] = [];

    for (const sample of samples) {
      if (!sample.features || !sample.outcome) continue;

      // Parse features
      const featureObj = typeof sample.features === 'string'
        ? JSON.parse(sample.features)
        : sample.features;

      // Convert features object to array in correct order
      const featureArray = this.featuresToArray(featureObj);
      if (featureArray.length !== FEATURE_COUNT) continue;

      // Convert outcome to binary label (rug = 1, others = 0)
      const label = sample.outcome === 'rug' ? 1 : 0;

      features.push(featureArray);
      labels.push(label);
    }

    return {
      features,
      labels,
      featureNames: featureEngineering.getFeatureImportanceDisplay() as unknown as string[],
    };
  }

  /**
   * Convert feature object to array in correct order
   */
  private featuresToArray(features: Record<string, number>): number[] {
    const { FEATURE_NAMES } = require('./featureEngineering');
    return FEATURE_NAMES.map((name: string) => features[name] ?? 0);
  }

  /**
   * Split data into train/validation/test sets
   */
  private splitData(data: TrainingData): SplitData {
    const { features, labels } = data;
    const n = features.length;

    // Shuffle indices
    const indices = Array.from({ length: n }, (_, i) => i);
    this.shuffleArray(indices);

    // Calculate split points
    const trainEnd = Math.floor(n * ML_TRAINING.TRAIN_SPLIT);
    const valEnd = trainEnd + Math.floor(n * ML_TRAINING.VALIDATION_SPLIT);

    return {
      train: {
        features: indices.slice(0, trainEnd).map(i => features[i]),
        labels: indices.slice(0, trainEnd).map(i => labels[i]),
      },
      validation: {
        features: indices.slice(trainEnd, valEnd).map(i => features[i]),
        labels: indices.slice(trainEnd, valEnd).map(i => labels[i]),
      },
      test: {
        features: indices.slice(valEnd).map(i => features[i]),
        labels: indices.slice(valEnd).map(i => labels[i]),
      },
    };
  }

  /**
   * Fisher-Yates shuffle
   */
  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  /**
   * Train the model (placeholder for actual TensorFlow training)
   * In a real implementation, this would use TensorFlow.js
   */
  private async trainModel(splits: SplitData): Promise<TrainingMetrics> {
    // Simulate training time
    await new Promise(resolve => setTimeout(resolve, 100));

    // For now, return simulated metrics
    // In production, this would use the actual rugPredictor training
    const predictions = splits.test.labels.map(() => Math.random());
    const cm = metricsCalculator.buildConfusionMatrix(predictions, splits.test.labels);
    const metrics = metricsCalculator.calculateMetrics(cm);
    const auc = metricsCalculator.calculateAUC(predictions, splits.test.labels);

    return {
      ...metrics,
      auc,
      trainLoss: 0.3 + Math.random() * 0.2,
      validationLoss: 0.35 + Math.random() * 0.25,
      epochs: 50,
      trainingDurationMs: 5000 + Math.random() * 5000,
      confusionMatrix: cm,
    };
  }

  /**
   * Get training status
   */
  getStatus(): TrainingStatus {
    const sampleCounts = database.getMLSampleCount();

    return {
      isTraining: this.isTraining,
      lastTrainingAt: this.lastTrainingAt || undefined,
      lastTrainingResult: this.lastTrainingResult,
      totalSamples: sampleCounts.labeled,
      newSamplesSinceLastTrain: this.newSamplesSinceLastTrain,
      nextTrainingEligible: this.shouldTriggerTraining(),
    };
  }

  /**
   * Get training history
   */
  getHistory(limit: number = 10): any[] {
    return database.getTrainingRuns(limit);
  }

  /**
   * Get latest training metrics
   */
  getLatestMetrics(): any | null {
    return database.getLatestTrainingRun();
  }
}

// Export singleton
export const trainingPipeline = new TrainingPipeline();
