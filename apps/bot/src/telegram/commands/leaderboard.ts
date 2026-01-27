/**
 * Group Leaderboard Commands
 * Commands for tracking calls and displaying leaderboards
 */

import type { Context, Telegraf } from 'telegraf';
import { groupLeaderboard } from '../../services/groupLeaderboard';
import { logger } from '../../utils/logger';

/**
 * Format leaderboard display
 */
function formatLeaderboard(entries: any[], timeframe: string): string {
  if (entries.length === 0) {
    return `📊 <b>Leaderboard (${timeframe})</b>\n\nNo calls yet! Be the first to call a token with /call`;
  }

  let message = `📊 <b>Leaderboard (${timeframe})</b>\n\n`;

  entries.forEach((entry, index) => {
    const tierEmoji = entry.tier.split(' ')[0];
    const username = entry.username || `User ${entry.userId.slice(-4)}`;
    const hitRate = entry.hitRate.toFixed(0);
    
    message += `${entry.rank}. ${tierEmoji} <b>${username}</b>\n`;
    message += `   💎 ${entry.totalPoints} pts | 📊 ${entry.totalCalls} calls | ✅ ${hitRate}% hit\n`;
    
    if (entry.bestReturn > 0) {
      message += `   🎯 Best: ${entry.bestReturn.toFixed(1)}x\n`;
    }
    
    message += `\n`;
  });

  message += `\n💡 <i>Track your calls with /call &lt;mint&gt; &lt;price&gt;</i>`;

  return message;
}

/**
 * Format user stats
 */
function formatUserStats(stats: any, rank: number | null): string {
  if (!stats) {
    return `📊 <b>Your Stats</b>\n\nYou haven't made any calls yet!\nUse /call &lt;mint&gt; &lt;price&gt; to start tracking.`;
  }

  const tierEmoji = stats.tier?.split(' ')[0] || '🌱';
  const username = stats.username || 'You';
  const rankText = rank ? `#${rank}` : 'Unranked';

  let message = `📊 <b>${username}'s Stats</b>\n\n`;
  message += `🏅 Rank: ${rankText}\n`;
  message += `${tierEmoji} Tier: ${stats.tier || '🌱 Seedling'}\n`;
  message += `💎 Points: ${stats.totalPoints}\n`;
  message += `📊 Total Calls: ${stats.totalCalls}\n`;
  message += `✅ Hit Rate: ${stats.hitRate?.toFixed(0) || 0}%\n`;
  message += `📈 Avg Return: ${stats.avgReturn?.toFixed(2) || 0}x\n\n`;

  message += `<b>Performance Breakdown:</b>\n`;
  if (stats.calls100x > 0) message += `💎 100x+: ${stats.calls100x}\n`;
  if (stats.calls50x > 0) message += `🚀 50x+: ${stats.calls50x}\n`;
  if (stats.calls10x > 0) message += `🔥 10x+: ${stats.calls10x}\n`;
  if (stats.calls5x > 0) message += `📈 5x+: ${stats.calls5x}\n`;
  if (stats.calls2x > 0) message += `✅ 2x+: ${stats.calls2x}\n`;
  if (stats.callsRug > 0) message += `🚨 Rugs: ${stats.callsRug}\n`;

  if (stats.bestReturn > 0) {
    message += `\n🎯 <b>Best Call:</b> ${stats.bestReturn.toFixed(1)}x`;
    if (stats.bestCall) {
      message += ` (${stats.bestCall.slice(0, 8)}...)`;
    }
  }

  return message;
}

/**
 * Format recent calls
 */
function formatRecentCalls(calls: any[]): string {
  if (calls.length === 0) {
    return `📋 <b>Recent Calls</b>\n\nNo calls in this group yet!`;
  }

  let message = `📋 <b>Last ${calls.length} Calls</b>\n\n`;

  calls.forEach((call) => {
    const username = call.username || `User ${call.userId.slice(-4)}`;
    const symbol = call.symbol || call.tokenMint.slice(0, 8);
    const roi = call.currentReturn?.toFixed(2) || '1.00';
    const points = call.points || 0;
    const timeAgo = formatTimeAgo(call.calledAt);

    let statusEmoji = '📊';
    if (call.isRug) statusEmoji = '🚨';
    else if (call.currentReturn >= 10) statusEmoji = '🔥';
    else if (call.currentReturn >= 5) statusEmoji = '📈';
    else if (call.currentReturn >= 2) statusEmoji = '✅';

    message += `${statusEmoji} <b>${username}</b> → $${symbol}\n`;
    message += `   ${roi}x (${points >= 0 ? '+' : ''}${points} pts) • ${timeAgo}\n`;
  });

  return message;
}

/**
 * Format time ago helper
 */
function formatTimeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Register leaderboard commands
 */
export function registerLeaderboardCommands(bot: Telegraf): void {
  /**
   * /call command - Track a token call
   * Usage: /call <mint> <entry_price>
   */
  bot.command('call', async (ctx: Context) => {
    try {
      // Only works in groups
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        await ctx.reply('❌ This command only works in group chats!');
        return;
      }

      const args = ctx.message?.text?.split(' ').slice(1) || [];
      
      if (args.length < 2) {
        await ctx.reply(
          `📊 <b>Track a Token Call</b>\n\n` +
          `Usage: /call &lt;mint&gt; &lt;entry_price&gt;\n\n` +
          `Example:\n` +
          `/call DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 0.0012\n\n` +
          `💡 The bot will track your call and award points based on performance!`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      const mint = args[0];
      const entryPrice = parseFloat(args[1]);

      if (isNaN(entryPrice) || entryPrice <= 0) {
        await ctx.reply('❌ Invalid entry price! Must be a positive number.');
        return;
      }

      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
        await ctx.reply('❌ Invalid token mint address!');
        return;
      }

      const groupId = ctx.chat.id.toString();
      const userId = ctx.from?.id.toString() || '';
      const username = ctx.from?.username || ctx.from?.first_name;

      const call = await groupLeaderboard.recordCall(
        groupId,
        userId,
        username,
        mint,
        entryPrice
      );

      await ctx.reply(
        `✅ <b>Call Recorded!</b>\n\n` +
        `👤 Caller: ${username || 'You'}\n` +
        `🪙 Token: <code>${mint.slice(0, 8)}...${mint.slice(-6)}</code>\n` +
        `💰 Entry: $${entryPrice}\n\n` +
        `📊 Track performance with /mylb\n` +
        `🏆 View leaderboard with /lb`,
        { parse_mode: 'HTML' }
      );

      logger.info('LeaderboardCmd', `Call recorded: ${username} in group ${groupId}`);
    } catch (error) {
      logger.error('LeaderboardCmd', 'Failed to record call', error as Error);
      await ctx.reply(`❌ Error: ${(error as Error).message}`);
    }
  });

  /**
   * /lb command - Show leaderboard
   * Usage: /lb [timeframe]
   * Timeframes: 1d, 7d, 30d, all (default: 7d)
   */
  bot.command('lb', async (ctx: Context) => {
    try {
      // Only works in groups
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        await ctx.reply('❌ This command only works in group chats!');
        return;
      }

      const args = ctx.message?.text?.split(' ').slice(1) || [];
      const timeframe = args[0] || '7d';

      if (!['1d', '7d', '30d', 'all'].includes(timeframe)) {
        await ctx.reply('❌ Invalid timeframe! Use: 1d, 7d, 30d, or all');
        return;
      }

      const groupId = ctx.chat.id.toString();
      const entries = await groupLeaderboard.getGroupLeaderboard(groupId, timeframe, 10);

      const message = formatLeaderboard(entries, timeframe);
      await ctx.reply(message, { parse_mode: 'HTML' });

      logger.info('LeaderboardCmd', `Leaderboard displayed for group ${groupId}`);
    } catch (error) {
      logger.error('LeaderboardCmd', 'Failed to show leaderboard', error as Error);
      await ctx.reply('❌ Failed to load leaderboard. Please try again.');
    }
  });

  /**
   * /mylb command - Show personal stats
   */
  bot.command('mylb', async (ctx: Context) => {
    try {
      // Only works in groups
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        await ctx.reply('❌ This command only works in group chats!');
        return;
      }

      const groupId = ctx.chat.id.toString();
      const userId = ctx.from?.id.toString() || '';

      const stats = await groupLeaderboard.getUserStats(groupId, userId);
      const leaderboard = await groupLeaderboard.getGroupLeaderboard(groupId, 'all', 100);
      const rank = leaderboard.findIndex(e => e.userId === userId) + 1 || null;

      const message = formatUserStats(stats, rank);
      await ctx.reply(message, { parse_mode: 'HTML' });

      logger.info('LeaderboardCmd', `Stats displayed for user ${userId} in group ${groupId}`);
    } catch (error) {
      logger.error('LeaderboardCmd', 'Failed to show stats', error as Error);
      await ctx.reply('❌ Failed to load your stats. Please try again.');
    }
  });

  /**
   * /calls command - Show recent calls
   */
  bot.command('calls', async (ctx: Context) => {
    try {
      // Only works in groups
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        await ctx.reply('❌ This command only works in group chats!');
        return;
      }

      const groupId = ctx.chat.id.toString();
      const calls = await groupLeaderboard.getRecentCalls(groupId, 20);

      const message = formatRecentCalls(calls);
      await ctx.reply(message, { parse_mode: 'HTML' });

      logger.info('LeaderboardCmd', `Recent calls displayed for group ${groupId}`);
    } catch (error) {
      logger.error('LeaderboardCmd', 'Failed to show calls', error as Error);
      await ctx.reply('❌ Failed to load recent calls. Please try again.');
    }
  });

  /**
   * /recall command - Delete a call (within 5 minutes)
   * Usage: /recall <call_id>
   */
  bot.command('recall', async (ctx: Context) => {
    try {
      // Only works in groups
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        await ctx.reply('❌ This command only works in group chats!');
        return;
      }

      const args = ctx.message?.text?.split(' ').slice(1) || [];
      
      if (args.length < 1) {
        await ctx.reply('Usage: /recall <call_id>\n\nYou can only delete calls within 5 minutes of posting.');
        return;
      }

      const callId = parseInt(args[0]);
      if (isNaN(callId)) {
        await ctx.reply('❌ Invalid call ID!');
        return;
      }

      const userId = ctx.from?.id.toString() || '';
      const success = await groupLeaderboard.deleteCall(callId, userId);

      if (success) {
        await ctx.reply('✅ Call deleted successfully!');
      } else {
        await ctx.reply('❌ Call not found or cannot be deleted (only your own calls within 5 minutes).');
      }
    } catch (error) {
      logger.error('LeaderboardCmd', 'Failed to delete call', error as Error);
      await ctx.reply(`❌ Error: ${(error as Error).message}`);
    }
  });

  logger.info('Commands', 'Leaderboard commands registered');
}
