/**
 * Group Leaderboard Commands - Day 2 Enhanced
 * Advanced display with visual indicators, trends, and detailed stats
 */

import type { Context, Telegraf } from 'telegraf';
import { groupLeaderboard } from '../../services/groupLeaderboard';
import { logger } from '../../utils/logger';

/**
 * Get rank medal emoji (top 3)
 */
function getRankMedal(rank: number): string {
  switch (rank) {
    case 1: return '🥇';
    case 2: return '🥈';
    case 3: return '🥉';
    default: return `${rank}.`;
  }
}

/**
 * Get tier badge with enhanced visuals
 */
function getTierBadge(points: number): { emoji: string; name: string; color: string } {
  if (points >= 100) return { emoji: '🏆', name: 'Champion', color: '⭐' };
  if (points >= 50) return { emoji: '💎', name: 'Diamond', color: '💠' };
  if (points >= 25) return { emoji: '🚀', name: 'Rocket', color: '🔷' };
  if (points >= 10) return { emoji: '📈', name: 'Trader', color: '🔹' };
  if (points >= 1) return { emoji: '🌱', name: 'Seedling', color: '🟢' };
  return { emoji: '😭', name: 'Rekt', color: '🔴' };
}

/**
 * Get achievement badges based on performance
 */
function getAchievementBadges(stats: any): string[] {
  const badges: string[] = [];
  
  if (stats.calls100x > 0) badges.push('💯 Moonshooter');
  if (stats.calls50x >= 3) badges.push('🔥 Hot Streak');
  if (stats.hitRate >= 70) badges.push('🎯 Sharpshooter');
  if (stats.totalCalls >= 50) badges.push('📊 Veteran');
  if (stats.avgReturn >= 5) badges.push('⭐ Elite');
  if (stats.calls2x >= 10 && stats.callsRug === 0) badges.push('🛡️ Safe Player');
  
  return badges;
}

/**
 * Create progress bar visualization
 */
function createProgressBar(percentage: number, length: number = 10): string {
  const filled = Math.round((percentage / 100) * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Get trend indicator based on recent performance
 */
function getTrendIndicator(recentPerformance: number): string {
  if (recentPerformance > 1.5) return '📈 Rising';
  if (recentPerformance > 0.8) return '➡️ Stable';
  return '📉 Falling';
}

/**
 * Format leaderboard display - ENHANCED
 */
function formatLeaderboard(entries: any[], timeframe: string): string {
  if (entries.length === 0) {
    return `📊 <b>Leaderboard (${timeframe})</b>\n\n` +
      `No calls yet! Be the first to call a token with /call\n\n` +
      `💡 <i>Earn points by finding winning tokens!</i>`;
  }

  const timeframeLabel = {
    '1d': '24h',
    '7d': '7 Days',
    '30d': '30 Days',
    'all': 'All Time'
  }[timeframe] || timeframe;

  let message = `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `┃ 📊 <b>LEADERBOARD - ${timeframeLabel}</b>\n`;
  message += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  entries.slice(0, 10).forEach((entry) => {
    const tier = getTierBadge(entry.totalPoints);
    const medal = getRankMedal(entry.rank);
    const username = entry.username || `User${entry.userId.slice(-4)}`;
    const hitRate = entry.hitRate?.toFixed(0) || 0;
    const hitRateBar = createProgressBar(parseFloat(hitRate), 8);
    
    // Top 3 get special formatting
    if (entry.rank <= 3) {
      message += `${medal} ${tier.color} <b>${username}</b> ${tier.emoji}\n`;
    } else {
      message += `${medal} ${tier.emoji} <b>${username}</b>\n`;
    }
    
    message += `   💎 ${entry.totalPoints} pts • 📊 ${entry.totalCalls} calls\n`;
    message += `   ${hitRateBar} ${hitRate}% hit\n`;
    
    // Show notable achievements
    const highlights: string[] = [];
    if (entry.calls100x > 0) highlights.push(`💯${entry.calls100x}`);
    if (entry.calls50x > 0) highlights.push(`🚀${entry.calls50x}`);
    if (entry.calls10x > 0) highlights.push(`🔥${entry.calls10x}`);
    
    if (highlights.length > 0) {
      message += `   ${highlights.join(' • ')}\n`;
    }
    
    if (entry.bestReturn > 2) {
      message += `   🎯 Best: <b>${entry.bestReturn.toFixed(1)}x</b>\n`;
    }
    
    message += `\n`;
  });

  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `💡 Track calls with /call • View stats with /mylb`;

  return message;
}

/**
 * Format user stats - ENHANCED with trends and achievements
 */
function formatUserStats(stats: any, rank: number | null): string {
  if (!stats) {
    return `📊 <b>Your Stats</b>\n\n` +
      `You haven't made any calls yet!\n\n` +
      `🚀 <b>Get Started:</b>\n` +
      `Use <code>/call &lt;mint&gt; &lt;price&gt;</code> to track a token\n\n` +
      `💡 <i>Earn points by finding winning tokens!</i>`;
  }

  const tier = getTierBadge(stats.totalPoints);
  const username = stats.username || 'You';
  const rankText = rank && rank <= 100 ? `#${rank}` : 'Unranked';
  const hitRate = stats.hitRate?.toFixed(0) || 0;
  const hitRateBar = createProgressBar(parseFloat(hitRate), 15);
  const badges = getAchievementBadges(stats);

  let message = `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `┃ 📊 <b>${username}'s Profile</b>\n`;
  message += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Rank & Tier
  message += `🏅 <b>Rank:</b> ${rankText}\n`;
  message += `${tier.emoji} <b>Tier:</b> ${tier.name} ${tier.color}\n`;
  message += `💎 <b>Points:</b> ${stats.totalPoints}\n\n`;

  // Achievement Badges
  if (badges.length > 0) {
    message += `🏆 <b>Achievements:</b>\n`;
    badges.forEach(badge => message += `   ${badge}\n`);
    message += `\n`;
  }

  // Stats Overview
  message += `━━ <b>Stats Overview</b> ━━\n`;
  message += `📊 Total Calls: ${stats.totalCalls}\n`;
  message += `📈 Avg Return: ${stats.avgReturn?.toFixed(2) || 0}x\n`;
  message += `✅ Hit Rate: ${hitRate}%\n`;
  message += `${hitRateBar}\n\n`;

  // Performance Breakdown
  message += `━━ <b>Performance</b> ━━\n`;
  const perfData = [
    { emoji: '💎', label: '100x+', count: stats.calls100x, points: 30 },
    { emoji: '🚀', label: '50x+', count: stats.calls50x, points: 20 },
    { emoji: '🔥', label: '10x+', count: stats.calls10x, points: 10 },
    { emoji: '📈', label: '5x+', count: stats.calls5x, points: 5 },
    { emoji: '✅', label: '2x+', count: stats.calls2x, points: 2 },
  ];

  perfData.forEach(perf => {
    if (perf.count > 0) {
      message += `${perf.emoji} ${perf.label}: ${perf.count} (+${perf.count * perf.points} pts)\n`;
    }
  });

  if (stats.callsRug > 0) {
    message += `🚨 Rugs: ${stats.callsRug} (-${stats.callsRug * 5} pts)\n`;
  }

  // Best Call Highlight
  if (stats.bestReturn > 0) {
    message += `\n━━ <b>Best Call</b> ━━\n`;
    message += `🎯 <b>${stats.bestReturn.toFixed(1)}x ROI</b>\n`;
    if (stats.bestCall) {
      message += `🪙 <code>${stats.bestCall.slice(0, 8)}...</code>\n`;
    }
  }

  // Tips for improvement
  if (stats.totalCalls < 10) {
    message += `\n💡 <i>Make ${10 - stats.totalCalls} more calls to unlock detailed analytics!</i>`;
  } else if (stats.hitRate < 50) {
    message += `\n💡 <i>Focus on quality over quantity to improve your hit rate!</i>`;
  } else if (stats.hitRate >= 70) {
    message += `\n⭐ <i>Excellent performance! Keep it up!</i>`;
  }

  return message;
}

/**
 * Format recent calls - ENHANCED with grouping and status
 */
function formatRecentCalls(calls: any[]): string {
  if (calls.length === 0) {
    return `📋 <b>Recent Calls</b>\n\nNo calls in this group yet!`;
  }

  let message = `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `┃ 📋 <b>RECENT CALLS</b>\n`;
  message += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Group calls by performance
  const moons = calls.filter(c => c.currentReturn >= 10);
  const profits = calls.filter(c => c.currentReturn >= 2 && c.currentReturn < 10);
  const neutral = calls.filter(c => c.currentReturn >= 0.8 && c.currentReturn < 2);
  const losses = calls.filter(c => c.currentReturn < 0.8 && !c.isRug);
  const rugs = calls.filter(c => c.isRug);

  // Show Moons
  if (moons.length > 0) {
    message += `🌙 <b>MOONS (10x+)</b>\n`;
    moons.slice(0, 5).forEach(call => {
      message += formatSingleCall(call);
    });
    message += `\n`;
  }

  // Show Profits
  if (profits.length > 0) {
    message += `📈 <b>PROFITS (2x-10x)</b>\n`;
    profits.slice(0, 5).forEach(call => {
      message += formatSingleCall(call);
    });
    message += `\n`;
  }

  // Show Neutral
  if (neutral.length > 0) {
    message += `➡️ <b>ACTIVE (-20% to 2x)</b>\n`;
    neutral.slice(0, 3).forEach(call => {
      message += formatSingleCall(call);
    });
    message += `\n`;
  }

  // Show Losses
  if (losses.length > 0) {
    message += `📉 <b>LOSSES (-20%+)</b>\n`;
    losses.slice(0, 3).forEach(call => {
      message += formatSingleCall(call);
    });
    message += `\n`;
  }

  // Show Rugs
  if (rugs.length > 0) {
    message += `🚨 <b>RUGS</b>\n`;
    rugs.forEach(call => {
      message += formatSingleCall(call);
    });
    message += `\n`;
  }

  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `💡 See your stats with /mylb`;

  return message;
}

/**
 * Format a single call entry
 */
function formatSingleCall(call: any): string {
  const username = call.username || `User${call.userId.slice(-4)}`;
  const symbol = call.symbol || call.tokenMint.slice(0, 6);
  const roi = call.currentReturn?.toFixed(2) || '1.00';
  const points = call.points || 0;
  const timeAgo = formatTimeAgo(call.calledAt);
  const changePercentNum = (call.currentReturn - 1) * 100;
  const changePercent = changePercentNum.toFixed(0);
  
  let statusEmoji = '📊';
  if (call.isRug) statusEmoji = '🚨';
  else if (call.currentReturn >= 50) statusEmoji = '💎';
  else if (call.currentReturn >= 10) statusEmoji = '🔥';
  else if (call.currentReturn >= 5) statusEmoji = '🚀';
  else if (call.currentReturn >= 2) statusEmoji = '📈';
  else if (call.currentReturn < 0.8) statusEmoji = '📉';

  let msg = `${statusEmoji} <b>${username}</b> • $${symbol}\n`;
  msg += `   ${roi}x (${changePercentNum >= 0 ? '+' : ''}${changePercent}%) • `;
  msg += `${points >= 0 ? '+' : ''}${points} pts • ${timeAgo}\n`;
  
  return msg;
}

/**
 * Format time ago helper
 */
function formatTimeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 604800)}w`;
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

      const msgText = (ctx.message && 'text' in ctx.message) ? (ctx.message as any).text : '';
      const args = msgText.split(' ').slice(1);
      
      if (args.length < 2) {
        await ctx.reply(
          `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `┃ 📊 <b>Track a Token Call</b>\n` +
          `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `<b>Usage:</b>\n` +
          `<code>/call &lt;mint&gt; &lt;entry_price&gt;</code>\n\n` +
          `<b>Example:</b>\n` +
          `<code>/call DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 0.0012</code>\n\n` +
          `<b>Point System:</b>\n` +
          `💎 100x+ = 30 pts\n` +
          `🚀 50x+ = 20 pts\n` +
          `🔥 10x+ = 10 pts\n` +
          `📈 5x+ = 5 pts\n` +
          `✅ 2x+ = 2 pts\n` +
          `🚨 Rug = -5 pts\n\n` +
          `💡 <i>The bot will track your call and award points based on performance!</i>`,
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
        `👤 <b>Caller:</b> ${username || 'You'}\n` +
        `🪙 <b>Token:</b> <code>${mint.slice(0, 12)}...${mint.slice(-8)}</code>\n` +
        `💰 <b>Entry:</b> $${entryPrice}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 Track performance: /mylb\n` +
        `🏆 View leaderboard: /lb\n` +
        `🔄 Delete (5min): /recall <id>`,
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

      const msgText2 = (ctx.message && 'text' in ctx.message) ? (ctx.message as any).text : '';
      const args = msgText2.split(' ').slice(1);
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

      const msgText3 = (ctx.message && 'text' in ctx.message) ? (ctx.message as any).text : '';
      const args = msgText3.split(' ').slice(1);
      
      if (args.length < 1) {
        await ctx.reply(
          `<b>Delete a Call</b>\n\n` +
          `Usage: <code>/recall &lt;call_id&gt;</code>\n\n` +
          `⏱️ You can only delete calls within 5 minutes of posting.\n` +
          `📋 Find call IDs with /calls`,
          { parse_mode: 'HTML' }
        );
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

  logger.info('Commands', 'Leaderboard commands registered (Day 2 Enhanced)');
}
