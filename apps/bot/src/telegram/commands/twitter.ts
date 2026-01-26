/**
 * /twitter command - Show Twitter stats for a token
 */

import type { Context, Telegraf } from 'telegraf';
import type { supabaseDb } from '../../database/supabase-db';
import { logger } from '../../utils/logger';

export function registerTwitterCommand(bot: Telegraf, db: typeof supabaseDb): void {
  bot.command('twitter', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        '<b>🐦 Twitter Stats</b>\n\n' +
        'Usage: <code>/twitter [token symbol or address]</code>\n\n' +
        'Example:\n' +
        '<code>/twitter $BONK</code>\n' +
        '<code>/twitter DezXAZ8z7...</code>\n\n' +
        'Shows Twitter mentions, sentiment, and trending data.'
      );
      return;
    }

    const query = args.join(' ').trim();
    let tokenMint: string | null = null;
    let symbol: string | null = null;

    // Determine if it's an address or symbol
    if (query.length > 30) {
      tokenMint = query;
    } else {
      symbol = query.replace('$', '').toUpperCase();
    }

    try {
      // If symbol, try to resolve to mint
      if (symbol && !tokenMint) {
        const { data: token } = await db.client
          .from('analyzed_tokens')
          .select('mint')
          .eq('symbol', symbol)
          .order('analyzed_at', { ascending: false })
          .limit(1)
          .single();

        if (token) {
          tokenMint = token.mint;
        } else {
          await ctx.replyWithHTML(
            `❌ Token not found: <code>${symbol}</code>\n\n` +
            'Make sure the token has been analyzed first.'
          );
          return;
        }
      }

      if (!tokenMint) {
        await ctx.replyWithHTML('❌ Invalid token address or symbol');
        return;
      }

      // Fetch Twitter mentions (last 24h)
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const { data: mentions, error } = await db.client
        .from('twitter_mentions')
        .select('*')
        .eq('token_mint', tokenMint)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Calculate stats
      const totalMentions = mentions?.length || 0;
      const influencerMentions = mentions?.filter(m => m.is_influencer).length || 0;
      
      const avgSentiment = totalMentions > 0
        ? mentions.reduce((sum, m) => sum + parseFloat(m.sentiment_score), 0) / totalMentions
        : 0;

      const distribution = {
        positive: mentions?.filter(m => m.sentiment_label === 'positive').length || 0,
        negative: mentions?.filter(m => m.sentiment_label === 'negative').length || 0,
        neutral: mentions?.filter(m => m.sentiment_label === 'neutral').length || 0
      };

      // Sentiment emoji and label
      const sentimentEmoji = avgSentiment > 0.2 ? '🟢' : avgSentiment < -0.2 ? '🔴' : '⚪';
      const sentimentLabel = avgSentiment > 0.2 ? 'Bullish' : avgSentiment < -0.2 ? 'Bearish' : 'Neutral';

      // Get top tweet (highest engagement)
      const topTweet = mentions && mentions.length > 0
        ? mentions.reduce((best, m) => {
            const score = m.retweet_count * 2 + m.like_count + m.reply_count;
            const bestScore = best.retweet_count * 2 + best.like_count + best.reply_count;
            return score > bestScore ? m : best;
          })
        : null;

      // Format message
      let msg = `<b>🐦 Twitter Stats (24h)</b>\n\n`;
      msg += `<b>${symbol || 'Token'}</b>\n`;
      msg += `<code>${tokenMint.slice(0, 8)}...${tokenMint.slice(-6)}</code>\n\n`;

      msg += `<b>◆ Mentions</b>\n`;
      msg += `Total: <b>${totalMentions}</b>\n`;
      msg += `Influencers: ${influencerMentions} ${influencerMentions > 0 ? '🔥' : ''}\n\n`;

      msg += `<b>◆ Sentiment</b>\n`;
      msg += `${sentimentEmoji} <b>${sentimentLabel}</b> (${(avgSentiment * 100).toFixed(0)})\n`;
      msg += `✅ Positive: ${distribution.positive}\n`;
      msg += `❌ Negative: ${distribution.negative}\n`;
      msg += `⚪ Neutral: ${distribution.neutral}\n\n`;

      if (topTweet) {
        msg += `<b>◆ Top Tweet</b>\n`;
        msg += `By: @${topTweet.author_username}`;
        if (topTweet.is_influencer) msg += ` ✨`;
        msg += `\n`;
        msg += `❤️ ${topTweet.like_count} | 🔄 ${topTweet.retweet_count}\n`;
        const tweetPreview = topTweet.text.length > 100 
          ? topTweet.text.slice(0, 100) + '...' 
          : topTweet.text;
        msg += `\n<i>"${tweetPreview}"</i>\n`;
      } else {
        msg += '<i>No recent mentions</i>\n';
      }

      await ctx.replyWithHTML(msg);
    } catch (error) {
      logger.error('TwitterCommand', 'Error fetching Twitter stats', error);
      await ctx.replyWithHTML('❌ Failed to fetch Twitter stats');
    }
  });
}
