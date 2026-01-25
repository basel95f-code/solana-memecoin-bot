/**
 * Pattern Commands
 * Commands for viewing and managing token success patterns
 */

import type { Context, Telegraf } from 'telegraf';
import { patternDetector } from '../../services/patternDetector';
import { database } from '../../database';
import { PublicKey } from '@solana/web3.js';
import { analyzeToken } from '../../analysis/tokenAnalyzer';
import { dexScreenerService } from '../../services/dexscreener';

function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function formatCriteria(criteria: any): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(criteria)) {
    const label = key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();

    if (typeof value === 'object' && value !== null && ('min' in value || 'max' in value)) {
      const range = value as { min?: number; max?: number };
      if (range.min !== undefined && range.max !== undefined) {
        lines.push(`  • ${label}: ${range.min.toFixed(0)} - ${range.max.toFixed(0)}`);
      } else if (range.min !== undefined) {
        lines.push(`  • ${label}: ≥ ${range.min.toFixed(0)}`);
      } else if (range.max !== undefined) {
        lines.push(`  • ${label}: ≤ ${range.max.toFixed(0)}`);
      }
    } else if (typeof value === 'boolean') {
      lines.push(`  • ${label}: ${value ? 'Yes' : 'No'}`);
    } else {
      lines.push(`  • ${label}: ${value}`);
    }
  }

  return lines.join('\n');
}

export function registerPatternCommands(bot: Telegraf): void {
  // /patterns command - Show all discovered patterns
  bot.command('patterns', async (ctx: Context) => {
    try {
      const stats = patternDetector.getOverallStats();
      const successPatterns = database.all<any>(
        `SELECT * FROM success_patterns 
         WHERE pattern_type = 'success' AND is_active = 1 
         ORDER BY success_rate DESC 
         LIMIT 10`
      );

      const rugPatterns = database.all<any>(
        `SELECT * FROM success_patterns 
         WHERE pattern_type = 'rug' AND is_active = 1 
         ORDER BY success_rate DESC 
         LIMIT 10`
      );

      let message = `<b>📊 Discovered Patterns</b>\n\n`;
      message += `📈 Total Patterns: ${stats.totalPatterns} (${stats.activePatterns} active)\n`;
      message += `✅ Success Patterns: ${stats.successPatterns}\n`;
      message += `❌ Rug Patterns: ${stats.rugPatterns}\n`;
      message += `📊 Avg Success Rate: ${(stats.avgSuccessRate * 100).toFixed(1)}%\n\n`;

      if (successPatterns.length > 0) {
        message += `<b>🚀 Top Success Patterns:</b>\n`;
        for (const pattern of successPatterns.slice(0, 5)) {
          message += `• <b>${pattern.pattern_name}</b>\n`;
          message += `  ${(pattern.success_rate * 100).toFixed(0)}% success | `;
          message += `${pattern.average_peak_multiplier.toFixed(1)}x avg peak\n`;
        }
        message += `\n`;
      }

      if (rugPatterns.length > 0) {
        message += `<b>💀 Top Rug Patterns:</b>\n`;
        for (const pattern of rugPatterns.slice(0, 5)) {
          message += `• <b>${pattern.pattern_name}</b>\n`;
          message += `  ${(pattern.success_rate * 100).toFixed(0)}% detection rate\n`;
        }
      }

      message += `\n<i>Use /pattern &lt;name&gt; for details</i>`;

      await ctx.replyWithHTML(message, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🚀 Success', callback_data: 'patterns_success' },
              { text: '💀 Rugs', callback_data: 'patterns_rug' },
            ],
            [{ text: '🔄 Refresh', callback_data: 'patterns_refresh' }],
          ],
        },
      });
    } catch (error) {
      console.error('Patterns command error:', error);
      await ctx.replyWithHTML('❌ Error loading patterns');
    }
  });

  // /pattern command - View specific pattern details
  bot.command('pattern', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Pattern Details</b>\n\n` +
          `Usage: <code>/pattern [pattern_name]</code>\n\n` +
          `Example: <code>/pattern Triple Safe Moon</code>\n\n` +
          `Use /patterns to see all patterns`
      );
      return;
    }

    const patternName = args.join(' ');
    const pattern = await patternDetector.getPatternByName(patternName);

    if (!pattern) {
      await ctx.replyWithHTML(`❌ Pattern "${patternName}" not found.\n\nUse /patterns to see all patterns.`);
      return;
    }

    const stats = await patternDetector.getPatternStats(pattern.id!);

    const emoji = pattern.patternType === 'success' ? '🚀' : pattern.patternType === 'rug' ? '💀' : '➖';

    let message = `${emoji} <b>${pattern.patternName}</b>\n\n`;
    message += `<b>Type:</b> ${pattern.patternType}\n`;
    message += `<b>Success Rate:</b> ${(pattern.successRate * 100).toFixed(1)}%\n`;
    message += `<b>Occurrences:</b> ${pattern.occurrenceCount}\n`;
    message += `<b>Confidence:</b> ${(pattern.confidenceScore * 100).toFixed(0)}%\n\n`;

    if (pattern.patternType === 'success') {
      message += `<b>📈 Performance:</b>\n`;
      message += `  • Avg Peak: ${pattern.averagePeakMultiplier.toFixed(1)}x\n`;
      message += `  • Avg Time to Peak: ${pattern.averageTimeToPeakHours.toFixed(0)}h\n\n`;
    }

    message += `<b>🔍 Criteria:</b>\n`;
    message += formatCriteria(pattern.criteria);

    if (stats && stats.examples.length > 0) {
      message += `\n\n<b>💎 Example Tokens:</b>\n`;
      for (const example of stats.examples.slice(0, 3)) {
        message += `• ${example.symbol} - ${example.outcome}`;
        if (example.peakMultiplier) {
          message += ` (${example.peakMultiplier.toFixed(1)}x)`;
        }
        message += `\n`;
      }
    }

    if (stats && stats.recentMatches > 0) {
      message += `\n<b>📊 Recent Performance (7d):</b>\n`;
      message += `  Matches: ${stats.recentMatches}\n`;
      message += `  Success Rate: ${(stats.recentSuccessRate * 100).toFixed(0)}%\n`;
    }

    await ctx.replyWithHTML(message);
  });

  // /matchpatterns command - Find pattern matches for a token
  bot.command('matchpatterns', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Pattern Matching</b>\n\n` +
          `Usage: <code>/matchpatterns [token_address]</code>\n\n` +
          `Analyzes a token and shows which success/rug patterns it matches.`
      );
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`🔍 Analyzing patterns...`);

    try {
      // Get token data
      const dexData = await dexScreenerService.getTokenData(address);

      if (!dexData) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `❌ Token not found on DexScreener.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Try to get full analysis
      let analysis = null;
      try {
        analysis = await analyzeToken(address, {
          address: '',
          tokenMint: address,
          baseMint: address,
          quoteMint: '',
          baseReserve: 0,
          quoteReserve: 0,
          lpMint: '',
          source: 'dexscreener',
          createdAt: new Date(),
        });
      } catch {
        // Fall back to DexScreener data only
      }

      // Build token data object
      const tokenData = {
        mint: address,
        symbol: dexData.baseToken.symbol,
        liquidityUsd: dexData.liquidity?.usd,
        lpBurnedPercent: analysis?.liquidity?.lpBurnedPercent,
        lpLockedPercent: analysis?.liquidity?.lpLockedPercent,
        totalHolders: analysis?.holders?.total,
        top10Percent: analysis?.holders?.top10Percent,
        top20Percent: analysis?.holders?.top20Percent,
        largestHolderPercent: analysis?.holders?.largestHolderPercent,
        whaleCount: analysis?.holders?.whaleCount,
        mintRevoked: analysis?.contract?.mintRevoked,
        freezeRevoked: analysis?.contract?.freezeRevoked,
        isHoneypot: analysis?.contract?.isHoneypot,
        hasTransferFee: analysis?.contract?.hasTransferFee,
        transferFeePercent: analysis?.contract?.transferFeePercent,
        hasTwitter: analysis?.socials?.twitter !== undefined,
        hasTelegram: analysis?.socials?.telegram !== undefined,
        hasWebsite: analysis?.socials?.website !== undefined,
        twitterFollowers: analysis?.socials?.twitter?.followers,
        telegramMembers: analysis?.socials?.telegram?.members,
        priceChange1h: dexData.priceChange?.h1,
        priceChange24h: dexData.priceChange?.h24,
        volume24h: dexData.volume?.h24,
        marketCap: dexData.marketCap,
      };

      // Get pattern matches
      const matches = await patternDetector.getTopMatches(tokenData, 5);
      const prediction = await patternDetector.predictOutcome(tokenData);

      let message = `<b>📊 Pattern Analysis: ${dexData.baseToken.symbol}</b>\n\n`;

      if (matches.length === 0) {
        message += `<i>No strong pattern matches found.</i>\n\n`;
      } else {
        message += `<b>Top Matches:</b>\n`;
        for (const match of matches) {
          const emoji =
            match.patternType === 'success'
              ? '✅'
              : match.patternType === 'rug'
              ? '⚠️'
              : 'ℹ️';
          message += `${emoji} <b>${match.patternName}</b>\n`;
          message += `   ${(match.matchScore * 100).toFixed(0)}% match | `;
          message += `${(match.successRate * 100).toFixed(0)}% success rate\n`;
        }
        message += `\n`;
      }

      // Prediction
      const predEmoji =
        prediction.predictedOutcome === 'success'
          ? '🎯'
          : prediction.predictedOutcome === 'rug'
          ? '⚠️'
          : '❓';

      message += `${predEmoji} <b>Prediction:</b> ${prediction.predictedOutcome.toUpperCase()}\n`;
      message += `   Confidence: ${(prediction.confidence * 100).toFixed(0)}%\n`;
      message += `   Success Probability: ${(prediction.successProbability * 100).toFixed(0)}%\n\n`;

      if (prediction.reasoning.length > 0) {
        message += `<b>💡 Reasoning:</b>\n`;
        for (const reason of prediction.reasoning.slice(0, 3)) {
          message += `  • ${reason}\n`;
        }
      }

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        message,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Match patterns command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error analyzing patterns. Please try again.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /similartokens command - Find similar successful tokens
  bot.command('similartokens', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Similar Successful Tokens</b>\n\n` +
          `Usage: <code>/similartokens [token_address]</code>\n\n` +
          `Finds successful tokens with similar characteristics.`
      );
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`🔍 Finding similar tokens...`);

    try {
      // Get token data
      const dexData = await dexScreenerService.getTokenData(address);

      if (!dexData) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `❌ Token not found.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Try to get full analysis
      let analysis = null;
      try {
        analysis = await analyzeToken(address, {
          address: '',
          tokenMint: address,
          baseMint: address,
          quoteMint: '',
          baseReserve: 0,
          quoteReserve: 0,
          lpMint: '',
          source: 'dexscreener',
          createdAt: new Date(),
        });
      } catch {
        // Continue with limited data
      }

      const tokenData = {
        mint: address,
        symbol: dexData.baseToken.symbol,
        liquidityUsd: dexData.liquidity?.usd,
        lpBurnedPercent: analysis?.liquidity?.lpBurnedPercent,
        lpLockedPercent: analysis?.liquidity?.lpLockedPercent,
        totalHolders: analysis?.holders?.total,
        top10Percent: analysis?.holders?.top10Percent,
        top20Percent: analysis?.holders?.top20Percent,
        largestHolderPercent: analysis?.holders?.largestHolderPercent,
        mintRevoked: analysis?.contract?.mintRevoked,
        freezeRevoked: analysis?.contract?.freezeRevoked,
        hasTwitter: analysis?.socials?.twitter !== undefined,
        hasTelegram: analysis?.socials?.telegram !== undefined,
        hasWebsite: analysis?.socials?.website !== undefined,
      };

      const similarTokens = await patternDetector.getSimilarSuccessfulTokens(tokenData, 5);

      let message = `<b>💎 Similar Successful Tokens</b>\n`;
      message += `<i>Similar to ${dexData.baseToken.symbol}</i>\n\n`;

      if (similarTokens.length === 0) {
        message += `<i>No similar successful tokens found yet.</i>\n`;
        message += `<i>More data needed for comparisons.</i>`;
      } else {
        for (const token of similarTokens) {
          const priceChange = token.price_change_24h || 0;
          const emoji = priceChange > 100 ? '🚀' : priceChange > 50 ? '📈' : '✅';

          message += `${emoji} <b>${token.symbol}</b>\n`;
          message += `   Similarity: ${(token.similarityScore * 100).toFixed(0)}%\n`;

          if (priceChange !== 0) {
            const sign = priceChange >= 0 ? '+' : '';
            message += `   Performance: ${sign}${priceChange.toFixed(0)}%\n`;
          }

          if (token.max_price && token.initial_price) {
            const multiplier = token.max_price / token.initial_price;
            message += `   Peak: ${multiplier.toFixed(1)}x\n`;
          }

          message += `\n`;
        }
      }

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        message,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Similar tokens command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error finding similar tokens.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /refreshpatterns command - Rediscover patterns (admin only)
  bot.command('refreshpatterns', async (ctx: Context) => {
    // Simple admin check - you can enhance this
    const userId = ctx.from?.id;
    const adminIds = [123456789]; // TODO: Load from config

    if (!userId || !adminIds.includes(userId)) {
      await ctx.replyWithHTML(`❌ Admin only command.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`🔄 Rediscovering patterns from historical data...\n<i>This may take a moment...</i>`);

    try {
      const discoveredPatterns = await patternDetector.discoverPatterns();
      await patternDetector.updatePatternMetrics();

      const stats = patternDetector.getOverallStats();

      let message = `<b>✅ Pattern Discovery Complete</b>\n\n`;
      message += `📊 Discovered: ${discoveredPatterns.length} new patterns\n`;
      message += `📈 Total Active: ${stats.activePatterns}\n`;
      message += `🚀 Success Patterns: ${stats.successPatterns}\n`;
      message += `💀 Rug Patterns: ${stats.rugPatterns}\n`;
      message += `📊 Avg Success Rate: ${(stats.avgSuccessRate * 100).toFixed(1)}%\n`;

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        message,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Refresh patterns command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error refreshing patterns.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // Callback handlers
  bot.action('patterns_refresh', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');

    const stats = patternDetector.getOverallStats();
    const successPatterns = database.all<any>(
      `SELECT * FROM success_patterns 
       WHERE pattern_type = 'success' AND is_active = 1 
       ORDER BY success_rate DESC 
       LIMIT 10`
    );

    const rugPatterns = database.all<any>(
      `SELECT * FROM success_patterns 
       WHERE pattern_type = 'rug' AND is_active = 1 
       ORDER BY success_rate DESC 
       LIMIT 10`
    );

    let message = `<b>📊 Discovered Patterns</b>\n\n`;
    message += `📈 Total Patterns: ${stats.totalPatterns} (${stats.activePatterns} active)\n`;
    message += `✅ Success Patterns: ${stats.successPatterns}\n`;
    message += `❌ Rug Patterns: ${stats.rugPatterns}\n`;
    message += `📊 Avg Success Rate: ${(stats.avgSuccessRate * 100).toFixed(1)}%\n\n`;

    if (successPatterns.length > 0) {
      message += `<b>🚀 Top Success Patterns:</b>\n`;
      for (const pattern of successPatterns.slice(0, 5)) {
        message += `• <b>${pattern.pattern_name}</b>\n`;
        message += `  ${(pattern.success_rate * 100).toFixed(0)}% success | `;
        message += `${pattern.average_peak_multiplier.toFixed(1)}x avg peak\n`;
      }
      message += `\n`;
    }

    if (rugPatterns.length > 0) {
      message += `<b>💀 Top Rug Patterns:</b>\n`;
      for (const pattern of rugPatterns.slice(0, 5)) {
        message += `• <b>${pattern.pattern_name}</b>\n`;
        message += `  ${(pattern.success_rate * 100).toFixed(0)}% detection rate\n`;
      }
    }

    message += `\n<i>Use /pattern &lt;name&gt; for details</i>`;

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🚀 Success', callback_data: 'patterns_success' },
            { text: '💀 Rugs', callback_data: 'patterns_rug' },
          ],
          [{ text: '🔄 Refresh', callback_data: 'patterns_refresh' }],
        ],
      },
    });
  });

  bot.action('patterns_success', async (ctx) => {
    await ctx.answerCbQuery();

    const patterns = database.all<any>(
      `SELECT * FROM success_patterns 
       WHERE pattern_type = 'success' AND is_active = 1 
       ORDER BY success_rate DESC`
    );

    let message = `<b>🚀 Success Patterns</b>\n\n`;

    if (patterns.length === 0) {
      message += `<i>No success patterns discovered yet.</i>`;
    } else {
      for (const pattern of patterns) {
        message += `• <b>${pattern.pattern_name}</b>\n`;
        message += `  Success Rate: ${(pattern.success_rate * 100).toFixed(0)}%\n`;
        message += `  Avg Peak: ${pattern.average_peak_multiplier.toFixed(1)}x\n`;
        message += `  Occurrences: ${pattern.occurrence_count}\n\n`;
      }
    }

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '« Back', callback_data: 'patterns_refresh' }]],
      },
    });
  });

  bot.action('patterns_rug', async (ctx) => {
    await ctx.answerCbQuery();

    const patterns = database.all<any>(
      `SELECT * FROM success_patterns 
       WHERE pattern_type = 'rug' AND is_active = 1 
       ORDER BY success_rate DESC`
    );

    let message = `<b>💀 Rug Patterns</b>\n\n`;

    if (patterns.length === 0) {
      message += `<i>No rug patterns discovered yet.</i>`;
    } else {
      for (const pattern of patterns) {
        message += `• <b>${pattern.pattern_name}</b>\n`;
        message += `  Detection Rate: ${(pattern.success_rate * 100).toFixed(0)}%\n`;
        message += `  Occurrences: ${pattern.occurrence_count}\n\n`;
      }
    }

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '« Back', callback_data: 'patterns_refresh' }]],
      },
    });
  });
}
