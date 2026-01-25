import type { Context, Telegraf } from 'telegraf';
import { PublicKey } from '@solana/web3.js';
import { liquidityMonitor } from '../../services/liquidityMonitor';
import { formatNumber } from '../formatters';

function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export function registerLiquidityCommands(bot: Telegraf): void {
  // /watchliq command - Add token to liquidity monitoring
  bot.command('watchliq', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length < 2) {
      await ctx.replyWithHTML(
        `<b>💧 Liquidity Monitor</b>\n\n` +
        `Track LP for rug pull protection.\n\n` +
        `<b>Usage:</b>\n` +
        `<code>/watchliq [address] [symbol]</code>\n\n` +
        `<b>Example:</b>\n` +
        `<code>/watchliq DezXAZ8z... BONK</code>\n\n` +
        `Alerts sent when:\n` +
        `• Liquidity drops >20% (warning)\n` +
        `• Liquidity drops >50% (critical)\n` +
        `• LP unlocked/burned changes`
      );
      return;
    }

    const [address, symbol] = args;

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    // Add to monitor
    liquidityMonitor.addToken(address, symbol);

    await ctx.replyWithHTML(
      `✅ <b>${symbol}</b> added to liquidity monitor\n\n` +
      `You'll be alerted if:\n` +
      `• Liquidity drops >20%\n` +
      `• LP unlock detected\n` +
      `• Suspicious movements\n\n` +
      `<code>${address}</code>`
    );
  });

  // /unwatchliq command - Remove token from liquidity monitoring
  bot.command('unwatchliq', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Remove from Liquidity Monitor</b>\n\n` +
        `Usage: <code>/unwatchliq [address]</code>`
      );
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    liquidityMonitor.removeToken(address);

    await ctx.replyWithHTML(`✅ Token removed from liquidity monitor`);
  });

  // /liqliq command - Show liquidity monitor status
  bot.command('liqstatus', async (ctx: Context) => {
    const stats = liquidityMonitor.getStats();

    const lines = [
      `<b>💧 Liquidity Monitor Status</b>`,
      ``,
      `Watched tokens: <b>${stats.watchedTokens}</b>`,
      `Snapshots: ${stats.snapshots}`,
      `Alert history: ${stats.alertHistory}`,
      ``,
      `<b>Thresholds:</b>`,
      `⚠️ Warning: 20% drain`,
      `🚨 Critical: 50% drain`,
      ``,
      `Use <code>/watchliq [address] [symbol]</code> to add tokens.`,
    ];

    await ctx.replyWithHTML(lines.join('\n'));
  });

  // /liqcheck command - Check current liquidity snapshot for a token
  bot.command('liqcheck', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Check Liquidity Snapshot</b>\n\n` +
        `Usage: <code>/liqcheck [address]</code>\n\n` +
        `Shows current liquidity snapshot for a monitored token.`
      );
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    const snapshot = liquidityMonitor.getSnapshot(address);

    if (!snapshot) {
      await ctx.replyWithHTML(
        `❌ No snapshot found for this token.\n\n` +
        `Use <code>/watchliq ${address} [SYMBOL]</code> to start monitoring.`
      );
      return;
    }

    const age = Math.floor((Date.now() - snapshot.timestamp) / 1000);
    const ageStr = age < 60 ? `${age}s ago` :
                   age < 3600 ? `${Math.floor(age / 60)}m ago` :
                   `${Math.floor(age / 3600)}h ago`;

    const lines = [
      `<b>💧 ${snapshot.symbol}</b>`,
      ``,
      `<b>Liquidity:</b> $${formatNumber(snapshot.liquidityUsd)}`,
      `<b>LP Burned:</b> ${snapshot.lpBurnedPercent.toFixed(1)}%`,
      `<b>LP Locked:</b> ${snapshot.lpLockedPercent.toFixed(1)}%`,
      ``,
      `Last updated: ${ageStr}`,
      ``,
      `<code>${snapshot.tokenMint}</code>`,
    ];

    await ctx.replyWithHTML(lines.join('\n'));
  });
}
