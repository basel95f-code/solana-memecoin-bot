import { Context, Telegraf } from 'telegraf';
import { storageService } from '../../services/storage';
import { filterProfileKeyboard, settingsKeyboard } from '../keyboards';
import { formatSettings, formatFilterProfile } from '../formatters';
import { FilterProfile, FilterSettings, FILTER_PRESETS } from '../../types';

// All available profiles organized by category
const RISK_PROFILES: FilterProfile[] = ['sniper', 'early', 'balanced', 'conservative', 'graduation', 'whale', 'degen', 'cto'];
const MCAP_PROFILES: FilterProfile[] = ['micro', 'small', 'mid', 'large', 'mega'];
const STRATEGY_PROFILES: FilterProfile[] = ['trending', 'momentum', 'fresh', 'revival', 'runner'];
const ALL_PROFILES: FilterProfile[] = [...RISK_PROFILES, ...MCAP_PROFILES, ...STRATEGY_PROFILES];

// Profile descriptions with emojis
const PROFILE_INFO: Record<FilterProfile, { emoji: string; desc: string; category: string }> = {
  // Risk-based
  sniper: { emoji: '🎯', desc: 'Catch at birth, max risk', category: 'Risk' },
  early: { emoji: '⚡', desc: 'Early entry, basic safety', category: 'Risk' },
  balanced: { emoji: '⚖️', desc: 'Default, moderate risk', category: 'Risk' },
  conservative: { emoji: '🛡️', desc: 'Safe, established tokens', category: 'Risk' },
  graduation: { emoji: '🎓', desc: 'Pump.fun graduation tracking', category: 'Risk' },
  whale: { emoji: '🐋', desc: 'Whale activity alerts', category: 'Risk' },
  degen: { emoji: '🎰', desc: 'Alert on everything', category: 'Risk' },
  cto: { emoji: '🔍', desc: 'Community takeover plays', category: 'Risk' },
  // Market cap
  micro: { emoji: '💎', desc: 'MCap $1K-$50K, high risk gems', category: 'MCap' },
  small: { emoji: '🥉', desc: 'MCap $50K-$500K', category: 'MCap' },
  mid: { emoji: '🥈', desc: 'MCap $500K-$5M', category: 'MCap' },
  large: { emoji: '🥇', desc: 'MCap $5M-$50M, safer', category: 'MCap' },
  mega: { emoji: '👑', desc: 'MCap $50M+, blue chips', category: 'MCap' },
  // Strategy
  trending: { emoji: '🔥', desc: 'Volume spike 3x+', category: 'Strategy' },
  momentum: { emoji: '📈', desc: 'Price up 50%+ in 1h', category: 'Strategy' },
  fresh: { emoji: '🆕', desc: 'Token age < 5 min', category: 'Strategy' },
  revival: { emoji: '💀', desc: 'Down 80%, volume comeback', category: 'Strategy' },
  runner: { emoji: '🏃', desc: 'Up 100%+ today', category: 'Strategy' },
  custom: { emoji: '⚙️', desc: 'Custom settings', category: 'Custom' },
};

const SETTABLE_PARAMS: Record<string, { key: keyof FilterSettings; parse: (v: string) => any; desc: string }> = {
  // Liquidity
  minliq: { key: 'minLiquidity', parse: (v) => parseInt(v, 10), desc: 'Min liquidity (USD)' },
  maxliq: { key: 'maxLiquidity', parse: (v) => parseInt(v, 10), desc: 'Max liquidity (USD)' },
  // Holders
  maxholders: { key: 'maxTop10Percent', parse: (v) => parseInt(v, 10), desc: 'Max top 10 holder %' },
  maxsingle: { key: 'maxSingleHolderPercent', parse: (v) => parseInt(v, 10), desc: 'Max single holder %' },
  minholders: { key: 'minHolders', parse: (v) => parseInt(v, 10), desc: 'Min holder count' },
  // Scores
  minscore: { key: 'minRiskScore', parse: (v) => parseInt(v, 10), desc: 'Min risk score (0-100)' },
  // Age (input in minutes, stored in seconds)
  minage: { key: 'minTokenAge', parse: (v) => parseInt(v, 10) * 60, desc: 'Min token age (minutes)' },
  maxage: { key: 'maxTokenAge', parse: (v) => parseInt(v, 10) * 60, desc: 'Max token age (minutes)' },
  // Market cap
  minmcap: { key: 'minMcap', parse: (v) => parseInt(v, 10), desc: 'Min market cap (USD)' },
  maxmcap: { key: 'maxMcap', parse: (v) => parseInt(v, 10), desc: 'Max market cap (USD)' },
  // Volume
  minvol: { key: 'minVolume24h', parse: (v) => parseInt(v, 10), desc: 'Min 24h volume (USD)' },
  volspike: { key: 'volumeSpikeMultiplier', parse: (v) => parseFloat(v), desc: 'Volume spike multiplier (e.g. 3)' },
  // Bonding curve (Pump.fun)
  minbond: { key: 'minBondingCurve', parse: (v) => parseInt(v, 10), desc: 'Min bonding curve %' },
  maxbond: { key: 'maxBondingCurve', parse: (v) => parseInt(v, 10), desc: 'Max bonding curve %' },
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

    if (!ALL_PROFILES.includes(profile)) {
      // Build help message with all profiles by category
      let helpMsg = `Unknown profile: <code>${args[0]}</code>\n\n`;

      helpMsg += `<b>🎯 Risk Profiles:</b>\n`;
      RISK_PROFILES.forEach(p => {
        const info = PROFILE_INFO[p];
        helpMsg += `${info.emoji} <code>${p}</code> - ${info.desc}\n`;
      });

      helpMsg += `\n<b>💰 Market Cap Profiles:</b>\n`;
      MCAP_PROFILES.forEach(p => {
        const info = PROFILE_INFO[p];
        helpMsg += `${info.emoji} <code>${p}</code> - ${info.desc}\n`;
      });

      helpMsg += `\n<b>📊 Strategy Profiles:</b>\n`;
      STRATEGY_PROFILES.forEach(p => {
        const info = PROFILE_INFO[p];
        helpMsg += `${info.emoji} <code>${p}</code> - ${info.desc}\n`;
      });

      helpMsg += `\nUsage: <code>/filter [profile]</code>`;

      await ctx.replyWithHTML(helpMsg);
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

    if (ALL_PROFILES.includes(profile)) {
      storageService.setFilterProfile(chatId, profile);
      const info = PROFILE_INFO[profile];
      const profileInfo = formatFilterProfile(profile);

      await ctx.answerCbQuery(`${info.emoji} Profile set to ${profile}`);
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
