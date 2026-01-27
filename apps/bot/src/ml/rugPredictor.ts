/**
 * Rug Pull Predictor using TensorFlow.js
 * Neural network trained on historical token data to predict rug probability
 * Supports 28 enhanced features (v2) with backward compatibility for 9 features (v1)
 */

import * as tf from '@tensorflow/tfjs';
import path from 'path';
import fs from 'fs';
import { database } from '../database';
import { logger } from '../utils/logger';
import { FEATURE_COUNT } from './featureEngineering';
import { modelVersionManager } from './modelVersioning';
import { ensemblePredictor } from './ensemblePredictor';
import { mlRetrainer } from '../services/ml/mlRetrainer';
import { cacheManager, CacheKey, CacheTTL } from '../cache';

// Legacy 9-feature input (v1 compatibility)
export interface PredictionInput {
  liquidityUsd: number;
  riskScore: number;
  holderCount: number;
  top10Percent: number;
  mintRevoked: boolean;
  freezeRevoked: boolean;
  lpBurnedPercent: number;
  hasSocials: boolean;
  tokenAgeHours: number;
}

// Enhanced 28-feature input (v2)
export interface EnhancedPredictionInput extends PredictionInput {
  // Momentum features
  priceChange5m?: number;
  priceChange1h?: number;
  priceChange24h?: number;
  volumeChange1h?: number;
  volumeChange24h?: number;
  buyPressure1h?: number;
  // Smart money features
  smartMoneyNetBuys?: number;
  smartMoneyHolding?: number;
  isSmartMoneyBullish?: boolean;
  // Trend features
  priceVelocity?: number;
  volumeAcceleration?: number;
  liquidityTrend?: number;
  holderTrend?: number;
  // Pattern features
  hasVolumeSpike?: boolean;
  isPumping?: boolean;
  isDumping?: boolean;
  // Sentiment features
  sentimentScore?: number;
  sentimentConfidence?: number;
  hasSentimentData?: boolean;
}

export interface PredictionResult {
  rugProbability: number;
  confidence: number;
  riskFactors: string[];
  recommendation: 'safe' | 'caution' | 'avoid' | 'unknown';
}

class RugPredictor {
  private model: tf.LayersModel | null = null;
  private modelV2: tf.LayersModel | null = null; // Enhanced model with 25 features
  private modelDir: string;
  private isTraining: boolean = false;
  private initialized: boolean = false;
  private trainingHistory: { loss: number; accuracy: number }[] = [];
  private totalPredictions: number = 0;
  private featureVersion: 'v1' | 'v2' = 'v1';
  private useEnsemble: boolean = false; // Toggle for ensemble predictions

  // Feature normalization parameters
  private readonly NORMALIZATION = {
    liquidityMax: 1000000,
    holderCountMax: 10000,
    ageHoursMax: 168, // 1 week
  };

  // V1 has 9 features, V2 has 28 features (added 3 sentiment features)
  private readonly FEATURE_COUNT_V1 = 9;
  private readonly FEATURE_COUNT_V2 = FEATURE_COUNT;

  constructor() {
    this.modelDir = path.join(process.cwd(), 'data', 'models', 'rug_predictor');
  }

  /**
   * Initialize the predictor - load existing model or create new
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure model directory exists
      if (!fs.existsSync(this.modelDir)) {
        fs.mkdirSync(this.modelDir, { recursive: true });
      }

      const modelPath = path.join(this.modelDir, 'model.json');

      if (fs.existsSync(modelPath)) {
        // Load existing model
        this.model = await tf.loadLayersModel(`file://${modelPath}`);
        logger.info('RugPredictor', 'Loaded existing model');
      } else {
        // Create new model
        this.model = this.createModel();
        logger.info('RugPredictor', 'Created new model (needs training)');
      }

      this.initialized = true;
    } catch (error) {
      logger.error('RugPredictor', 'Failed to initialize', error as Error);
      // Create a fresh model as fallback
      this.model = this.createModel();
      this.initialized = true;
    }
  }

  /**
   * Create the neural network architecture
   * @param featureCount Number of input features (9 for v1, 25 for v2)
   */
  private createModel(featureCount: number = this.FEATURE_COUNT_V1): tf.LayersModel {
    const model = tf.sequential();

    // Adjust network size based on feature count
    const firstLayerUnits = featureCount === this.FEATURE_COUNT_V2 ? 128 : 64;
    const secondLayerUnits = featureCount === this.FEATURE_COUNT_V2 ? 64 : 32;
    const thirdLayerUnits = featureCount === this.FEATURE_COUNT_V2 ? 32 : 16;

    // Input layer
    model.add(tf.layers.dense({
      inputShape: [featureCount],
      units: firstLayerUnits,
      activation: 'relu',
      kernelInitializer: 'heNormal',
    }));

    // Add batch normalization for stability
    model.add(tf.layers.batchNormalization());

    // Dropout for regularization
    model.add(tf.layers.dropout({ rate: 0.3 }));

    // Hidden layer 1
    model.add(tf.layers.dense({
      units: secondLayerUnits,
      activation: 'relu',
      kernelInitializer: 'heNormal',
    }));

    model.add(tf.layers.dropout({ rate: 0.2 }));

    // Hidden layer 2
    model.add(tf.layers.dense({
      units: thirdLayerUnits,
      activation: 'relu',
      kernelInitializer: 'heNormal',
    }));

    // Output layer: probability of rug (0-1)
    model.add(tf.layers.dense({
      units: 1,
      activation: 'sigmoid',
    }));

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'binaryCrossentropy',
      metrics: ['accuracy'],
    });

    return model;
  }

  /**
   * Create V2 model with 25 features
   */
  private createModelV2(): tf.LayersModel {
    return this.createModel(this.FEATURE_COUNT_V2);
  }

  /**
   * Train the model on historical data
   */
  async train(options?: { epochs?: number; batchSize?: number }): Promise<{
    success: boolean;
    samplesUsed: number;
    finalLoss: number;
    finalAccuracy: number;
  }> {
    if (this.isTraining || !this.model) {
      return { success: false, samplesUsed: 0, finalLoss: 0, finalAccuracy: 0 };
    }

    this.isTraining = true;

    try {
      // Get training data from database
      const trainingData = database.getMLTrainingData(10000);

      if (trainingData.length < 50) {
        logger.warn('RugPredictor', `Insufficient training data: ${trainingData.length} samples (need 50+)`);
        return { success: false, samplesUsed: trainingData.length, finalLoss: 0, finalAccuracy: 0 };
      }

      // Prepare features and labels
      const features: number[][] = [];
      const labels: number[] = [];

      for (const row of trainingData) {
        const feature = this.extractFeatures({
          liquidityUsd: row.liquidity_usd || 0,
          riskScore: row.risk_score || 50,
          holderCount: row.total_holders || 0,
          top10Percent: row.top10_percent || 100,
          mintRevoked: row.mint_revoked === 1,
          freezeRevoked: row.freeze_revoked === 1,
          lpBurnedPercent: row.lp_burned_percent || 0,
          hasSocials: (row.has_twitter === 1 || row.has_telegram === 1 || row.has_website === 1),
          tokenAgeHours: 0, // Would need to calculate from analyzed_at
        });

        features.push(feature);
        labels.push(row.outcome === 'rug' ? 1 : 0);
      }

      const xs = tf.tensor2d(features);
      const ys = tf.tensor2d(labels, [labels.length, 1]);

      const epochs = options?.epochs || 50;
      const batchSize = options?.batchSize || 32;

      logger.info('RugPredictor', `Training on ${features.length} samples for ${epochs} epochs...`);

      const history = await this.model.fit(xs, ys, {
        epochs,
        batchSize,
        validationSplit: 0.2,
        shuffle: true,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            if (epoch % 10 === 0) {
              logger.info('RugPredictor', `Epoch ${epoch}: loss=${logs?.loss?.toFixed(4)}, acc=${logs?.acc?.toFixed(4)}`);
            }

            this.trainingHistory.push({
              loss: logs?.loss || 0,
              accuracy: logs?.acc || 0,
            });
          },
        },
      });

      // Save model
      await this.model.save(`file://${this.modelDir}`);
      logger.info('RugPredictor', 'Model trained and saved');

      const finalLoss = history.history.loss[history.history.loss.length - 1] as number;
      const finalAccuracy = history.history.acc[history.history.acc.length - 1] as number;

      xs.dispose();
      ys.dispose();

      return {
        success: true,
        samplesUsed: features.length,
        finalLoss,
        finalAccuracy,
      };
    } catch (error) {
      logger.error('RugPredictor', 'Training failed', error as Error);
      return { success: false, samplesUsed: 0, finalLoss: 0, finalAccuracy: 0 };
    } finally {
      this.isTraining = false;
    }
  }

  /**
   * Predict rug probability for a token
   */
  async predict(input: PredictionInput): Promise<PredictionResult> {
    if (!this.model) {
      return {
        rugProbability: 0.5,
        confidence: 0,
        riskFactors: ['Model not loaded'],
        recommendation: 'unknown',
      };
    }

    // Create cache key from input features (rounded to reduce cache misses from tiny differences)
    const cacheKey = `ml:${Math.round(input.liquidityUsd)}:${input.riskScore}:${input.holderCount}:${Math.round(input.top10Percent)}:${input.mintRevoked}:${input.freezeRevoked}`;
    
    // Check cache (1 min TTL for predictions)
    const cached = await cacheManager.get<PredictionResult>(cacheKey);
    if (cached) {
      return cached;
    }

    const features = this.extractFeatures(input);
    const inputTensor = tf.tensor2d([features]);
    this.totalPredictions++;

    try {
      const prediction = this.model.predict(inputTensor) as tf.Tensor;
      const probability = (await prediction.data())[0];

      prediction.dispose();
      inputTensor.dispose();

      // Calculate confidence (how far from 0.5)
      const confidence = Math.abs(probability - 0.5) * 2;

      // Identify risk factors
      const riskFactors = this.identifyRiskFactors(input);

      // Generate recommendation
      const recommendation = this.getRecommendation(probability, confidence);

      const result = {
        rugProbability: probability,
        confidence,
        riskFactors,
        recommendation,
      };

      // Cache the result (1 min TTL)
      await cacheManager.set(cacheKey, result, CacheTTL.ML_PREDICTION);

      return result;
    } catch (error) {
      logger.error('RugPredictor', 'Prediction failed', error as Error);

      inputTensor.dispose();

      return {
        rugProbability: 0.5,
        confidence: 0,
        riskFactors: ['Prediction error'],
        recommendation: 'unknown',
      };
    }
  }

  /**
   * Extract normalized features from input (v1 - 9 features)
   */
  private extractFeatures(input: PredictionInput): number[] {
    return [
      this.normalize(input.liquidityUsd, 0, this.NORMALIZATION.liquidityMax),
      input.riskScore / 100,
      this.normalize(input.holderCount, 0, this.NORMALIZATION.holderCountMax),
      input.top10Percent / 100,
      input.mintRevoked ? 1 : 0,
      input.freezeRevoked ? 1 : 0,
      input.lpBurnedPercent / 100,
      input.hasSocials ? 1 : 0,
      this.normalize(input.tokenAgeHours, 0, this.NORMALIZATION.ageHoursMax),
    ];
  }

  /**
   * Extract enhanced features from input (v2 - 28 features with sentiment)
   */
  private extractEnhancedFeatures(input: EnhancedPredictionInput): number[] {
    // Start with v1 features
    const features = this.extractFeatures(input);

    // Add momentum features (6)
    features.push(this.normalizePriceChange(input.priceChange5m ?? 0));
    features.push(this.normalizePriceChange(input.priceChange1h ?? 0));
    features.push(this.normalizePriceChange(input.priceChange24h ?? 0));
    features.push(this.normalizePriceChange(input.volumeChange1h ?? 0));
    features.push(this.normalizePriceChange(input.volumeChange24h ?? 0));
    features.push(input.buyPressure1h ?? 0.5);

    // Add smart money features (3)
    features.push(this.normalizeSmartMoney(input.smartMoneyNetBuys ?? 0));
    features.push(Math.min(1, (input.smartMoneyHolding ?? 0) / 30));
    features.push(input.isSmartMoneyBullish ? 1 : 0);

    // Add trend features (4)
    features.push((input.priceVelocity ?? 0 + 50) / 100);
    features.push((input.volumeAcceleration ?? 0 + 5) / 10);
    features.push((input.liquidityTrend ?? 0 + 1) / 2);
    features.push((input.holderTrend ?? 0 + 1) / 2);

    // Add pattern features (3)
    features.push(input.hasVolumeSpike ? 1 : 0);
    features.push(input.isPumping ? 1 : 0);
    features.push(input.isDumping ? 1 : 0);

    // Add sentiment features (3)
    features.push(((input.sentimentScore ?? 0) + 1) / 2); // -1 to +1 -> 0 to 1
    features.push(input.sentimentConfidence ?? 0); // Already 0-1
    features.push(input.hasSentimentData ? 1 : 0); // Boolean to 0 or 1

    // Clamp all values to 0-1
    return features.map(v => Math.max(0, Math.min(1, v)));
  }

  /**
   * Normalize price change (-100 to +200 -> 0 to 1)
   */
  private normalizePriceChange(change: number): number {
    const clamped = Math.max(-100, Math.min(200, change));
    return (clamped + 100) / 300;
  }

  /**
   * Normalize smart money net buys (-20 to +20 -> 0 to 1)
   */
  private normalizeSmartMoney(netBuys: number): number {
    const clamped = Math.max(-20, Math.min(20, netBuys));
    return (clamped + 20) / 40;
  }

  /**
   * Predict with enhanced features (v2)
   */
  async predictEnhanced(input: EnhancedPredictionInput): Promise<PredictionResult> {
    // Use ensemble if enabled
    if (this.useEnsemble) {
      const features = this.extractEnhancedFeatures(input);
      return ensemblePredictor.predict(input, features);
    }

    // If v2 model is available, use it
    if (this.modelV2) {
      return this.predictWithModel(this.modelV2, this.extractEnhancedFeatures(input), input);
    }

    // Fall back to v1 model
    return this.predict(input);
  }

  /**
   * Enable or disable ensemble predictions
   */
  setUseEnsemble(enabled: boolean): void {
    this.useEnsemble = enabled;
    logger.info('RugPredictor', `Ensemble predictions ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if ensemble is enabled
   */
  isEnsembleEnabled(): boolean {
    return this.useEnsemble;
  }

  /**
   * Internal predict method that works with any model
   */
  private async predictWithModel(model: tf.LayersModel, features: number[], input: PredictionInput): Promise<PredictionResult> {
    const inputTensor = tf.tensor2d([features]);
    this.totalPredictions++;

    try {
      const prediction = model.predict(inputTensor) as tf.Tensor;
      const probability = (await prediction.data())[0];

      prediction.dispose();
      inputTensor.dispose();

      const confidence = Math.abs(probability - 0.5) * 2;
      const riskFactors = this.identifyRiskFactors(input);
      const recommendation = this.getRecommendation(probability, confidence);

      return {
        rugProbability: probability,
        confidence,
        riskFactors,
        recommendation,
      };
    } catch (error) {
      logger.error('RugPredictor', 'Prediction failed', error as Error);
      inputTensor.dispose();

      return {
        rugProbability: 0.5,
        confidence: 0,
        riskFactors: ['Prediction error'],
        recommendation: 'unknown',
      };
    }
  }

  /**
   * Set the feature version to use
   */
  setFeatureVersion(version: 'v1' | 'v2'): void {
    this.featureVersion = version;
    logger.info('RugPredictor', `Feature version set to ${version}`);
  }

  /**
   * Get current feature version
   */
  getFeatureVersion(): 'v1' | 'v2' {
    return this.featureVersion;
  }

  /**
   * Normalize a value to 0-1 range
   */
  private normalize(value: number, min: number, max: number): number {
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
  }

  /**
   * Identify specific risk factors from input
   */
  private identifyRiskFactors(input: PredictionInput): string[] {
    const factors: string[] = [];

    if (!input.mintRevoked) {
      factors.push('Mint authority active');
    }

    if (!input.freezeRevoked) {
      factors.push('Freeze authority active');
    }

    if (input.lpBurnedPercent < 90) {
      factors.push('LP not fully burned');
    }

    if (input.top10Percent > 50) {
      factors.push('High holder concentration');
    }

    if (input.liquidityUsd < 5000) {
      factors.push('Low liquidity');
    }

    if (!input.hasSocials) {
      factors.push('No social presence');
    }

    if (input.holderCount < 50) {
      factors.push('Few holders');
    }

    if (input.tokenAgeHours < 1) {
      factors.push('Very new token');
    }

    if (input.riskScore < 40) {
      factors.push('High base risk score');
    }

    return factors;
  }

  /**
   * Get recommendation based on probability and confidence
   */
  private getRecommendation(probability: number, confidence: number): 'safe' | 'caution' | 'avoid' | 'unknown' {
    // Low confidence = unknown
    if (confidence < 0.3) {
      return 'unknown';
    }

    if (probability < 0.25) {
      return 'safe';
    } else if (probability < 0.5) {
      return 'caution';
    } else {
      return 'avoid';
    }
  }

  /**
   * Get model statistics
   */
  getStats(): {
    isInitialized: boolean;
    isTraining: boolean;
    hasModel: boolean;
    trainingHistoryLength: number;
    totalPredictions: number;
  } {
    return {
      isInitialized: this.initialized,
      isTraining: this.isTraining,
      hasModel: this.model !== null,
      trainingHistoryLength: this.trainingHistory.length,
      totalPredictions: this.totalPredictions,
    };
  }

  /**
   * Check if model needs training
   */
  needsTraining(): boolean {
    // Check if model file exists
    const modelPath = path.join(this.modelDir, 'model.json');
    return !fs.existsSync(modelPath);
  }

  /**
   * Check if the model is loaded and ready for predictions
   */
  isModelLoaded(): boolean {
    return this.initialized && this.model !== null;
  }

  /**
   * Get training history
   */
  getTrainingHistory(): { loss: number; accuracy: number }[] {
    return [...this.trainingHistory];
  }

  /**
   * Record prediction for performance tracking
   */
  async recordPrediction(tokenMint: string, result: PredictionResult): Promise<void> {
    try {
      const currentVersionObj = modelVersionManager.getActiveVersion();
      const currentVersion = currentVersionObj?.version || 'v1.0.0';
      const predictedOutcome = result.rugProbability > 0.5 ? 'rug' : 'pump';

      await mlRetrainer.recordPrediction(tokenMint, {
        model_version: currentVersion,
        predicted_outcome: predictedOutcome,
        predicted_confidence: result.confidence,
        rug_probability: result.rugProbability
      });
    } catch (error) {
      logger.error('RugPredictor', 'Error recording prediction', error as Error);
    }
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    this.initialized = false;
  }
}

// Export singleton instance
export const rugPredictor = new RugPredictor();

// Export class for testing
export { RugPredictor };
