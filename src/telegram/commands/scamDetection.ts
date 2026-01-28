/**
 * Scam Detection Commands
 * Advanced scam detection features based on Mugetsu bot capabilities
 */

import type { Context, Telegraf } from 'telegraf';
import { PublicKey } from '@solana/web3.js';
import { detectBundles } from '../../analysis/bundleDetector';
import { traceFunding, storeFundingTrace } from '../../analysis/fundingTracer';
import { getEarlyBuyers } from '../../analysis/earlyBuyers';
import { checkTwitterReuse } from '../../analysis/twitterReuse';
import { findCommonTraders } from '../../analysis/commonTraders';
import { checkImageReuse } from '../../analysis/imageCheck';
import { analyzeHolders } from '../../analysis/holderAnalysis';
import { truncateAddress } from '../formatters';
import { logger } from '../../utils/logger';
import { supabaseDb } from '../../database/supabase-db';

function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format bundle detection results for Telegram
 */
function formatBundleAnalysis(analysis: any): string {
  const {
    tokenMint,
    clusters,
    totalClusteredPercent,
    suspiciousClusters,
    overallRiskScore,
    warnings,
  } = analysis;

  let message = '<b>🚨 Bundle Detection Results</b>\n\n';
  message += `<b>Token:</b> <code>${truncateAddress(tokenMint, 8)}</code>\n`;
  message += `<b>Analyzed:</b> ${clusters.reduce((sum: number, c: any) => sum + c.wallets.length, 0)} wallets in ${clusters.length} cluster(s)\n\n`;

  // Overall status
  const riskEmoji = overallRiskScore >= 75 ? '🔴' : overallRiskScore >= 50 ? '🟡' : '🟢';
  const riskLabel = overallRiskScore >= 75 ? 'HIGH' : overallRiskScore >= 50 ? 'MEDIUM' : 'LOW';
  
  message += `<b>Overall Risk:</b> ${riskEmoji} ${riskLabel} (${overallRiskScore}/100)\n`;
  message += `<b>Suspicious Clusters:</b> ${suspiciousClusters}\n`;
  message += `<b>Total Clustered:</b> ${totalClusteredPercent.toFixed(1)}%\n\n`;

  // Warnings
  if (warnings.length > 0) {
    message += '<b>⚠️ WARNINGS</b>\n';
    warnings.forEach((w: string) => {
      message += `${w}\n`;
    });
    message += '\n';
  }

  // List suspicious clusters
  const suspiciousClustersData = clusters.filter((c: any) => c.isSuspicious);
  
  if (suspiciousClustersData.length > 0) {
    message += `<b>🔴 SUSPICIOUS BUNDLES FOUND: ${suspiciousClustersData.length}</b>\n\n`;

    suspiciousClustersData.forEach((cluster: any, i: number) => {
      const clusterRiskEmoji = cluster.riskScore >= 80 ? '🔴' : '🟡';
      
      message += `<b>Cluster #${i + 1}</b> (${clusterRiskEmoji} ${cluster.riskScore}/100)\n`;
      message += `├─ <b>Wallets:</b> ${cluster.wallets.length}\n`;
      message += `├─ <b>Total Holdings:</b> ${cluster.totalPercentage.toFixed(2)}%\n`;
      message += `├─ <b>Common Funder:</b> <code>${truncateAddress(cluster.commonFunder, 8)}</code>\n`;
      
      if (cluster.funderLabel) {
        message += `├─ <b>Funder:</b> ${cluster.funderLabel} ✅\n`;
      }

      if (cluster.creationTimeSpan > 0) {
        const minutes = Math.floor(cluster.creationTimeSpan / 60);
        const hours = Math.floor(minutes / 60);
        const timeStr = hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
        message += `├─ <b>Created within:</b> ${timeStr}\n`;
      }

      if (cluster.avgWalletAge > 0) {
        message += `├─ <b>Avg wallet age:</b> ${cluster.avgWalletAge.toFixed(1)}h\n`;
      }

      if (cluster.coordinatedBuys.length > 0) {
        const fastestBuy = cluster.coordinatedBuys.reduce((min: number, buy: any) => 
          buy.timeSpan < min ? buy.timeSpan : min, 
          Infinity
        );
        message += `└─ <b>Coordinated buys:</b> ${cluster.coordinatedBuys.length} event(s) (fastest: ${Math.floor(fastestBuy)}s)\n`;
      } else {
        message += `└─ <b>Coordinated buys:</b> None detected\n`;
      }

      message += '\n<b>Reasons:</b>\n';
      cluster.suspicionReasons.forEach((reason: string) => {
        message += `• ${reason}\n`;
      });
      message += '\n';
    });
  }

  // List legitimate clusters
  const legitimateClusters = clusters.filter((c: any) => !c.isSuspicious && c.funderLabel);
  
  if (legitimateClusters.length > 0) {
    message += `<b>✅ LEGITIMATE CLUSTERS: ${legitimateClusters.length}</b>\n\n`;

    legitimateClusters.forEach((cluster: any, i: number) => {
      message += `<b>Cluster #${i + 1}</b> (${cluster.funderLabel})\n`;
      message += `├─ <b>Wallets:</b> ${cluster.wallets.length}\n`;
      message += `└─ <b>Holdings:</b> ${cluster.totalPercentage.toFixed(2)}%\n\n`;
    });
  }

  // No clusters found
  if (clusters.length === 0) {
    message += '<b>✅ No wallet clusters detected</b>\n';
    message += 'All top holders appear to have unique funding sources.\n';
  }

  return message;
}

/**
 * Register scam detection commands
 */
export function registerScamDetectionCommands(bot: Telegraf): void {
  
  // ============================================================================
  // /bundle - Detect bundled wallet clusters (sybil attacks)
  // ============================================================================
  bot.command('bundle', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>🚨 Bundle Detection</b>\n\n` +
        `Detects coordinated wallet clusters (sybil attacks) by analyzing:\n` +
        `• Wallets funded from same source\n` +
        `• Wallet creation time clustering\n` +
        `• Coordinated buys within seconds\n` +
        `• Synchronized trading patterns\n\n` +
        `<b>Usage:</b> <code>/bundle [token_address]</code>\n\n` +
        `<b>Example:</b>\n` +
        `<code>/bundle DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263</code>`
      );
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address. Please check and try again.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(
      `🔍 <b>Analyzing wallet clusters...</b>\n\n` +
      `Token: <code>${truncateAddress(address, 8)}</code>\n\n` +
      `This may take 30-60 seconds...\n` +
      `• Fetching top holders\n` +
      `• Tracing wallet funding sources\n` +
      `• Analyzing creation times\n` +
      `• Detecting coordinated purchases`
    );

    try {
      // Step 1: Get holder data
      const holderData = await analyzeHolders(address);
      
      if (!holderData || !holderData.topHolders || holderData.topHolders.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `❌ Unable to fetch holder data for this token.\n\n` +
          `This could mean:\n` +
          `• Token has no holders yet\n` +
          `• Invalid token address\n` +
          `• RPC node is rate limiting`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Step 2: Run bundle detection
      const bundleAnalysis = await detectBundles(address, holderData.topHolders);

      // Step 3: Format and send results
      const formatted = formatBundleAnalysis(bundleAnalysis);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        formatted,
        { parse_mode: 'HTML' }
      );

      logger.info('ScamDetection', `Bundle check completed for ${address.slice(0, 8)}: ${bundleAnalysis.suspiciousClusters} suspicious clusters`);

      // Save results to Supabase
      for (const cluster of bundleAnalysis.clusters) {
        await supabaseDb.saveBundleFlag({
          tokenMint: address,
          clusterId: cluster.clusterId,
          wallets: cluster.wallets,
          commonFunder: cluster.commonFunder,
          funderLabel: cluster.funderLabel,
          walletCount: cluster.wallets.length,
          totalHoldings: cluster.totalHoldings,
          totalPercentage: cluster.totalPercentage,
          creationTimeSpan: cluster.creationTimeSpan,
          avgWalletAge: cluster.avgWalletAge,
          walletsCreatedWithin1h: cluster.walletsCreatedWithin1Hour,
          hasCoordinatedBuys: cluster.hasSynchronizedPurchases,
          coordinatedBuyCount: cluster.coordinatedBuys.length,
          fastestCoordinatedBuySeconds: cluster.coordinatedBuys.length > 0 
            ? Math.min(...cluster.coordinatedBuys.map((b: any) => b.timeSpan))
            : undefined,
          riskScore: cluster.riskScore,
          isSuspicious: cluster.isSuspicious,
          suspicionReasons: cluster.suspicionReasons,
        });
      }

    } catch (error) {
      logger.error('ScamDetection', `Bundle check failed for ${address}:`, error as Error);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ <b>Bundle check failed</b>\n\n` +
        `Error: ${(error as Error).message}\n\n` +
        `This could be due to:\n` +
        `• RPC rate limiting\n` +
        `• Network connectivity issues\n` +
        `• Invalid token data\n\n` +
        `Please try again in a few moments.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // ============================================================================
  // /funded - Trace wallet funding source
  // ============================================================================
  bot.command('funded', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>💰 Wallet Funding Trace</b>\n\n` +
        `Traces where a wallet got its initial SOL from:\n` +
        `• CEX withdrawal (legitimate)\n` +
        `• Unknown wallet (suspicious)\n` +
        `• Known dev/insider wallet (red flag)\n` +
        `• Fresh wallet detection (&lt;24h)\n\n` +
        `<b>Usage:</b> <code>/funded [wallet_address]</code>\n\n` +
        `<b>Example:</b>\n` +
        `<code>/funded 7xKjH3RqkDrWZ9dTgFJnVw8HvMhZQnHd9PqN5Xk8Ym3K</code>`
      );
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana wallet address. Please check and try again.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(
      `🔍 <b>Tracing wallet funding...</b>\n\n` +
      `Wallet: <code>${truncateAddress(address, 8)}</code>\n\n` +
      `This may take 10-30 seconds...\n` +
      `• Finding initial SOL transfer\n` +
      `• Identifying funder wallet\n` +
      `• Checking against known databases`
    );

    try {
      // Trace funding
      const trace = await traceFunding(address);

      // Store in database
      await storeFundingTrace(trace);

      // Format response
      const riskEmoji = trace.riskScore >= 75 ? '🔴' : trace.riskScore >= 50 ? '🟡' : '🟢';
      const riskLabel = trace.riskScore >= 75 ? 'HIGH' : trace.riskScore >= 50 ? 'MEDIUM' : 'LOW';

      let message = '<b>💰 Wallet Funding Trace</b>\n\n';
      message += `<b>Wallet:</b> <code>${truncateAddress(address, 8)}</code>\n`;
      message += `<b>Age:</b> ${trace.walletAge > 0 ? `${trace.walletAge.toFixed(1)}h` : 'Unknown'} `;
      
      if (trace.isFreshWallet) {
        message += '⏰ <i>(Fresh wallet)</i>';
      }
      message += '\n\n';

      message += `<b>🔍 Initial Funding:</b>\n`;
      message += `├─ <b>Source:</b> <code>${truncateAddress(trace.initialFunder, 8)}</code>\n`;
      
      let typeLabel = trace.funderType.toUpperCase();
      let typeEmoji = '';
      switch (trace.funderType) {
        case 'cex':
          typeEmoji = '✅';
          break;
        case 'faucet':
          typeEmoji = '🚰';
          break;
        case 'unknown':
          typeEmoji = '❓';
          break;
        case 'dev_wallet':
          typeEmoji = '🚨';
          break;
      }
      
      message += `├─ <b>Type:</b> ${typeEmoji} ${typeLabel}\n`;
      
      if (trace.funderLabel) {
        message += `├─ <b>Label:</b> ${trace.funderLabel}\n`;
      }
      
      if (trace.fundingAmount > 0) {
        message += `├─ <b>Amount:</b> ${trace.fundingAmount.toFixed(4)} SOL\n`;
      }
      
      if (trace.fundingTimestamp) {
        const dateStr = trace.fundingTimestamp.toISOString().split('T')[0];
        const timeStr = trace.fundingTimestamp.toISOString().split('T')[1].slice(0, 5);
        message += `└─ <b>Time:</b> ${dateStr} ${timeStr} UTC\n`;
      } else {
        message += `└─ <b>Time:</b> Unknown\n`;
      }

      message += '\n';

      // Warnings
      if (trace.warnings.length > 0) {
        message += `<b>⚠️ WARNINGS:</b>\n`;
        trace.warnings.forEach(warning => {
          message += `• ${warning}\n`;
        });
        message += '\n';
      }

      // Risk score
      message += `<b>Risk Score:</b> ${riskEmoji} ${riskLabel} (${trace.riskScore}/100)\n`;

      if (trace.riskScore >= 75) {
        message += '\n🚨 <b>HIGH RISK</b> - Exercise extreme caution';
      } else if (trace.riskScore < 20) {
        message += '\n✅ <b>Low Risk</b> - Wallet appears legitimate';
      }

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        message,
        { parse_mode: 'HTML' }
      );

      logger.info('ScamDetection', `Funding trace completed for ${address.slice(0, 8)}: ${trace.funderType} (risk=${trace.riskScore})`);

    } catch (error) {
      logger.error('ScamDetection', `Funding trace failed for ${address}:`, error as Error);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ <b>Funding trace failed</b>\n\n` +
        `Error: ${(error as Error).message}\n\n` +
        `This could be due to:\n` +
        `• RPC rate limiting\n` +
        `• Network connectivity issues\n` +
        `• Wallet has no transaction history\n\n` +
        `Please try again in a few moments.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // ============================================================================
  // /early_wallets - Show early pump.fun buyers (insider detection)
  // ============================================================================
  bot.command('early_wallets', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>🏁 Early Buyers Analysis</b>\n\n` +
        `For pump.fun tokens, identifies wallets that bought in the first transactions:\n` +
        `• First 5-20 buyers\n` +
        `• Current holdings vs. initial buy\n` +
        `• Insider detection (first 5 buyers)\n` +
        `• Exit tracking (who already sold)\n\n` +
        `<b>Usage:</b> <code>/early_wallets [token_address]</code>\n\n` +
        `<b>Example:</b>\n` +
        `<code>/early_wallets DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263</code>`
      );
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address. Please check and try again.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(
      `🔍 <b>Analyzing early buyers...</b>\n\n` +
      `Token: <code>${truncateAddress(address, 8)}</code>\n\n` +
      `This may take 30-60 seconds...\n` +
      `• Fetching first transactions\n` +
      `• Identifying early buyers\n` +
      `• Checking current holdings`
    );

    try {
      // Get early buyers analysis
      const analysis = await getEarlyBuyers(address, 20);

      if (analysis.earlyBuyers.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `❌ Unable to fetch early buyer data for this token.\n\n` +
          `This could mean:\n` +
          `• Token is too new (no transactions yet)\n` +
          `• Not a pump.fun token\n` +
          `• RPC node is rate limiting`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Format response
      let message = '<b>🏁 Early Buyers Analysis</b>\n\n';
      message += `<b>Token:</b> <code>${truncateAddress(address, 8)}</code>\n`;
      message += `<b>Early Buyers Found:</b> ${analysis.earlyBuyers.length}\n`;
      message += `<b>Insiders:</b> ${analysis.insiderCount} (first 5 buyers)\n`;
      message += `<b>Exited Insiders:</b> ${analysis.exitedInsiders}/${analysis.insiderCount}\n\n`;

      // Warnings
      if (analysis.warnings.length > 0) {
        analysis.warnings.forEach(warning => {
          message += `${warning}\n`;
        });
        message += '\n';
      }

      // Top early buyers
      const topBuyers = analysis.earlyBuyers.slice(0, 10);
      message += `<b>Top ${topBuyers.length} Early Buyers:</b>\n\n`;

      topBuyers.forEach(buyer => {
        const insiderLabel = buyer.isInsider ? '🚨 INSIDER' : '';
        const exitLabel = buyer.hasExited ? '❌ EXITED' : '✅ HOLDING';
        
        message += `<b>#${buyer.buyRank}</b> - <code>${truncateAddress(buyer.wallet, 6)}</code> ${insiderLabel}\n`;
        message += `├─ <b>Bought:</b> ${buyer.buyTimestamp.toISOString().split('T')[1].slice(0, 8)}\n`;
        message += `├─ <b>Amount:</b> ${buyer.buyAmount.toFixed(2)} tokens\n`;
        message += `├─ <b>Status:</b> ${exitLabel} (${(100 - buyer.percentSold).toFixed(0)}% remaining)\n`;
        
        if (buyer.hasExited && buyer.isInsider) {
          message += `└─ <b>⚠️ DUMPED</b> - Insider exited position\n`;
        } else if (!buyer.hasExited && buyer.isInsider) {
          message += `└─ <b>Still holding ${(100 - buyer.percentSold).toFixed(0)}%</b>\n`;
        } else {
          message += `└─ <b>Holdings:</b> ${buyer.currentHoldings.toFixed(2)} tokens\n`;
        }
        
        message += '\n';
      });

      // Summary
      if (analysis.exitedInsiders >= 3) {
        message += '\n🚨 <b>WARNING:</b> Multiple insiders already exited\n';
        message += 'High risk of insider dump - exercise caution\n';
      } else if (analysis.exitedInsiders === 0 && analysis.insiderCount >= 3) {
        message += '\n✅ <b>POSITIVE:</b> All early insiders still holding\n';
        message += 'Shows confidence in the token\n';
      }

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        message,
        { parse_mode: 'HTML' }
      );

      logger.info('ScamDetection', `Early wallets check completed for ${address.slice(0, 8)}: ${analysis.insiderCount} insiders, ${analysis.exitedInsiders} exited`);

      // Save suspicious insiders to known_dev_wallets table
      const suspiciousInsiders = analysis.earlyBuyers.filter(b => b.isInsider && b.hasExited);
      for (const insider of suspiciousInsiders) {
        await supabaseDb.saveKnownDevWallet({
          walletAddress: insider.wallet,
          classification: 'insider',
          reputationScore: 30, // Low score for insiders who dumped
          associatedTokens: [address],
          ruggedTokenCount: 0,
          successfulTokenCount: 0,
          evidenceNotes: `Bought in first 5 transactions and exited (${insider.percentSold.toFixed(0)}% sold)`,
          source: 'early_wallets_detection',
        });
      }

      if (suspiciousInsiders.length > 0) {
        logger.info('ScamDetection', `Flagged ${suspiciousInsiders.length} suspicious insiders in known_dev_wallets`);
      }

    } catch (error) {
      logger.error('ScamDetection', `Early wallets check failed for ${address}:`, error as Error);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ <b>Early wallets check failed</b>\n\n` +
        `Error: ${(error as Error).message}\n\n` +
        `This could be due to:\n` +
        `• RPC rate limiting\n` +
        `• Network connectivity issues\n` +
        `• Invalid token data\n\n` +
        `Please try again in a few moments.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // ============================================================================
  // /twitter_reuse - Check for recycled Twitter accounts
  // ============================================================================
  bot.command('twitter_reuse', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>🐦 Twitter Account Check</b>\n\n` +
        `Checks if a Twitter handle was previously used by rugged tokens:\n` +
        `• Account age verification\n` +
        `• Previous token associations\n` +
        `• Rug detection history\n\n` +
        `<b>Usage:</b> <code>/twitter_reuse [twitter_handle]</code>\n\n` +
        `<b>Example:</b>\n` +
        `<code>/twitter_reuse meme_coin_2024</code>\n` +
        `<code>/twitter_reuse @meme_coin_2024</code>`
      );
      return;
    }

    const handle = args[0];
    const loadingMsg = await ctx.replyWithHTML(`🔍 <b>Checking Twitter account...</b>\n\nHandle: @${handle}`);

    try {
      const check = await checkTwitterReuse(handle);
      const riskEmoji = check.riskScore >= 75 ? '🔴' : check.riskScore >= 50 ? '🟡' : '🟢';
      const riskLabel = check.riskScore >= 75 ? 'HIGH' : check.riskScore >= 50 ? 'MEDIUM' : 'LOW';

      let message = '<b>🐦 Twitter Account Check</b>\n\n';
      message += `<b>Handle:</b> @${check.handle}\n`;
      
      if (check.accountAgeDays > 0) {
        message += `<b>Account Age:</b> ${check.accountAgeDays} days `;
        if (check.accountAgeDays < 30) message += '⏰';
        message += '\n';
      }

      if (check.accountCreated) {
        message += `<b>Created:</b> ${check.accountCreated.toISOString().split('T')[0]}\n`;
      }

      message += '\n';

      if (check.warnings.length > 0) {
        message += '<b>FINDINGS:</b>\n';
        check.warnings.forEach(w => message += `${w}\n`);
        message += '\n';
      }

      message += `<b>Risk Score:</b> ${riskEmoji} ${riskLabel} (${check.riskScore}/100)\n`;

      if (check.linkedToRugs && check.ruggedTokens.length > 0) {
        message += '\n🚨 <b>DANGER:</b> Handle linked to rugged tokens - avoid this project';
      }

      await ctx.telegram.editMessageText(ctx.chat!.id, loadingMsg.message_id, undefined, message, { parse_mode: 'HTML' });
      logger.info('ScamDetection', `Twitter check completed for @${handle}: risk=${check.riskScore}`);
    } catch (error) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id, loadingMsg.message_id, undefined,
        `❌ <b>Twitter check failed</b>\n\nError: ${(error as Error).message}`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // ============================================================================
  // /common_traders - Find wallet overlap between tokens
  // ============================================================================
  bot.command('common_traders', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length < 2) {
      await ctx.replyWithHTML(
        `<b>🔗 Common Top Traders</b>\n\n` +
        `Finds wallets appearing as top holders in multiple tokens:\n` +
        `• Wallet overlap analysis\n` +
        `• Pump group detection\n` +
        `• Coordinated trading patterns\n\n` +
        `<b>Usage:</b> <code>/common_traders [token1] [token2]</code>\n\n` +
        `<b>Example:</b>\n` +
        `<code>/common_traders DezXA...B263 9WzDX...AW</code>`
      );
      return;
    }

    const token1 = args[0];
    const token2 = args[1];

    if (!isValidSolanaAddress(token1) || !isValidSolanaAddress(token2)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address(es). Please check and try again.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(
      `🔍 <b>Analyzing common traders...</b>\n\n` +
      `Token 1: <code>${truncateAddress(token1, 8)}</code>\n` +
      `Token 2: <code>${truncateAddress(token2, 8)}</code>\n\n` +
      `This may take 30-60 seconds...`
    );

    try {
      const analysis = await findCommonTraders(token1, token2);

      let message = '<b>🔗 Common Top Traders</b>\n\n';
      message += `<b>Token 1:</b> <code>${truncateAddress(token1, 8)}</code>\n`;
      message += `<b>Token 2:</b> <code>${truncateAddress(token2, 8)}</code>\n\n`;
      message += `<b>Common Holders:</b> ${analysis.commonTraders.length} (${analysis.overlapPercent.toFixed(1)}% overlap)\n\n`;

      if (analysis.warnings.length > 0) {
        analysis.warnings.forEach(w => message += `${w}\n`);
        message += '\n';
      }

      if (analysis.commonTraders.length > 0) {
        const top5 = analysis.commonTraders.slice(0, 5);
        message += `<b>Top ${top5.length} Common Traders:</b>\n\n`;

        top5.forEach((trader, i) => {
          const whaleLabel = trader.isWhale ? '🐋' : '';
          message += `<b>#${i + 1}</b> - <code>${truncateAddress(trader.wallet, 6)}</code> ${whaleLabel}\n`;
          message += `├─ <b>Token 1:</b> ${trader.percentageInToken1.toFixed(2)}% (rank #${trader.rankInToken1})\n`;
          message += `└─ <b>Token 2:</b> ${trader.percentageInToken2.toFixed(2)}% (rank #${trader.rankInToken2})\n\n`;
        });
      }

      if (analysis.isPumpGroup) {
        message += '\n🚨 <b>WARNING:</b> High overlap suggests coordinated trading group';
      }

      await ctx.telegram.editMessageText(ctx.chat!.id, loadingMsg.message_id, undefined, message, { parse_mode: 'HTML' });
      logger.info('ScamDetection', `Common traders check completed: ${analysis.overlapPercent.toFixed(1)}% overlap`);
    } catch (error) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id, loadingMsg.message_id, undefined,
        `❌ <b>Common traders check failed</b>\n\nError: ${(error as Error).message}`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // ============================================================================
  // /image_check - Reverse image search for logo reuse
  // ============================================================================
  bot.command('image_check', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length < 2) {
      await ctx.replyWithHTML(
        `<b>🖼️ Image Reuse Check</b>\n\n` +
        `Checks if a token's logo has been used before:\n` +
        `• Image hash comparison\n` +
        `• Duplicate detection\n` +
        `• Rugged token associations\n\n` +
        `<b>Usage:</b> <code>/image_check [token_mint] [image_url]</code>\n\n` +
        `<b>Example:</b>\n` +
        `<code>/image_check DezXA...B263 https://example.com/logo.png</code>`
      );
      return;
    }

    const tokenMint = args[0];
    const imageUrl = args.slice(1).join(' ');

    if (!isValidSolanaAddress(tokenMint)) {
      await ctx.replyWithHTML(`❌ Invalid token address. Please check and try again.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(
      `🔍 <b>Checking image...</b>\n\n` +
      `Token: <code>${truncateAddress(tokenMint, 8)}</code>\n` +
      `Image: ${imageUrl.substring(0, 50)}...`
    );

    try {
      const check = await checkImageReuse(tokenMint, imageUrl);
      const riskEmoji = check.riskScore >= 75 ? '🔴' : check.riskScore >= 50 ? '🟡' : '🟢';
      const riskLabel = check.riskScore >= 75 ? 'HIGH' : check.riskScore >= 50 ? 'MEDIUM' : 'LOW';

      let message = '<b>🖼️ Image Reuse Check</b>\n\n';
      message += `<b>Token:</b> <code>${truncateAddress(tokenMint, 8)}</code>\n`;
      message += `<b>Image Hash:</b> <code>${check.imageHash.substring(0, 16)}...</code>\n`;
      message += `<b>Matches Found:</b> ${check.matches.length}\n\n`;

      if (check.warnings.length > 0) {
        check.warnings.forEach(w => message += `${w}\n`);
        message += '\n';
      }

      message += `<b>Risk Score:</b> ${riskEmoji} ${riskLabel} (${check.riskScore}/100)\n`;

      if (check.matches.length > 0 && check.matches.some(m => m.wasRugged)) {
        message += '\n🚨 <b>CRITICAL:</b> Image used by rugged tokens - likely scam';
      } else if (check.isUnique) {
        message += '\n✅ <b>Image appears unique</b>';
      }

      await ctx.telegram.editMessageText(ctx.chat!.id, loadingMsg.message_id, undefined, message, { parse_mode: 'HTML' });
      logger.info('ScamDetection', `Image check completed for ${tokenMint.slice(0, 8)}: ${check.matches.length} matches`);
    } catch (error) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id, loadingMsg.message_id, undefined,
        `❌ <b>Image check failed</b>\n\nError: ${(error as Error).message}`,
        { parse_mode: 'HTML' }
      );
    }
  });

  logger.info('ScamDetection', 'All scam detection commands registered: /bundle, /funded, /early_wallets, /twitter_reuse, /common_traders, /image_check');
}
