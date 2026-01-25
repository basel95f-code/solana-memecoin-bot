/**
 * Smart Money Telegram Commands
 */

import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { smartMoneyTracker } from '../../services/smartMoneyTracker';
import type { SmartMoneyMetrics } from '../../services/smartMoneyTracker';

function truncateAddress(address: string, chars: number = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

function formatMetrics(metrics: SmartMoneyMetrics, includeDetails: boolean = true): string {
  let msg = '';

  // Header with rank
  if (metrics.rank) {
    msg += `<b>#${metrics.rank} - ${metrics.label || truncateAddress(metrics.walletAddress, 6)}</b>\n`;
  } else {
    msg += `<b>${metrics.label || truncateAddress(metrics.walletAddress, 6)}</b>\n`;
  }

  msg += `<code>${truncateAddress(metrics.walletAddress, 8)}</code>\n\n`;

  // Key metrics
  msg += `📊 <b>Performance</b>\n`;
  msg += `   Win Rate: ${metrics.winRate.toFixed(1)}% (${metrics.wins}W/${metrics.losses}L)\n`;
  msg += `   Total ROI: ${metrics.totalRoi > 0 ? '+' : ''}${metrics.totalRoi.toFixed(1)}%\n`;
  msg += `   Total P&L: ${metrics.totalPnl > 0 ? '+' : ''}${metrics.totalPnl.toFixed(2)} SOL\n`;

  if (includeDetails) {
    // Recent performance
    msg += `\n💰 <b>Recent P&L</b>\n`;
    msg += `   Last 7 days: ${metrics.last7DaysPnl > 0 ? '+' : ''}${metrics.last7DaysPnl.toFixed(2)} SOL\n`;
    msg += `   Last 30 days: ${metrics.last30DaysPnl > 0 ? '+' : ''}${metrics.last30DaysPnl.toFixed(2)} SOL\n`;

    // Trading stats
    msg += `\n📈 <b>Stats</b>\n`;
    msg += `   Total Trades: ${metrics.totalTrades} (${metrics.closedTrades} closed, ${metrics.openTrades} open)\n`;
    msg += `   Avg Win: +${metrics.avgProfitPercent.toFixed(1)}%\n`;
    msg += `   Avg Loss: -${metrics.avgLossPercent.toFixed(1)}%\n`;
    msg += `   Profit Factor: ${metrics.profitFactor.toFixed(2)}x\n`;
    msg += `   Avg Hold: ${metrics.avgHoldDuration.toFixed(1)}h\n`;

    // Streaks
    msg += `\n🔥 <b>Streaks</b>\n`;
    const streakIcon = metrics.currentStreak > 0 ? '🟢' : metrics.currentStreak < 0 ? '🔴' : '⚪';
    const streakText = Math.abs(metrics.currentStreak);
    const streakType = metrics.currentStreak > 0 ? 'W' : metrics.currentStreak < 0 ? 'L' : '';
    msg += `   Current: ${streakIcon} ${streakText}${streakType}\n`;
    msg += `   Best Win: ${metrics.maxWinStreak}W\n`;
    msg += `   Worst Loss: ${metrics.maxLossStreak}L\n`;

    // Best/worst trades
    if (metrics.bestTrade) {
      msg += `\n⭐ <b>Best Trade</b>\n`;
      msg += `   ${metrics.bestTrade.tokenSymbol}: +${metrics.bestTrade.profitPercent.toFixed(1)}% (+${metrics.bestTrade.profit.toFixed(2)} SOL)\n`;
    }

    if (metrics.worstTrade) {
      msg += `\n💀 <b>Worst Trade</b>\n`;
      msg += `   ${metrics.worstTrade.tokenSymbol}: ${metrics.worstTrade.lossPercent.toFixed(1)}% (${metrics.worstTrade.loss.toFixed(2)} SOL)\n`;
    }
  }

  return msg;
}

function formatLeaderboard(leaderboard: SmartMoneyMetrics[]): string {
  if (leaderboard.length === 0) {
    return (
      `<b>🏆 Smart Money Leaderboard</b>\n\n` +
      `No qualified wallets yet.\n\n` +
      `Wallets need at least 5 closed trades to appear on the leaderboard.\n\n` +
      `Use <code>/track [address] [label]</code> to start tracking wallets.`
    );
  }

  let msg = `<b>🏆 Smart Money Leaderboard</b>\n`;
  msg += `<i>Top performers by total ROI</i>\n\n`;

  for (const metrics of leaderboard) {
    const medal = metrics.rank === 1 ? '🥇' : metrics.rank === 2 ? '🥈' : metrics.rank === 3 ? '🥉' : `#${metrics.rank}`;
    
    msg += `${medal} <b>${metrics.label || truncateAddress(metrics.walletAddress, 6)}</b>\n`;
    msg += `   ROI: ${metrics.totalRoi > 0 ? '+' : ''}${metrics.totalRoi.toFixed(1)}% | `;
    msg += `WR: ${metrics.winRate.toFixed(0)}% | `;
    msg += `Trades: ${metrics.closedTrades}\n`;
    msg += `   P&L: ${metrics.totalPnl > 0 ? '+' : ''}${metrics.totalPnl.toFixed(2)} SOL\n\n`;
  }

  msg += `<i>Use /smstats [wallet] to see detailed metrics</i>`;

  return msg;
}

function formatSmartMoneyAlert(walletLabel: string, action: 'buy' | 'sell', tokenSymbol: string, solValue: number, winRate: number, roi: number): string {
  const actionEmoji = action === 'buy' ? '🟢' : '🔴';
  const actionText = action === 'buy' ? 'BOUGHT' : 'SOLD';

  let msg = `${actionEmoji} <b>Smart Money Alert</b>\n\n`;
  msg += `<b>${walletLabel}</b> ${actionText} ${tokenSymbol}\n\n`;
  msg += `💵 Value: ${solValue.toFixed(2)} SOL\n`;
  msg += `📊 Win Rate: ${winRate.toFixed(1)}%\n`;
  msg += `📈 Total ROI: ${roi > 0 ? '+' : ''}${roi.toFixed(1)}%\n\n`;
  msg += `<i>This wallet has a proven track record!</i>`;

  return msg;
}

export function registerSmartMoneyCommands(bot: Telegraf): void {
  // /leaderboard - Show top performing wallets
  bot.command('leaderboard', async (ctx: Context) => {
    const leaderboard = smartMoneyTracker.getLeaderboard(10);
    const formatted = formatLeaderboard(leaderboard);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh', 'refresh_leaderboard')],
      [Markup.button.callback('📊 Top 20', 'leaderboard_20')],
    ]);

    await ctx.replyWithHTML(formatted, keyboard);
  });

  // Refresh leaderboard callback
  bot.action('refresh_leaderboard', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');
    
    const leaderboard = smartMoneyTracker.getLeaderboard(10);
    const formatted = formatLeaderboard(leaderboard);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh', 'refresh_leaderboard')],
      [Markup.button.callback('📊 Top 20', 'leaderboard_20')],
    ]);

    await ctx.editMessageText(formatted, {
      parse_mode: 'HTML',
      ...keyboard,
    });
  });

  // Top 20 leaderboard callback
  bot.action('leaderboard_20', async (ctx) => {
    await ctx.answerCbQuery('Loading top 20...');
    
    const leaderboard = smartMoneyTracker.getLeaderboard(20);
    const formatted = formatLeaderboard(leaderboard);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh', 'refresh_leaderboard')],
      [Markup.button.callback('📊 Top 10', 'leaderboard_10')],
    ]);

    await ctx.editMessageText(formatted, {
      parse_mode: 'HTML',
      ...keyboard,
    });
  });

  // Top 10 leaderboard callback
  bot.action('leaderboard_10', async (ctx) => {
    await ctx.answerCbQuery('Loading top 10...');
    
    const leaderboard = smartMoneyTracker.getLeaderboard(10);
    const formatted = formatLeaderboard(leaderboard);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh', 'refresh_leaderboard')],
      [Markup.button.callback('📊 Top 20', 'leaderboard_20')],
    ]);

    await ctx.editMessageText(formatted, {
      parse_mode: 'HTML',
      ...keyboard,
    });
  });

  // /smstats - Show detailed stats for a wallet
  bot.command('smstats', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      // Show all tracked wallets' stats
      const allMetrics = smartMoneyTracker.getAllMetrics();

      if (allMetrics.length === 0) {
        await ctx.replyWithHTML(
          `<b>Smart Money Stats</b>\n\n` +
          `No wallet data yet.\n\n` +
          `Track wallets with <code>/track [address] [label]</code> and their trades will be monitored automatically.`
        );
        return;
      }

      // Sort by ROI
      allMetrics.sort((a, b) => b.totalRoi - a.totalRoi);

      let msg = `<b>📊 Smart Money Stats</b>\n\n`;

      for (const metrics of allMetrics.slice(0, 5)) {
        msg += formatMetrics(metrics, false);
        msg += `\n---\n\n`;
      }

      msg += `<i>Use /smstats [address] for detailed stats</i>`;

      await ctx.replyWithHTML(msg);
      return;
    }

    // Show stats for specific wallet
    const address = args[0];
    
    // Find wallet by partial address or label
    const allMetrics = smartMoneyTracker.getAllMetrics();
    const metrics = allMetrics.find(
      m => m.walletAddress === address || 
           m.walletAddress.startsWith(address) ||
           m.label?.toLowerCase().includes(address.toLowerCase())
    );

    if (!metrics) {
      await ctx.replyWithHTML(
        `Wallet not found.\n\n` +
        `Use <code>/smstats</code> to see all tracked wallets.`
      );
      return;
    }

    const formatted = formatMetrics(metrics, true);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('View on Solscan', `https://solscan.io/account/${metrics.walletAddress}`)],
    ]);

    await ctx.replyWithHTML(formatted, keyboard);
  });

  // /smartmoney - Show smart money suggestions
  bot.command('smartmoney', async (ctx: Context) => {
    const suggestions = await smartMoneyTracker.suggestWalletsToTrack();

    if (suggestions.length === 0) {
      await ctx.replyWithHTML(
        `<b>🧠 Smart Money Suggestions</b>\n\n` +
        `No high-performing wallets detected yet.\n\n` +
        `Smart money criteria:\n` +
        `• 10+ closed trades\n` +
        `• 65%+ win rate\n` +
        `• 100%+ total ROI\n` +
        `• 2x+ profit factor\n\n` +
        `Keep tracking wallets and the system will identify top performers!`
      );
      return;
    }

    let msg = `<b>🧠 Smart Money Suggestions</b>\n`;
    msg += `<i>High-performing wallets to track</i>\n\n`;

    for (const metrics of suggestions) {
      msg += `⭐ <b>${truncateAddress(metrics.walletAddress, 8)}</b>\n`;
      msg += `   ROI: +${metrics.totalRoi.toFixed(1)}% | WR: ${metrics.winRate.toFixed(0)}%\n`;
      msg += `   Trades: ${metrics.closedTrades} | PF: ${metrics.profitFactor.toFixed(1)}x\n`;
      msg += `   /track ${metrics.walletAddress.slice(0, 12)}... Smart Money #${suggestions.indexOf(metrics) + 1}\n\n`;
    }

    msg += `<i>Use the /track command to start copying these wallets!</i>`;

    await ctx.replyWithHTML(msg);
  });

  // Alias commands
  bot.command('lb', async (ctx: Context) => {
    await ctx.telegram.sendMessage(ctx.chat!.id, '/leaderboard');
    const leaderboard = smartMoneyTracker.getLeaderboard(10);
    const formatted = formatLeaderboard(leaderboard);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh', 'refresh_leaderboard')],
      [Markup.button.callback('📊 Top 20', 'leaderboard_20')],
    ]);

    await ctx.replyWithHTML(formatted, keyboard);
  });

  bot.command('sm', async (ctx: Context) => {
    await ctx.telegram.sendMessage(ctx.chat!.id, '/smartmoney');
    const suggestions = await smartMoneyTracker.suggestWalletsToTrack();

    if (suggestions.length === 0) {
      await ctx.replyWithHTML(
        `<b>🧠 Smart Money Suggestions</b>\n\n` +
        `No high-performing wallets detected yet.\n\n` +
        `Smart money criteria:\n` +
        `• 10+ closed trades\n` +
        `• 65%+ win rate\n` +
        `• 100%+ total ROI\n` +
        `• 2x+ profit factor\n\n` +
        `Keep tracking wallets and the system will identify top performers!`
      );
      return;
    }

    let msg = `<b>🧠 Smart Money Suggestions</b>\n`;
    msg += `<i>High-performing wallets to track</i>\n\n`;

    for (const metrics of suggestions) {
      msg += `⭐ <b>${truncateAddress(metrics.walletAddress, 8)}</b>\n`;
      msg += `   ROI: +${metrics.totalRoi.toFixed(1)}% | WR: ${metrics.winRate.toFixed(0)}%\n`;
      msg += `   Trades: ${metrics.closedTrades} | PF: ${metrics.profitFactor.toFixed(1)}x\n`;
      msg += `   /track ${metrics.walletAddress.slice(0, 12)}... Smart Money #${suggestions.indexOf(metrics) + 1}\n\n`;
    }

    msg += `<i>Use the /track command to start copying these wallets!</i>`;

    await ctx.replyWithHTML(msg);
  });
}

/**
 * Format smart money alert for Telegram
 */
export function formatSmartMoneyAlertMessage(
  walletLabel: string,
  action: 'buy' | 'sell',
  tokenSymbol: string,
  tokenMint: string,
  solValue: number,
  priceUsd: number | undefined,
  winRate: number,
  roi: number,
  last30DaysPnl: number
): string {
  const actionEmoji = action === 'buy' ? '🟢 BUY' : '🔴 SELL';

  let msg = `${actionEmoji} <b>Smart Money Alert</b>\n\n`;
  msg += `👤 <b>${walletLabel}</b>\n`;
  msg += `🪙 Token: ${tokenSymbol}\n`;
  msg += `💵 Value: ${solValue.toFixed(2)} SOL`;
  
  if (priceUsd) {
    msg += ` (~$${priceUsd.toFixed(2)})`;
  }
  
  msg += `\n\n`;

  msg += `📊 <b>Wallet Performance</b>\n`;
  msg += `   Win Rate: ${winRate.toFixed(1)}%\n`;
  msg += `   Total ROI: ${roi > 0 ? '+' : ''}${roi.toFixed(1)}%\n`;
  msg += `   30d P&L: ${last30DaysPnl > 0 ? '+' : ''}${last30DaysPnl.toFixed(2)} SOL\n\n`;

  msg += `<a href="https://dexscreener.com/solana/${tokenMint}">📈 Chart</a> | `;
  msg += `<a href="https://solscan.io/token/${tokenMint}">🔍 Token</a>`;

  return msg;
}
