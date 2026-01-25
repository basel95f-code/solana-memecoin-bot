/**
 * /influencers command - Show tracked influencers and their performance
 */

import type { Context, Telegraf } from 'telegraf';
import type { SupabaseDB } from '../../database/supabase-db';
import { logger } from '../../utils/logger';

export function registerInfluencersCommand(bot: Telegraf, db: SupabaseDB): void {
  bot.command('influencers', async (ctx: Context) => {
    try {
      // Fetch top influencers by success rate
      const { data: influencers, error } = await db.client
        .from('influencers')
        .select('*')
        .eq('is_tracked', true)
        .gte('total_calls', 3) // At least 3 calls
        .order('success_rate', { ascending: false })
        .limit(10);

      if (error) throw error;

      if (!influencers || influencers.length === 0) {
        await ctx.replyWithHTML(
          '<b>🎯 Tracked Influencers</b>\n\n' +
          'No influencers tracked yet.\n\n' +
          '<i>Influencers are automatically discovered when they mention tokens.</i>'
        );
        return;
      }

      let msg = '<b>🎯 Top Influencers (by success rate)</b>\n\n';

      for (let i = 0; i < influencers.length; i++) {
        const inf = influencers[i];
        const rank = i + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
        
        const successRate = parseFloat(inf.success_rate || 0);
        const avgReturn = parseFloat(inf.avg_return_percent || 0);
        const totalCalls = inf.total_calls || 0;
        const successfulCalls = inf.successful_calls || 0;
        
        const ratingEmoji = successRate >= 70 ? '🔥' : 
                           successRate >= 50 ? '✅' : 
                           successRate >= 30 ? '⚠️' : '❌';

        msg += `${medal} <b>@${inf.username}</b> ${inf.verified ? '✓' : ''} ${ratingEmoji}\n`;
        msg += `   ${(inf.followers_count || 0).toLocaleString()} followers\n`;
        msg += `   Calls: ${totalCalls} | Win: ${successRate.toFixed(0)}% (${successfulCalls}/${totalCalls})\n`;
        if (avgReturn !== 0) {
          msg += `   Avg return: ${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(1)}%\n`;
        }
        msg += `\n`;
      }

      msg += '<i>Use /influencer @username for details</i>';

      await ctx.replyWithHTML(msg);
    } catch (error) {
      logger.error('InfluencersCommand', 'Error fetching influencers', error);
      await ctx.replyWithHTML('❌ Failed to fetch influencer data');
    }
  });

  // /influencer @username - Show specific influencer details
  bot.command('influencer', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        '<b>🎯 Influencer Details</b>\n\n' +
        'Usage: <code>/influencer @username</code>\n\n' +
        'Example: <code>/influencer @solana_trader</code>'
      );
      return;
    }

    const username = args[0].replace('@', '').toLowerCase();

    try {
      // Fetch influencer
      const { data: influencer, error: infError } = await db.client
        .from('influencers')
        .select('*')
        .ilike('username', username)
        .single();

      if (infError || !influencer) {
        await ctx.replyWithHTML(
          `❌ Influencer not found: <code>@${username}</code>\n\n` +
          'They may not be tracked yet or haven\'t made token calls.'
        );
        return;
      }

      // Fetch recent calls
      const { data: calls, error: callsError } = await db.client
        .from('influencer_calls')
        .select('*')
        .eq('influencer_id', influencer.id)
        .order('called_at', { ascending: false })
        .limit(5);

      if (callsError) throw callsError;

      // Format message
      const successRate = parseFloat(influencer.success_rate || 0);
      const ratingEmoji = successRate >= 70 ? '🔥' : 
                         successRate >= 50 ? '✅' : 
                         successRate >= 30 ? '⚠️' : '❌';

      let msg = `<b>🎯 @${influencer.username}</b> ${influencer.verified ? '✓' : ''} ${ratingEmoji}\n\n`;
      
      msg += `<b>◆ Profile</b>\n`;
      msg += `Followers: ${(influencer.followers_count || 0).toLocaleString()}\n`;
      msg += `Tweets: ${(influencer.tweet_count || 0).toLocaleString()}\n`;
      msg += `Tracked: ${influencer.is_tracked ? 'Yes' : 'No'}\n\n`;

      msg += `<b>◆ Performance</b>\n`;
      msg += `Total calls: ${influencer.total_calls || 0}\n`;
      msg += `Success rate: <b>${successRate.toFixed(0)}%</b>\n`;
      msg += `Successful: ${influencer.successful_calls || 0}\n`;
      msg += `Failed: ${influencer.failed_calls || 0}\n`;
      
      const avgReturn = parseFloat(influencer.avg_return_percent || 0);
      if (avgReturn !== 0) {
        msg += `Avg return: ${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(1)}%\n`;
      }
      msg += `\n`;

      // Recent calls
      if (calls && calls.length > 0) {
        msg += `<b>◆ Recent Calls</b>\n`;
        for (const call of calls.slice(0, 3)) {
          const outcome = call.outcome === 'success' ? '✅' : 
                         call.outcome === 'fail' ? '❌' : '⏳';
          const changePercent = parseFloat(call.price_change_percent || 0);
          
          msg += `${outcome} ${call.symbol || 'Unknown'}`;
          if (call.outcome !== 'pending' && call.outcome !== null) {
            msg += ` (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(1)}%)`;
          }
          msg += `\n`;
        }
      } else {
        msg += `<i>No recent calls</i>\n`;
      }

      await ctx.replyWithHTML(msg);
    } catch (error) {
      logger.error('InfluencerCommand', 'Error fetching influencer details', error);
      await ctx.replyWithHTML('❌ Failed to fetch influencer details');
    }
  });
}
