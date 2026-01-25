import type { Telegraf } from 'telegraf';
import { registerBasicCommands } from './basic';
import { registerAlertCommands } from './alerts';
import { registerFilterCommands } from './filters';
import { registerAnalysisCommands } from './analysis';
import { registerWatchlistCommands } from './watchlist';
import { registerGroupWatchlistCommands } from './groupwatchlist';
import { registerLeaderboardCommands } from './leaderboard';
import { registerDiscoveryCommands } from './discovery';
import { registerSettingsCommands } from './settings';
import { registerAdvancedCommands } from './advanced';
import { registerBlacklistCommands } from './blacklist';
import { registerWalletCommands } from './wallets';
import { registerBacktestCommands } from './backtest';
import { registerSignalCommands } from './signals';
import { registerMLCommands } from './ml';
import { registerSentimentCommands } from './sentiment';
import { registerRulesCommands } from './rules';
import { registerPortfolioCommands } from './portfolio';
import { registerScannerCommands } from './scanner';
import { registerLearningCommands } from './learning';
import { registerContractCommands } from './contract';
import { registerSmartMoneyCommands } from './smartmoney';
import { registerWhaleActivityCommands } from './whaleactivity';
import { registerWalletProfileCommands } from './walletprofile';
import { registerClusterCommands } from './clusters';
import { registerCompareCommands } from './compare';
import { registerTimeframeCommands } from './timeframe';
import { registerLiquidityCommands } from './liquidity';
import { registerGroupSetupCommand } from './groupsetup';
import { registerTopicSetupCommands } from './topicsetup';
import { registerMLManagerCommands } from './mlmanager';
import { registerDexStatsCommands } from './dexstats';
import { registerCopyTradingCommands } from './copytrading';
import { registerTwitterCommand } from './twitter';
import { registerInfluencersCommand } from './influencers';
import { registerSocialStatsCommand } from './social_stats';
import type { SupabaseDB } from '../../database/supabase-db';

export function registerAllCommands(bot: Telegraf, db?: SupabaseDB): void {
  // Register all command handlers
  registerGroupSetupCommand(bot);
  registerTopicSetupCommands(bot);
  registerMLManagerCommands(bot);
  registerCopyTradingCommands(bot);
  registerBasicCommands(bot);
  registerAlertCommands(bot);
  registerFilterCommands(bot);
  registerAnalysisCommands(bot);
  registerWatchlistCommands(bot);
  registerGroupWatchlistCommands(bot);
  registerLeaderboardCommands(bot);
  registerDiscoveryCommands(bot);
  registerSettingsCommands(bot);
  registerAdvancedCommands(bot);
  registerBlacklistCommands(bot);
  registerWalletCommands(bot);
  registerBacktestCommands(bot);
  registerSignalCommands(bot);
  registerMLCommands(bot);
  registerSentimentCommands(bot);
  registerRulesCommands(bot);
  registerPortfolioCommands(bot);
  registerScannerCommands(bot);
  registerLearningCommands(bot);
  registerContractCommands(bot);
  registerSmartMoneyCommands(bot);
  registerWhaleActivityCommands(bot);
  registerWalletProfileCommands(bot);
  registerClusterCommands(bot);
  registerCompareCommands(bot);
  registerTimeframeCommands(bot);
  registerLiquidityCommands(bot);
  registerDexStatsCommands(bot);

  // Social Media Integration (if db provided)
  if (db) {
    registerTwitterCommand(bot, db);
    registerInfluencersCommand(bot, db);
    registerSocialStatsCommand(bot, db);
  }

  // Set up bot commands menu
  bot.telegram.setMyCommands([
    // Basic
    { command: 'start', description: 'Welcome message' },
    { command: 'help', description: 'Show all commands' },
    { command: 'status', description: 'Bot status' },
    { command: 'stats', description: 'Monitoring statistics' },
    // Alerts
    { command: 'alerts', description: 'Toggle alerts on/off' },
    { command: 'mute', description: 'Mute alerts temporarily' },
    { command: 'quiet', description: 'Set quiet hours' },
    { command: 'priority', description: 'Set alert priority' },
    { command: 'bl', description: 'Manage blacklist' },
    // Filters
    { command: 'filter', description: 'Set filter profile' },
    { command: 'settings', description: 'Show all settings' },
    // Analysis
    { command: 'check', description: 'Full token analysis' },
    { command: 'scan', description: 'Quick safety scan' },
    { command: 'holders', description: 'Holder breakdown' },
    { command: 'lp', description: 'LP info' },
    { command: 'socials', description: 'Social links' },
    { command: 'compare', description: 'Compare two tokens' },
    { command: 'rug', description: 'Detailed RugCheck report' },
    { command: 'whales', description: 'Track whale wallets' },
    { command: 'risk', description: 'Detailed risk breakdown' },
    // Watchlist
    { command: 'watch', description: 'Add to watchlist' },
    { command: 'unwatch', description: 'Remove from watchlist' },
    { command: 'watchlist', description: 'Show watchlist' },
    // Group Watchlist
    { command: 'groupwatch', description: 'Add to group watchlist' },
    { command: 'groupunwatch', description: 'Remove from group watchlist' },
    { command: 'groupwatchlist', description: 'Show group watchlist' },
    { command: 'hotlist', description: 'Most active watched tokens' },
    // Leaderboard
    { command: 'leaderboard', description: 'Group leaderboard rankings' },
    { command: 'mystats', description: 'Your leaderboard stats' },
    // Discovery
    { command: 'trending', description: 'Trending tokens' },
    { command: 'new', description: 'New tokens' },
    { command: 'gainers', description: 'Top gainers' },
    { command: 'losers', description: 'Top losers' },
    { command: 'volume', description: 'Volume leaders' },
    // Settings
    { command: 'timezone', description: 'Set timezone' },
    { command: 'quiet', description: 'Set quiet hours' },
    // Advanced Monitoring
    { command: 'monitor', description: 'Add token to monitoring' },
    { command: 'unmonitor', description: 'Stop monitoring token' },
    { command: 'monitored', description: 'List monitored tokens' },
    { command: 'diagnose', description: 'Quick token diagnosis' },
    // Portfolio
    { command: 'portfolio', description: 'View your portfolio' },
    { command: 'buy', description: 'Add position' },
    { command: 'sell', description: 'Record sale' },
    { command: 'pnl', description: 'P&L summary' },
    // Wallet Tracking
    { command: 'track', description: 'Track a wallet' },
    { command: 'untrack', description: 'Stop tracking wallet' },
    { command: 'wallets', description: 'List tracked wallets' },
    { command: 'wallet', description: 'Wallet activity' },
    // Copy Trading
    { command: 'track_wallet', description: 'Add wallet to copy trading watchlist' },
    { command: 'untrack_wallet', description: 'Remove from copy trading watchlist' },
    { command: 'watchlist', description: 'Show copy trading watchlist' },
    { command: 'wallet_stats', description: 'Detailed wallet performance stats' },
    { command: 'top_wallets', description: 'Top performing wallets' },
    { command: 'wallet_trades', description: 'Recent wallet trades' },
    { command: 'copy_status', description: 'Copy trading monitor status' },
    // Smart Money
    { command: 'leaderboard', description: 'Top performing wallets' },
    { command: 'smstats', description: 'Smart money stats' },
    { command: 'smartmoney', description: 'Smart money suggestions' },
    // Whale Activity
    { command: 'whale', description: 'Whale timeline & patterns' },
    { command: 'whaleactivity', description: 'Token whale activity' },
    { command: 'accumulating', description: 'Active accumulation patterns' },
    { command: 'distributing', description: 'Active distribution patterns' },
    // Wallet Profiling
    { command: 'profile', description: 'Wallet trading profile' },
    { command: 'style', description: 'Find wallets by trading style' },
    // Cluster Detection
    { command: 'clusters', description: 'Detect wallet clusters' },
    { command: 'sybil', description: 'Check for Sybil attack' },
    // Wallet Comparison
    { command: 'compare', description: 'Compare two wallets' },
    { command: 'vsleader', description: 'Compare vs leaderboard #1' },
    // Multi-Timeframe Analysis
    { command: 'timeframe', description: 'Multi-timeframe token analysis' },
    { command: 'anomalies', description: 'Show detected anomalies' },
    // Backtesting
    { command: 'strategies', description: 'List backtest strategies' },
    { command: 'backtest', description: 'Run a backtest' },
    { command: 'btresults', description: 'Show backtest results' },
    { command: 'newstrategy', description: 'Create custom strategy' },
    { command: 'viewstrategy', description: 'View strategy details' },
    { command: 'snapshots', description: 'Snapshot collection status' },
    // Trading Signals
    { command: 'signals', description: 'Active trading signals' },
    { command: 'ack', description: 'Acknowledge a signal' },
    { command: 'outcome', description: 'Record trade outcome' },
    { command: 'webhook', description: 'Manage webhooks' },
    { command: 'kelly', description: 'Kelly criterion position sizing' },
    { command: 'correlation', description: 'Signal correlation analysis' },
    { command: 'slack', description: 'Manage Slack webhooks' },
    { command: 'rules', description: 'Custom alert rules' },
    // ML Training
    { command: 'ml', description: 'ML model status' },
    // ML Management
    { command: 'mlstatus', description: 'ML system status & performance' },
    { command: 'mlhistory', description: 'Model version history' },
    { command: 'mltrain', description: 'Manual model retraining (admin)' },
    { command: 'mlcompare', description: 'Compare model versions' },
    { command: 'mlrollback', description: 'Rollback to previous model (admin)' },
    { command: 'mlfeatures', description: 'Feature importance rankings' },
    { command: 'mlreport', description: 'Detailed performance report' },
    // Sentiment
    { command: 'sentiment', description: 'Multi-platform sentiment settings' },
    // Scanner
    { command: 'scanner', description: 'Token scanner & filters' },
    // Learning
    { command: 'learn', description: 'Learning system stats' },
    { command: 'outcomes', description: 'Token outcomes' },
    // Pattern Detection
    { command: 'patterns', description: 'View success/rug patterns' },
    { command: 'pattern', description: 'Pattern details' },
    { command: 'matchpatterns', description: 'Match token to patterns' },
    { command: 'similartokens', description: 'Find similar successful tokens' },
    { command: 'refreshpatterns', description: 'Rediscover patterns (admin)' },
    // Security
    { command: 'contract', description: 'Contract security analysis' },
    { command: 'honeypot', description: 'Quick honeypot check' },
    // Health
    { command: 'health', description: 'Service health status' },
    // DEX Stats
    { command: 'meteora', description: 'Meteora DLMM monitor stats' },
    { command: 'orca', description: 'Orca Whirlpool monitor stats' },
    { command: 'dex_stats', description: 'Compare all DEX sources' },
  ]).catch(err => console.error('Failed to set bot commands:', err));

  console.log('All Telegram commands registered');
}

// Re-export stats functions
export { incrementTokensAnalyzed, incrementAlertsSent } from './basic';
