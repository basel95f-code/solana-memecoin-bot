/**
 * Auto Trainer
 * Intelligent training orchestrator with A/B testing and auto-deployment
 * 
 * Trigger conditions:
 * - 1000+ new samples collected
 * - Weekly schedule (Sunday 3 AM)
 * - Manual trigger via command
 * - Performance degradation detected
 */

import { EventEmitter } from 'events';
import * as tf from '@tensorflow/tfjs';
import path from 'path';
import fs from 'fs';
import { logger } from '../../utils/logger';
import { database } from '../../database';
import { FEATURE_COUNT, FEATURE_NAMES } from '../dataCollection/FeatureExtractor';
import { ModelEvaluator, modelEvaluator, type ModelComparison } from './ModelEvaluator';
import { dataQualityChecker } from '../monitoring/DataQualityChecker';
import { distributionMonitor } from '../monitoring/DistributionMonitor';

// ============================================
// Configuration
// ============================================

const CONFIG = {
  // Training triggers
  MIN_NEW_SAMPLES: 1000,
  MIN_HOURS_BETWEEN_TRAINING: 24,
  SCHEDULED_DAY: 0, // Sunday
  SCHEDULED_HOUR: 3, // 3 AM
  
  // Training params
  EPOCHS: 100,
  BATCH_SIZE: 32,
  LEARNING_RATE: 0.001,
  EARLY_STOPPING_PATIENCE: 10,
  
  // Data splits
  TRAIN_SPLIT: 0.70,
  VALIDATION_SPLIT: 0.15,
  TEST_SPLIT: 0.15,
  
  // Deployment thresholds
  MIN_IMPROVEMENT_FOR_DEPLOY: 0.05, // 5% improvement required
  MIN_ACCURACY_FOR_DEPLOY: 0.65, // Minimum 65% accuracy
  MIN_F1_FOR_DEPLOY: 0.60, // Minimum 60% F1
  
  // A/B testing
  SHADOW_MODE_DURATION_HOURS: 24,
  SHADOW_MODE_MIN_PREDICTIONS: 100,
  
  // Model storage
  MODEL_DIR: path.join(process.cwd(), 'data', 'models'),
  MAX_MODELS_TO_KEEP: 5,
};

// ============================================
// Types
// ============================================

interface TrainingJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  trigger: 'manual' | 'scheduled' | 'auto' | 'degradation';
  startedAt?: number;
  completedAt?: number;
  error?: string;
  metrics?: {
    accuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
    auc: number;
    trainLoss: number;
    validationLoss: number;
  };
  modelVersion?: string;
  samplesUsed?: number;
  deployed?: boolean;
}

interface ShadowModel {
  version: string;
  modelPath: string;
  model: tf.LayersModel;
  activatedAt: number;
  predictions: Array<{
    mint: string;
    predicted: number;
    actual?: number;
    timestamp: number;
  }>;
}

// ============================================
// Auto Trainer
// ============================================

export class AutoTrainer extends EventEmitter {
  private productionModel: tf.LayersModel | null = null;
  private productionModelVersion: string | null = null;
  private shadowModel: ShadowModel | null = null;
  
  private isTraining: boolean = false;
  private lastTrainingAt: number = 0;
  private newSamplesSinceLastTrain: number = 0;
  private trainingHistory: TrainingJob[] = [];
  
  private checkInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize the auto trainer
   */
  async initialize(): Promise<void> {
    // Ensure model directory exists
    if (!fs.existsSync(CONFIG.MODEL_DIR)) {
      fs.mkdirSync(CONFIG.MODEL_DIR, { recursive: true });
    }
    
    // Load production model
    await this.loadProductionModel();
    
    // Initialize monitors
    await distributionMonitor.initialize();
    
    logger.info('AutoTrainer', `Initialized. Production model: ${this.productionModelVersion || 'none'}`);
  }

  /**
   * Start auto-training monitoring
   */
  startAutoTraining(checkIntervalMs: number = 60 * 60 * 1000): void {
    if (this.checkInterval) return;
    
    this.checkInterval = setInterval(() => {
      this.checkAndTriggerTraining().catch(err => {
        logger.error('AutoTrainer', 'Auto-training check failed', err);
      });
    }, checkIntervalMs);
    
    logger.info('AutoTrainer', 'Auto-training monitoring started');
  }

  /**
   * Stop auto-training monitoring
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
  async checkAndTriggerTraining(): Promise<void> {
    const shouldTrain = await this.shouldTriggerTraining();
    
    if (shouldTrain.trigger) {
      logger.info('AutoTrainer', `Training triggered: ${shouldTrain.reason}`);
      
      await this.train(shouldTrain.reason as TrainingJob['trigger']);
    }
  }

  /**
   * Determine if training should be triggered
   */
  async shouldTriggerTraining(): Promise<{ trigger: boolean; reason: string }> {
    if (this.isTraining) {
      return { trigger: false, reason: 'Training already in progress' };
    }
    
    // Check time since last training
    const hoursSinceLastTraining = (Date.now() - this.lastTrainingAt) / (1000 * 60 * 60);
    if (hoursSinceLastTraining < CONFIG.MIN_HOURS_BETWEEN_TRAINING) {
      return { trigger: false, reason: 'Too soon since last training' };
    }
    
    // Check for scheduled training (Sunday 3 AM)
    const now = new Date();
    if (now.getDay() === CONFIG.SCHEDULED_DAY && 
        now.getHours() === CONFIG.SCHEDULED_HOUR &&
        hoursSinceLastTraining >= 24 * 6) { // At least 6 days since last
      return { trigger: true, reason: 'scheduled' };
    }
    
    // Check sample count
    const sampleCount = this.getNewSampleCount();
    if (sampleCount >= CONFIG.MIN_NEW_SAMPLES) {
      return { trigger: true, reason: 'auto' };
    }
    
    // Check for performance degradation
    const driftReport = await distributionMonitor.checkDrift();
    if (driftReport.retrainingRecommended && driftReport.urgency !== 'none') {
      return { trigger: true, reason: 'degradation' };
    }
    
    return { trigger: false, reason: 'No trigger conditions met' };
  }

  /**
   * Main training method
   */
  async train(trigger: TrainingJob['trigger'] = 'manual'): Promise<TrainingJob> {
    if (this.isTraining) {
      return this.createFailedJob(trigger, 'Training already in progress');
    }
    
    this.isTraining = true;
    const job: TrainingJob = {
      id: `train_${Date.now()}`,
      status: 'running',
      trigger,
      startedAt: Date.now(),
    };
    
    this.emit('trainingStarted', job);
    
    try {
      // Check data quality first
      const qualityReport = await dataQualityChecker.checkQuality();
      if (qualityReport.qualityScore < 50) {
        throw new Error(`Data quality too low: ${qualityReport.qualityScore}/100`);
      }
      
      // Load training data
      const data = await this.loadTrainingData();
      
      if (data.features.length < 100) {
        throw new Error(`Insufficient training data: ${data.features.length} samples`);
      }
      
      job.samplesUsed = data.features.length;
      
      // Split data
      const splits = this.splitData(data.features, data.labels);
      
      logger.info('AutoTrainer', `Training with ${data.features.length} samples (train=${splits.train.features.length})`);
      
      // Train model
      const trainResult = await this.trainModel(splits);
      
      // Generate version
      const modelVersion = `v${Date.now()}`;
      job.modelVersion = modelVersion;
      job.metrics = trainResult.metrics;
      
      // Save model
      const modelPath = path.join(CONFIG.MODEL_DIR, modelVersion);
      await trainResult.model.save(`file://${modelPath}`);
      
      // Compare with production model
      let shouldDeploy = false;
      
      if (this.productionModel) {
        const comparison = await modelEvaluator.compareModels(
          this.productionModel,
          trainResult.model,
          splits.test.features,
          splits.test.labels
        );
        
        shouldDeploy = this.shouldDeployModel(comparison, trainResult.metrics);
        
        // Save comparison to database
        this.saveModelComparison(modelVersion, comparison);
        
        if (shouldDeploy) {
          // Start shadow mode
          await this.startShadowMode(trainResult.model, modelVersion, modelPath);
          logger.info('AutoTrainer', `Model ${modelVersion} deployed to shadow mode`);
        }
      } else {
        // No production model, deploy immediately
        shouldDeploy = trainResult.metrics.accuracy >= CONFIG.MIN_ACCURACY_FOR_DEPLOY;
        
        if (shouldDeploy) {
          await this.promoteModel(trainResult.model, modelVersion);
          job.deployed = true;
          logger.info('AutoTrainer', `Model ${modelVersion} deployed (first model)`);
        }
      }
      
      // Save training run
      this.saveTrainingRun(job, trainResult, splits);
      
      // Cleanup
      this.newSamplesSinceLastTrain = 0;
      this.lastTrainingAt = Date.now();
      
      job.status = 'completed';
      job.completedAt = Date.now();
      
      this.trainingHistory.push(job);
      this.emit('trainingCompleted', job);
      
      // Cleanup old models
      this.cleanupOldModels();
      
      return job;
      
    } catch (error) {
      job.status = 'failed';
      job.error = (error as Error).message;
      job.completedAt = Date.now();
      
      this.trainingHistory.push(job);
      this.emit('trainingFailed', job);
      
      logger.error('AutoTrainer', 'Training failed', error as Error);
      return job;
      
    } finally {
      this.isTraining = false;
    }
  }

  /**
   * Load training data
   */
  private async loadTrainingData(): Promise<{
    features: number[][];
    labels: number[];
  }> {
    const db = database.getDb();
    if (!db) throw new Error('Database not available');
    
    const result = db.exec(`
      SELECT features_json, outcome
      FROM ml_training_data
      WHERE features_json IS NOT NULL
        AND outcome IS NOT NULL
        AND has_outcome = 1
      ORDER BY created_at DESC
      LIMIT 50000
    `);
    
    if (result.length === 0) {
      return { features: [], labels: [] };
    }
    
    const features: number[][] = [];
    const labels: number[] = [];
    
    for (const row of result[0].values) {
      try {
        const featureObj = JSON.parse(row[0] as string);
        const outcome = row[1] as string;
        
        // Convert features to array
        const featureArray = FEATURE_NAMES.map(name => featureObj[name] ?? 0);
        
        // Convert outcome to binary (rug = 1, others = 0)
        const label = outcome === 'rug' ? 1 : 0;
        
        features.push(featureArray);
        labels.push(label);
      } catch {
        continue;
      }
    }
    
    return { features, labels };
  }

  /**
   * Split data into train/validation/test
   */
  private splitData(
    features: number[][], 
    labels: number[]
  ): {
    train: { features: number[][]; labels: number[] };
    validation: { features: number[][]; labels: number[] };
    test: { features: number[][]; labels: number[] };
  } {
    const n = features.length;
    
    // Shuffle indices
    const indices = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    const trainEnd = Math.floor(n * CONFIG.TRAIN_SPLIT);
    const valEnd = trainEnd + Math.floor(n * CONFIG.VALIDATION_SPLIT);
    
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
   * Train the model
   */
  private async trainModel(splits: ReturnType<typeof this.splitData>): Promise<{
    model: tf.LayersModel;
    metrics: TrainingJob['metrics'] & {};
  }> {
    // Create model
    const model = tf.sequential();
    
    model.add(tf.layers.dense({
      inputShape: [FEATURE_COUNT],
      units: 128,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      kernelRegularizer: tf.regularizers.l2({ l2: 0.001 }),
    }));
    model.add(tf.layers.batchNormalization());
    model.add(tf.layers.dropout({ rate: 0.3 }));
    
    model.add(tf.layers.dense({
      units: 64,
      activation: 'relu',
      kernelInitializer: 'heNormal',
    }));
    model.add(tf.layers.dropout({ rate: 0.2 }));
    
    model.add(tf.layers.dense({
      units: 32,
      activation: 'relu',
      kernelInitializer: 'heNormal',
    }));
    
    model.add(tf.layers.dense({
      units: 1,
      activation: 'sigmoid',
    }));
    
    model.compile({
      optimizer: tf.train.adam(CONFIG.LEARNING_RATE),
      loss: 'binaryCrossentropy',
      metrics: ['accuracy'],
    });
    
    // Convert to tensors
    const xTrain = tf.tensor2d(splits.train.features);
    const yTrain = tf.tensor2d(splits.train.labels, [splits.train.labels.length, 1]);
    const xVal = tf.tensor2d(splits.validation.features);
    const yVal = tf.tensor2d(splits.validation.labels, [splits.validation.labels.length, 1]);
    
    // Early stopping
    let bestValLoss = Infinity;
    let patience = CONFIG.EARLY_STOPPING_PATIENCE;
    let bestWeights: tf.Tensor[] | null = null;
    
    // Train
    let trainLoss = 0;
    let validationLoss = 0;
    
    for (let epoch = 0; epoch < CONFIG.EPOCHS; epoch++) {
      const history = await model.fit(xTrain, yTrain, {
        epochs: 1,
        batchSize: CONFIG.BATCH_SIZE,
        validationData: [xVal, yVal],
        shuffle: true,
        verbose: 0,
      });
      
      trainLoss = history.history.loss[0] as number;
      validationLoss = history.history.val_loss[0] as number;
      
      if (validationLoss < bestValLoss) {
        bestValLoss = validationLoss;
        patience = CONFIG.EARLY_STOPPING_PATIENCE;
        bestWeights = model.getWeights().map(w => w.clone());
      } else {
        patience--;
        if (patience <= 0) {
          logger.debug('AutoTrainer', `Early stopping at epoch ${epoch + 1}`);
          break;
        }
      }
      
      if ((epoch + 1) % 10 === 0) {
        logger.debug('AutoTrainer', `Epoch ${epoch + 1}: loss=${trainLoss.toFixed(4)}, val_loss=${validationLoss.toFixed(4)}`);
      }
    }
    
    // Restore best weights
    if (bestWeights) {
      model.setWeights(bestWeights);
      bestWeights.forEach(w => w.dispose());
    }
    
    // Evaluate on test set
    const xTest = tf.tensor2d(splits.test.features);
    const predictions = model.predict(xTest) as tf.Tensor;
    const predArray = await predictions.data();
    const predList = Array.from(predArray);
    
    const metrics = modelEvaluator.calculateMetrics(predList, splits.test.labels);
    
    // Cleanup
    xTrain.dispose();
    yTrain.dispose();
    xVal.dispose();
    yVal.dispose();
    xTest.dispose();
    predictions.dispose();
    
    return {
      model,
      metrics: {
        ...metrics,
        trainLoss,
        validationLoss,
      },
    };
  }

  /**
   * Determine if model should be deployed
   */
  private shouldDeployModel(comparison: ModelComparison, metrics: TrainingJob['metrics']): boolean {
    if (!metrics) return false;
    
    // Check minimum thresholds
    if (metrics.accuracy < CONFIG.MIN_ACCURACY_FOR_DEPLOY) return false;
    if (metrics.f1Score < CONFIG.MIN_F1_FOR_DEPLOY) return false;
    
    // Check if improvement is significant
    if (comparison.accuracyDelta < CONFIG.MIN_IMPROVEMENT_FOR_DEPLOY &&
        comparison.f1Delta < CONFIG.MIN_IMPROVEMENT_FOR_DEPLOY) {
      return false;
    }
    
    // Statistical significance
    if (comparison.pValue !== undefined && comparison.pValue > 0.05) {
      return false; // Not statistically significant
    }
    
    return comparison.winnerVersion === 'challenger';
  }

  /**
   * Start shadow mode for new model
   */
  private async startShadowMode(
    model: tf.LayersModel, 
    version: string, 
    modelPath: string
  ): Promise<void> {
    // Dispose existing shadow model
    if (this.shadowModel) {
      this.shadowModel.model.dispose();
    }
    
    this.shadowModel = {
      version,
      modelPath,
      model,
      activatedAt: Date.now(),
      predictions: [],
    };
    
    this.emit('shadowModeStarted', { version });
  }

  /**
   * Check shadow model performance and potentially promote
   */
  async evaluateShadowModel(): Promise<{ promoted: boolean; reason: string }> {
    if (!this.shadowModel) {
      return { promoted: false, reason: 'No shadow model active' };
    }
    
    const elapsed = Date.now() - this.shadowModel.activatedAt;
    const elapsedHours = elapsed / (1000 * 60 * 60);
    
    // Check if enough time has passed
    if (elapsedHours < CONFIG.SHADOW_MODE_DURATION_HOURS) {
      return { promoted: false, reason: 'Shadow mode still active' };
    }
    
    // Check if enough predictions
    const predictionsWithOutcome = this.shadowModel.predictions.filter(p => p.actual !== undefined);
    if (predictionsWithOutcome.length < CONFIG.SHADOW_MODE_MIN_PREDICTIONS) {
      return { promoted: false, reason: `Not enough predictions: ${predictionsWithOutcome.length}/${CONFIG.SHADOW_MODE_MIN_PREDICTIONS}` };
    }
    
    // Calculate shadow model accuracy
    const correct = predictionsWithOutcome.filter(p => 
      (p.predicted > 0.5 && p.actual === 1) || (p.predicted <= 0.5 && p.actual === 0)
    ).length;
    const shadowAccuracy = correct / predictionsWithOutcome.length;
    
    // Compare with production model
    // (In a real implementation, we'd track production predictions too)
    
    if (shadowAccuracy >= CONFIG.MIN_ACCURACY_FOR_DEPLOY) {
      await this.promoteModel(this.shadowModel.model, this.shadowModel.version);
      return { promoted: true, reason: `Shadow accuracy: ${(shadowAccuracy * 100).toFixed(1)}%` };
    }
    
    // Rollback shadow model
    this.shadowModel.model.dispose();
    this.shadowModel = null;
    
    return { promoted: false, reason: `Shadow accuracy too low: ${(shadowAccuracy * 100).toFixed(1)}%` };
  }

  /**
   * Promote model to production
   */
  private async promoteModel(model: tf.LayersModel, version: string): Promise<void> {
    // Dispose old production model
    if (this.productionModel) {
      this.productionModel.dispose();
    }
    
    this.productionModel = model;
    this.productionModelVersion = version;
    
    // Update database
    this.setActiveModelVersion(version);
    
    // Clear shadow model if it was the same
    if (this.shadowModel?.version === version) {
      this.shadowModel = null;
    }
    
    this.emit('modelPromoted', { version });
    logger.info('AutoTrainer', `Model ${version} promoted to production`);
  }

  /**
   * Load production model from disk
   */
  private async loadProductionModel(): Promise<void> {
    try {
      const activeVersion = this.getActiveModelVersion();
      if (!activeVersion) return;
      
      const modelPath = path.join(CONFIG.MODEL_DIR, activeVersion, 'model.json');
      if (!fs.existsSync(modelPath)) return;
      
      this.productionModel = await tf.loadLayersModel(`file://${modelPath}`);
      this.productionModelVersion = activeVersion;
      
      logger.info('AutoTrainer', `Loaded production model: ${activeVersion}`);
    } catch (error) {
      logger.silentError('AutoTrainer', 'Failed to load production model', error as Error);
    }
  }

  /**
   * Get active model version from database
   */
  private getActiveModelVersion(): string | null {
    try {
      const db = database.getDb();
      if (!db) return null;
      
      const result = db.exec(`
        SELECT model_version FROM ml_model_versions 
        WHERE is_production = 1 
        ORDER BY trained_at DESC LIMIT 1
      `);
      
      return result.length > 0 && result[0].values.length > 0 
        ? result[0].values[0][0] as string 
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Set active model version in database
   */
  private setActiveModelVersion(version: string): void {
    try {
      const db = database.getDb();
      if (!db) return;
      
      // Clear current production
      db.run(`UPDATE ml_model_versions SET is_production = 0`);
      
      // Set new production
      db.run(`UPDATE ml_model_versions SET is_production = 1, activated_at = ? WHERE version = ?`, [
        Math.floor(Date.now() / 1000),
        version,
      ]);
    } catch (error) {
      logger.silentError('AutoTrainer', 'Failed to set active model version', error as Error);
    }
  }

  /**
   * Save training run to database
   */
  private saveTrainingRun(
    job: TrainingJob, 
    trainResult: { metrics: TrainingJob['metrics'] }, 
    splits: ReturnType<typeof this.splitData>
  ): void {
    try {
      const db = database.getDb();
      if (!db || !job.modelVersion || !job.metrics) return;
      
      db.run(`
        INSERT INTO ml_model_versions (
          version, trained_at, training_samples, validation_samples, test_samples,
          accuracy, precision_score, recall_score, f1_score, auc_score,
          training_loss, validation_loss, is_active, is_production
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
      `, [
        job.modelVersion,
        Math.floor(Date.now() / 1000),
        splits.train.features.length,
        splits.validation.features.length,
        splits.test.features.length,
        job.metrics.accuracy,
        job.metrics.precision,
        job.metrics.recall,
        job.metrics.f1Score,
        job.metrics.auc,
        job.metrics.trainLoss,
        job.metrics.validationLoss,
      ]);
    } catch (error) {
      logger.silentError('AutoTrainer', 'Failed to save training run', error as Error);
    }
  }

  /**
   * Save model comparison to database
   */
  private saveModelComparison(challengerVersion: string, comparison: ModelComparison): void {
    try {
      const db = database.getDb();
      if (!db) return;
      
      db.run(`
        INSERT INTO ml_model_comparisons (
          production_version, challenger_version,
          production_accuracy, challenger_accuracy,
          production_f1, challenger_f1,
          accuracy_delta, f1_delta, p_value,
          winner, compared_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        this.productionModelVersion,
        challengerVersion,
        comparison.productionMetrics.accuracy,
        comparison.challengerMetrics.accuracy,
        comparison.productionMetrics.f1Score,
        comparison.challengerMetrics.f1Score,
        comparison.accuracyDelta,
        comparison.f1Delta,
        comparison.pValue,
        comparison.winnerVersion,
        Math.floor(Date.now() / 1000),
      ]);
    } catch (error) {
      logger.silentError('AutoTrainer', 'Failed to save model comparison', error as Error);
    }
  }

  /**
   * Cleanup old models
   */
  private cleanupOldModels(): void {
    try {
      const modelDirs = fs.readdirSync(CONFIG.MODEL_DIR)
        .filter(d => d.startsWith('v'))
        .sort()
        .reverse();
      
      // Keep only recent models
      const toDelete = modelDirs.slice(CONFIG.MAX_MODELS_TO_KEEP);
      
      for (const dir of toDelete) {
        // Don't delete production or shadow model
        if (dir === this.productionModelVersion || dir === this.shadowModel?.version) {
          continue;
        }
        
        const fullPath = path.join(CONFIG.MODEL_DIR, dir);
        fs.rmSync(fullPath, { recursive: true, force: true });
        logger.debug('AutoTrainer', `Deleted old model: ${dir}`);
      }
    } catch (error) {
      logger.silentError('AutoTrainer', 'Failed to cleanup old models', error as Error);
    }
  }

  /**
   * Get new sample count since last training
   */
  private getNewSampleCount(): number {
    try {
      const db = database.getDb();
      if (!db || !this.lastTrainingAt) return 0;
      
      const result = db.exec(`
        SELECT COUNT(*) FROM ml_training_data
        WHERE created_at > ?
      `, [Math.floor(this.lastTrainingAt / 1000)]);
      
      return result.length > 0 ? result[0].values[0][0] as number : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Create failed job
   */
  private createFailedJob(trigger: TrainingJob['trigger'], error: string): TrainingJob {
    return {
      id: `train_${Date.now()}`,
      status: 'failed',
      trigger,
      error,
      completedAt: Date.now(),
    };
  }

  /**
   * Record new sample
   */
  recordNewSample(): void {
    this.newSamplesSinceLastTrain++;
  }

  /**
   * Get production model for predictions
   */
  getProductionModel(): tf.LayersModel | null {
    return this.productionModel;
  }

  /**
   * Get training status
   */
  getStatus(): {
    isTraining: boolean;
    productionModelVersion: string | null;
    shadowModelVersion: string | null;
    lastTrainingAt: number;
    newSamplesSinceLastTrain: number;
    recentJobs: TrainingJob[];
  } {
    return {
      isTraining: this.isTraining,
      productionModelVersion: this.productionModelVersion,
      shadowModelVersion: this.shadowModel?.version || null,
      lastTrainingAt: this.lastTrainingAt,
      newSamplesSinceLastTrain: this.newSamplesSinceLastTrain,
      recentJobs: this.trainingHistory.slice(-10),
    };
  }
}

// Export singleton
export const autoTrainer = new AutoTrainer();
