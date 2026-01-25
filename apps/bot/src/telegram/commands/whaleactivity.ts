/**
 * Whale Activity Telegram Commands
 */

import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { PublicKey } from '@solana/web3.js';
import { whaleActivityTracker } from '../../services/whaleActivityTracker';
import type { WhaleTimeline, AccumulationAlert, DistributionAlert, CoordinatedMovement } from '../../services/whaleActivityTracker';

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

function formatTimeline(timeline: WhaleTimeline, showEvents: boolean = true): string {
  let msg = '';

  // Header
  msg += `<b>🐋 ${timeline.walletLabel || truncateAddress(timeline.walletAddress, 6)}</b>\n`;
  msg += `Token: ${timeline.tokenSymbol || truncateAddress(timeline.tokenMint, 8)}\n\n`;

  // Current status
  const statusIcon = timeline.activityPattern === 'buying_spree' ? '🟢' : 
                     timeline.activityPattern === 'selling_spree' ? '🔴' :
                     timeline.activityPattern === 'balanced' ? '🟡' : '⚪';
  
  msg += `${statusIcon} <b>Status: ${formatActivityPattern(timeline.activityPattern)}</b>\n\n`;

  // Position info
  msg += `📊 <b>Position</b>\n`;
  msg += `   Current: ${timeline.currentPosition.toLocaleString(undefined, { maximumFractionDigits: 2 })}\n`;
  msg += `   Total Bought: ${timeline.totalBought.toFixed(2)} SOL\n`;
  msg += `   Total Sold: ${timeline.totalSold.toFixed(2)} SOL\n`;
  msg += `   Buy Pressure: ${timeline.buyPressure.toFixed(0)}%\n\n`;

  // Accumulation/Distribution status
  if (timeline.isAccumulating) {
    msg += `🟢 <b>ACCUMULATING</b> (Score: ${timeline.accumulationScore}/100)\n`;
    msg += `   Whale is buying aggressively!\n\n`;
  } else if (timeline.isDistributing) {
    msg += `🔴 <b>DISTRIBUTING</b> (Score: ${timeline.distributionScore}/100)\n`;
    msg += `   Whale is dumping position!\n\n`;
  }

  // Recent events (last 5)
  if (showEvents && timeline.events.length > 0) {
    msg += `📜 <b>Recent Activity</b>\n`;
    
    const recentEvents = timeline.events.slice(-5).reverse();
    for (const event of recentEvents) {
      const actionIcon = event.action === 'buy' ? '🟢' : '🔴';
      const timeAgo = formatTimeAgo(Date.now() - event.timestamp);
      
      msg += `   ${actionIcon} ${event.action.toUpperCase()}: ${event.solValue.toFixed(2)} SOL (${timeAgo})\n`;
    }
    msg += `\n`;
  }

  // Stats
  msg += `📈 <b>Stats</b>\n`;
  msg += `   Total Events: ${timeline.events.length}\n`;
  msg += `   Last Active: ${formatTimeAgo(Date.now() - timeline.lastActivity)}\n`;

  return msg;
}

function formatActivityPattern(pattern: string): string {
  switch (pattern) {
    case 'buying_spree': return 'Buying Spree 🟢';
    case 'selling_spree': return 'Selling Spree 🔴';
    case 'balanced': return 'Balanced Activity 🟡';
    case 'inactive': return 'Inactive ⚪';
    default: return pattern;
  }
}

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

function formatAccumulationAlert(alert: AccumulationAlert): string {
  let msg = `🟢 <b>WHALE ACCUMULATION ALERT</b>\n\n`;
  
  msg += `👤 ${alert.walletLabel || truncateAddress(alert.walletAddress, 8)}\n`;
  msg += `🪙 ${alert.tokenSymbol || truncateAddress(alert.tokenMint, 8)}\n\n`;
  
  msg += `📊 <b>Accumulation Pattern Detected</b>\n`;
  msg += `   Buys: ${alert.buyCount} times in ${alert.timeWindow.toFixed(1)}h\n`;
  msg += `   Total: ${alert.totalSolValue.toFixed(2)} SOL\n`;
  msg += `   Avg Size: ${alert.avgBuySize.toFixed(2)} SOL\n`;
  msg += `   Position: ~${alert.estimatedPosition.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens\n\n`;
  
  msg += `💡 <i>Whale is accumulating - possible pump incoming!</i>\n\n`;
  
  msg += `<a href="https://dexscreener.com/solana/${alert.tokenMint}">📈 Chart</a> | `;
  msg += `<a href="https://solscan.io/account/${alert.walletAddress}">👤 Wallet</a>`;

  return msg;
}

function formatDistributionAlert(alert: DistributionAlert): string {
  let msg = `🔴 <b>WHALE DISTRIBUTION ALERT</b>\n\n`;
  
  msg += `👤 ${alert.walletLabel || truncateAddress(alert.walletAddress, 8)}\n`;
  msg += `🪙 ${alert.tokenSymbol || truncateAddress(alert.tokenMint, 8)}\n\n`;
  
  msg += `📊 <b>Distribution Pattern Detected</b>\n`;
  msg += `   Sells: ${alert.sellCount} times in ${alert.timeWindow.toFixed(1)}h\n`;
  msg += `   Total: ${alert.totalSolValue.toFixed(2)} SOL\n`;
  msg += `   Avg Size: ${alert.avgSellSize.toFixed(2)} SOL\n`;
  msg += `   Sold: ${alert.percentSold.toFixed(1)}% of position\n`;
  msg += `   Remaining: ~${alert.remainingPosition.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens\n\n`;
  
  msg += `⚠️ <i>Whale is dumping - be cautious!</i>\n\n`;
  
  msg += `<a href="https://dexscreener.com/solana/${alert.tokenMint}">📈 Chart</a> | `;
  msg += `<a href="https://solscan.io/account/${alert.walletAddress}">👤 Wallet</a>`;

  return msg;
}

function formatCoordinatedMovement(movement: CoordinatedMovement): string {
  let msg = `⚠️ <b>COORDINATED ${movement.action.toUpperCase()} DETECTED</b>\n\n`;
  
  msg += `🪙 Token: ${movement.tokenSymbol || truncateAddress(movement.tokenMint, 8)}\n`;
  msg += `👥 Wallets: ${movement.wallets.length}\n`;
  msg += `⏱ Time Window: ${(movement.timeWindow / 1000 / 60).toFixed(1)} minutes\n`;
  msg += `💵 Total Value: ${movement.totalValue.toFixed(2)} SOL\n`;
  msg += `📊 Avg Amount: ${movement.avgAmount.toFixed(2)} SOL\n\n`;
  
  msg += `🚨 <b>Suspicion Score: ${movement.suspicionScore}/100</b>\n\n`;
  
  if (movement.isSuspicious) {
    msg += `⚠️ <i>Highly suspicious coordinated activity!</i>\n`;
    if (movement.action === 'buy') {
      msg += `<i>Possible pump & dump setup</i>\n`;
    } else {
      msg += `<i>Coordinated dumping - avoid this token!</i>\n`;
    }
  } else {
    msg += `<i>Multiple wallets trading, monitor closely</i>\n`;
  }
  
  msg += `\n<a href="https://dexscreener.com/solana/${movement.tokenMint}">📈 View Chart</a>`;

  return msg;
}

export function registerWhaleActivityCommands(bot: Telegraf): void {
  // /whale [wallet] - Show whale timeline for a wallet
  bot.command('whale', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>🐋 Whale Activity Tracker</b>\n\n` +
        `Usage:\n` +
        `<code>/whale [wallet]</code> - Show whale timeline for wallet\n` +
        `<code>/whaleactivity [token]</code> - Show all whales trading a token\n` +
        `<code>/accumulating</code> - Show active accumulation patterns\n` +
        `<code>/distributing</code> - Show active distribution patterns\n\n` +
        `<i>Tracks whale buy/sell patterns and detects accumulation/distribution</i>`
      );
      return;
    }

    const walletAddress = args[0];

    if (!isValidSolanaAddress(walletAddress)) {
      await ctx.replyWithHTML(`Invalid Solana wallet address.`);
      return;
    }

    // Get all timelines for this wallet
    const timelines = whaleActivityTracker.getWalletTimelines(walletAddress);

    if (timelines.length === 0) {
      await ctx.replyWithHTML(
        `<b>🐋 Whale Activity</b>\n\n` +
        `No activity recorded for this wallet yet.\n\n` +
        `Wallet must be tracked and have buy/sell transactions detected.`
      );
      return;
    }

    // Sort by last activity
    timelines.sort((a, b) => b.lastActivity - a.lastActivity);

    // Show first timeline with full details
    let msg = formatTimeline(timelines[0], true);

    // If multiple tokens, show summary for others
    if (timelines.length > 1) {
      msg += `\n<b>Other Tokens (${timelines.length - 1}):</b>\n`;
      for (const timeline of timelines.slice(1, 4)) {
        msg += `   • ${timeline.tokenSymbol || truncateAddress(timeline.tokenMint, 6)}: `;
        msg += timeline.isAccumulating ? '🟢 Accumulating' : 
               timeline.isDistributing ? '🔴 Distributing' : 
               `${timeline.events.length} events`;
        msg += `\n`;
      }
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('View Wallet', `https://solscan.io/account/${walletAddress}`)],
    ]);

    await ctx.replyWithHTML(msg, keyboard);
  });

  // /whaleactivity [token] - Show all whale activity for a token
  bot.command('whaleactivity', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>🐋 Token Whale Activity</b>\n\n` +
        `Usage: <code>/whaleactivity [token_address]</code>\n\n` +
        `Shows all whale wallets trading this token.`
      );
      return;
    }

    const tokenMint = args[0];

    if (!isValidSolanaAddress(tokenMint)) {
      await ctx.replyWithHTML(`Invalid token address.`);
      return;
    }

    const timelines = whaleActivityTracker.getTokenActivity(tokenMint);

    if (timelines.length === 0) {
      await ctx.replyWithHTML(
        `<b>🐋 Token Whale Activity</b>\n\n` +
        `No whale activity recorded for this token yet.`
      );
      return;
    }

    // Sort by total SOL value (bought + sold)
    timelines.sort((a, b) => (b.totalBought + b.totalSold) - (a.totalBought + a.totalSold));

    let msg = `<b>🐋 Whale Activity</b>\n`;
    msg += `Token: ${timelines[0].tokenSymbol || truncateAddress(tokenMint, 8)}\n`;
    msg += `Whales Detected: ${timelines.length}\n\n`;

    for (const timeline of timelines.slice(0, 5)) {
      const statusIcon = timeline.isAccumulating ? '🟢' : timeline.isDistributing ? '🔴' : '⚪';
      const totalValue = timeline.totalBought + timeline.totalSold;
      
      msg += `${statusIcon} <b>${timeline.walletLabel || truncateAddress(timeline.walletAddress, 6)}</b>\n`;
      msg += `   Volume: ${totalValue.toFixed(2)} SOL | Events: ${timeline.events.length}\n`;
      
      if (timeline.isAccumulating) {
        msg += `   🟢 Accumulating (${timeline.accumulationScore}/100)\n`;
      } else if (timeline.isDistributing) {
        msg += `   🔴 Distributing (${timeline.distributionScore}/100)\n`;
      }
      
      msg += `\n`;
    }

    if (timelines.length > 5) {
      msg += `<i>... and ${timelines.length - 5} more whales</i>\n`;
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('View Chart', `https://dexscreener.com/solana/${tokenMint}`)],
    ]);

    await ctx.replyWithHTML(msg, keyboard);
  });

  // /accumulating - Show active accumulation patterns
  bot.command('accumulating', async (ctx: Context) => {
    const accumulations = whaleActivityTracker.getActiveAccumulations();

    if (accumulations.length === 0) {
      await ctx.replyWithHTML(
        `<b>🟢 Active Accumulations</b>\n\n` +
        `No active accumulation patterns detected.\n\n` +
        `<i>Accumulation = 3+ buys within 24 hours</i>`
      );
      return;
    }

    let msg = `<b>🟢 Active Accumulation Patterns</b>\n`;
    msg += `<i>${accumulations.length} whale(s) accumulating</i>\n\n`;

    for (const timeline of accumulations.slice(0, 8)) {
      msg += `<b>${timeline.walletLabel || truncateAddress(timeline.walletAddress, 6)}</b>\n`;
      msg += `   Token: ${timeline.tokenSymbol || truncateAddress(timeline.tokenMint, 6)}\n`;
      msg += `   Score: ${timeline.accumulationScore}/100\n`;
      msg += `   Bought: ${timeline.totalBought.toFixed(2)} SOL\n`;
      msg += `   /whale ${timeline.walletAddress.slice(0, 12)}...\n\n`;
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh', 'refresh_accumulating')],
    ]);

    await ctx.replyWithHTML(msg, keyboard);
  });

  // Refresh accumulating callback
  bot.action('refresh_accumulating', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');
    
    const accumulations = whaleActivityTracker.getActiveAccumulations();

    let msg = `<b>🟢 Active Accumulation Patterns</b>\n`;
    msg += `<i>${accumulations.length} whale(s) accumulating</i>\n\n`;

    if (accumulations.length === 0) {
      msg = `<b>🟢 Active Accumulations</b>\n\n` +
            `No active accumulation patterns detected.\n\n` +
            `<i>Accumulation = 3+ buys within 24 hours</i>`;
    } else {
      for (const timeline of accumulations.slice(0, 8)) {
        msg += `<b>${timeline.walletLabel || truncateAddress(timeline.walletAddress, 6)}</b>\n`;
        msg += `   Token: ${timeline.tokenSymbol || truncateAddress(timeline.tokenMint, 6)}\n`;
        msg += `   Score: ${timeline.accumulationScore}/100\n`;
        msg += `   Bought: ${timeline.totalBought.toFixed(2)} SOL\n`;
        msg += `   /whale ${timeline.walletAddress.slice(0, 12)}...\n\n`;
      }
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh', 'refresh_accumulating')],
    ]);

    await ctx.editMessageText(msg, {
      parse_mode: 'HTML',
      ...keyboard,
    });
  });

  // /distributing - Show active distribution patterns
  bot.command('distributing', async (ctx: Context) => {
    const distributions = whaleActivityTracker.getActiveDistributions();

    if (distributions.length === 0) {
      await ctx.replyWithHTML(
        `<b>🔴 Active Distributions</b>\n\n` +
        `No active distribution patterns detected.\n\n` +
        `<i>Distribution = 2+ sells within 12 hours</i>`
      );
      return;
    }

    let msg = `<b>🔴 Active Distribution Patterns</b>\n`;
    msg += `<i>${distributions.length} whale(s) distributing</i>\n\n`;

    for (const timeline of distributions.slice(0, 8)) {
      msg += `<b>${timeline.walletLabel || truncateAddress(timeline.walletAddress, 6)}</b>\n`;
      msg += `   Token: ${timeline.tokenSymbol || truncateAddress(timeline.tokenMint, 6)}\n`;
      msg += `   Score: ${timeline.distributionScore}/100\n`;
      msg += `   Sold: ${timeline.totalSold.toFixed(2)} SOL\n`;
      msg += `   /whale ${timeline.walletAddress.slice(0, 12)}...\n\n`;
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh', 'refresh_distributing')],
    ]);

    await ctx.replyWithHTML(msg, keyboard);
  });

  // Refresh distributing callback
  bot.action('refresh_distributing', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');
    
    const distributions = whaleActivityTracker.getActiveDistributions();

    let msg = `<b>🔴 Active Distribution Patterns</b>\n`;
    msg += `<i>${distributions.length} whale(s) distributing</i>\n\n`;

    if (distributions.length === 0) {
      msg = `<b>🔴 Active Distributions</b>\n\n` +
            `No active distribution patterns detected.\n\n` +
            `<i>Distribution = 2+ sells within 12 hours</i>`;
    } else {
      for (const timeline of distributions.slice(0, 8)) {
        msg += `<b>${timeline.walletLabel || truncateAddress(timeline.walletAddress, 6)}</b>\n`;
        msg += `   Token: ${timeline.tokenSymbol || truncateAddress(timeline.tokenMint, 6)}\n`;
        msg += `   Score: ${timeline.distributionScore}/100\n`;
        msg += `   Sold: ${timeline.totalSold.toFixed(2)} SOL\n`;
        msg += `   /whale ${timeline.walletAddress.slice(0, 12)}...\n\n`;
      }
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh', 'refresh_distributing')],
    ]);

    await ctx.editMessageText(msg, {
      parse_mode: 'HTML',
      ...keyboard,
    });
  });
}

// Export formatters for use in alerts
export {
  formatAccumulationAlert,
  formatDistributionAlert,
  formatCoordinatedMovement,
};
