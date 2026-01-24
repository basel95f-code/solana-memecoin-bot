import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { storageService } from '../../services/storage';
import { telegramMtprotoService } from '../../services/telegramMtproto';
import { discordBotService } from '../../services/discordBot';
import { config } from '../../config';
import type { MonitoredChannel } from '../../types';

function formatSentimentStatus(chatId: string): string {
  const channels = storageService.getSentimentChannels(chatId);

  let msg = '<b>Multi-Platform Sentiment Settings</b>\n\n';

  // Master status
  msg += `Status: ${channels.enabled ? '🟢 <b>Enabled</b>' : '⚫ <b>Disabled</b>'}\n\n`;

  // Platform status
  msg += '<b>Platform Status:</b>\n';
  msg += `Twitter: ${config.sentiment.twitterEnabled ? '🟢 Enabled' : '⚫ Disabled'}\n`;
  msg += `Telegram: ${config.sentiment.telegramEnabled ? (telegramMtprotoService.isReady() ? '🟢 Connected' : '🟡 Disconnected') : '⚫ Disabled'}\n`;
  msg += `Discord: ${config.sentiment.discordEnabled ? (discordBotService.isReady() ? '🟢 Connected' : '🟡 Disconnected') : '⚫ Disabled'}\n\n`;

  // Telegram channels
  msg += '<b>Telegram Channels:</b>\n';
  if (channels.telegramChannels.length === 0) {
    msg += '<i>None configured</i>\n';
  } else {
    for (const channel of channels.telegramChannels) {
      msg += `  - ${channel.name}\n`;
    }
  }
  msg += '\n';

  // Discord channels
  msg += '<b>Discord Channels:</b>\n';
  if (channels.discordChannels.length === 0) {
    msg += '<i>None configured</i>\n';
  } else {
    for (const channel of channels.discordChannels) {
      msg += `  - ${channel.name}\n`;
    }
  }

  msg += '\n<i>Use buttons below to manage channels</i>';

  return msg;
}

function getSentimentKeyboard(chatId: string) {
  const channels = storageService.getSentimentChannels(chatId);
  const buttons: any[][] = [];

  // Toggle button
  buttons.push([
    Markup.button.callback(
      channels.enabled ? '⚫ Disable Multi-Platform' : '🟢 Enable Multi-Platform',
      'sentiment_toggle'
    ),
  ]);

  // Add channel buttons
  if (config.sentiment.telegramEnabled) {
    buttons.push([
      Markup.button.callback('+ Add Telegram Channel', 'sentiment_add_tg_prompt'),
    ]);
  }

  if (config.sentiment.discordEnabled) {
    buttons.push([
      Markup.button.callback('+ Add Discord Channel', 'sentiment_add_discord_prompt'),
      Markup.button.callback('List Discord Channels', 'sentiment_list_discord'),
    ]);
  }

  // Remove channels if any exist
  if (channels.telegramChannels.length > 0 || channels.discordChannels.length > 0) {
    buttons.push([
      Markup.button.callback('Remove Channel', 'sentiment_remove_menu'),
    ]);
  }

  // Clear all
  if (channels.telegramChannels.length > 0 || channels.discordChannels.length > 0) {
    buttons.push([
      Markup.button.callback('Clear All Channels', 'sentiment_clear_all'),
    ]);
  }

  return Markup.inlineKeyboard(buttons);
}

function getRemoveChannelKeyboard(chatId: string) {
  const channels = storageService.getSentimentChannels(chatId);
  const buttons: any[][] = [];

  // Telegram channels
  for (const channel of channels.telegramChannels) {
    buttons.push([
      Markup.button.callback(`TG: ${channel.name}`, `sentiment_remove_tg_${channel.id}`),
    ]);
  }

  // Discord channels
  for (const channel of channels.discordChannels) {
    buttons.push([
      Markup.button.callback(`Discord: ${channel.name}`, `sentiment_remove_discord_${channel.id}`),
    ]);
  }

  // Back button
  buttons.push([
    Markup.button.callback('« Back', 'sentiment_back'),
  ]);

  return Markup.inlineKeyboard(buttons);
}

export function registerSentimentCommands(bot: Telegraf): void {
  // /sentiment command - show settings and manage channels
  bot.command('sentiment', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    // No args - show interactive menu
    if (args.length === 0) {
      const statusMsg = formatSentimentStatus(chatId);
      await ctx.replyWithHTML(statusMsg, getSentimentKeyboard(chatId));
      return;
    }

    const action = args[0].toLowerCase();

    // /sentiment toggle
    if (action === 'toggle') {
      const newState = storageService.toggleSentimentChannels(chatId);
      await ctx.replyWithHTML(
        `Multi-platform sentiment: ${newState ? '🟢 <b>Enabled</b>' : '⚫ <b>Disabled</b>'}`
      );
      return;
    }

    // /sentiment add tg @channel
    if (action === 'add' && args.length >= 3) {
      const platform = args[1].toLowerCase();
      const channelId = args.slice(2).join(' ');

      if (platform === 'tg' || platform === 'telegram') {
        if (!config.sentiment.telegramEnabled) {
          await ctx.replyWithHTML('Telegram sentiment is disabled in config.');
          return;
        }

        // Get channel info if possible
        let channelName = channelId;
        if (telegramMtprotoService.isReady()) {
          const info = await telegramMtprotoService.getChannelInfo(channelId);
          if (info) {
            channelName = info.title;
          }
        }

        const channel: MonitoredChannel = {
          id: channelId,
          name: channelName,
          platform: 'telegram',
          addedAt: Date.now(),
        };

        storageService.addSentimentChannel(chatId, channel);
        await ctx.replyWithHTML(`Added Telegram channel: <b>${channelName}</b>`);
        return;
      }

      if (platform === 'discord') {
        if (!config.sentiment.discordEnabled) {
          await ctx.replyWithHTML('Discord sentiment is disabled in config.');
          return;
        }

        // Get channel info if possible
        let channelName = channelId;
        if (discordBotService.isReady()) {
          const info = await discordBotService.getChannelInfo(channelId);
          if (info) {
            channelName = `${info.guildName} > ${info.name}`;
          }
        }

        const channel: MonitoredChannel = {
          id: channelId,
          name: channelName,
          platform: 'discord',
          addedAt: Date.now(),
        };

        storageService.addSentimentChannel(chatId, channel);
        await ctx.replyWithHTML(`Added Discord channel: <b>${channelName}</b>`);
        return;
      }

      await ctx.replyWithHTML(
        `Unknown platform: <code>${platform}</code>\n\n` +
        `Use: <code>/sentiment add tg @channel</code> or <code>/sentiment add discord [ID]</code>`
      );
      return;
    }

    // /sentiment remove tg @channel or /sentiment remove discord [ID]
    if (action === 'remove' && args.length >= 3) {
      const platform = args[1].toLowerCase();
      const channelId = args.slice(2).join(' ');

      if (platform === 'tg' || platform === 'telegram') {
        storageService.removeSentimentChannel(chatId, channelId, 'telegram');
        await ctx.replyWithHTML(`Removed Telegram channel: <b>${channelId}</b>`);
        return;
      }

      if (platform === 'discord') {
        storageService.removeSentimentChannel(chatId, channelId, 'discord');
        await ctx.replyWithHTML(`Removed Discord channel: <b>${channelId}</b>`);
        return;
      }

      await ctx.replyWithHTML(
        `Unknown platform: <code>${platform}</code>\n\n` +
        `Use: <code>/sentiment remove tg @channel</code> or <code>/sentiment remove discord [ID]</code>`
      );
      return;
    }

    // /sentiment list discord
    if (action === 'list' && args[1]?.toLowerCase() === 'discord') {
      if (!discordBotService.isReady()) {
        await ctx.replyWithHTML('Discord bot is not connected.');
        return;
      }

      const channels = await discordBotService.listAvailableChannels();

      if (channels.length === 0) {
        await ctx.replyWithHTML(
          'No accessible channels found.\n\n' +
          '<i>Make sure the bot has joined servers and has permission to read channels.</i>'
        );
        return;
      }

      let msg = '<b>Available Discord Channels:</b>\n\n';
      const grouped: Record<string, typeof channels> = {};

      for (const channel of channels) {
        if (!grouped[channel.guildName]) {
          grouped[channel.guildName] = [];
        }
        grouped[channel.guildName].push(channel);
      }

      for (const [guildName, guildChannels] of Object.entries(grouped)) {
        msg += `<b>${guildName}</b>\n`;
        for (const channel of guildChannels.slice(0, 10)) {
          msg += `  #${channel.name} - <code>${channel.id}</code>\n`;
        }
        if (guildChannels.length > 10) {
          msg += `  <i>...and ${guildChannels.length - 10} more</i>\n`;
        }
        msg += '\n';
      }

      msg += '<i>Use: <code>/sentiment add discord [ID]</code> to add</i>';

      await ctx.replyWithHTML(msg);
      return;
    }

    // /sentiment help
    if (action === 'help') {
      let helpMsg = '<b>Sentiment Commands</b>\n\n';
      helpMsg += '<code>/sentiment</code> - Interactive settings menu\n';
      helpMsg += '<code>/sentiment toggle</code> - Enable/disable multi-platform\n';
      helpMsg += '<code>/sentiment add tg @channel</code> - Add Telegram channel\n';
      helpMsg += '<code>/sentiment add discord [ID]</code> - Add Discord channel\n';
      helpMsg += '<code>/sentiment remove tg @channel</code> - Remove Telegram channel\n';
      helpMsg += '<code>/sentiment remove discord [ID]</code> - Remove Discord channel\n';
      helpMsg += '<code>/sentiment list discord</code> - List available Discord channels\n';

      await ctx.replyWithHTML(helpMsg);
      return;
    }

    await ctx.replyWithHTML(
      `Unknown option: <code>${action}</code>\n\n` +
      `Use <code>/sentiment</code> for settings or <code>/sentiment help</code> for commands.`
    );
  });

  // Handle toggle callback
  bot.action('sentiment_toggle', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const newState = storageService.toggleSentimentChannels(chatId);
    await ctx.answerCbQuery(`Multi-platform: ${newState ? 'ON' : 'OFF'}`);

    const statusMsg = formatSentimentStatus(chatId);
    await ctx.editMessageText(statusMsg, {
      parse_mode: 'HTML',
      ...getSentimentKeyboard(chatId),
    });
  });

  // Handle add telegram prompt
  bot.action('sentiment_add_tg_prompt', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    await ctx.answerCbQuery();
    await ctx.replyWithHTML(
      '<b>Add Telegram Channel</b>\n\n' +
      'Send the channel username (with @ symbol):\n' +
      '<code>/sentiment add tg @channelname</code>\n\n' +
      'Example: <code>/sentiment add tg @solana</code>'
    );
  });

  // Handle add discord prompt
  bot.action('sentiment_add_discord_prompt', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    await ctx.answerCbQuery();
    await ctx.replyWithHTML(
      '<b>Add Discord Channel</b>\n\n' +
      'Send the channel ID:\n' +
      '<code>/sentiment add discord 123456789</code>\n\n' +
      'Use <code>/sentiment list discord</code> to see available channels.'
    );
  });

  // Handle list discord channels
  bot.action('sentiment_list_discord', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    await ctx.answerCbQuery();

    if (!discordBotService.isReady()) {
      await ctx.replyWithHTML('Discord bot is not connected.');
      return;
    }

    const channels = await discordBotService.listAvailableChannels();

    if (channels.length === 0) {
      await ctx.replyWithHTML(
        'No accessible channels found.\n\n' +
        '<i>Make sure the bot has joined servers and has permission to read channels.</i>'
      );
      return;
    }

    let msg = '<b>Available Discord Channels:</b>\n\n';
    const grouped: Record<string, typeof channels> = {};

    for (const channel of channels) {
      if (!grouped[channel.guildName]) {
        grouped[channel.guildName] = [];
      }
      grouped[channel.guildName].push(channel);
    }

    for (const [guildName, guildChannels] of Object.entries(grouped)) {
      msg += `<b>${guildName}</b>\n`;
      for (const channel of guildChannels.slice(0, 5)) {
        msg += `  #${channel.name} - <code>${channel.id}</code>\n`;
      }
      if (guildChannels.length > 5) {
        msg += `  <i>...and ${guildChannels.length - 5} more</i>\n`;
      }
      msg += '\n';
    }

    msg += '<i>Use: <code>/sentiment add discord [ID]</code> to add</i>';

    await ctx.replyWithHTML(msg);
  });

  // Handle remove menu
  bot.action('sentiment_remove_menu', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    await ctx.answerCbQuery();

    await ctx.editMessageText(
      '<b>Remove Channel</b>\n\nSelect a channel to remove:',
      {
        parse_mode: 'HTML',
        ...getRemoveChannelKeyboard(chatId),
      }
    );
  });

  // Handle remove telegram channel
  bot.action(/^sentiment_remove_tg_(.+)$/, async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const channelId = ctx.match[1];
    storageService.removeSentimentChannel(chatId, channelId, 'telegram');
    await ctx.answerCbQuery('Channel removed');

    const statusMsg = formatSentimentStatus(chatId);
    await ctx.editMessageText(statusMsg, {
      parse_mode: 'HTML',
      ...getSentimentKeyboard(chatId),
    });
  });

  // Handle remove discord channel
  bot.action(/^sentiment_remove_discord_(.+)$/, async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const channelId = ctx.match[1];
    storageService.removeSentimentChannel(chatId, channelId, 'discord');
    await ctx.answerCbQuery('Channel removed');

    const statusMsg = formatSentimentStatus(chatId);
    await ctx.editMessageText(statusMsg, {
      parse_mode: 'HTML',
      ...getSentimentKeyboard(chatId),
    });
  });

  // Handle clear all
  bot.action('sentiment_clear_all', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    storageService.clearSentimentChannels(chatId);
    await ctx.answerCbQuery('All channels cleared');

    const statusMsg = formatSentimentStatus(chatId);
    await ctx.editMessageText(statusMsg, {
      parse_mode: 'HTML',
      ...getSentimentKeyboard(chatId),
    });
  });

  // Handle back button
  bot.action('sentiment_back', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    await ctx.answerCbQuery();

    const statusMsg = formatSentimentStatus(chatId);
    await ctx.editMessageText(statusMsg, {
      parse_mode: 'HTML',
      ...getSentimentKeyboard(chatId),
    });
  });
}
