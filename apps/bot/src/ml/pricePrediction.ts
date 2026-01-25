/**
 * Price Prediction Model
 * LSTM/GRU neural network for predicting price movements (1h, 6h, 24h)
 * Outputs probability distribution (up/down/sideways) with confidence
 */

import * as tf from '@tensorflow/tfjs';
import { logger } from '../utils/logger';
import { database } from '../database';
import { featureEngineering, FEATURE_NAMES } from './featureEngineering';
import type { EnhancedFeatures } from './featureEngineering';
import path from 'path';
import fs from 'fs';

export type PriceDirection = 'up' | 'down' | 'sideways';
export type TimeFrame = '1h' | '6h' | '24h';

export interface PricePredictionInput {
  features: EnhancedFeatures;
  historicalPrices?: number[]; // Last 12 price points (5min intervals = 1h history)
}

export interface PricePredictionResult {
  timeframe: TimeFrame;
  probabilities: {
    up: number;      // Probability of price going up >10%
    down: number;    // Probability of price going down >10%
    sideways: number; // Probability of price staying within ±10%
  };
  predictedDirection: PriceDirection;
  confidence: number;
  expectedChange: number; // Expected % change
  modelVersion: string;
}

export interface PriceTrainingData {
  features: number[];
  historicalPrices: number[];
  label: number; // 0 = down, 1 = sideways, 2 = up
  actualChange: number;
}

class PricePredictionModel {
  private models: Map<TimeFrame, tf.LayersModel> = new Map();
  private modelDir: string;
  private initialized: boolean = false;
  private isTraining: boolean = false;
  
  // LSTM hyperparameters
  private readonly LSTM_UNITS = 64;
  private readonly DENSE_UNITS = 32;
  private readonly SEQUENCE_LENGTH = 12; // 12 time steps (1 hour of 5min data)
  private readonly DROPOUT_RATE = 0.3;
  
  // Price change thresholds
  private readonly THRESHOLDS = {
    UP: 10,       // >10% = up
    DOWN: -10,    // <-10% = down
    // Between -10% and +10% = sideways
  };

  constructor() {
    this.modelDir = path.join(process.cwd(), 'data', 'models', 'price_prediction');
  }

  /**
   * Initialize models for all timeframes
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      if (!fs.existsSync(this.modelDir)) {
        fs.mkdirSync(this.modelDir, { recursive: true });
      }

      const timeframes: TimeFrame[] = ['1h', '6h', '24h'];
      
      for (const timeframe of timeframes) {
        const modelPath = path.join(this.modelDir, `model_${timeframe}`, 'model.json');
        
        if (fs.existsSync(modelPath)) {
          const model = await tf.loadLayersModel(`file://${modelPath}`);
          this.models.set(timeframe, model);
          logger.info('PricePrediction', `Loaded model for ${timeframe}`);
        } else {
          const model = this.createModel();
          this.models.set(timeframe, model);
          logger.info('PricePrediction', `Created new model for ${timeframe} (needs training)`);
        }
      }

      this.initialized = true;
      logger.info('PricePrediction', 'Price prediction models initialized');
    } catch (error) {
      logger.error('PricePrediction', 'Initialization failed', error as Error);
      throw error;
    }
  }

  /**
   * Create LSTM-based neural network for price prediction
   */
  private createModel(): tf.LayersModel {
    const model = tf.sequential();

    // LSTM layer for temporal patterns
    model.add(tf.layers.lstm({
      units: this.LSTM_UNITS,
      returnSequences: true,
      inputShape: [this.SEQUENCE_LENGTH, FEATURE_NAMES.length],
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
    }));

    model.add(tf.layers.dropout({ rate: this.DROPOUT_RATE }));

    // Second LSTM layer
    model.add(tf.layers.lstm({
      units: this.LSTM_UNITS / 2,
      returnSequences: false,
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
    }));

    model.add(tf.layers.dropout({ rate: this.DROPOUT_RATE }));

    // Dense layers
    model.add(tf.layers.dense({
      units: this.DENSE_UNITS,
      activation: 'relu',
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
    }));

    model.add(tf.layers.dropout({ rate: 0.2 }));

    // Output layer: 3 classes (down, sideways, up)
    model.add(tf.layers.dense({
      units: 3,
      activation: 'softmax',
    }));

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy'],
    });

    return model;
  }

  /**
   * Predict price movement for a specific timeframe
   */
  async predict(
    input: PricePredictionInput,
    timeframe: TimeFrame = '1h'
  ): Promise<PricePredictionResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const model = this.models.get(timeframe);
    if (!model) {
      throw new Error(`Model not found for timeframe: ${timeframe}`);
    }

    try {
      // Normalize features
      const normalized = featureEngineering.normalizeFeatures(input.features);
      
      // Create sequence (if historical prices not provided, duplicate current features)
      const sequence = this.createSequence(normalized.features, input.historicalPrices);
      
      // Predict
      const inputTensor = tf.tensor3d([sequence]);
      const prediction = model.predict(inputTensor) as tf.Tensor;
      const probabilities = await prediction.data();

      inputTensor.dispose();
      prediction.dispose();

      // Parse probabilities
      const probs = {
        down: probabilities[0],
        sideways: probabilities[1],
        up: probabilities[2],
      };

      // Determine predicted direction
      const predictedDirection = this.getPredictedDirection(probs);
      
      // Calculate confidence (how far from uniform distribution)
      const confidence = this.calculateConfidence(probs);
      
      // Estimate expected change
      const expectedChange = this.estimateExpectedChange(probs, timeframe);

      return {
        timeframe,
        probabilities: probs,
        predictedDirection,
        confidence,
        expectedChange,
        modelVersion: `v1.0.0-${timeframe}`,
      };
    } catch (error) {
      logger.error('PricePrediction', 'Prediction failed', error as Error);
      throw error;
    }
  }

  /**
   * Predict for all timeframes
   */
  async predictAll(input: PricePredictionInput): Promise<PricePredictionResult[]> {
    const timeframes: TimeFrame[] = ['1h', '6h', '24h'];
    const predictions: PricePredictionResult[] = [];

    for (const timeframe of timeframes) {
      const prediction = await this.predict(input, timeframe);
      predictions.push(prediction);
    }

    return predictions;
  }

  /**
   * Create input sequence for LSTM
   */
  private createSequence(currentFeatures: number[], historicalPrices?: number[]): number[][] {
    const sequence: number[][] = [];

    if (historicalPrices && historicalPrices.length >= this.SEQUENCE_LENGTH) {
      // Use actual historical data
      for (let i = 0; i < this.SEQUENCE_LENGTH; i++) {
        // For simplicity, just use current features with historical price info
        // In production, you'd want full feature snapshots for each time point
        sequence.push([...currentFeatures]);
      }
    } else {
      // No historical data - duplicate current features
      for (let i = 0; i < this.SEQUENCE_LENGTH; i++) {
        sequence.push([...currentFeatures]);
      }
    }

    return sequence;
  }

  /**
   * Get predicted direction from probabilities
   */
  private getPredictedDirection(probs: Record<PriceDirection, number>): PriceDirection {
    if (probs.up > probs.down && probs.up > probs.sideways) return 'up';
    if (probs.down > probs.up && probs.down > probs.sideways) return 'down';
    return 'sideways';
  }

  /**
   * Calculate prediction confidence
   */
  private calculateConfidence(probs: Record<PriceDirection, number>): number {
    const maxProb = Math.max(probs.up, probs.down, probs.sideways);
    const uniformProb = 1 / 3;
    
    // Confidence = how much the max probability exceeds uniform distribution
    return Math.min(1, (maxProb - uniformProb) / (1 - uniformProb));
  }

  /**
   * Estimate expected price change percentage
   */
  private estimateExpectedChange(probs: Record<PriceDirection, number>, timeframe: TimeFrame): number {
    // Expected values for each outcome
    const expectedValues = {
      '1h': { up: 20, sideways: 0, down: -20 },
      '6h': { up: 50, sideways: 0, down: -50 },
      '24h': { up: 100, sideways: 0, down: -100 },
    };

    const values = expectedValues[timeframe];
    return (
      probs.up * values.up +
      probs.sideways * values.sideways +
      probs.down * values.down
    );
  }

  /**
   * Train model on historical data
   */
  async train(
    timeframe: TimeFrame,
    options?: { epochs?: number; batchSize?: number }
  ): Promise<{
    success: boolean;
    samplesUsed: number;
    finalLoss: number;
    finalAccuracy: number;
  }> {
    if (this.isTraining) {
      throw new Error('Training already in progress');
    }

    this.isTraining = true;

    try {
      logger.info('PricePrediction', `Starting training for ${timeframe}...`);

      // Get training data from database
      const trainingData = await this.prepareTrainingData(timeframe);

      if (trainingData.length < 100) {
        logger.warn('PricePrediction', `Insufficient training data: ${trainingData.length}`);
        return { success: false, samplesUsed: trainingData.length, finalLoss: 0, finalAccuracy: 0 };
      }

      // Prepare tensors
      const { xs, ys } = this.prepareTrainingTensors(trainingData);

      const model = this.models.get(timeframe)!;
      const epochs = options?.epochs || 100;
      const batchSize = options?.batchSize || 32;

      const history = await model.fit(xs, ys, {
        epochs,
        batchSize,
        validationSplit: 0.2,
        shuffle: true,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            if (epoch % 20 === 0) {
              logger.info('PricePrediction', 
                `Epoch ${epoch}: loss=${logs?.loss?.toFixed(4)}, acc=${logs?.acc?.toFixed(4)}`
              );
            }
          },
        },
      });

      // Save model
      const modelPath = path.join(this.modelDir, `model_${timeframe}`);
      await model.save(`file://${modelPath}`);

      xs.dispose();
      ys.dispose();

      const finalLoss = history.history.loss[history.history.loss.length - 1] as number;
      const finalAccuracy = history.history.acc[history.history.acc.length - 1] as number;

      logger.info('PricePrediction', 
        `Training complete for ${timeframe}: accuracy=${(finalAccuracy * 100).toFixed(2)}%`
      );

      return {
        success: true,
        samplesUsed: trainingData.length,
        finalLoss,
        finalAccuracy,
      };
    } catch (error) {
      logger.error('PricePrediction', 'Training failed', error as Error);
      return { success: false, samplesUsed: 0, finalLoss: 0, finalAccuracy: 0 };
    } finally {
      this.isTraining = false;
    }
  }

  /**
   * Prepare training data from database
   */
  private async prepareTrainingData(timeframe: TimeFrame): Promise<PriceTrainingData[]> {
    // This would query historical token data with known outcomes
    // For now, returning empty array (to be implemented with real data)
    
    // Example query would be:
    // SELECT features, price_change_1h, price_change_6h, price_change_24h
    // FROM ml_training_data
    // WHERE has_outcome = true
    
    return [];
  }

  /**
   * Convert training data to tensors
   */
  private prepareTrainingTensors(data: PriceTrainingData[]): {
    xs: tf.Tensor3D;
    ys: tf.Tensor2D;
  } {
    const sequences: number[][][] = [];
    const labels: number[][] = [];

    for (const sample of data) {
      // Create sequence
      const sequence = this.createSequence(sample.features, sample.historicalPrices);
      sequences.push(sequence);

      // One-hot encode label
      const oneHot = [0, 0, 0];
      oneHot[sample.label] = 1;
      labels.push(oneHot);
    }

    const xs = tf.tensor3d(sequences);
    const ys = tf.tensor2d(labels);

    return { xs, ys };
  }

  /**
   * Classify price change into label
   */
  private classifyPriceChange(change: number): number {
    if (change > this.THRESHOLDS.UP) return 2; // up
    if (change < this.THRESHOLDS.DOWN) return 0; // down
    return 1; // sideways
  }

  /**
   * Get model statistics
   */
  getStats(): {
    initialized: boolean;
    isTraining: boolean;
    modelsLoaded: string[];
  } {
    return {
      initialized: this.initialized,
      isTraining: this.isTraining,
      modelsLoaded: Array.from(this.models.keys()),
    };
  }

  /**
   * Record prediction for performance tracking
   */
  async recordPrediction(
    tokenMint: string,
    prediction: PricePredictionResult
  ): Promise<void> {
    try {
      database.query(
        `INSERT INTO ml_predictions (
          token_mint, model_type, model_version, timeframe,
          predicted_direction, confidence, expected_change,
          probabilities, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tokenMint,
          'price_prediction',
          prediction.modelVersion,
          prediction.timeframe,
          prediction.predictedDirection,
          prediction.confidence,
          prediction.expectedChange,
          JSON.stringify(prediction.probabilities),
          new Date(),
        ]
      );
    } catch (error) {
      logger.error('PricePrediction', 'Failed to record prediction', error as Error);
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    for (const model of this.models.values()) {
      model.dispose();
    }
    this.models.clear();
    this.initialized = false;
  }
}

export const pricePredictionModel = new PricePredictionModel();
