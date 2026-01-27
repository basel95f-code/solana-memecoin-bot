/**
 * Achievement & Challenge Commands
 * Display user achievements, badges, and hall of fame
 */

import type { Context, Telegraf } from 'telegraf';
import { achievementService, AVAILABLE_BADGES } from '../../services/achievements';
import { logger } from '../../utils/logger';

/**
 * Format user achievements display
 */
function formatAchievements(achievements: any[], username: string): string {
  if (achievements.length === 0) {
    return `🏅 <b>${username}'s Achievements</b>\n\n` +
      `No badges earned yet!\n\n` +
      `📊 Keep calling tokens to earn badges:\n` +
      `🏆 Legend - 1000+ points\n` +
      `💎 Diamond Caller - 5x 10x+ calls\n` +
      `🚀 Moonshot - Call a 100x\n` +
      `📈 Consistent - 70%+ hit rate (20+ calls)\n` +
      `⭐ Veteran - 100+ calls\n` +
      `🛡️ Guardian - Identify 10+ rugs\n\n` +
      `💡 Use /challenges to see active challenges!`;
  }

  let message = `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `┃ 🏅 <b>${username}'s Badges</b>\n`;
  message += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  message += `━━ <b>Earned (${achievements.length})</b> ━━\n`;

  achievements.forEach(achievement => {
    const badge = AVAILABLE_BADGES[achievement.badgeType];
    if (!badge) return;

    message += `${badge.emoji} <b>${badge.name}</b>\n`;
    message += `   ${badge.description}\n`;
    if (achievement.earnedAt) {
      const date = new Date(achievement.earnedAt * 1000);
      message += `   📅 ${date.toLocaleDateString()}\n`;
    }
    message += `\n`;
  });

  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `💡 Keep trading to unlock more badges!`;

  return message;
}

/**
 * Format achievement progress
 */
function formatProgress(progress: any, username: string): string {
  let message = `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `┃ 📊 <b>${username}'s Progress</b>\n`;
  message += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const badges = [
    { key: 'legend', emoji: '🏆', name: 'Legend' },
    { key: 'diamond_caller', emoji: '💎', name: 'Diamond Caller' },
    { key: 'moonshot', emoji: '🚀', name: 'Moonshot' },
    { key: 'consistent', emoji: '📈', name: 'Consistent' },
    { key: 'veteran', emoji: '⭐', name: 'Veteran' },
    { key: 'guardian', emoji: '🛡️', name: 'Guardian' }
  ];

  badges.forEach(badge => {
    const prog = progress[badge.key];
    if (!prog) return;

    const status = prog.earned ? '✅' : '⏳';
    message += `${status} ${badge.emoji} <b>${badge.name}</b>\n`;

    if (!prog.earned) {
      const progressBar = createProgressBar(prog.progress, 15);
      message += `   ${progressBar} ${prog.current}/${prog.target}\n`;

      // Special message for consistent badge
      if (badge.key === 'consistent' && prog.callsNeeded > 0) {
        message += `   Need ${prog.callsNeeded} more calls to qualify\n`;
      }
    } else {
      message += `   ✨ <i>Unlocked!</i>\n`;
    }

    message += `\n`;
  });

  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `💡 /myachievements to see earned badges`;

  return message;
}

/**
 * Create progress bar
 */
function createProgressBar(percentage: number, length: number = 15): string {
  const filled = Math.floor((percentage / 100) * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Format hall of fame
 */
function formatHallOfFame(topAchievers: any[]): string {
  if (topAchievers.length === 0) {
    return `🏆 <b>Hall of Fame</b>\n\nNo achievers yet! Be the first to earn badges!`;
  }

  let message = `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `┃ 🏆 <b>HALL OF FAME</b>\n`;
  message += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  message += `━━ <b>Top Badge Collectors</b> ━━\n\n`;

  topAchievers.slice(0, 10).forEach((achiever, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
    const username = achiever.username || `User${achiever.userId.slice(-4)}`;

    message += `${medal} <b>${username}</b>\n`;
    message += `   🏅 ${achiever.badgeCount} badges: `;

    // Show badge emojis
    const badgeEmojis = achiever.badges
      .map((bt: string) => AVAILABLE_BADGES[bt]?.emoji || '🏅')
      .join(' ');
    message += badgeEmojis + `\n\n`;
  });

  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `💡 Earn badges to climb the Hall of Fame!`;

  return message;
}

/**
 * Format available challenges
 */
function formatChallenges(): string {
  let message = `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `┃ 🎯 <b>ACTIVE CHALLENGES</b>\n`;
  message += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  message += `━━ <b>Weekly Challenges</b> ━━\n\n`;

  message += `🏆 <b>Best Weekly Call</b>\n`;
  message += `   Highest ROI in 7 days\n`;
  message += `   🎁 Reward: Special recognition\n\n`;

  message += `📊 <b>Most Consistent</b>\n`;
  message += `   Best hit rate (min 5 calls)\n`;
  message += `   🎁 Reward: Consistency badge\n\n`;

  message += `🚀 <b>Volume King</b>\n`;
  message += `   Most calls this week\n`;
  message += `   🎁 Reward: Activity boost\n\n`;

  message += `━━ <b>Achievement Challenges</b> ━━\n\n`;

  message += `💎 <b>Diamond Hunter</b>\n`;
  message += `   Find 5 tokens with 10x+ ROI\n`;
  message += `   🏅 Unlocks: Diamond Caller badge\n\n`;

  message += `🛡️ <b>Community Guardian</b>\n`;
  message += `   Identify 10 rug pulls\n`;
  message += `   🏅 Unlocks: Guardian badge\n\n`;

  message += `⭐ <b>Trading Veteran</b>\n`;
  message += `   Make 100 total calls\n`;
  message += `   🏅 Unlocks: Veteran badge\n\n`;

  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `💡 /myachievements to track progress`;

  return message;
}

/**
 * Register achievement commands
 */
export function registerAchievementCommands(bot: Telegraf): void {
  /**
   * /myachievements - Show user's earned badges
   */
  bot.command('myachievements', async (ctx: Context) => {
    try {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        await ctx.reply('❌ This command only works in group chats!');
        return;
      }

      const groupId = ctx.chat.id.toString();
      const userId = ctx.from?.id.toString() || '';
      const username = ctx.from?.username || ctx.from?.first_name || 'You';

      const achievements = await achievementService.getUserAchievements(groupId, userId);
      const message = formatAchievements(achievements, username);

      await ctx.reply(message, { parse_mode: 'HTML' });

      logger.info('AchievementCmd', `Achievements shown for user ${userId}`);
    } catch (error) {
      logger.error('AchievementCmd', 'Failed to show achievements', error as Error);
      await ctx.reply('❌ Failed to load achievements. Please try again.');
    }
  });

  /**
   * /progress - Show achievement progress
   */
  bot.command('progress', async (ctx: Context) => {
    try {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        await ctx.reply('❌ This command only works in group chats!');
        return;
      }

      const groupId = ctx.chat.id.toString();
      const userId = ctx.from?.id.toString() || '';
      const username = ctx.from?.username || ctx.from?.first_name || 'You';

      const progress = await achievementService.getProgress(groupId, userId);
      const message = formatProgress(progress, username);

      await ctx.reply(message, { parse_mode: 'HTML' });

      logger.info('AchievementCmd', `Progress shown for user ${userId}`);
    } catch (error) {
      logger.error('AchievementCmd', 'Failed to show progress', error as Error);
      await ctx.reply('❌ Failed to load progress. Please try again.');
    }
  });

  /**
   * /hof - Hall of Fame (top badge collectors)
   */
  bot.command('hof', async (ctx: Context) => {
    try {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        await ctx.reply('❌ This command only works in group chats!');
        return;
      }

      const groupId = ctx.chat.id.toString();
      const topAchievers = await achievementService.getTopAchievers(groupId, 10);
      const message = formatHallOfFame(topAchievers);

      await ctx.reply(message, { parse_mode: 'HTML' });

      logger.info('AchievementCmd', `Hall of Fame shown for group ${groupId}`);
    } catch (error) {
      logger.error('AchievementCmd', 'Failed to show Hall of Fame', error as Error);
      await ctx.reply('❌ Failed to load Hall of Fame. Please try again.');
    }
  });

  /**
   * /challenges - Show active challenges
   */
  bot.command('challenges', async (ctx: Context) => {
    try {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        await ctx.reply('❌ This command only works in group chats!');
        return;
      }

      const message = formatChallenges();
      await ctx.reply(message, { parse_mode: 'HTML' });

      logger.info('AchievementCmd', 'Challenges shown');
    } catch (error) {
      logger.error('AchievementCmd', 'Failed to show challenges', error as Error);
      await ctx.reply('❌ Failed to load challenges. Please try again.');
    }
  });

  logger.info('Commands', 'Achievement commands registered');
}
