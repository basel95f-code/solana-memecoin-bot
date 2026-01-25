import type { Context, Telegraf } from 'telegraf';
import { meteoraMonitor } from '../../monitors/meteora';
import { orcaMonitor } from '../../monitors/orca';
import { jupiterMonitor } from '../../monitors/jupiter';
import { raydiumMonitor } from '../../monitors/raydium';
import { pumpFunMonitor } from '../../monitors/pumpfun';
import { config } from '../../config';
import { backToMenuKeyboard } from '../keyboards';

/**
 * Register DEX statistics commands
 */
export function registerDexStatsCommands(bot: Telegraf): void {
  // /meteora - Show Meteora DLMM monitor stats
  bot.command('meteora', async (ctx: Context) => {
    if (!config.monitors.meteora?.enabled) {
      await ctx.reply('❌ Meteora monitor is disabled.');
      return;
    }

    const health = meteoraMonitor.getHealth();
    const pairCount = meteoraMonitor.getKnownPairCount();
    const isHealthy = meteoraMonitor.isHealthy();
    const isActive = meteoraMonitor.isActive();

    const statusEmoji = isActive ? (isHealthy ? '🟢' : '🟡') : '🔴';
    const stateText = isActive ? (isHealthy ? 'Active' : 'Degraded') : 'Stopped';

    let message = `${statusEmoji} <b>Meteora DLMM Monitor</b>\n\n`;
    message += `Status: ${stateText}\n`;
    message += `Known Pairs: ${pairCount.toLocaleString()}\n`;

    if (health.lastSuccessfulSync > 0) {
      const ago = Math.floor((Date.now() - health.lastSuccessfulSync) / 1000);
      message += `Last Sync: ${formatTimeAgo(ago)}\n`;
    }

    if (health.consecutiveFailures > 0) {
      message += `\n⚠️ Failures: ${health.consecutiveFailures}\n`;
      if (health.lastError) {
        message += `Error: ${health.lastError}\n`;
      }
    }

    message += `\n📊 Meteora DLMM pools feature concentrated liquidity for efficient trading.`;
    message += `\n🔗 API: https://dlmm-api.meteora.ag/`;

    await ctx.replyWithHTML(message, backToMenuKeyboard());
  });

  // /orca - Show Orca Whirlpool monitor stats
  bot.command('orca', async (ctx: Context) => {
    if (!config.monitors.orca?.enabled) {
      await ctx.reply('❌ Orca monitor is disabled.');
      return;
    }

    const health = orcaMonitor.getHealth();
    const poolCount = orcaMonitor.getKnownPoolCount();
    const isHealthy = orcaMonitor.isHealthy();
    const isActive = orcaMonitor.isActive();

    const statusEmoji = isActive ? (isHealthy ? '🟢' : '🟡') : '🔴';
    const stateText = isActive ? (isHealthy ? 'Active' : 'Degraded') : 'Stopped';

    let message = `${statusEmoji} <b>Orca Whirlpool Monitor</b>\n\n`;
    message += `Status: ${stateText}\n`;
    message += `Known Pools: ${poolCount.toLocaleString()}\n`;

    if (health.lastSuccessfulSync > 0) {
      const ago = Math.floor((Date.now() - health.lastSuccessfulSync) / 1000);
      message += `Last Sync: ${formatTimeAgo(ago)}\n`;
    }

    if (health.consecutiveFailures > 0) {
      message += `\n⚠️ Failures: ${health.consecutiveFailures}\n`;
      if (health.lastError) {
        message += `Error: ${health.lastError}\n`;
      }
    }

    message += `\n📊 Orca Whirlpools are concentrated liquidity market makers (CLMMs).`;
    message += `\n🔗 API: https://api.mainnet.orca.so/`;

    await ctx.replyWithHTML(message, backToMenuKeyboard());
  });

  // /dex_stats - Compare all DEX sources
  bot.command('dex_stats', async (ctx: Context) => {
    let message = '<b>📊 DEX Monitor Comparison</b>\n\n';

    const dexStats: Array<{
      name: string;
      enabled: boolean;
      isActive: boolean;
      isHealthy: boolean;
      count: number;
      emoji: string;
    }> = [];

    // Raydium
    if (config.monitors.raydium.enabled) {
      dexStats.push({
        name: 'Raydium',
        enabled: true,
        isActive: raydiumMonitor.isActive(),
        isHealthy: true, // Raydium doesn't have health check
        count: 0, // Not tracked
        emoji: '💎',
      });
    }

    // Pump.fun
    if (config.monitors.pumpfun.enabled) {
      dexStats.push({
        name: 'Pump.fun',
        enabled: true,
        isActive: pumpFunMonitor.isActive(),
        isHealthy: true,
        count: 0, // Not tracked
        emoji: '🚀',
      });
    }

    // Jupiter
    if (config.monitors.jupiter.enabled) {
      dexStats.push({
        name: 'Jupiter',
        enabled: true,
        isActive: jupiterMonitor.isActive(),
        isHealthy: jupiterMonitor.isHealthy(),
        count: jupiterMonitor.getKnownTokenCount(),
        emoji: '🪐',
      });
    }

    // Meteora
    if (config.monitors.meteora?.enabled) {
      dexStats.push({
        name: 'Meteora',
        enabled: true,
        isActive: meteoraMonitor.isActive(),
        isHealthy: meteoraMonitor.isHealthy(),
        count: meteoraMonitor.getKnownPairCount(),
        emoji: '☄️',
      });
    }

    // Orca
    if (config.monitors.orca?.enabled) {
      dexStats.push({
        name: 'Orca',
        enabled: true,
        isActive: orcaMonitor.isActive(),
        isHealthy: orcaMonitor.isHealthy(),
        count: orcaMonitor.getKnownPoolCount(),
        emoji: '🐋',
      });
    }

    if (dexStats.length === 0) {
      message += '<i>No DEX monitors enabled.</i>\n\n';
      message += 'Enable monitors in your .env file:\n';
      message += '• RAYDIUM_ENABLED=true\n';
      message += '• PUMPFUN_ENABLED=true\n';
      message += '• JUPITER_ENABLED=true\n';
      message += '• METEORA_ENABLED=true\n';
      message += '• ORCA_ENABLED=true\n';
    } else {
      for (const dex of dexStats) {
        const statusEmoji = dex.isActive ? (dex.isHealthy ? '🟢' : '🟡') : '🔴';
        message += `${statusEmoji} ${dex.emoji} <b>${dex.name}</b>\n`;
        
        if (dex.count > 0) {
          message += `  Tracking: ${dex.count.toLocaleString()} items\n`;
        }
        
        message += '\n';
      }

      message += `<b>Active Monitors:</b> ${dexStats.filter(d => d.isActive).length}/${dexStats.length}\n`;
      message += `<b>Healthy:</b> ${dexStats.filter(d => d.isHealthy).length}/${dexStats.length}\n\n`;
      
      message += '💡 <i>The bot aggregates tokens from all enabled DEX sources for comprehensive coverage.</i>';
    }

    await ctx.replyWithHTML(message, backToMenuKeyboard());
  });
}

/**
 * Format time ago in human-readable format
 */
function formatTimeAgo(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
