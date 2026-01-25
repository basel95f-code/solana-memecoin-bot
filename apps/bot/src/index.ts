import { config } from './config';
import { telegramService } from './services/telegram';
import { solanaService } from './services/solana';
import { tokenCache } from './services/cache';
import { rateLimitService } from './services/ratelimit';
import { watchlistService } from './services/watchlist';
import { advancedMonitor } from './services/advancedMonitor';
import { walletMonitorService } from './services/walletMonitor';
import { liquidityMonitor } from './services/liquidityMonitor';
import { devWalletTracker } from './services/devWalletTracker';
import { bundledWalletDetector } from './services/bundledWalletDetector';
import { topHolderTracker } from './services/topHolderTracker';
import { smartMoneyTracker } from './services/smartMoneyTracker';
import { smartMoneyLearner } from './services/smartMoneyLearner';
import { smartMoneyMonitor } from './jobs/smartMoneyMonitor';
import { whaleActivityTracker } from './services/whaleActivityTracker';
import { enhancedClusterDetector } from './services/enhancedClusterDetector';
import { walletProfiler } from './services/walletProfiler';
import { multiTimeframeAnalyzer } from './analysis/multiTimeframeAnalyzer';
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
import { learningOrchestrator } from './services/learningOrchestrator';
import { initLeaderboardJob } from './jobs/updateLeaderboard';
import { startAutoRetrainScheduler } from './jobs/mlAutoRetrain';
import { startPatternUpdateScheduler } from './jobs/patternUpdater';
import { patternDetector } from './services/patternDetector';
import { queueProcessor, setupEventListeners, setupWalletMonitorListeners } from './core';
import { formatSmartMoneyAlertMessage } from './telegram/commands/smartmoney';
import { formatAccumulationAlert, formatDistributionAlert, formatCoordinatedMovement } from './telegram/commands/whaleactivity';
import { formatClusterAlert, formatSybilAttackAlert } from './telegram/commands/clusters';
import type { SmartMoneyAlert } from './services/smartMoneyTracker';
import type { AccumulationAlert, DistributionAlert, CoordinatedMovement } from './services/whaleActivityTracker';
import type { WalletCluster, SybilAttack } from './services/enhancedClusterDetector';

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

      // Start liquidity monitor (rug pull protection)
      await liquidityMonitor.start();
      logger.info('Main', 'Liquidity monitor started');

      // Start dev wallet tracker (rug pull early warning)
      await devWalletTracker.start();
      logger.info('Main', 'Dev wallet tracker started');

      // Start bundled wallet detector (Sybil attack detection)
      await bundledWalletDetector.start();
      logger.info('Main', 'Bundled wallet detector started');

      // Start top holder tracker (whale movement monitoring)
      await topHolderTracker.start();
      logger.info('Main', 'Top holder tracker started');

      // Start smart money tracker (performance tracking for wallets)
      await smartMoneyTracker.start();
      logger.info('Main', 'Smart money tracker started - wallet performance monitoring active');

      // Start smart money learning system (database-backed)
      smartMoneyLearner.initialize();
      await smartMoneyMonitor.start();
      logger.info('Main', 'Smart money learning system started - tracking wallet patterns');

      // Set up smart money alert listener
      smartMoneyTracker.on('smartMoneyAlert', async (alert: SmartMoneyAlert) => {
        try {
          const message = formatSmartMoneyAlertMessage(
            alert.walletLabel,
            alert.action,
            alert.tokenSymbol,
            alert.tokenMint,
            alert.solValue,
            alert.priceUsd,
            alert.metrics.winRate,
            alert.metrics.totalRoi,
            alert.metrics.last30DaysPnl
          );

          // Send alert to Telegram (using configured chat ID for now)
          await telegramService.sendMessage(config.telegramChatId, message);
        } catch (error) {
          logger.error('Main', 'Failed to send smart money alert', error as Error);
        }
      });

      // Auto-generate profiles when metrics are updated
      smartMoneyTracker.on('metricsUpdated', async (walletAddress: string) => {
        try {
          await walletProfiler.generateProfile(walletAddress);
        } catch (error) {
          logger.silentError('Main', 'Failed to generate wallet profile', error as Error);
        }
      });

      // Set up whale activity alert listeners
      whaleActivityTracker.on('accumulation', async (alert: AccumulationAlert) => {
        try {
          const message = formatAccumulationAlert(alert);
          await telegramService.sendMessage(config.telegramChatId, message);
        } catch (error) {
          logger.error('Main', 'Failed to send accumulation alert', error as Error);
        }
      });

      whaleActivityTracker.on('distribution', async (alert: DistributionAlert) => {
        try {
          const message = formatDistributionAlert(alert);
          await telegramService.sendMessage(config.telegramChatId, message);
        } catch (error) {
          logger.error('Main', 'Failed to send distribution alert', error as Error);
        }
      });

      whaleActivityTracker.on('coordinatedMovement', async (movement: CoordinatedMovement) => {
        try {
          const message = formatCoordinatedMovement(movement);
          await telegramService.sendMessage(config.telegramChatId, message);
        } catch (error) {
          logger.error('Main', 'Failed to send coordinated movement alert', error as Error);
        }
      });

      // Periodic cleanup for whale activity tracker
      setInterval(() => {
        whaleActivityTracker.cleanup();
      }, 24 * 60 * 60 * 1000); // Daily cleanup

      // Set up cluster detection alert listeners
      enhancedClusterDetector.on('clusterDetected', async (cluster: WalletCluster) => {
        try {
          const message = formatClusterAlert(cluster);
          await telegramService.sendMessage(config.telegramChatId, message);
        } catch (error) {
          logger.error('Main', 'Failed to send cluster alert', error as Error);
        }
      });

      enhancedClusterDetector.on('sybilAttack', async (attack: SybilAttack) => {
        try {
          const message = formatSybilAttackAlert(attack);
          await telegramService.sendMessage(config.telegramChatId, message);
        } catch (error) {
          logger.error('Main', 'Failed to send Sybil attack alert', error as Error);
        }
      });

      // Periodic cleanup for cluster detector
      setInterval(() => {
        enhancedClusterDetector.cleanup();
      }, 24 * 60 * 60 * 1000); // Daily cleanup

      // Periodic cleanup for multi-timeframe analyzer
      setInterval(() => {
        multiTimeframeAnalyzer.cleanup();
      }, 24 * 60 * 60 * 1000); // Daily cleanup

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

      // Start learning orchestrator (continuous improvement from outcomes)
      learningOrchestrator.start();

      // Start ML auto-retrain scheduler (weekly model retraining)
      startAutoRetrainScheduler();
      logger.info('Main', 'ML auto-retrain scheduler started');
      logger.info('Main', 'Learning orchestrator started - bot will learn from results');

      // Initialize pattern detector (success pattern learning)
      await patternDetector.initialize();
      const patternStats = patternDetector.getOverallStats();
      logger.info('Main', `Pattern detector initialized (${patternStats.activePatterns} active patterns)`);

      // Start pattern update scheduler (daily pattern refresh)
      startPatternUpdateScheduler();
      logger.info('Main', 'Pattern update scheduler started');

      // Initialize leaderboard update job (runs every 6 hours)
      initLeaderboardJob();
      logger.info('Main', 'Leaderboard update job initialized');

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

    try {
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

      // Stop smart money monitor
      smartMoneyMonitor.stop();

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

      // Close database connection gracefully (with final backup)
      await database.close();

      console.log('✅ Bot stopped gracefully');
    } catch (error) {
      logger.error('Main', 'Error during shutdown', error as Error);
      throw error;
    }
  }
}

// Create and start the bot
const bot = new SolanaMemecoinBot();
bot.start().catch((error) => {
  console.error('💀 Fatal error:', error);
  process.exit(1);
});
