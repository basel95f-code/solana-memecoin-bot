import type { Telegraf } from 'telegraf';
import { registerBasicCommands } from './basic';
import { registerAlertCommands } from './alerts';
import { registerFilterCommands } from './filters';
import { registerPresetCommands } from './presets';
import { registerPerformanceCommands } from './performance';
import { registerAnalysisCommands } from './analysis';
import { registerWatchlistCommands } from './watchlist';
import { registerGroupWatchlistCommands } from './groupwatchlist';
import { registerLeaderboardCommands } from './leaderboard';
import { registerAutoCommands } from '../middleware/autoTrigger';
import { registerPNLCommands } from './pnl';
import { registerAchievementCommands } from './achievements';
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
import type { supabaseDb } from '../../database/supabase-db';

export function registerAllCommands(bot: Telegraf, db?: typeof supabaseDb): void {
  // Register all command handlers
  registerGroupSetupCommand(bot);
  registerTopicSetupCommands(bot);
  registerMLManagerCommands(bot);
  registerCopyTradingCommands(bot);
  registerBasicCommands(bot);
  registerAlertCommands(bot);
  registerFilterCommands(bot);
  registerPresetCommands(bot);
  registerPerformanceCommands(bot);
  registerAnalysisCommands(bot);
  registerWatchlistCommands(bot);
  registerGroupWatchlistCommands(bot);
  registerLeaderboardCommands(bot);
  registerAutoCommands(bot);
  registerPNLCommands(bot);
  registerAchievementCommands(bot);
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
  // REDUCED: Telegram limits bots to 100 commands max
  // Only keeping essential core monitoring & analysis commands
  bot.telegram.setMyCommands([
    // ESSENTIAL: Basic Commands (Keep)
    { command: 'start', description: 'Welcome message' },
    { command: 'help', description: 'Show all commands' },
    { command: 'status', description: 'Bot status' },

    // ESSENTIAL: Core Token Analysis (Keep)
    { command: 'check', description: 'Full token analysis' },
    { command: 'scan', description: 'Quick safety scan' },
    { command: 'risk', description: 'Detailed risk breakdown' },
    { command: 'rug', description: 'Detailed RugCheck report' },
    { command: 'contract', description: 'Contract security analysis' },
    { command: 'honeypot', description: 'Quick honeypot check' },

    // ESSENTIAL: Watchlist Management (Keep)
    { command: 'watch', description: 'Add to watchlist' },
    { command: 'unwatch', description: 'Remove from watchlist' },
    { command: 'watchlist', description: 'Show watchlist' },

    // ESSENTIAL: Alerts (Keep core only)
    { command: 'alerts', description: 'Toggle alerts on/off' },
    { command: 'mute', description: 'Mute alerts temporarily' },
    { command: 'quiet', description: 'Set quiet hours' },

    // ESSENTIAL: Filters & Settings (Keep core only)
    { command: 'filter', description: 'Set filter profile' },
    { command: 'settings', description: 'Show all settings' },

    // ESSENTIAL: Discovery (Keep trending only)
    { command: 'trending', description: 'Trending tokens' },
    { command: 'new', description: 'New tokens' },
    { command: 'gainers', description: 'Top gainers' },
    { command: 'trending_established', description: 'Established trending tokens' },
    { command: 'gainers_established', description: 'Established gainers' },
    { command: 'losers_established', description: 'Established losers' },
    { command: 'volume_established', description: 'Established volume leaders' },

    // ESSENTIAL: Wallet Monitoring (Keep core only)
    { command: 'track', description: 'Track a wallet' },
    { command: 'untrack', description: 'Stop tracking wallet' },
    { command: 'wallets', description: 'List tracked wallets' },

    // ESSENTIAL: Advanced Monitoring (Keep core only)
    { command: 'monitor', description: 'Add token to monitoring' },
    { command: 'monitored', description: 'List monitored tokens' },

    // ESSENTIAL: Whale Activity (Keep core only)
    { command: 'whale', description: 'Whale timeline & patterns' },
    { command: 'whales', description: 'Track whale wallets' },

    // COMMENTED OUT: Advanced/ML Commands (Over limit - use help for full list)
    // { command: 'ml', description: 'ML model status' },
    // { command: 'mlstatus', description: 'ML system status & performance' },
    // { command: 'mlhistory', description: 'Model version history' },
    // { command: 'mltrain', description: 'Manual model retraining (admin)' },
    // { command: 'mlcompare', description: 'Compare model versions' },
    // { command: 'mlrollback', description: 'Rollback to previous model (admin)' },
    // { command: 'mlfeatures', description: 'Feature importance rankings' },
    // { command: 'mlreport', description: 'Detailed performance report' },

    // COMMENTED OUT: Portfolio Commands (Over limit)
    // { command: 'portfolio', description: 'View your portfolio' },
    // { command: 'buy', description: 'Add position' },
    // { command: 'sell', description: 'Record sale' },
    // { command: 'pnl', description: 'P&L summary' },

    // COMMENTED OUT: Backtesting Commands (Over limit)
    // { command: 'strategies', description: 'List backtest strategies' },
    // { command: 'backtest', description: 'Run a backtest' },
    // { command: 'btresults', description: 'Show backtest results' },
    // { command: 'newstrategy', description: 'Create custom strategy' },
    // { command: 'viewstrategy', description: 'View strategy details' },
    // { command: 'snapshots', description: 'Snapshot collection status' },

    // COMMENTED OUT: Trading Signals Commands (Over limit)
    // { command: 'signals', description: 'Active trading signals' },
    // { command: 'ack', description: 'Acknowledge a signal' },
    // { command: 'outcome', description: 'Record trade outcome' },
    // { command: 'webhook', description: 'Manage webhooks' },
    // { command: 'kelly', description: 'Kelly criterion position sizing' },
    // { command: 'correlation', description: 'Signal correlation analysis' },
    // { command: 'slack', description: 'Manage Slack webhooks' },
    // { command: 'rules', description: 'Custom alert rules' },

    // COMMENTED OUT: Copy Trading Commands (Over limit)
    // { command: 'track_wallet', description: 'Add wallet to copy trading watchlist' },
    // { command: 'untrack_wallet', description: 'Remove from copy trading watchlist' },
    // { command: 'wallet_stats', description: 'Detailed wallet performance stats' },
    // { command: 'top_wallets', description: 'Top performing wallets' },
    // { command: 'wallet_trades', description: 'Recent wallet trades' },
    // { command: 'copy_status', description: 'Copy trading monitor status' },

    // COMMENTED OUT: Smart Money & Advanced Analytics (Over limit)
    // { command: 'smartmoney', description: 'Smart money suggestions' },
    // { command: 'smstats', description: 'Smart money stats' },
    // { command: 'leaderboard', description: 'Top performing wallets' },
    // { command: 'profile', description: 'Wallet trading profile' },
    // { command: 'style', description: 'Find wallets by trading style' },
    // { command: 'clusters', description: 'Detect wallet clusters' },
    // { command: 'sybil', description: 'Check for Sybil attack' },
    // { command: 'compare', description: 'Compare two wallets' },
    // { command: 'vsleader', description: 'Compare vs leaderboard #1' },

    // COMMENTED OUT: Advanced Analysis Commands (Over limit)
    // { command: 'holders', description: 'Holder breakdown' },
    // { command: 'lp', description: 'LP info' },
    // { command: 'socials', description: 'Social links' },
    // { command: 'compare', description: 'Compare two tokens' },
    // { command: 'timeframe', description: 'Multi-timeframe token analysis' },
    // { command: 'anomalies', description: 'Show detected anomalies' },
    // { command: 'sentiment', description: 'Multi-platform sentiment settings' },
    // { command: 'scanner', description: 'Token scanner & filters' },
    // { command: 'learn', description: 'Learning system stats' },
    // { command: 'outcomes', description: 'Token outcomes' },
    // { command: 'patterns', description: 'View success/rug patterns' },
    // { command: 'pattern', description: 'Pattern details' },
    // { command: 'matchpatterns', description: 'Match token to patterns' },
    // { command: 'similartokens', description: 'Find similar successful tokens' },
    // { command: 'refreshpatterns', description: 'Rediscover patterns (admin)' },

    // COMMENTED OUT: Group Watchlist Commands (Over limit)
    // { command: 'groupwatch', description: 'Add to group watchlist' },
    // { command: 'groupunwatch', description: 'Remove from group watchlist' },
    // { command: 'groupwatchlist', description: 'Show group watchlist' },
    // { command: 'hotlist', description: 'Most active watched tokens' },

    // COMMENTED OUT: Group Leaderboard (Over limit)
    // { command: 'mystats', description: 'Your leaderboard stats' },

    // COMMENTED OUT: Preset Management (Over limit)
    // { command: 'presets', description: 'List saved presets' },
    // { command: 'save', description: 'Save current filters as preset' },
    // { command: 'load', description: 'Load a preset' },
    // { command: 'share', description: 'Share preset code' },
    // { command: 'import', description: 'Import preset from code' },

    // COMMENTED OUT: Advanced Settings (Over limit)
    // { command: 'priority', description: 'Set alert priority' },
    // { command: 'bl', description: 'Manage blacklist' },
    // { command: 'timezone', description: 'Set timezone' },
    // { command: 'performance', description: 'Performance dashboard' },
    // { command: 'winrate', description: 'Profile win rate details' },
    // { command: 'compare_profiles', description: 'Compare all profiles' },
    // { command: 'stats', description: 'Monitoring statistics' },
    // { command: 'diagnose', description: 'Quick token diagnosis' },
    // { command: 'wallet', description: 'Wallet activity' },
    // { command: 'health', description: 'Service health status' },
    // { command: 'meteora', description: 'Meteora DLMM monitor stats' },
    // { command: 'orca', description: 'Orca Whirlpool monitor stats' },
    // { command: 'dex_stats', description: 'Compare all DEX sources' },
    // { command: 'volume', description: 'Volume leaders' },
    // { command: 'losers', description: 'Top losers' },
    // { command: 'whaleactivity', description: 'Token whale activity' },
    // { command: 'accumulating', description: 'Active accumulation patterns' },
    // { command: 'distributing', description: 'Active distribution patterns' },
  ]).catch(err => console.error('Failed to set bot commands:', err));

  console.log('All Telegram commands registered');
}

// Re-export stats functions
export { incrementTokensAnalyzed, incrementAlertsSent } from './basic';
