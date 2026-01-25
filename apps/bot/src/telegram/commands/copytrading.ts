/**
 * Copy Trading Commands
 * Telegram commands for wallet tracking and copy trading alerts
 */

import { Telegraf, Context } from 'telegraf';
import { walletTracker } from '../../services/walletTracker';
import { walletTransactionMonitor } from '../../monitors/walletTransactions';
import { logger } from '../../utils/logger';
import { PublicKey } from '@solana/web3.js';

// ============================================
// Helper Functions
// ============================================

/**
 * Validate Solana address
 */
function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format wallet address for display
 */
function formatAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/**
 * Format number with commas
 */
function formatNumber(num: number, decimals = 2): string {
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format SOL amount
 */
function formatSOL(amount: number): string {
  return `${formatNumber(amount, 3)} SOL`;
}

/**
 * Format USD amount
 */
function formatUSD(amount: number): string {
  return `$${formatNumber(amount, 2)}`;
}

/**
 * Get emoji for win rate
 */
function getWinRateEmoji(winRate: number): string {
  if (winRate >= 70) return '🔥';
  if (winRate >= 60) return '✅';
  if (winRate >= 50) return '⚖️';
  if (winRate >= 40) return '⚠️';
  return '❌';
}

/**
 * Get emoji for profit
 */
function getProfitEmoji(profit: number): string {
  if (profit > 1000) return '💎';
  if (profit > 100) return '💰';
  if (profit > 0) return '✅';
  if (profit === 0) return '➖';
  return '📉';
}

// ============================================
// Command: /track_wallet
// ============================================

export async function trackWalletCommand(ctx: Context): Promise<void> {
  try {
    const args = ctx.message && 'text' in ctx.message ? ctx.message.text.split(' ').slice(1) : [];
    
    if (args.length === 0) {
      await ctx.reply(
        '❌ *Usage:* `/track_wallet <address> [label]`\n\n' +
        '*Example:*\n' +
        '`/track_wallet 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU SmartTrader`\n\n' +
        'Add a wallet to your watchlist to get real-time alerts when they trade.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const address = args[0];
    const label = args.slice(1).join(' ') || undefined;

    // Validate address
    if (!isValidSolanaAddress(address)) {
      await ctx.reply('❌ Invalid Solana wallet address');
      return;
    }

    // Add to tracking
    const wallet = await walletTracker.trackWallet(address, {
      label,
      userId: ctx.from?.id,
      username: ctx.from?.username,
      source: 'manual',
    });

    await ctx.reply(
      `✅ *Wallet Added to Watchlist*\n\n` +
      `📍 *Address:* \`${address}\`\n` +
      `🏷️ *Label:* ${label || 'None'}\n` +
      `👤 *Added by:* @${ctx.from?.username || 'Unknown'}\n\n` +
      `You'll receive alerts when this wallet trades.\n\n` +
      `Use /wallet_stats ${formatAddress(address)} to view performance.`,
      { parse_mode: 'Markdown' }
    );

    logger.info('CopyTrading', `User @${ctx.from?.username} tracked wallet: ${formatAddress(address)}`);
  } catch (error) {
    logger.error('CopyTrading', 'track_wallet command failed', error as Error);
    
    if (error instanceof Error && error.message.includes('already tracked')) {
      await ctx.reply('⚠️ This wallet is already in your watchlist.');
    } else {
      await ctx.reply('❌ Failed to add wallet. Please try again.');
    }
  }
}

// ============================================
// Command: /untrack_wallet
// ============================================

export async function untrackWalletCommand(ctx: Context): Promise<void> {
  try {
    const args = ctx.message && 'text' in ctx.message ? ctx.message.text.split(' ').slice(1) : [];
    
    if (args.length === 0) {
      await ctx.reply(
        '❌ *Usage:* `/untrack_wallet <address>`\n\n' +
        '*Example:*\n' +
        '`/untrack_wallet 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const address = args[0];

    // Validate address
    if (!isValidSolanaAddress(address)) {
      await ctx.reply('❌ Invalid Solana wallet address');
      return;
    }

    // Check if tracked
    const wallet = await walletTracker.getTrackedWallet(address);
    if (!wallet) {
      await ctx.reply('❌ This wallet is not in your watchlist.');
      return;
    }

    // Remove from tracking
    await walletTracker.untrackWallet(address);

    await ctx.reply(
      `✅ *Wallet Removed from Watchlist*\n\n` +
      `📍 *Address:* \`${address}\`\n` +
      `🏷️ *Label:* ${wallet.label || 'None'}\n\n` +
      `You will no longer receive alerts for this wallet.`,
      { parse_mode: 'Markdown' }
    );

    logger.info('CopyTrading', `User @${ctx.from?.username} untracked wallet: ${formatAddress(address)}`);
  } catch (error) {
    logger.error('CopyTrading', 'untrack_wallet command failed', error as Error);
    await ctx.reply('❌ Failed to remove wallet. Please try again.');
  }
}

// ============================================
// Command: /watchlist
// ============================================

export async function watchlistCommand(ctx: Context): Promise<void> {
  try {
    const wallets = await walletTracker.getAllTrackedWallets(true);

    if (wallets.length === 0) {
      await ctx.reply(
        '📋 *Your Watchlist is Empty*\n\n' +
        'Add wallets to track using:\n' +
        '`/track_wallet <address> [label]`\n\n' +
        'Or discover top performers:\n' +
        '`/top_wallets`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let message = '📋 *Your Tracked Wallets*\n\n';

    for (const wallet of wallets.slice(0, 20)) {
      const winRateEmoji = getWinRateEmoji(wallet.win_rate);
      const profitEmoji = getProfitEmoji(wallet.total_profit_sol);
      
      message += `${profitEmoji} *${wallet.label || formatAddress(wallet.wallet_address)}*\n`;
      message += `   📍 \`${formatAddress(wallet.wallet_address)}\`\n`;
      message += `   ${winRateEmoji} Win Rate: ${wallet.win_rate.toFixed(1)}% | `;
      message += `Score: ${wallet.score.toFixed(0)}/100\n`;
      message += `   📊 Trades: ${wallet.total_trades} | `;
      message += `Profit: ${formatSOL(wallet.total_profit_sol)}\n\n`;
    }

    if (wallets.length > 20) {
      message += `\n_...and ${wallets.length - 20} more wallets_\n`;
    }

    message += `\n💡 Use /wallet_stats <address> to see detailed performance.`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('CopyTrading', 'watchlist command failed', error as Error);
    await ctx.reply('❌ Failed to load watchlist. Please try again.');
  }
}

// ============================================
// Command: /wallet_stats
// ============================================

export async function walletStatsCommand(ctx: Context): Promise<void> {
  try {
    const args = ctx.message && 'text' in ctx.message ? ctx.message.text.split(' ').slice(1) : [];
    
    if (args.length === 0) {
      await ctx.reply(
        '❌ *Usage:* `/wallet_stats <address>`\n\n' +
        '*Example:*\n' +
        '`/wallet_stats 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const address = args[0];

    // Validate address
    if (!isValidSolanaAddress(address)) {
      await ctx.reply('❌ Invalid Solana wallet address');
      return;
    }

    // Get wallet stats
    const stats = await walletTracker.getWalletStats(address);

    if (!stats) {
      await ctx.reply('❌ Wallet not found in tracking system. Use `/track_wallet` to add it.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const { wallet, performance, summary } = stats;

    let message = `📊 *Wallet Performance Report*\n\n`;
    message += `🏷️ *Label:* ${wallet.label || 'None'}\n`;
    message += `📍 *Address:* \`${formatAddress(address)}\`\n`;
    message += `🎯 *Score:* ${wallet.score.toFixed(0)}/100\n\n`;

    if (performance && performance.total_trades > 0) {
      // Trading Statistics
      message += `━━━━━━━━━━━━━━━━━━━━\n`;
      message += `📈 *Trading Statistics*\n\n`;
      message += `📊 Total Trades: ${performance.total_trades}\n`;
      message += `   ├ Buys: ${performance.total_buys}\n`;
      message += `   └ Sells: ${performance.total_sells}\n\n`;

      // Win/Loss
      const winRateEmoji = getWinRateEmoji(performance.win_rate);
      message += `${winRateEmoji} *Win Rate:* ${performance.win_rate.toFixed(1)}%\n`;
      message += `   ├ Winning: ${performance.winning_trades}\n`;
      message += `   └ Losing: ${performance.losing_trades}\n\n`;

      // Profit
      const profitEmoji = getProfitEmoji(performance.total_profit_usd);
      message += `${profitEmoji} *Total Profit:* ${formatUSD(performance.total_profit_usd)}\n`;
      message += `   ├ Avg Profit: ${performance.average_profit_percent.toFixed(1)}%\n`;
      message += `   ├ Largest Win: +${performance.largest_win_percent.toFixed(1)}%\n`;
      message += `   └ Largest Loss: ${performance.largest_loss_percent.toFixed(1)}%\n\n`;

      // Trading Style
      message += `⏱️ *Trading Style:* ${summary.tradingStyle.charAt(0).toUpperCase() + summary.tradingStyle.slice(1)}\n`;
      message += `   ├ Avg Hold: ${performance.average_hold_time_hours.toFixed(1)}h\n`;
      message += `   └ Trades/Day: ${performance.trades_per_day.toFixed(1)}\n\n`;

      // Activity
      message += `📅 *Activity:* ${performance.active_days} days\n`;
      if (performance.first_trade_at) {
        message += `   └ Since: ${new Date(performance.first_trade_at).toLocaleDateString()}\n\n`;
      }

      // Risk & Recommendation
      message += `━━━━━━━━━━━━━━━━━━━━\n`;
      message += `🎯 *Risk Level:* ${summary.riskLevel.toUpperCase()}\n`;
      message += `💡 *Recommendation:*\n${summary.recommendation}\n`;
    } else {
      message += `⚠️ *No trading history available yet.*\n\n`;
      message += `This wallet is being monitored. Statistics will appear after trades are detected.`;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('CopyTrading', 'wallet_stats command failed', error as Error);
    await ctx.reply('❌ Failed to load wallet stats. Please try again.');
  }
}

// ============================================
// Command: /top_wallets
// ============================================

export async function topWalletsCommand(ctx: Context): Promise<void> {
  try {
    const topWallets = await walletTracker.getTopWallets(10);

    if (topWallets.length === 0) {
      await ctx.reply(
        '📊 *No Wallets Tracked Yet*\n\n' +
        'Add wallets to discover top performers:\n' +
        '`/track_wallet <address> [label]`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let message = '🏆 *Top Performing Wallets*\n\n';
    message += '_Sorted by overall score_\n\n';

    for (let i = 0; i < topWallets.length; i++) {
      const wallet = topWallets[i];
      const rank = i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
      
      const winRateEmoji = getWinRateEmoji(wallet.win_rate);
      const profitEmoji = getProfitEmoji(wallet.total_profit_sol);

      message += `${medal} *${wallet.label || formatAddress(wallet.wallet_address)}*\n`;
      message += `   Score: ${wallet.score.toFixed(0)}/100 | `;
      message += `${winRateEmoji} ${wallet.win_rate.toFixed(0)}% WR | `;
      message += `${wallet.total_trades} trades\n`;
      message += `   ${profitEmoji} Profit: ${formatSOL(wallet.total_profit_sol)}\n`;
      message += `   📍 \`${formatAddress(wallet.wallet_address)}\`\n\n`;
    }

    message += `\n💡 Use /wallet_stats <address> for detailed analysis.`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('CopyTrading', 'top_wallets command failed', error as Error);
    await ctx.reply('❌ Failed to load top wallets. Please try again.');
  }
}

// ============================================
// Command: /wallet_trades
// ============================================

export async function walletTradesCommand(ctx: Context): Promise<void> {
  try {
    const args = ctx.message && 'text' in ctx.message ? ctx.message.text.split(' ').slice(1) : [];
    
    if (args.length === 0) {
      await ctx.reply(
        '❌ *Usage:* `/wallet_trades <address> [limit]`\n\n' +
        '*Example:*\n' +
        '`/wallet_trades 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 10`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const address = args[0];
    const limit = args[1] ? parseInt(args[1]) : 10;

    // Validate address
    if (!isValidSolanaAddress(address)) {
      await ctx.reply('❌ Invalid Solana wallet address');
      return;
    }

    // Get transactions
    const transactions = await walletTracker.getWalletTransactions(address, Math.min(limit, 20));

    if (transactions.length === 0) {
      await ctx.reply('📊 No transactions found for this wallet yet.');
      return;
    }

    let message = `📊 *Recent Trades - ${formatAddress(address)}*\n\n`;

    for (const tx of transactions) {
      const actionEmoji = tx.action === 'buy' ? '🟢' : '🔴';
      const profitEmoji = tx.profit_percent && tx.profit_percent > 0 ? '📈' : tx.profit_percent && tx.profit_percent < 0 ? '📉' : '';
      
      message += `${actionEmoji} *${tx.action.toUpperCase()}* ${tx.token_symbol || formatAddress(tx.token_mint)}\n`;
      message += `   ${formatNumber(tx.amount)} tokens`;
      if (tx.value_usd) {
        message += ` (${formatUSD(tx.value_usd)})`;
      }
      message += `\n`;

      if (tx.profit_percent !== null && tx.action === 'sell') {
        message += `   ${profitEmoji} P/L: ${tx.profit_percent > 0 ? '+' : ''}${tx.profit_percent.toFixed(1)}%`;
        if (tx.hold_duration_hours) {
          message += ` (${tx.hold_duration_hours.toFixed(1)}h hold)`;
        }
        message += `\n`;
      }

      if (tx.dex_protocol) {
        message += `   📍 ${tx.dex_protocol}`;
      }
      message += ` | ${new Date(tx.block_time).toLocaleString()}\n\n`;
    }

    message += `\n🔍 [View on Solscan](https://solscan.io/account/${address})`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('CopyTrading', 'wallet_trades command failed', error as Error);
    await ctx.reply('❌ Failed to load wallet trades. Please try again.');
  }
}

// ============================================
// Command: /copy_status
// ============================================

export async function copyStatusCommand(ctx: Context): Promise<void> {
  try {
    const status = walletTransactionMonitor.getStatus();
    const allWallets = await walletTracker.getAllTrackedWallets(true);

    let message = '🔄 *Copy Trading Monitor Status*\n\n';
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    message += `📊 *System Status*\n\n`;
    message += `🟢 Monitor: ${status.isRunning ? 'Running' : 'Stopped'}\n`;
    message += `👁️ Tracked Wallets: ${status.trackedWallets}\n`;
    message += `📡 Active Subscriptions: ${status.activeSubscriptions}\n`;
    message += `📝 Seen Signatures: ${status.seenSignatures.toLocaleString()}\n\n`;

    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    message += `📋 *Your Watchlist*\n\n`;
    message += `Total: ${allWallets.length} wallets\n`;
    message += `Active: ${allWallets.filter(w => w.is_active).length}\n`;
    message += `With 5+ trades: ${allWallets.filter(w => w.total_trades >= 5).length}\n\n`;

    if (allWallets.length > 0) {
      const avgScore = allWallets.reduce((sum, w) => sum + w.score, 0) / allWallets.length;
      const avgWinRate = allWallets.reduce((sum, w) => sum + w.win_rate, 0) / allWallets.length;
      
      message += `📈 Avg Score: ${avgScore.toFixed(0)}/100\n`;
      message += `🎯 Avg Win Rate: ${avgWinRate.toFixed(1)}%\n`;
    }

    message += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    message += `💡 Use /watchlist to see all tracked wallets\n`;
    message += `💡 Use /top_wallets to see best performers`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('CopyTrading', 'copy_status command failed', error as Error);
    await ctx.reply('❌ Failed to load status. Please try again.');
  }
}

// ============================================
// Register Commands
// ============================================

export function registerCopyTradingCommands(bot: Telegraf): void {
  bot.command('track_wallet', trackWalletCommand);
  bot.command('untrack_wallet', untrackWalletCommand);
  bot.command('watchlist', watchlistCommand);
  bot.command('wallet_stats', walletStatsCommand);
  bot.command('top_wallets', topWalletsCommand);
  bot.command('wallet_trades', walletTradesCommand);
  bot.command('copy_status', copyStatusCommand);

  logger.info('CopyTrading', 'Copy trading commands registered');
}
