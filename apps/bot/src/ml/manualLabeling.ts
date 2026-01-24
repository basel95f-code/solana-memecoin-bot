/**
 * Manual Labeling
 * Queue and process tokens for manual labeling via Telegram
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { database } from '../database';
import { ML_TRAINING } from '../constants';

// ============================================
// Types
// ============================================

export type OutcomeLabel = 'rug' | 'pump' | 'stable' | 'decline';

export interface PendingLabel {
  mint: string;
  symbol?: string;
  initialPrice: number;
  initialLiquidity: number;
  initialRiskScore: number;
  currentPrice?: number;
  priceChangePercent?: number;
  suggestedLabel?: OutcomeLabel;
  suggestConfidence?: number;
  status: 'pending' | 'labeled' | 'skipped';
  discoveredAt: number;
  lastUpdatedAt?: number;
}

export interface LabelingStats {
  pending: number;
  labeled: number;
  skipped: number;
  autoLabeled: number;
  manualLabeled: number;
}

// ============================================
// Manual Labeling Service
// ============================================

export class ManualLabelingService extends EventEmitter {
  private maxQueueSize: number;

  constructor(maxQueueSize: number = ML_TRAINING.MANUAL_LABEL_QUEUE_MAX) {
    super();
    this.maxQueueSize = maxQueueSize;
  }

  /**
   * Add a token to the labeling queue
   */
  addToQueue(data: {
    mint: string;
    symbol?: string;
    initialPrice: number;
    initialLiquidity: number;
    initialRiskScore: number;
    discoveredAt: number;
  }): boolean {
    // Check queue size
    const currentCount = database.getPendingLabelCount();
    if (currentCount >= this.maxQueueSize) {
      logger.debug('ManualLabeling', 'Queue is full, not adding new token');
      return false;
    }

    database.addPendingLabel(data);
    this.emit('tokenQueued', data);

    return true;
  }

  /**
   * Update price for a pending token and auto-suggest label
   */
  updatePrice(mint: string, currentPrice: number, initialPrice: number): void {
    const priceChangePercent = ((currentPrice - initialPrice) / initialPrice) * 100;
    database.updatePendingLabelPrice(mint, currentPrice, priceChangePercent);
  }

  /**
   * Label a token manually
   */
  labelToken(
    mint: string,
    label: OutcomeLabel,
    labeledBy: string,
    features: Record<string, number>
  ): boolean {
    try {
      // Save to ML training samples
      database.saveMLSample({
        mint,
        features,
        outcome: label,
        labelSource: 'manual',
        labeledBy,
        discoveredAt: Math.floor(Date.now() / 1000),
        labeledAt: Math.floor(Date.now() / 1000),
      });

      // Mark as labeled in pending queue
      database.markPendingLabelAsLabeled(mint);

      this.emit('tokenLabeled', { mint, label, labeledBy });
      logger.info('ManualLabeling', `Token ${mint} labeled as ${label} by ${labeledBy}`);

      return true;
    } catch (error) {
      logger.error('ManualLabeling', 'Failed to label token', error as Error);
      return false;
    }
  }

  /**
   * Auto-label a token based on price change
   */
  autoLabel(
    mint: string,
    priceChangePercent: number,
    features: Record<string, number>,
    symbol?: string
  ): OutcomeLabel | null {
    let label: OutcomeLabel | null = null;
    let confidence = 0;

    // Determine label based on price change
    if (priceChangePercent <= ML_TRAINING.AUTO_LABEL_RUG_THRESHOLD) {
      label = 'rug';
      confidence = 0.9;
    } else if (priceChangePercent >= ML_TRAINING.AUTO_LABEL_PUMP_THRESHOLD) {
      label = 'pump';
      confidence = 0.8;
    } else if (priceChangePercent <= -50) {
      label = 'decline';
      confidence = 0.7;
    } else if (priceChangePercent >= -20 && priceChangePercent <= 50) {
      label = 'stable';
      confidence = 0.6;
    }

    if (label) {
      // Save to ML training samples
      database.saveMLSample({
        mint,
        symbol,
        features,
        outcome: label,
        outcomeConfidence: confidence,
        labelSource: 'auto',
        discoveredAt: Math.floor(Date.now() / 1000),
        labeledAt: Math.floor(Date.now() / 1000),
      });

      // Mark as labeled
      database.markPendingLabelAsLabeled(mint);

      this.emit('tokenAutoLabeled', { mint, label, confidence, priceChangePercent });
      logger.debug('ManualLabeling', `Auto-labeled ${symbol || mint} as ${label} (${priceChangePercent.toFixed(1)}%)`);
    }

    return label;
  }

  /**
   * Get pending tokens for labeling
   */
  getPendingTokens(limit: number = 50): PendingLabel[] {
    return database.getPendingLabels(limit);
  }

  /**
   * Get tokens with suggested labels
   */
  getTokensWithSuggestions(limit: number = 20): PendingLabel[] {
    const pending = database.getPendingLabels(limit * 2);
    return pending
      .filter(p => p.suggested_label !== null)
      .slice(0, limit)
      .map(p => ({
        mint: p.mint,
        symbol: p.symbol,
        initialPrice: p.initial_price,
        initialLiquidity: p.initial_liquidity,
        initialRiskScore: p.initial_risk_score,
        currentPrice: p.current_price,
        priceChangePercent: p.price_change_percent,
        suggestedLabel: p.suggested_label as OutcomeLabel,
        suggestConfidence: p.suggest_confidence,
        status: p.status,
        discoveredAt: p.discovered_at,
        lastUpdatedAt: p.last_updated_at,
      }));
  }

  /**
   * Accept suggested label
   */
  acceptSuggestion(mint: string, labeledBy: string, features: Record<string, number>): boolean {
    const pending = database.getPendingLabels(100);
    const token = pending.find(p => p.mint === mint);

    if (!token || !token.suggested_label) {
      logger.warn('ManualLabeling', `No suggestion found for ${mint}`);
      return false;
    }

    return this.labelToken(mint, token.suggested_label as OutcomeLabel, labeledBy, features);
  }

  /**
   * Skip a token (don't use for training)
   */
  skipToken(mint: string): void {
    try {
      // Update status in database (we'd need a method for this)
      // For now, just mark as labeled to remove from queue
      database.markPendingLabelAsLabeled(mint);
      this.emit('tokenSkipped', { mint });
    } catch (error) {
      logger.error('ManualLabeling', 'Failed to skip token', error as Error);
    }
  }

  /**
   * Get labeling statistics
   */
  getStats(): LabelingStats {
    const sampleCounts = database.getMLSampleCount();

    return {
      pending: database.getPendingLabelCount(),
      labeled: sampleCounts.labeled,
      skipped: 0, // Would need to track separately
      autoLabeled: sampleCounts.byOutcome['auto'] || 0,
      manualLabeled: sampleCounts.byOutcome['manual'] || 0,
    };
  }

  /**
   * Suggest labels for all pending tokens based on their price changes
   */
  async updateAllSuggestions(): Promise<number> {
    const pending = database.getPendingLabels(this.maxQueueSize);
    let updated = 0;

    for (const token of pending) {
      if (token.current_price && token.initial_price) {
        const priceChange = ((token.current_price - token.initial_price) / token.initial_price) * 100;
        database.updatePendingLabelPrice(token.mint, token.current_price, priceChange);
        updated++;
      }
    }

    return updated;
  }

  /**
   * Batch auto-label tokens with high-confidence suggestions
   */
  async batchAutoLabel(minConfidence: number = 0.8): Promise<number> {
    const tokensWithSuggestions = this.getTokensWithSuggestions(100);
    let labeled = 0;

    for (const token of tokensWithSuggestions) {
      if (token.suggestConfidence && token.suggestConfidence >= minConfidence && token.suggestedLabel) {
        // Would need features for the token - for now skip actual labeling
        // This is a placeholder for batch auto-labeling logic
        logger.debug('ManualLabeling', `Would auto-label ${token.symbol || token.mint} as ${token.suggestedLabel}`);
        labeled++;
      }
    }

    return labeled;
  }
}

// Export singleton
export const manualLabelingService = new ManualLabelingService();
