/**
 * Wallet Profile Telegram Commands
 */

import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { PublicKey } from '@solana/web3.js';
import { walletProfiler } from '../../services/walletProfiler';
import type { WalletProfile } from '../../services/walletProfiler';
import { storageService } from '../../services/storage';

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

function formatProfile(profile: WalletProfile): string {
  let msg = '';

  // Header
  msg += `<b>📊 Wallet Profile</b>\n`;
  msg += `${profile.walletLabel || truncateAddress(profile.walletAddress, 8)}\n\n`;

  // Trading Style
  const styleIcon = profile.tradingStyle === 'scalper' ? '⚡' :
                   profile.tradingStyle === 'day_trader' ? '📈' :
                   profile.tradingStyle === 'swing_trader' ? '🌊' :
                   profile.tradingStyle === 'long_term_holder' ? '💎' : '⚪';
  
  msg += `${styleIcon} <b>Trading Style: ${formatTradingStyle(profile.tradingStyle)}</b>\n`;
  msg += `   Confidence: ${profile.tradingStyleConfidence}%\n`;
  msg += `   <i>${profile.tradingStyleDescription}</i>\n\n`;

  // Risk Appetite
  const riskIcon = profile.riskAppetite === 'conservative' ? '🛡️' :
                  profile.riskAppetite === 'moderate' ? '⚖️' :
                  profile.riskAppetite === 'aggressive' ? '🔥' : '💀';
  
  msg += `${riskIcon} <b>Risk Appetite: ${formatRiskAppetite(profile.riskAppetite)}</b>\n`;
  msg += `   Confidence: ${profile.riskAppetiteConfidence}%\n\n`;

  // Entry Timing
  const timingIcon = profile.entryTiming === 'early_bird' ? '🌅' :
                    profile.entryTiming === 'dip_buyer' ? '📉' :
                    profile.entryTiming === 'fomo' ? '🔔' : '🔀';
  
  msg += `${timingIcon} <b>Entry Timing: ${formatEntryTiming(profile.entryTiming)}</b>\n`;
  msg += `   Confidence: ${profile.entryTimingConfidence}%\n\n`;

  // Hold Duration Stats
  msg += `⏱ <b>Hold Duration</b>\n`;
  msg += `   Average: ${profile.avgHoldDuration.toFixed(1)}h\n`;
  if (profile.shortestTrade > 0) {
    msg += `   Shortest: ${profile.shortestTrade.toFixed(1)}h\n`;
    msg += `   Longest: ${profile.longestTrade.toFixed(1)}h\n`;
  }
  msg += `\n`;

  // Behavioral Traits
  msg += `🧠 <b>Behavioral Traits</b>\n`;
  msg += `   Streakiness: ${profile.streakiness.toFixed(0)}%\n`;
  msg += `   Consistency: ${profile.consistency.toFixed(0)}%\n`;
  msg += `\n`;

  // Performance Summary (if metrics available)
  if (profile.metrics) {
    msg += `📈 <b>Performance</b>\n`;
    msg += `   Win Rate: ${profile.metrics.winRate.toFixed(1)}%\n`;
    msg += `   Total ROI: ${profile.metrics.totalRoi > 0 ? '+' : ''}${profile.metrics.totalRoi.toFixed(1)}%\n`;
    msg += `   Total Trades: ${profile.metrics.totalTrades}\n`;
    msg += `\n`;
  }

  // Profile Quality
  msg += `✅ <b>Profile Confidence: ${profile.profileConfidence}%</b>\n`;
  msg += `<i>Based on ${profile.dataPoints} trades</i>`;

  return msg;
}

function formatTradingStyle(style: string): string {
  switch (style) {
    case 'scalper': return 'Scalper';
    case 'day_trader': return 'Day Trader';
    case 'swing_trader': return 'Swing Trader';
    case 'long_term_holder': return 'Long-term Holder';
    default: return style;
  }
}

function formatRiskAppetite(appetite: string): string {
  switch (appetite) {
    case 'conservative': return 'Conservative';
    case 'moderate': return 'Moderate';
    case 'aggressive': return 'Aggressive';
    case 'degen': return 'Degen';
    default: return appetite;
  }
}

function formatEntryTiming(timing: string): string {
  switch (timing) {
    case 'early_bird': return 'Early Bird';
    case 'dip_buyer': return 'Dip Buyer';
    case 'fomo': return 'FOMO Trader';
    case 'mixed': return 'Mixed';
    default: return timing;
  }
}

function formatStyleComparison(profiles: WalletProfile[]): string {
  if (profiles.length === 0) {
    return `No wallets found with this trading style yet.`;
  }

  let msg = `<b>📊 Wallets by Trading Style</b>\n\n`;

  for (const profile of profiles.slice(0, 8)) {
    const riskIcon = profile.riskAppetite === 'conservative' ? '🛡️' :
                    profile.riskAppetite === 'moderate' ? '⚖️' :
                    profile.riskAppetite === 'aggressive' ? '🔥' : '💀';
    
    msg += `<b>${profile.walletLabel || truncateAddress(profile.walletAddress, 6)}</b>\n`;
    msg += `   ${riskIcon} ${formatRiskAppetite(profile.riskAppetite)} | `;
    msg += `Conf: ${profile.tradingStyleConfidence}%\n`;
    
    if (profile.metrics) {
      msg += `   WR: ${profile.metrics.winRate.toFixed(0)}% | ROI: ${profile.metrics.totalRoi > 0 ? '+' : ''}${profile.metrics.totalRoi.toFixed(0)}%\n`;
    }
    
    msg += `   /profile ${profile.walletAddress.slice(0, 12)}...\n\n`;
  }

  return msg;
}

export function registerWalletProfileCommands(bot: Telegraf): void {
  // /profile [wallet] - Show complete wallet profile
  bot.command('profile', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>📊 Wallet Profiler</b>\n\n` +
        `Usage:\n` +
        `<code>/profile [wallet]</code> - Show complete wallet profile\n` +
        `<code>/style [type]</code> - Find wallets by trading style\n\n` +
        `<i>Analyzes trading patterns, risk appetite, and behavioral traits</i>\n\n` +
        `Trading Styles:\n` +
        `⚡ Scalper - Quick in/out (<2h holds)\n` +
        `📈 Day Trader - Intraday trades (<24h holds)\n` +
        `🌊 Swing Trader - Multi-day holds (1-3 days)\n` +
        `💎 Long-term Holder - Patient holds (3+ days)\n\n` +
        `Risk Appetites:\n` +
        `🛡️ Conservative - Safe plays, high win rate\n` +
        `⚖️ Moderate - Balanced risk/reward\n` +
        `🔥 Aggressive - High risk, high reward\n` +
        `💀 Degen - YOLO trades, extreme volatility`
      );
      return;
    }

    const walletAddress = args[0];

    if (!isValidSolanaAddress(walletAddress)) {
      await ctx.replyWithHTML(`Invalid Solana wallet address.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`Analyzing wallet profile...`);

    try {
      // Generate or get existing profile
      let profile = walletProfiler.getProfile(walletAddress);
      
      if (!profile) {
        profile = await walletProfiler.generateProfile(walletAddress);
      }

      if (!profile) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `<b>📊 Wallet Profile</b>\n\n` +
          `Not enough data to generate profile.\n\n` +
          `Wallet needs at least 3 closed trades.\n` +
          `Track this wallet with <code>/track ${walletAddress.slice(0, 12)}...</code>`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      const formatted = formatProfile(profile);

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', `refresh_profile_${walletAddress.slice(0, 12)}`)],
        [Markup.button.callback('🔍 Similar Wallets', `similar_wallets_${walletAddress.slice(0, 12)}`)],
        [Markup.button.url('View Wallet', `https://solscan.io/account/${walletAddress}`)],
      ]);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        formatted,
        {
          parse_mode: 'HTML',
          ...keyboard,
        }
      );
    } catch (error) {
      console.error('Profile command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `Error generating profile. Please try again.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // Refresh profile callback
  bot.action(/^refresh_profile_(.+)$/, async (ctx) => {
    const partialAddress = ctx.match[1];
    
    await ctx.answerCbQuery('Refreshing profile...');

    // Find full address from tracked wallets
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const wallets = storageService.getTrackedWallets(chatId);
    const wallet = wallets.find(w => w.address.startsWith(partialAddress));

    if (!wallet) {
      await ctx.answerCbQuery('Wallet not found');
      return;
    }

    try {
      const profile = await walletProfiler.refreshProfile(wallet.address);
      
      if (!profile) {
        await ctx.answerCbQuery('Not enough data');
        return;
      }

      const formatted = formatProfile(profile);

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', `refresh_profile_${partialAddress}`)],
        [Markup.button.callback('🔍 Similar Wallets', `similar_wallets_${partialAddress}`)],
        [Markup.button.url('View Wallet', `https://solscan.io/account/${wallet.address}`)],
      ]);

      await ctx.editMessageText(formatted, {
        parse_mode: 'HTML',
        ...keyboard,
      });
    } catch (error) {
      await ctx.answerCbQuery('Refresh failed');
    }
  });

  // Similar wallets callback
  bot.action(/^similar_wallets_(.+)$/, async (ctx) => {
    const partialAddress = ctx.match[1];
    
    await ctx.answerCbQuery('Finding similar wallets...');

    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const wallets = storageService.getTrackedWallets(chatId);
    const wallet = wallets.find(w => w.address.startsWith(partialAddress));

    if (!wallet) return;

    const similar = walletProfiler.findSimilarWallets(wallet.address, 5);

    if (similar.length === 0) {
      await ctx.answerCbQuery('No similar wallets found');
      return;
    }

    let msg = `<b>🔍 Similar Wallets</b>\n`;
    msg += `Similar to ${wallet.label || truncateAddress(wallet.address, 6)}\n\n`;

    for (const profile of similar) {
      msg += `<b>${profile.walletLabel || truncateAddress(profile.walletAddress, 6)}</b>\n`;
      msg += `   Style: ${formatTradingStyle(profile.tradingStyle)}\n`;
      msg += `   Risk: ${formatRiskAppetite(profile.riskAppetite)}\n`;
      if (profile.metrics) {
        msg += `   WR: ${profile.metrics.winRate.toFixed(0)}% | ROI: ${profile.metrics.totalRoi > 0 ? '+' : ''}${profile.metrics.totalRoi.toFixed(0)}%\n`;
      }
      msg += `\n`;
    }

    await ctx.editMessageText(msg, { parse_mode: 'HTML' });
  });

  // /style [type] - Find wallets by trading style
  bot.command('style', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>📊 Find Wallets by Trading Style</b>\n\n` +
        `Usage: <code>/style [type]</code>\n\n` +
        `Types:\n` +
        `• scalper - Quick in/out trades\n` +
        `• day - Day traders\n` +
        `• swing - Swing traders\n` +
        `• holder - Long-term holders\n\n` +
        `Example: <code>/style scalper</code>`
      );
      return;
    }

    const styleArg = args[0].toLowerCase();
    let style: 'scalper' | 'day_trader' | 'swing_trader' | 'long_term_holder';

    if (styleArg === 'scalper') style = 'scalper';
    else if (styleArg === 'day' || styleArg === 'daytrader') style = 'day_trader';
    else if (styleArg === 'swing') style = 'swing_trader';
    else if (styleArg === 'holder' || styleArg === 'hold') style = 'long_term_holder';
    else {
      await ctx.replyWithHTML(`Invalid style. Use: scalper, day, swing, or holder`);
      return;
    }

    const profiles = walletProfiler.findByTradingStyle(style, 60);
    const formatted = formatStyleComparison(profiles);

    await ctx.replyWithHTML(formatted);
  });

  // /risk [type] - Find wallets by risk appetite
  bot.command('risk', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>🎯 Find Wallets by Risk Appetite</b>\n\n` +
        `Usage: <code>/risk [type]</code>\n\n` +
        `Types:\n` +
        `• conservative - Safe players\n` +
        `• moderate - Balanced\n` +
        `• aggressive - High risk\n` +
        `• degen - YOLO traders\n\n` +
        `Example: <code>/risk aggressive</code>`
      );
      return;
    }

    const riskArg = args[0].toLowerCase();
    let appetite: 'conservative' | 'moderate' | 'aggressive' | 'degen';

    if (riskArg === 'conservative' || riskArg === 'safe') appetite = 'conservative';
    else if (riskArg === 'moderate' || riskArg === 'balanced') appetite = 'moderate';
    else if (riskArg === 'aggressive' || riskArg === 'high') appetite = 'aggressive';
    else if (riskArg === 'degen' || riskArg === 'yolo') appetite = 'degen';
    else {
      await ctx.replyWithHTML(`Invalid risk type. Use: conservative, moderate, aggressive, or degen`);
      return;
    }

    const profiles = walletProfiler.findByRiskAppetite(appetite, 60);

    if (profiles.length === 0) {
      await ctx.replyWithHTML(`No wallets found with <b>${appetite}</b> risk appetite yet.`, { parse_mode: 'HTML' });
      return;
    }

    let msg = `<b>🎯 ${formatRiskAppetite(appetite)} Wallets</b>\n\n`;

    for (const profile of profiles.slice(0, 8)) {
      const styleIcon = profile.tradingStyle === 'scalper' ? '⚡' :
                       profile.tradingStyle === 'day_trader' ? '📈' :
                       profile.tradingStyle === 'swing_trader' ? '🌊' : '💎';
      
      msg += `<b>${profile.walletLabel || truncateAddress(profile.walletAddress, 6)}</b>\n`;
      msg += `   ${styleIcon} ${formatTradingStyle(profile.tradingStyle)} | `;
      msg += `Conf: ${profile.riskAppetiteConfidence}%\n`;
      
      if (profile.metrics) {
        msg += `   WR: ${profile.metrics.winRate.toFixed(0)}% | ROI: ${profile.metrics.totalRoi > 0 ? '+' : ''}${profile.metrics.totalRoi.toFixed(0)}%\n`;
      }
      
      msg += `   /profile ${profile.walletAddress.slice(0, 12)}...\n\n`;
    }

    await ctx.replyWithHTML(msg);
  });
}
