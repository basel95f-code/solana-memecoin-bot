import { config } from './config';
import { telegramService } from './services/telegram';
import { solanaService } from './services/solana';
import { tokenCache } from './services/cache';
import { rateLimitService } from './services/ratelimit';
import { watchlistService } from './services/watchlist';
import { advancedMonitor } from './services/advancedMonitor';
import { walletMonitorService } from './services/walletMonitor';
import { telegramMtprotoService } from './services/telegramMtproto';
import { discordBotService } from './services/discordBot';
import { raydiumMonitor } from './monitors/raydium';
import { pumpFunMonitor } from './monitors/pumpfun';
import { jupiterMonitor } from './monitors/jupiter';
import { logger } from './utils/logger';
import { CLEANUP } from './constants';
import { database } from './database';
import { rugPredictor } from './ml/rugPredictor';
import { ensemblePredictor } from './ml/ensemblePredictor';
import { claudeExplainer } from './ml/claudeExplainer';
import { apiServer } from './api/server';
import { outcomeTracker } from './services/outcomeTracker';
import { signalService, signalPriceMonitor } from './signals';
import { trainingPipeline } from './ml/trainingPipeline';
import { queueProcessor, setupEventListeners, setupWalletMonitorListeners } from './core';

class SolanaMemecoinBot {
  private isRunning: boolean = false;

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

      // Initialize ensemble predictor
      await ensemblePredictor.initialize();
      const ensembleStats = ensemblePredictor.getStats();
      logger.info('Main', `Ensemble predictor ready (${ensembleStats.totalModels} models)`);

      // Log Claude explainer status
      const claudeStats = claudeExplainer.getStats();
      logger.info('Main', `Claude explainer: ${claudeStats.isAvailable ? 'Available' : 'Using local explanations'}`);

      // Verify Solana RPC connection
      await solanaService.verifyConnection();

      // Initialize Telegram bot with all commands
      await telegramService.initialize();
      await telegramService.sendStartupMessage();

      // Set up event listeners for monitors
      setupEventListeners();

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
        setupWalletMonitorListeners();
      }

      // Start advanced monitoring (volume spikes, whale alerts, etc.)
      await advancedMonitor.start();

      // Initialize multi-platform sentiment services
      if (config.sentiment.telegramEnabled) {
        await telegramMtprotoService.initialize();
        const tgStats = telegramMtprotoService.getStats();
        logger.info('Main', `Telegram MTProto: ${tgStats.isConnected ? 'Connected' : 'Not connected'}`);
      }

      if (config.sentiment.discordEnabled) {
        await discordBotService.initialize();
        const discordStats = discordBotService.getStats();
        logger.info('Main', `Discord Bot: ${discordStats.isConnected ? 'Connected' : 'Not connected'} (${discordStats.guilds} guilds)`);
      }

      // Start outcome tracker for backtesting data
      await outcomeTracker.initialize();
      outcomeTracker.start();
      logger.info('Main', 'Outcome tracker started');

      // Initialize signal service and training pipeline
      await signalService.initialize();
      await trainingPipeline.initialize();
      trainingPipeline.startAutoTraining();
      logger.info('Main', 'Signal service and ML training pipeline started');

      // Start signal price monitor (watches active signals for TP/SL)
      signalPriceMonitor.start();
      logger.info('Main', 'Signal price monitor started');

      // Start API server for dashboard
      apiServer.start();

      this.isRunning = true;

      // Start queue processor
      queueProcessor.start();

      // Periodic cleanup tasks
      setInterval(() => {
        tokenCache.cleanup();
        rateLimitService.cleanup();
        this.logStats();
      }, CLEANUP.MAIN_LOOP_INTERVAL_MS);

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

  private logStats(): void {
    const cacheStats = tokenCache.getStats();
    const rateLimitStats = rateLimitService.getStats();
    const dbStats = database.getStats();
    const mlStats = rugPredictor.getStats();
    const queueStats = queueProcessor.getStats();
    const walletStats = walletMonitorService.getStats();

    console.log(
      `📊 Stats: ${cacheStats.total} tokens | ${cacheStats.alertsSent} alerts | ` +
      `${queueStats.queueSize} queued | ${queueStats.activeAnalyses}/${queueStats.concurrency} active | ${rateLimitStats.totalEntries} cooldowns`
    );
    console.log(
      `💾 DB: ${dbStats.totalAnalyses} analyses | ${dbStats.alertsToday} alerts today | ` +
      `🤖 ML: ${mlStats.totalPredictions} predictions | ` +
      `👛 Wallets: ${walletStats.trackedWallets} tracked (${walletStats.mode})`
    );
  }

  private setupShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      console.log(`\n⚠️ Received ${signal}, shutting down gracefully...`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => {
      shutdown('SIGINT').catch((error) => {
        console.error('Error during shutdown:', error);
        process.exit(1);
      });
    });
    process.on('SIGTERM', () => {
      shutdown('SIGTERM').catch((error) => {
        console.error('Error during shutdown:', error);
        process.exit(1);
      });
    });
  }

  async stop(): Promise<void> {
    console.log('🛑 Stopping bot...');
    this.isRunning = false;

    // Stop queue processor
    queueProcessor.stop();

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

    // Stop multi-platform sentiment services
    await telegramMtprotoService.stop();
    await discordBotService.stop();

    // Stop outcome tracker
    outcomeTracker.stop();

    // Stop signal services
    signalPriceMonitor.stop();
    signalService.stop();
    trainingPipeline.stopAutoTraining();

    // Stop Telegram bot
    telegramService.stop();

    // Stop API server
    apiServer.stop();

    // Close database connection
    database.close();
    logger.info('Main', 'Database closed');

    console.log('✅ Bot stopped');
  }
}

// Create and start the bot
const bot = new SolanaMemecoinBot();
bot.start().catch((error) => {
  console.error('💀 Fatal error:', error);
  process.exit(1);
});
