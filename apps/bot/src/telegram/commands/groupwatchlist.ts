import type { Context, Telegraf } from 'telegraf';
import { PublicKey } from '@solana/web3.js';
import { groupWatchlistService } from '../../services/groupWatchlist';
import { chatContextService } from '../../services/chatContext';
import { dexScreenerService } from '../../services/dexscreener';
import { leaderboardService } from '../../services/leaderboard';
import { Markup } from 'telegraf';

function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function formatGroupWatchlist(tokens: any[]): string {
  if (tokens.length === 0) {
    return (
      `📌 <b>Group Watchlist</b>\n\n` +
      `No tokens are being watched yet.\n\n` +
      `Use <code>/groupwatch [token_address]</code> to add tokens!`
    );
  }

  let message = `📌 <b>Group Watchlist</b> (${tokens.length} tokens)\n\n`;

  for (const token of tokens) {
    const addedBy = token.addedByUsername ? `@${token.addedByUsername}` : `User ${token.addedByUserId}`;
    const alertInfo = token.alertCount > 0
      ? `🔥 ${token.alertCount} alerts`
      : `👀 Watching`;

    const addedDate = new Date(token.addedAt * 1000).toLocaleDateString();

    message += `<b>${token.symbol}</b>${token.name ? ` - ${token.name}` : ''}\n`;
    message += `  └ ${alertInfo} | Added by ${addedBy} (${addedDate})\n`;
    message += `  └ <code>${token.tokenMint.slice(0, 8)}...${token.tokenMint.slice(-6)}</code>\n\n`;
  }

  message += `<i>Use /hotlist to see most active tokens</i>`;
  return message;
}

function formatHotlist(tokens: any[]): string {
  if (tokens.length === 0) {
    return (
      `🔥 <b>Group Hotlist</b>\n\n` +
      `No tokens have triggered alerts yet.\n\n` +
      `Add tokens with <code>/groupwatch [token_address]</code>`
    );
  }

  let message = `🔥 <b>Group Hotlist</b> - Most Active Tokens\n\n`;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;

    const lastAlert = token.lastAlertedAt
      ? new Date(token.lastAlertedAt * 1000).toLocaleString()
      : 'Never';

    message += `${medal} <b>${token.symbol}</b> - ${token.alertCount} alerts\n`;
    message += `  └ Last: ${lastAlert}\n`;
    message += `  └ <code>${token.tokenMint.slice(0, 8)}...${token.tokenMint.slice(-6)}</code>\n\n`;
  }

  return message;
}

function createWatchlistKeyboard(tokens: any[]) {
  const buttons = tokens.slice(0, 5).map(token => [
    Markup.button.callback(`❌ Remove ${token.symbol}`, `groupunwatch_${token.tokenMint.slice(0, 12)}`),
    Markup.button.callback(`📊 Analyze`, `check_${token.tokenMint.slice(0, 12)}`)
  ]);

  return Markup.inlineKeyboard(buttons);
}

export function registerGroupWatchlistCommands(bot: Telegraf): void {
  // /groupwatch command - Add token to group watchlist
  bot.command('groupwatch', async (ctx: Context) => {
    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext) return;

    // Only works in groups
    if (!chatContext.isGroup) {
      await ctx.replyWithHTML(
        `❌ This command only works in group chats.\n\n` +
        `Use <code>/watch [token]</code> for your personal watchlist.`
      );
      return;
    }

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>📌 Group Watchlist</b>\n\n` +
        `Add tokens that everyone in the group wants to track!\n\n` +
        `<b>Usage:</b> <code>/groupwatch [token_address]</code>\n\n` +
        `<b>Benefits:</b>\n` +
        `• Priority alerts for watched tokens\n` +
        `• Track group's most active tokens\n` +
        `• See who added each token\n\n` +
        `View all: <code>/groupwatchlist</code>\n` +
        `Hot tokens: <code>/hotlist</code>`
      );
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    // Check if group watchlist is enabled
    const groupSettings = await chatContextService.getGroupSettings(chatContext.chatId);
    if (groupSettings && !groupSettings.enableGroupWatchlist) {
      await ctx.replyWithHTML(`❌ Group watchlist is disabled. Admins can enable it with /settings`);
      return;
    }

    // Check if already in watchlist
    const existing = await groupWatchlistService.isWatchedByGroup(chatContext.chatId, address);
    if (existing) {
      await ctx.replyWithHTML(`⚠️ Token already in group watchlist.`);
      return;
    }

    // Check watchlist size limit (max 50 per group)
    const count = await groupWatchlistService.getWatchlistCount(chatContext.chatId);
    if (count >= 50) {
      await ctx.replyWithHTML(
        `❌ Group watchlist is full (50 tokens max).\n\n` +
        `Remove tokens with <code>/groupunwatch [token]</code>`
      );
      return;
    }

    try {
      const loadingMsg = await ctx.replyWithHTML(`📌 Adding to group watchlist...`);

      const token = await groupWatchlistService.addToGroupWatchlist(
        chatContext.chatId,
        address,
        chatContext.userId,
        chatContext.username
      );

      // Get current price
      const dexData = await dexScreenerService.getTokenData(address);
      const price = dexData?.priceUsd || '0';
      const priceNum = parseFloat(price);

      // Record discovery in leaderboard (if enabled and user opted in)
      let leaderboardMsg = '';
      const isLeaderboardEnabled = await leaderboardService.isEnabledInGroup(chatContext.chatId);
      const hasOptedIn = await leaderboardService.hasOptedIn(chatContext.userId);

      if (isLeaderboardEnabled && hasOptedIn && priceNum > 0) {
        try {
          await leaderboardService.recordDiscovery(
            chatContext.chatId,
            chatContext.userId,
            chatContext.username,
            address,
            token.symbol,
            token.name,
            priceNum
          );
          leaderboardMsg = `\n🏆 <b>Leaderboard:</b> Discovery recorded! Your performance will be tracked for 7 days.\n`;
        } catch (error) {
          console.error('Failed to record leaderboard discovery:', error);
        }
      } else if (isLeaderboardEnabled && !hasOptedIn) {
        // Show opt-in prompt for users who haven't opted in
        leaderboardMsg = `\n📊 <b>Join the Leaderboard!</b>\n` +
          `Track your discoveries and compete with others.\n` +
          `Send <code>/leaderboard optin</code> to participate!\n`;
      }

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `✅ <b>${token.symbol}</b>${token.name ? ` - ${token.name}` : ''} added to group watchlist!\n\n` +
        `Current price: $${priceNum.toFixed(8)}\n` +
        `Added by: ${chatContext.username ? `@${chatContext.username}` : `User ${chatContext.userId}`}\n` +
        leaderboardMsg +
        `\n📌 This token will get <b>priority alerts</b> in this group.\n\n` +
        `View all: <code>/groupwatchlist</code>`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Groupwatch command error:', error);
      await ctx.replyWithHTML(`❌ Error adding token to group watchlist.`);
    }
  });

  // /groupunwatch command - Remove token from group watchlist
  bot.command('groupunwatch', async (ctx: Context) => {
    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext || !chatContext.isGroup) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(`<b>Usage:</b> <code>/groupunwatch [token_address or symbol]</code>`);
      return;
    }

    const searchTerm = args[0];

    try {
      // Find the token
      const token = await groupWatchlistService.findToken(chatContext.chatId, searchTerm);

      if (!token) {
        await ctx.replyWithHTML(`❌ Token not found in group watchlist.`);
        return;
      }

      // Check permissions - must be admin or original adder
      const isAdmin = await chatContextService.isGroupAdmin(chatContext.chatId, chatContext.userId);
      const isOriginalAdder = token.addedByUserId === chatContext.userId;

      if (!isAdmin && !isOriginalAdder) {
        await ctx.replyWithHTML(
          `❌ Only group admins or the user who added this token can remove it.\n\n` +
          `Added by: ${token.addedByUsername ? `@${token.addedByUsername}` : `User ${token.addedByUserId}`}`
        );
        return;
      }

      // Remove from watchlist
      await groupWatchlistService.removeFromGroupWatchlist(
        chatContext.chatId,
        token.tokenMint,
        chatContext.userId
      );

      await ctx.replyWithHTML(
        `✅ <b>${token.symbol}</b> removed from group watchlist.\n\n` +
        `It had ${token.alertCount} alerts.`
      );
    } catch (error) {
      console.error('Groupunwatch command error:', error);
      await ctx.replyWithHTML(`❌ Error removing token from watchlist.`);
    }
  });

  // /groupwatchlist command - Show full group watchlist
  bot.command('groupwatchlist', async (ctx: Context) => {
    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext || !chatContext.isGroup) return;

    try {
      const tokens = await groupWatchlistService.getGroupWatchlist(chatContext.chatId);
      const formatted = formatGroupWatchlist(tokens);

      if (tokens.length > 0) {
        await ctx.replyWithHTML(formatted, createWatchlistKeyboard(tokens));
      } else {
        await ctx.replyWithHTML(formatted);
      }
    } catch (error) {
      console.error('Groupwatchlist command error:', error);
      await ctx.replyWithHTML(`❌ Error fetching group watchlist.`);
    }
  });

  // /hotlist command - Show most active tokens
  bot.command('hotlist', async (ctx: Context) => {
    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext || !chatContext.isGroup) return;

    try {
      const tokens = await groupWatchlistService.getHotlist(chatContext.chatId, 10);
      const formatted = formatHotlist(tokens);

      await ctx.replyWithHTML(formatted);
    } catch (error) {
      console.error('Hotlist command error:', error);
      await ctx.replyWithHTML(`❌ Error fetching hotlist.`);
    }
  });

  // Handle callback for groupunwatch button
  bot.action(/^groupunwatch_(.+)$/, async (ctx) => {
    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext || !chatContext.isGroup) return;

    const partialMint = ctx.match[1];

    try {
      // Find the token
      const tokens = await groupWatchlistService.getGroupWatchlist(chatContext.chatId);
      const token = tokens.find(t => t.tokenMint.startsWith(partialMint));

      if (!token) {
        await ctx.answerCbQuery('Token not found');
        return;
      }

      // Check permissions
      const isAdmin = await chatContextService.isGroupAdmin(chatContext.chatId, chatContext.userId);
      const isOriginalAdder = token.addedByUserId === chatContext.userId;

      if (!isAdmin && !isOriginalAdder) {
        await ctx.answerCbQuery('Only admins or original adder can remove', { show_alert: true });
        return;
      }

      // Remove from watchlist
      await groupWatchlistService.removeFromGroupWatchlist(
        chatContext.chatId,
        token.tokenMint,
        chatContext.userId
      );

      await ctx.answerCbQuery(`${token.symbol} removed`);

      // Refresh the display
      const updatedTokens = await groupWatchlistService.getGroupWatchlist(chatContext.chatId);
      const formatted = formatGroupWatchlist(updatedTokens);

      await ctx.editMessageText(formatted, {
        parse_mode: 'HTML',
        ...createWatchlistKeyboard(updatedTokens)
      });
    } catch (error) {
      console.error('Groupunwatch callback error:', error);
      await ctx.answerCbQuery('Error removing token');
    }
  });

  // Handle callback for check (analyze) button
  bot.action(/^check_(.+)$/, async (ctx) => {
    const partialMint = ctx.match[1];
    
    const chatContext = chatContextService.getChatContext(ctx);
    if (!chatContext) return;

    // Find the full mint address
    const tokens = await groupWatchlistService.getGroupWatchlist(chatContext.chatId);
    const token = tokens.find(t => t.tokenMint.startsWith(partialMint));

    if (token) {
      await ctx.answerCbQuery('Analyzing...');
      // Trigger the check command
      await ctx.reply(`/check ${token.tokenMint}`);
    } else {
      await ctx.answerCbQuery('Token not found');
    }
  });
}
