import { config } from './config';
import { telegramService } from './services/telegram';
import { solanaService } from './services/solana';
import { tokenCache } from './services/cache';
import { rateLimitService } from './services/ratelimit';
import { watchlistService } from './services/watchlist';
import { storageService } from './services/storage';
import { advancedMonitor, AdvancedAlert } from './services/advancedMonitor';
import { raydiumMonitor } from './monitors/raydium';
import { pumpFunMonitor } from './monitors/pumpfun';
import { jupiterMonitor } from './monitors/jupiter';
import { analyzeToken } from './analysis/tokenAnalyzer';
import { incrementTokensAnalyzed } from './telegram/commands';
import { formatAdvancedAlert } from './telegram/commands/advanced';
import { PoolInfo, FilterSettings } from './types';

const MAX_QUEUE_SIZE = 500; // Maximum number of pools in queue
const QUEUE_WARNING_THRESHOLD = 400; // Log warning when queue exceeds this

class SolanaMemecoinBot {
  private isRunning: boolean = false;
  private analysisQueue: PoolInfo[] = [];
  private processingQueue: boolean = false;
  private queueWarningLogged: boolean = false;

  async start(): Promise<void> {
    console.log('');
    console.log('🚀 Starting Solana Memecoin Trading Toolkit...');
    console.log('================================================');

    try {
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

      // Start advanced monitoring (volume spikes, whale alerts, etc.)
      await advancedMonitor.start();

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
        const message = formatAdvancedAlert(alert);
        await telegramService.sendMessage(message, config.telegramChatId);
        console.log(`📢 Advanced alert: ${alert.type} for ${alert.symbol}`);
      } catch (error) {
        console.error('Error sending advanced alert:', error);
      }
    });
  }

  private queueAnalysis(pool: PoolInfo): void {
    // Skip if already in cache
    if (tokenCache.has(pool.tokenMint)) {
      return;
    }

    // Skip if already in queue
    if (this.analysisQueue.some(p => p.tokenMint === pool.tokenMint)) {
      return;
    }

    // Check queue size limit
    if (this.analysisQueue.length >= MAX_QUEUE_SIZE) {
      // Remove oldest entries to make room (FIFO overflow)
      const removed = this.analysisQueue.splice(0, 50);
      console.warn(`⚠️ Queue overflow: removed ${removed.length} oldest entries`);
    }

    // Log warning if queue is getting large
    if (this.analysisQueue.length >= QUEUE_WARNING_THRESHOLD && !this.queueWarningLogged) {
      console.warn(`⚠️ Queue size warning: ${this.analysisQueue.length} items queued`);
      this.queueWarningLogged = true;
    } else if (this.analysisQueue.length < QUEUE_WARNING_THRESHOLD / 2) {
      this.queueWarningLogged = false;
    }

    // Add to queue
    this.analysisQueue.push(pool);
    console.log(`📥 Queued: ${pool.tokenMint.slice(0, 8)}... from ${pool.source} (${this.analysisQueue.length} in queue)`);
  }

  private async processQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    const chatId = config.telegramChatId;

    while (this.isRunning) {
      if (this.analysisQueue.length > 0) {
        const pool = this.analysisQueue.shift()!;

        try {
          // Check rate limits before analysis
          if (!rateLimitService.canSendAnyAlert(chatId)) {
            console.log('⏳ Rate limit reached, waiting...');
            await this.sleep(5000);
            this.analysisQueue.unshift(pool); // Put it back
            continue;
          }

          // Check per-token cooldown
          if (!rateLimitService.canSendAlert(chatId, pool.tokenMint)) {
            console.log(`⏳ Token ${pool.tokenMint.slice(0, 8)}... on cooldown`);
            continue;
          }

          // Analyze the token
          const analysis = await analyzeToken(pool.tokenMint, pool);
          incrementTokensAnalyzed();

          if (analysis && this.shouldAlert(analysis, chatId)) {
            // Send Telegram alert
            await telegramService.sendAlert(analysis);

            // Mark rate limit
            rateLimitService.markAlertSent(chatId, pool.tokenMint);
            tokenCache.markAlertSent(pool.tokenMint);

            console.log(
              `🔔 Alert: ${analysis.token.symbol} - ${analysis.risk.level} (${analysis.risk.score}/100)`
            );
          }
        } catch (error) {
          console.error(`❌ Error analyzing ${pool.tokenMint.slice(0, 8)}...:`, error);
        }

        // Rate limiting - wait between analyses
        await this.sleep(1000);
      } else {
        // No items in queue, wait before checking again
        await this.sleep(100);
      }
    }

    this.processingQueue = false;
  }

  private shouldAlert(analysis: any, chatId: string): boolean {
    // Get user's filter settings
    const settings = storageService.getUserSettings(chatId);
    const filters = settings.filters;

    // Check if alerts are enabled
    if (!filters.alertsEnabled) {
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

  private logStats(): void {
    const cacheStats = tokenCache.getStats();
    const rateLimitStats = rateLimitService.getStats();
    console.log(
      `📊 Stats: ${cacheStats.total} tokens | ${cacheStats.alertsSent} alerts | ` +
      `${this.analysisQueue.length} queued | ${rateLimitStats.totalEntries} cooldowns`
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

    // Stop Telegram bot
    telegramService.stop();

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
