/**
 * Outcome Tracker
 * Tracks ACTUAL outcomes after predictions to measure accuracy
 * 
 * - Checks price movements at 1h/6h/24h intervals
 * - Tracks whale actions after predictions
 * - Correlates sentiment with price movements
 * - Auto-updates ml_predictions table with outcomes
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { database } from '../../database';
import { dexScreenerService } from '../../services/dexScreener';
import { gmgnClient } from '../../services/gmgn';
import { LabelGenerator, labelGenerator } from './LabelGenerator';
import type { 
  OutcomeTracking, 
  OutcomeCheckpoint, 
  OutcomeLabel, 
  PriceLabel, 
  WhaleLabel, 
  SentimentLabel 
} from '../dataCollection/types';

// ============================================
// Configuration
// ============================================

const CONFIG = {
  // Check intervals (in ms)
  CHECK_1H: 60 * 60 * 1000,
  CHECK_6H: 6 * 60 * 60 * 1000,
  CHECK_24H: 24 * 60 * 60 * 1000,
  
  // Tolerance for checkpoint timing (±10%)
  CHECKPOINT_TOLERANCE: 0.1,
  
  // Max tracking duration
  MAX_TRACKING_DURATION_MS: 48 * 60 * 60 * 1000, // 48 hours
  
  // Batch size for processing
  BATCH_SIZE: 50,
  
  // Rate limiting
  API_DELAY_MS: 200,
  
  // Outcome determination
  MIN_PRICE_DATA_POINTS: 3,
  FINAL_OUTCOME_AFTER_MS: 24 * 60 * 60 * 1000, // Determine final outcome after 24h
};

// ============================================
// Outcome Tracker
// ============================================

export class OutcomeTracker extends EventEmitter {
  private trackedTokens: Map<string, OutcomeTracking> = new Map();
  private processingQueue: string[] = [];
  private isProcessing: boolean = false;
  
  // Stats
  private stats = {
    tokensTracked: 0,
    outcomesRecorded: 0,
    checkpointsRecorded: 0,
    predictionsCorrect: 0,
    predictionsTested: 0,
    lastProcessAt: 0,
  };

  /**
   * Initialize the outcome tracker
   */
  async initialize(): Promise<void> {
    // Load pending outcomes from database
    await this.loadPendingOutcomes();
    
    logger.info('OutcomeTracker', `Initialized with ${this.trackedTokens.size} pending outcomes`);
  }

  /**
   * Load pending outcomes from database
   */
  private async loadPendingOutcomes(): Promise<void> {
    try {
      const pending = database.getPendingOutcomes();
      
      for (const record of pending) {
        this.trackedTokens.set(record.mint, {
          mint: record.mint,
          symbol: record.symbol,
          initialPrice: record.initialPrice,
          initialLiquidity: record.initialLiquidity,
          initialRiskScore: record.initialRiskScore,
          initialHolders: record.initialHolders,
          initialTop10Percent: record.initialTop10Percent,
          discoveredAt: record.discoveredAt * 1000,
          checkpoints: [],
          peakPrice: record.peakPrice || record.initialPrice,
          peakAt: record.peakAt ? record.peakAt * 1000 : undefined,
          troughPrice: record.initialPrice,
        });
      }
    } catch (error) {
      logger.silentError('OutcomeTracker', 'Failed to load pending outcomes', error as Error);
    }
  }

  /**
   * Start tracking a token's outcome
   */
  startTracking(data: {
    mint: string;
    symbol: string;
    initialPrice: number;
    initialLiquidity: number;
    initialRiskScore: number;
    initialHolders: number;
    initialTop10Percent?: number;
    initialSentiment?: number;
    predictedOutcome?: OutcomeLabel;
    predictedConfidence?: number;
    predictedRugProb?: number;
    predictionModelVersion?: string;
  }): void {
    const now = Date.now();
    
    const tracking: OutcomeTracking = {
      mint: data.mint,
      symbol: data.symbol,
      initialPrice: data.initialPrice,
      initialLiquidity: data.initialLiquidity,
      initialRiskScore: data.initialRiskScore,
      initialHolders: data.initialHolders,
      initialTop10Percent: data.initialTop10Percent,
      initialSentiment: data.initialSentiment,
      discoveredAt: now,
      predictedOutcome: data.predictedOutcome,
      predictedConfidence: data.predictedConfidence,
      predictedRugProb: data.predictedRugProb,
      predictionModelVersion: data.predictionModelVersion,
      checkpoints: [],
      peakPrice: data.initialPrice,
      troughPrice: data.initialPrice,
    };
    
    this.trackedTokens.set(data.mint, tracking);
    
    // Save initial state to database
    database.saveTokenOutcomeInitial({
      mint: data.mint,
      symbol: data.symbol,
      initialPrice: data.initialPrice,
      initialLiquidity: data.initialLiquidity,
      initialRiskScore: data.initialRiskScore,
      initialHolders: data.initialHolders,
      initialTop10Percent: data.initialTop10Percent,
      discoveredAt: Math.floor(now / 1000),
    });
    
    this.stats.tokensTracked++;
    this.emit('trackingStarted', { mint: data.mint, symbol: data.symbol });
  }

  /**
   * Process all tracked tokens - check for outcomes
   */
  async processOutcomes(): Promise<{
    processed: number;
    checkpointsAdded: number;
    outcomesRecorded: number;
  }> {
    if (this.isProcessing) {
      return { processed: 0, checkpointsAdded: 0, outcomesRecorded: 0 };
    }
    
    this.isProcessing = true;
    const startTime = Date.now();
    let processed = 0;
    let checkpointsAdded = 0;
    let outcomesRecorded = 0;
    
    try {
      const now = Date.now();
      const tokensToProcess = [...this.trackedTokens.entries()];
      
      logger.debug('OutcomeTracker', `Processing ${tokensToProcess.length} tracked tokens`);
      
      for (let i = 0; i < tokensToProcess.length; i += CONFIG.BATCH_SIZE) {
        const batch = tokensToProcess.slice(i, i + CONFIG.BATCH_SIZE);
        
        await Promise.all(batch.map(async ([mint, tracking]) => {
          try {
            const result = await this.processToken(mint, tracking, now);
            processed++;
            checkpointsAdded += result.checkpointAdded ? 1 : 0;
            outcomesRecorded += result.outcomeRecorded ? 1 : 0;
          } catch (error) {
            logger.silentError('OutcomeTracker', `Failed to process ${tracking.symbol}`, error as Error);
          }
          
          await this.sleep(CONFIG.API_DELAY_MS);
        }));
      }
      
      this.stats.checkpointsRecorded += checkpointsAdded;
      this.stats.outcomesRecorded += outcomesRecorded;
      this.stats.lastProcessAt = now;
      
      const duration = Date.now() - startTime;
      logger.info('OutcomeTracker', 
        `Processed ${processed} tokens: ${checkpointsAdded} checkpoints, ${outcomesRecorded} outcomes in ${duration}ms`
      );
      
      return { processed, checkpointsAdded, outcomesRecorded };
      
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single token
   */
  private async processToken(
    mint: string, 
    tracking: OutcomeTracking, 
    now: number
  ): Promise<{ checkpointAdded: boolean; outcomeRecorded: boolean }> {
    const result = { checkpointAdded: false, outcomeRecorded: false };
    const elapsedMs = now - tracking.discoveredAt;
    
    // Check if expired (>48h)
    if (elapsedMs > CONFIG.MAX_TRACKING_DURATION_MS) {
      // Record final outcome and stop tracking
      await this.recordFinalOutcome(mint, tracking, now);
      result.outcomeRecorded = true;
      return result;
    }
    
    // Fetch current price
    const currentData = await this.fetchCurrentData(mint);
    if (!currentData || !currentData.priceUsd) {
      return result;
    }
    
    // Update peak/trough
    if (currentData.priceUsd > tracking.peakPrice) {
      tracking.peakPrice = currentData.priceUsd;
      tracking.peakAt = now;
    }
    if (currentData.priceUsd < tracking.troughPrice) {
      tracking.troughPrice = currentData.priceUsd;
      tracking.troughAt = now;
    }
    
    // Check for checkpoints
    const checkpointType = this.getCheckpointType(elapsedMs, tracking.checkpoints);
    
    if (checkpointType) {
      const checkpoint: OutcomeCheckpoint = {
        timestamp: now,
        priceUsd: currentData.priceUsd,
        liquidityUsd: currentData.liquidityUsd,
        holderCount: currentData.holderCount,
        volume1h: currentData.volume1h,
        checkpointType,
      };
      
      tracking.checkpoints.push(checkpoint);
      result.checkpointAdded = true;
      
      // Update price changes
      this.updatePriceChanges(tracking, checkpoint, checkpointType);
      
      // Check for whale activity
      await this.checkWhaleActivity(mint, tracking, currentData);
      
      // After 24h, determine final outcome
      if (checkpointType === '24h') {
        await this.recordFinalOutcome(mint, tracking, now);
        result.outcomeRecorded = true;
      }
    }
    
    return result;
  }

  /**
   * Determine what checkpoint type is due
   */
  private getCheckpointType(
    elapsedMs: number, 
    existingCheckpoints: OutcomeCheckpoint[]
  ): '1h' | '6h' | '24h' | null {
    const has1h = existingCheckpoints.some(c => c.checkpointType === '1h');
    const has6h = existingCheckpoints.some(c => c.checkpointType === '6h');
    const has24h = existingCheckpoints.some(c => c.checkpointType === '24h');
    
    const tolerance = CONFIG.CHECKPOINT_TOLERANCE;
    
    // Check for 1h checkpoint
    if (!has1h && elapsedMs >= CONFIG.CHECK_1H * (1 - tolerance)) {
      return '1h';
    }
    
    // Check for 6h checkpoint
    if (!has6h && elapsedMs >= CONFIG.CHECK_6H * (1 - tolerance)) {
      return '6h';
    }
    
    // Check for 24h checkpoint
    if (!has24h && elapsedMs >= CONFIG.CHECK_24H * (1 - tolerance)) {
      return '24h';
    }
    
    return null;
  }

  /**
   * Update price changes in tracking
   */
  private updatePriceChanges(
    tracking: OutcomeTracking, 
    checkpoint: OutcomeCheckpoint, 
    type: '1h' | '6h' | '24h'
  ): void {
    const priceChange = ((checkpoint.priceUsd - tracking.initialPrice) / tracking.initialPrice) * 100;
    
    switch (type) {
      case '1h':
        tracking.priceChange1h = priceChange;
        break;
      case '6h':
        tracking.priceChange6h = priceChange;
        break;
      case '24h':
        tracking.priceChange24h = priceChange;
        tracking.finalPrice = checkpoint.priceUsd;
        tracking.finalLiquidity = checkpoint.liquidityUsd;
        tracking.finalHolders = checkpoint.holderCount;
        break;
    }
  }

  /**
   * Check for whale activity
   */
  private async checkWhaleActivity(
    mint: string, 
    tracking: OutcomeTracking,
    currentData: any
  ): Promise<void> {
    try {
      // Get whale data from GMGN
      const whaleData = await gmgnClient.getWhaleActivity(mint);
      
      if (whaleData) {
        // Check for large sells (>5% of supply)
        if (whaleData.largeSells && whaleData.largeSells.length > 0) {
          tracking.largeSellDetected = true;
          tracking.whaleActionAt = Date.now();
          tracking.whaleLabel = 'DUMP';
        }
        
        // Check for large buys
        if (whaleData.largeBuys && whaleData.largeBuys.length > 0) {
          if (!tracking.largeSellDetected) {
            tracking.largeBuyDetected = true;
            tracking.whaleLabel = 'ACCUMULATION';
          }
        }
      }
    } catch (error) {
      // Whale data is optional, continue without it
    }
  }

  /**
   * Record final outcome and cleanup
   */
  private async recordFinalOutcome(
    mint: string, 
    tracking: OutcomeTracking, 
    now: number
  ): Promise<void> {
    // Generate labels
    const priceLabel = labelGenerator.generatePriceLabel(tracking.priceChange24h || 0);
    const outcomeLabel = labelGenerator.generateOutcomeLabel({
      priceChange24h: tracking.priceChange24h || 0,
      peakMultiplier: tracking.peakPrice / tracking.initialPrice,
      troughMultiplier: tracking.troughPrice / tracking.initialPrice,
      liquidityChange: tracking.finalLiquidity && tracking.initialLiquidity 
        ? ((tracking.finalLiquidity - tracking.initialLiquidity) / tracking.initialLiquidity) * 100
        : 0,
    });
    
    const whaleLabel = tracking.whaleLabel || 'NONE';
    
    // Calculate outcome confidence
    const outcomeConfidence = this.calculateOutcomeConfidence(tracking);
    
    tracking.actualOutcome = outcomeLabel;
    tracking.actualOutcomeConfidence = outcomeConfidence;
    tracking.outcomeRecordedAt = now;
    
    // Save to database
    database.saveTokenOutcomeFinal({
      mint,
      symbol: tracking.symbol,
      outcome: outcomeLabel,
      outcomeConfidence,
      peakPrice: tracking.peakPrice,
      peakLiquidity: tracking.finalLiquidity,
      finalPrice: tracking.finalPrice || tracking.peakPrice,
      finalLiquidity: tracking.finalLiquidity,
      finalHolders: tracking.finalHolders,
      peakMultiplier: tracking.peakPrice / tracking.initialPrice,
      timeToPeak: tracking.peakAt ? Math.floor((tracking.peakAt - tracking.discoveredAt) / 1000) : undefined,
      timeToOutcome: Math.floor((now - tracking.discoveredAt) / 1000),
      peakAt: tracking.peakAt ? Math.floor(tracking.peakAt / 1000) : undefined,
      outcomeRecordedAt: Math.floor(now / 1000),
    });
    
    // Check prediction accuracy
    if (tracking.predictedOutcome) {
      this.checkPredictionAccuracy(tracking, outcomeLabel);
    }
    
    // Generate training label
    await this.saveTrainingLabel(mint, tracking, outcomeLabel, priceLabel, whaleLabel);
    
    // Remove from tracking
    this.trackedTokens.delete(mint);
    
    this.emit('outcomeRecorded', {
      mint,
      symbol: tracking.symbol,
      outcome: outcomeLabel,
      priceChange24h: tracking.priceChange24h,
      peakMultiplier: tracking.peakPrice / tracking.initialPrice,
    });
  }

  /**
   * Calculate outcome confidence
   */
  private calculateOutcomeConfidence(tracking: OutcomeTracking): number {
    let confidence = 0.5;
    
    // More checkpoints = higher confidence
    const checkpointCount = tracking.checkpoints.length;
    confidence += Math.min(0.2, checkpointCount * 0.05);
    
    // Larger price moves = higher confidence
    const priceChange = Math.abs(tracking.priceChange24h || 0);
    if (priceChange > 50) confidence += 0.2;
    else if (priceChange > 20) confidence += 0.1;
    
    // Whale activity provides additional signal
    if (tracking.whaleLabel && tracking.whaleLabel !== 'NONE') {
      confidence += 0.1;
    }
    
    return Math.min(1, confidence);
  }

  /**
   * Check prediction accuracy and update stats
   */
  private checkPredictionAccuracy(
    tracking: OutcomeTracking, 
    actualOutcome: OutcomeLabel
  ): void {
    this.stats.predictionsTested++;
    
    // Map outcomes for comparison
    const rugOutcomes: OutcomeLabel[] = ['rug', 'decline'];
    const successOutcomes: OutcomeLabel[] = ['pump', 'moon'];
    
    const predictedIsRug = tracking.predictedOutcome && rugOutcomes.includes(tracking.predictedOutcome);
    const actualIsRug = rugOutcomes.includes(actualOutcome);
    
    const predictedIsSuccess = tracking.predictedOutcome && successOutcomes.includes(tracking.predictedOutcome);
    const actualIsSuccess = successOutcomes.includes(actualOutcome);
    
    const isCorrect = (predictedIsRug && actualIsRug) || 
                      (predictedIsSuccess && actualIsSuccess) ||
                      (tracking.predictedOutcome === actualOutcome);
    
    if (isCorrect) {
      this.stats.predictionsCorrect++;
    }
    
    // Update prediction in database
    this.updatePredictionAccuracy(tracking.mint, actualOutcome, isCorrect);
  }

  /**
   * Update prediction accuracy in database
   */
  private updatePredictionAccuracy(
    mint: string, 
    actualOutcome: OutcomeLabel, 
    wasCorrect: boolean
  ): void {
    try {
      const db = database.getDb();
      if (!db) return;
      
      db.run(`
        UPDATE prediction_performance
        SET actual_outcome = ?,
            was_correct = ?,
            outcome_recorded_at = ?
        WHERE token_mint = ? AND actual_outcome IS NULL
      `, [
        actualOutcome,
        wasCorrect ? 1 : 0,
        Math.floor(Date.now() / 1000),
        mint,
      ]);
    } catch (error) {
      // Non-critical, continue
    }
  }

  /**
   * Save training label to database
   */
  private async saveTrainingLabel(
    mint: string,
    tracking: OutcomeTracking,
    outcomeLabel: OutcomeLabel,
    priceLabel: PriceLabel,
    whaleLabel: WhaleLabel
  ): Promise<void> {
    try {
      const db = database.getDb();
      if (!db) return;
      
      // Update ml_training_data with outcome
      db.run(`
        UPDATE ml_training_data
        SET outcome = ?,
            price_change_1h = ?,
            price_change_6h = ?,
            price_change_24h = ?,
            whale_action = ?,
            has_outcome = 1
        WHERE mint = ?
      `, [
        outcomeLabel,
        tracking.priceChange1h,
        tracking.priceChange6h,
        tracking.priceChange24h,
        whaleLabel,
        mint,
      ]);
      
    } catch (error) {
      logger.silentError('OutcomeTracker', 'Failed to save training label', error as Error);
    }
  }

  /**
   * Fetch current token data
   */
  private async fetchCurrentData(mint: string): Promise<any> {
    try {
      // Try GMGN first
      const gmgnData = await gmgnClient.getTokenInfo(mint);
      if (gmgnData?.price) {
        return {
          priceUsd: gmgnData.price,
          liquidityUsd: gmgnData.liquidity,
          holderCount: gmgnData.holderCount || gmgnData.holders,
          volume1h: gmgnData.volume1h || gmgnData.v1h,
        };
      }
      
      // Fall back to DEXScreener
      const dexData = await dexScreenerService.getPair(mint);
      if (dexData?.priceUsd) {
        return {
          priceUsd: parseFloat(dexData.priceUsd),
          liquidityUsd: dexData.liquidity?.usd,
          holderCount: null,
          volume1h: dexData.volume?.h1,
        };
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get prediction accuracy stats
   */
  getAccuracyStats(): {
    totalTested: number;
    correct: number;
    accuracy: number;
  } {
    return {
      totalTested: this.stats.predictionsTested,
      correct: this.stats.predictionsCorrect,
      accuracy: this.stats.predictionsTested > 0 
        ? this.stats.predictionsCorrect / this.stats.predictionsTested 
        : 0,
    };
  }

  /**
   * Get overall stats
   */
  getStats(): typeof this.stats & {
    pendingOutcomes: number;
    accuracyPercent: number;
  } {
    return {
      ...this.stats,
      pendingOutcomes: this.trackedTokens.size,
      accuracyPercent: this.stats.predictionsTested > 0 
        ? (this.stats.predictionsCorrect / this.stats.predictionsTested) * 100 
        : 0,
    };
  }

  /**
   * Get tracking state for a token
   */
  getTracking(mint: string): OutcomeTracking | undefined {
    return this.trackedTokens.get(mint);
  }

  /**
   * Get all pending trackings
   */
  getPendingTrackings(): OutcomeTracking[] {
    return [...this.trackedTokens.values()];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton
export const outcomeTracker = new OutcomeTracker();
