/**
 * Whale Behavior Prediction Model
 * Predicts whale actions: accumulation, distribution, dump
 * Pattern recognition in wallet transaction history
 */

import * as tf from '@tensorflow/tfjs';
import { logger } from '../utils/logger';
import { database } from '../database';
import path from 'path';
import fs from 'fs';

export type WhaleAction = 'accumulation' | 'distribution' | 'dump' | 'holding';

export interface WhaleTransaction {
  timestamp: number;
  amount: number;        // Token amount
  usdValue: number;      // USD value
  type: 'buy' | 'sell';
  priceImpact: number;   // % price impact
}

export interface WhaleWalletProfile {
  address: string;
  totalBalance: number;
  holdingPercent: number;           // % of total supply
  transactionHistory: WhaleTransaction[];
  avgBuySize: number;
  avgSellSize: number;
  buyFrequency: number;             // Txs per hour
  sellFrequency: number;
  profitRatio: number;              // Wins / total trades
  holdingDuration: number;          // Hours
  isSmartMoney: boolean;
}

export interface WhaleBehaviorInput {
  wallet: WhaleWalletProfile;
  currentPrice: number;
  priceChange24h: number;
  volumeProfile: {
    buyVolume24h: number;
    sellVolume24h: number;
  };
}

export interface WhaleBehaviorResult {
  predictedAction: WhaleAction;
  confidence: number;
  probabilities: {
    accumulation: number;
    distribution: number;
    dump: number;
    holding: number;
  };
  dumpProbability: number;         // Specific dump risk
  timeToAction: number;            // Estimated hours until action
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  signals: string[];               // Pattern signals detected
}

export interface WhalePattern {
  name: string;
  description: string;
  bullish: boolean;
  confidence: number;
}

class WhaleBehaviorModel {
  private model: tf.LayersModel | null = null;
  private clusteringModel: tf.LayersModel | null = null; // For wallet clustering
  private modelDir: string;
  private initialized: boolean = false;
  private isTraining: boolean = false;

  // Model hyperparameters
  private readonly DENSE_UNITS = 64;
  private readonly DROPOUT_RATE = 0.3;
  private readonly SEQUENCE_LENGTH = 20; // Last 20 transactions

  // Whale thresholds
  private readonly WHALE_THRESHOLDS = {
    HOLDING_PERCENT: 1.0,      // >1% of supply
    MIN_USD_VALUE: 10000,       // $10k+ positions
    DUMP_THRESHOLD: 50,         // Selling >50% in short time
  };

  // Pattern detection windows
  private readonly WINDOWS = {
    ACCUMULATION: 24,    // 24 hours
    DISTRIBUTION: 12,    // 12 hours  
    DUMP: 1,            // 1 hour
  };

  constructor() {
    this.modelDir = path.join(process.cwd(), 'data', 'models', 'whale_behavior');
  }

  /**
   * Initialize whale behavior models
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
        logger.info('WhaleBehavior', 'Loaded existing model');
      } else {
        this.model = this.createModel();
        logger.info('WhaleBehavior', 'Created new model (needs training)');
      }

      // Create clustering model for similar wallet identification
      this.clusteringModel = this.createClusteringModel();

      this.initialized = true;
    } catch (error) {
      logger.error('WhaleBehavior', 'Initialization failed', error as Error);
      throw error;
    }
  }

  /**
   * Create neural network for whale action prediction
   */
  private createModel(): tf.LayersModel {
    const model = tf.sequential();

    // Input: whale features (15 features)
    model.add(tf.layers.dense({
      units: this.DENSE_UNITS,
      activation: 'relu',
      inputShape: [15],
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
    }));

    model.add(tf.layers.batchNormalization());
    model.add(tf.layers.dropout({ rate: this.DROPOUT_RATE }));

    model.add(tf.layers.dense({
      units: this.DENSE_UNITS / 2,
      activation: 'relu',
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
    }));

    model.add(tf.layers.dropout({ rate: 0.2 }));

    // Output: 4 classes (accumulation, distribution, dump, holding)
    model.add(tf.layers.dense({
      units: 4,
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
   * Create autoencoder for wallet clustering
   */
  private createClusteringModel(): tf.LayersModel {
    const model = tf.sequential();

    // Encoder
    model.add(tf.layers.dense({
      units: 32,
      activation: 'relu',
      inputShape: [15],
    }));

    model.add(tf.layers.dense({
      units: 16,
      activation: 'relu',
    }));

    // Bottleneck (cluster representation)
    model.add(tf.layers.dense({
      units: 8,
      activation: 'relu',
      name: 'bottleneck',
    }));

    // Decoder
    model.add(tf.layers.dense({
      units: 16,
      activation: 'relu',
    }));

    model.add(tf.layers.dense({
      units: 32,
      activation: 'relu',
    }));

    model.add(tf.layers.dense({
      units: 15,
      activation: 'sigmoid',
    }));

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'meanSquaredError',
    });

    return model;
  }

  /**
   * Predict whale behavior
   */
  async predict(input: WhaleBehaviorInput): Promise<WhaleBehaviorResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.model) {
      throw new Error('Model not loaded');
    }

    try {
      // Extract features from wallet profile
      const features = this.extractWhaleFeatures(input);

      // Predict action probabilities
      const inputTensor = tf.tensor2d([features]);
      const prediction = this.model.predict(inputTensor) as tf.Tensor;
      const probabilities = await prediction.data();

      inputTensor.dispose();
      prediction.dispose();

      const probs = {
        accumulation: probabilities[0],
        distribution: probabilities[1],
        dump: probabilities[2],
        holding: probabilities[3],
      };

      // Determine predicted action
      const predictedAction = this.getPredictedAction(probs);
      const confidence = Math.max(...Object.values(probs));
      const dumpProbability = probs.dump;

      // Detect patterns
      const patterns = this.detectPatterns(input);
      const signals = patterns.map(p => p.description);

      // Estimate time to action
      const timeToAction = this.estimateTimeToAction(input, predictedAction);

      // Calculate risk level
      const riskLevel = this.calculateRiskLevel(dumpProbability, confidence);

      return {
        predictedAction,
        confidence,
        probabilities: probs,
        dumpProbability,
        timeToAction,
        riskLevel,
        signals,
      };
    } catch (error) {
      logger.error('WhaleBehavior', 'Prediction failed', error as Error);
      throw error;
    }
  }

  /**
   * Extract features from whale wallet profile
   */
  private extractWhaleFeatures(input: WhaleBehaviorInput): number[] {
    const { wallet, currentPrice, priceChange24h, volumeProfile } = input;

    // Transaction pattern features
    const recentTxs = wallet.transactionHistory.slice(-this.SEQUENCE_LENGTH);
    const buyCount = recentTxs.filter(tx => tx.type === 'buy').length;
    const sellCount = recentTxs.filter(tx => tx.type === 'sell').length;
    
    const avgBuyAmount = recentTxs
      .filter(tx => tx.type === 'buy')
      .reduce((sum, tx) => sum + tx.amount, 0) / (buyCount || 1);
    
    const avgSellAmount = recentTxs
      .filter(tx => tx.type === 'sell')
      .reduce((sum, tx) => sum + tx.amount, 0) / (sellCount || 1);

    // Time-based features
    const now = Date.now();
    const timeSinceLastTx = recentTxs.length > 0
      ? (now - recentTxs[recentTxs.length - 1].timestamp) / (1000 * 60 * 60)
      : 999;

    // Position features
    const positionValue = wallet.totalBalance * currentPrice;

    return [
      Math.min(1, wallet.holdingPercent / 10),              // Holding % (0-1)
      Math.min(1, wallet.totalBalance / 10000000),          // Balance normalized
      Math.min(1, positionValue / 1000000),                 // Position value (cap at $1M)
      Math.min(1, buyCount / this.SEQUENCE_LENGTH),         // Buy frequency
      Math.min(1, sellCount / this.SEQUENCE_LENGTH),        // Sell frequency
      Math.min(1, avgBuyAmount / wallet.totalBalance),      // Avg buy size relative to balance
      Math.min(1, avgSellAmount / wallet.totalBalance),     // Avg sell size relative to balance
      wallet.profitRatio,                                    // Profit ratio (0-1)
      Math.min(1, wallet.holdingDuration / 168),            // Holding duration (cap at 1 week)
      wallet.isSmartMoney ? 1 : 0,                          // Smart money flag
      (priceChange24h + 100) / 300,                          // Price change normalized
      Math.min(1, volumeProfile.buyVolume24h / 1000000),    // Buy volume
      Math.min(1, volumeProfile.sellVolume24h / 1000000),   // Sell volume
      Math.min(1, timeSinceLastTx / 24),                    // Time since last tx (hours)
      this.calculateMomentum(recentTxs),                    // Transaction momentum
    ];
  }

  /**
   * Calculate transaction momentum (buying vs selling trend)
   */
  private calculateMomentum(transactions: WhaleTransaction[]): number {
    if (transactions.length < 2) return 0.5;

    let momentum = 0;
    const weights = transactions.map((_, i) => i + 1); // Recent txs have higher weight
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    transactions.forEach((tx, i) => {
      const weight = weights[i] / totalWeight;
      momentum += (tx.type === 'buy' ? 1 : -1) * weight;
    });

    return (momentum + 1) / 2; // Normalize to 0-1
  }

  /**
   * Get predicted action from probabilities
   */
  private getPredictedAction(probs: Record<WhaleAction, number>): WhaleAction {
    const entries = Object.entries(probs) as [WhaleAction, number][];
    const sorted = entries.sort((a, b) => b[1] - a[1]);
    return sorted[0][0];
  }

  /**
   * Detect whale patterns in transaction history
   */
  private detectPatterns(input: WhaleBehaviorInput): WhalePattern[] {
    const patterns: WhalePattern[] = [];
    const { wallet, priceChange24h } = input;
    const recentTxs = wallet.transactionHistory.slice(-20);

    // Pattern 1: Accumulation (consistent buying)
    const buyCount = recentTxs.filter(tx => tx.type === 'buy').length;
    if (buyCount >= 8) {
      patterns.push({
        name: 'Accumulation',
        description: 'Consistent buying pattern detected',
        bullish: true,
        confidence: buyCount / recentTxs.length,
      });
    }

    // Pattern 2: Distribution (gradual selling)
    const sellCount = recentTxs.filter(tx => tx.type === 'sell').length;
    if (sellCount >= 6 && sellCount < 12) {
      patterns.push({
        name: 'Distribution',
        description: 'Gradual distribution of holdings',
        bullish: false,
        confidence: sellCount / recentTxs.length,
      });
    }

    // Pattern 3: Dump warning (rapid selling)
    const last5Txs = recentTxs.slice(-5);
    const recentSells = last5Txs.filter(tx => tx.type === 'sell').length;
    if (recentSells >= 4) {
      patterns.push({
        name: 'Dump Warning',
        description: 'Rapid selling detected - dump risk',
        bullish: false,
        confidence: 0.9,
      });
    }

    // Pattern 4: Buy the dip (buying during price decline)
    if (priceChange24h < -20 && buyCount > sellCount) {
      patterns.push({
        name: 'Buy The Dip',
        description: 'Whale buying during price decline',
        bullish: true,
        confidence: 0.7,
      });
    }

    // Pattern 5: Taking profits (selling during pump)
    if (priceChange24h > 50 && sellCount > buyCount) {
      patterns.push({
        name: 'Profit Taking',
        description: 'Whale taking profits during pump',
        bullish: false,
        confidence: 0.6,
      });
    }

    // Pattern 6: Holding strong (no recent activity)
    const timeSinceLastTx = recentTxs.length > 0
      ? (Date.now() - recentTxs[recentTxs.length - 1].timestamp) / (1000 * 60 * 60)
      : 999;
    
    if (timeSinceLastTx > 48 && wallet.holdingPercent > 2) {
      patterns.push({
        name: 'Diamond Hands',
        description: 'Whale holding strong with no recent sells',
        bullish: true,
        confidence: 0.8,
      });
    }

    return patterns;
  }

  /**
   * Estimate time until whale action (hours)
   */
  private estimateTimeToAction(
    input: WhaleBehaviorInput,
    action: WhaleAction
  ): number {
    const { wallet } = input;
    const recentTxs = wallet.transactionHistory.slice(-10);
    
    if (recentTxs.length < 2) return 24; // Default 24h if no pattern

    // Calculate average time between transactions
    const intervals: number[] = [];
    for (let i = 1; i < recentTxs.length; i++) {
      const interval = (recentTxs[i].timestamp - recentTxs[i - 1].timestamp) / (1000 * 60 * 60);
      intervals.push(interval);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    // Adjust based on action type
    switch (action) {
      case 'dump':
        return Math.min(avgInterval / 2, 2); // Dumps happen quickly
      case 'distribution':
        return avgInterval;
      case 'accumulation':
        return avgInterval * 1.5;
      case 'holding':
        return avgInterval * 3;
      default:
        return avgInterval;
    }
  }

  /**
   * Calculate risk level based on dump probability
   */
  private calculateRiskLevel(
    dumpProbability: number,
    confidence: number
  ): 'low' | 'medium' | 'high' | 'critical' {
    const risk = dumpProbability * confidence;

    if (risk > 0.7) return 'critical';
    if (risk > 0.5) return 'high';
    if (risk > 0.3) return 'medium';
    return 'low';
  }

  /**
   * Find similar whale wallets using clustering
   */
  async findSimilarWhales(
    wallet: WhaleWalletProfile,
    allWallets: WhaleWalletProfile[]
  ): Promise<WhaleWalletProfile[]> {
    if (!this.clusteringModel || allWallets.length < 5) {
      return [];
    }

    try {
      // Extract features for all wallets
      const features = allWallets.map(w => 
        this.extractWhaleFeatures({
          wallet: w,
          currentPrice: 0,
          priceChange24h: 0,
          volumeProfile: { buyVolume24h: 0, sellVolume24h: 0 },
        })
      );

      const targetFeatures = this.extractWhaleFeatures({
        wallet,
        currentPrice: 0,
        priceChange24h: 0,
        volumeProfile: { buyVolume24h: 0, sellVolume24h: 0 },
      });

      // Get embeddings (bottleneck layer output)
      const featuresTensor = tf.tensor2d(features);
      const targetTensor = tf.tensor2d([targetFeatures]);

      const intermediate = tf.model({
        inputs: this.clusteringModel.input,
        outputs: this.clusteringModel.getLayer('bottleneck').output,
      });

      const embeddings = intermediate.predict(featuresTensor) as tf.Tensor;
      const targetEmbedding = intermediate.predict(targetTensor) as tf.Tensor;

      // Calculate distances
      const distances = await this.calculateDistances(targetEmbedding, embeddings);

      featuresTensor.dispose();
      targetTensor.dispose();
      embeddings.dispose();
      targetEmbedding.dispose();

      // Return top 5 most similar wallets
      const sorted = distances
        .map((dist, idx) => ({ distance: dist, wallet: allWallets[idx] }))
        .sort((a, b) => a.distance - b.distance)
        .slice(1, 6); // Exclude self (index 0)

      return sorted.map(s => s.wallet);
    } catch (error) {
      logger.error('WhaleBehavior', 'Similar wallet search failed', error as Error);
      return [];
    }
  }

  /**
   * Calculate Euclidean distances
   */
  private async calculateDistances(
    target: tf.Tensor,
    embeddings: tf.Tensor
  ): Promise<number[]> {
    const diff = tf.sub(embeddings, target);
    const squared = tf.square(diff);
    const summed = tf.sum(squared, 1);
    const distances = tf.sqrt(summed);
    
    const result = await distances.array() as number[];
    
    diff.dispose();
    squared.dispose();
    summed.dispose();
    distances.dispose();

    return result;
  }

  /**
   * Train the model
   */
  async train(options?: {
    epochs?: number;
    batchSize?: number;
  }): Promise<{
    success: boolean;
    samplesUsed: number;
    finalLoss: number;
    finalAccuracy: number;
  }> {
    if (this.isTraining || !this.model) {
      throw new Error('Cannot train: model not ready or already training');
    }

    this.isTraining = true;

    try {
      logger.info('WhaleBehavior', 'Starting training...');

      // Get training data
      const trainingData = await this.prepareTrainingData();

      if (trainingData.length < 100) {
        logger.warn('WhaleBehavior', `Insufficient data: ${trainingData.length}`);
        return { success: false, samplesUsed: trainingData.length, finalLoss: 0, finalAccuracy: 0 };
      }

      // Prepare tensors
      const features: number[][] = [];
      const labels: number[][] = [];

      for (const sample of trainingData) {
        features.push(sample.features);
        
        // One-hot encode action
        const oneHot = [0, 0, 0, 0];
        oneHot[sample.actionIndex] = 1;
        labels.push(oneHot);
      }

      const xs = tf.tensor2d(features);
      const ys = tf.tensor2d(labels);

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
              logger.info('WhaleBehavior',
                `Epoch ${epoch}: loss=${logs?.loss?.toFixed(4)}, acc=${logs?.acc?.toFixed(4)}`
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
      const finalAccuracy = history.history.acc[history.history.acc.length - 1] as number;

      logger.info('WhaleBehavior', `Training complete: accuracy=${(finalAccuracy * 100).toFixed(2)}%`);

      return {
        success: true,
        samplesUsed: trainingData.length,
        finalLoss,
        finalAccuracy,
      };
    } catch (error) {
      logger.error('WhaleBehavior', 'Training failed', error as Error);
      return { success: false, samplesUsed: 0, finalLoss: 0, finalAccuracy: 0 };
    } finally {
      this.isTraining = false;
    }
  }

  /**
   * Prepare training data
   */
  private async prepareTrainingData(): Promise<Array<{
    features: number[];
    actionIndex: number;
  }>> {
    // Query historical whale behavior with known outcomes
    return [];
  }

  /**
   * Record prediction
   */
  async recordPrediction(
    tokenMint: string,
    walletAddress: string,
    result: WhaleBehaviorResult
  ): Promise<void> {
    try {
      database.query(
        `INSERT INTO ml_predictions (
          token_mint, model_type, model_version,
          predicted_direction, confidence,
          metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          tokenMint,
          'whale_behavior',
          'v1.0.0',
          result.predictedAction,
          result.confidence,
          JSON.stringify({
            wallet: walletAddress,
            dumpProbability: result.dumpProbability,
            riskLevel: result.riskLevel,
            signals: result.signals,
            probabilities: result.probabilities,
          }),
          new Date(),
        ]
      );
    } catch (error) {
      logger.error('WhaleBehavior', 'Failed to record prediction', error as Error);
    }
  }

  /**
   * Get model statistics
   */
  getStats(): {
    initialized: boolean;
    isTraining: boolean;
    hasModel: boolean;
    hasClusteringModel: boolean;
  } {
    return {
      initialized: this.initialized,
      isTraining: this.isTraining,
      hasModel: this.model !== null,
      hasClusteringModel: this.clusteringModel !== null,
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
    if (this.clusteringModel) {
      this.clusteringModel.dispose();
      this.clusteringModel = null;
    }
    this.initialized = false;
  }
}

export const whaleBehaviorModel = new WhaleBehaviorModel();
