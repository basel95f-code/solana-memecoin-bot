import type { Context, Telegraf } from 'telegraf';
import { leaderboardService } from '../../services/leaderboard';
import { chatContextService } from '../../services/chatContext';
import { Markup } from 'telegraf';

function formatLeaderboard(
  rankings: any[],
  period: 'week' | 'month' | 'alltime',
  chatTitle?: string
): string {
  const periodText = period === 'week' ? 'This Week' : period === 'month' ? 'This Month' : 'All Time';
  
  if (rankings.length === 0) {
    return (
      `🏆 <b>Leaderboard - ${periodText}</b>\n\n` +
      `No tokens tracked yet!\n\n` +
      `Start adding tokens with <code>/groupwatch [token_address]</code> to compete!`
    );
  }

  let message = `🏆 <b>Leaderboard - ${periodText}</b>\n`;
  if (chatTitle) {
    message += `<i>${chatTitle}</i>\n`;
  }
  message += `\n`;

  for (let i = 0; i < rankings.length; i++) {
    const ranking = rankings[i];
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const username = ranking.username || 'Anonymous'; // Show "Anonymous" for opted-out users
    
    const avgMult = ranking.avgMultiplier.toFixed(2);
    const successRate = ranking.successRate.toFixed(0);
    
    message += `${medal} <b>${username}</b>\n`;
    message += `   💎 ${ranking.gemsFound} finds | ${avgMult}x avg | ${successRate}% success\n`;
    message += `   📊 Score: ${Math.round(ranking.totalScore)}\n\n`;
  }

  message += `<i>View your stats: /mystats</i>`;
  return message;
}

function formatUserStats(stats: any): string {
  if (!stats) {
    return (
      `📊 <b>Your Stats</b>\n\n` +
      `You haven't added any tokens to the leaderboard yet!\n\n` +
      `Add tokens with <code>/groupwatch [token_address]</code> to start tracking.`
    );
  }

  const username = stats.username || `User ${stats.userId}`;
  const avgMult = stats.avgMultiplier.toFixed(2);
  const successRate = stats.successRate.toFixed(0);
  const bestMult = stats.bestMultiplier.toFixed(2);

  let message = `📊 <b>Stats for ${username}</b>\n\n`;
  
  message += `🏆 <b>Rank:</b> #${stats.currentRank}\n`;
  message += `📈 <b>Total Score:</b> ${Math.round(stats.totalScore)}\n\n`;
  
  message += `💎 <b>Tokens Found:</b> ${stats.totalTokens}\n`;
  message += `📊 <b>Avg Multiplier:</b> ${avgMult}x\n`;
  message += `✅ <b>Success Rate:</b> ${successRate}%\n\n`;
  
  if (stats.bestTokenSymbol) {
    message += `🌟 <b>Best Find:</b> ${stats.bestTokenSymbol} (${bestMult}x)\n\n`;
  }
  
  message += `<i>Keep finding gems to climb the leaderboard! 🚀</i>`;
  
  return message;
}

function createLeaderboardKeyboard(currentPeriod: 'week' | 'month' | 'alltime') {
  const buttons = [];
  
  if (currentPeriod !== 'week') {
    buttons.push(Markup.button.callback('📅 Week', 'leaderboard_week'));
  }
  if (currentPeriod !== 'month') {
    buttons.push(Markup.button.callback('📅 Month', 'leaderboard_month'));
  }
  if (currentPeriod !== 'alltime') {
    buttons.push(Markup.button.callback('📅 All Time', 'leaderboard_alltime'));
  }
  
  return Markup.inlineKeyboard([buttons]);
}

export function registerLeaderboardCommands(bot: Telegraf): void {
  // /leaderboard command - Show group leaderboard
  bot.command('leaderboard', async (ctx: Context) => {
    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext) return;

    // Only works in groups
    if (!chatContext.isGroup) {
      await ctx.replyWithHTML(
        `❌ This command only works in group chats.\n\n` +
        `Use <code>/mystats</code> to see your personal stats.`
      );
      return;
    }

    // Check if leaderboard is enabled
    const isEnabled = await leaderboardService.isEnabledInGroup(chatContext.chatId);
    if (!isEnabled) {
      await ctx.replyWithHTML(
        `📊 <b>Leaderboard</b>\n\n` +
        `The leaderboard is currently disabled in this group.\n\n` +
        `Admins can enable it with:\n` +
        `<code>/leaderboard settings enable</code>`
      );
      return;
    }

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    // Handle /leaderboard optin
    if (args[0] === 'optin' || args[0] === 'join') {
      try {
        await chatContextService.updateUserSettings(chatContext.userId, {
          participateInLeaderboard: true
        });
        await ctx.replyWithHTML(
          `✅ <b>Leaderboard Opt-in Successful!</b>\n\n` +
          `Your token discoveries will now be tracked and displayed on the leaderboard.\n\n` +
          `🏆 Start adding tokens with <code>/groupwatch [token]</code> to compete!\n\n` +
          `<i>You can opt-out anytime with /leaderboard optout</i>`
        );
      } catch (error) {
        console.error('Leaderboard opt-in error:', error);
        await ctx.replyWithHTML(`❌ Error opting in to leaderboard.`);
      }
      return;
    }

    // Handle /leaderboard optout
    if (args[0] === 'optout' || args[0] === 'leave') {
      try {
        await chatContextService.updateUserSettings(chatContext.userId, {
          participateInLeaderboard: false
        });
        await ctx.replyWithHTML(
          `✅ <b>Leaderboard Opt-out Successful</b>\n\n` +
          `Your discoveries will no longer be tracked.\n` +
          `Your previous entries will be anonymized.\n\n` +
          `<i>You can opt back in anytime with /leaderboard optin</i>`
        );
      } catch (error) {
        console.error('Leaderboard opt-out error:', error);
        await ctx.replyWithHTML(`❌ Error opting out of leaderboard.`);
      }
      return;
    }

    // Handle /leaderboard settings (admin only)
    if (args[0] === 'settings') {
      const isAdmin = await chatContextService.isGroupAdmin(chatContext.chatId, chatContext.userId);
      if (!isAdmin) {
        await ctx.replyWithHTML(`❌ Only group admins can manage leaderboard settings.`);
        return;
      }

      if (args[1] === 'enable') {
        const groupSettings = await chatContextService.getGroupSettings(chatContext.chatId);
        if (groupSettings) {
          await chatContextService.updateGroupSettings(chatContext.chatId, {
            enableLeaderboard: true
          });
          await ctx.replyWithHTML(
            `✅ <b>Leaderboard Enabled</b>\n\n` +
            `Users can now opt-in to leaderboard tracking!\n\n` +
            `<i>Note: Users must opt-in via /settings to participate.</i>`
          );
        }
        return;
      } else if (args[1] === 'disable') {
        const groupSettings = await chatContextService.getGroupSettings(chatContext.chatId);
        if (groupSettings) {
          await chatContextService.updateGroupSettings(chatContext.chatId, {
            enableLeaderboard: false
          });
          await ctx.replyWithHTML(`✅ Leaderboard disabled for this group.`);
        }
        return;
      } else {
        await ctx.replyWithHTML(
          `<b>Leaderboard Settings</b>\n\n` +
          `Commands:\n` +
          `• <code>/leaderboard settings enable</code> - Enable leaderboard\n` +
          `• <code>/leaderboard settings disable</code> - Disable leaderboard\n\n` +
          `<i>Admin only</i>`
        );
        return;
      }
    }

    // Determine period
    let period: 'week' | 'month' | 'alltime' = 'week';
    if (args[0] === 'month') {
      period = 'month';
    } else if (args[0] === 'alltime' || args[0] === 'all') {
      period = 'alltime';
    }

    try {
      const rankings = await leaderboardService.getLeaderboard(chatContext.chatId, period);
      const chatTitle = ctx.chat && 'title' in ctx.chat ? ctx.chat.title : undefined;
      const formatted = formatLeaderboard(rankings, period, chatTitle);

      await ctx.replyWithHTML(formatted, createLeaderboardKeyboard(period));
    } catch (error) {
      console.error('Leaderboard command error:', error);
      await ctx.replyWithHTML(`❌ Error fetching leaderboard.`);
    }
  });

  // /mystats command - Show personal stats
  bot.command('mystats', async (ctx: Context) => {
    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext) return;

    // Only works in groups
    if (!chatContext.isGroup) {
      await ctx.replyWithHTML(
        `❌ This command only works in group chats.\n\n` +
        `Your stats are tracked per-group when you add tokens.`
      );
      return;
    }

    // Check if leaderboard is enabled
    const isEnabled = await leaderboardService.isEnabledInGroup(chatContext.chatId);
    if (!isEnabled) {
      await ctx.replyWithHTML(
        `❌ The leaderboard is disabled in this group.\n\n` +
        `Admins can enable it with <code>/leaderboard settings enable</code>`
      );
      return;
    }

    // Check if user has opted in
    const hasOptedIn = await leaderboardService.hasOptedIn(chatContext.userId);
    if (!hasOptedIn) {
      await ctx.replyWithHTML(
        `📊 <b>Leaderboard Opt-in Required</b>\n\n` +
        `You need to opt-in to leaderboard tracking to see your stats.\n\n` +
        `This allows the bot to:\n` +
        `• Track tokens you add to the group watchlist\n` +
        `• Calculate your success rate and rankings\n` +
        `• Display your username on the leaderboard\n\n` +
        `Opt-in with: <code>/settings</code> and enable "Participate in Leaderboard"\n\n` +
        `<i>Privacy-first: You can opt-out anytime!</i>`
      );
      return;
    }

    try {
      const stats = await leaderboardService.getUserStats(chatContext.chatId, chatContext.userId);
      const formatted = formatUserStats(stats);

      await ctx.replyWithHTML(formatted);
    } catch (error) {
      console.error('Mystats command error:', error);
      await ctx.replyWithHTML(`❌ Error fetching your stats.`);
    }
  });

  // Handle leaderboard period toggle callbacks
  bot.action(/^leaderboard_(week|month|alltime)$/, async (ctx) => {
    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext || !chatContext.isGroup) return;

    const period = ctx.match[1] as 'week' | 'month' | 'alltime';

    try {
      const rankings = await leaderboardService.getLeaderboard(chatContext.chatId, period);
      const chatTitle = ctx.chat && 'title' in ctx.chat ? ctx.chat.title : undefined;
      const formatted = formatLeaderboard(rankings, period, chatTitle);

      await ctx.editMessageText(formatted, {
        parse_mode: 'HTML',
        ...createLeaderboardKeyboard(period)
      });
      await ctx.answerCbQuery();
    } catch (error) {
      console.error('Leaderboard callback error:', error);
      await ctx.answerCbQuery('Error fetching leaderboard');
    }
  });
}
