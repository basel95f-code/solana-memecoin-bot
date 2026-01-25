/**
 * Cluster Detection Telegram Commands
 */

import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { PublicKey } from '@solana/web3.js';
import { enhancedClusterDetector } from '../../services/enhancedClusterDetector';
import type { WalletCluster, SybilAttack } from '../../services/enhancedClusterDetector';

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

function formatCluster(cluster: WalletCluster): string {
  let msg = '';

  // Severity header
  const severityIcon = cluster.severity === 'critical' ? '🔴' :
                      cluster.severity === 'high' ? '🟠' :
                      cluster.severity === 'medium' ? '🟡' : '🟢';
  
  msg += `${severityIcon} <b>${cluster.severity.toUpperCase()} RISK CLUSTER</b>\n\n`;

  // Basic info
  msg += `🪙 Token: ${cluster.tokenSymbol || truncateAddress(cluster.tokenMint, 8)}\n`;
  msg += `👥 Wallets: ${cluster.wallets.length}\n`;
  msg += `💵 Total Value: ${cluster.totalValue.toFixed(2)} SOL\n`;
  msg += `📊 Avg Amount: ${cluster.avgAmount.toFixed(2)} SOL\n`;
  msg += `⏱ Time Window: ${(cluster.timeWindow / 1000).toFixed(0)}s\n\n`;

  // Patterns detected
  msg += `🔍 <b>Patterns Detected:</b>\n`;
  if (cluster.temporalSync) {
    msg += `   ⏰ Temporal Sync - Coordinated timing\n`;
  }
  if (cluster.amountSync) {
    msg += `   💰 Amount Sync - Similar transaction sizes\n`;
  }
  if (cluster.crossTokenActivity.length > 0) {
    msg += `   🔗 Cross-token - Active on ${cluster.crossTokenActivity.length + 1} tokens\n`;
  }
  msg += `\n`;

  // Suspicion score
  msg += `🚨 <b>Suspicion Score: ${cluster.suspicionScore}/100</b>\n\n`;

  // Warnings
  msg += `⚠️ <b>Warnings:</b>\n`;
  for (const warning of cluster.warnings) {
    msg += `   • ${warning}\n`;
  }
  msg += `\n`;

  // Recommendation
  const recIcon = cluster.recommendation === 'avoid' ? '🚫' :
                 cluster.recommendation === 'caution' ? '⚠️' : '👀';
  
  msg += `${recIcon} <b>Recommendation: ${cluster.recommendation.toUpperCase()}</b>\n`;
  
  if (cluster.recommendation === 'avoid') {
    msg += `<i>Do not trade this token - likely pump & dump!</i>`;
  } else if (cluster.recommendation === 'caution') {
    msg += `<i>Be very careful - suspicious activity detected</i>`;
  } else {
    msg += `<i>Monitor closely for further suspicious activity</i>`;
  }

  return msg;
}

function formatSybilAttack(attack: SybilAttack): string {
  let msg = `🚨 <b>SYBIL ATTACK DETECTED</b> 🚨\n\n`;
  
  msg += `🪙 Token: ${attack.tokenSymbol || truncateAddress(attack.tokenMint, 8)}\n`;
  msg += `👥 Total Wallets: ${attack.totalWallets}\n`;
  msg += `💵 Total Value: ${attack.totalValue.toFixed(2)} SOL\n`;
  msg += `🎯 Attack Type: ${attack.attackType.toUpperCase().replace('_', ' ')}\n`;
  msg += `📊 Confidence: ${attack.confidence.toFixed(0)}%\n\n`;

  msg += `<b>⚠️ WARNING ⚠️</b>\n`;
  
  if (attack.attackType === 'pump') {
    msg += `Coordinated pump detected!\n`;
    msg += `Multiple wallet groups buying simultaneously.\n`;
    msg += `Likely dump incoming - AVOID!\n\n`;
  } else if (attack.attackType === 'dump') {
    msg += `Coordinated dump detected!\n`;
    msg += `Multiple wallet groups selling simultaneously.\n`;
    msg += `Exit immediately if you hold this token!\n\n`;
  } else {
    msg += `Wash trading detected!\n`;
    msg += `Fake volume from coordinated wallets.\n`;
    msg += `Do not trust price action - AVOID!\n\n`;
  }

  msg += `<b>Clusters Detected: ${attack.clusters.length}</b>\n`;
  for (let i = 0; i < Math.min(3, attack.clusters.length); i++) {
    const cluster = attack.clusters[i];
    msg += `   ${i + 1}. ${cluster.wallets.length} wallets, ${cluster.severity} risk\n`;
  }

  msg += `\n🚫 <b>RECOMMENDATION: AVOID THIS TOKEN</b>`;

  return msg;
}

export function registerClusterCommands(bot: Telegraf): void {
  // /clusters [token] - Show wallet clusters for a token
  bot.command('clusters', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      // Show all critical clusters
      const critical = enhancedClusterDetector.getCriticalClusters();
      
      if (critical.length === 0) {
        await ctx.replyWithHTML(
          `<b>🔍 Cluster Detection</b>\n\n` +
          `No critical clusters detected currently.\n\n` +
          `Usage:\n` +
          `<code>/clusters [token]</code> - Analyze token for wallet clusters\n` +
          `<code>/sybil [token]</code> - Check for Sybil attack\n\n` +
          `<i>Detects coordinated wallet groups and pump & dump schemes</i>`
        );
        return;
      }

      let msg = `<b>🚨 Critical Clusters Detected</b>\n\n`;
      msg += `${critical.length} high-risk cluster(s) found:\n\n`;

      for (const cluster of critical.slice(0, 5)) {
        msg += `<b>${cluster.tokenSymbol || truncateAddress(cluster.tokenMint, 6)}</b>\n`;
        msg += `   Wallets: ${cluster.wallets.length} | Score: ${cluster.suspicionScore}/100\n`;
        msg += `   /clusters ${cluster.tokenMint.slice(0, 12)}...\n\n`;
      }

      await ctx.replyWithHTML(msg);
      return;
    }

    const tokenMint = args[0];

    if (!isValidSolanaAddress(tokenMint)) {
      await ctx.replyWithHTML(`Invalid token address.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`Analyzing token for wallet clusters...`);

    try {
      // Analyze token for clusters
      const clusters = await enhancedClusterDetector.analyzeToken(tokenMint);

      if (clusters.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `<b>🔍 Cluster Analysis</b>\n\n` +
          `No suspicious wallet clusters detected for this token.\n\n` +
          `<i>This is a good sign - no coordinated pump/dump activity found.</i>`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Show first cluster with full details
      const formatted = formatCluster(clusters[0]);

      let summary = `\n\n<b>Summary:</b> ${clusters.length} cluster(s) detected\n`;
      
      const bySeverity = {
        critical: clusters.filter(c => c.severity === 'critical').length,
        high: clusters.filter(c => c.severity === 'high').length,
        medium: clusters.filter(c => c.severity === 'medium').length,
        low: clusters.filter(c => c.severity === 'low').length,
      };

      if (bySeverity.critical > 0) summary += `🔴 Critical: ${bySeverity.critical}\n`;
      if (bySeverity.high > 0) summary += `🟠 High: ${bySeverity.high}\n`;
      if (bySeverity.medium > 0) summary += `🟡 Medium: ${bySeverity.medium}\n`;
      if (bySeverity.low > 0) summary += `🟢 Low: ${bySeverity.low}`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url('View Chart', `https://dexscreener.com/solana/${tokenMint}`)],
      ]);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        formatted + summary,
        {
          parse_mode: 'HTML',
          ...keyboard,
        }
      );
    } catch (error) {
      console.error('Clusters command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `Error analyzing clusters. Please try again.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /sybil [token] - Check for Sybil attack
  bot.command('sybil', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>🚨 Sybil Attack Detection</b>\n\n` +
        `Usage: <code>/sybil [token_address]</code>\n\n` +
        `Checks for coordinated Sybil attacks:\n` +
        `• Pump schemes (coordinated buying)\n` +
        `• Dump schemes (coordinated selling)\n` +
        `• Wash trading (fake volume)\n\n` +
        `<i>Helps avoid pump & dump scams</i>`
      );
      return;
    }

    const tokenMint = args[0];

    if (!isValidSolanaAddress(tokenMint)) {
      await ctx.replyWithHTML(`Invalid token address.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`Checking for Sybil attack...`);

    try {
      // Analyze token for clusters first
      const clusters = await enhancedClusterDetector.analyzeToken(tokenMint);

      // Check if suspicious
      const suspiciousCheck = enhancedClusterDetector.isTokenSuspicious(tokenMint);

      if (!suspiciousCheck.suspicious) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `<b>✅ No Sybil Attack Detected</b>\n\n` +
          `Token appears clean - no coordinated wallet activity found.\n\n` +
          `<i>This doesn't guarantee safety - always DYOR!</i>`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Build warning message
      let msg = `<b>⚠️ SUSPICIOUS ACTIVITY DETECTED</b>\n\n`;
      msg += `Severity: ${suspiciousCheck.severity?.toUpperCase()}\n`;
      msg += `Reason: ${suspiciousCheck.reason}\n\n`;
      msg += `<b>${clusters.length} wallet cluster(s) detected</b>\n\n`;

      if (suspiciousCheck.severity === 'critical') {
        msg += `🚫 <b>RECOMMENDATION: AVOID</b>\n`;
        msg += `<i>High probability of pump & dump scheme</i>`;
      } else if (suspiciousCheck.severity === 'high') {
        msg += `⚠️ <b>RECOMMENDATION: EXTREME CAUTION</b>\n`;
        msg += `<i>Significant coordinated wallet activity detected</i>`;
      }

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('View Clusters', `view_clusters_${tokenMint.slice(0, 12)}`)],
        [Markup.button.url('View Chart', `https://dexscreener.com/solana/${tokenMint}`)],
      ]);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        msg,
        {
          parse_mode: 'HTML',
          ...keyboard,
        }
      );
    } catch (error) {
      console.error('Sybil command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `Error checking for Sybil attack. Please try again.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // View clusters callback
  bot.action(/^view_clusters_(.+)$/, async (ctx) => {
    const partialMint = ctx.match[1];
    
    await ctx.answerCbQuery('Loading clusters...');

    // Find full token mint (would need to track this properly)
    // For now, just show a message
    await ctx.answerCbQuery('Use /clusters [token] to see detailed cluster analysis');
  });
}

// Export formatters for alerts
export {
  formatCluster as formatClusterAlert,
  formatSybilAttack as formatSybilAttackAlert,
};
