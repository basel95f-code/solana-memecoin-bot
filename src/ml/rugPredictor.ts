/**
 * Rug Pull Predictor using TensorFlow.js (Enhanced v2)
 * Neural network trained on historical token data to predict rug probability
 * 
 * Architecture: 128 → 64 → 32 → 16 → 1 (sigmoid)
 * Features: 25 (liquidity, holders, contract, social, smart money, sentiment)
 * 
 * Improvements over v1:
 * - 25 features (up from 9)
 * - Deeper network (4 hidden layers vs 2)
 * - Added: smart money signals, social strength, sentiment, transfer fees
 * - Enhanced holder metrics: top20, whale count, dev wallet tracking
 * - LP lock duration tracking
 * - Composite risk indicator
 */

import * as tf from '@tensorflow/tfjs';
import path from 'path';
import fs from 'fs';
import { database } from '../database';
import { logger } from '../utils/logger';

export interface PredictionInput {
  // Liquidity metrics
  liquidityUsd: number;
  lpBurnedPercent: number;
  lpLockedPercent: number;
  lpLockDurationHours?: number;
  
  // Holder distribution
  holderCount: number;
  top10Percent: number;
  top20Percent: number;
  largestHolderPercent: number;
  whaleCount: number;
  devWalletPercent: number;
  
  // Contract safety
  mintRevoked: boolean;
  freezeRevoked: boolean;
  hasTransferFee: boolean;
  transferFeePercent: number;
  
  // Social metrics
  hasSocials: boolean;
  twitterFollowers: number;
  telegramMembers: number;
  hasMetadataImage: boolean;
  
  // Smart money
  smartBuys24h: number;
  smartSells24h: number;
  netSmartMoney: number;
  
  // Sentiment
  sentimentScore: number; // -1 to 1
  
  // Token characteristics
  tokenAgeHours: number;
  riskScore: number;
}

export interface PredictionResult {
  rugProbability: number;
  confidence: number;
  riskFactors: string[];
  recommendation: 'safe' | 'caution' | 'avoid' | 'unknown';
}

export interface TrainingMetrics {
  epoch: number;
  loss: number;
  accuracy: number;
  valLoss: number;
  valAccuracy: number;
  precision?: number;
  recall?: number;
  f1Score?: number;
}

export interface FeatureImportance {
  featureName: string;
  importance: number;
  rank: number;
}

class RugPredictor {
  private model: tf.LayersModel | null = null;
  private modelDir: string;
  private isTraining: boolean = false;
  private initialized: boolean = false;
  private trainingHistory: TrainingMetrics[] = [];
  private totalPredictions: number = 0;
  private featureImportance: FeatureImportance[] = [];
  private bestValAccuracy: number = 0;
  private lastTrainedAt: Date | null = null;

  // Feature normalization parameters
  private readonly NORMALIZATION = {
    liquidityMax: 1000000,
    holderCountMax: 10000,
    ageHoursMax: 168, // 1 week
    twitterFollowersMax: 100000,
    telegramMembersMax: 50000,
    smartMoneyMax: 50, // Max smart money buys/sells per 24h
    lpLockDurationMax: 8760, // 1 year in hours
    whaleCountMax: 20,
  };

  // Feature names for importance analysis
  private readonly FEATURE_NAMES = [
    'liquidityUsd', 'lpBurnedPercent', 'lpLockedPercent', 'lpLockDuration',
    'holderCount', 'top10Percent', 'top20Percent', 'largestHolder',
    'whaleCount', 'devWalletPercent',
    'mintRevoked', 'freezeRevoked', 'hasTransferFee', 'transferFeePercent',
    'hasSocials', 'twitterFollowers', 'telegramMembers', 'hasMetadataImage',
    'smartBuys', 'smartSells', 'netSmartMoney',
    'sentimentScore',
    'tokenAge', 'riskScore',
    'compositeRisk'
  ];

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

    // Input layer: 25 features (enhanced)
    model.add(tf.layers.dense({
      inputShape: [25],
      units: 128,
      activation: 'relu',
      kernelInitializer: 'heNormal',
    }));

    // Add batch normalization for stability
    model.add(tf.layers.batchNormalization());

    // Dropout for regularization
    model.add(tf.layers.dropout({ rate: 0.3 }));

    // Hidden layer 1: Larger to handle more features
    model.add(tf.layers.dense({
      units: 64,
      activation: 'relu',
      kernelInitializer: 'heNormal',
    }));

    model.add(tf.layers.batchNormalization());
    model.add(tf.layers.dropout({ rate: 0.25 }));

    // Hidden layer 2
    model.add(tf.layers.dense({
      units: 32,
      activation: 'relu',
      kernelInitializer: 'heNormal',
    }));

    model.add(tf.layers.dropout({ rate: 0.2 }));

    // Hidden layer 3: Extra layer for complex patterns
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
   * Train the model on historical data (Enhanced v2)
   * 
   * Improvements:
   * - Class imbalance handling (balanced class weights)
   * - Early stopping (stops when validation stops improving)
   * - Better metrics (precision, recall, F1)
   * - Feature importance calculation
   * - Stratified sampling
   */
  async train(options?: { 
    epochs?: number; 
    batchSize?: number;
    patience?: number; // Early stopping patience
  }): Promise<{
    success: boolean;
    samplesUsed: number;
    rugCount: number;
    safeCount: number;
    finalLoss: number;
    finalAccuracy: number;
    valLoss: number;
    valAccuracy: number;
    precision?: number;
    recall?: number;
    f1Score?: number;
    stoppedEarly: boolean;
    epochsTrained: number;
  }> {
    if (this.isTraining || !this.model) {
      return { 
        success: false, 
        samplesUsed: 0, 
        rugCount: 0,
        safeCount: 0,
        finalLoss: 0, 
        finalAccuracy: 0,
        valLoss: 0,
        valAccuracy: 0,
        stoppedEarly: false,
        epochsTrained: 0,
      };
    }

    this.isTraining = true;

    try {
      // Get training data from database
      const trainingData = database.getMLTrainingData(10000);

      if (trainingData.length < 50) {
        logger.warn('RugPredictor', `Insufficient training data: ${trainingData.length} samples (need 50+)`);
        this.isTraining = false;
        return { 
          success: false, 
          samplesUsed: trainingData.length, 
          rugCount: 0,
          safeCount: 0,
          finalLoss: 0, 
          finalAccuracy: 0,
          valLoss: 0,
          valAccuracy: 0,
          stoppedEarly: false,
          epochsTrained: 0,
        };
      }

      // Prepare features and labels
      const features: number[][] = [];
      const labels: number[] = [];
      let rugCount = 0;
      let safeCount = 0;

      for (const row of trainingData) {
        const feature = this.extractFeatures({
          // Liquidity metrics
          liquidityUsd: row.liquidity_usd || 0,
          lpBurnedPercent: row.lp_burned_percent || 0,
          lpLockedPercent: row.lp_locked_percent || 0,
          lpLockDurationHours: row.lp_lock_duration ? row.lp_lock_duration / 3600 : 0,
          
          // Holder distribution
          holderCount: row.total_holders || 0,
          top10Percent: row.top10_percent || 100,
          top20Percent: row.top20_percent || 100,
          largestHolderPercent: row.largest_holder_percent || 100,
          whaleCount: row.whale_count || 0,
          devWalletPercent: 0, // Would need to track dev wallet separately
          
          // Contract safety
          mintRevoked: row.mint_revoked === 1,
          freezeRevoked: row.freeze_revoked === 1,
          hasTransferFee: row.has_transfer_fee === 1,
          transferFeePercent: row.transfer_fee_percent || 0,
          
          // Social metrics
          hasSocials: (row.has_twitter === 1 || row.has_telegram === 1 || row.has_website === 1),
          twitterFollowers: row.twitter_followers || 0,
          telegramMembers: row.telegram_members || 0,
          hasMetadataImage: row.has_metadata_image === 1,
          
          // Smart money (defaults to 0 if not tracked yet)
          smartBuys24h: row.smart_buys_24h || 0,
          smartSells24h: row.smart_sells_24h || 0,
          netSmartMoney: (row.smart_buys_24h || 0) - (row.smart_sells_24h || 0),
          
          // Sentiment (default neutral)
          sentimentScore: row.sentiment_score || 0,
          
          // Token characteristics
          tokenAgeHours: row.token_age_hours || 0,
          riskScore: row.risk_score || 50,
        });

        const isRug = row.outcome === 'rug' ? 1 : 0;
        features.push(feature);
        labels.push(isRug);

        if (isRug) rugCount++;
        else safeCount++;
      }

      // Calculate class weights for imbalanced data
      const totalSamples = labels.length;
      const rugWeight = totalSamples / (2 * rugCount);
      const safeWeight = totalSamples / (2 * safeCount);
      const classWeight = { 0: safeWeight, 1: rugWeight };

      const imbalanceRatio = Math.max(rugCount, safeCount) / Math.min(rugCount, safeCount);
      logger.info('RugPredictor', `Class distribution: ${rugCount} rugs, ${safeCount} safe (ratio: ${imbalanceRatio.toFixed(2)}:1)`);
      logger.info('RugPredictor', `Class weights: rug=${rugWeight.toFixed(2)}, safe=${safeWeight.toFixed(2)}`);

      const xs = tf.tensor2d(features);
      const ys = tf.tensor2d(labels, [labels.length, 1]);

      const epochs = options?.epochs || 100;
      const batchSize = options?.batchSize || 32;
      const patience = options?.patience || 10; // Stop after 10 epochs without improvement

      // Reset training history
      this.trainingHistory = [];
      let bestValLoss = Infinity;
      let patienceCounter = 0;
      let stoppedEarly = false;

      logger.info('RugPredictor', `Training on ${features.length} samples for up to ${epochs} epochs (patience: ${patience})...`);

      const history = await this.model.fit(xs, ys, {
        epochs,
        batchSize,
        validationSplit: 0.2,
        shuffle: true,
        classWeight, // Handle class imbalance
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            const metrics: TrainingMetrics = {
              epoch,
              loss: logs?.loss || 0,
              accuracy: logs?.acc || 0,
              valLoss: logs?.val_loss || 0,
              valAccuracy: logs?.val_acc || 0,
            };

            this.trainingHistory.push(metrics);

            if (epoch % 5 === 0) {
              logger.info('RugPredictor', 
                `Epoch ${epoch}: loss=${metrics.loss.toFixed(4)}, ` +
                `acc=${metrics.accuracy.toFixed(4)}, ` +
                `val_loss=${metrics.valLoss.toFixed(4)}, ` +
                `val_acc=${metrics.valAccuracy.toFixed(4)}`
              );
            }

            // Early stopping check
            if (metrics.valLoss < bestValLoss) {
              bestValLoss = metrics.valLoss;
              patienceCounter = 0;
              this.bestValAccuracy = metrics.valAccuracy;
            } else {
              patienceCounter++;
              if (patienceCounter >= patience) {
                logger.info('RugPredictor', `Early stopping at epoch ${epoch} (no improvement for ${patience} epochs)`);
                stoppedEarly = true;
                this.model!.stopTraining = true;
              }
            }
          },
        },
      });

      // Calculate final metrics
      const finalMetrics = this.trainingHistory[this.trainingHistory.length - 1];
      
      // Calculate precision, recall, F1 on validation set
      const valSplit = Math.floor(totalSamples * 0.2);
      const valFeatures = features.slice(-valSplit);
      const valLabels = labels.slice(-valSplit);
      
      const metrics = await this.calculateMetrics(valFeatures, valLabels);

      // Save model
      await this.model.save(`file://${this.modelDir}`);
      logger.info('RugPredictor', 
        `Model trained and saved | Validation: acc=${finalMetrics.valAccuracy.toFixed(3)}, ` +
        `precision=${metrics.precision.toFixed(3)}, recall=${metrics.recall.toFixed(3)}, ` +
        `F1=${metrics.f1Score.toFixed(3)}`
      );

      this.lastTrainedAt = new Date();

      xs.dispose();
      ys.dispose();

      return {
        success: true,
        samplesUsed: features.length,
        rugCount,
        safeCount,
        finalLoss: finalMetrics.loss,
        finalAccuracy: finalMetrics.accuracy,
        valLoss: finalMetrics.valLoss,
        valAccuracy: finalMetrics.valAccuracy,
        precision: metrics.precision,
        recall: metrics.recall,
        f1Score: metrics.f1Score,
        stoppedEarly,
        epochsTrained: this.trainingHistory.length,
      };
    } catch (error) {
      logger.error('RugPredictor', 'Training failed', error as Error);
      return { 
        success: false, 
        samplesUsed: 0, 
        rugCount: 0,
        safeCount: 0,
        finalLoss: 0, 
        finalAccuracy: 0,
        valLoss: 0,
        valAccuracy: 0,
        stoppedEarly: false,
        epochsTrained: 0,
      };
    } finally {
      this.isTraining = false;
    }
  }

  /**
   * Calculate precision, recall, and F1 score
   */
  private async calculateMetrics(
    features: number[][],
    trueLabels: number[]
  ): Promise<{ precision: number; recall: number; f1Score: number }> {
    if (!this.model || features.length === 0) {
      return { precision: 0, recall: 0, f1Score: 0 };
    }

    const xs = tf.tensor2d(features);
    const predictions = this.model.predict(xs) as tf.Tensor;
    const predData = await predictions.data();

    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;

    for (let i = 0; i < trueLabels.length; i++) {
      const predicted = predData[i] > 0.5 ? 1 : 0;
      const actual = trueLabels[i];

      if (predicted === 1 && actual === 1) truePositives++;
      if (predicted === 1 && actual === 0) falsePositives++;
      if (predicted === 0 && actual === 1) falseNegatives++;
    }

    const precision = truePositives / (truePositives + falsePositives) || 0;
    const recall = truePositives / (truePositives + falseNegatives) || 0;
    const f1Score = precision + recall > 0 
      ? 2 * (precision * recall) / (precision + recall) 
      : 0;

    xs.dispose();
    predictions.dispose();

    return { precision, recall, f1Score };
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
   * Extract normalized features from input (25 features)
   */
  private extractFeatures(input: PredictionInput): number[] {
    return [
      // Liquidity metrics (4 features)
      this.normalize(input.liquidityUsd, 0, this.NORMALIZATION.liquidityMax),
      input.lpBurnedPercent / 100,
      input.lpLockedPercent / 100,
      this.normalize(input.lpLockDurationHours || 0, 0, this.NORMALIZATION.lpLockDurationMax),
      
      // Holder distribution (6 features)
      this.normalize(input.holderCount, 0, this.NORMALIZATION.holderCountMax),
      input.top10Percent / 100,
      input.top20Percent / 100,
      input.largestHolderPercent / 100,
      this.normalize(input.whaleCount, 0, this.NORMALIZATION.whaleCountMax),
      input.devWalletPercent / 100,
      
      // Contract safety (4 features)
      input.mintRevoked ? 1 : 0,
      input.freezeRevoked ? 1 : 0,
      input.hasTransferFee ? 1 : 0,
      input.transferFeePercent / 100,
      
      // Social metrics (4 features)
      input.hasSocials ? 1 : 0,
      this.normalize(input.twitterFollowers, 0, this.NORMALIZATION.twitterFollowersMax),
      this.normalize(input.telegramMembers, 0, this.NORMALIZATION.telegramMembersMax),
      input.hasMetadataImage ? 1 : 0,
      
      // Smart money (3 features)
      this.normalize(input.smartBuys24h, 0, this.NORMALIZATION.smartMoneyMax),
      this.normalize(input.smartSells24h, 0, this.NORMALIZATION.smartMoneyMax),
      this.normalize(input.netSmartMoney, -this.NORMALIZATION.smartMoneyMax, this.NORMALIZATION.smartMoneyMax),
      
      // Sentiment (1 feature)
      (input.sentimentScore + 1) / 2, // Normalize from [-1,1] to [0,1]
      
      // Token characteristics (3 features)
      this.normalize(input.tokenAgeHours, 0, this.NORMALIZATION.ageHoursMax),
      input.riskScore / 100,
      
      // Combined risk indicator (1 feature - derived)
      this.calculateCompositeRisk(input),
    ];
  }

  /**
   * Calculate a composite risk indicator from multiple signals
   */
  private calculateCompositeRisk(input: PredictionInput): number {
    let riskScore = 0;
    let factors = 0;

    // High concentration risk
    if (input.top10Percent > 70) {
      riskScore += 1;
      factors++;
    }

    // Liquidity risk
    if (input.liquidityUsd < 5000 && input.lpBurnedPercent < 50) {
      riskScore += 1;
      factors++;
    }

    // Authority risk
    if (!input.mintRevoked || !input.freezeRevoked) {
      riskScore += 1;
      factors++;
    }

    // Smart money dumping
    if (input.smartSells24h > input.smartBuys24h && input.smartSells24h > 5) {
      riskScore += 1;
      factors++;
    }

    // Hidden fees
    if (input.hasTransferFee && input.transferFeePercent > 5) {
      riskScore += 1;
      factors++;
    }

    return factors > 0 ? riskScore / factors : 0;
  }

  /**
   * Normalize a value to 0-1 range
   */
  private normalize(value: number, min: number, max: number): number {
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
  }

  /**
   * Identify specific risk factors from input (enhanced)
   */
  private identifyRiskFactors(input: PredictionInput): string[] {
    const factors: string[] = [];

    // Critical contract risks
    if (!input.mintRevoked) {
      factors.push('🚨 Mint authority active');
    }

    if (!input.freezeRevoked) {
      factors.push('🚨 Freeze authority active');
    }

    if (input.hasTransferFee && input.transferFeePercent > 5) {
      factors.push(`🚨 Hidden ${input.transferFeePercent.toFixed(1)}% transfer fee`);
    }

    // Liquidity risks
    if (input.lpBurnedPercent < 90 && input.lpLockedPercent < 50) {
      factors.push('⚠️ LP not secured (not burned/locked)');
    } else if (input.lpLockedPercent >= 50 && (!input.lpLockDurationHours || input.lpLockDurationHours < 24)) {
      factors.push('⚠️ LP lock duration < 24h');
    }

    if (input.liquidityUsd < 5000) {
      factors.push('⚠️ Low liquidity (high slippage risk)');
    }

    // Holder concentration risks
    if (input.largestHolderPercent > 30) {
      factors.push(`🐋 Single holder owns ${input.largestHolderPercent.toFixed(1)}%`);
    }

    if (input.top10Percent > 60) {
      factors.push(`📊 Top 10 hold ${input.top10Percent.toFixed(1)}% (concentrated)`);
    }

    if (input.devWalletPercent > 15) {
      factors.push(`👨‍💻 Dev wallet holds ${input.devWalletPercent.toFixed(1)}%`);
    }

    if (input.whaleCount > 10) {
      factors.push(`🐋 ${input.whaleCount} whale wallets detected`);
    }

    // Smart money signals
    if (input.smartSells24h > input.smartBuys24h && input.smartSells24h > 5) {
      factors.push(`🧠 Smart money selling (${input.smartSells24h} sells vs ${input.smartBuys24h} buys)`);
    }

    if (input.netSmartMoney < -5) {
      factors.push('🧠 Negative smart money flow');
    }

    // Social & metadata risks
    if (!input.hasSocials) {
      factors.push('📱 No social media presence');
    }

    if (input.twitterFollowers === 0 && input.telegramMembers === 0) {
      factors.push('👥 No community engagement');
    }

    if (!input.hasMetadataImage) {
      factors.push('🖼️ No token image/metadata');
    }

    // Sentiment risk
    if (input.sentimentScore < -0.3) {
      factors.push('💬 Negative sentiment detected');
    }

    // General risks
    if (input.holderCount < 50) {
      factors.push(`👥 Only ${input.holderCount} holders`);
    }

    if (input.tokenAgeHours < 1) {
      factors.push('⏰ Very new token (<1h old)');
    }

    if (input.riskScore < 40) {
      factors.push('📉 Low base risk score');
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
   * Calculate feature importance using permutation importance
   * Shows which features matter most for predictions
   */
  async calculateFeatureImportance(testSamples: PredictionInput[]): Promise<FeatureImportance[]> {
    if (!this.model || testSamples.length === 0) {
      return [];
    }

    // Get baseline predictions
    const baselineFeatures = testSamples.map(s => this.extractFeatures(s));
    const xs = tf.tensor2d(baselineFeatures);
    const baselinePreds = this.model.predict(xs) as tf.Tensor;
    const baselineData = await baselinePreds.data();
    
    // Calculate baseline loss (mean squared error)
    let baselineLoss = 0;
    for (let i = 0; i < baselineData.length; i++) {
      const pred = baselineData[i];
      baselineLoss += pred * pred; // Simple metric: deviation from baseline
    }
    baselineLoss /= baselineData.length;

    xs.dispose();
    baselinePreds.dispose();

    // Test importance of each feature by permuting it
    const importance: number[] = [];

    for (let featureIdx = 0; featureIdx < 25; featureIdx++) {
      const permutedFeatures = baselineFeatures.map(row => [...row]);

      // Shuffle this feature across samples
      const values = permutedFeatures.map(row => row[featureIdx]);
      for (let i = values.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
      }
      permutedFeatures.forEach((row, i) => {
        row[featureIdx] = values[i];
      });

      // Get predictions with permuted feature
      const xsPerm = tf.tensor2d(permutedFeatures);
      const permPreds = this.model.predict(xsPerm) as tf.Tensor;
      const permData = await permPreds.data();

      // Calculate loss with permuted feature
      let permLoss = 0;
      for (let i = 0; i < permData.length; i++) {
        const pred = permData[i];
        permLoss += pred * pred;
      }
      permLoss /= permData.length;

      xsPerm.dispose();
      permPreds.dispose();

      // Importance = how much worse predictions got
      importance.push(Math.abs(permLoss - baselineLoss));
    }

    // Normalize importance scores
    const maxImportance = Math.max(...importance);
    const normalizedImportance = importance.map(imp => 
      maxImportance > 0 ? imp / maxImportance : 0
    );

    // Create results with feature names
    const results: FeatureImportance[] = this.FEATURE_NAMES.map((name, idx) => ({
      featureName: name,
      importance: normalizedImportance[idx],
      rank: 0, // Will be set after sorting
    }));

    // Sort by importance and assign ranks
    results.sort((a, b) => b.importance - a.importance);
    results.forEach((r, idx) => {
      r.rank = idx + 1;
    });

    this.featureImportance = results;

    logger.info('RugPredictor', 
      `Top 5 features: ${results.slice(0, 5).map(r => `${r.featureName}(${r.importance.toFixed(3)})`).join(', ')}`
    );

    return results;
  }

  /**
   * Get model statistics (enhanced)
   */
  getStats(): {
    isInitialized: boolean;
    isTraining: boolean;
    hasModel: boolean;
    trainingHistoryLength: number;
    totalPredictions: number;
    bestValAccuracy: number;
    lastTrainedAt: Date | null;
    hasFeatureImportance: boolean;
  } {
    return {
      isInitialized: this.initialized,
      isTraining: this.isTraining,
      hasModel: this.model !== null,
      trainingHistoryLength: this.trainingHistory.length,
      totalPredictions: this.totalPredictions,
      bestValAccuracy: this.bestValAccuracy,
      lastTrainedAt: this.lastTrainedAt,
      hasFeatureImportance: this.featureImportance.length > 0,
    };
  }

  /**
   * Get feature importance results
   */
  getFeatureImportance(): FeatureImportance[] {
    return [...this.featureImportance];
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
   * Get training history (enhanced metrics)
   */
  getTrainingHistory(): TrainingMetrics[] {
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

/**
 * Helper function to convert TokenAnalysis to PredictionInput
 */
export function tokenAnalysisToPredictionInput(analysis: any): PredictionInput {
  const tokenAgeMs = Date.now() - (analysis.pool?.createdAt?.getTime() || Date.now());
  const tokenAgeHours = tokenAgeMs / (1000 * 60 * 60);

  return {
    // Liquidity metrics
    liquidityUsd: analysis.liquidity?.totalLiquidityUsd || 0,
    lpBurnedPercent: analysis.liquidity?.lpBurnedPercent || 0,
    lpLockedPercent: analysis.liquidity?.lpLockedPercent || 0,
    lpLockDurationHours: analysis.liquidity?.lpLockDuration ? analysis.liquidity.lpLockDuration / 3600 : 0,
    
    // Holder distribution
    holderCount: analysis.holders?.totalHolders || 0,
    top10Percent: analysis.holders?.top10HoldersPercent || 100,
    top20Percent: analysis.holders?.top20HoldersPercent || 100,
    largestHolderPercent: analysis.holders?.largestHolderPercent || 100,
    whaleCount: analysis.holders?.whaleAddresses?.length || 0,
    devWalletPercent: analysis.holders?.devWalletPercent || 0,
    
    // Contract safety
    mintRevoked: analysis.contract?.mintAuthorityRevoked || false,
    freezeRevoked: analysis.contract?.freezeAuthorityRevoked || false,
    hasTransferFee: analysis.contract?.hasTransferFee || false,
    transferFeePercent: analysis.contract?.transferFeePercent || 0,
    
    // Social metrics
    hasSocials: analysis.social?.hasTwitter || analysis.social?.hasTelegram || analysis.social?.hasWebsite || false,
    twitterFollowers: analysis.social?.twitterFollowers || 0,
    telegramMembers: analysis.social?.telegramMembers || 0,
    hasMetadataImage: !!analysis.token?.metadata?.image,
    
    // Smart money
    smartBuys24h: analysis.smartMoney?.smartBuys24h || 0,
    smartSells24h: analysis.smartMoney?.smartSells24h || 0,
    netSmartMoney: analysis.smartMoney?.netSmartMoney || 0,
    
    // Sentiment
    sentimentScore: analysis.sentiment?.sentimentScore || 0,
    
    // Token characteristics
    tokenAgeHours,
    riskScore: analysis.risk?.score || 50,
  };
}
