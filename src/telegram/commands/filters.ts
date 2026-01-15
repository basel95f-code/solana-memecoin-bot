import { Context, Telegraf } from 'telegraf';
import { storageService } from '../../services/storage';
import { filterProfileKeyboard, settingsKeyboard } from '../keyboards';
import { formatSettings, formatFilterProfile } from '../formatters';
import { FilterProfile, FilterSettings } from '../../types';

const VALID_PROFILES: FilterProfile[] = ['conservative', 'balanced', 'aggressive', 'degen'];

const SETTABLE_PARAMS: Record<string, { key: keyof FilterSettings; parse: (v: string) => any; desc: string }> = {
  minliq: { key: 'minLiquidity', parse: (v) => parseInt(v, 10), desc: 'Min liquidity (USD)' },
  maxholders: { key: 'maxTop10Percent', parse: (v) => parseInt(v, 10), desc: 'Max top 10 holder %' },
  minholders: { key: 'minHolders', parse: (v) => parseInt(v, 10), desc: 'Min holder count' },
  minscore: { key: 'minRiskScore', parse: (v) => parseInt(v, 10), desc: 'Min risk score (0-100)' },
  minage: { key: 'minTokenAge', parse: (v) => parseInt(v, 10) * 60, desc: 'Min token age (minutes)' },
};

export function registerFilterCommands(bot: Telegraf): void {
  // /filter command
  bot.command('filter', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      // Show current filter profile
      const settings = storageService.getUserSettings(chatId);
      const profileInfo = formatFilterProfile(settings.filters.profile);

      await ctx.replyWithHTML(
        profileInfo + `\n\n<b>Choose a profile:</b>`,
        filterProfileKeyboard(settings.filters.profile)
      );
      return;
    }

    const profile = args[0].toLowerCase() as FilterProfile;

    if (!VALID_PROFILES.includes(profile)) {
      await ctx.replyWithHTML(
        `Unknown profile. Available profiles:\n\n` +
        `• <code>conservative</code> - Safe, established tokens\n` +
        `• <code>balanced</code> - Default, moderate risk\n` +
        `• <code>aggressive</code> - More signals, higher risk\n` +
        `• <code>degen</code> - Everything, DYOR\n\n` +
        `Usage: <code>/filter [profile]</code>`
      );
      return;
    }

    storageService.setFilterProfile(chatId, profile);
    const profileInfo = formatFilterProfile(profile);

    await ctx.replyWithHTML(`✅ Filter profile updated!\n\n${profileInfo}`);
  });

  // /set command
  bot.command('set', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length < 2) {
      const paramList = Object.entries(SETTABLE_PARAMS)
        .map(([name, info]) => `• <code>${name}</code> - ${info.desc}`)
        .join('\n');

      await ctx.replyWithHTML(
        `<b>Set Filter Parameter</b>\n\n` +
        `Usage: <code>/set [param] [value]</code>\n\n` +
        `<b>Available parameters:</b>\n${paramList}\n\n` +
        `Example: <code>/set minliq 5000</code>`
      );
      return;
    }

    const paramName = args[0].toLowerCase();
    const paramValue = args[1];

    const paramInfo = SETTABLE_PARAMS[paramName];
    if (!paramInfo) {
      await ctx.replyWithHTML(`Unknown parameter: <code>${paramName}</code>\n\nUse <code>/set</code> to see available parameters.`);
      return;
    }

    const parsedValue = paramInfo.parse(paramValue);
    if (isNaN(parsedValue) || parsedValue < 0) {
      await ctx.replyWithHTML(`Invalid value for ${paramName}. Please enter a positive number.`);
      return;
    }

    storageService.setFilterParam(chatId, paramInfo.key, parsedValue);

    await ctx.replyWithHTML(
      `✅ <b>${paramInfo.desc}</b> set to <code>${paramValue}</code>\n\n` +
      `<i>Note: Profile switched to "custom"</i>`
    );
  });

  // /reset command
  bot.command('reset', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args[0]?.toLowerCase() === 'filters') {
      storageService.resetFilters(chatId);
      await ctx.replyWithHTML(
        `✅ Filters reset to <b>Balanced</b> profile.\n\n` +
        `Use <code>/filter</code> to see current settings.`
      );
    } else {
      await ctx.replyWithHTML(`Usage: <code>/reset filters</code>`);
    }
  });

  // /settings command
  bot.command('settings', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const settings = storageService.getUserSettings(chatId);
    const formatted = formatSettings(settings.filters);

    await ctx.replyWithHTML(formatted, settingsKeyboard(settings.filters));
  });

  // Handle callback queries for filter buttons
  bot.action(/^filter_(.+)$/, async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const profile = ctx.match[1] as FilterProfile;

    if (VALID_PROFILES.includes(profile)) {
      storageService.setFilterProfile(chatId, profile);
      const profileInfo = formatFilterProfile(profile);

      await ctx.answerCbQuery(`Profile set to ${profile}`);
      await ctx.editMessageText(
        `✅ Filter profile updated!\n\n${profileInfo}`,
        { parse_mode: 'HTML' }
      );
    }
  });

  bot.action('show_filters', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const settings = storageService.getUserSettings(chatId);

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `Choose a filter profile:`,
      { ...filterProfileKeyboard(settings.filters.profile), parse_mode: 'HTML' }
    );
  });

  bot.action('toggle_alerts', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const settings = storageService.getUserSettings(chatId);
    const newState = !settings.filters.alertsEnabled;
    storageService.setAlertsEnabled(chatId, newState);

    await ctx.answerCbQuery(newState ? 'Alerts enabled' : 'Alerts disabled');

    const updatedSettings = storageService.getUserSettings(chatId);
    const formatted = formatSettings(updatedSettings.filters);
    await ctx.editMessageText(formatted, { ...settingsKeyboard(updatedSettings.filters), parse_mode: 'HTML' });
  });

  bot.action('reset_filters', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    storageService.resetFilters(chatId);

    await ctx.answerCbQuery('Filters reset');

    const settings = storageService.getUserSettings(chatId);
    const formatted = formatSettings(settings.filters);
    await ctx.editMessageText(formatted, { ...settingsKeyboard(settings.filters), parse_mode: 'HTML' });
  });
}
