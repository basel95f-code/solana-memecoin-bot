import { Context, Telegraf } from 'telegraf';
import { PublicKey } from '@solana/web3.js';
import { storageService } from '../../services/storage';
import { dexScreenerService } from '../../services/dexscreener';
import { formatWatchlist, truncateAddress } from '../formatters';
import { watchlistKeyboard, confirmKeyboard } from '../keyboards';
import { WatchedToken } from '../../types';
import { config } from '../../config';

function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export function registerWatchlistCommands(bot: Telegraf): void {
  // /watch command
  bot.command('watch', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Add to Watchlist</b>\n\n` +
        `Usage: <code>/watch [token_address]</code>\n\n` +
        `You'll be alerted when the price moves ${config.watchlist.priceAlertThreshold}%+`
      );
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    // Check watchlist limit
    const currentWatchlist = storageService.getWatchlist(chatId);
    if (currentWatchlist.length >= config.watchlist.maxTokensPerUser) {
      await ctx.replyWithHTML(
        `❌ Watchlist full (${config.watchlist.maxTokensPerUser} tokens max).\n\n` +
        `Remove a token with <code>/unwatch [address]</code> or clear with <code>/watchlist clear</code>`
      );
      return;
    }

    // Check if already in watchlist
    if (currentWatchlist.find(t => t.mint === address)) {
      await ctx.replyWithHTML(`⚠️ Token already in watchlist.`);
      return;
    }

    // Get token info
    try {
      const dexData = await dexScreenerService.getTokenData(address);

      const token: WatchedToken = {
        mint: address,
        symbol: dexData?.baseToken.symbol || 'UNKNOWN',
        name: dexData?.baseToken.name || 'Unknown Token',
        addedAt: Date.now(),
        addedPrice: parseFloat(dexData?.priceUsd || '0'),
        lastPrice: parseFloat(dexData?.priceUsd || '0'),
        lastChecked: Date.now(),
        priceChangePercent: 0,
      };

      storageService.addToWatchlist(chatId, token);

      await ctx.replyWithHTML(
        `✅ <b>${token.name}</b> ($${token.symbol}) added to watchlist!\n\n` +
        `Current price: $${token.lastPrice.toFixed(8)}\n` +
        `Alert threshold: ±${config.watchlist.priceAlertThreshold}%\n\n` +
        `Use <code>/watchlist</code> to view all watched tokens.`
      );
    } catch (error) {
      console.error('Watch command error:', error);
      await ctx.replyWithHTML(`❌ Error adding token to watchlist.`);
    }
  });

  // /unwatch command
  bot.command('unwatch', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(`Usage: <code>/unwatch [token_address]</code>`);
      return;
    }

    const address = args[0];
    const watchlist = storageService.getWatchlist(chatId);
    const token = watchlist.find(t => t.mint === address || t.mint.startsWith(address));

    if (!token) {
      await ctx.replyWithHTML(`❌ Token not found in watchlist.`);
      return;
    }

    storageService.removeFromWatchlist(chatId, token.mint);

    await ctx.replyWithHTML(`✅ <b>${token.symbol}</b> removed from watchlist.`);
  });

  // /watchlist command
  bot.command('watchlist', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args[0]?.toLowerCase() === 'clear') {
      await ctx.replyWithHTML(
        `⚠️ <b>Clear entire watchlist?</b>\n\nThis cannot be undone.`,
        confirmKeyboard('watchlist', 'clear')
      );
      return;
    }

    const watchlist = storageService.getWatchlist(chatId);

    // Update prices if we have tokens
    if (watchlist.length > 0) {
      const loadingMsg = await ctx.replyWithHTML(`📋 Loading watchlist...`);

      try {
        // Fetch current prices
        for (const token of watchlist) {
          const dexData = await dexScreenerService.getTokenData(token.mint);
          if (dexData?.priceUsd) {
            const currentPrice = parseFloat(dexData.priceUsd);
            const priceChange = token.addedPrice > 0
              ? ((currentPrice - token.addedPrice) / token.addedPrice) * 100
              : 0;

            storageService.updateWatchlistToken(chatId, token.mint, {
              lastPrice: currentPrice,
              lastChecked: Date.now(),
              priceChangePercent: priceChange,
            });
          }
        }

        // Get updated watchlist
        const updatedWatchlist = storageService.getWatchlist(chatId);
        const formatted = formatWatchlist(updatedWatchlist);

        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          formatted,
          { parse_mode: 'HTML', ...watchlistKeyboard(updatedWatchlist) }
        );
      } catch (error) {
        console.error('Watchlist command error:', error);
        const formatted = formatWatchlist(watchlist);
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          formatted + '\n\n<i>⚠️ Some prices may be outdated</i>',
          { parse_mode: 'HTML', ...watchlistKeyboard(watchlist) }
        );
      }
    } else {
      await ctx.replyWithHTML(formatWatchlist(watchlist));
    }
  });

  // Handle callback for watch button
  bot.action(/^watch_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Use /watch [full_address] to add');
  });

  // Handle callback for unwatch button
  bot.action(/^unwatch_(.+)$/, async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const partialMint = ctx.match[1];
    const watchlist = storageService.getWatchlist(chatId);
    const token = watchlist.find(t => t.mint.startsWith(partialMint));

    if (token) {
      storageService.removeFromWatchlist(chatId, token.mint);
      await ctx.answerCbQuery(`${token.symbol} removed`);

      // Refresh the watchlist display
      const updatedWatchlist = storageService.getWatchlist(chatId);
      const formatted = formatWatchlist(updatedWatchlist);

      await ctx.editMessageText(formatted, {
        parse_mode: 'HTML',
        ...watchlistKeyboard(updatedWatchlist)
      });
    } else {
      await ctx.answerCbQuery('Token not found');
    }
  });

  // Handle watchlist clear confirmation
  bot.action('confirm_watchlist_clear', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    storageService.clearWatchlist(chatId);
    await ctx.answerCbQuery('Watchlist cleared');
    await ctx.editMessageText(`✅ Watchlist cleared.`, { parse_mode: 'HTML' });
  });

  bot.action('watchlist_clear', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `⚠️ <b>Clear entire watchlist?</b>\n\nThis cannot be undone.`,
      { parse_mode: 'HTML', ...confirmKeyboard('watchlist', 'clear') }
    );
  });

  bot.action('cancel', async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    await ctx.deleteMessage();
  });
}
