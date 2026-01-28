import type { Telegraf } from 'telegraf';
import { registerBasicCommands } from './basic';
import { registerAlertCommands } from './alerts';
import { registerFilterCommands } from './filters';
import { registerPresetCommands } from './presets';
import { registerAnalysisCommands } from './analysis';
import { registerWatchlistCommands } from './watchlist';
import { registerDiscoveryCommands } from './discovery';
import { registerSettingsCommands } from './settings';
import { registerAdvancedCommands } from './advanced';
import { registerBlacklistCommands } from './blacklist';
import { registerWalletCommands } from './wallets';
import { registerBacktestCommands } from './backtest';
import { registerScamDetectionCommands } from './scamDetection';

export function registerAllCommands(bot: Telegraf): void {
  // Register all command handlers
  registerBasicCommands(bot);
  registerAlertCommands(bot);
  registerFilterCommands(bot);
  registerPresetCommands(bot);
  registerAnalysisCommands(bot);
  registerWatchlistCommands(bot);
  registerDiscoveryCommands(bot);
  registerSettingsCommands(bot);
  registerAdvancedCommands(bot);
  registerBlacklistCommands(bot);
  registerWalletCommands(bot);
  registerBacktestCommands(bot);
  registerScamDetectionCommands(bot);

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
    // Presets
    { command: 'presets', description: 'List saved presets' },
    { command: 'save', description: 'Save current filters as preset' },
    { command: 'load', description: 'Load a preset' },
    { command: 'share', description: 'Share preset code' },
    { command: 'import', description: 'Import preset from code' },
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
    // Backtesting
    { command: 'strategies', description: 'List backtest strategies' },
    { command: 'backtest', description: 'Run a backtest' },
    { command: 'btresults', description: 'Show backtest results' },
    { command: 'newstrategy', description: 'Create custom strategy' },
    { command: 'viewstrategy', description: 'View strategy details' },
    { command: 'snapshots', description: 'Snapshot collection status' },
    // Scam Detection
    { command: 'bundle', description: '🚨 Detect wallet bundles (sybil attacks)' },
    { command: 'funded', description: '💰 Trace wallet funding source' },
    { command: 'early_wallets', description: '🏁 Show early pump.fun buyers' },
    { command: 'twitter_reuse', description: '🐦 Check recycled Twitter accounts' },
    { command: 'common_traders', description: '🔗 Find wallet overlap' },
    { command: 'image_check', description: '🖼️ Detect logo reuse' },
  ]).catch(err => console.error('Failed to set bot commands:', err));

  console.log('All Telegram commands registered');
}

// Re-export stats functions
export { incrementTokensAnalyzed, incrementAlertsSent } from './basic';
