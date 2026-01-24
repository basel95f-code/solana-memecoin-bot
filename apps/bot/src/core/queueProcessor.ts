/**
 * Queue processor for token analysis
 * Handles queuing, deduplication, and parallel processing of new tokens
 */

import { config } from '../config';
import { tokenCache } from '../services/cache';
import { rateLimitService } from '../services/ratelimit';
import { telegramService } from '../services/telegram';
import { analyzeToken } from '../analysis/tokenAnalyzer';
import { incrementTokensAnalyzed } from '../telegram/commands';
import { rugPredictor } from '../ml/rugPredictor';
import { database } from '../database';
import { apiServer } from '../api/server';
import { outcomeTracker } from '../services/outcomeTracker';
import { dexScreenerService } from '../services/dexscreener';
import { signalService } from '../signals';
import type { PoolInfo, TokenAnalysis } from '../types';
import { logger } from '../utils/logger';
import { QUEUE } from '../constants';
import { shouldAlert } from './alertFilter';

const MAX_QUEUE_SIZE = QUEUE.MAX_SIZE;
const QUEUE_WARNING_THRESHOLD = QUEUE.WARNING_THRESHOLD;
const QUEUE_CONCURRENCY = QUEUE.CONCURRENCY;

/**
 * Async semaphore for controlling concurrent operations
 */
class AsyncSemaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    const next = this.waiting.shift();
    if (next) {
      this.permits--;
      next();
    }
  }

  get available(): number {
    return this.permits;
  }
}

export class QueueProcessor {
  private analysisQueue: PoolInfo[] = [];
  private queuedMints: Set<string> = new Set(); // O(1) dedup lookup
  private processingQueue: boolean = false;
  private queueWarningLogged: boolean = false;
  private queueMutex = new AsyncSemaphore(1);
  private analysisSemaphore = new AsyncSemaphore(QUEUE_CONCURRENCY);
  private activeAnalyses: number = 0;
  private isRunning: boolean = false;
  private chatId: string;

  constructor() {
    this.chatId = config.telegramChatId;
  }

  /**
   * Start the queue processor
   */
  start(): void {
    this.isRunning = true;
    void this.processQueue();
  }

  /**
   * Stop the queue processor
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * Thread-safe queue operation with async mutex
   * Prevents race conditions when multiple monitors emit events simultaneously
   */
  async queueAnalysis(pool: PoolInfo): Promise<void> {
    await this.queueMutex.acquire();

    try {
      // Skip if already in cache
      if (tokenCache.has(pool.tokenMint)) {
        return;
      }

      // Skip if already in queue - O(1) lookup with Set
      if (this.queuedMints.has(pool.tokenMint)) {
        return;
      }

      // Check queue size limit
      if (this.analysisQueue.length >= MAX_QUEUE_SIZE) {
        // Remove oldest entries to make room (FIFO overflow)
        const removed = this.analysisQueue.splice(0, QUEUE.OVERFLOW_EVICTION_COUNT);
        // Also remove from Set
        for (const p of removed) {
          this.queuedMints.delete(p.tokenMint);
        }
        logger.warn('Queue', `Overflow: removed ${removed.length} oldest entries`);
      }

      // Log warning if queue is getting large
      if (this.analysisQueue.length >= QUEUE_WARNING_THRESHOLD && !this.queueWarningLogged) {
        logger.warn('Queue', `Size warning: ${this.analysisQueue.length} items queued`);
        this.queueWarningLogged = true;
      } else if (this.analysisQueue.length < QUEUE_WARNING_THRESHOLD / 2) {
        this.queueWarningLogged = false;
      }

      // Add to queue and Set
      this.analysisQueue.push(pool);
      this.queuedMints.add(pool.tokenMint);
      logger.debug('Queue', `Added: ${pool.tokenMint.slice(0, 8)}... from ${pool.source} (${this.analysisQueue.length} queued, ${this.activeAnalyses} active)`);
    } finally {
      this.queueMutex.release();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    while (this.isRunning) {
      if (this.analysisQueue.length > 0) {
        // Check global rate limit before starting batch
        if (!rateLimitService.canSendAnyAlert(this.chatId)) {
          logger.info('Queue', 'Rate limit reached, waiting...');
          await this.sleep(QUEUE.RATE_LIMIT_WAIT_MS);
          continue;
        }

        // Get batch of tokens to process (up to concurrency limit)
        const batch: PoolInfo[] = [];
        await this.queueMutex.acquire();
        try {
          while (batch.length < QUEUE_CONCURRENCY && this.analysisQueue.length > 0) {
            const pool = this.analysisQueue.shift()!;
            this.queuedMints.delete(pool.tokenMint); // Remove from Set
            // Skip tokens on cooldown
            if (rateLimitService.canSendAlert(this.chatId, pool.tokenMint)) {
              batch.push(pool);
            }
          }
        } finally {
          this.queueMutex.release();
        }

        if (batch.length === 0) {
          await this.sleep(QUEUE.EMPTY_QUEUE_CHECK_MS);
          continue;
        }

        // Process batch in parallel
        const startTime = Date.now();
        await Promise.all(batch.map(pool => this.processToken(pool)));
        const elapsed = Date.now() - startTime;

        logger.debug('Queue', `Processed ${batch.length} tokens in ${elapsed}ms (${this.analysisQueue.length} remaining)`);

        // Small delay between batches to avoid API hammering
        await this.sleep(QUEUE.PROCESS_DELAY_MS);
      } else {
        // No items in queue, wait before checking again
        await this.sleep(QUEUE.EMPTY_QUEUE_CHECK_MS);
      }
    }

    this.processingQueue = false;
  }

  /**
   * Process a single token with semaphore-controlled concurrency
   */
  private async processToken(pool: PoolInfo): Promise<void> {
    await this.analysisSemaphore.acquire();
    this.activeAnalyses++;

    try {
      // Analyze the token
      const analysis = await analyzeToken(pool.tokenMint, pool);
      incrementTokensAnalyzed();

      if (analysis) {
        // Get DexScreener data for price/volume info (needed for enhanced ML features)
        const pairData = await dexScreenerService.getTokenData(analysis.token.mint);
        const priceUsd = pairData ? parseFloat(pairData.priceUsd || '0') : 0;

        // Get ML prediction for rug probability using enhanced 25-feature model
        const mlPrediction = await rugPredictor.predictEnhanced({
          // Base features (9)
          liquidityUsd: analysis.liquidity.totalLiquidityUsd,
          riskScore: analysis.risk.score,
          holderCount: analysis.holders.totalHolders,
          top10Percent: analysis.holders.top10HoldersPercent,
          mintRevoked: analysis.contract.mintAuthorityRevoked,
          freezeRevoked: analysis.contract.freezeAuthorityRevoked,
          lpBurnedPercent: analysis.liquidity.lpBurnedPercent,
          hasSocials: analysis.social.hasTwitter || analysis.social.hasTelegram || analysis.social.hasWebsite,
          tokenAgeHours: analysis.pool.createdAt
            ? (Date.now() - new Date(analysis.pool.createdAt).getTime()) / 3600000
            : 0,
          // Momentum features (6)
          priceChange5m: pairData?.priceChange?.m5,
          priceChange1h: pairData?.priceChange?.h1,
          priceChange24h: pairData?.priceChange?.h24,
          volumeChange1h: pairData?.volume?.h1 && pairData?.volume?.h24
            ? ((pairData.volume.h1 * 24) / pairData.volume.h24 - 1) * 100
            : undefined,
          volumeChange24h: undefined, // Not available directly
          buyPressure1h: pairData?.txns?.h1
            ? pairData.txns.h1.buys / (pairData.txns.h1.buys + pairData.txns.h1.sells || 1)
            : undefined,
          // Smart money features (3)
          smartMoneyNetBuys: analysis.smartMoney?.netSmartMoney,
          smartMoneyHolding: analysis.smartMoney?.smartMoneyHolding,
          isSmartMoneyBullish: analysis.smartMoney?.isSmartMoneyBullish,
          // Pattern features (3)
          hasVolumeSpike: pairData?.volume?.h1 && pairData?.volume?.h6
            ? pairData.volume.h1 > (pairData.volume.h6 / 6) * 3
            : undefined,
          isPumping: pairData?.priceChange?.h1 ? pairData.priceChange.h1 > 50 : undefined,
          isDumping: pairData?.priceChange?.h1 ? pairData.priceChange.h1 < -30 : undefined,
        });

        // Save analysis to database (async, don't await)
        this.saveAnalysisToDatabase(analysis, mlPrediction).catch(e =>
          logger.silentError('Database', 'Failed to save analysis', e as Error)
        );

        // Generate trading signal if conditions are met
        this.generateSignal(analysis, mlPrediction, pairData, priceUsd).catch(e =>
          logger.silentError('Signals', 'Failed to generate signal', e as Error)
        );

        // Add to dashboard discoveries
        apiServer.addDiscovery({
          mint: analysis.token.mint,
          symbol: analysis.token.symbol,
          name: analysis.token.name,
          source: pool.source,
          riskScore: analysis.risk.score,
          riskLevel: analysis.risk.level,
          timestamp: Date.now(),
        });

        if (shouldAlert(analysis, this.chatId)) {
          // Send Telegram alert with ML prediction info
          await telegramService.sendAlert(analysis, mlPrediction);

          // Mark rate limit
          rateLimitService.markAlertSent(this.chatId, pool.tokenMint);
          tokenCache.markAlertSent(pool.tokenMint);

          // Save alert to database (async)
          database.saveAlert({
            tokenMint: pool.tokenMint,
            symbol: analysis.token.symbol,
            alertType: 'new_token',
            chatId: this.chatId,
            riskScore: analysis.risk.score,
            riskLevel: analysis.risk.level,
          });

          // Add to dashboard alerts
          apiServer.addAlert({
            type: 'new_token',
            title: `New Token: ${analysis.token.symbol}`,
            description: `Score: ${analysis.risk.score} - ${analysis.risk.level}`,
            emoji: '✨',
            timestamp: Date.now(),
          });

          const rugPct = (mlPrediction.rugProbability * 100).toFixed(0);
          console.log(
            `🔔 Alert: ${analysis.token.symbol} - ${analysis.risk.level} (${analysis.risk.score}/100) | ML: ${rugPct}% rug risk`
          );
        }
      }
    } catch (error) {
      logger.silentError('Analysis', `Failed to analyze ${pool.tokenMint.slice(0, 8)}...`, error as Error);
    } finally {
      this.activeAnalyses--;
      this.analysisSemaphore.release();
    }
  }

  /**
   * Save analysis and ML prediction to database for history and ML training
   */
  private async saveAnalysisToDatabase(
    analysis: TokenAnalysis,
    mlPrediction: { rugProbability: number; confidence: number; recommendation: string }
  ): Promise<void> {
    try {
      database.saveAnalysis({
        tokenMint: analysis.token.mint,
        symbol: analysis.token.symbol,
        name: analysis.token.name,
        riskScore: analysis.risk.score,
        riskLevel: analysis.risk.level,
        liquidityUsd: analysis.liquidity.totalLiquidityUsd,
        lpBurnedPercent: analysis.liquidity.lpBurnedPercent,
        lpLockedPercent: analysis.liquidity.lpLockedPercent,
        holderCount: analysis.holders.totalHolders,
        top10Percent: analysis.holders.top10HoldersPercent,
        mintRevoked: analysis.contract.mintAuthorityRevoked,
        freezeRevoked: analysis.contract.freezeAuthorityRevoked,
        isHoneypot: analysis.contract.isHoneypot,
        hasTwitter: analysis.social.hasTwitter,
        hasTelegram: analysis.social.hasTelegram,
        hasWebsite: analysis.social.hasWebsite,
        source: analysis.pool.source,
        mlRugProbability: mlPrediction.rugProbability,
        mlConfidence: mlPrediction.confidence,
      });

      // Track token for outcome analysis (for backtesting)
      this.trackTokenForOutcome(analysis).catch(e =>
        logger.silentError('OutcomeTracker', 'Failed to track token', e as Error)
      );
    } catch (error) {
      logger.silentError('Database', 'Failed to save analysis', error as Error);
    }
  }

  /**
   * Generate trading signal based on analysis and ML prediction
   */
  private async generateSignal(
    analysis: TokenAnalysis,
    mlPrediction: { rugProbability: number; confidence: number; recommendation: string },
    pairData: any,
    priceUsd: number
  ): Promise<void> {
    try {
      if (priceUsd <= 0) return; // Skip if no price data

      // Prepare signal generation input
      const signal = await signalService.processAnalysis({
        mint: analysis.token.mint,
        symbol: analysis.token.symbol,
        name: analysis.token.name,
        rugProbability: mlPrediction.rugProbability,
        riskScore: analysis.risk.score,
        smartMoneyNetBuys: analysis.smartMoney?.netSmartMoney,
        smartMoneyHolding: analysis.smartMoney?.smartMoneyHolding,
        isSmartMoneyBullish: analysis.smartMoney?.isSmartMoneyBullish,
        priceUsd,
        priceChange1h: pairData?.priceChange?.h1,
        priceChange24h: pairData?.priceChange?.h24,
        volume1h: pairData?.volume?.h1,
        volume24h: pairData?.volume?.h24,
        holderCount: analysis.holders.totalHolders,
        top10Percent: analysis.holders.top10HoldersPercent,
        mintRevoked: analysis.contract.mintAuthorityRevoked,
        freezeRevoked: analysis.contract.freezeAuthorityRevoked,
        lpBurnedPercent: analysis.liquidity.lpBurnedPercent,
        liquidityUsd: analysis.liquidity.totalLiquidityUsd,
      });

      if (signal) {
        // Save signal to database
        database.saveSignal({
          id: signal.id,
          mint: signal.mint,
          symbol: signal.symbol,
          name: signal.name,
          type: signal.type,
          confidence: signal.confidence,
          suggestedPositionSize: signal.suggestedPositionSize,
          positionSizeType: signal.positionSizeType,
          rugProbability: signal.rugProbability,
          riskScore: signal.riskScore,
          smartMoneyScore: signal.smartMoneyScore,
          momentumScore: signal.momentumScore,
          holderScore: signal.holderScore,
          entryPrice: signal.entryPrice,
          targetPrice: signal.targetPrice,
          stopLossPrice: signal.stopLossPrice,
          reasons: signal.reasons,
          warnings: signal.warnings,
          status: signal.status,
          generatedAt: signal.generatedAt,
          expiresAt: signal.expiresAt,
        });

        // Send Telegram alert for signal
        await telegramService.sendSignalAlert(signal);

        logger.info('Signals', `Generated ${signal.type} signal for ${signal.symbol} (${signal.confidence}% confidence)`);
      }
    } catch (error) {
      logger.debug('Signals', `Failed to generate signal for ${analysis.token.symbol}: ${(error as Error).message}`);
    }
  }

  /**
   * Track a token for outcome analysis
   */
  private async trackTokenForOutcome(analysis: TokenAnalysis): Promise<void> {
    try {
      const pairData = await dexScreenerService.getTokenData(analysis.token.mint);
      const initialPrice = pairData ? parseFloat(pairData.priceUsd || '0') : 0;

      // Only track if we have valid price data
      if (initialPrice > 0) {
        outcomeTracker.trackToken(
          analysis.token.mint,
          analysis.token.symbol,
          initialPrice,
          analysis.liquidity.totalLiquidityUsd,
          analysis.risk.score,
          analysis.holders.totalHolders,
          analysis.holders.top10HoldersPercent
        );
      }
    } catch (error) {
      logger.debug('OutcomeTracker', `Failed to track ${analysis.token.symbol}: ${(error as Error).message}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get queue statistics
   */
  getStats(): { queueSize: number; activeAnalyses: number; concurrency: number } {
    return {
      queueSize: this.analysisQueue.length,
      activeAnalyses: this.activeAnalyses,
      concurrency: QUEUE_CONCURRENCY,
    };
  }
}

export const queueProcessor = new QueueProcessor();
