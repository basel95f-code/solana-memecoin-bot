/**
 * Wallet Comparison Telegram Commands
 */

import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { PublicKey } from '@solana/web3.js';
import { walletComparator } from '../../services/walletComparator';
import type { WalletComparison, LeaderboardComparison } from '../../services/walletComparator';
import { storageService } from '../../services/storage';

function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function truncateAddress(address: string, chars: number = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

function formatComparison(comparison: WalletComparison): string {
  let msg = '<b>📊 Wallet Comparison</b>\n\n';

  // Headers
  const label1 = comparison.wallet1.label || truncateAddress(comparison.wallet1.address, 6);
  const label2 = comparison.wallet2.label || truncateAddress(comparison.wallet2.address, 6);

  msg += `<b>Wallet 1:</b> ${label1}\n`;
  msg += `<b>Wallet 2:</b> ${label2}\n\n`;

  // Performance comparison
  msg += `📈 <b>Performance</b>\n`;
  
  const m1 = comparison.wallet1.metrics;
  const m2 = comparison.wallet2.metrics;

  if (m1 && m2) {
    msg += formatMetricRow('Win Rate', m1.winRate, m2.winRate, '%', comparison.performance.winRateDiff);
    msg += formatMetricRow('Total ROI', m1.totalRoi, m2.totalRoi, '%', comparison.performance.roiDiff, true);
    msg += formatMetricRow('Total P&L', m1.totalPnl, m2.totalPnl, ' SOL', comparison.performance.pnlDiff, true);
    msg += formatMetricRow('Profit Factor', m1.profitFactor, m2.profitFactor, 'x', comparison.performance.profitFactorDiff);
    msg += formatMetricRow('Total Trades', m1.totalTrades, m2.totalTrades, '');
    msg += '\n';

    // Winner
    const winnerIcon = comparison.performance.better === 'wallet1' ? '🥇' :
                      comparison.performance.better === 'wallet2' ? '🥈' : '🤝';
    
    let winner = '';
    if (comparison.performance.better === 'wallet1') winner = label1;
    else if (comparison.performance.better === 'wallet2') winner = label2;
    else winner = 'Similar Performance';

    msg += `${winnerIcon} <b>Better Performer: ${winner}</b>\n\n`;
  } else if (m1) {
    msg += `<i>Only Wallet 1 has performance data</i>\n\n`;
  } else if (m2) {
    msg += `<i>Only Wallet 2 has performance data</i>\n\n`;
  } else {
    msg += `<i>No performance data available for either wallet</i>\n\n`;
  }

  // Trading style
  msg += `🎯 <b>Trading Style</b>\n`;
  msg += `   ${label1}: ${formatStyle(comparison.tradingStyle.wallet1Style)}\n`;
  msg += `   ${label2}: ${formatStyle(comparison.tradingStyle.wallet2Style)}\n`;
  
  if (comparison.tradingStyle.similar) {
    msg += `   ✅ Similar styles\n`;
  } else {
    msg += `   ❌ Different styles\n`;
  }
  msg += `\n`;

  // Risk appetite
  msg += `⚖️ <b>Risk Appetite</b>\n`;
  msg += `   ${label1}: ${formatRisk(comparison.riskAppetite.wallet1Risk)}\n`;
  msg += `   ${label2}: ${formatRisk(comparison.riskAppetite.wallet2Risk)}\n`;
  
  if (comparison.riskAppetite.similar) {
    msg += `   ✅ Similar risk tolerance\n`;
  } else {
    msg += `   ❌ Different risk profiles\n`;
  }
  msg += `\n`;

  // Strategy similarity
  msg += `🔍 <b>Strategy Similarity: ${comparison.strategySimilarity.toFixed(0)}%</b>\n`;
  
  if (comparison.strategySimilarity >= 70) {
    msg += `   Very similar strategies\n`;
  } else if (comparison.strategySimilarity >= 50) {
    msg += `   Somewhat similar\n`;
  } else {
    msg += `   Different strategies\n`;
  }
  msg += `\n`;

  // Better for...
  msg += `🏆 <b>Better For:</b>\n`;
  msg += formatBetterFor('Consistency', comparison.betterFor.consistency, label1, label2);
  msg += formatBetterFor('Profitability', comparison.betterFor.profitability, label1, label2);
  msg += formatBetterFor('Risk Management', comparison.betterFor.riskManagement, label1, label2);

  return msg;
}

function formatMetricRow(
  name: string,
  val1: number,
  val2: number,
  suffix: string,
  diff?: number,
  showSign: boolean = false
): string {
  const sign1 = showSign && val1 > 0 ? '+' : '';
  const sign2 = showSign && val2 > 0 ? '+' : '';
  
  let row = `   ${name}:  ${sign1}${val1.toFixed(1)}${suffix}  vs  ${sign2}${val2.toFixed(1)}${suffix}`;
  
  if (diff !== undefined && Math.abs(diff) > 0.1) {
    const diffSign = diff > 0 ? '+' : '';
    row += ` (${diffSign}${diff.toFixed(1)}${suffix})`;
  }
  
  return row + '\n';
}

function formatBetterFor(
  metric: string,
  better: 'wallet1' | 'wallet2' | 'similar',
  label1: string,
  label2: string
): string {
  if (better === 'wallet1') {
    return `   ${metric}: <b>${label1}</b> ✅\n`;
  } else if (better === 'wallet2') {
    return `   ${metric}: <b>${label2}</b> ✅\n`;
  } else {
    return `   ${metric}: Similar 🤝\n`;
  }
}

function formatStyle(style: string): string {
  const formatted = style.replace(/_/g, ' ');
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function formatRisk(risk: string): string {
  return risk.charAt(0).toUpperCase() + risk.slice(1);
}

function formatLeaderComparison(comparison: LeaderboardComparison): string {
  let msg = '<b>📊 Compare with Leader</b>\n\n';

  const yourLabel = comparison.wallet.label || truncateAddress(comparison.wallet.address, 6);
  const leaderLabel = comparison.leader.label || truncateAddress(comparison.leader.address, 6);

  msg += `<b>Your Wallet:</b> ${yourLabel}`;
  if (comparison.wallet.rank) {
    msg += ` (Rank #${comparison.wallet.rank})`;
  }
  msg += `\n`;
  msg += `<b>Leader:</b> ${leaderLabel} (Rank #1)\n\n`;

  const m = comparison.wallet.metrics!;
  const l = comparison.leader.metrics!;

  // Performance gaps
  msg += `📈 <b>Performance Gap</b>\n`;
  msg += `   Win Rate: ${m.winRate.toFixed(1)}% vs ${l.winRate.toFixed(1)}% (${comparison.gaps.winRate > 0 ? '-' : '+'}${Math.abs(comparison.gaps.winRate).toFixed(1)}%)\n`;
  msg += `   Total ROI: ${m.totalRoi > 0 ? '+' : ''}${m.totalRoi.toFixed(1)}% vs ${l.totalRoi > 0 ? '+' : ''}${l.totalRoi.toFixed(1)}% (${comparison.gaps.roi > 0 ? '-' : '+'}${Math.abs(comparison.gaps.roi).toFixed(1)}%)\n`;
  msg += `   Profit Factor: ${m.profitFactor.toFixed(2)}x vs ${l.profitFactor.toFixed(2)}x (${comparison.gaps.profitFactor > 0 ? '-' : '+'}${Math.abs(comparison.gaps.profitFactor).toFixed(2)}x)\n\n`;

  // Strengths
  if (comparison.strengths.length > 0) {
    msg += `💪 <b>Your Strengths:</b>\n`;
    for (const strength of comparison.strengths) {
      msg += `   ✅ ${strength}\n`;
    }
    msg += `\n`;
  }

  // Areas to improve
  if (comparison.improvements.length > 0) {
    msg += `📚 <b>Areas to Improve:</b>\n`;
    for (const improvement of comparison.improvements) {
      msg += `   📌 ${improvement}\n`;
    }
  } else {
    msg += `🎉 <b>You're matching the leader!</b>\n`;
    msg += `Keep up the great work!`;
  }

  return msg;
}

export function registerCompareCommands(bot: Telegraf): void {
  // /compare [wallet1] [wallet2] - Compare two wallets
  bot.command('compare', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length < 2) {
      await ctx.replyWithHTML(
        `<b>📊 Wallet Comparison</b>\n\n` +
        `Usage:\n` +
        `<code>/compare [wallet1] [wallet2]</code>\n\n` +
        `Example:\n` +
        `<code>/compare 7xKX...3nFd 9aB4...2cF8</code>\n\n` +
        `Compares:\n` +
        `• Performance metrics\n` +
        `• Trading styles\n` +
        `• Risk appetite\n` +
        `• Strategy similarity\n\n` +
        `Or use <code>/vsleader [wallet]</code> to compare with leaderboard #1`
      );
      return;
    }

    const wallet1 = args[0];
    const wallet2 = args[1];

    if (!isValidSolanaAddress(wallet1)) {
      await ctx.replyWithHTML(`Invalid wallet 1 address.`);
      return;
    }

    if (!isValidSolanaAddress(wallet2)) {
      await ctx.replyWithHTML(`Invalid wallet 2 address.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`Comparing wallets...`);

    try {
      const comparison = await walletComparator.compareWallets(wallet1, wallet2);

      if (!comparison) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `<b>📊 Wallet Comparison</b>\n\n` +
          `Not enough data to compare these wallets.\n\n` +
          `Both wallets need at least 3 closed trades.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      const formatted = formatComparison(comparison);

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url('Wallet 1', `https://solscan.io/account/${wallet1}`)],
        [Markup.button.url('Wallet 2', `https://solscan.io/account/${wallet2}`)],
      ]);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        formatted,
        {
          parse_mode: 'HTML',
          ...keyboard,
        }
      );
    } catch (error) {
      console.error('Compare command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `Error comparing wallets. Please try again.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /vsleader [wallet] - Compare wallet against leaderboard #1
  bot.command('vsleader', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>📊 Compare with Leader</b>\n\n` +
        `Usage: <code>/vsleader [wallet]</code>\n\n` +
        `Compare any wallet against the leaderboard #1 to see:\n` +
        `• Performance gaps\n` +
        `• Areas to improve\n` +
        `• Your strengths\n\n` +
        `Example:\n` +
        `<code>/vsleader 7xKX...3nFd</code>`
      );
      return;
    }

    const walletAddress = args[0];

    if (!isValidSolanaAddress(walletAddress)) {
      await ctx.replyWithHTML(`Invalid wallet address.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`Comparing with leader...`);

    try {
      const comparison = await walletComparator.compareWithLeader(walletAddress);

      if (!comparison) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `<b>📊 Compare with Leader</b>\n\n` +
          `Not enough data.\n\n` +
          `Requirements:\n` +
          `• Wallet needs at least 3 closed trades\n` +
          `• Leaderboard must have at least 1 wallet`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      const formatted = formatLeaderComparison(comparison);

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', `refresh_vsleader_${walletAddress.slice(0, 12)}`)],
        [Markup.button.url('Your Wallet', `https://solscan.io/account/${walletAddress}`)],
        [Markup.button.url('Leader Wallet', `https://solscan.io/account/${comparison.leader.address}`)],
      ]);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        formatted,
        {
          parse_mode: 'HTML',
          ...keyboard,
        }
      );
    } catch (error) {
      console.error('VsLeader command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `Error comparing with leader. Please try again.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // Refresh vsleader callback
  bot.action(/^refresh_vsleader_(.+)$/, async (ctx) => {
    const partialAddress = ctx.match[1];
    
    await ctx.answerCbQuery('Refreshing...');

    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const wallets = storageService.getTrackedWallets(chatId);
    const wallet = wallets.find(w => w.address.startsWith(partialAddress));

    if (!wallet) {
      await ctx.answerCbQuery('Wallet not found');
      return;
    }

    try {
      const comparison = await walletComparator.compareWithLeader(wallet.address);
      
      if (!comparison) {
        await ctx.answerCbQuery('Not enough data');
        return;
      }

      const formatted = formatLeaderComparison(comparison);

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', `refresh_vsleader_${partialAddress}`)],
        [Markup.button.url('Your Wallet', `https://solscan.io/account/${wallet.address}`)],
        [Markup.button.url('Leader Wallet', `https://solscan.io/account/${comparison.leader.address}`)],
      ]);

      await ctx.editMessageText(formatted, {
        parse_mode: 'HTML',
        ...keyboard,
      });
    } catch (error) {
      await ctx.answerCbQuery('Refresh failed');
    }
  });
}
