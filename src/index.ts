import { config } from './config';
import { telegramService } from './services/telegram';
import { solanaService } from './services/solana';
import { tokenCache } from './services/cache';
import { rateLimitService } from './services/ratelimit';
import { watchlistService } from './services/watchlist';
import { storageService } from './services/storage';
import { advancedMonitor, AdvancedAlert } from './services/advancedMonitor';
import { walletMonitorService } from './services/walletMonitor';
import { raydiumMonitor } from './monitors/raydium';
import { pumpFunMonitor } from './monitors/pumpfun';
import { jupiterMonitor } from './monitors/jupiter';
import { analyzeToken } from './analysis/tokenAnalyzer';
import { incrementTokensAnalyzed } from './telegram/commands';
import { formatAdvancedAlert } from './telegram/commands/advanced';
import { PoolInfo, FilterSettings, TokenAnalysis, DEFAULT_CATEGORY_PRIORITIES, AlertCategory, WalletActivityAlert } from './types';
import { logger } from './utils/logger';
import { QUEUE, CLEANUP } from './constants';
import { database } from './database';
import { rugPredictor } from './ml/rugPredictor';
import { claudeExplainer } from './ml/claudeExplainer';
import { apiServer } from './api/server';
import { outcomeTracker } from './services/outcomeTracker';

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

class SolanaMemecoinBot {
  private isRunning: boolean = false;
  private analysisQueue: PoolInfo[] = [];
  private processingQueue: boolean = false;
  private queueWarningLogged: boolean = false;
  private queueMutex = new AsyncSemaphore(1); // Mutex for queue operations
  private analysisSemaphore = new AsyncSemaphore(QUEUE_CONCURRENCY); // Concurrency limiter
  private activeAnalyses: number = 0;

  async start(): Promise<void> {
    console.log('');
    console.log('🚀 Starting Solana Memecoin Trading Toolkit...');
    console.log('================================================');

    try {
      // Initialize database (SQLite with WAL mode)
      await database.initialize();
      logger.info('Main', 'Database initialized');

      // Initialize ML rug predictor
      await rugPredictor.initialize();
      const mlStats = rugPredictor.getStats();
      logger.info('Main', `ML predictor ready (${mlStats.totalPredictions} predictions made)`);

      // Log Claude explainer status
      const claudeStats = claudeExplainer.getStats();
      logger.info('Main', `Claude explainer: ${claudeStats.isAvailable ? 'Available' : 'Using local explanations'}`);

      // Verify Solana RPC connection
      await solanaService.verifyConnection();

      // Initialize Telegram bot with all commands
      await telegramService.initialize();
      await telegramService.sendStartupMessage();

      // Set up event listeners for monitors
      this.setupEventListeners();

      // Start monitors based on config
      if (config.monitors.raydium.enabled) {
        await raydiumMonitor.start();
      }

      if (config.monitors.pumpfun.enabled) {
        await pumpFunMonitor.start();
      }

      if (config.monitors.jupiter.enabled) {
        await jupiterMonitor.start();
      }

      // Start watchlist monitoring
      if (config.watchlist.enabled) {
        await watchlistService.start();
      }

      // Start wallet monitoring
      if (config.walletMonitor.enabled) {
        await walletMonitorService.start();
        this.setupWalletMonitorListeners();
      }

      // Start advanced monitoring (volume spikes, whale alerts, etc.)
      await advancedMonitor.start();

      // Start outcome tracker for backtesting data
      await outcomeTracker.initialize();
      outcomeTracker.start();
      logger.info('Main', 'Outcome tracker started');

      // Start API server for dashboard
      apiServer.start();

      this.isRunning = true;

      // Start queue processor
      this.processQueue();

      // Periodic cleanup tasks
      setInterval(() => {
        tokenCache.cleanup();
        rateLimitService.cleanup();
        this.logStats();
      }, 60000);

      console.log('');
      console.log('✅ Bot is now running and monitoring for new tokens');
      console.log('📱 Send /help in Telegram for all commands');
      console.log('================================================');
      console.log('');

      // Handle graceful shutdown
      this.setupShutdownHandlers();
    } catch (error) {
      console.error('Failed to start bot:', error);
      await this.stop();
      process.exit(1);
    }
  }

  private setupEventListeners(): void {
    // Raydium new pool events
    raydiumMonitor.on('newPool', (pool: PoolInfo) => {
      this.queueAnalysis(pool);
    });

    // Pump.fun new pool events
    pumpFunMonitor.on('newPool', (pool: PoolInfo) => {
      this.queueAnalysis(pool);
    });

    // Jupiter new token events
    jupiterMonitor.on('newPool', (pool: PoolInfo) => {
      this.queueAnalysis(pool);
    });

    // Advanced monitor alerts (volume spikes, whale movements, etc.)
    advancedMonitor.on('alert', async (alert: AdvancedAlert) => {
      try {
        // Check if this alert category is enabled
        const settings = storageService.getUserSettings(config.telegramChatId);
        const categories = settings.filters.alertCategories;

        // Check if alerts are enabled
        if (!settings.filters.alertsEnabled) {
          return;
        }

        // Check if in quiet hours
        if (storageService.isQuietHours(config.telegramChatId)) {
          logger.debug('Alerts', `Skipping ${alert.type} alert - quiet hours active`);
          return;
        }

        // Check if token is blacklisted
        if (storageService.isTokenBlacklisted(config.telegramChatId, alert.tokenMint)) {
          logger.debug('Alerts', `Skipping ${alert.type} alert - token blacklisted`);
          return;
        }

        if (categories) {
          // Map alert types to categories
          const categoryMap: Record<string, keyof typeof categories> = {
            'volume_spike': 'volume_spike',
            'whale_movement': 'whale_movement',
            'liquidity_drain': 'liquidity_drain',
            'authority_change': 'authority_change',
          };

          const category = categoryMap[alert.type];
          if (category && !categories[category]) {
            logger.debug('Alerts', `Skipping ${alert.type} alert - category disabled`);
            return;
          }

          // Check priority level
          if (category) {
            const alertPriority = DEFAULT_CATEGORY_PRIORITIES[category as AlertCategory];
            if (!storageService.shouldAlertForPriority(config.telegramChatId, alertPriority)) {
              logger.debug('Alerts', `Skipping ${alert.type} alert - below priority threshold`);
              return;
            }
          }
        }

        const message = formatAdvancedAlert(alert);
        await telegramService.sendMessage(message, config.telegramChatId);

        // Add to dashboard alerts
        const emojiMap: Record<string, string> = {
          volume_spike: '📊',
          whale_movement: '🐋',
          liquidity_drain: '💧',
          authority_change: '🔐',
        };
        apiServer.addAlert({
          type: alert.type,
          title: `${alert.type.replace('_', ' ').toUpperCase()}`,
          description: `${alert.symbol} - ${alert.details}`,
          emoji: emojiMap[alert.type] || '🔔',
          timestamp: Date.now(),
        });

        console.log(`📢 Advanced alert: ${alert.type} for ${alert.symbol}`);
      } catch (error) {
        console.error('Error sending advanced alert:', error);
      }
    });
  }

  private setupWalletMonitorListeners(): void {
    walletMonitorService.on('walletActivity', async (alert: WalletActivityAlert) => {
      try {
        // Enrich the transaction with token metadata
        await walletMonitorService.enrichTransaction(alert.transaction);

        // Send alert via Telegram
        await telegramService.sendWalletActivityAlert(alert);

        // Add to dashboard alerts
        const typeEmoji = alert.transaction.type === 'buy' ? '🟢' : alert.transaction.type === 'sell' ? '🔴' : '↔️';
        apiServer.addAlert({
          type: 'wallet_activity',
          title: `${alert.wallet.label} ${alert.transaction.type.toUpperCase()}`,
          description: `${alert.transaction.tokenSymbol || 'Token'} - ${alert.transaction.amount?.toLocaleString() || 'N/A'}`,
          emoji: typeEmoji,
          timestamp: Date.now(),
        });

        console.log(`👛 Wallet alert: ${alert.wallet.label} ${alert.transaction.type} ${alert.transaction.tokenSymbol || alert.transaction.tokenMint.slice(0, 8)}`);
      } catch (error) {
        logger.silentError('WalletMonitor', 'Error handling wallet activity alert', error as Error);
      }
    });
  }

  /**
   * Thread-safe queue operation with async mutex
   * Prevents race conditions when multiple monitors emit events simultaneously
   */
  private async queueAnalysis(pool: PoolInfo): Promise<void> {
    // Acquire mutex (non-blocking, awaits if locked)
    await this.queueMutex.acquire();

    try {
      // Skip if already in cache
      if (tokenCache.has(pool.tokenMint)) {
        return;
      }

      // Skip if already in queue (use Set for O(1) lookup in future optimization)
      if (this.analysisQueue.some(p => p.tokenMint === pool.tokenMint)) {
        return;
      }

      // Check queue size limit
      if (this.analysisQueue.length >= MAX_QUEUE_SIZE) {
        // Remove oldest entries to make room (FIFO overflow)
        const removed = this.analysisQueue.splice(0, QUEUE.OVERFLOW_EVICTION_COUNT);
        logger.warn('Queue', `Overflow: removed ${removed.length} oldest entries`);
      }

      // Log warning if queue is getting large
      if (this.analysisQueue.length >= QUEUE_WARNING_THRESHOLD && !this.queueWarningLogged) {
        logger.warn('Queue', `Size warning: ${this.analysisQueue.length} items queued`);
        this.queueWarningLogged = true;
      } else if (this.analysisQueue.length < QUEUE_WARNING_THRESHOLD / 2) {
        this.queueWarningLogged = false;
      }

      // Add to queue
      this.analysisQueue.push(pool);
      logger.debug('Queue', `Added: ${pool.tokenMint.slice(0, 8)}... from ${pool.source} (${this.analysisQueue.length} queued, ${this.activeAnalyses} active)`);
    } finally {
      // Always release mutex
      this.queueMutex.release();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    const chatId = config.telegramChatId;

    while (this.isRunning) {
      if (this.analysisQueue.length > 0) {
        // Check global rate limit before starting batch
        if (!rateLimitService.canSendAnyAlert(chatId)) {
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
            // Skip tokens on cooldown
            if (rateLimitService.canSendAlert(chatId, pool.tokenMint)) {
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
        await Promise.all(batch.map(pool => this.processToken(pool, chatId)));
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
  private async processToken(pool: PoolInfo, chatId: string): Promise<void> {
    await this.analysisSemaphore.acquire();
    this.activeAnalyses++;

    try {
      // Analyze the token
      const analysis = await analyzeToken(pool.tokenMint, pool);
      incrementTokensAnalyzed();

      if (analysis) {
        // Get ML prediction for rug probability
        const mlPrediction = await rugPredictor.predict({
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
        });

        // Save analysis to database (async, don't await)
        this.saveAnalysisToDatabase(analysis, mlPrediction).catch(e =>
          logger.silentError('Database', 'Failed to save analysis', e as Error)
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

        if (this.shouldAlert(analysis, chatId)) {
          // Send Telegram alert with ML prediction info
          await telegramService.sendAlert(analysis, mlPrediction);

          // Mark rate limit
          rateLimitService.markAlertSent(chatId, pool.tokenMint);
          tokenCache.markAlertSent(pool.tokenMint);

          // Save alert to database (async)
          database.saveAlert({
            tokenMint: pool.tokenMint,
            symbol: analysis.token.symbol,
            alertType: 'new_token',
            chatId,
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

  private shouldAlert(analysis: any, chatId: string): boolean {
    // Get user's filter settings
    const settings = storageService.getUserSettings(chatId);
    const filters = settings.filters;

    // Check if alerts are enabled
    if (!filters.alertsEnabled) {
      return false;
    }

    // Check if currently in quiet hours
    if (storageService.isQuietHours(chatId)) {
      return false;
    }

    // Check if new_token category is enabled
    if (filters.alertCategories && !filters.alertCategories.new_token) {
      return false;
    }

    // Check priority level for new_token alerts
    const alertPriority = DEFAULT_CATEGORY_PRIORITIES.new_token;
    if (!storageService.shouldAlertForPriority(chatId, alertPriority)) {
      return false;
    }

    // Check if token is blacklisted
    if (storageService.isTokenBlacklisted(chatId, analysis.token.mint)) {
      return false;
    }

    // Check liquidity threshold
    if (analysis.liquidity.totalLiquidityUsd < filters.minLiquidity) {
      return false;
    }

    // Check holder concentration
    if (analysis.holders.top10HoldersPercent > filters.maxTop10Percent) {
      return false;
    }

    // Check holder count
    if (analysis.holders.totalHolders < filters.minHolders) {
      return false;
    }

    // Check risk score
    if (analysis.risk.score < filters.minRiskScore) {
      return false;
    }

    // Check token age (if available)
    if (filters.minTokenAge > 0) {
      const tokenAge = analysis.pool.createdAt
        ? (Date.now() - new Date(analysis.pool.createdAt).getTime()) / 1000
        : 0;
      if (tokenAge > 0 && tokenAge < filters.minTokenAge) {
        return false;
      }
    }

    // Check requirement filters
    if (filters.requireMintRevoked && !analysis.contract.mintAuthorityRevoked) {
      return false;
    }

    if (filters.requireFreezeRevoked && !analysis.contract.freezeAuthorityRevoked) {
      return false;
    }

    if (filters.requireLPBurned && !analysis.liquidity.lpBurned) {
      return false;
    }

    if (filters.requireSocials) {
      const hasSocials = analysis.social.hasTwitter ||
                        analysis.social.hasTelegram ||
                        analysis.social.hasWebsite;
      if (!hasSocials) {
        return false;
      }
    }

    return true;
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
   * Track a token for outcome analysis
   */
  private async trackTokenForOutcome(analysis: TokenAnalysis): Promise<void> {
    try {
      // Get current price from DexScreener
      const { dexScreenerService } = await import('./services/dexscreener');
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
      // Silently fail - outcome tracking is optional
      logger.debug('OutcomeTracker', `Failed to track ${analysis.token.symbol}: ${(error as Error).message}`);
    }
  }

  private logStats(): void {
    const cacheStats = tokenCache.getStats();
    const rateLimitStats = rateLimitService.getStats();
    const dbStats = database.getStats();
    const mlStats = rugPredictor.getStats();

    console.log(
      `📊 Stats: ${cacheStats.total} tokens | ${cacheStats.alertsSent} alerts | ` +
      `${this.analysisQueue.length} queued | ${this.activeAnalyses}/${QUEUE_CONCURRENCY} active | ${rateLimitStats.totalEntries} cooldowns`
    );
    console.log(
      `💾 DB: ${dbStats.totalAnalyses} analyses | ${dbStats.alertsToday} alerts today | ` +
      `🤖 ML: ${mlStats.totalPredictions} predictions`
    );
  }

  private setupShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      console.log(`\n⚠️ Received ${signal}, shutting down gracefully...`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  async stop(): Promise<void> {
    console.log('🛑 Stopping bot...');
    this.isRunning = false;

    // Stop all monitors
    await raydiumMonitor.stop();
    await pumpFunMonitor.stop();
    await jupiterMonitor.stop();

    // Stop advanced monitoring
    await advancedMonitor.stop();

    // Stop watchlist monitoring
    watchlistService.stop();

    // Stop wallet monitoring
    walletMonitorService.stop();

    // Stop outcome tracker
    outcomeTracker.stop();

    // Stop Telegram bot
    telegramService.stop();

    // Stop API server
    apiServer.stop();

    // Close database connection
    database.close();
    logger.info('Main', 'Database closed');

    console.log('✅ Bot stopped');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Create and start the bot
const bot = new SolanaMemecoinBot();
bot.start().catch((error) => {
  console.error('💀 Fatal error:', error);
  process.exit(1);
});
