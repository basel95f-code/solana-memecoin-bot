/**
 * Multi-Timeframe Analysis Telegram Commands
 */

import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { PublicKey } from '@solana/web3.js';
import { multiTimeframeAnalyzer } from '../../analysis/multiTimeframeAnalyzer';
import type { MultiTimeframeAnalysis, Anomaly } from '../../analysis/multiTimeframeAnalyzer';
import { solanaService } from '../../services/solana';

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

function formatTimeframeAnalysis(analysis: MultiTimeframeAnalysis): string {
  let msg = '<b>📊 Multi-Timeframe Analysis</b>\n';
  
  if (analysis.tokenSymbol) {
    msg += `${analysis.tokenSymbol}\n`;
  }
  msg += `<code>${truncateAddress(analysis.tokenMint, 8)}</code>\n\n`;

  // Current state
  msg += `📍 <b>Current</b>\n`;
  msg += `   Price: $${analysis.current.priceUsd?.toFixed(8) || 'N/A'}\n`;
  msg += `   Liquidity: $${analysis.current.liquidity.toLocaleString()}\n`;
  msg += `   24h Volume: $${analysis.current.volume24h.toLocaleString()}\n`;
  if (analysis.current.holders > 0) {
    msg += `   Holders: ${analysis.current.holders}\n`;
  }
  msg += `\n`;

  // Changes across timeframes
  msg += `📈 <b>Changes</b>\n`;
  
  if (analysis.fiveMin) {
    msg += formatChange('5min', analysis.changes.fiveMin);
  }
  
  if (analysis.oneHour) {
    msg += formatChange('1h', analysis.changes.oneHour);
  }
  
  if (analysis.twentyFourHour) {
    msg += formatChange('24h', analysis.changes.twentyFourHour);
  }
  
  msg += `\n`;

  // Trends
  const trendIcon = analysis.trends.priceDirection === 'up' ? '🟢' :
                   analysis.trends.priceDirection === 'down' ? '🔴' : '🟡';
  
  msg += `${trendIcon} <b>Trends</b>\n`;
  msg += `   Direction: ${formatDirection(analysis.trends.priceDirection)}\n`;
  msg += `   Momentum: ${analysis.trends.momentumStrength.toFixed(0)}/100\n`;
  msg += `   Liquidity: ${formatTrend(analysis.trends.liquidityTrend)}\n`;
  msg += `   Holders: ${formatTrend(analysis.trends.holderGrowth)}\n`;

  // Anomalies
  if (analysis.anomalies.length > 0) {
    msg += `\n⚠️ <b>Anomalies Detected</b>\n`;
    for (const anomaly of analysis.anomalies) {
      msg += formatAnomaly(anomaly);
    }
  }

  // Data quality
  msg += `\n✅ Data Quality: ${analysis.quality}%`;

  return msg;
}

function formatChange(timeframe: string, changes: any): string {
  let msg = `   <b>${timeframe}:</b> `;
  
  const parts: string[] = [];
  
  if (changes.priceChange !== 0) {
    const sign = changes.priceChange > 0 ? '+' : '';
    parts.push(`P ${sign}${changes.priceChange.toFixed(1)}%`);
  }
  
  if (changes.liquidityChange !== 0) {
    const sign = changes.liquidityChange > 0 ? '+' : '';
    parts.push(`L ${sign}${changes.liquidityChange.toFixed(1)}%`);
  }
  
  if (changes.holderChange !== 0) {
    const sign = changes.holderChange > 0 ? '+' : '';
    parts.push(`H ${sign}${changes.holderChange}`);
  }

  msg += parts.length > 0 ? parts.join(' | ') : 'No change';
  msg += '\n';
  
  return msg;
}

function formatDirection(direction: string): string {
  switch (direction) {
    case 'up': return '🟢 Uptrend';
    case 'down': return '🔴 Downtrend';
    case 'sideways': return '🟡 Sideways';
    default: return direction;
  }
}

function formatTrend(trend: string): string {
  if (trend === 'increasing' || trend === 'growing') return '📈 Increasing';
  if (trend === 'decreasing' || trend === 'shrinking') return '📉 Decreasing';
  if (trend === 'stable') return '➡️ Stable';
  return trend;
}

function formatAnomaly(anomaly: Anomaly): string {
  const severityIcon = anomaly.severity === 'critical' ? '🚨' :
                      anomaly.severity === 'high' ? '🔴' :
                      anomaly.severity === 'medium' ? '🟠' : '🟡';
  
  return `   ${severityIcon} ${anomaly.description}\n`;
}

export function registerTimeframeCommands(bot: Telegraf): void {
  // /timeframe [token] - Multi-timeframe analysis
  bot.command('timeframe', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>📊 Multi-Timeframe Analysis</b>\n\n` +
        `Usage: <code>/timeframe [token_address]</code>\n\n` +
        `Analyzes token across multiple timeframes:\n` +
        `• 5-minute changes\n` +
        `• 1-hour changes\n` +
        `• 24-hour changes\n` +
        `• Price trends & momentum\n` +
        `• Anomaly detection\n\n` +
        `<i>Helps spot pumps, dumps, and unusual activity early</i>`
      );
      return;
    }

    const tokenMint = args[0];

    if (!isValidSolanaAddress(tokenMint)) {
      await ctx.replyWithHTML(`Invalid token address.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`Analyzing token across timeframes...`);

    try {
      // Get token info for better context
      let tokenInfo = null;
      try {
        tokenInfo = await solanaService.getTokenInfo(tokenMint);
      } catch {
        // Continue without token info
      }

      // Perform multi-timeframe analysis
      const analysis = await multiTimeframeAnalyzer.analyze(
        tokenMint,
        tokenInfo?.symbol,
        tokenInfo || undefined
      );

      if (!analysis) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `<b>📊 Multi-Timeframe Analysis</b>\n\n` +
          `Failed to analyze token.\n\n` +
          `Possible reasons:\n` +
          `• Token not found on DexScreener\n` +
          `• Insufficient data available\n` +
          `• Network error`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      const formatted = formatTimeframeAnalysis(analysis);

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', `refresh_timeframe_${tokenMint.slice(0, 12)}`)],
        [Markup.button.url('View Chart', `https://dexscreener.com/solana/${tokenMint}`)],
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
      console.error('Timeframe command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `Error analyzing token. Please try again.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // Refresh timeframe callback
  bot.action(/^refresh_timeframe_(.+)$/, async (ctx) => {
    const partialMint = ctx.match[1];
    
    await ctx.answerCbQuery('Refreshing...');

    // For simplicity, construct full mint (in production, store mapping)
    // Here we'll just show a message
    await ctx.answerCbQuery('Use /timeframe [token] to refresh analysis');
  });

  // /anomalies - Show all active anomalies across tracked tokens
  bot.command('anomalies', async (ctx: Context) => {
    await ctx.replyWithHTML(
      `<b>⚠️ Active Anomalies</b>\n\n` +
      `Feature coming soon!\n\n` +
      `Will show:\n` +
      `• Tokens with price spikes\n` +
      `• Liquidity drains detected\n` +
      `• Volume anomalies\n` +
      `• Holder concentration changes\n\n` +
      `Use <code>/timeframe [token]</code> to check specific tokens`
    );
  });
}
