/**
 * Rug Pull Predictor using TensorFlow.js
 * Neural network trained on historical token data to predict rug probability
 */

import * as tf from '@tensorflow/tfjs';
import path from 'path';
import fs from 'fs';
import { database } from '../database';
import { logger } from '../utils/logger';

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

export interface PredictionResult {
  rugProbability: number;
  confidence: number;
  riskFactors: string[];
  recommendation: 'safe' | 'caution' | 'avoid' | 'unknown';
}

class RugPredictor {
  private model: tf.LayersModel | null = null;
  private modelDir: string;
  private isTraining: boolean = false;
  private initialized: boolean = false;
  private trainingHistory: { loss: number; accuracy: number }[] = [];
  private totalPredictions: number = 0;

  // Feature normalization parameters
  private readonly NORMALIZATION = {
    liquidityMax: 1000000,
    holderCountMax: 10000,
    ageHoursMax: 168, // 1 week
  };

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
   */
  private createModel(): tf.LayersModel {
    const model = tf.sequential();

    // Input layer: 9 features
    model.add(tf.layers.dense({
      inputShape: [9],
      units: 64,
      activation: 'relu',
      kernelInitializer: 'heNormal',
    }));

    // Add batch normalization for stability
    model.add(tf.layers.batchNormalization());

    // Dropout for regularization
    model.add(tf.layers.dropout({ rate: 0.3 }));

    // Hidden layer 1
    model.add(tf.layers.dense({
      units: 32,
      activation: 'relu',
      kernelInitializer: 'heNormal',
    }));

    model.add(tf.layers.dropout({ rate: 0.2 }));

    // Hidden layer 2
    model.add(tf.layers.dense({
      units: 16,
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
   * Extract normalized features from input
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
   * Get training history
   */
  getTrainingHistory(): { loss: number; accuracy: number }[] {
    return [...this.trainingHistory];
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
