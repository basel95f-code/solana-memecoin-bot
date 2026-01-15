import { Context, Telegraf } from 'telegraf';
import { storageService } from '../../services/storage';

export function registerAlertCommands(bot: Telegraf): void {
  // /alerts command (show status or toggle)
  bot.command('alerts', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      // Show current status
      const settings = storageService.getUserSettings(chatId);
      const isMuted = storageService.isAlertsMuted(chatId);

      let statusMsg: string;
      if (!settings.filters.alertsEnabled) {
        statusMsg = `🔕 Alerts are <b>OFF</b>\n\nUse <code>/alerts on</code> to enable.`;
      } else if (isMuted) {
        const muteRemaining = settings.muteUntil ? Math.ceil((settings.muteUntil - Date.now()) / 60000) : 0;
        statusMsg = `🔇 Alerts are <b>MUTED</b> (${muteRemaining} min remaining)\n\nUse <code>/alerts on</code> to unmute.`;
      } else {
        statusMsg = `🔔 Alerts are <b>ON</b>\n\nUse <code>/alerts off</code> to disable.`;
      }

      await ctx.replyWithHTML(statusMsg);
      return;
    }

    const action = args[0].toLowerCase();

    if (action === 'on') {
      storageService.setAlertsEnabled(chatId, true);
      storageService.setMuteUntil(chatId, undefined);
      await ctx.replyWithHTML(`🔔 Alerts <b>enabled</b>!\n\nYou will receive new token alerts.`);
    } else if (action === 'off') {
      storageService.setAlertsEnabled(chatId, false);
      await ctx.replyWithHTML(`🔕 Alerts <b>disabled</b>.\n\nUse <code>/alerts on</code> to re-enable.`);
    } else {
      await ctx.replyWithHTML(`Unknown option. Use <code>/alerts on</code> or <code>/alerts off</code>`);
    }
  });

  // /mute command
  bot.command('mute', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    let minutes = 30; // Default 30 minutes

    if (args.length > 0) {
      const parsed = parseInt(args[0], 10);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 1440) {
        minutes = parsed;
      } else {
        await ctx.replyWithHTML(`Invalid duration. Use <code>/mute [1-1440]</code> (minutes)`);
        return;
      }
    }

    const muteUntil = Date.now() + (minutes * 60 * 1000);
    storageService.setMuteUntil(chatId, muteUntil);

    await ctx.replyWithHTML(
      `🔇 Alerts <b>muted</b> for ${minutes} minutes.\n\n` +
      `Unmute at: ${new Date(muteUntil).toLocaleTimeString()}\n\n` +
      `Use <code>/alerts on</code> to unmute early.`
    );
  });
}
