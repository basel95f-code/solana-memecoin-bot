/**
 * Sentiment → Price Correlation Model
 * Analyzes correlation between social sentiment and price action
 * Predicts price impact from sentiment spikes
 */

import * as tf from '@tensorflow/tfjs';
import { logger } from '../utils/logger';
import { database } from '../database';
import type { MultiPlatformSentimentAnalysis } from '../types';
import path from 'path';
import fs from 'fs';

export interface SentimentFeatures {
  sentimentScore: number;        // -1 to +1
  sentimentVelocity: number;     // Rate of change
  sentimentAcceleration: number; // Second derivative
  influencerImpact: number;      // Weighted by follower count
  mentionVolume: number;         // Number of mentions
  mentionVelocity: number;       // Rate of new mentions
  uniqueAccounts: number;        // Distinct accounts mentioning
  positiveRatio: number;         // Positive / total
  engagementRate: number;        // Likes, retweets per mention
  hasSentimentSpike: boolean;    // Sudden spike detected
}

export interface SentimentCorrelationInput {
  current: SentimentFeatures;
  historical?: SentimentFeatures[]; // Last 12 data points (1 hour)
  currentPrice: number;
}

export interface SentimentCorrelationResult {
  correlation: number;           // -1 to +1
  timeLag: number;              // Minutes between sentiment and price reaction
  predictedPriceImpact: number; // Expected % change
  confidence: number;           // 0 to 1
  isSignificant: boolean;       // Statistical significance
  recommendation: 'bullish' | 'bearish' | 'neutral';
}

export interface CorrelationAnalysis {
  pearsonR: number;      // Pearson correlation coefficient
  spearmanRho: number;   // Spearman rank correlation
  lagMinutes: number;    // Optimal time lag
  pValue: number;        // Statistical significance
  sampleSize: number;    // Number of data points
}

class SentimentCorrelationModel {
  private model: tf.LayersModel | null = null;
  private modelDir: string;
  private initialized: boolean = false;
  private isTraining: boolean = false;

  // Model hyperparameters
  private readonly DENSE_UNITS = 64;
  private readonly DROPOUT_RATE = 0.3;
  private readonly SEQUENCE_LENGTH = 12; // 1 hour of 5min intervals

  // Correlation thresholds
  private readonly CORRELATION_THRESHOLDS = {
    STRONG: 0.7,
    MODERATE: 0.4,
    WEAK: 0.2,
  };

  // Time lag search range (minutes)
  private readonly MAX_LAG_MINUTES = 60;

  constructor() {
    this.modelDir = path.join(process.cwd(), 'data', 'models', 'sentiment_correlation');
  }

  /**
   * Initialize the sentiment correlation model
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      if (!fs.existsSync(this.modelDir)) {
        fs.mkdirSync(this.modelDir, { recursive: true });
      }

      const modelPath = path.join(this.modelDir, 'model.json');

      if (fs.existsSync(modelPath)) {
        this.model = await tf.loadLayersModel(`file://${modelPath}`);
        logger.info('SentimentCorrelation', 'Loaded existing model');
      } else {
        this.model = this.createModel();
        logger.info('SentimentCorrelation', 'Created new model (needs training)');
      }

      this.initialized = true;
    } catch (error) {
      logger.error('SentimentCorrelation', 'Initialization failed', error as Error);
      throw error;
    }
  }

  /**
   * Create regression model for sentiment → price prediction
   */
  private createModel(): tf.LayersModel {
    const model = tf.sequential();

    // Input: sentiment features (10 features)
    model.add(tf.layers.dense({
      units: this.DENSE_UNITS,
      activation: 'relu',
      inputShape: [10],
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
    }));

    model.add(tf.layers.dropout({ rate: this.DROPOUT_RATE }));

    model.add(tf.layers.dense({
      units: this.DENSE_UNITS / 2,
      activation: 'relu',
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
    }));

    model.add(tf.layers.dropout({ rate: 0.2 }));

    // Output: predicted price change %
    model.add(tf.layers.dense({
      units: 1,
      activation: 'linear', // Regression output
    }));

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'meanSquaredError',
      metrics: ['mae'], // Mean absolute error
    });

    return model;
  }

  /**
   * Analyze correlation between sentiment and price
   */
  async analyzeCorrelation(
    input: SentimentCorrelationInput
  ): Promise<SentimentCorrelationResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Extract features
      const features = this.extractFeatures(input.current);

      // Predict price impact using neural network
      const predictedImpact = await this.predictPriceImpact(features);

      // Calculate correlation if historical data available
      let correlation = 0;
      let timeLag = 0;
      let isSignificant = false;

      if (input.historical && input.historical.length >= 10) {
        const analysis = this.calculateCorrelation(
          input.historical.map(h => h.sentimentScore),
          [] // Would need historical prices
        );
        correlation = analysis.pearsonR;
        timeLag = analysis.lagMinutes;
        isSignificant = analysis.pValue < 0.05;
      }

      // Calculate confidence
      const confidence = this.calculateConfidence(features, correlation);

      // Generate recommendation
      const recommendation = this.getRecommendation(
        predictedImpact,
        input.current.sentimentScore,
        correlation
      );

      return {
        correlation,
        timeLag,
        predictedPriceImpact: predictedImpact,
        confidence,
        isSignificant,
        recommendation,
      };
    } catch (error) {
      logger.error('SentimentCorrelation', 'Analysis failed', error as Error);
      throw error;
    }
  }

  /**
   * Extract sentiment features for ML model
   */
  private extractFeatures(sentiment: SentimentFeatures): number[] {
    return [
      (sentiment.sentimentScore + 1) / 2,        // -1 to +1 -> 0 to 1
      (sentiment.sentimentVelocity + 1) / 2,     // Normalized
      (sentiment.sentimentAcceleration + 1) / 2,
      sentiment.influencerImpact,
      Math.min(1, sentiment.mentionVolume / 1000), // Normalize to 0-1
      (sentiment.mentionVelocity + 1) / 2,
      Math.min(1, sentiment.uniqueAccounts / 500),
      sentiment.positiveRatio,
      sentiment.engagementRate,
      sentiment.hasSentimentSpike ? 1 : 0,
    ];
  }

  /**
   * Predict price impact from sentiment features
   */
  private async predictPriceImpact(features: number[]): Promise<number> {
    if (!this.model) {
      throw new Error('Model not loaded');
    }

    const inputTensor = tf.tensor2d([features]);
    const prediction = this.model.predict(inputTensor) as tf.Tensor;
    const impact = (await prediction.data())[0];

    inputTensor.dispose();
    prediction.dispose();

    // Clamp to reasonable range (-100% to +200%)
    return Math.max(-100, Math.min(200, impact));
  }

  /**
   * Calculate Pearson correlation with time-lag analysis
   */
  private calculateCorrelation(
    sentimentSeries: number[],
    priceSeries: number[]
  ): CorrelationAnalysis {
    if (sentimentSeries.length !== priceSeries.length || sentimentSeries.length < 2) {
      return {
        pearsonR: 0,
        spearmanRho: 0,
        lagMinutes: 0,
        pValue: 1,
        sampleSize: 0,
      };
    }

    // Find optimal lag
    let bestCorrelation = 0;
    let bestLag = 0;

    for (let lag = 0; lag <= Math.min(this.MAX_LAG_MINUTES / 5, priceSeries.length - 1); lag++) {
      const correlation = this.pearsonCorrelation(
        sentimentSeries.slice(0, -lag || undefined),
        priceSeries.slice(lag)
      );

      if (Math.abs(correlation) > Math.abs(bestCorrelation)) {
        bestCorrelation = correlation;
        bestLag = lag * 5; // Convert to minutes
      }
    }

    const pValue = this.calculatePValue(bestCorrelation, sentimentSeries.length);

    return {
      pearsonR: bestCorrelation,
      spearmanRho: this.spearmanCorrelation(sentimentSeries, priceSeries),
      lagMinutes: bestLag,
      pValue,
      sampleSize: sentimentSeries.length,
    };
  }

  /**
   * Calculate Pearson correlation coefficient
   */
  private pearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n === 0) return 0;

    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }

    const denom = Math.sqrt(denomX * denomY);
    return denom === 0 ? 0 : numerator / denom;
  }

  /**
   * Calculate Spearman rank correlation (non-parametric)
   */
  private spearmanCorrelation(x: number[], y: number[]): number {
    const ranksX = this.getRanks(x);
    const ranksY = this.getRanks(y);
    return this.pearsonCorrelation(ranksX, ranksY);
  }

  /**
   * Convert values to ranks
   */
  private getRanks(values: number[]): number[] {
    const sorted = values.map((v, i) => ({ value: v, index: i }))
      .sort((a, b) => a.value - b.value);

    const ranks = new Array(values.length);
    for (let i = 0; i < sorted.length; i++) {
      ranks[sorted[i].index] = i + 1;
    }

    return ranks;
  }

  /**
   * Calculate p-value for correlation significance
   */
  private calculatePValue(r: number, n: number): number {
    if (n < 3) return 1;

    // t-statistic for correlation
    const t = r * Math.sqrt((n - 2) / (1 - r * r));
    
    // Approximate p-value (two-tailed)
    const p = 2 * (1 - this.tCDF(Math.abs(t), n - 2));
    
    return p;
  }

  /**
   * Approximate t-distribution CDF
   */
  private tCDF(t: number, df: number): number {
    // Simple approximation for demonstration
    // In production, use a proper statistical library
    const x = df / (df + t * t);
    return 1 - 0.5 * Math.pow(x, df / 2);
  }

  /**
   * Calculate confidence in the prediction
   */
  private calculateConfidence(features: number[], correlation: number): number {
    // Confidence based on:
    // 1. Strength of correlation
    // 2. Sentiment spike presence
    // 3. Mention volume

    const correlationStrength = Math.abs(correlation);
    const hasSentimentSpike = features[9] === 1;
    const mentionVolume = features[4];

    let confidence = correlationStrength * 0.5;
    
    if (hasSentimentSpike) {
      confidence += 0.3;
    }

    confidence += mentionVolume * 0.2;

    return Math.min(1, confidence);
  }

  /**
   * Generate recommendation based on analysis
   */
  private getRecommendation(
    predictedImpact: number,
    sentimentScore: number,
    correlation: number
  ): 'bullish' | 'bearish' | 'neutral' {
    // Strong positive sentiment + positive impact = bullish
    if (sentimentScore > 0.3 && predictedImpact > 10 && correlation > 0.3) {
      return 'bullish';
    }

    // Strong negative sentiment + negative impact = bearish
    if (sentimentScore < -0.3 && predictedImpact < -10 && correlation > 0.3) {
      return 'bearish';
    }

    return 'neutral';
  }

  /**
   * Detect sentiment spike
   */
  detectSentimentSpike(
    current: SentimentFeatures,
    historical: SentimentFeatures[]
  ): {
    hasSpike: boolean;
    magnitude: number;
    timeToPrice: number; // Expected minutes until price reacts
  } {
    if (historical.length < 5) {
      return { hasSpike: false, magnitude: 0, timeToPrice: 0 };
    }

    const avgSentiment = historical.reduce((sum, h) => sum + h.sentimentScore, 0) / historical.length;
    const stdDev = Math.sqrt(
      historical.reduce((sum, h) => sum + Math.pow(h.sentimentScore - avgSentiment, 2), 0) / historical.length
    );

    const zScore = (current.sentimentScore - avgSentiment) / (stdDev || 1);
    const hasSpike = Math.abs(zScore) > 2; // 2 standard deviations

    const magnitude = Math.abs(zScore);
    
    // Estimate time to price reaction (based on typical lag)
    const timeToPrice = hasSpike ? 15 : 0; // Typically 15min lag

    return {
      hasSpike,
      magnitude,
      timeToPrice,
    };
  }

  /**
   * Train the model on historical data
   */
  async train(options?: {
    epochs?: number;
    batchSize?: number;
  }): Promise<{
    success: boolean;
    samplesUsed: number;
    finalLoss: number;
    finalMAE: number;
  }> {
    if (this.isTraining || !this.model) {
      throw new Error('Cannot train: model not ready or already training');
    }

    this.isTraining = true;

    try {
      logger.info('SentimentCorrelation', 'Starting training...');

      // Get training data
      const trainingData = await this.prepareTrainingData();

      if (trainingData.length < 100) {
        logger.warn('SentimentCorrelation', `Insufficient data: ${trainingData.length}`);
        return { success: false, samplesUsed: trainingData.length, finalLoss: 0, finalMAE: 0 };
      }

      // Prepare tensors
      const features: number[][] = [];
      const labels: number[] = [];

      for (const sample of trainingData) {
        features.push(sample.features);
        labels.push(sample.priceChange);
      }

      const xs = tf.tensor2d(features);
      const ys = tf.tensor2d(labels, [labels.length, 1]);

      const epochs = options?.epochs || 100;
      const batchSize = options?.batchSize || 32;

      const history = await this.model.fit(xs, ys, {
        epochs,
        batchSize,
        validationSplit: 0.2,
        shuffle: true,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            if (epoch % 20 === 0) {
              logger.info('SentimentCorrelation',
                `Epoch ${epoch}: loss=${logs?.loss?.toFixed(4)}, mae=${logs?.mae?.toFixed(4)}`
              );
            }
          },
        },
      });

      // Save model
      await this.model.save(`file://${this.modelDir}`);

      xs.dispose();
      ys.dispose();

      const finalLoss = history.history.loss[history.history.loss.length - 1] as number;
      const finalMAE = history.history.mae[history.history.mae.length - 1] as number;

      logger.info('SentimentCorrelation', `Training complete: MAE=${finalMAE.toFixed(2)}%`);

      return {
        success: true,
        samplesUsed: trainingData.length,
        finalLoss,
        finalMAE,
      };
    } catch (error) {
      logger.error('SentimentCorrelation', 'Training failed', error as Error);
      return { success: false, samplesUsed: 0, finalLoss: 0, finalMAE: 0 };
    } finally {
      this.isTraining = false;
    }
  }

  /**
   * Prepare training data from database
   */
  private async prepareTrainingData(): Promise<Array<{
    features: number[];
    priceChange: number;
  }>> {
    // Query historical sentiment + price data
    // This would join sentiment snapshots with price outcomes
    return [];
  }

  /**
   * Record prediction for performance tracking
   */
  async recordPrediction(
    tokenMint: string,
    result: SentimentCorrelationResult
  ): Promise<void> {
    try {
      database.query(
        `INSERT INTO ml_predictions (
          token_mint, model_type, model_version,
          predicted_direction, confidence, expected_change,
          metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tokenMint,
          'sentiment_correlation',
          'v1.0.0',
          result.recommendation,
          result.confidence,
          result.predictedPriceImpact,
          JSON.stringify({
            correlation: result.correlation,
            timeLag: result.timeLag,
            isSignificant: result.isSignificant,
          }),
          new Date(),
        ]
      );
    } catch (error) {
      logger.error('SentimentCorrelation', 'Failed to record prediction', error as Error);
    }
  }

  /**
   * Get model statistics
   */
  getStats(): {
    initialized: boolean;
    isTraining: boolean;
    hasModel: boolean;
  } {
    return {
      initialized: this.initialized,
      isTraining: this.isTraining,
      hasModel: this.model !== null,
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    this.initialized = false;
  }
}

export const sentimentCorrelationModel = new SentimentCorrelationModel();
