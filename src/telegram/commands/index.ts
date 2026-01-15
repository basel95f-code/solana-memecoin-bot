import { Telegraf } from 'telegraf';
import { registerBasicCommands } from './basic';
import { registerAlertCommands } from './alerts';
import { registerFilterCommands } from './filters';
import { registerAnalysisCommands } from './analysis';
import { registerWatchlistCommands } from './watchlist';
import { registerDiscoveryCommands } from './discovery';
import { registerSettingsCommands } from './settings';
import { registerAdvancedCommands } from './advanced';

export function registerAllCommands(bot: Telegraf): void {
  // Register all command handlers
  registerBasicCommands(bot);
  registerAlertCommands(bot);
  registerFilterCommands(bot);
  registerAnalysisCommands(bot);
  registerWatchlistCommands(bot);
  registerDiscoveryCommands(bot);
  registerSettingsCommands(bot);
  registerAdvancedCommands(bot);

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
  ]).catch(err => console.error('Failed to set bot commands:', err));

  console.log('All Telegram commands registered');
}

// Re-export stats functions
export { incrementTokensAnalyzed, incrementAlertsSent } from './basic';
