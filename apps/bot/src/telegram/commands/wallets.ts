import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { PublicKey } from '@solana/web3.js';
import { storageService } from '../../services/storage';
import { walletMonitorService } from '../../services/walletMonitor';
import type { TrackedWallet, WalletTransaction } from '../../types';

function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function truncateAddress(address: string, chars: number = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

function formatWalletList(wallets: TrackedWallet[]): string {
  if (wallets.length === 0) {
    return (
      `<b>Tracked Wallets</b>\n\n` +
      `No wallets tracked yet.\n\n` +
      `Use <code>/track [address] [label]</code> to start tracking a wallet.`
    );
  }

  let msg = `<b>Tracked Wallets</b> (${wallets.length}/${storageService.getMaxWalletsPerUser()})\n\n`;

  for (const wallet of wallets) {
    const lastChecked = wallet.lastChecked
      ? new Date(wallet.lastChecked).toLocaleString('en-US', { timeZone: 'UTC' })
      : 'Never';

    msg += `<b>${wallet.label}</b>\n`;
    msg += `<code>${wallet.address}</code>\n`;
    msg += `Added: ${new Date(wallet.addedAt).toLocaleDateString()}\n`;
    msg += `Last checked: ${lastChecked}\n\n`;
  }

  msg += `<i>Use /wallet [address] to see recent activity</i>`;

  return msg;
}

function formatTransaction(tx: WalletTransaction): string {
  const typeEmoji = tx.type === 'buy' ? '🟢' : tx.type === 'sell' ? '🔴' : '↔️';
  const typeText = tx.type.toUpperCase();

  let msg = `${typeEmoji} <b>${typeText}</b>`;

  if (tx.tokenSymbol) {
    msg += ` - ${tx.tokenSymbol}`;
  } else {
    msg += ` - ${truncateAddress(tx.tokenMint, 6)}`;
  }

  msg += `\n`;

  // Amount
  if (tx.amount) {
    msg += `   Amount: ${tx.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
    if (tx.tokenSymbol) {
      msg += ` ${tx.tokenSymbol}`;
    }
    msg += `\n`;
  }

  // SOL value
  if (tx.solAmount) {
    msg += `   Value: ${tx.solAmount.toFixed(4)} SOL`;
    if (tx.priceUsd) {
      msg += ` (~$${tx.priceUsd.toFixed(2)})`;
    }
    msg += `\n`;
  }

  // Time
  const time = new Date(tx.timestamp).toLocaleString('en-US', { timeZone: 'UTC' });
  msg += `   Time: ${time}\n`;

  return msg;
}

function getWalletKeyboard(wallets: TrackedWallet[]) {
  const buttons: any[][] = [];

  // Add untrack buttons for each wallet (2 per row)
  for (let i = 0; i < wallets.length; i += 2) {
    const row: any[] = [];
    for (let j = 0; j < 2 && i + j < wallets.length; j++) {
      const wallet = wallets[i + j];
      row.push(
        Markup.button.callback(
          `❌ ${wallet.label.slice(0, 12)}`,
          `untrack_${wallet.address.slice(0, 10)}`
        )
      );
    }
    buttons.push(row);
  }

  return Markup.inlineKeyboard(buttons);
}

export function registerWalletCommands(bot: Telegraf): void {
  // /track command - Add wallet to tracking
  bot.command('track', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Track Wallet</b>\n\n` +
        `Usage: <code>/track [address] [label]</code>\n\n` +
        `Example:\n` +
        `<code>/track 7xKX...3nFd Whale #1</code>\n\n` +
        `You'll receive alerts when this wallet buys or sells tokens.`
      );
      return;
    }

    const address = args[0];
    const label = args.slice(1).join(' ') || truncateAddress(address, 4);

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`Invalid Solana address.`);
      return;
    }

    // Check if already tracked
    if (storageService.isWalletTracked(chatId, address)) {
      await ctx.replyWithHTML(`Wallet already being tracked.`);
      return;
    }

    // Check limit
    const maxWallets = storageService.getMaxWalletsPerUser();
    const currentWallets = storageService.getTrackedWallets(chatId);
    if (currentWallets.length >= maxWallets) {
      await ctx.replyWithHTML(
        `Wallet limit reached (${maxWallets} max).\n\n` +
        `Remove a wallet with <code>/untrack [address]</code>`
      );
      return;
    }

    try {
      const wallet: TrackedWallet = {
        address,
        label,
        addedAt: Date.now(),
        lastChecked: 0,
      };

      storageService.addTrackedWallet(chatId, wallet);

      await ctx.replyWithHTML(
        `<b>${label}</b> added to tracking!\n\n` +
        `<code>${address}</code>\n\n` +
        `You'll receive alerts when this wallet buys or sells tokens.\n\n` +
        `Use <code>/wallets</code> to see all tracked wallets.`
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await ctx.replyWithHTML(`Error: ${errorMsg}`);
    }
  });

  // /untrack command - Remove wallet from tracking
  bot.command('untrack', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(`Usage: <code>/untrack [address]</code>`);
      return;
    }

    const address = args[0];
    const wallets = storageService.getTrackedWallets(chatId);
    const wallet = wallets.find(
      w => w.address === address || w.address.startsWith(address)
    );

    if (!wallet) {
      await ctx.replyWithHTML(`Wallet not found in tracked list.`);
      return;
    }

    storageService.removeTrackedWallet(chatId, wallet.address);

    await ctx.replyWithHTML(`<b>${wallet.label}</b> removed from tracking.`);
  });

  // /wallets command - List all tracked wallets
  bot.command('wallets', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const wallets = storageService.getTrackedWallets(chatId);
    const formatted = formatWalletList(wallets);

    if (wallets.length > 0) {
      await ctx.replyWithHTML(formatted, getWalletKeyboard(wallets));
    } else {
      await ctx.replyWithHTML(formatted);
    }
  });

  // /wallet command - Show recent activity for a wallet
  bot.command('wallet', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Wallet Activity</b>\n\n` +
        `Usage: <code>/wallet [address]</code>\n\n` +
        `Shows recent buy/sell activity for a wallet.`
      );
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`Invalid Solana address.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`Loading wallet activity...`);

    try {
      // Get recent activity
      const transactions = await walletMonitorService.getRecentActivity(address, 10);

      if (transactions.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `<b>Wallet Activity</b>\n\n` +
          `<code>${truncateAddress(address, 8)}</code>\n\n` +
          `No recent swap activity found.\n\n` +
          `<a href="https://solscan.io/account/${address}">View on Solscan</a>`,
          { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
        );
        return;
      }

      // Enrich transactions with token data
      for (const tx of transactions) {
        await walletMonitorService.enrichTransaction(tx);
      }

      let msg = `<b>Wallet Activity</b>\n\n`;
      msg += `<code>${truncateAddress(address, 8)}</code>\n\n`;
      msg += `<b>Recent Transactions:</b>\n\n`;

      for (const tx of transactions.slice(0, 5)) {
        msg += formatTransaction(tx);
        msg += `   <a href="https://solscan.io/tx/${tx.signature}">View tx</a>\n\n`;
      }

      msg += `<a href="https://solscan.io/account/${address}">View all on Solscan</a>`;

      // Check if wallet is tracked
      const wallets = storageService.getTrackedWallets(chatId);
      const isTracked = wallets.some(w => w.address === address);

      const keyboard = Markup.inlineKeyboard([
        isTracked
          ? [Markup.button.callback('Stop Tracking', `untrack_${address.slice(0, 10)}`)]
          : [Markup.button.callback('Track Wallet', `track_prompt_${address.slice(0, 10)}`)],
      ]);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        msg,
        {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...keyboard,
        }
      );
    } catch (error) {
      console.error('Wallet command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `Error fetching wallet activity.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // Handle untrack button callback
  bot.action(/^untrack_(.+)$/, async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const partialAddress = ctx.match[1];
    const wallets = storageService.getTrackedWallets(chatId);
    const wallet = wallets.find(w => w.address.startsWith(partialAddress));

    if (wallet) {
      storageService.removeTrackedWallet(chatId, wallet.address);
      await ctx.answerCbQuery(`${wallet.label} removed`);

      // Refresh the wallets display
      const updatedWallets = storageService.getTrackedWallets(chatId);
      const formatted = formatWalletList(updatedWallets);

      if (updatedWallets.length > 0) {
        await ctx.editMessageText(formatted, {
          parse_mode: 'HTML',
          ...getWalletKeyboard(updatedWallets),
        });
      } else {
        await ctx.editMessageText(formatted, { parse_mode: 'HTML' });
      }
    } else {
      await ctx.answerCbQuery('Wallet not found');
    }
  });

  // Handle track prompt callback
  bot.action(/^track_prompt_(.+)$/, async (ctx) => {
    const partialAddress = ctx.match[1];
    await ctx.answerCbQuery(`Use /track ${partialAddress}... [label] to track`);
  });
}
