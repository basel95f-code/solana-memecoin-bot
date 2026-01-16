import type { Context, Telegraf } from 'telegraf';
import { formatHelp, formatStats } from '../formatters';
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

  // /start command
  bot.command('start', async (ctx: Context) => {
    const message = [
      `🚀 <b>Welcome to Solana Memecoin Monitor!</b>`,
      ``,
      `I monitor new tokens on Solana and alert you to potential opportunities.`,
      ``,
      `<b>Quick Start:</b>`,
      `• Alerts are <b>ON</b> by default`,
      `• Default filter: <b>Balanced</b>`,
      `• Type /help for all commands`,
      ``,
      `<b>Current Monitors:</b>`,
      config.monitors.raydium.enabled ? `✅ Raydium` : `❌ Raydium`,
      config.monitors.pumpfun.enabled ? `✅ Pump.fun` : `❌ Pump.fun`,
      config.monitors.jupiter.enabled ? `✅ Jupiter` : `❌ Jupiter`,
      ``,
      `<b>Popular Commands:</b>`,
      `/check [address] - Analyze a token`,
      `/filter - Change alert filter`,
      `/watchlist - Manage watchlist`,
      `/trending - See trending tokens`,
    ].join('\n');

    await ctx.replyWithHTML(message);
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
