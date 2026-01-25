import { Telegraf, Context } from 'telegraf';
import { topicManager } from '../../services/topicManager';
import { chatContextService } from '../../services/chatContext';
import { TOPIC_PRESETS, getPreset, getPresetNames } from '../../config/topicPresets';
import type { TopicMode } from '../../services/topicManager';

/**
 * Register topic setup and configuration commands
 */
export function registerTopicSetupCommands(bot: Telegraf) {
  /**
   * /topicsetup - Show all configured topics for the group
   */
  bot.command('topicsetup', async (ctx: Context) => {
    if (!ctx.chat || !ctx.from) return;

    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext || !chatContext.isGroup) {
      return ctx.reply('⚠️ This command only works in group chats with forum topics enabled.');
    }

    try {
      const topics = await topicManager.getChatTopics(chatContext.chatId);

      if (topics.length === 0) {
        return ctx.reply(
          `📋 *Topic Configuration*\n\n` +
          `No topics configured yet.\n\n` +
          `To configure a topic:\n` +
          `1. Go to the topic you want to configure\n` +
          `2. Use /topicmode <mode>\n` +
          `3. Optionally use /topiccommands or /applypreset\n\n` +
          `Available presets: ${getPresetNames().join(', ')}`,
          { parse_mode: 'Markdown' }
        );
      }

      let message = `📋 *Topic Configuration*\n\n`;
      message += `Configured topics in this group:\n\n`;

      for (const topic of topics) {
        const modeEmoji = topic.mode === 'command_only' ? '🤖' :
                         topic.mode === 'read_only' ? '🔒' : '💬';
        
        message += `${modeEmoji} **${topic.topicName}**\n`;
        message += `   Mode: \`${topic.mode}\`\n`;
        
        if (topic.allowedCommands && topic.allowedCommands.length > 0) {
          const commands = topic.allowedCommands.slice(0, 5).join(', ');
          const more = topic.allowedCommands.length > 5 
            ? ` (+${topic.allowedCommands.length - 5} more)`
            : '';
          message += `   Commands: ${commands}${more}\n`;
        }
        
        message += '\n';
      }

      message += `\nUse /topicinfo in a topic for details.`;

      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      await ctx.reply('❌ Failed to load topic configuration.');
    }
  });

  /**
   * /topicmode <mode> - Set mode for current topic
   */
  bot.command('topicmode', async (ctx: Context) => {
    if (!ctx.chat || !ctx.from) return;

    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext || !chatContext.isGroup) {
      return ctx.reply('⚠️ This command only works in group chats with forum topics.');
    }

    // Check if user is admin
    const isAdmin = await chatContextService.isGroupAdmin(chatContext.chatId, chatContext.userId);
    if (!isAdmin) {
      const chatMember = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
      const isTelegramAdmin = ['creator', 'administrator'].includes(chatMember.status);
      
      if (!isTelegramAdmin) {
        return ctx.reply('⚠️ Only group admins can configure topics.');
      }
      
      // Add them as bot admin
      await chatContextService.addGroupAdmin(chatContext.chatId, chatContext.userId);
    }

    // Get topic ID
    const topicId = (ctx.message as any).message_thread_id;
    if (!topicId) {
      return ctx.reply('⚠️ This command must be used inside a forum topic.');
    }

    const text = 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ');
    
    if (args.length < 2) {
      return ctx.reply(
        `Usage: /topicmode <mode>\n\n` +
        `Available modes:\n` +
        `• \`command_only\` - Only bot commands allowed\n` +
        `• \`normal\` - All messages allowed (default)\n` +
        `• \`read_only\` - Only bot can post\n\n` +
        `Example: /topicmode command_only`,
        { parse_mode: 'Markdown', message_thread_id: topicId }
      );
    }

    const mode = args[1].toLowerCase() as TopicMode;
    const validModes: TopicMode[] = ['command_only', 'normal', 'read_only'];
    
    if (!validModes.includes(mode)) {
      return ctx.reply(
        `❌ Invalid mode. Must be one of: ${validModes.join(', ')}`,
        { message_thread_id: topicId }
      );
    }

    try {
      // Get topic name from Telegram (if available)
      // For now, use a placeholder - in production, fetch from forum topic info
      const topicName = args.slice(2).join(' ') || `Topic ${topicId}`;

      await topicManager.setTopicMode(chatContext.chatId, topicId, mode, topicName);

      const modeEmoji = mode === 'command_only' ? '🤖' :
                       mode === 'read_only' ? '🔒' : '💬';

      await ctx.reply(
        `✅ ${modeEmoji} Topic mode set to **${mode}**\n\n` +
        `${mode === 'command_only' ? 'Only bot commands will be allowed in this topic.\nUse /topiccommands to specify which commands.' :
          mode === 'read_only' ? 'Only the bot can post in this topic.' :
          'All messages are allowed in this topic.'}`,
        { parse_mode: 'Markdown', message_thread_id: topicId }
      );
    } catch (error) {
      await ctx.reply('❌ Failed to set topic mode.', { message_thread_id: topicId });
    }
  });

  /**
   * /topiccommands <commands> - Set allowed commands for current topic
   */
  bot.command('topiccommands', async (ctx: Context) => {
    if (!ctx.chat || !ctx.from) return;

    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext || !chatContext.isGroup) {
      return ctx.reply('⚠️ This command only works in group chats with forum topics.');
    }

    // Check if user is admin
    const isAdmin = await chatContextService.isGroupAdmin(chatContext.chatId, chatContext.userId);
    if (!isAdmin) {
      return ctx.reply('⚠️ Only group admins can configure topics.');
    }

    // Get topic ID
    const topicId = (ctx.message as any).message_thread_id;
    if (!topicId) {
      return ctx.reply('⚠️ This command must be used inside a forum topic.');
    }

    const text = 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ');
    
    if (args.length < 2) {
      return ctx.reply(
        `Usage: /topiccommands <command1,command2,...>\n\n` +
        `Example: /topiccommands check,scan,watch,holders\n\n` +
        `This restricts which commands can be used in a command_only topic.`,
        { parse_mode: 'Markdown', message_thread_id: topicId }
      );
    }

    // Parse commands (comma-separated)
    const commandsStr = args.slice(1).join(' ');
    const commands = commandsStr
      .split(',')
      .map(cmd => cmd.trim().toLowerCase())
      .filter(cmd => cmd.length > 0);

    if (commands.length === 0) {
      return ctx.reply('❌ No valid commands provided.', { message_thread_id: topicId });
    }

    try {
      await topicManager.setAllowedCommands(chatContext.chatId, topicId, commands);

      const commandList = commands.map(c => `/${c}`).join(', ');
      
      await ctx.reply(
        `✅ Allowed commands updated:\n\n${commandList}`,
        { message_thread_id: topicId }
      );
    } catch (error) {
      await ctx.reply('❌ Failed to update commands.', { message_thread_id: topicId });
    }
  });

  /**
   * /applypreset <preset_name> - Apply a preset configuration
   */
  bot.command('applypreset', async (ctx: Context) => {
    if (!ctx.chat || !ctx.from) return;

    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext || !chatContext.isGroup) {
      return ctx.reply('⚠️ This command only works in group chats with forum topics.');
    }

    // Check if user is admin
    const isAdmin = await chatContextService.isGroupAdmin(chatContext.chatId, chatContext.userId);
    if (!isAdmin) {
      return ctx.reply('⚠️ Only group admins can configure topics.');
    }

    // Get topic ID
    const topicId = (ctx.message as any).message_thread_id;
    if (!topicId) {
      return ctx.reply('⚠️ This command must be used inside a forum topic.');
    }

    const text = 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ');
    
    if (args.length < 2) {
      const presets = getPresetNames().join(', ');
      return ctx.reply(
        `Usage: /applypreset <preset_name>\n\n` +
        `Available presets:\n${presets}\n\n` +
        `Example: /applypreset token-scanner`,
        { message_thread_id: topicId }
      );
    }

    const presetName = args[1].toLowerCase();
    const preset = getPreset(presetName);

    if (!preset) {
      const presets = getPresetNames().join(', ');
      return ctx.reply(
        `❌ Unknown preset: ${presetName}\n\n` +
        `Available presets:\n${presets}`,
        { message_thread_id: topicId }
      );
    }

    try {
      // Use preset name as topic name (can be customized later)
      const topicName = presetName.split('-').map(w => 
        w.charAt(0).toUpperCase() + w.slice(1)
      ).join(' ');

      await topicManager.applyPreset(chatContext.chatId, topicId, topicName, preset);

      const modeEmoji = preset.mode === 'command_only' ? '🤖' :
                       preset.mode === 'read_only' ? '🔒' : '💬';

      let message = `✅ ${modeEmoji} Applied preset: **${presetName}**\n\n`;
      message += `Mode: \`${preset.mode}\`\n`;
      message += `Description: ${preset.description}\n\n`;

      if (preset.allowedCommands && preset.allowedCommands.length > 0) {
        const commands = preset.allowedCommands.slice(0, 10).map(c => `/${c}`).join(', ');
        const more = preset.allowedCommands.length > 10 
          ? `\n...and ${preset.allowedCommands.length - 10} more`
          : '';
        message += `Allowed commands:\n${commands}${more}`;
      }

      await ctx.reply(message, { parse_mode: 'Markdown', message_thread_id: topicId });
    } catch (error) {
      await ctx.reply('❌ Failed to apply preset.', { message_thread_id: topicId });
    }
  });

  /**
   * /topicinfo - Show info about current topic
   */
  bot.command('topicinfo', async (ctx: Context) => {
    if (!ctx.chat || !ctx.from) return;

    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext || !chatContext.isGroup) {
      return ctx.reply('⚠️ This command only works in group chats with forum topics.');
    }

    // Get topic ID
    const topicId = (ctx.message as any).message_thread_id;
    if (!topicId) {
      return ctx.reply('⚠️ This command must be used inside a forum topic.');
    }

    try {
      const config = await topicManager.getTopicConfig(chatContext.chatId, topicId);

      if (!config) {
        return ctx.reply(
          `ℹ️ *Topic Information*\n\n` +
          `Topic ID: \`${topicId}\`\n` +
          `Mode: \`normal\` (default)\n\n` +
          `This topic is not configured. All messages are allowed.\n\n` +
          `To configure, use /topicmode or /applypreset`,
          { parse_mode: 'Markdown', message_thread_id: topicId }
        );
      }

      const modeEmoji = config.mode === 'command_only' ? '🤖' :
                       config.mode === 'read_only' ? '🔒' : '💬';

      let message = `${modeEmoji} *${config.topicName}*\n\n`;
      message += `Topic ID: \`${topicId}\`\n`;
      message += `Mode: \`${config.mode}\`\n\n`;

      if (config.mode === 'command_only') {
        if (config.allowedCommands && config.allowedCommands.length > 0) {
          message += `*Allowed Commands:*\n`;
          const commands = config.allowedCommands.map(c => `/${c}`).join('\n');
          message += commands;
        } else {
          message += `All bot commands are allowed.`;
        }
      } else if (config.mode === 'read_only') {
        message += `Only the bot can post in this topic.`;
      } else {
        message += `All messages are allowed in this topic.`;
      }

      await ctx.reply(message, { parse_mode: 'Markdown', message_thread_id: topicId });
    } catch (error) {
      await ctx.reply('❌ Failed to load topic info.', { message_thread_id: topicId });
    }
  });

  /**
   * /topicpresets - List all available presets
   */
  bot.command('topicpresets', async (ctx: Context) => {
    let message = `📋 *Available Topic Presets*\n\n`;

    for (const [name, preset] of Object.entries(TOPIC_PRESETS)) {
      const modeEmoji = preset.mode === 'command_only' ? '🤖' :
                       preset.mode === 'read_only' ? '🔒' : '💬';
      
      message += `${modeEmoji} **${name}**\n`;
      message += `   ${preset.description}\n`;
      message += `   Mode: \`${preset.mode}\`\n`;
      
      if (preset.allowedCommands && preset.allowedCommands.length > 0) {
        message += `   Commands: ${preset.allowedCommands.length} available\n`;
      }
      
      message += '\n';
    }

    message += `\nUse /applypreset <name> in a topic to apply a preset.`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  });
}
