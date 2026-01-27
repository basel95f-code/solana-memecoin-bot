import type { Context, Telegraf } from 'telegraf';
import { storageService } from '../../services/storage';
import { formatPercent } from '../formatters';

/**
 * Helper to safely get text from message
 */
function getMessageText(ctx: Context): string | undefined {
  return ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
}

// Profile emoji mapping
const PROFILE_EMOJI: Record<string, string> = {
  sniper: '🎯',
  early: '⚡',
  balanced: '⚖️',
  conservative: '🛡️',
  aggressive: '🔥',
  whale: '🐋',
  degen: '🎰',
  graduation: '🎓',
  cto: '🔍',
  micro: '💎',
  small: '🥉',
  mid: '🥈',
  large: '🥇',
  mega: '👑',
  trending: '🔥',
  momentum: '📈',
  fresh: '🆕',
  revival: '💀',
  runner: '🏃',
  custom: '⚙️',
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function registerPerformanceCommands(bot: Telegraf): void {
  // /performance - Show comprehensive performance dashboard
  bot.command('performance', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const perfData = storageService.getFilterPerformance(chatId);
    const settings = storageService.getUserSettings(chatId);

    if (!perfData || Object.keys(perfData.profileStats).length === 0) {
      await ctx.replyWithHTML(
        `📊 <b>PERFORMANCE DASHBOARD</b>\n\n` +
        `No performance data yet.\n\n` +
        `The bot tracks outcomes when you:\n` +
        `• Check tokens with <code>/check</code>\n` +
        `• Add to watchlist with <code>/watch</code>\n` +
        `• Mark outcomes with <code>/outcome</code>\n\n` +
        `After analyzing tokens, come back to see:\n` +
        `✅ Win rates by profile\n` +
        `📈 Performance trends\n` +
        `🎯 Smart money correlation\n` +
        `🏆 Best performing setups`
      );
      return;
    }

    // Build performance message
    let msg = `📊 <b>PERFORMANCE DASHBOARD</b>\n\n`;

    // Overall stats
    msg += `━━━ <b>OVERALL</b> ━━━\n`;
    msg += `🎯 Current Profile: <b>${settings.filters.profile.toUpperCase()}</b>\n`;
    msg += `📅 Tracking Since: ${new Date(perfData.firstOutcome || Date.now()).toLocaleDateString()}\n`;
    msg += `🔄 Last Updated: ${formatDuration(Math.floor((Date.now() - perfData.lastUpdated) / 1000))} ago\n\n`;

    // Profile rankings (top 5)
    const rankedProfiles = Object.entries(perfData.profileStats)
      .filter(([_, stats]) => stats.total >= 5) // Minimum 5 outcomes for ranking
      .sort((a, b) => b[1].winRate - a[1].winRate)
      .slice(0, 5);

    if (rankedProfiles.length > 0) {
      msg += `━━━ <b>TOP PROFILES</b> (min 5 trades) ━━━\n`;
      rankedProfiles.forEach(([profile, stats], index) => {
        const emoji = PROFILE_EMOJI[profile] || '📊';
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '  ';
        msg += `${medal} ${emoji} <b>${profile}</b>\n`;
        msg += `   Win Rate: ${stats.winRate.toFixed(1)}% (${stats.winners}/${stats.total})\n`;
        if (stats.avgPriceChange24h !== 0) {
          msg += `   Avg 24h: ${formatPercent(stats.avgPriceChange24h)}\n`;
        }
      });
      msg += '\n';
    }

    // Current profile performance
    const currentStats = perfData.profileStats[settings.filters.profile];
    if (currentStats && currentStats.total > 0) {
      const emoji = PROFILE_EMOJI[settings.filters.profile] || '📊';
      msg += `━━━ <b>CURRENT PROFILE</b> ━━━\n`;
      msg += `${emoji} <b>${settings.filters.profile.toUpperCase()}</b>\n\n`;
      msg += `🏆 Win Rate: ${currentStats.winRate.toFixed(1)}%\n`;
      msg += `✅ Winners: ${currentStats.winners}\n`;
      msg += `❌ Losers: ${currentStats.losers}\n`;
      msg += `📊 Total Analyzed: ${currentStats.total}\n`;
      
      if (currentStats.avgPriceChange24h !== 0) {
        msg += `📈 Avg 24h Change: ${formatPercent(currentStats.avgPriceChange24h)}\n`;
      }
      
      if (currentStats.avgRiskScore) {
        msg += `🛡️ Avg Risk Score: ${currentStats.avgRiskScore.toFixed(0)}\n`;
      }
      
      msg += '\n';
    }

    // Smart money correlation (if available)
    if (perfData.smartMoneyCorrelation) {
      const sm = perfData.smartMoneyCorrelation;
      if (sm.tokensWithSmartMoney > 0) {
        const smWinRate = (sm.winnerWithSmartMoney / sm.tokensWithSmartMoney) * 100;
        const noSmWinRate = sm.tokensWithoutSmartMoney > 0 
          ? (sm.winnerWithoutSmartMoney / sm.tokensWithoutSmartMoney) * 100 
          : 0;
        
        msg += `━━━ <b>SMART MONEY IMPACT</b> ━━━\n`;
        msg += `🐋 With Smart Money: ${smWinRate.toFixed(1)}% (${sm.tokensWithSmartMoney} tokens)\n`;
        msg += `🤷 Without Smart Money: ${noSmWinRate.toFixed(1)}% (${sm.tokensWithoutSmartMoney} tokens)\n`;
        
        const correlation = smWinRate - noSmWinRate;
        if (correlation > 10) {
          msg += `\n💡 <b>Strong positive correlation!</b> Smart money signals add ${correlation.toFixed(1)}% to win rate.\n`;
        } else if (correlation > 5) {
          msg += `\n✅ Positive correlation: +${correlation.toFixed(1)}%\n`;
        } else if (correlation < -5) {
          msg += `\n⚠️ Smart money signals not helping your style.\n`;
        }
        msg += '\n';
      }
    }

    // Recommendations
    msg += `━━━ <b>RECOMMENDATIONS</b> ━━━\n`;
    
    if (rankedProfiles.length > 0 && settings.filters.profile !== rankedProfiles[0][0]) {
      const bestProfile = rankedProfiles[0][0];
      const bestStats = rankedProfiles[0][1];
      msg += `🎯 Try <code>/filter ${bestProfile}</code> (${bestStats.winRate.toFixed(0)}% win rate)\n`;
    }

    if (perfData.profileStats[settings.filters.profile]?.total >= 5) {
      msg += `📊 Run <code>/filter optimize</code> to auto-switch to best profile\n`;
    }

    msg += `🔧 Use <code>/filter tighten</code> or <code>/filter loosen</code> to adjust\n`;
    msg += `📈 Track outcomes with <code>/outcome &lt;mint&gt; win/loss</code>\n`;

    await ctx.replyWithHTML(msg);
  });

  // /winrate [profile] - Show detailed win rate for a specific profile
  bot.command('winrate', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const messageText = getMessageText(ctx);
    const args = messageText?.split(' ').slice(1) || [];
    const settings = storageService.getUserSettings(chatId);
    const profile = args[0]?.toLowerCase() || settings.filters.profile;

    const perfData = storageService.getFilterPerformance(chatId);
    const stats = perfData?.profileStats[profile];

    if (!stats || stats.total === 0) {
      await ctx.replyWithHTML(
        `No performance data for <b>${profile.toUpperCase()}</b> yet.\n\n` +
        `Use this profile and mark outcomes to build stats.`
      );
      return;
    }

    const emoji = PROFILE_EMOJI[profile] || '📊';
    
    let msg = `${emoji} <b>${profile.toUpperCase()} WIN RATE</b>\n\n`;
    msg += `━━━ <b>STATS</b> ━━━\n`;
    msg += `🏆 Win Rate: ${stats.winRate.toFixed(1)}%\n`;
    msg += `✅ Winners: ${stats.winners}\n`;
    msg += `❌ Losers: ${stats.losers}\n`;
    msg += `📊 Total: ${stats.total}\n\n`;

    if (stats.avgPriceChange24h !== 0) {
      msg += `━━━ <b>PERFORMANCE</b> ━━━\n`;
      msg += `📈 Avg 24h Change: ${formatPercent(stats.avgPriceChange24h)}\n`;
      
      if (stats.avgRiskScore) {
        msg += `🛡️ Avg Risk Score: ${stats.avgRiskScore.toFixed(0)}\n`;
      }
      msg += '\n';
    }

    // Sample size indicator
    if (stats.total < 5) {
      msg += `⚠️ <b>Small Sample</b>\n`;
      msg += `Need ${5 - stats.total} more outcomes for reliable stats.\n`;
    } else if (stats.total < 20) {
      msg += `📊 <b>Building Confidence</b>\n`;
      msg += `${20 - stats.total} more outcomes for high confidence.\n`;
    } else {
      msg += `✅ <b>Reliable Data</b>\n`;
      msg += `Sample size is statistically significant.\n`;
    }

    await ctx.replyWithHTML(msg);
  });

  // /compare_profiles - Compare current profile vs others
  bot.command('compare_profiles', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const perfData = storageService.getFilterPerformance(chatId);
    const settings = storageService.getUserSettings(chatId);

    if (!perfData || Object.keys(perfData.profileStats).length < 2) {
      await ctx.replyWithHTML(
        `Not enough data to compare profiles.\n\n` +
        `Try different profiles and track outcomes to build comparison data.`
      );
      return;
    }

    const currentProfile = settings.filters.profile;
    const currentStats = perfData.profileStats[currentProfile];

    // Get all profiles with enough data
    const profiles = Object.entries(perfData.profileStats)
      .filter(([_, stats]) => stats.total >= 3)
      .sort((a, b) => b[1].winRate - a[1].winRate);

    if (profiles.length === 0) {
      await ctx.replyWithHTML(`Not enough tracked outcomes yet. Each profile needs at least 3 outcomes.`);
      return;
    }

    let msg = `📊 <b>PROFILE COMPARISON</b>\n\n`;
    msg += `Current: <b>${currentProfile.toUpperCase()}</b>\n\n`;
    msg += `━━━ <b>ALL PROFILES</b> (min 3 trades) ━━━\n`;

    profiles.forEach(([profile, stats], index) => {
      const emoji = PROFILE_EMOJI[profile] || '📊';
      const isCurrent = profile === currentProfile;
      const marker = isCurrent ? '➡️' : '  ';
      
      msg += `${marker}${emoji} <b>${profile}</b>\n`;
      msg += `   Win: ${stats.winRate.toFixed(0)}% (${stats.winners}/${stats.total})`;
      
      if (stats.avgPriceChange24h !== 0) {
        msg += ` | Avg: ${formatPercent(stats.avgPriceChange24h)}`;
      }
      msg += '\n';
    });

    // Recommendation
    if (currentStats && profiles[0][0] !== currentProfile) {
      const bestProfile = profiles[0][0];
      const bestStats = profiles[0][1];
      const improvement = bestStats.winRate - currentStats.winRate;
      
      if (improvement > 10) {
        msg += `\n💡 <b>Suggestion:</b> <code>/filter ${bestProfile}</code> performs ${improvement.toFixed(0)}% better!`;
      }
    }

    await ctx.replyWithHTML(msg);
  });
}
