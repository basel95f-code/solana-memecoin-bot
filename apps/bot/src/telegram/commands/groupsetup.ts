import { Telegraf, Context } from 'telegraf';
import { chatContextService } from '../../services/chatContext';
import type { GroupSettings } from '../../services/chatContext';

/**
 * Register /groupsetup command for configuring group chat alerts
 */
export function registerGroupSetupCommand(bot: Telegraf) {
  bot.command('groupsetup', async (ctx: Context) => {
    if (!ctx.chat || !ctx.from) return;

    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext) {
      return ctx.reply('❌ Unable to determine chat context');
    }

    // Only works in groups
    if (!chatContext.isGroup) {
      return ctx.reply('⚠️ This command only works in group chats.\n\nUse /settings in DM for personal preferences.');
    }

    try {
      // Check if user is admin
      const isAdmin = await chatContextService.isGroupAdmin(chatContext.chatId, chatContext.userId);
      
      if (!isAdmin) {
        // Check if they're actually a Telegram group admin
        const chatMember = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
        const isTelegramAdmin = ['creator', 'administrator'].includes(chatMember.status);
        
        if (!isTelegramAdmin) {
          return ctx.reply('⚠️ Only group admins can configure settings.');
        }
        
        // Add them as bot admin
        await chatContextService.addGroupAdmin(chatContext.chatId, chatContext.userId);
      }

      // Get or create settings
      let settings = await chatContextService.getGroupSettings(chatContext.chatId);
      
      if (!settings) {
        // First time setup - create settings
        const chatTitle = ctx.chat.type === 'supergroup' || ctx.chat.type === 'group'
          ? (ctx.chat as any).title
          : undefined;
        
        settings = await chatContextService.createGroupSettings(
          chatContext.chatId,
          chatContext.chatType,
          chatTitle,
          chatContext.userId
        );
        
        await ctx.reply(
          `✅ *Group Setup Complete!*\n\n` +
          `Welcome to Sol Scanner! I'm now monitoring for high-quality token opportunities.\n\n` +
          `*Current Settings:*\n` +
          `📊 Minimum Risk Score: ${settings.minRiskScore}/100\n` +
          `💧 Minimum Liquidity: $${settings.minLiquidityUsd.toLocaleString()}\n` +
          `🔔 Max Alerts/Hour: ${settings.maxAlertsPerHour}\n\n` +
          `*Alert Types:*\n` +
          `${settings.enableTokenAlerts ? '✅' : '❌'} Token Alerts\n` +
          `${settings.enableSmartMoneyAlerts ? '✅' : '❌'} Smart Money Moves\n` +
          `${settings.enableRugWarnings ? '✅' : '❌'} Rug Warnings\n` +
          `${settings.enableSignals ? '✅' : '❌'} Trading Signals\n` +
          `${settings.enableVolumeSpikes ? '✅' : '❌'} Volume Spikes\n\n` +
          `Use /groupconfig to customize these settings.`,
          { parse_mode: 'Markdown' }
        );
        
        return;
      }

      // Show current settings
      await ctx.reply(
        formatGroupSettings(settings),
        { parse_mode: 'Markdown' }
      );
      
    } catch (error) {
      console.error('Group setup error:', error);
      await ctx.reply('❌ Failed to set up group. Please try again.');
    }
  });

  // Command to show current config
  bot.command('groupconfig', async (ctx: Context) => {
    if (!ctx.chat || !ctx.from) return;

    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext || !chatContext.isGroup) {
      return ctx.reply('⚠️ This command only works in group chats.');
    }

    try {
      const settings = await chatContextService.getGroupSettings(chatContext.chatId);
      
      if (!settings) {
        return ctx.reply('⚠️ Group not configured. Run /groupsetup first.');
      }

      await ctx.reply(
        formatGroupSettings(settings),
        { parse_mode: 'Markdown' }
      );
      
    } catch (error) {
      console.error('Group config error:', error);
      await ctx.reply('❌ Failed to load settings.');
    }
  });

  // Individual setting commands
  bot.command('setminrisk', async (ctx: Context) => {
    if (!ctx.chat || !ctx.from) return;

    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext || !chatContext.isGroup) {
      return ctx.reply('⚠️ This command only works in group chats.');
    }

    const isAdmin = await chatContextService.isGroupAdmin(chatContext.chatId, chatContext.userId);
    if (!isAdmin) {
      return ctx.reply('⚠️ Only group admins can change settings.');
    }

    const args = ctx.message?.text?.split(' ');
    if (!args || args.length < 2) {
      return ctx.reply('Usage: /setminrisk <score>\nExample: /setminrisk 85');
    }

    const score = parseInt(args[1]);
    if (isNaN(score) || score < 0 || score > 100) {
      return ctx.reply('❌ Risk score must be between 0-100');
    }

    try {
      await chatContextService.updateGroupSettings(chatContext.chatId, { minRiskScore: score });
      await ctx.reply(`✅ Minimum risk score updated to ${score}/100`);
    } catch (error) {
      await ctx.reply('❌ Failed to update setting.');
    }
  });

  bot.command('setminliq', async (ctx: Context) => {
    if (!ctx.chat || !ctx.from) return;

    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext || !chatContext.isGroup) {
      return ctx.reply('⚠️ This command only works in group chats.');
    }

    const isAdmin = await chatContextService.isGroupAdmin(chatContext.chatId, chatContext.userId);
    if (!isAdmin) {
      return ctx.reply('⚠️ Only group admins can change settings.');
    }

    const args = ctx.message?.text?.split(' ');
    if (!args || args.length < 2) {
      return ctx.reply('Usage: /setminliq <amount>\nExample: /setminliq 50000');
    }

    const amount = parseFloat(args[1]);
    if (isNaN(amount) || amount < 0) {
      return ctx.reply('❌ Liquidity must be a positive number');
    }

    try {
      await chatContextService.updateGroupSettings(chatContext.chatId, { minLiquidityUsd: amount });
      await ctx.reply(`✅ Minimum liquidity updated to $${amount.toLocaleString()}`);
    } catch (error) {
      await ctx.reply('❌ Failed to update setting.');
    }
  });

  bot.command('setmaxalerts', async (ctx: Context) => {
    if (!ctx.chat || !ctx.from) return;

    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext || !chatContext.isGroup) {
      return ctx.reply('⚠️ This command only works in group chats.');
    }

    const isAdmin = await chatContextService.isGroupAdmin(chatContext.chatId, chatContext.userId);
    if (!isAdmin) {
      return ctx.reply('⚠️ Only group admins can change settings.');
    }

    const args = ctx.message?.text?.split(' ');
    if (!args || args.length < 2) {
      return ctx.reply('Usage: /setmaxalerts <count>\nExample: /setmaxalerts 10');
    }

    const count = parseInt(args[1]);
    if (isNaN(count) || count < 1 || count > 50) {
      return ctx.reply('❌ Max alerts must be between 1-50 per hour');
    }

    try {
      await chatContextService.updateGroupSettings(chatContext.chatId, { maxAlertsPerHour: count });
      await ctx.reply(`✅ Max alerts per hour updated to ${count}`);
    } catch (error) {
      await ctx.reply('❌ Failed to update setting.');
    }
  });

  // Toggle alert types
  bot.command('togglesmartmoney', async (ctx: Context) => {
    await toggleAlertType(ctx, 'smart_money');
  });

  bot.command('togglerugs', async (ctx: Context) => {
    await toggleAlertType(ctx, 'rugs');
  });

  bot.command('togglesignals', async (ctx: Context) => {
    await toggleAlertType(ctx, 'signals');
  });

  bot.command('togglevolume', async (ctx: Context) => {
    await toggleAlertType(ctx, 'volume');
  });
}

async function toggleAlertType(ctx: Context, type: string) {
  if (!ctx.chat || !ctx.from) return;

  const chatContext = chatContextService.getChatContext(ctx);
  if (!chatContext || !chatContext.isGroup) {
    return ctx.reply('⚠️ This command only works in group chats.');
  }

  const isAdmin = await chatContextService.isGroupAdmin(chatContext.chatId, chatContext.userId);
  if (!isAdmin) {
    return ctx.reply('⚠️ Only group admins can change settings.');
  }

  try {
    const settings = await chatContextService.getGroupSettings(chatContext.chatId);
    if (!settings) {
      return ctx.reply('⚠️ Group not configured. Run /groupsetup first.');
    }

    const updates: Partial<GroupSettings> = {};
    let message = '';

    switch (type) {
      case 'smart_money':
        updates.enableSmartMoneyAlerts = !settings.enableSmartMoneyAlerts;
        message = `Smart Money alerts ${updates.enableSmartMoneyAlerts ? 'enabled' : 'disabled'}`;
        break;
      case 'rugs':
        updates.enableRugWarnings = !settings.enableRugWarnings;
        message = `Rug warnings ${updates.enableRugWarnings ? 'enabled' : 'disabled'}`;
        break;
      case 'signals':
        updates.enableSignals = !settings.enableSignals;
        message = `Trading signals ${updates.enableSignals ? 'enabled' : 'disabled'}`;
        break;
      case 'volume':
        updates.enableVolumeSpikes = !settings.enableVolumeSpikes;
        message = `Volume spike alerts ${updates.enableVolumeSpikes ? 'enabled' : 'disabled'}`;
        break;
    }

    await chatContextService.updateGroupSettings(chatContext.chatId, updates);
    await ctx.reply(`✅ ${message}`);
  } catch (error) {
    await ctx.reply('❌ Failed to update setting.');
  }
}

function formatGroupSettings(settings: GroupSettings): string {
  return `*📊 Group Configuration*\n\n` +
    `*Quality Filters:*\n` +
    `📈 Min Risk Score: ${settings.minRiskScore}/100\n` +
    `💧 Min Liquidity: $${settings.minLiquidityUsd.toLocaleString()}\n` +
    `🔔 Max Alerts/Hour: ${settings.maxAlertsPerHour}\n\n` +
    `*Alert Types:*\n` +
    `${settings.enableTokenAlerts ? '✅' : '❌'} Token Alerts\n` +
    `${settings.enableSmartMoneyAlerts ? '✅' : '❌'} Smart Money Moves\n` +
    `${settings.enableRugWarnings ? '✅' : '❌'} Rug Warnings\n` +
    `${settings.enableSignals ? '✅' : '❌'} Trading Signals\n` +
    `${settings.enableVolumeSpikes ? '✅' : '❌'} Volume Spikes\n\n` +
    `*Features:*\n` +
    `${settings.enableGroupWatchlist ? '✅' : '❌'} Group Watchlist\n` +
    `${settings.enableLeaderboard ? '✅' : '❌'} Leaderboard\n` +
    `${settings.enableMorningBriefing ? '✅' : '❌'} Morning Briefing\n\n` +
    `*Quick Commands:*\n` +
    `/setminrisk <score> - Change min risk\n` +
    `/setminliq <amount> - Change min liquidity\n` +
    `/setmaxalerts <count> - Change alert limit\n` +
    `/togglesmartmoney - Toggle smart money alerts\n` +
    `/togglerugs - Toggle rug warnings\n` +
    `/togglesignals - Toggle trading signals\n` +
    `/togglevolume - Toggle volume spikes`;
}
