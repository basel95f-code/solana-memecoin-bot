import type { Context, Telegraf } from 'telegraf';
import { storageService } from '../../services/storage';
import type { FilterProfile } from '../../types';

// Profile info with emojis (shared with filters.ts)
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

export function registerPresetCommands(bot: Telegraf): void {
  // /presets - List all saved presets
  bot.command('presets', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const presets = storageService.getPresets(chatId);

    if (presets.length === 0) {
      await ctx.replyWithHTML(
        `<b>📋 Saved Presets</b>\n\n` +
        `You don't have any saved presets yet.\n\n` +
        `<b>Commands:</b>\n` +
        `• <code>/save [name]</code> - Save current filters as preset\n` +
        `• <code>/load [name]</code> - Load a preset\n` +
        `• <code>/share [name]</code> - Get shareable code\n` +
        `• <code>/import [code]</code> - Import from code`
      );
      return;
    }

    let message = `<b>📋 Saved Presets (${presets.length})</b>\n\n`;
    
    presets.forEach((preset, index) => {
      const age = Math.floor((Date.now() - preset.createdAt) / (1000 * 60 * 60 * 24));
      const profileInfo = PROFILE_INFO[preset.filters.profile as FilterProfile];
      const emoji = profileInfo?.emoji || '⚙️';
      
      message += `${index + 1}. ${emoji} <b>${preset.name}</b>\n`;
      message += `   Profile: <code>${preset.filters.profile}</code>\n`;
      if (preset.description) {
        message += `   ${preset.description}\n`;
      }
      message += `   Created: ${age} days ago\n\n`;
    });

    message += `<b>Commands:</b>\n`;
    message += `• <code>/load [name]</code> - Load preset\n`;
    message += `• <code>/share [name]</code> - Share preset\n`;
    message += `• <code>/save [name]</code> - Overwrite preset`;

    await ctx.replyWithHTML(message);
  });

  // /save [name] - Save current filters as preset
  bot.command('save', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>💾 Save Preset</b>\n\n` +
        `Usage: <code>/save [name] [description]</code>\n\n` +
        `Example:\n` +
        `<code>/save mysettings My custom filter settings</code>\n\n` +
        `This will save your current filter configuration as a preset.`
      );
      return;
    }

    const name = args[0];
    const description = args.slice(1).join(' ');

    try {
      const preset = storageService.savePreset(chatId, name, description || undefined);
      const profileInfo = PROFILE_INFO[preset.filters.profile as FilterProfile];
      const emoji = profileInfo?.emoji || '⚙️';

      await ctx.replyWithHTML(
        `✅ <b>Preset Saved!</b>\n\n` +
        `${emoji} <b>${preset.name}</b>\n` +
        `Profile: <code>${preset.filters.profile}</code>\n` +
        `${description ? `Description: ${description}\n` : ''}` +
        `\nUse <code>/load ${name}</code> to load this preset\n` +
        `Use <code>/share ${name}</code> to get a shareable code`
      );
    } catch (error) {
      await ctx.replyWithHTML(`❌ Failed to save preset: ${error}`);
    }
  });

  // /load [name] - Load a preset
  bot.command('load', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      const presets = storageService.getPresets(chatId);
      if (presets.length === 0) {
        await ctx.replyWithHTML(
          `<b>📂 Load Preset</b>\n\n` +
          `You don't have any saved presets.\n\n` +
          `Use <code>/save [name]</code> to save your current filters.`
        );
        return;
      }

      let message = `<b>📂 Load Preset</b>\n\n`;
      message += `Available presets:\n\n`;
      presets.forEach(preset => {
        const profileInfo = PROFILE_INFO[preset.filters.profile as FilterProfile];
        const emoji = profileInfo?.emoji || '⚙️';
        message += `${emoji} <code>${preset.name}</code>\n`;
      });
      message += `\nUsage: <code>/load [name]</code>`;

      await ctx.replyWithHTML(message);
      return;
    }

    const name = args.join(' ');
    const filters = storageService.loadPreset(chatId, name);

    if (!filters) {
      await ctx.replyWithHTML(
        `❌ Preset not found: <code>${name}</code>\n\n` +
        `Use <code>/presets</code> to see available presets.`
      );
      return;
    }

    const profileInfo = PROFILE_INFO[filters.profile as FilterProfile];
    const emoji = profileInfo?.emoji || '⚙️';

    await ctx.replyWithHTML(
      `✅ <b>Preset Loaded!</b>\n\n` +
      `${emoji} <b>${name}</b>\n` +
      `Profile: <code>${filters.profile}</code>\n\n` +
      `Your filters have been updated. Use <code>/settings</code> to view.`
    );
  });

  // /share [name] - Generate shareable base64 code
  bot.command('share', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>🔗 Share Preset</b>\n\n` +
        `Usage: <code>/share [name]</code>\n\n` +
        `This generates a shareable code that others can import.`
      );
      return;
    }

    const name = args.join(' ');
    const code = storageService.exportPreset(chatId, name);

    if (!code) {
      await ctx.replyWithHTML(
        `❌ Preset not found: <code>${name}</code>\n\n` +
        `Use <code>/presets</code> to see available presets.`
      );
      return;
    }

    const preset = storageService.getPreset(chatId, name);
    const profileInfo = PROFILE_INFO[preset!.filters.profile as FilterProfile];
    const emoji = profileInfo?.emoji || '⚙️';

    await ctx.replyWithHTML(
      `🔗 <b>Shareable Preset Code</b>\n\n` +
      `${emoji} <b>${name}</b>\n` +
      `Profile: <code>${preset!.filters.profile}</code>\n\n` +
      `<code>${code}</code>\n\n` +
      `Share this code with others!\n` +
      `They can import it with:\n` +
      `<code>/import ${code}</code>`
    );
  });

  // /import [code] - Import preset from base64 code
  bot.command('import', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>📥 Import Preset</b>\n\n` +
        `Usage: <code>/import [code]</code>\n\n` +
        `Paste the base64 code you received from someone's <code>/share</code> command.`
      );
      return;
    }

    const code = args.join('');
    
    try {
      const preset = storageService.importPreset(chatId, code);

      if (!preset) {
        await ctx.replyWithHTML(
          `❌ Invalid or corrupted preset code.\n\n` +
          `Make sure you copied the entire code.`
        );
        return;
      }

      const profileInfo = PROFILE_INFO[preset.filters.profile as FilterProfile];
      const emoji = profileInfo?.emoji || '⚙️';

      await ctx.replyWithHTML(
        `✅ <b>Preset Imported!</b>\n\n` +
        `${emoji} <b>${preset.name}</b>\n` +
        `Profile: <code>${preset.filters.profile}</code>\n` +
        `${preset.description ? `Description: ${preset.description}\n` : ''}` +
        `\nSaved to your presets. Use:\n` +
        `• <code>/load ${preset.name}</code> - Apply this preset\n` +
        `• <code>/presets</code> - View all presets`
      );
    } catch (error) {
      await ctx.replyWithHTML(`❌ Failed to import preset: Invalid code format`);
    }
  });
}
