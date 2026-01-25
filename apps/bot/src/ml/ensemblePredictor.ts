/**
 * Ensemble Predictor
 * Combines multiple ML models for more robust predictions
 */

import * as tf from '@tensorflow/tfjs';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';
import type { EnhancedPredictionInput, PredictionResult } from './rugPredictor';

export type EnsembleStrategy = 'majority_vote' | 'weighted_average' | 'max_confidence';

export interface ModelArchitecture {
  name: string;
  layers: number[];
  dropout: number;
  description: string;
}

export interface EnsembleModel {
  name: string;
  model: tf.LayersModel;
  architecture: ModelArchitecture;
  weight: number; // For weighted voting
  accuracy: number;
  predictions: number;
}

export interface EnsembleStats {
  totalModels: number;
  activeModels: number;
  strategy: EnsembleStrategy;
  avgAccuracy: number;
  totalPredictions: number;
  models: Array<{
    name: string;
    architecture: string;
    weight: number;
    accuracy: number;
    predictions: number;
  }>;
}

/**
 * Pre-defined model architectures
 */
export const MODEL_ARCHITECTURES: ModelArchitecture[] = [
  {
    name: 'shallow',
    layers: [32, 16],
    dropout: 0.1,
    description: 'Fast, simple model for quick decisions',
  },
  {
    name: 'balanced',
    layers: [64, 32, 16],
    dropout: 0.2,
    description: 'Balanced depth and performance',
  },
  {
    name: 'deep',
    layers: [128, 64, 32, 16],
    dropout: 0.25,
    description: 'Deep model for complex patterns',
  },
  {
    name: 'wide',
    layers: [256, 128],
    dropout: 0.15,
    description: 'Wide layers for feature interactions',
  },
];

class EnsemblePredictor {
  private models: Map<string, EnsembleModel> = new Map();
  private strategy: EnsembleStrategy = 'weighted_average';
  private modelDir: string;
  private featureCount = 28; // Updated to match current feature count
  private initialized = false;

  constructor() {
    this.modelDir = path.join(process.cwd(), 'data', 'models', 'ensemble');
  }

  /**
   * Initialize ensemble - load or create models
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure ensemble directory exists
      if (!fs.existsSync(this.modelDir)) {
        fs.mkdirSync(this.modelDir, { recursive: true });
      }

      // Try to load existing models
      for (const arch of MODEL_ARCHITECTURES) {
        const modelPath = path.join(this.modelDir, arch.name, 'model.json');
        if (fs.existsSync(modelPath)) {
          await this.loadModel(arch.name, arch);
        }
      }

      // If no models loaded, create default ones
      if (this.models.size === 0) {
        logger.info('EnsemblePredictor', 'No existing models found, creating default ensemble');
        await this.createDefaultEnsemble();
      }

      this.initialized = true;
      logger.info('EnsemblePredictor', `Initialized with ${this.models.size} models`);
    } catch (error) {
      logger.error('EnsemblePredictor', 'Failed to initialize', error as Error);
      throw error;
    }
  }

  /**
   * Load a model from disk
   */
  private async loadModel(name: string, architecture: ModelArchitecture): Promise<void> {
    try {
      const modelPath = path.join(this.modelDir, name, 'model.json');
      const model = await tf.loadLayersModel(`file://${modelPath}`);

      // Load metadata
      const metadataPath = path.join(this.modelDir, name, 'metadata.json');
      let accuracy = 0.5;
      let predictions = 0;
      let weight = 1.0;

      if (fs.existsSync(metadataPath)) {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        accuracy = metadata.accuracy || 0.5;
        predictions = metadata.predictions || 0;
        weight = metadata.weight || 1.0;
      }

      this.models.set(name, {
        name,
        model,
        architecture,
        weight,
        accuracy,
        predictions,
      });

      logger.info('EnsemblePredictor', `Loaded model: ${name} (accuracy: ${(accuracy * 100).toFixed(1)}%)`);
    } catch (error) {
      logger.error('EnsemblePredictor', `Failed to load model ${name}`, error as Error);
    }
  }

  /**
   * Create default ensemble with multiple architectures
   */
  private async createDefaultEnsemble(): Promise<void> {
    for (const arch of MODEL_ARCHITECTURES) {
      const model = this.createModel(arch);
      this.models.set(arch.name, {
        name: arch.name,
        model,
        architecture: arch,
        weight: 1.0,
        accuracy: 0.5,
        predictions: 0,
      });
      logger.info('EnsemblePredictor', `Created model: ${arch.name}`);
    }
  }

  /**
   * Create a model with specific architecture
   */
  private createModel(architecture: ModelArchitecture): tf.LayersModel {
    const model = tf.sequential();

    // Input layer
    model.add(tf.layers.dense({
      inputShape: [this.featureCount],
      units: architecture.layers[0],
      activation: 'relu',
      kernelInitializer: 'heNormal',
    }));

    model.add(tf.layers.dropout({ rate: architecture.dropout }));

    // Hidden layers
    for (let i = 1; i < architecture.layers.length; i++) {
      model.add(tf.layers.dense({
        units: architecture.layers[i],
        activation: 'relu',
        kernelInitializer: 'heNormal',
      }));

      if (i < architecture.layers.length - 1) {
        model.add(tf.layers.dropout({ rate: architecture.dropout }));
      }
    }

    // Output layer
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
   * Make prediction using ensemble
   */
  async predict(input: EnhancedPredictionInput, features: number[]): Promise<PredictionResult> {
    if (this.models.size === 0) {
      return {
        rugProbability: 0.5,
        confidence: 0,
        riskFactors: ['No ensemble models available'],
        recommendation: 'unknown',
      };
    }

    const inputTensor = tf.tensor2d([features]);
    const predictions: Array<{ probability: number; modelName: string; weight: number }> = [];

    try {
      // Get prediction from each model
      for (const [name, ensembleModel] of this.models) {
        const prediction = ensembleModel.model.predict(inputTensor) as tf.Tensor;
        const probability = (await prediction.data())[0];
        prediction.dispose();

        predictions.push({
          probability,
          modelName: name,
          weight: ensembleModel.weight,
        });

        // Update prediction count
        ensembleModel.predictions++;
      }

      inputTensor.dispose();

      // Combine predictions based on strategy
      const combinedProbability = this.combinePredictions(predictions);
      const confidence = this.calculateEnsembleConfidence(predictions);
      const riskFactors = this.identifyRiskFactors(input);
      const recommendation = this.getRecommendation(combinedProbability, confidence);

      return {
        rugProbability: combinedProbability,
        confidence,
        riskFactors,
        recommendation,
      };
    } catch (error) {
      logger.error('EnsemblePredictor', 'Prediction failed', error as Error);
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
   * Combine predictions based on strategy
   */
  private combinePredictions(predictions: Array<{ probability: number; modelName: string; weight: number }>): number {
    switch (this.strategy) {
      case 'majority_vote': {
        // Binary vote: rug (>0.5) or safe (<=0.5)
        const rugVotes = predictions.filter(p => p.probability > 0.5).length;
        return rugVotes > predictions.length / 2 ? 0.75 : 0.25;
      }

      case 'weighted_average': {
        const totalWeight = predictions.reduce((sum, p) => sum + p.weight, 0);
        const weightedSum = predictions.reduce((sum, p) => sum + p.probability * p.weight, 0);
        return weightedSum / totalWeight;
      }

      case 'max_confidence': {
        // Use prediction from model with highest confidence
        let maxConfidence = 0;
        let bestProbability = 0.5;

        for (const p of predictions) {
          const confidence = Math.abs(p.probability - 0.5) * 2;
          if (confidence > maxConfidence) {
            maxConfidence = confidence;
            bestProbability = p.probability;
          }
        }

        return bestProbability;
      }

      default:
        return predictions.reduce((sum, p) => sum + p.probability, 0) / predictions.length;
    }
  }

  /**
   * Calculate ensemble confidence
   * Higher when models agree, lower when they disagree
   */
  private calculateEnsembleConfidence(predictions: Array<{ probability: number }>): number {
    if (predictions.length === 0) return 0;

    // Calculate variance of predictions
    const mean = predictions.reduce((sum, p) => sum + p.probability, 0) / predictions.length;
    const variance = predictions.reduce((sum, p) => sum + Math.pow(p.probability - mean, 2), 0) / predictions.length;
    const stdDev = Math.sqrt(variance);

    // Low variance = high agreement = high confidence
    // Normalize: stdDev ranges from 0 (all agree) to ~0.5 (max disagreement)
    const agreement = 1 - Math.min(stdDev * 2, 1);

    // Also factor in how extreme the mean prediction is
    const extremeness = Math.abs(mean - 0.5) * 2;

    // Combined confidence
    return agreement * 0.6 + extremeness * 0.4;
  }

  /**
   * Identify risk factors from input
   */
  private identifyRiskFactors(input: EnhancedPredictionInput): string[] {
    const factors: string[] = [];

    if (input.riskScore > 70) factors.push('High risk score');
    if (input.liquidityUsd < 10000) factors.push('Low liquidity');
    if (!input.mintRevoked) factors.push('Mint authority not revoked');
    if (!input.freezeRevoked) factors.push('Freeze authority not revoked');
    if (input.top10Percent > 50) factors.push('High concentration in top holders');
    if (input.lpBurnedPercent < 50) factors.push('LP not burned');
    if (!input.hasSocials) factors.push('No social media presence');

    // Momentum-based risks
    if (input.priceChange1h && input.priceChange1h < -30) factors.push('Sharp price decline');
    if (input.isDumping) factors.push('Dumping pattern detected');

    // Sentiment-based risks
    if (input.sentimentScore && input.sentimentScore < -0.5) factors.push('Negative sentiment');

    return factors;
  }

  /**
   * Get recommendation based on probability and confidence
   */
  private getRecommendation(probability: number, confidence: number): 'safe' | 'caution' | 'avoid' | 'unknown' {
    if (confidence < 0.3) return 'unknown';
    if (probability > 0.7) return 'avoid';
    if (probability > 0.4) return 'caution';
    return 'safe';
  }

  /**
   * Set ensemble strategy
   */
  setStrategy(strategy: EnsembleStrategy): void {
    this.strategy = strategy;
    logger.info('EnsemblePredictor', `Strategy changed to: ${strategy}`);
  }

  /**
   * Update model weight (for weighted_average strategy)
   */
  updateModelWeight(modelName: string, weight: number): void {
    const model = this.models.get(modelName);
    if (model) {
      model.weight = weight;
      this.saveModelMetadata(modelName, model);
      logger.info('EnsemblePredictor', `Updated ${modelName} weight to ${weight}`);
    }
  }

  /**
   * Update model accuracy
   */
  updateModelAccuracy(modelName: string, accuracy: number): void {
    const model = this.models.get(modelName);
    if (model) {
      model.accuracy = accuracy;
      this.saveModelMetadata(modelName, model);
      logger.info('EnsemblePredictor', `Updated ${modelName} accuracy to ${(accuracy * 100).toFixed(1)}%`);
    }
  }

  /**
   * Save model metadata to disk
   */
  private saveModelMetadata(modelName: string, model: EnsembleModel): void {
    try {
      const modelPath = path.join(this.modelDir, modelName);
      if (!fs.existsSync(modelPath)) {
        fs.mkdirSync(modelPath, { recursive: true });
      }

      const metadata = {
        name: modelName,
        architecture: model.architecture,
        weight: model.weight,
        accuracy: model.accuracy,
        predictions: model.predictions,
        updatedAt: Date.now(),
      };

      fs.writeFileSync(
        path.join(modelPath, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      );
    } catch (error) {
      logger.error('EnsemblePredictor', `Failed to save metadata for ${modelName}`, error as Error);
    }
  }

  /**
   * Save model to disk
   */
  async saveModel(modelName: string): Promise<void> {
    const model = this.models.get(modelName);
    if (!model) {
      throw new Error(`Model ${modelName} not found`);
    }

    try {
      const modelPath = path.join(this.modelDir, modelName);
      if (!fs.existsSync(modelPath)) {
        fs.mkdirSync(modelPath, { recursive: true });
      }

      await model.model.save(`file://${modelPath}`);
      this.saveModelMetadata(modelName, model);

      logger.info('EnsemblePredictor', `Saved model: ${modelName}`);
    } catch (error) {
      logger.error('EnsemblePredictor', `Failed to save model ${modelName}`, error as Error);
      throw error;
    }
  }

  /**
   * Save all models
   */
  async saveAllModels(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [name] of this.models) {
      promises.push(this.saveModel(name));
    }

    await Promise.all(promises);
    logger.info('EnsemblePredictor', 'Saved all ensemble models');
  }

  /**
   * Get ensemble statistics
   */
  getStats(): EnsembleStats {
    const modelStats = Array.from(this.models.values()).map(m => ({
      name: m.name,
      architecture: m.architecture.description,
      weight: m.weight,
      accuracy: m.accuracy,
      predictions: m.predictions,
    }));

    const totalPredictions = modelStats.reduce((sum, m) => sum + m.predictions, 0);
    const avgAccuracy = modelStats.reduce((sum, m) => sum + m.accuracy, 0) / modelStats.length;

    return {
      totalModels: this.models.size,
      activeModels: this.models.size,
      strategy: this.strategy,
      avgAccuracy,
      totalPredictions,
      models: modelStats,
    };
  }

  /**
   * Format stats for display
   */
  formatStats(): string {
    const stats = this.getStats();

    let output = `🎯 Ensemble Predictor Stats\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    output += `📊 Strategy: ${stats.strategy}\n`;
    output += `🤖 Active Models: ${stats.activeModels}/${stats.totalModels}\n`;
    output += `📈 Avg Accuracy: ${(stats.avgAccuracy * 100).toFixed(1)}%\n`;
    output += `🔢 Total Predictions: ${stats.totalPredictions}\n\n`;

    output += `📋 Individual Models:\n`;
    for (const model of stats.models) {
      output += `\n${model.name} (weight: ${model.weight.toFixed(2)})\n`;
      output += `  ${model.architecture}\n`;
      output += `  Accuracy: ${(model.accuracy * 100).toFixed(1)}%\n`;
      output += `  Predictions: ${model.predictions}\n`;
    }

    return output;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    for (const [, model] of this.models) {
      model.model.dispose();
    }
    this.models.clear();
    this.initialized = false;
  }
}

// Export singleton
export const ensemblePredictor = new EnsemblePredictor();
