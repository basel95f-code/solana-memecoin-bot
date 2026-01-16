/**
 * Outcome Tracker Service
 * Monitors tokens after discovery to track their outcomes for backtesting
 */

import { EventEmitter } from 'events';
import { dexScreenerService } from './dexscreener';
import { database } from '../database';
import { logger } from '../utils/logger';

// Configuration
const MONITORING_INTERVAL_MS = 30 * 60 * 1000; // Poll every 30 minutes
const MONITORING_DURATION_MS = 48 * 60 * 60 * 1000; // Monitor for 48 hours
const MAX_TRACKED_TOKENS = 500; // Max tokens to track simultaneously
const BATCH_SIZE = 30; // DexScreener batch size
const OUTCOME_CHECK_DELAY_MS = 24 * 60 * 60 * 1000; // Wait 24h before classifying

// Outcome thresholds
const RUG_LIQUIDITY_DROP = 0.2; // Liquidity dropped to <20% of initial
const RUG_PRICE_DROP = 0.1; // Price dropped to <10% of initial
const PUMP_THRESHOLD = 2.0; // Peak price >= 2x initial
const STABLE_RANGE = 0.3; // Price within ±30% of initial

export interface TrackedToken {
  mint: string;
  symbol: string;
  initialPrice: number;
  initialLiquidity: number;
  initialRiskScore: number;
  initialHolders: number;
  initialTop10Percent?: number;
  peakPrice: number;
  peakLiquidity: number;
  peakHolders: number;
  peakAt?: number;
  currentPrice: number;
  currentLiquidity: number;
  currentHolders: number;
  discoveredAt: number;
  lastUpdatedAt: number;
  updateCount: number;
}

export type OutcomeType = 'rug' | 'pump' | 'stable' | 'slow_decline' | 'unknown';

export interface TokenOutcome {
  mint: string;
  symbol: string;
  outcome: OutcomeType;
  outcomeConfidence: number;
  initialPrice: number;
  initialLiquidity: number;
  initialRiskScore: number;
  initialHolders: number;
  initialTop10Percent?: number;
  peakPrice: number;
  peakLiquidity?: number;
  peakHolders?: number;
  finalPrice: number;
  finalLiquidity?: number;
  finalHolders?: number;
  peakMultiplier: number;
  timeToPeak?: number;
  timeToOutcome: number;
  discoveredAt: number;
  peakAt?: number;
  outcomeRecordedAt: number;
}

class OutcomeTracker extends EventEmitter {
  private trackedTokens: Map<string, TrackedToken> = new Map();
  private isRunning: boolean = false;
  private monitorInterval: NodeJS.Timeout | null = null;
  private initialized: boolean = false;

  /**
   * Initialize the outcome tracker
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load any pending tracked tokens from database
    this.loadPendingTokens();

    this.initialized = true;
    logger.info('OutcomeTracker', 'Initialized');
  }

  /**
   * Start the monitoring loop
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('OutcomeTracker', 'Already running');
      return;
    }

    this.isRunning = true;
    logger.info('OutcomeTracker', `Started monitoring (${this.trackedTokens.size} tokens tracked)`);

    // Run immediately, then on interval
    this.updateAllTokens();
    this.monitorInterval = setInterval(() => {
      this.updateAllTokens();
    }, MONITORING_INTERVAL_MS);
  }

  /**
   * Stop the monitoring loop
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    logger.info('OutcomeTracker', 'Stopped monitoring');
  }

  /**
   * Track a newly discovered token
   */
  trackToken(
    mint: string,
    symbol: string,
    initialPrice: number,
    initialLiquidity: number,
    initialRiskScore: number,
    initialHolders: number,
    initialTop10Percent?: number
  ): boolean {
    // Check if already tracking
    if (this.trackedTokens.has(mint)) {
      logger.debug('OutcomeTracker', `Already tracking ${symbol}`);
      return false;
    }

    // Check capacity
    if (this.trackedTokens.size >= MAX_TRACKED_TOKENS) {
      // Remove oldest completed token
      this.cleanupOldTokens();
      if (this.trackedTokens.size >= MAX_TRACKED_TOKENS) {
        logger.warn('OutcomeTracker', `Max capacity (${MAX_TRACKED_TOKENS}) reached`);
        return false;
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const token: TrackedToken = {
      mint,
      symbol,
      initialPrice,
      initialLiquidity,
      initialRiskScore,
      initialHolders,
      initialTop10Percent,
      peakPrice: initialPrice,
      peakLiquidity: initialLiquidity,
      peakHolders: initialHolders,
      currentPrice: initialPrice,
      currentLiquidity: initialLiquidity,
      currentHolders: initialHolders,
      discoveredAt: now,
      lastUpdatedAt: now,
      updateCount: 0,
    };

    this.trackedTokens.set(mint, token);
    logger.info('OutcomeTracker', `Now tracking ${symbol} (${this.trackedTokens.size} total)`);

    // Save initial state to database
    this.saveInitialState(token);

    return true;
  }

  /**
   * Get tracking status
   */
  getStats(): {
    isRunning: boolean;
    trackedTokens: number;
    pendingOutcomes: number;
  } {
    const now = Math.floor(Date.now() / 1000);
    const pendingOutcomes = Array.from(this.trackedTokens.values()).filter(
      t => (now - t.discoveredAt) * 1000 >= OUTCOME_CHECK_DELAY_MS
    ).length;

    return {
      isRunning: this.isRunning,
      trackedTokens: this.trackedTokens.size,
      pendingOutcomes,
    };
  }

  /**
   * Get list of tracked tokens
   */
  getTrackedTokens(): TrackedToken[] {
    return Array.from(this.trackedTokens.values());
  }

  /**
   * Update all tracked tokens
   */
  private async updateAllTokens(): Promise<void> {
    if (this.trackedTokens.size === 0) {
      logger.debug('OutcomeTracker', 'No tokens to update');
      return;
    }

    const mints = Array.from(this.trackedTokens.keys());
    logger.debug('OutcomeTracker', `Updating ${mints.length} tokens`);

    // Process in batches
    for (let i = 0; i < mints.length; i += BATCH_SIZE) {
      const batch = mints.slice(i, i + BATCH_SIZE);
      await this.updateBatch(batch);
    }

    // Check for tokens ready for outcome classification
    this.checkOutcomes();
  }

  /**
   * Update a batch of tokens
   */
  private async updateBatch(mints: string[]): Promise<void> {
    try {
      const pairDataMap = await dexScreenerService.getMultipleTokensData(mints);
      const now = Math.floor(Date.now() / 1000);

      for (const mint of mints) {
        const token = this.trackedTokens.get(mint);
        if (!token) continue;

        const pairData = pairDataMap.get(mint);
        if (!pairData) {
          // Token might have been rugged or delisted
          token.currentPrice = 0;
          token.currentLiquidity = 0;
          token.lastUpdatedAt = now;
          token.updateCount++;
          continue;
        }

        const price = parseFloat(pairData.priceUsd || '0');
        const liquidity = pairData.liquidity?.usd || 0;
        const holders = token.currentHolders; // DexScreener doesn't provide this

        // Update current values
        token.currentPrice = price;
        token.currentLiquidity = liquidity;
        token.currentHolders = holders;
        token.lastUpdatedAt = now;
        token.updateCount++;

        // Update peak values
        if (price > token.peakPrice) {
          token.peakPrice = price;
          token.peakAt = now;
        }
        if (liquidity > token.peakLiquidity) {
          token.peakLiquidity = liquidity;
        }
      }

      logger.debug('OutcomeTracker', `Updated batch of ${mints.length} tokens`);
    } catch (error) {
      logger.error('OutcomeTracker', 'Batch update failed', error as Error);
    }
  }

  /**
   * Check tokens for outcome classification
   */
  private checkOutcomes(): void {
    const now = Math.floor(Date.now() / 1000);
    const tokensToClassify: TrackedToken[] = [];

    for (const [mint, token] of this.trackedTokens) {
      const ageMs = (now - token.discoveredAt) * 1000;

      // Check if monitoring period complete
      if (ageMs >= MONITORING_DURATION_MS) {
        tokensToClassify.push(token);
      }
      // Or if clearly rugged (can classify early)
      else if (this.isRupped(token)) {
        tokensToClassify.push(token);
      }
    }

    // Classify and remove from tracking
    for (const token of tokensToClassify) {
      const outcome = this.classifyOutcome(token);
      this.saveOutcome(outcome);
      this.trackedTokens.delete(token.mint);
      logger.info('OutcomeTracker', `Classified ${token.symbol}: ${outcome.outcome} (${(outcome.peakMultiplier).toFixed(2)}x peak)`);
      this.emit('outcome', outcome);
    }
  }

  /**
   * Check if token is clearly rugged
   */
  private isRupped(token: TrackedToken): boolean {
    if (token.initialLiquidity === 0) return false;

    const liquidityRatio = token.currentLiquidity / token.initialLiquidity;
    const priceRatio = token.initialPrice > 0 ? token.currentPrice / token.initialPrice : 0;

    return liquidityRatio < RUG_LIQUIDITY_DROP || priceRatio < RUG_PRICE_DROP;
  }

  /**
   * Classify token outcome
   */
  private classifyOutcome(token: TrackedToken): TokenOutcome {
    const now = Math.floor(Date.now() / 1000);
    const peakMultiplier = token.initialPrice > 0 ? token.peakPrice / token.initialPrice : 1;
    const finalMultiplier = token.initialPrice > 0 ? token.currentPrice / token.initialPrice : 1;
    const liquidityRatio = token.initialLiquidity > 0
      ? token.currentLiquidity / token.initialLiquidity
      : 1;

    let outcome: OutcomeType;
    let confidence: number;

    // Check for rug
    if (liquidityRatio < RUG_LIQUIDITY_DROP || finalMultiplier < RUG_PRICE_DROP) {
      outcome = 'rug';
      confidence = Math.min(1, (1 - liquidityRatio) + (1 - finalMultiplier)) / 2;
    }
    // Check for pump (even if it dumped after)
    else if (peakMultiplier >= PUMP_THRESHOLD) {
      outcome = 'pump';
      confidence = Math.min(1, (peakMultiplier - 1) / 5); // Higher multiplier = higher confidence
    }
    // Check for stable
    else if (finalMultiplier >= (1 - STABLE_RANGE) && finalMultiplier <= (1 + STABLE_RANGE)) {
      outcome = 'stable';
      confidence = 1 - Math.abs(1 - finalMultiplier) / STABLE_RANGE;
    }
    // Slow decline
    else if (finalMultiplier < 1) {
      outcome = 'slow_decline';
      confidence = 1 - finalMultiplier;
    }
    // Unknown
    else {
      outcome = 'unknown';
      confidence = 0.5;
    }

    return {
      mint: token.mint,
      symbol: token.symbol,
      outcome,
      outcomeConfidence: confidence,
      initialPrice: token.initialPrice,
      initialLiquidity: token.initialLiquidity,
      initialRiskScore: token.initialRiskScore,
      initialHolders: token.initialHolders,
      initialTop10Percent: token.initialTop10Percent,
      peakPrice: token.peakPrice,
      peakLiquidity: token.peakLiquidity,
      peakHolders: token.peakHolders,
      finalPrice: token.currentPrice,
      finalLiquidity: token.currentLiquidity,
      finalHolders: token.currentHolders,
      peakMultiplier,
      timeToPeak: token.peakAt ? token.peakAt - token.discoveredAt : undefined,
      timeToOutcome: now - token.discoveredAt,
      discoveredAt: token.discoveredAt,
      peakAt: token.peakAt,
      outcomeRecordedAt: now,
    };
  }

  /**
   * Save initial state to database
   */
  private saveInitialState(token: TrackedToken): void {
    try {
      database.saveTokenOutcomeInitial({
        mint: token.mint,
        symbol: token.symbol,
        initialPrice: token.initialPrice,
        initialLiquidity: token.initialLiquidity,
        initialRiskScore: token.initialRiskScore,
        initialHolders: token.initialHolders,
        initialTop10Percent: token.initialTop10Percent,
        discoveredAt: token.discoveredAt,
      });
    } catch (error) {
      logger.error('OutcomeTracker', `Failed to save initial state for ${token.symbol}`, error as Error);
    }
  }

  /**
   * Save final outcome to database
   */
  private saveOutcome(outcome: TokenOutcome): void {
    try {
      database.saveTokenOutcomeFinal(outcome);
    } catch (error) {
      logger.error('OutcomeTracker', `Failed to save outcome for ${outcome.symbol}`, error as Error);
    }
  }

  /**
   * Load pending tokens from database (tokens that were being tracked but not yet classified)
   */
  private loadPendingTokens(): void {
    try {
      const pending = database.getPendingOutcomes();
      const now = Math.floor(Date.now() / 1000);

      for (const row of pending) {
        // Skip if too old (would have been classified already)
        const ageMs = (now - row.discoveredAt) * 1000;
        if (ageMs > MONITORING_DURATION_MS * 2) continue;

        const token: TrackedToken = {
          mint: row.mint,
          symbol: row.symbol || row.mint.slice(0, 8),
          initialPrice: row.initialPrice || 0,
          initialLiquidity: row.initialLiquidity || 0,
          initialRiskScore: row.initialRiskScore || 0,
          initialHolders: row.initialHolders || 0,
          initialTop10Percent: row.initialTop10Percent,
          peakPrice: row.peakPrice || row.initialPrice || 0,
          peakLiquidity: row.peakLiquidity || row.initialLiquidity || 0,
          peakHolders: row.peakHolders || row.initialHolders || 0,
          peakAt: row.peakAt,
          currentPrice: row.finalPrice || row.initialPrice || 0,
          currentLiquidity: row.finalLiquidity || row.initialLiquidity || 0,
          currentHolders: row.finalHolders || row.initialHolders || 0,
          discoveredAt: row.discoveredAt,
          lastUpdatedAt: now,
          updateCount: 0,
        };

        this.trackedTokens.set(row.mint, token);
      }

      if (pending.length > 0) {
        logger.info('OutcomeTracker', `Loaded ${pending.length} pending tokens from database`);
      }
    } catch (error) {
      logger.error('OutcomeTracker', 'Failed to load pending tokens', error as Error);
    }
  }

  /**
   * Clean up old tokens that have been classified
   */
  private cleanupOldTokens(): void {
    const now = Math.floor(Date.now() / 1000);
    let removed = 0;

    for (const [mint, token] of this.trackedTokens) {
      const ageMs = (now - token.discoveredAt) * 1000;
      if (ageMs > MONITORING_DURATION_MS) {
        // Classify before removing
        const outcome = this.classifyOutcome(token);
        this.saveOutcome(outcome);
        this.trackedTokens.delete(mint);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info('OutcomeTracker', `Cleaned up ${removed} old tokens`);
    }
  }

  /**
   * Force classify a specific token (for testing)
   */
  forceClassify(mint: string): TokenOutcome | null {
    const token = this.trackedTokens.get(mint);
    if (!token) return null;

    const outcome = this.classifyOutcome(token);
    this.saveOutcome(outcome);
    this.trackedTokens.delete(mint);
    this.emit('outcome', outcome);
    return outcome;
  }

  /**
   * Manually add outcome (for importing historical data)
   */
  addManualOutcome(outcome: TokenOutcome): void {
    this.saveOutcome(outcome);
    this.emit('outcome', outcome);
  }
}

export const outcomeTracker = new OutcomeTracker();
