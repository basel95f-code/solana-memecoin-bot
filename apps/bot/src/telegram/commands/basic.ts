import type { Context, Telegraf } from 'telegraf';
import { formatHelp, formatStats, formatMainMenu, formatMarketMenu, formatAlertsMenu, formatAnalyzeMenu } from '../formatters';
import { mainMenuKeyboard, marketKeyboard, alertsKeyboard, backToMenuKeyboard } from '../keyboards';
import { config } from '../../config';
import { healthMonitor } from '../../services/retryService';
import { topicManager } from '../../services/topicManager';
import { chatContextService } from '../../services/chatContext';

let startTime = Date.now();
let tokensAnalyzed = 0;
let alertsSent = 0;

export function incrementTokensAnalyzed(): void {
  tokensAnalyzed++;
}

export function incrementAlertsSent(): void {
  alertsSent++;
}

export function registerBasicCommands(bot: Telegraf): void {
  startTime = Date.now();

  // /start command - now shows main menu
  bot.command('start', async (ctx: Context) => {
    await ctx.replyWithHTML(formatMainMenu(), mainMenuKeyboard());
  });

  // /menu command - main navigation
  bot.command('menu', async (ctx: Context) => {
    await ctx.replyWithHTML(formatMainMenu(), mainMenuKeyboard());
  });

  // Menu navigation callbacks
  bot.action('back_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(formatMainMenu(), {
      parse_mode: 'HTML',
      ...mainMenuKeyboard(),
    });
  });

  bot.action('menu_market', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(formatMarketMenu(), {
      parse_mode: 'HTML',
      ...marketKeyboard(),
    });
  });

  bot.action('menu_analyze', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(formatAnalyzeMenu(), {
      parse_mode: 'HTML',
      ...backToMenuKeyboard(),
    });
  });

  bot.action('menu_alerts', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(formatAlertsMenu(true), {
      parse_mode: 'HTML',
      ...alertsKeyboard(true),
    });
  });

  bot.action('menu_settings', async (ctx) => {
    await ctx.answerCbQuery();
    // Trigger settings command
    await ctx.reply('Loading settings...', backToMenuKeyboard());
  });

  bot.action('menu_stats', async (ctx) => {
    await ctx.answerCbQuery();
    const monitors = [];
    if (config.monitors.raydium.enabled) monitors.push('Raydium');
    if (config.monitors.pumpfun.enabled) monitors.push('Pump.fun');
    if (config.monitors.jupiter.enabled) monitors.push('Jupiter');

    const stats = formatStats({
      tokensAnalyzed,
      alertsSent,
      uptime: Date.now() - startTime,
      watchlistCount: 0,
      monitorsActive: monitors,
    });

    await ctx.editMessageText(stats, {
      parse_mode: 'HTML',
      ...backToMenuKeyboard(),
    });
  });

  bot.action('menu_watchlist', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Loading watchlist...', backToMenuKeyboard());
  });

  bot.action('cancel', async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    await ctx.deleteMessage();
  });

  bot.action('noop', async (ctx) => {
    await ctx.answerCbQuery();
  });

  // /help command - topic-aware
  bot.command('help', async (ctx: Context) => {
    // Check if in a forum topic
    const topicId = (ctx.message as any)?.message_thread_id;
    const chatId = ctx.chat?.id.toString();

    if (topicId && chatId) {
      // Get topic configuration
      const chatContext = chatContextService.getChatContext(ctx);
      if (chatContext?.isGroup) {
        const topicConfig = await topicManager.getTopicConfig(chatId, topicId);
        
        // If topic has restricted commands, show topic-specific help
        if (topicConfig?.allowedCommands && topicConfig.allowedCommands.length > 0) {
          let message = `ℹ️ *${topicConfig.topicName} - Available Commands*\n\n`;
          message += `This topic only allows these commands:\n\n`;
          
          const commands = topicConfig.allowedCommands.map(cmd => `/${cmd}`).join('\n');
          message += commands;
          
          message += `\n\n💬 For general discussion, use the General Chat topic.`;
          message += `\n📋 Use /topicinfo for more details.`;
          
          return ctx.reply(message, { 
            parse_mode: 'Markdown',
            message_thread_id: topicId 
          });
        }
      }
    }

    // Show full help
    await ctx.replyWithHTML(formatHelp(), backToMenuKeyboard());
  });

  // /status command
  bot.command('status', async (ctx: Context) => {
    const monitors = [];
    if (config.monitors.raydium.enabled) monitors.push('Raydium');
    if (config.monitors.pumpfun.enabled) monitors.push('Pump.fun');
    if (config.monitors.jupiter.enabled) monitors.push('Jupiter');

    const message = [
      `✅ <b>STATUS: ONLINE</b>`,
      ``,
      `Monitors: ${monitors.length > 0 ? monitors.join(', ') : 'None'}`,
      `Uptime: ${formatUptime(Date.now() - startTime)}`,
    ].join('\n');

    await ctx.replyWithHTML(message, backToMenuKeyboard());
  });

  // /stats command
  bot.command('stats', async (ctx: Context) => {
    const monitors = [];
    if (config.monitors.raydium.enabled) monitors.push('Raydium');
    if (config.monitors.pumpfun.enabled) monitors.push('Pump.fun');
    if (config.monitors.jupiter.enabled) monitors.push('Jupiter');

    const stats = formatStats({
      tokensAnalyzed,
      alertsSent,
      uptime: Date.now() - startTime,
      watchlistCount: 0,
      monitorsActive: monitors,
    });

    await ctx.replyWithHTML(stats, backToMenuKeyboard());
  });

  // /health command - service health status
  bot.command('health', async (ctx: Context) => {
    const status = healthMonitor.getStatus();

    let msg = '<b>🏥 Service Health</b>\n\n';

    if (status.size === 0) {
      msg += '<i>No services registered for health monitoring.</i>\n\n';
      msg += 'Health monitoring is enabled but no services have registered health checks yet.';
    } else {
      for (const [name, info] of status) {
        const healthIcon = info.healthy ? '🟢' : '🔴';
        const circuitIcon = info.circuitState === 'closed' ? '✅' :
                           info.circuitState === 'open' ? '🚫' : '⚠️';

        msg += `${healthIcon} <b>${name}</b>\n`;
        msg += `  Circuit: ${circuitIcon} ${info.circuitState}\n`;
        if (info.consecutiveFailures > 0) {
          msg += `  Failures: ${info.consecutiveFailures}\n`;
        }
        if (info.lastCheck > 0) {
          const ago = Math.floor((Date.now() - info.lastCheck) / 1000);
          msg += `  Last check: ${ago}s ago\n`;
        }
        msg += '\n';
      }
    }

    // Add system info
    const memUsage = process.memoryUsage();
    msg += '<b>System:</b>\n';
    msg += `Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB\n`;
    msg += `Uptime: ${formatUptime(Date.now() - startTime)}`;

    await ctx.replyWithHTML(msg, backToMenuKeyboard());
  });
}

function formatUptime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
