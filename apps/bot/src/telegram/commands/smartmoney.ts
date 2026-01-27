/**
 * Smart Money Telegram Commands
 * Database-backed smart money tracking and learning system
 */

import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { smartMoneyLearner, type SmartMoneyWallet } from '../../services/smartMoneyLearner';
import { database as databaseService } from '../../database';
import { logger } from '../../utils/logger';
import { PublicKey } from '@solana/web3.js';

// ============================================
// Utility Functions
// ============================================

function truncateAddress(address: string, chars: number = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function formatWalletSummary(wallet: SmartMoneyWallet, rank?: number): string {
  let msg = '';

  if (rank) {
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
    msg += `${medal} `;
  }

  msg += `<b>${truncateAddress(wallet.wallet_address, 6)}</b>\n`;
  msg += `   💎 Rep: ${wallet.reputation_score}/100 | `;
  msg += `WR: ${wallet.win_rate.toFixed(1)}%\n`;
  msg += `   📊 Trades: ${wallet.total_trades} | `;
  msg += `P&L: ${wallet.total_profit_sol > 0 ? '+' : ''}${wallet.total_profit_sol.toFixed(2)} SOL\n`;

  return msg;
}

function formatDetailedWalletStats(wallet: SmartMoneyWallet): string {
  let msg = `<b>🧠 Smart Money Wallet</b>\n\n`;
  msg += `<code>${wallet.wallet_address}</code>\n\n`;

  // Reputation
  const repEmoji = wallet.reputation_score >= 80 ? '🟢' : wallet.reputation_score >= 60 ? '🟡' : '🔴';
  msg += `${repEmoji} <b>Reputation: ${wallet.reputation_score}/100</b>\n`;
  if (wallet.is_verified) msg += `✅ Verified\n`;
  if (wallet.is_suspicious) msg += `⚠️ Flagged as suspicious\n`;
  msg += `\n`;

  // Performance
  msg += `📊 <b>Performance</b>\n`;
  msg += `   Win Rate: ${wallet.win_rate.toFixed(1)}% (${wallet.winning_trades}W/${wallet.losing_trades}L)\n`;
  msg += `   Total Trades: ${wallet.total_trades}\n`;
  msg += `   Total P&L: ${wallet.total_profit_sol > 0 ? '+' : ''}${wallet.total_profit_sol.toFixed(2)} SOL\n`;
  msg += `\n`;

  // Trading statistics
  msg += `📈 <b>Trading Stats</b>\n`;
  msg += `   Avg Profit: +${wallet.average_profit_percent.toFixed(1)}%\n`;
  msg += `   Largest Win: +${wallet.largest_win_percent.toFixed(1)}%\n`;
  msg += `   Largest Loss: ${wallet.largest_loss_percent.toFixed(1)}%\n`;
  msg += `\n`;

  // Trading style
  msg += `🎨 <b>Trading Style</b>\n`;
  msg += `   Style: ${wallet.trading_style || 'Unknown'}\n`;
  msg += `   Avg Hold: ${wallet.average_hold_time_hours.toFixed(1)}h\n`;
  msg += `   Avg Entry Liq: $${wallet.average_entry_liquidity.toFixed(0)}\n`;
  msg += `   Risk Preference: ${wallet.preferred_risk_range || 'Unknown'}\n`;
  msg += `\n`;

  // Patterns
  if (wallet.common_entry_patterns) {
    try {
      const entryPatterns = JSON.parse(wallet.common_entry_patterns);
      if (entryPatterns.length > 0) {
        msg += `📥 <b>Entry Patterns</b>\n`;
        for (const pattern of entryPatterns.slice(0, 3)) {
          msg += `   • ${pattern.description} (${(pattern.frequency * 100).toFixed(0)}%)\n`;
        }
        msg += `\n`;
      }
    } catch {}
  }

  if (wallet.common_exit_patterns) {
    try {
      const exitPatterns = JSON.parse(wallet.common_exit_patterns);
      if (exitPatterns.length > 0) {
        msg += `📤 <b>Exit Patterns</b>\n`;
        for (const pattern of exitPatterns.slice(0, 3)) {
          msg += `   • ${pattern.description} (${(pattern.frequency * 100).toFixed(0)}%)\n`;
        }
        msg += `\n`;
      }
    } catch {}
  }

  // Metadata
  const firstTracked = new Date(wallet.first_tracked_at * 1000);
  const lastTrade = wallet.last_trade_at ? new Date(wallet.last_trade_at * 1000) : null;
  
  msg += `⏰ <b>Tracking Info</b>\n`;
  msg += `   First Tracked: ${firstTracked.toLocaleDateString()}\n`;
  if (lastTrade) {
    msg += `   Last Trade: ${lastTrade.toLocaleDateString()}\n`;
  }

  return msg;
}

// ============================================
// Command Handlers
// ============================================

export function registerSmartMoneyCommands(bot: Telegraf): void {
  
  // /followsmart <wallet> - Track a smart money wallet
  bot.command('followsmart', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Track Smart Money Wallet</b>\n\n` +
        `Usage: <code>/followsmart &lt;wallet_address&gt;</code>\n\n` +
        `Example:\n` +
        `<code>/followsmart 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU</code>\n\n` +
        `This will track the wallet's trades and alert you when they make moves.`
      );
      return;
    }

    const walletAddress = args[0];

    // Validate address
    if (!isValidSolanaAddress(walletAddress)) {
      await ctx.replyWithHTML('❌ Invalid Solana wallet address');
      return;
    }

    // Check if already tracked
    const isTracked = await smartMoneyLearner.isTracked(walletAddress);
    if (isTracked) {
      await ctx.replyWithHTML('⚠️ This wallet is already being tracked');
      return;
    }

    try {
      // Track wallet
      await smartMoneyLearner.trackWallet(walletAddress);

      // Get wallet info if available
      const wallet = await smartMoneyLearner.getWallet(walletAddress);

      let msg = `✅ <b>Now tracking wallet</b>\n\n`;
      msg += `<code>${walletAddress}</code>\n\n`;

      if (wallet && wallet.total_trades > 0) {
        msg += `📊 <b>Current Stats</b>\n`;
        msg += `   Reputation: ${wallet.reputation_score}/100\n`;
        msg += `   Win Rate: ${wallet.win_rate.toFixed(1)}%\n`;
        msg += `   Total Trades: ${wallet.total_trades}\n`;
        msg += `   Total P&L: ${wallet.total_profit_sol > 0 ? '+' : ''}${wallet.total_profit_sol.toFixed(2)} SOL\n\n`;
      } else {
        msg += `🆕 This wallet has no trade history yet.\n`;
        msg += `Trade data will be collected as activity is detected.\n\n`;
      }

      msg += `You'll receive alerts when this wallet makes moves!`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url('View on Solscan', `https://solscan.io/account/${walletAddress}`)],
      ]);

      await ctx.replyWithHTML(msg, keyboard);
    } catch (error) {
      logger.error('SmartMoneyCommands', 'Failed to follow wallet', error as Error);
      await ctx.replyWithHTML('❌ Failed to track wallet. Please try again.');
    }
  });

  // /unfollowsmart <wallet> - Untrack a wallet
  bot.command('unfollowsmart', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Untrack Smart Money Wallet</b>\n\n` +
        `Usage: <code>/unfollowsmart &lt;wallet_address&gt;</code>\n\n` +
        `Use <code>/smartwallets</code> to see all tracked wallets.`
      );
      return;
    }

    const walletAddress = args[0];

    // Validate address
    if (!isValidSolanaAddress(walletAddress)) {
      await ctx.replyWithHTML('❌ Invalid Solana wallet address');
      return;
    }

    // Check if tracked
    const isTracked = await smartMoneyLearner.isTracked(walletAddress);
    if (!isTracked) {
      await ctx.replyWithHTML('⚠️ This wallet is not being tracked');
      return;
    }

    try {
      await smartMoneyLearner.untrackWallet(walletAddress);
      await ctx.replyWithHTML(
        `✅ <b>Stopped tracking wallet</b>\n\n` +
        `<code>${walletAddress}</code>\n\n` +
        `Historical data has been preserved but alerts are disabled.`
      );
    } catch (error) {
      logger.error('SmartMoneyCommands', 'Failed to unfollow wallet', error as Error);
      await ctx.replyWithHTML('❌ Failed to untrack wallet. Please try again.');
    }
  });

  // /smartwallets - Show all tracked wallets
  bot.command('smartwallets', async (ctx: Context) => {
    try {
      const wallets = await smartMoneyLearner.getTopWallets(20);

      if (wallets.length === 0) {
        await ctx.replyWithHTML(
          `<b>🧠 Smart Money Wallets</b>\n\n` +
          `No wallets tracked yet.\n\n` +
          `Use <code>/followsmart &lt;address&gt;</code> to start tracking wallets.\n` +
          `Use <code>/autosmart</code> to auto-discover top performers.`
        );
        return;
      }

      let msg = `<b>🧠 Smart Money Wallets</b>\n`;
      msg += `<i>Top ${wallets.length} tracked wallets</i>\n\n`;

      for (let i = 0; i < wallets.length; i++) {
        msg += formatWalletSummary(wallets[i], i + 1);
        if (i < wallets.length - 1) msg += '\n';
      }

      msg += `\n<i>Use /smartstats &lt;address&gt; for detailed stats</i>`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', 'refresh_smartwallets')],
        [Markup.button.callback('📊 Stats', 'smartmoney_stats')],
      ]);

      await ctx.replyWithHTML(msg, keyboard);
    } catch (error) {
      logger.error('SmartMoneyCommands', 'Failed to show smart wallets', error as Error);
      await ctx.replyWithHTML('❌ Failed to load wallet data. Please try again.');
    }
  });

  // Refresh smart wallets callback
  bot.action('refresh_smartwallets', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');

    try {
      const wallets = await smartMoneyLearner.getTopWallets(20);

      let msg = `<b>🧠 Smart Money Wallets</b>\n`;
      msg += `<i>Top ${wallets.length} tracked wallets</i>\n\n`;

      for (let i = 0; i < wallets.length; i++) {
        msg += formatWalletSummary(wallets[i], i + 1);
        if (i < wallets.length - 1) msg += '\n';
      }

      msg += `\n<i>Use /smartstats &lt;address&gt; for detailed stats</i>`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', 'refresh_smartwallets')],
        [Markup.button.callback('📊 Stats', 'smartmoney_stats')],
      ]);

      await ctx.editMessageText(msg, {
        parse_mode: 'HTML',
        ...keyboard,
      });
    } catch (error) {
      logger.error('SmartMoneyCommands', 'Failed to refresh', error as Error);
      await ctx.answerCbQuery('Failed to refresh');
    }
  });

  // Smart money stats callback
  bot.action('smartmoney_stats', async (ctx) => {
    await ctx.answerCbQuery('Loading stats...');

    try {
      const stats = await smartMoneyLearner.getStats();

      let msg = `<b>📊 Smart Money System Stats</b>\n\n`;
      msg += `🎯 Total Wallets: ${stats.totalWallets}\n`;
      msg += `📈 Total Trades: ${stats.totalTrades}\n`;
      msg += `🔄 Open Trades: ${stats.openTrades}\n`;
      msg += `💯 Avg Win Rate: ${stats.avgWinRate.toFixed(1)}%\n`;
      msg += `⭐ Top Performers: ${stats.topPerformers}\n`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('« Back', 'refresh_smartwallets')],
      ]);

      await ctx.editMessageText(msg, {
        parse_mode: 'HTML',
        ...keyboard,
      });
    } catch (error) {
      logger.error('SmartMoneyCommands', 'Failed to show stats', error as Error);
      await ctx.answerCbQuery('Failed to load stats');
    }
  });

  // /smartstats <wallet> - Detailed wallet stats
  bot.command('smartstats', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Smart Money Wallet Stats</b>\n\n` +
        `Usage: <code>/smartstats &lt;wallet_address&gt;</code>\n\n` +
        `Example:\n` +
        `<code>/smartstats 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU</code>`
      );
      return;
    }

    const address = args[0];

    try {
      const walletStats = await smartMoneyLearner.getWalletStats(address);

      if (!walletStats) {
        await ctx.replyWithHTML(
          `❌ Wallet not found or not tracked.\n\n` +
          `Use <code>/followsmart ${address}</code> to start tracking.`
        );
        return;
      }

      const msg = formatDetailedWalletStats(walletStats.wallet);

      // Show recent trades
      let tradesMsg = `\n📜 <b>Recent Trades (Last 10)</b>\n`;
      
      if (walletStats.recentTrades.length === 0) {
        tradesMsg += `   No trades recorded yet\n`;
      } else {
        for (const trade of walletStats.recentTrades.slice(0, 10)) {
          const symbol = trade.token_symbol || trade.token_mint.slice(0, 8);
          const status = trade.status === 'open' ? '🟡' : trade.profit_percent && trade.profit_percent > 0 ? '🟢' : '🔴';
          
          tradesMsg += `${status} ${symbol}`;
          
          if (trade.status === 'closed') {
            tradesMsg += ` ${trade.profit_percent! > 0 ? '+' : ''}${trade.profit_percent!.toFixed(1)}%`;
            if (trade.hold_time_hours) {
              tradesMsg += ` (${trade.hold_time_hours.toFixed(1)}h)`;
            }
          } else {
            tradesMsg += ` (open)`;
          }
          
          tradesMsg += `\n`;
        }
      }

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url('View on Solscan', `https://solscan.io/account/${address}`)],
        [Markup.button.callback('🔄 Refresh', `refresh_stats_${address.slice(0, 16)}`)],
      ]);

      await ctx.replyWithHTML(msg + tradesMsg, keyboard);
    } catch (error) {
      logger.error('SmartMoneyCommands', 'Failed to show wallet stats', error as Error);
      await ctx.replyWithHTML('❌ Failed to load wallet stats. Please try again.');
    }
  });

  // /autosmart - Auto-discover smart wallets
  bot.command('autosmart', async (ctx: Context) => {
    await ctx.replyWithHTML(
      `<b>🔍 Auto-Discovery Started</b>\n\n` +
      `Analyzing recent successful tokens...\n` +
      `This may take a minute...`
    );

    try {
      // Get recent successful tokens from token_outcomes
      const db = databaseService.getDb();
      if (!db) {
        await ctx.replyWithHTML('❌ Database not available');
        return;
      }

      const result = db.exec(`
        SELECT * FROM token_outcomes
        WHERE outcome = 'pump' AND peak_price_multiplier >= 5
          AND discovered_at > ?
        ORDER BY peak_price_multiplier DESC
        LIMIT 20
      `, [Math.floor(Date.now() / 1000) - 7 * 86400]); // Last 7 days

      if (result.length === 0 || result[0].values.length === 0) {
        await ctx.replyWithHTML(
          `<b>🔍 Auto-Discovery Results</b>\n\n` +
          `No successful tokens found in the last 7 days.\n\n` +
          `The system needs more data to discover smart wallets.`
        );
        return;
      }

      const successfulTokens = result[0].values.map(row => {
        const token: any = {};
        result[0].columns.forEach((col, i) => {
          token[col] = row[i];
        });
        return token;
      });

      await ctx.replyWithHTML(
        `<b>🔍 Auto-Discovery Results</b>\n\n` +
        `Found ${successfulTokens.length} successful tokens (5x+)\n` +
        `Analyzing early buyers...\n\n` +
        `⚠️ <i>Note: Wallet analysis requires Solana RPC access and may take time.\i>` +
        `This feature is partially implemented.`
      );

      // TODO: Implement full auto-discovery
      // For each successful token:
      // 1. Get early holders
      // 2. Check if they exited profitably
      // 3. Track their other trades
      // 4. Calculate win rate
      // 5. Suggest wallets with 70%+ win rate

    } catch (error) {
      logger.error('SmartMoneyCommands', 'Auto-discovery failed', error as Error);
      await ctx.replyWithHTML('❌ Auto-discovery failed. Please try again later.');
    }
  });

  // /smartalerts on|off - Toggle smart money alerts
  bot.command('smartalerts', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Smart Money Alerts</b>\n\n` +
        `Usage: <code>/smartalerts &lt;on|off&gt;</code>\n\n` +
        `When enabled, you'll receive alerts when tracked smart money wallets make moves.`
      );
      return;
    }

    const action = args[0].toLowerCase();

    if (action !== 'on' && action !== 'off') {
      await ctx.replyWithHTML('❌ Invalid option. Use "on" or "off"');
      return;
    }

    try {
      const chatId = ctx.chat!.id.toString();
      const db = databaseService.getDb();
      if (!db) {
        await ctx.replyWithHTML('❌ Database not available');
        return;
      }

      const enabled = action === 'on' ? 1 : 0;

      // Update user or group settings
      if (ctx.chat!.type === 'private') {
        db.run(`
          INSERT INTO user_settings (user_id, username, enable_smart_money_alerts, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            enable_smart_money_alerts = ?,
            updated_at = ?
        `, [
          ctx.from!.id,
          ctx.from!.username || null,
          enabled,
          Math.floor(Date.now() / 1000),
          Math.floor(Date.now() / 1000),
          enabled,
          Math.floor(Date.now() / 1000)
        ]);
      } else {
        db.run(`
          UPDATE group_settings
          SET enable_smart_money_alerts = ?, updated_at = ?
          WHERE chat_id = ?
        `, [enabled, Math.floor(Date.now() / 1000), chatId]);
      }

      const emoji = enabled ? '✅' : '🔕';
      await ctx.replyWithHTML(
        `${emoji} <b>Smart Money Alerts ${action === 'on' ? 'Enabled' : 'Disabled'}</b>\n\n` +
        (enabled
          ? `You'll receive alerts when tracked wallets make moves.`
          : `You won't receive smart money alerts anymore.`)
      );
    } catch (error) {
      logger.error('SmartMoneyCommands', 'Failed to toggle alerts', error as Error);
      await ctx.replyWithHTML('❌ Failed to update settings. Please try again.');
    }
  });

  // Aliases
  bot.command('sfw', async (ctx: Context) => {
    // Alias for /smartwallets
    const wallets = await smartMoneyLearner.getTopWallets(20);

    if (wallets.length === 0) {
      await ctx.replyWithHTML(
        `<b>🧠 Smart Money Wallets</b>\n\n` +
        `No wallets tracked yet.\n\n` +
        `Use <code>/followsmart &lt;address&gt;</code> to start tracking wallets.\n` +
        `Use <code>/autosmart</code> to auto-discover top performers.`
      );
      return;
    }

    let msg = `<b>🧠 Smart Money Wallets</b>\n`;
    msg += `<i>Top ${wallets.length} tracked wallets</i>\n\n`;

    for (let i = 0; i < wallets.length; i++) {
      msg += formatWalletSummary(wallets[i], i + 1);
      if (i < wallets.length - 1) msg += '\n';
    }

    msg += `\n<i>Use /smartstats &lt;address&gt; for detailed stats</i>`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh', 'refresh_smartwallets')],
      [Markup.button.callback('📊 Stats', 'smartmoney_stats')],
    ]);

    await ctx.replyWithHTML(msg, keyboard);
  });

  bot.command('sms', async (ctx: Context) => {
    // Alias for /smartstats - forward to main handler
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const newText = text.replace('/sms', '/smartstats');
    
    // Create a new context with modified text
    if (ctx.message && 'text' in ctx.message) {
      (ctx.message as any).text = newText;
    }
    
    // Call the main handler (extract inline to avoid duplication)
    const args = newText.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Smart Money Wallet Stats</b>\n\n` +
        `Usage: <code>/smartstats &lt;wallet_address&gt;</code>\n\n` +
        `Example:\n` +
        `<code>/smartstats 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU</code>`
      );
      return;
    }

    const address = args[0];

    try {
      const walletStats = await smartMoneyLearner.getWalletStats(address);

      if (!walletStats) {
        await ctx.replyWithHTML(
          `❌ Wallet not found or not tracked.\n\n` +
          `Use <code>/followsmart ${address}</code> to start tracking.`
        );
        return;
      }

      const msg = formatDetailedWalletStats(walletStats.wallet);

      // Show recent trades
      let tradesMsg = `\n📜 <b>Recent Trades (Last 10)</b>\n`;
      
      if (walletStats.recentTrades.length === 0) {
        tradesMsg += `   No trades recorded yet\n`;
      } else {
        for (const trade of walletStats.recentTrades.slice(0, 10)) {
          const symbol = trade.token_symbol || trade.token_mint.slice(0, 8);
          const status = trade.status === 'open' ? '🟡' : trade.profit_percent && trade.profit_percent > 0 ? '🟢' : '🔴';
          
          tradesMsg += `${status} ${symbol}`;
          
          if (trade.status === 'closed') {
            tradesMsg += ` ${trade.profit_percent! > 0 ? '+' : ''}${trade.profit_percent!.toFixed(1)}%`;
            if (trade.hold_time_hours) {
              tradesMsg += ` (${trade.hold_time_hours.toFixed(1)}h)`;
            }
          } else {
            tradesMsg += ` (open)`;
          }
          
          tradesMsg += `\n`;
        }
      }

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url('View on Solscan', `https://solscan.io/account/${address}`)],
      ]);

      await ctx.replyWithHTML(msg + tradesMsg, keyboard);
    } catch (error) {
      logger.error('SmartMoneyCommands', 'Failed to show wallet stats', error as Error);
      await ctx.replyWithHTML('❌ Failed to load wallet stats. Please try again.');
    }
  });
}

/**
 * Format smart money alert for Telegram
 */
export function formatSmartMoneyAlertMessage(
  walletAddress: string,
  action: 'entry' | 'exit' | 'large_buy' | 'large_sell',
  tokenSymbol: string,
  tokenMint: string,
  solValue: number | undefined,
  price: number | undefined,
  walletReputation: number | undefined,
  walletWinRate: number | undefined
): string {
  const actionEmoji = action === 'entry' || action === 'large_buy' ? '🟢' : '🔴';
  const actionText = action === 'entry' ? 'BOUGHT' : action === 'exit' ? 'SOLD' : action === 'large_buy' ? 'LARGE BUY' : 'LARGE SELL';

  let msg = `${actionEmoji} <b>Smart Money Alert</b>\n\n`;
  msg += `💎 <b>Wallet: ${truncateAddress(walletAddress, 6)}</b>\n`;
  msg += `🪙 <b>${actionText}</b> ${tokenSymbol}\n\n`;

  if (solValue) {
    msg += `💵 Amount: ${solValue.toFixed(2)} SOL\n`;
  }

  if (price) {
    msg += `💰 Price: $${price.toFixed(8)}\n`;
  }

  msg += `\n`;

  if (walletReputation !== undefined) {
    const repEmoji = walletReputation >= 80 ? '🟢' : walletReputation >= 60 ? '🟡' : '🔴';
    msg += `${repEmoji} Reputation: ${walletReputation}/100\n`;
  }

  if (walletWinRate !== undefined) {
    msg += `📊 Win Rate: ${walletWinRate.toFixed(1)}%\n`;
  }

  msg += `\n`;
  msg += `<a href="https://dexscreener.com/solana/${tokenMint}">📈 Chart</a> | `;
  msg += `<a href="https://solscan.io/token/${tokenMint}">🔍 Token</a> | `;
  msg += `<a href="https://solscan.io/account/${walletAddress}">👤 Wallet</a>`;

  return msg;
}
