/**
 * ML Inference Server
 * Real-time prediction API with caching, batching, and fallbacks
 */

import { logger } from '../../utils/logger';
import { cacheManager, CacheTTL } from '../../cache';
import { pricePredictionModel, type PricePredictionInput } from '../pricePrediction';
import { sentimentCorrelationModel, type SentimentCorrelationInput } from '../sentimentCorrelation';
import { whaleBehaviorModel, type WhaleBehaviorInput } from '../whaleBehavior';
import { rugPredictor, type EnhancedPredictionInput } from '../rugPredictor';

export interface InferenceRequest {
  model: 'price_prediction' | 'sentiment_correlation' | 'whale_behavior' | 'rug_prediction';
  tokenMint?: string;
  input: any;
  options?: {
    useCache?: boolean;
    explain?: boolean;
    batchId?: string;
  };
}

export interface InferenceResponse {
  prediction: any;
  modelVersion: string;
  confidence: number;
  inferenceTime: number; // milliseconds
  cached: boolean;
  explanation?: FeatureExplanation;
}

export interface FeatureExplanation {
  topFeatures: Array<{
    name: string;
    importance: number;
    value: number;
    impact: 'positive' | 'negative' | 'neutral';
  }>;
  shapValues?: number[];
}

export interface BatchInferenceRequest {
  batchId: string;
  requests: InferenceRequest[];
}

export interface BatchInferenceResponse {
  batchId: string;
  results: InferenceResponse[];
  totalTime: number;
}

class MLInferenceServer {
  private initialized: boolean = false;
  private batchQueue: Map<string, InferenceRequest[]> = new Map();
  private batchTimeout: Map<string, NodeJS.Timeout> = new Map();
  
  private readonly BATCH_SIZE = 32;
  private readonly BATCH_TIMEOUT_MS = 100;
  private readonly MAX_INFERENCE_TIME_MS = 500;

  /**
   * Initialize all models
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      logger.info('InferenceServer', 'Initializing all models...');

      await Promise.all([
        pricePredictionModel.initialize(),
        sentimentCorrelationModel.initialize(),
        whaleBehaviorModel.initialize(),
        rugPredictor.initialize(),
      ]);

      this.initialized = true;
      logger.info('InferenceServer', 'All models initialized successfully');
    } catch (error) {
      logger.error('InferenceServer', 'Initialization failed', error as Error);
      throw error;
    }
  }

  /**
   * Single prediction (with caching)
   */
  async predict(request: InferenceRequest): Promise<InferenceResponse> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();

    try {
      // Check cache if enabled
      if (request.options?.useCache !== false) {
        const cached = await this.getCachedPrediction(request);
        if (cached) {
          return {
            ...cached,
            cached: true,
            inferenceTime: Date.now() - startTime,
          };
        }
      }

      // Run inference
      const prediction = await this.runInference(request);

      // Generate explanation if requested
      let explanation: FeatureExplanation | undefined;
      if (request.options?.explain) {
        explanation = this.explainPrediction(request, prediction);
      }

      const response: InferenceResponse = {
        prediction,
        modelVersion: this.getModelVersion(request.model),
        confidence: this.extractConfidence(prediction),
        inferenceTime: Date.now() - startTime,
        cached: false,
        explanation,
      };

      // Cache the result
      if (request.tokenMint) {
        await this.cachePrediction(request, response);
      }

      // Log slow inferences
      if (response.inferenceTime > this.MAX_INFERENCE_TIME_MS) {
        logger.warn('InferenceServer', 
          `Slow inference: ${request.model} took ${response.inferenceTime}ms`
        );
      }

      return response;
    } catch (error) {
      logger.error('InferenceServer', 'Prediction failed', error as Error);
      
      // Return fallback prediction
      return this.getFallbackPrediction(request, Date.now() - startTime);
    }
  }

  /**
   * Batch prediction (optimized for multiple requests)
   */
  async predictBatch(requests: InferenceRequest[]): Promise<InferenceResponse[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    logger.info('InferenceServer', `Processing batch of ${requests.length} requests`);

    // Process all requests in parallel
    const results = await Promise.all(
      requests.map(req => this.predict(req))
    );

    const totalTime = Date.now() - startTime;
    logger.info('InferenceServer', `Batch complete: ${totalTime}ms total, ${(totalTime / requests.length).toFixed(1)}ms avg`);

    return results;
  }

  /**
   * Add request to batch queue (for auto-batching)
   */
  async queueForBatch(request: InferenceRequest): Promise<InferenceResponse> {
    const batchId = request.options?.batchId || 'default';

    if (!this.batchQueue.has(batchId)) {
      this.batchQueue.set(batchId, []);
    }

    const queue = this.batchQueue.get(batchId)!;
    queue.push(request);

    // Process immediately if batch is full
    if (queue.length >= this.BATCH_SIZE) {
      return this.processBatch(batchId, queue.indexOf(request));
    }

    // Otherwise, wait for timeout
    if (!this.batchTimeout.has(batchId)) {
      const timeout = setTimeout(() => {
        this.processBatch(batchId);
      }, this.BATCH_TIMEOUT_MS);
      
      this.batchTimeout.set(batchId, timeout);
    }

    // Return promise that resolves when batch is processed
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!queue.includes(request)) {
          clearInterval(checkInterval);
          // Request was processed, get from cache
          this.getCachedPrediction(request).then(cached => {
            if (cached) {
              resolve(cached as InferenceResponse);
            }
          });
        }
      }, 10);
    });
  }

  /**
   * Process queued batch
   */
  private async processBatch(batchId: string, requestIndex?: number): Promise<InferenceResponse> {
    const queue = this.batchQueue.get(batchId);
    if (!queue || queue.length === 0) {
      throw new Error('Batch queue is empty');
    }

    // Clear timeout
    const timeout = this.batchTimeout.get(batchId);
    if (timeout) {
      clearTimeout(timeout);
      this.batchTimeout.delete(batchId);
    }

    // Process batch
    const results = await this.predictBatch(queue);

    // Clear queue
    this.batchQueue.delete(batchId);

    // Return specific result if requested
    if (requestIndex !== undefined && requestIndex < results.length) {
      return results[requestIndex];
    }

    return results[0];
  }

  /**
   * Run model inference
   */
  private async runInference(request: InferenceRequest): Promise<any> {
    switch (request.model) {
      case 'price_prediction':
        return await pricePredictionModel.predictAll(request.input as PricePredictionInput);

      case 'sentiment_correlation':
        return await sentimentCorrelationModel.analyzeCorrelation(request.input as SentimentCorrelationInput);

      case 'whale_behavior':
        return await whaleBehaviorModel.predict(request.input as WhaleBehaviorInput);

      case 'rug_prediction':
        return await rugPredictor.predictEnhanced(request.input as EnhancedPredictionInput);

      default:
        throw new Error(`Unknown model: ${request.model}`);
    }
  }

  /**
   * Explain prediction (simplified SHAP-like approach)
   */
  private explainPrediction(request: InferenceRequest, prediction: any): FeatureExplanation {
    // Simplified feature importance (would use SHAP in production)
    const features = request.input.features || {};
    
    const topFeatures = Object.entries(features)
      .map(([name, value]) => ({
        name,
        importance: this.calculateFeatureImportance(name, value as number),
        value: value as number,
        impact: this.determineImpact(value as number) as 'positive' | 'negative' | 'neutral',
      }))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 10);

    return { topFeatures };
  }

  /**
   * Calculate feature importance (placeholder)
   */
  private calculateFeatureImportance(name: string, value: number): number {
    // This would use actual SHAP values in production
    // For now, using heuristic based on feature name
    const importantFeatures = ['liquidityUsd', 'riskScore', 'sentimentScore', 'dumpProbability'];
    const baseImportance = importantFeatures.includes(name) ? 0.8 : 0.5;
    
    // Adjust by value magnitude
    return baseImportance * (1 + Math.abs(value - 0.5));
  }

  /**
   * Determine impact direction
   */
  private determineImpact(value: number): 'positive' | 'negative' | 'neutral' {
    if (value > 0.6) return 'positive';
    if (value < 0.4) return 'negative';
    return 'neutral';
  }

  /**
   * Get cached prediction
   */
  private async getCachedPrediction(request: InferenceRequest): Promise<InferenceResponse | null> {
    if (!request.tokenMint) return null;

    const cacheKey = `ml:${request.model}:${request.tokenMint}`;
    return await cacheManager.get<InferenceResponse>(cacheKey);
  }

  /**
   * Cache prediction
   */
  private async cachePrediction(request: InferenceRequest, response: InferenceResponse): Promise<void> {
    if (!request.tokenMint) return;

    const cacheKey = `ml:${request.model}:${request.tokenMint}`;
    await cacheManager.set(cacheKey, response, CacheTTL.ML_PREDICTION);
  }

  /**
   * Get model version
   */
  private getModelVersion(model: string): string {
    return `v1.0.0-${model}`;
  }

  /**
   * Extract confidence from prediction
   */
  private extractConfidence(prediction: any): number {
    if (prediction.confidence !== undefined) {
      return prediction.confidence;
    }

    if (Array.isArray(prediction) && prediction[0]?.confidence !== undefined) {
      return prediction[0].confidence;
    }

    return 0.5;
  }

  /**
   * Fallback prediction when model fails
   */
  private getFallbackPrediction(request: InferenceRequest, inferenceTime: number): InferenceResponse {
    logger.warn('InferenceServer', `Using fallback for ${request.model}`);

    return {
      prediction: this.getDefaultPrediction(request.model),
      modelVersion: `v1.0.0-${request.model}-fallback`,
      confidence: 0,
      inferenceTime,
      cached: false,
    };
  }

  /**
   * Get default/safe prediction
   */
  private getDefaultPrediction(model: string): any {
    switch (model) {
      case 'price_prediction':
        return [{
          timeframe: '1h',
          probabilities: { up: 0.33, down: 0.33, sideways: 0.34 },
          predictedDirection: 'sideways',
          confidence: 0,
          expectedChange: 0,
          modelVersion: 'fallback',
        }];

      case 'sentiment_correlation':
        return {
          correlation: 0,
          timeLag: 0,
          predictedPriceImpact: 0,
          confidence: 0,
          isSignificant: false,
          recommendation: 'neutral',
        };

      case 'whale_behavior':
        return {
          predictedAction: 'holding',
          confidence: 0,
          probabilities: { accumulation: 0.25, distribution: 0.25, dump: 0.25, holding: 0.25 },
          dumpProbability: 0.25,
          timeToAction: 24,
          riskLevel: 'low',
          signals: [],
        };

      case 'rug_prediction':
      default:
        return {
          rugProbability: 0.5,
          confidence: 0,
          riskFactors: ['Model unavailable'],
          recommendation: 'unknown',
        };
    }
  }

  /**
   * Get server statistics
   */
  getStats(): {
    initialized: boolean;
    queuedBatches: number;
    models: Record<string, any>;
  } {
    return {
      initialized: this.initialized,
      queuedBatches: this.batchQueue.size,
      models: {
        pricePrediction: pricePredictionModel.getStats(),
        sentimentCorrelation: sentimentCorrelationModel.getStats(),
        whaleBehavior: whaleBehaviorModel.getStats(),
        rugPrediction: rugPredictor.getStats(),
      },
    };
  }

  /**
   * Warm up models (run dummy predictions)
   */
  async warmUp(): Promise<void> {
    logger.info('InferenceServer', 'Warming up models...');

    const dummyRequests: InferenceRequest[] = [
      {
        model: 'price_prediction',
        input: { features: {} },
      },
      {
        model: 'sentiment_correlation',
        input: { current: {}, currentPrice: 0 },
      },
      {
        model: 'whale_behavior',
        input: { wallet: {}, currentPrice: 0, priceChange24h: 0, volumeProfile: {} },
      },
      {
        model: 'rug_prediction',
        input: {},
      },
    ];

    try {
      await Promise.all(dummyRequests.map(req => this.predict(req)));
      logger.info('InferenceServer', 'Warm-up complete');
    } catch (error) {
      logger.error('InferenceServer', 'Warm-up failed', error as Error);
    }
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    // Clear all batches
    for (const timeout of this.batchTimeout.values()) {
      clearTimeout(timeout);
    }
    this.batchTimeout.clear();
    this.batchQueue.clear();

    // Dispose models
    pricePredictionModel.dispose();
    sentimentCorrelationModel.dispose();
    whaleBehaviorModel.dispose();
    rugPredictor.dispose();

    this.initialized = false;
  }
}

export const mlInferenceServer = new MLInferenceServer();
