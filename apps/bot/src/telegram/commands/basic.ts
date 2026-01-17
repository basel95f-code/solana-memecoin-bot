import type { Context, Telegraf } from 'telegraf';
import { formatHelp, formatStats, formatMainMenu, formatMarketMenu, formatAlertsMenu, formatAnalyzeMenu } from '../formatters';
import { mainMenuKeyboard, marketKeyboard, alertsKeyboard, backToMenuKeyboard } from '../keyboards';
import { config } from '../../config';

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

  // /help command
  bot.command('help', async (ctx: Context) => {
    await ctx.replyWithHTML(formatHelp());
  });

  // /status command
  bot.command('status', async (ctx: Context) => {
    const monitors = [];
    if (config.monitors.raydium.enabled) monitors.push('Raydium');
    if (config.monitors.pumpfun.enabled) monitors.push('Pump.fun');
    if (config.monitors.jupiter.enabled) monitors.push('Jupiter');

    const message = [
      `✅ <b>Bot Status: ONLINE</b>`,
      ``,
      `<b>Monitors Active:</b> ${monitors.length > 0 ? monitors.join(', ') : 'None'}`,
      `<b>Watchlist:</b> ${config.watchlist.enabled ? 'Enabled' : 'Disabled'}`,
      `<b>Discovery:</b> ${config.discovery.enabled ? 'Enabled' : 'Disabled'}`,
      ``,
      `<b>Uptime:</b> ${formatUptime(Date.now() - startTime)}`,
    ].join('\n');

    await ctx.replyWithHTML(message);
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
      watchlistCount: 0, // Will be updated when storage is integrated
      monitorsActive: monitors,
    });

    await ctx.replyWithHTML(stats);
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
