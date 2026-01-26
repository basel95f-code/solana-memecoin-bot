/**
 * /social_stats command - Social media overview
 */

import type { Context, Telegraf } from 'telegraf';
import type { supabaseDb } from '../../database/supabase-db';
import { logger } from '../../utils/logger';

export function registerSocialStatsCommand(bot: Telegraf, db: typeof supabaseDb): void {
  bot.command('social_stats', async (ctx: Context) => {
    try {
      // Fetch counts
      const [mentionsResult, influencersResult, trendsResult] = await Promise.all([
        db.client.from('twitter_mentions').select('id', { count: 'exact', head: true }),
        db.client.from('influencers').select('id', { count: 'exact', head: true }).eq('is_tracked', true),
        db.client.from('social_stats_cache').select('*').order('trending_score', { ascending: false }).limit(5)
      ]);

      const totalMentions = mentionsResult.count || 0;
      const trackedInfluencers = influencersResult.count || 0;

      // Get last 24h stats
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const { data: recentMentions, error: recentError } = await db.client
        .from('twitter_mentions')
        .select('*')
        .gte('created_at', yesterday);

      if (recentError) throw recentError;

      const mentions24h = recentMentions?.length || 0;
      const influencerMentions24h = recentMentions?.filter(m => m.is_influencer).length || 0;
      
      // Calculate avg sentiment
      const avgSentiment = mentions24h > 0
        ? recentMentions.reduce((sum, m) => sum + parseFloat(m.sentiment_score), 0) / mentions24h
        : 0;

      const sentimentEmoji = avgSentiment > 0.2 ? '🟢' : avgSentiment < -0.2 ? '🔴' : '⚪';
      const sentimentLabel = avgSentiment > 0.2 ? 'Bullish' : avgSentiment < -0.2 ? 'Bearish' : 'Neutral';

      // Format message
      let msg = '<b>🌐 Social Media Overview</b>\n\n';

      msg += '<b>◆ Twitter Activity (24h)</b>\n';
      msg += `Total mentions: <b>${mentions24h}</b>\n`;
      msg += `Influencer mentions: ${influencerMentions24h} 🔥\n`;
      msg += `Overall sentiment: ${sentimentEmoji} ${sentimentLabel}\n\n`;

      msg += '<b>◆ Tracking</b>\n';
      msg += `Total mentions: ${totalMentions.toLocaleString()}\n`;
      msg += `Tracked influencers: ${trackedInfluencers}\n\n`;

      // Trending tokens
      if (trendsResult.data && trendsResult.data.length > 0) {
        msg += '<b>◆ Trending Tokens</b>\n';
        for (const trend of trendsResult.data.slice(0, 3)) {
          const trendEmoji = trend.sentiment_trend === 'bullish' ? '🟢' :
                            trend.sentiment_trend === 'bearish' ? '🔴' : '⚪';
          msg += `${trendEmoji} ${trend.symbol} - ${trend.total_mentions_24h || 0} mentions\n`;
        }
        msg += '\n';
      }

      msg += '<i>Commands:</i>\n';
      msg += '<code>/twitter [token]</code> - Token Twitter stats\n';
      msg += '<code>/influencers</code> - Top influencers\n';

      await ctx.replyWithHTML(msg);
    } catch (error) {
      logger.error('SocialStatsCommand', 'Error fetching social stats', error);
      await ctx.replyWithHTML('❌ Failed to fetch social media statistics');
    }
  });
}
