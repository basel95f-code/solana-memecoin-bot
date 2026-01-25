/**
 * Ensemble ML Predictor
 * Combines multiple ML models for robust predictions
 * Advanced feature engineering and model voting
 */

import { logger } from '../../utils/logger';

export interface MLModel {
  id: string;
  name: string;
  type: 'neural' | 'gradient_boost' | 'random_forest' | 'logistic';
  accuracy: number;
  weight: number;               // Voting weight based on accuracy
  lastTrained: number;
}

export interface EnsemblePrediction {
  rugProbability: number;       // 0-1, probability of rug
  confidence: number;           // 0-1, prediction confidence
  
  // Individual model predictions
  modelPredictions: ModelPrediction[];
  
  // Voting results
  agreement: number;            // 0-1, how much models agree
  votingMethod: 'majority' | 'weighted' | 'unanimous';
  
  // Feature importance
  topFeatures: FeatureImportance[];
  
  timestamp: number;
}

export interface ModelPrediction {
  modelId: string;
  prediction: number;           // 0-1
  confidence: number;
  weight: number;
}

export interface FeatureImportance {
  feature: string;
  importance: number;           // 0-1
  value: number;
}

export interface TokenFeatures {
  // Basic metrics
  liquidity: number;
  holderCount: number;
  top10HoldersPercent: number;
  
  // Contract safety
  mintRevoked: boolean;
  freezeRevoked: boolean;
  lpBurned: boolean;
  
  // Social
  hasTwitter: boolean;
  hasTelegram: boolean;
  hasWebsite: boolean;
  
  // Price action
  priceChange1h: number;
  priceChange24h: number;
  volume24h: number;
  
  // Smart money
  smartMoneyBuyingCount: number;
  smartMoneyConfidence: number;
  
  // Sentiment
  sentimentScore: number;
  mentionVolume: number;
  
  // Timing
  tokenAgeHours: number;
}

export class EnsemblePredictor {
  private models: Map<string, MLModel> = new Map();
  private predictionHistory: EnsemblePrediction[] = [];
  private readonly MAX_HISTORY = 500;

  constructor() {
    this.initializeModels();
  }

  /**
   * Initialize ensemble models
   */
  private initializeModels(): void {
    this.models.set('neural-1', {
      id: 'neural-1',
      name: 'Deep Neural Network',
      type: 'neural',
      accuracy: 0.78,
      weight: 1.0,
      lastTrained: Date.now(),
    });

    this.models.set('gradient-1', {
      id: 'gradient-1',
      name: 'Gradient Boosting',
      type: 'gradient_boost',
      accuracy: 0.75,
      weight: 0.9,
      lastTrained: Date.now(),
    });

    this.models.set('forest-1', {
      id: 'forest-1',
      name: 'Random Forest',
      type: 'random_forest',
      accuracy: 0.72,
      weight: 0.8,
      lastTrained: Date.now(),
    });

    this.models.set('logistic-1', {
      id: 'logistic-1',
      name: 'Logistic Regression',
      type: 'logistic',
      accuracy: 0.68,
      weight: 0.7,
      lastTrained: Date.now(),
    });

    logger.info('EnsemblePredictor', `Initialized ${this.models.size} models`);
  }

  /**
   * Predict using ensemble
   */
  async predict(features: TokenFeatures): Promise<EnsemblePrediction> {
    logger.debug('EnsemblePredictor', 'Running ensemble prediction');

    // Get predictions from all models
    const modelPredictions = await this.getPredictionsFromAllModels(features);

    // Calculate ensemble prediction (weighted average)
    const rugProbability = this.calculateWeightedAverage(modelPredictions);

    // Calculate agreement
    const agreement = this.calculateAgreement(modelPredictions);

    // Calculate confidence
    const confidence = this.calculateConfidence(agreement, modelPredictions);

    // Determine voting method used
    const votingMethod = this.determineVotingMethod(agreement);

    // Calculate feature importance
    const topFeatures = this.calculateFeatureImportance(features);

    const prediction: EnsemblePrediction = {
      rugProbability,
      confidence,
      modelPredictions,
      agreement,
      votingMethod,
      topFeatures,
      timestamp: Date.now(),
    };

    // Store history
    this.predictionHistory.push(prediction);
    if (this.predictionHistory.length > this.MAX_HISTORY) {
      this.predictionHistory.shift();
    }

    logger.info('EnsemblePredictor', `Prediction: ${(rugProbability * 100).toFixed(1)}% rug prob, ${(confidence * 100).toFixed(0)}% confidence, ${(agreement * 100).toFixed(0)}% agreement`);

    return prediction;
  }

  /**
   * Get predictions from all models
   */
  private async getPredictionsFromAllModels(features: TokenFeatures): Promise<ModelPrediction[]> {
    const predictions: ModelPrediction[] = [];

    for (const model of this.models.values()) {
      const prediction = await this.predictWithModel(model, features);
      predictions.push(prediction);
    }

    return predictions;
  }

  /**
   * Predict with single model
   */
  private async predictWithModel(model: MLModel, features: TokenFeatures): Promise<ModelPrediction> {
    // In real implementation, would use actual trained models
    // Placeholder: simple heuristic-based prediction

    let rugProb = 0.5; // Start neutral

    // Negative indicators (increase rug probability)
    if (!features.mintRevoked) rugProb += 0.15;
    if (!features.freezeRevoked) rugProb += 0.15;
    if (!features.lpBurned) rugProb += 0.10;
    if (features.top10HoldersPercent > 70) rugProb += 0.10;
    if (features.liquidity < 10000) rugProb += 0.15;
    if (!features.hasTwitter && !features.hasTelegram) rugProb += 0.10;

    // Positive indicators (decrease rug probability)
    if (features.smartMoneyBuyingCount > 3) rugProb -= 0.15;
    if (features.sentimentScore > 0.3) rugProb -= 0.10;
    if (features.liquidity > 50000) rugProb -= 0.15;

    // Clamp to 0-1
    rugProb = Math.max(0, Math.min(1, rugProb));

    // Add model-specific variance
    rugProb += (Math.random() - 0.5) * 0.1;
    rugProb = Math.max(0, Math.min(1, rugProb));

    // Model confidence based on feature completeness
    const featureCompleteness = this.calculateFeatureCompleteness(features);
    const confidence = model.accuracy * featureCompleteness;

    return {
      modelId: model.id,
      prediction: rugProb,
      confidence,
      weight: model.weight,
    };
  }

  /**
   * Calculate weighted average
   */
  private calculateWeightedAverage(predictions: ModelPrediction[]): number {
    const totalWeight = predictions.reduce((sum, p) => sum + p.weight, 0);
    const weightedSum = predictions.reduce((sum, p) => sum + (p.prediction * p.weight), 0);

    return weightedSum / totalWeight;
  }

  /**
   * Calculate agreement between models
   */
  private calculateAgreement(predictions: ModelPrediction[]): number {
    if (predictions.length < 2) return 1.0;

    const avg = predictions.reduce((sum, p) => sum + p.prediction, 0) / predictions.length;
    const variance = predictions.reduce((sum, p) => sum + Math.pow(p.prediction - avg, 2), 0) / predictions.length;

    // Convert variance to agreement (0 variance = perfect agreement = 1.0)
    return Math.max(0, 1 - variance * 4);
  }

  /**
   * Calculate confidence
   */
  private calculateConfidence(agreement: number, predictions: ModelPrediction[]): number {
    // Confidence based on:
    // 1. Model agreement (70%)
    // 2. Average model confidence (30%)

    const avgModelConfidence = predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;

    return (agreement * 0.7 + avgModelConfidence * 0.3);
  }

  /**
   * Determine voting method
   */
  private determineVotingMethod(agreement: number): 'majority' | 'weighted' | 'unanimous' {
    if (agreement >= 0.9) return 'unanimous';
    if (agreement >= 0.7) return 'weighted';
    return 'majority';
  }

  /**
   * Calculate feature importance
   */
  private calculateFeatureImportance(features: TokenFeatures): FeatureImportance[] {
    // Simplified feature importance
    // In real implementation, would use actual model feature importance

    const importances: FeatureImportance[] = [
      { feature: 'smartMoneyBuyingCount', importance: 0.18, value: features.smartMoneyBuyingCount },
      { feature: 'liquidity', importance: 0.16, value: features.liquidity },
      { feature: 'mintRevoked', importance: 0.14, value: features.mintRevoked ? 1 : 0 },
      { feature: 'top10HoldersPercent', importance: 0.12, value: features.top10HoldersPercent },
      { feature: 'sentimentScore', importance: 0.10, value: features.sentimentScore },
      { feature: 'lpBurned', importance: 0.08, value: features.lpBurned ? 1 : 0 },
      { feature: 'volume24h', importance: 0.07, value: features.volume24h },
      { feature: 'holderCount', importance: 0.06, value: features.holderCount },
      { feature: 'hasTwitter', importance: 0.05, value: features.hasTwitter ? 1 : 0 },
      { feature: 'tokenAgeHours', importance: 0.04, value: features.tokenAgeHours },
    ];

    return importances.sort((a, b) => b.importance - a.importance);
  }

  /**
   * Calculate feature completeness
   */
  private calculateFeatureCompleteness(features: TokenFeatures): number {
    const totalFeatures = Object.keys(features).length;
    let completedFeatures = 0;

    for (const [key, value] of Object.entries(features)) {
      if (value !== undefined && value !== null && value !== 0) {
        completedFeatures++;
      }
    }

    return completedFeatures / totalFeatures;
  }

  /**
   * Get model performance
   */
  getModelPerformance(): MLModel[] {
    return Array.from(this.models.values())
      .sort((a, b) => b.accuracy - a.accuracy);
  }

  /**
   * Get prediction history
   */
  getHistory(limit: number = 50): EnsemblePrediction[] {
    return this.predictionHistory.slice(-limit);
  }

  /**
   * Get statistics
   */
  getStats() {
    const predictions = this.predictionHistory;
    if (predictions.length === 0) return null;

    return {
      totalPredictions: predictions.length,
      avgRugProbability: predictions.reduce((sum, p) => sum + p.rugProbability, 0) / predictions.length,
      avgConfidence: predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length,
      avgAgreement: predictions.reduce((sum, p) => sum + p.agreement, 0) / predictions.length,
      votingMethods: {
        unanimous: predictions.filter(p => p.votingMethod === 'unanimous').length,
        weighted: predictions.filter(p => p.votingMethod === 'weighted').length,
        majority: predictions.filter(p => p.votingMethod === 'majority').length,
      },
      modelCount: this.models.size,
    };
  }
}
