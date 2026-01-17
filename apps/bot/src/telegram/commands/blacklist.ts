import type { Context, Telegraf } from 'telegraf';
import { storageService } from '../../services/storage';
import type { BlacklistEntry } from '../../types';
import { Markup } from 'telegraf';

// Validate Solana address (base58, 32-44 chars)
function isValidAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

function formatBlacklistEntry(entry: BlacklistEntry): string {
  const typeIcon = entry.type === 'token' ? '🪙' : '👤';
  const label = entry.label ? ` (${entry.label})` : '';
  const reason = entry.reason ? `\n   └ ${entry.reason}` : '';
  const addr = `${entry.address.slice(0, 6)}...${entry.address.slice(-4)}`;
  return `${typeIcon} <code>${addr}</code>${label}${reason}`;
}

function formatBlacklistStatus(chatId: string): string {
  const blacklist = storageService.getBlacklist(chatId);
  const tokens = blacklist.filter(e => e.type === 'token');
  const creators = blacklist.filter(e => e.type === 'creator');

  let msg = '<b>🚫 Blacklist</b>\n\n';

  if (blacklist.length === 0) {
    msg += '<i>No blacklisted addresses</i>\n\n';
    msg += 'Blacklisted tokens and creators will never trigger alerts.\n\n';
    msg += '<b>Commands:</b>\n';
    msg += '<code>/bl add &lt;address&gt;</code> - Blacklist token\n';
    msg += '<code>/bl creator &lt;address&gt;</code> - Blacklist creator\n';
    msg += '<code>/bl remove &lt;address&gt;</code> - Remove from blacklist\n';
    return msg;
  }

  if (tokens.length > 0) {
    msg += `<b>🪙 Tokens (${tokens.length}):</b>\n`;
    for (const entry of tokens.slice(0, 10)) {
      msg += formatBlacklistEntry(entry) + '\n';
    }
    if (tokens.length > 10) {
      msg += `<i>...and ${tokens.length - 10} more</i>\n`;
    }
    msg += '\n';
  }

  if (creators.length > 0) {
    msg += `<b>👤 Creators (${creators.length}):</b>\n`;
    for (const entry of creators.slice(0, 10)) {
      msg += formatBlacklistEntry(entry) + '\n';
    }
    if (creators.length > 10) {
      msg += `<i>...and ${creators.length - 10} more</i>\n`;
    }
  }

  return msg;
}

function getBlacklistKeyboard(chatId: string) {
  const blacklist = storageService.getBlacklist(chatId);
  const buttons: any[][] = [];

  if (blacklist.length > 0) {
    buttons.push([
      Markup.button.callback('🗑 Clear All', 'bl_clear_confirm'),
    ]);
  }

  return Markup.inlineKeyboard(buttons);
}

export function registerBlacklistCommands(bot: Telegraf): void {
  // /blacklist or /bl command
  const handleBlacklist = async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    // No args - show blacklist
    if (args.length === 0) {
      const statusMsg = formatBlacklistStatus(chatId);
      const keyboard = getBlacklistKeyboard(chatId);
      if (storageService.getBlacklist(chatId).length > 0) {
        await ctx.replyWithHTML(statusMsg, keyboard);
      } else {
        await ctx.replyWithHTML(statusMsg);
      }
      return;
    }

    const action = args[0].toLowerCase();

    // /bl add <address> [label] - Add token to blacklist
    if (action === 'add' || action === 'token') {
      if (args.length < 2) {
        await ctx.replyWithHTML(
          'Usage: <code>/bl add &lt;token_address&gt; [label]</code>\n\n' +
          'Example: <code>/bl add ABC123... SCAM</code>'
        );
        return;
      }

      const address = args[1];
      if (!isValidAddress(address)) {
        await ctx.replyWithHTML('Invalid Solana address format.');
        return;
      }

      if (storageService.isBlacklisted(chatId, address)) {
        await ctx.replyWithHTML('This address is already blacklisted.');
        return;
      }

      const label = args.slice(2).join(' ') || undefined;
      const entry: BlacklistEntry = {
        address,
        type: 'token',
        label,
        addedAt: Date.now(),
      };

      storageService.addToBlacklist(chatId, entry);
      await ctx.replyWithHTML(
        `🚫 Token blacklisted!\n\n` +
        `<code>${address.slice(0, 8)}...${address.slice(-6)}</code>\n` +
        (label ? `Label: ${label}\n` : '') +
        `\nYou won't receive alerts for this token.`
      );
      return;
    }

    // /bl creator <address> [label] - Add creator to blacklist
    if (action === 'creator' || action === 'dev' || action === 'wallet') {
      if (args.length < 2) {
        await ctx.replyWithHTML(
          'Usage: <code>/bl creator &lt;wallet_address&gt; [label]</code>\n\n' +
          'Example: <code>/bl creator ABC123... Known scammer</code>'
        );
        return;
      }

      const address = args[1];
      if (!isValidAddress(address)) {
        await ctx.replyWithHTML('Invalid Solana address format.');
        return;
      }

      if (storageService.isBlacklisted(chatId, address)) {
        await ctx.replyWithHTML('This address is already blacklisted.');
        return;
      }

      const label = args.slice(2).join(' ') || undefined;
      const entry: BlacklistEntry = {
        address,
        type: 'creator',
        label,
        addedAt: Date.now(),
      };

      storageService.addToBlacklist(chatId, entry);
      await ctx.replyWithHTML(
        `🚫 Creator blacklisted!\n\n` +
        `<code>${address.slice(0, 8)}...${address.slice(-6)}</code>\n` +
        (label ? `Label: ${label}\n` : '') +
        `\nYou won't receive alerts for tokens from this creator.`
      );
      return;
    }

    // /bl remove <address> - Remove from blacklist
    if (action === 'remove' || action === 'rm' || action === 'del' || action === 'delete') {
      if (args.length < 2) {
        await ctx.replyWithHTML(
          'Usage: <code>/bl remove &lt;address&gt;</code>'
        );
        return;
      }

      const address = args[1];
      if (!storageService.isBlacklisted(chatId, address)) {
        await ctx.replyWithHTML('This address is not in your blacklist.');
        return;
      }

      storageService.removeFromBlacklist(chatId, address);
      await ctx.replyWithHTML(
        `✅ Removed from blacklist!\n\n` +
        `<code>${address.slice(0, 8)}...${address.slice(-6)}</code>`
      );
      return;
    }

    // /bl clear - Clear all
    if (action === 'clear') {
      const count = storageService.getBlacklist(chatId).length;
      if (count === 0) {
        await ctx.replyWithHTML('Blacklist is already empty.');
        return;
      }

      await ctx.replyWithHTML(
        `Are you sure you want to clear all ${count} blacklisted addresses?`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback('Yes, clear all', 'bl_clear_yes'),
            Markup.button.callback('Cancel', 'bl_clear_no'),
          ],
        ])
      );
      return;
    }

    // /bl check <address> - Check if blacklisted
    if (action === 'check') {
      if (args.length < 2) {
        await ctx.replyWithHTML('Usage: <code>/bl check &lt;address&gt;</code>');
        return;
      }

      const address = args[1];
      const blacklist = storageService.getBlacklist(chatId);
      const entry = blacklist.find(e => e.address === address);

      if (entry) {
        await ctx.replyWithHTML(
          `🚫 Address is blacklisted!\n\n` +
          formatBlacklistEntry(entry)
        );
      } else {
        await ctx.replyWithHTML(
          `✅ Address is NOT blacklisted.\n\n` +
          `<code>${address.slice(0, 8)}...${address.slice(-6)}</code>`
        );
      }
      return;
    }

    // /bl help
    if (action === 'help') {
      await ctx.replyWithHTML(
        '<b>Blacklist Commands</b>\n\n' +
        '<code>/bl</code> - Show blacklist\n' +
        '<code>/bl add &lt;address&gt; [label]</code> - Blacklist token\n' +
        '<code>/bl creator &lt;address&gt; [label]</code> - Blacklist creator\n' +
        '<code>/bl remove &lt;address&gt;</code> - Remove from blacklist\n' +
        '<code>/bl check &lt;address&gt;</code> - Check if blacklisted\n' +
        '<code>/bl clear</code> - Clear all\n\n' +
        '<i>Blacklisted tokens/creators will never trigger alerts.</i>'
      );
      return;
    }

    // If first arg looks like an address, treat as /bl add
    if (isValidAddress(args[0])) {
      const address = args[0];
      if (storageService.isBlacklisted(chatId, address)) {
        await ctx.replyWithHTML('This address is already blacklisted.');
        return;
      }

      const label = args.slice(1).join(' ') || undefined;
      const entry: BlacklistEntry = {
        address,
        type: 'token',
        label,
        addedAt: Date.now(),
      };

      storageService.addToBlacklist(chatId, entry);
      await ctx.replyWithHTML(
        `🚫 Token blacklisted!\n\n` +
        `<code>${address.slice(0, 8)}...${address.slice(-6)}</code>\n` +
        (label ? `Label: ${label}\n` : '') +
        `\nYou won't receive alerts for this token.`
      );
      return;
    }

    await ctx.replyWithHTML(
      `Unknown option: <code>${action}</code>\n\n` +
      `Use <code>/bl help</code> for commands.`
    );
  };

  bot.command('blacklist', handleBlacklist);
  bot.command('bl', handleBlacklist);

  // Callback handlers
  bot.action('bl_clear_confirm', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const count = storageService.getBlacklist(chatId).length;
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `Are you sure you want to clear all ${count} blacklisted addresses?`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('Yes, clear all', 'bl_clear_yes'),
            Markup.button.callback('Cancel', 'bl_clear_no'),
          ],
        ]),
      }
    );
  });

  bot.action('bl_clear_yes', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    storageService.clearBlacklist(chatId);
    await ctx.answerCbQuery('Blacklist cleared');
    await ctx.editMessageText(
      '✅ Blacklist cleared!\n\nAll addresses have been removed.',
      { parse_mode: 'HTML' }
    );
  });

  bot.action('bl_clear_no', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    await ctx.answerCbQuery('Cancelled');
    const statusMsg = formatBlacklistStatus(chatId);
    await ctx.editMessageText(statusMsg, {
      parse_mode: 'HTML',
      ...getBlacklistKeyboard(chatId),
    });
  });
}
