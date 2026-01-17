import type { Context, Telegraf } from 'telegraf';
import { storageService } from '../../services/storage';
import type {
  AlertCategory,
  AlertPriority
} from '../../types';
import {
  DEFAULT_ALERT_CATEGORIES,
  PRIORITY_ORDER,
  DEFAULT_PRIORITY_SETTINGS,
} from '../../types';
import { Markup } from 'telegraf';

// Category display info
const CATEGORY_INFO: Record<AlertCategory, { emoji: string; name: string; desc: string }> = {
  new_token: { emoji: '✨', name: 'New Tokens', desc: 'New token discoveries' },
  volume_spike: { emoji: '📊', name: 'Volume Spikes', desc: 'Unusual volume activity' },
  whale_movement: { emoji: '🐋', name: 'Whale Moves', desc: 'Large holder activity' },
  liquidity_drain: { emoji: '💧', name: 'Liquidity Drains', desc: 'LP removal alerts' },
  authority_change: { emoji: '🔐', name: 'Authority Changes', desc: 'Mint/freeze changes' },
  price_alert: { emoji: '💰', name: 'Price Alerts', desc: 'Watchlist price moves' },
  smart_money: { emoji: '🧠', name: 'Smart Money', desc: 'Smart money activity' },
  wallet_activity: { emoji: '👛', name: 'Wallet Activity', desc: 'Tracked wallet trades' },
};

const ALL_CATEGORIES: AlertCategory[] = [
  'new_token',
  'volume_spike',
  'whale_movement',
  'liquidity_drain',
  'authority_change',
  'price_alert',
  'smart_money',
  'wallet_activity',
];

// Priority display info
const PRIORITY_INFO: Record<AlertPriority, { emoji: string; name: string; desc: string }> = {
  critical: { emoji: '🔴', name: 'Critical', desc: 'Liquidity drains, authority changes' },
  high: { emoji: '🟠', name: 'High', desc: 'Whale moves, smart money' },
  normal: { emoji: '🟡', name: 'Normal', desc: 'New tokens, volume spikes, price alerts' },
  low: { emoji: '🟢', name: 'Low', desc: 'All alerts including minor ones' },
};

// Common quiet hour presets
const QUIET_PRESETS = [
  { label: 'Night (22:00-08:00)', start: 22, end: 8 },
  { label: 'Sleep (00:00-09:00)', start: 0, end: 9 },
  { label: 'Work (09:00-17:00)', start: 9, end: 17 },
  { label: 'Evening (18:00-22:00)', start: 18, end: 22 },
];

function formatHour(hour: number): string {
  return `${hour.toString().padStart(2, '0')}:00`;
}

function formatAlertStatus(chatId: string): string {
  const settings = storageService.getUserSettings(chatId);
  const isMuted = storageService.isAlertsMuted(chatId);
  const isQuiet = storageService.isQuietHours(chatId);
  const categories = settings.filters.alertCategories || DEFAULT_ALERT_CATEGORIES;
  const priority = settings.filters.alertPriority || DEFAULT_PRIORITY_SETTINGS;

  let msg = '<b>🔔 Alert Settings</b>\n\n';

  // Master status
  if (!settings.filters.alertsEnabled) {
    msg += '⚫ Master: <b>OFF</b>\n';
  } else if (isMuted) {
    const muteRemaining = settings.muteUntil ? Math.ceil((settings.muteUntil - Date.now()) / 60000) : 0;
    msg += `🔇 Master: <b>MUTED</b> (${muteRemaining}m left)\n`;
  } else if (isQuiet) {
    msg += `🌙 Master: <b>QUIET HOURS</b>\n`;
  } else {
    msg += '🟢 Master: <b>ON</b>\n';
  }

  // Priority level
  const prioInfo = PRIORITY_INFO[priority.minPriority];
  msg += `${prioInfo.emoji} Priority: <b>${prioInfo.name}+</b>\n`;

  // Quiet hours status
  const { quietHoursStart, quietHoursEnd } = settings.filters;
  if (quietHoursStart !== undefined && quietHoursEnd !== undefined) {
    msg += `🌙 Quiet: ${formatHour(quietHoursStart)} - ${formatHour(quietHoursEnd)} UTC\n`;
  } else {
    msg += `🌙 Quiet: <i>Not set</i>\n`;
  }

  msg += '\n<b>Alert Categories:</b>\n';

  // Category status
  for (const cat of ALL_CATEGORIES) {
    const info = CATEGORY_INFO[cat];
    const enabled = categories[cat];
    const status = enabled ? '🟢' : '⚫';
    msg += `${status} ${info.emoji} ${info.name}\n`;
  }

  msg += '\n<i>Tap buttons below to toggle</i>';

  return msg;
}

function getCategoryKeyboard(chatId: string) {
  const categories = storageService.getAlertCategories(chatId);
  const settings = storageService.getUserSettings(chatId);

  // Create 2-column layout for categories
  const buttons: any[][] = [];
  const catList = ALL_CATEGORIES;

  for (let i = 0; i < catList.length; i += 2) {
    const row: any[] = [];
    for (let j = 0; j < 2 && i + j < catList.length; j++) {
      const cat = catList[i + j];
      const info = CATEGORY_INFO[cat];
      const enabled = categories[cat];
      const icon = enabled ? '🟢' : '⚫';
      row.push(Markup.button.callback(`${icon} ${info.name}`, `alert_cat_${cat}`));
    }
    buttons.push(row);
  }

  // Add all on/off buttons
  buttons.push([
    Markup.button.callback('✅ Enable All', 'alert_cat_all_on'),
    Markup.button.callback('❌ Disable All', 'alert_cat_all_off'),
  ]);

  // Priority and quiet hours buttons
  const priority = settings.filters.alertPriority || DEFAULT_PRIORITY_SETTINGS;
  const prioInfo = PRIORITY_INFO[priority.minPriority];
  buttons.push([
    Markup.button.callback(`${prioInfo.emoji} Priority: ${prioInfo.name}`, 'alert_priority_menu'),
  ]);

  // Quiet hours button
  const hasQuiet = settings.filters.quietHoursStart !== undefined;
  buttons.push([
    Markup.button.callback(hasQuiet ? '🌙 Edit Quiet Hours' : '🌙 Set Quiet Hours', 'alert_quiet_menu'),
  ]);

  // Master toggle
  const masterBtn = settings.filters.alertsEnabled
    ? Markup.button.callback('🔕 Turn Off Alerts', 'alert_master_off')
    : Markup.button.callback('🔔 Turn On Alerts', 'alert_master_on');
  buttons.push([masterBtn]);

  return Markup.inlineKeyboard(buttons);
}

function getPriorityKeyboard(chatId: string) {
  const priority = storageService.getAlertPriority(chatId);
  const buttons: any[][] = [];

  // Priority level buttons
  for (const level of [...PRIORITY_ORDER].reverse()) { // Show critical first
    const info = PRIORITY_INFO[level];
    const isSelected = priority.minPriority === level;
    const check = isSelected ? ' ✓' : '';
    buttons.push([
      Markup.button.callback(`${info.emoji} ${info.name}+ only${check}`, `alert_prio_set_${level}`),
    ]);
  }

  // Sound toggle
  buttons.push([
    Markup.button.callback(
      priority.soundEnabled ? '🔊 Sound: ON' : '🔇 Sound: OFF',
      'alert_prio_sound'
    ),
  ]);

  // Back button
  buttons.push([
    Markup.button.callback('« Back to Alerts', 'alert_back'),
  ]);

  return Markup.inlineKeyboard(buttons);
}

function formatPriorityMenu(chatId: string): string {
  const priority = storageService.getAlertPriority(chatId);
  const prioInfo = PRIORITY_INFO[priority.minPriority];

  let msg = '<b>⚡ Alert Priority</b>\n\n';
  msg += `Current: ${prioInfo.emoji} <b>${prioInfo.name}+</b>\n`;
  msg += `Sound: ${priority.soundEnabled ? '🔊 ON' : '🔇 OFF'}\n\n`;

  msg += '<b>Priority Levels:</b>\n';
  for (const level of [...PRIORITY_ORDER].reverse()) {
    const info = PRIORITY_INFO[level];
    const minIndex = PRIORITY_ORDER.indexOf(priority.minPriority);
    const levelIndex = PRIORITY_ORDER.indexOf(level);
    const willReceive = levelIndex >= minIndex ? '✓' : '✗';
    msg += `${info.emoji} <b>${info.name}</b> ${willReceive}\n`;
    msg += `   <i>${info.desc}</i>\n`;
  }

  msg += '\n<i>Higher priority = fewer but more important alerts</i>';

  return msg;
}

function getQuietHoursKeyboard(chatId: string) {
  const settings = storageService.getUserSettings(chatId);
  const buttons: any[][] = [];

  // Preset buttons
  for (const preset of QUIET_PRESETS) {
    buttons.push([
      Markup.button.callback(`🌙 ${preset.label}`, `alert_quiet_set_${preset.start}_${preset.end}`),
    ]);
  }

  // Clear button if quiet hours are set
  if (settings.filters.quietHoursStart !== undefined) {
    buttons.push([
      Markup.button.callback('❌ Disable Quiet Hours', 'alert_quiet_clear'),
    ]);
  }

  // Back button
  buttons.push([
    Markup.button.callback('« Back to Alerts', 'alert_back'),
  ]);

  return Markup.inlineKeyboard(buttons);
}

function formatQuietHoursMenu(chatId: string): string {
  const settings = storageService.getUserSettings(chatId);
  const { quietHoursStart, quietHoursEnd } = settings.filters;

  let msg = '<b>🌙 Quiet Hours Settings</b>\n\n';

  if (quietHoursStart !== undefined && quietHoursEnd !== undefined) {
    const isActive = storageService.isQuietHours(chatId);
    msg += `Current: <b>${formatHour(quietHoursStart)} - ${formatHour(quietHoursEnd)}</b> UTC\n`;
    msg += `Status: ${isActive ? '🌙 Active now' : '☀️ Inactive'}\n\n`;
  } else {
    msg += `Current: <i>Not set</i>\n\n`;
  }

  msg += 'During quiet hours, all alerts are paused.\n';
  msg += 'Choose a preset or use <code>/quiet HH HH</code>\n\n';
  msg += '<i>Example: <code>/quiet 22 8</code> for 22:00-08:00</i>';

  return msg;
}

export function registerAlertCommands(bot: Telegraf): void {
  // /alerts command - show status and toggles
  bot.command('alerts', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    // No args - show interactive menu
    if (args.length === 0) {
      const statusMsg = formatAlertStatus(chatId);
      await ctx.replyWithHTML(statusMsg, getCategoryKeyboard(chatId));
      return;
    }

    const action = args[0].toLowerCase();

    // /alerts on|off - master toggle
    if (action === 'on') {
      storageService.setAlertsEnabled(chatId, true);
      storageService.setMuteUntil(chatId, undefined);
      await ctx.replyWithHTML(`🔔 Alerts <b>enabled</b>!\n\nYou will receive new token alerts.`);
      return;
    }

    if (action === 'off') {
      storageService.setAlertsEnabled(chatId, false);
      await ctx.replyWithHTML(`🔕 Alerts <b>disabled</b>.\n\nUse <code>/alerts on</code> to re-enable.`);
      return;
    }

    // /alerts <category> - toggle specific category
    const category = action.replace(/-/g, '_') as AlertCategory;
    if (ALL_CATEGORIES.includes(category)) {
      const newState = storageService.toggleAlertCategory(chatId, category);
      const info = CATEGORY_INFO[category];
      const stateText = newState ? 'enabled' : 'disabled';
      await ctx.replyWithHTML(
        `${info.emoji} <b>${info.name}</b> alerts ${stateText}.\n\n` +
        `Use <code>/alerts</code> to see all categories.`
      );
      return;
    }

    // /alerts list - show help
    if (action === 'list' || action === 'help') {
      let helpMsg = '<b>Alert Commands</b>\n\n';
      helpMsg += '<code>/alerts</code> - Interactive settings menu\n';
      helpMsg += '<code>/alerts on</code> - Enable all alerts\n';
      helpMsg += '<code>/alerts off</code> - Disable all alerts\n';
      helpMsg += '<code>/priority [level]</code> - Set min priority\n';
      helpMsg += '<code>/quiet HH HH</code> - Set quiet hours\n';
      helpMsg += '<code>/mute [mins]</code> - Mute for X minutes\n\n';
      helpMsg += '<b>Toggle specific categories:</b>\n';
      for (const cat of ALL_CATEGORIES) {
        const info = CATEGORY_INFO[cat];
        helpMsg += `<code>/alerts ${cat.replace(/_/g, '-')}</code> - ${info.desc}\n`;
      }
      await ctx.replyWithHTML(helpMsg);
      return;
    }

    await ctx.replyWithHTML(
      `Unknown option: <code>${action}</code>\n\n` +
      `Use <code>/alerts</code> for settings or <code>/alerts help</code> for commands.`
    );
  });

  // /priority command - set minimum priority level
  bot.command('priority', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    // No args - show menu
    if (args.length === 0) {
      const menuMsg = formatPriorityMenu(chatId);
      await ctx.replyWithHTML(menuMsg, getPriorityKeyboard(chatId));
      return;
    }

    const level = args[0].toLowerCase() as AlertPriority;
    if (PRIORITY_ORDER.includes(level)) {
      storageService.setMinPriority(chatId, level);
      const info = PRIORITY_INFO[level];
      await ctx.replyWithHTML(
        `${info.emoji} Priority set to <b>${info.name}+</b>\n\n` +
        `You'll only receive ${info.name} and higher priority alerts.`
      );
      return;
    }

    await ctx.replyWithHTML(
      `Invalid priority level.\n\n` +
      `Available: <code>critical</code>, <code>high</code>, <code>normal</code>, <code>low</code>\n\n` +
      `Example: <code>/priority high</code>`
    );
  });

  // /quiet command - set quiet hours
  bot.command('quiet', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    // No args - show menu
    if (args.length === 0) {
      const menuMsg = formatQuietHoursMenu(chatId);
      await ctx.replyWithHTML(menuMsg, getQuietHoursKeyboard(chatId));
      return;
    }

    // /quiet off - disable
    if (args[0].toLowerCase() === 'off' || args[0].toLowerCase() === 'clear') {
      storageService.setQuietHours(chatId, undefined, undefined);
      await ctx.replyWithHTML(`☀️ Quiet hours <b>disabled</b>.\n\nYou'll receive alerts 24/7.`);
      return;
    }

    // /quiet HH HH - set start and end
    if (args.length >= 2) {
      const start = parseInt(args[0], 10);
      const end = parseInt(args[1], 10);

      if (isNaN(start) || isNaN(end) || start < 0 || start > 23 || end < 0 || end > 23) {
        await ctx.replyWithHTML(
          `Invalid hours. Use 0-23 format.\n\n` +
          `Example: <code>/quiet 22 8</code> for 22:00-08:00`
        );
        return;
      }

      storageService.setQuietHours(chatId, start, end);

      const isActive = storageService.isQuietHours(chatId);
      await ctx.replyWithHTML(
        `🌙 Quiet hours set: <b>${formatHour(start)} - ${formatHour(end)}</b> UTC\n\n` +
        `${isActive ? '🌙 Currently active - alerts paused' : '☀️ Not active yet'}\n\n` +
        `Use <code>/quiet off</code> to disable.`
      );
      return;
    }

    await ctx.replyWithHTML(
      `Usage:\n` +
      `<code>/quiet</code> - Show menu\n` +
      `<code>/quiet HH HH</code> - Set hours (e.g. /quiet 22 8)\n` +
      `<code>/quiet off</code> - Disable`
    );
  });

  // Handle category toggle callbacks
  bot.action(/^alert_cat_(.+)$/, async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const action = ctx.match[1];

    if (action === 'all_on') {
      storageService.setAllAlertCategories(chatId, true);
      await ctx.answerCbQuery('All categories enabled');
    } else if (action === 'all_off') {
      storageService.setAllAlertCategories(chatId, false);
      await ctx.answerCbQuery('All categories disabled');
    } else {
      const category = action as AlertCategory;
      if (ALL_CATEGORIES.includes(category)) {
        const newState = storageService.toggleAlertCategory(chatId, category);
        const info = CATEGORY_INFO[category];
        await ctx.answerCbQuery(`${info.name}: ${newState ? 'ON' : 'OFF'}`);
      }
    }

    // Update message
    const statusMsg = formatAlertStatus(chatId);
    await ctx.editMessageText(statusMsg, {
      parse_mode: 'HTML',
      ...getCategoryKeyboard(chatId),
    });
  });

  // Handle priority menu
  bot.action('alert_priority_menu', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    await ctx.answerCbQuery();
    const menuMsg = formatPriorityMenu(chatId);
    await ctx.editMessageText(menuMsg, {
      parse_mode: 'HTML',
      ...getPriorityKeyboard(chatId),
    });
  });

  // Handle priority level change
  bot.action(/^alert_prio_set_(.+)$/, async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const level = ctx.match[1] as AlertPriority;
    if (PRIORITY_ORDER.includes(level)) {
      storageService.setMinPriority(chatId, level);
      const info = PRIORITY_INFO[level];
      await ctx.answerCbQuery(`Priority: ${info.name}+`);

      const menuMsg = formatPriorityMenu(chatId);
      await ctx.editMessageText(menuMsg, {
        parse_mode: 'HTML',
        ...getPriorityKeyboard(chatId),
      });
    }
  });

  // Handle sound toggle
  bot.action('alert_prio_sound', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const current = storageService.getAlertPriority(chatId);
    const newState = !current.soundEnabled;
    storageService.setSoundEnabled(chatId, newState);
    await ctx.answerCbQuery(`Sound: ${newState ? 'ON' : 'OFF'}`);

    const menuMsg = formatPriorityMenu(chatId);
    await ctx.editMessageText(menuMsg, {
      parse_mode: 'HTML',
      ...getPriorityKeyboard(chatId),
    });
  });

  // Handle quiet hours menu
  bot.action('alert_quiet_menu', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    await ctx.answerCbQuery();
    const menuMsg = formatQuietHoursMenu(chatId);
    await ctx.editMessageText(menuMsg, {
      parse_mode: 'HTML',
      ...getQuietHoursKeyboard(chatId),
    });
  });

  // Handle quiet hours presets
  bot.action(/^alert_quiet_set_(\d+)_(\d+)$/, async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const start = parseInt(ctx.match[1], 10);
    const end = parseInt(ctx.match[2], 10);

    storageService.setQuietHours(chatId, start, end);
    await ctx.answerCbQuery(`Quiet hours: ${formatHour(start)}-${formatHour(end)}`);

    const menuMsg = formatQuietHoursMenu(chatId);
    await ctx.editMessageText(menuMsg, {
      parse_mode: 'HTML',
      ...getQuietHoursKeyboard(chatId),
    });
  });

  // Handle quiet hours clear
  bot.action('alert_quiet_clear', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    storageService.setQuietHours(chatId, undefined, undefined);
    await ctx.answerCbQuery('Quiet hours disabled');

    const menuMsg = formatQuietHoursMenu(chatId);
    await ctx.editMessageText(menuMsg, {
      parse_mode: 'HTML',
      ...getQuietHoursKeyboard(chatId),
    });
  });

  // Back to alerts menu
  bot.action('alert_back', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    await ctx.answerCbQuery();
    const statusMsg = formatAlertStatus(chatId);
    await ctx.editMessageText(statusMsg, {
      parse_mode: 'HTML',
      ...getCategoryKeyboard(chatId),
    });
  });

  // Handle master toggle callbacks
  bot.action('alert_master_on', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    storageService.setAlertsEnabled(chatId, true);
    storageService.setMuteUntil(chatId, undefined);
    await ctx.answerCbQuery('Alerts enabled');

    const statusMsg = formatAlertStatus(chatId);
    await ctx.editMessageText(statusMsg, {
      parse_mode: 'HTML',
      ...getCategoryKeyboard(chatId),
    });
  });

  bot.action('alert_master_off', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    storageService.setAlertsEnabled(chatId, false);
    await ctx.answerCbQuery('Alerts disabled');

    const statusMsg = formatAlertStatus(chatId);
    await ctx.editMessageText(statusMsg, {
      parse_mode: 'HTML',
      ...getCategoryKeyboard(chatId),
    });
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
