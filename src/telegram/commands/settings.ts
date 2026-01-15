import { Context, Telegraf } from 'telegraf';
import { storageService } from '../../services/storage';

const VALID_TIMEZONES = [
  'UTC', 'America/New_York', 'America/Los_Angeles', 'America/Chicago',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo',
  'Asia/Shanghai', 'Asia/Singapore', 'Australia/Sydney',
];

export function registerSettingsCommands(bot: Telegraf): void {
  // /timezone command
  bot.command('timezone', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      const settings = storageService.getUserSettings(chatId);
      const tzList = VALID_TIMEZONES.map(tz =>
        `• <code>${tz}</code>${tz === settings.filters.timezone ? ' ✓' : ''}`
      ).join('\n');

      await ctx.replyWithHTML(
        `<b>Timezone Setting</b>\n\n` +
        `Current: <code>${settings.filters.timezone}</code>\n\n` +
        `<b>Available:</b>\n${tzList}\n\n` +
        `Usage: <code>/timezone [zone]</code>`
      );
      return;
    }

    const timezone = args[0];

    // Simple validation - check if it looks like a timezone
    if (!timezone.includes('/') && timezone !== 'UTC') {
      await ctx.replyWithHTML(
        `❌ Invalid timezone format.\n\n` +
        `Use format like: <code>America/New_York</code> or <code>UTC</code>`
      );
      return;
    }

    storageService.setTimezone(chatId, timezone);

    await ctx.replyWithHTML(`✅ Timezone set to <code>${timezone}</code>`);
  });

  // /quiet command
  bot.command('quiet', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      const settings = storageService.getUserSettings(chatId);
      const { quietHoursStart, quietHoursEnd } = settings.filters;

      if (quietHoursStart !== undefined && quietHoursEnd !== undefined) {
        await ctx.replyWithHTML(
          `<b>Quiet Hours</b>\n\n` +
          `Current: ${quietHoursStart}:00 - ${quietHoursEnd}:00\n` +
          `Timezone: ${settings.filters.timezone}\n\n` +
          `No alerts will be sent during quiet hours.\n\n` +
          `Usage: <code>/quiet [start_hour] [end_hour]</code>\n` +
          `Example: <code>/quiet 22 8</code> (10 PM to 8 AM)\n\n` +
          `To disable: <code>/quiet off</code>`
        );
      } else {
        await ctx.replyWithHTML(
          `<b>Quiet Hours</b>\n\n` +
          `Status: <b>Not set</b>\n\n` +
          `Set quiet hours to pause alerts during specific times.\n\n` +
          `Usage: <code>/quiet [start_hour] [end_hour]</code>\n` +
          `Example: <code>/quiet 22 8</code> (10 PM to 8 AM)`
        );
      }
      return;
    }

    // Handle /quiet off
    if (args[0].toLowerCase() === 'off') {
      storageService.setQuietHours(chatId, undefined, undefined);
      await ctx.replyWithHTML(`✅ Quiet hours disabled. You'll receive alerts 24/7.`);
      return;
    }

    if (args.length < 2) {
      await ctx.replyWithHTML(
        `Usage: <code>/quiet [start_hour] [end_hour]</code>\n` +
        `Example: <code>/quiet 22 8</code> (10 PM to 8 AM)\n\n` +
        `Hours are in 24-hour format (0-23).`
      );
      return;
    }

    const start = parseInt(args[0], 10);
    const end = parseInt(args[1], 10);

    if (isNaN(start) || isNaN(end) || start < 0 || start > 23 || end < 0 || end > 23) {
      await ctx.replyWithHTML(`❌ Invalid hours. Use 0-23 format.`);
      return;
    }

    storageService.setQuietHours(chatId, start, end);

    const settings = storageService.getUserSettings(chatId);

    await ctx.replyWithHTML(
      `✅ Quiet hours set!\n\n` +
      `No alerts from <b>${start}:00</b> to <b>${end}:00</b>\n` +
      `Timezone: ${settings.filters.timezone}`
    );
  });

  // Handle set_quiet callback
  bot.action('set_quiet', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.replyWithHTML(
      `<b>Set Quiet Hours</b>\n\n` +
      `Usage: <code>/quiet [start_hour] [end_hour]</code>\n` +
      `Example: <code>/quiet 22 8</code> (10 PM to 8 AM)\n\n` +
      `Hours are in 24-hour format (0-23).`
    );
  });

  // Handle noop callback
  bot.action('noop', async (ctx) => {
    await ctx.answerCbQuery();
  });
}
