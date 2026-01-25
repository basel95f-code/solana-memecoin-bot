import { Telegraf, Context } from 'telegraf';
import { topicManager } from '../services/topicManager';
import { logger } from '../utils/logger';

/**
 * Middleware to enforce topic-specific rules in Telegram forum groups
 * 
 * This middleware:
 * - Detects which topic a message is in (message_thread_id)
 * - Checks topic configuration (command_only, normal, read_only)
 * - Deletes messages that violate topic rules
 * - Sends helpful feedback to users
 */
export function registerTopicEnforcer(bot: Telegraf): void {
  bot.use(async (ctx: Context, next) => {
    try {
      // Skip if not a message
      if (!ctx.message) {
        return next();
      }

      // Get topic ID (message_thread_id for forum topics)
      const topicId = (ctx.message as any).message_thread_id;
      
      // Not in a topic - proceed normally
      if (!topicId) {
        return next();
      }

      const chatId = ctx.chat?.id.toString();
      if (!chatId) {
        return next();
      }

      // Get topic configuration
      const config = await topicManager.getTopicConfig(chatId, topicId);
      
      // No config or normal mode - proceed normally
      if (!config || config.mode === 'normal') {
        return next();
      }

      // Get message text
      const text = 'text' in ctx.message ? ctx.message.text : '';
      const isCommand = text?.startsWith('/');

      // Handle read_only mode
      if (config.mode === 'read_only') {
        // Only bot can post
        const botInfo = await ctx.telegram.getMe();
        if (ctx.from?.id !== botInfo.id) {
          await ctx.deleteMessage();
          await ctx.reply(
            `⚠️ **${config.topicName}** is read-only.\n` +
            `Only the bot can post here.`,
            {
              message_thread_id: topicId,
              parse_mode: 'Markdown',
            }
          );
          return; // Don't call next()
        }
      }

      // Handle command_only mode
      if (config.mode === 'command_only') {
        if (isCommand) {
          // Check if command is allowed (if allowedCommands specified)
          if (config.allowedCommands && config.allowedCommands.length > 0) {
            const command = text.split(' ')[0].substring(1).toLowerCase();
            
            // Remove bot username from command if present
            const cleanCommand = command.split('@')[0];
            
            if (!config.allowedCommands.includes(cleanCommand)) {
              await ctx.deleteMessage();
              
              // Show first 5 allowed commands
              const allowedDisplay = config.allowedCommands
                .slice(0, 5)
                .map(c => `/${c}`)
                .join(', ');
              
              const more = config.allowedCommands.length > 5 
                ? ` (+${config.allowedCommands.length - 5} more)`
                : '';
              
              await ctx.reply(
                `⚠️ This command is not allowed in **${config.topicName}**.\n\n` +
                `Allowed commands: ${allowedDisplay}${more}\n\n` +
                `Use /topicinfo for full list.`,
                {
                  message_thread_id: topicId,
                  parse_mode: 'Markdown',
                }
              );
              return; // Don't call next()
            }
          }
          
          // Command is allowed, proceed
          return next();
        } else {
          // Not a command, delete it
          await ctx.deleteMessage();
          await ctx.reply(
            `⚠️ Only bot commands allowed in **${config.topicName}**.\n\n` +
            `Use /help or /topicinfo for available commands, or move to General Chat for discussion.`,
            {
              message_thread_id: topicId,
              parse_mode: 'Markdown',
            }
          );
          return; // Don't call next()
        }
      }

      // All checks passed, proceed
      return next();
    } catch (error) {
      logger.error('TopicEnforcer', 'Error in topic enforcer middleware', error as Error);
      // On error, proceed to avoid breaking bot
      return next();
    }
  });

  logger.info('TopicEnforcer', 'Topic enforcer middleware registered');
}
