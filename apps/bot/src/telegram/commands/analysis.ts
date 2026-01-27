import type { Context, Telegraf } from 'telegraf';
import { PublicKey } from '@solana/web3.js';
import { analyzeToken } from '../../analysis/tokenAnalyzer';
import { dexScreenerService } from '../../services/dexscreener';
import { solanaService } from '../../services/solana';
import { rugCheckService } from '../../services/rugcheck';
import { formatFullAnalysis, formatDexScreenerAnalysis, formatNumber, truncateAddress, formatPatternAnalysis, formatTrackedSmartMoneyActivity } from '../formatters';
import { tokenActionKeyboard, compareKeyboard } from '../keyboards';
import type { TokenAnalysis } from '../../types';
import { classifyRisk, getRiskEmoji, getRiskDescription } from '../../risk/classifier';
import { analyzeHolders } from '../../analysis/holderAnalysis';
import { analyzeContract } from '../../analysis/contractCheck';
import { analyzeLiquidity } from '../../analysis/liquidityCheck';
import { analyzeSocials } from '../../analysis/socialCheck';
import { patternDetector, type TokenData } from '../../services/patternDetector';
import { smartMoneyLearner } from '../../services/smartMoneyLearner';

function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export function registerAnalysisCommands(bot: Telegraf): void {
  // /check command - Full analysis
  bot.command('check', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Token Analysis</b>\n\n` +
        `Usage: <code>/check [token_address]</code>\n\n` +
        `Example: <code>/check DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263</code>`
      );
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address. Please check and try again.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`🔍 Analyzing token...\n<code>${truncateAddress(address, 8)}</code>`);

    try {
      // First get DexScreener data (no rate limits)
      const dexData = await dexScreenerService.getTokenData(address);

      if (!dexData) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `❌ Token not found on DexScreener. It may not have any liquidity pools.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Try to get full analysis (may fail due to RPC rate limits)
      let analysis: TokenAnalysis | null = null;
      try {
        analysis = await analyzeToken(address, {
          address: '',
          tokenMint: address,
          baseMint: address,
          quoteMint: '',
          baseReserve: 0,
          quoteReserve: 0,
          lpMint: '',
          source: 'jupiter',
          createdAt: new Date(),
        });
      } catch {
        console.log('Full analysis failed (RPC rate limit?), using DexScreener data only');
      }

      // If full analysis worked, use it
      if (analysis) {
        const formatted = formatFullAnalysis(analysis, dexData);
        
        // Add pattern analysis
        let finalMessage = formatted;
        try {
          const tokenData: TokenData = {
            mint: address,
            symbol: analysis.token.symbol,
            liquidityUsd: analysis.liquidity.totalLiquidityUsd,
            lpBurnedPercent: analysis.liquidity.lpBurnedPercent,
            lpLockedPercent: analysis.liquidity.lpLockedPercent,
            totalHolders: analysis.holders.totalHolders,
            top10Percent: analysis.holders.top10HoldersPercent,
            top20Percent: analysis.holders.top20HoldersPercent,
            largestHolderPercent: analysis.holders.largestHolderPercent,
            whaleCount: analysis.holders.whaleCount,
            mintRevoked: analysis.contract.mintAuthorityRevoked,
            freezeRevoked: analysis.contract.freezeAuthorityRevoked,
            isHoneypot: analysis.contract.isHoneypot,
            hasTransferFee: analysis.contract.hasTransferFee,
            transferFeePercent: analysis.contract.transferFeePercent,
            hasTwitter: analysis.social.hasTwitter,
            hasTelegram: analysis.social.hasTelegram,
            hasWebsite: analysis.social.hasWebsite,
            twitterFollowers: analysis.social.twitterFollowers,
            telegramMembers: analysis.social.telegramMembers,
            priceChange1h: dexData.priceChange?.h1,
            priceChange24h: dexData.priceChange?.h24,
            volume24h: dexData.volume?.h24,
            marketCap: dexData.marketCap,
          };

          const matches = await patternDetector.getTopMatches(tokenData, 3);
          const prediction = await patternDetector.predictOutcome(tokenData);
          const similarTokens = await patternDetector.getSimilarSuccessfulTokens(tokenData, 2);

          const patternSection = formatPatternAnalysis(matches, prediction, similarTokens);
          finalMessage = formatted + patternSection;
        } catch (patternError) {
          console.log('Pattern analysis failed:', patternError);
          // Continue without pattern analysis
        }

        // Add tracked smart money activity
        try {
          const smActivity = await smartMoneyLearner.getTokenSmartMoneyActivity(address);
          const smSection = formatTrackedSmartMoneyActivity(smActivity);
          if (smSection) {
            finalMessage += '\n\n' + smSection;
          }
        } catch (smError) {
          console.log('Smart money activity check failed:', smError);
          // Continue without smart money section
        }
        
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          finalMessage,
          { parse_mode: 'HTML', ...tokenActionKeyboard(address) }
        );
      } else {
        // Fallback to DexScreener-only analysis
        const formatted = formatDexScreenerAnalysis(dexData);
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          formatted,
          { parse_mode: 'HTML', ...tokenActionKeyboard(address) }
        );
      }
    } catch (error) {
      console.error('Check command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error analyzing token. Please try again later.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /scan command - Quick safety scan
  bot.command('scan', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(`Usage: <code>/scan [token_address]</code>`);
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`🔍 Quick scan...`);

    try {
      const [dexData, mintInfo] = await Promise.all([
        dexScreenerService.getTokenData(address),
        solanaService.getMintInfo(address),
      ]);

      const mintRevoked = mintInfo ? mintInfo.mintAuthority === null : false;
      const freezeRevoked = mintInfo ? mintInfo.freezeAuthority === null : false;
      const liquidity = dexData?.liquidity?.usd || 0;

      const safetyScore =
        (mintRevoked ? 30 : 0) +
        (freezeRevoked ? 20 : 0) +
        (liquidity > 10000 ? 30 : liquidity > 1000 ? 15 : 0) +
        (dexData?.txns?.h24?.buys ? 20 : 0);

      const emoji = safetyScore >= 70 ? '🟢' : safetyScore >= 40 ? '🟡' : '🔴';

      const message = [
        `${emoji} <b>QUICK SCAN</b>`,
        ``,
        dexData ? `<b>${dexData.baseToken.name}</b> ($${dexData.baseToken.symbol})` : `Token: ${truncateAddress(address, 6)}`,
        ``,
        `<b>Safety Score:</b> ${safetyScore}/100`,
        ``,
        `${mintRevoked ? '✅' : '❌'} Mint Authority ${mintRevoked ? 'Revoked' : 'Active'}`,
        `${freezeRevoked ? '✅' : '❌'} Freeze Authority ${freezeRevoked ? 'Revoked' : 'Active'}`,
        `${liquidity > 1000 ? '✅' : '⚠️'} Liquidity: $${formatNumber(liquidity)}`,
        dexData?.txns?.h24 ? `📊 24h Txns: ${dexData.txns.h24.buys + dexData.txns.h24.sells}` : null,
        ``,
        `Use <code>/check ${truncateAddress(address, 6)}</code> for full analysis.`,
      ].filter(l => l !== null).join('\n');

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        message,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Scan command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error scanning token.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /holders command
  bot.command('holders', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(`Usage: <code>/holders [token_address]</code>`);
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`🔍 Fetching holder data...`);

    try {
      const [holders, tokenInfo] = await Promise.all([
        solanaService.getTokenHolders(address, 10),
        solanaService.getTokenInfo(address),
      ]);

      if (holders.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `❌ No holders found for this token.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      const totalSupply = tokenInfo?.supply || 0;

      const lines = [
        `👥 <b>TOP HOLDERS</b>`,
        tokenInfo ? `\n<b>${tokenInfo.name}</b> ($${tokenInfo.symbol})` : '',
        ``,
        `<b>Top 10 Holders:</b>`,
      ];

      holders.forEach((holder, i) => {
        const percent = totalSupply > 0 ? ((holder.balance / totalSupply) * 100).toFixed(2) : '?';
        const whale = parseFloat(percent) > 5 ? '🐋' : '';
        lines.push(`${i + 1}. ${truncateAddress(holder.address, 4)} - ${percent}% ${whale}`);
      });

      const top10Total = holders.reduce((sum, h) => sum + h.balance, 0);
      const top10Percent = totalSupply > 0 ? ((top10Total / totalSupply) * 100).toFixed(1) : '?';

      lines.push(``);
      lines.push(`<b>Top 10 Concentration:</b> ${top10Percent}%`);
      lines.push(`<b>Total Holders:</b> ${holders.length}+`);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        lines.join('\n'),
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Holders command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error fetching holder data.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /lp command
  bot.command('lp', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(`Usage: <code>/lp [token_address]</code>`);
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`🔍 Fetching LP data...`);

    try {
      const dexData = await dexScreenerService.getTokenData(address);

      if (!dexData) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `❌ No liquidity pool found for this token.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      const message = [
        `💧 <b>LIQUIDITY POOL INFO</b>`,
        ``,
        `<b>${dexData.baseToken.name}</b> ($${dexData.baseToken.symbol})`,
        ``,
        `<b>DEX:</b> ${dexData.dexId}`,
        `<b>Pair:</b> ${dexData.baseToken.symbol}/${dexData.quoteToken.symbol}`,
        ``,
        `<b>Liquidity:</b> $${formatNumber(dexData.liquidity?.usd || 0)}`,
        `<b>Base Reserve:</b> ${formatNumber(dexData.liquidity?.base || 0)} ${dexData.baseToken.symbol}`,
        `<b>Quote Reserve:</b> ${formatNumber(dexData.liquidity?.quote || 0)} ${dexData.quoteToken.symbol}`,
        ``,
        `<b>Price:</b> $${dexData.priceUsd || 'N/A'}`,
        `<b>FDV:</b> $${dexData.fdv ? formatNumber(dexData.fdv) : 'N/A'}`,
        dexData.pairCreatedAt ? `<b>Created:</b> ${new Date(dexData.pairCreatedAt).toLocaleDateString()}` : null,
        ``,
        `🔗 <a href="${dexData.url}">View on DexScreener</a>`,
      ].filter(l => l !== null).join('\n');

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        message,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
      );
    } catch (error) {
      console.error('LP command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error fetching LP data.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /socials command
  bot.command('socials', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(`Usage: <code>/socials [token_address]</code>`);
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    try {
      const [dexData, tokenInfo] = await Promise.all([
        dexScreenerService.getTokenData(address),
        solanaService.getTokenInfo(address),
      ]);

      const socials = dexData?.info?.socials || [];
      const websites = dexData?.info?.websites || [];
      const metadata = tokenInfo?.metadata;

      const lines = [
        `🔗 <b>SOCIAL LINKS</b>`,
        ``,
        dexData ? `<b>${dexData.baseToken.name}</b> ($${dexData.baseToken.symbol})` : `Token: ${truncateAddress(address, 6)}`,
        ``,
      ];

      let hasLinks = false;

      // From DexScreener
      socials.forEach(s => {
        if (s.type === 'twitter') {
          lines.push(`🐦 Twitter: ${s.url}`);
          hasLinks = true;
        } else if (s.type === 'telegram') {
          lines.push(`💬 Telegram: ${s.url}`);
          hasLinks = true;
        }
      });

      websites.forEach(w => {
        lines.push(`🌐 Website: ${w.url}`);
        hasLinks = true;
      });

      // From metadata
      if (metadata?.twitter && !socials.find(s => s.type === 'twitter')) {
        lines.push(`🐦 Twitter: ${metadata.twitter}`);
        hasLinks = true;
      }
      if (metadata?.telegram && !socials.find(s => s.type === 'telegram')) {
        lines.push(`💬 Telegram: ${metadata.telegram}`);
        hasLinks = true;
      }
      if (metadata?.website && websites.length === 0) {
        lines.push(`🌐 Website: ${metadata.website}`);
        hasLinks = true;
      }

      if (!hasLinks) {
        lines.push(`No social links found.`);
      }

      await ctx.replyWithHTML(lines.join('\n'), { link_preview_options: { is_disabled: true } });
    } catch (error) {
      console.error('Socials command error:', error);
      await ctx.replyWithHTML(`❌ Error fetching social links.`);
    }
  });

  // /compare command
  bot.command('compare', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length < 2) {
      await ctx.replyWithHTML(
        `<b>Compare Tokens</b>\n\n` +
        `Usage: <code>/compare [address1] [address2]</code>`
      );
      return;
    }

    const [addr1, addr2] = args;

    if (!isValidSolanaAddress(addr1) || !isValidSolanaAddress(addr2)) {
      await ctx.replyWithHTML(`❌ Invalid address(es). Please check and try again.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`🔍 Comparing tokens...`);

    try {
      const [dex1, dex2] = await Promise.all([
        dexScreenerService.getTokenData(addr1),
        dexScreenerService.getTokenData(addr2),
      ]);

      const formatRow = (label: string, v1: string, v2: string) =>
        `<b>${label}</b>\n${v1} vs ${v2}`;

      const lines = [
        `⚖️ <b>TOKEN COMPARISON</b>`,
        ``,
        `<b>Token 1:</b> ${dex1?.baseToken.symbol || truncateAddress(addr1, 4)}`,
        `<b>Token 2:</b> ${dex2?.baseToken.symbol || truncateAddress(addr2, 4)}`,
        ``,
        formatRow('Price',
          dex1?.priceUsd ? `$${dex1.priceUsd}` : 'N/A',
          dex2?.priceUsd ? `$${dex2.priceUsd}` : 'N/A'
        ),
        ``,
        formatRow('Liquidity',
          dex1?.liquidity?.usd ? `$${formatNumber(dex1.liquidity.usd)}` : 'N/A',
          dex2?.liquidity?.usd ? `$${formatNumber(dex2.liquidity.usd)}` : 'N/A'
        ),
        ``,
        formatRow('24h Volume',
          dex1?.volume?.h24 ? `$${formatNumber(dex1.volume.h24)}` : 'N/A',
          dex2?.volume?.h24 ? `$${formatNumber(dex2.volume.h24)}` : 'N/A'
        ),
        ``,
        formatRow('24h Change',
          dex1?.priceChange?.h24 ? `${dex1.priceChange.h24.toFixed(1)}%` : 'N/A',
          dex2?.priceChange?.h24 ? `${dex2.priceChange.h24.toFixed(1)}%` : 'N/A'
        ),
        ``,
        formatRow('Market Cap',
          dex1?.marketCap ? `$${formatNumber(dex1.marketCap)}` : 'N/A',
          dex2?.marketCap ? `$${formatNumber(dex2.marketCap)}` : 'N/A'
        ),
      ];

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        lines.join('\n'),
        { parse_mode: 'HTML', ...compareKeyboard(addr1, addr2) }
      );
    } catch (error) {
      console.error('Compare command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error comparing tokens.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /rug command - Detailed RugCheck report
  bot.command('rug', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>RugCheck Report</b>\n\n` +
        `Usage: <code>/rug [token_address]</code>\n\n` +
        `Get detailed rug risk analysis from RugCheck.xyz`
      );
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`🔍 Fetching RugCheck report...`);

    try {
      const [rugReport, tokenInfo] = await Promise.all([
        rugCheckService.getTokenReport(address),
        solanaService.getTokenInfo(address),
      ]);

      if (!rugReport) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `⚠️ No RugCheck data available for this token.\n\nThis could mean:\n• Token is too new\n• Not indexed by RugCheck yet\n• Address is incorrect`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      const scoreEmoji = rugReport.score >= 70 ? '🟢' : rugReport.score >= 40 ? '🟡' : '🔴';

      const lines = [
        `${scoreEmoji} <b>RUGCHECK REPORT</b>`,
        ``,
        tokenInfo ? `<b>${tokenInfo.name}</b> ($${tokenInfo.symbol})` : `Token: ${truncateAddress(address, 6)}`,
        ``,
        `<b>RugCheck Score:</b> ${rugReport.score}/100`,
        rugReport.verified ? `✅ <b>Verified Token</b>` : `⚠️ <b>Not Verified</b>`,
        ``,
      ];

      if (rugReport.risks.length > 0) {
        lines.push(`<b>Risks Detected:</b>`);
        rugReport.risks.forEach(risk => {
          const icon = risk.level === 'danger' ? '🔴' : risk.level === 'warning' ? '🟡' : '🔵';
          lines.push(`${icon} <b>${risk.name}</b>`);
          if (risk.description) {
            lines.push(`   └ ${risk.description}`);
          }
        });
      } else {
        lines.push(`✅ No significant risks detected`);
      }

      lines.push(``);
      lines.push(`🔗 <a href="https://rugcheck.xyz/tokens/${address}">View Full Report</a>`);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        lines.join('\n'),
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
      );
    } catch (error) {
      console.error('Rug command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error fetching RugCheck report.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /whales command - Track whale wallets
  bot.command('whales', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Whale Tracker</b>\n\n` +
        `Usage: <code>/whales [token_address]</code>\n\n` +
        `Find wallets holding >5% of supply`
      );
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`🐋 Scanning for whales...`);

    try {
      const [holders, tokenInfo] = await Promise.all([
        solanaService.getTokenHolders(address, 20),
        solanaService.getTokenInfo(address),
      ]);

      if (holders.length === 0 || !tokenInfo) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `❌ Could not fetch holder data.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      const totalSupply = tokenInfo.supply;
      const whales = holders.filter(h => (h.balance / totalSupply) * 100 >= 5);
      const top10Total = holders.slice(0, 10).reduce((sum, h) => sum + h.balance, 0);
      const top10Percent = (top10Total / totalSupply) * 100;

      const lines = [
        `🐋 <b>WHALE ANALYSIS</b>`,
        ``,
        `<b>${tokenInfo.name}</b> ($${tokenInfo.symbol})`,
        ``,
        `<b>Top 10 Concentration:</b> ${top10Percent.toFixed(1)}%`,
        `<b>Whales (>5%):</b> ${whales.length}`,
        ``,
      ];

      if (whales.length > 0) {
        lines.push(`<b>Whale Wallets:</b>`);
        whales.forEach((whale, i) => {
          const percent = ((whale.balance / totalSupply) * 100).toFixed(2);
          const balanceFormatted = formatNumber(whale.balance);
          lines.push(`${i + 1}. 🐋 <code>${truncateAddress(whale.address, 6)}</code>`);
          lines.push(`   └ ${percent}% (${balanceFormatted} tokens)`);
        });
      } else {
        lines.push(`✅ No whale wallets detected (all holders <5%)`);
      }

      // Risk assessment
      lines.push(``);
      if (top10Percent > 80) {
        lines.push(`⚠️ <b>HIGH RISK:</b> Extreme concentration`);
      } else if (top10Percent > 60) {
        lines.push(`⚠️ <b>MODERATE RISK:</b> High concentration`);
      } else if (top10Percent > 40) {
        lines.push(`🟡 <b>CAUTION:</b> Some concentration`);
      } else {
        lines.push(`✅ <b>GOOD:</b> Well distributed`);
      }

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        lines.join('\n'),
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Whales command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error analyzing whale data.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /risk command - Detailed risk breakdown
  bot.command('risk', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Risk Analysis</b>\n\n` +
        `Usage: <code>/risk [token_address]</code>\n\n` +
        `Get detailed risk factor breakdown`
      );
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`🔍 Analyzing risk factors...`);

    try {
      const tokenInfo = await solanaService.getTokenInfo(address);

      if (!tokenInfo) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `❌ Could not fetch token info.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Run all analyses in parallel
      const pool = {
        address: '',
        tokenMint: address,
        baseMint: address,
        quoteMint: '',
        baseReserve: 0,
        quoteReserve: 0,
        lpMint: '',
        source: 'jupiter' as const,
        createdAt: new Date(),
      };

      const [liquidity, holders, contract, social] = await Promise.all([
        analyzeLiquidity(pool),
        analyzeHolders(tokenInfo),
        analyzeContract(address),
        analyzeSocials(tokenInfo.metadata),
      ]);

      const risk = classifyRisk({ liquidity, holders, contract, social });

      const lines = [
        `${getRiskEmoji(risk.level)} <b>RISK ANALYSIS</b>`,
        ``,
        `<b>${tokenInfo.name}</b> ($${tokenInfo.symbol})`,
        ``,
        `<b>Overall Score:</b> ${risk.score}/100 (${risk.level})`,
        `<i>${getRiskDescription(risk.level)}</i>`,
        ``,
        `<b>Risk Factors:</b>`,
      ];

      // Group factors by passed/failed
      const passedFactors = risk.factors.filter(f => f.passed);
      const failedFactors = risk.factors.filter(f => !f.passed);

      if (failedFactors.length > 0) {
        lines.push(`\n<b>❌ Issues Found:</b>`);
        failedFactors.forEach(factor => {
          lines.push(`• <b>${factor.name}</b> (-${factor.impact}pts)`);
          lines.push(`  └ ${factor.description}`);
        });
      }

      if (passedFactors.length > 0) {
        lines.push(`\n<b>✅ Passed Checks:</b>`);
        passedFactors.forEach(factor => {
          lines.push(`• <b>${factor.name}</b> (+${factor.impact}pts)`);
          lines.push(`  └ ${factor.description}`);
        });
      }

      // Score breakdown
      lines.push(``);
      lines.push(`<b>Score Breakdown:</b>`);
      lines.push(`• Liquidity: $${formatNumber(liquidity.totalLiquidityUsd)}`);
      lines.push(`• LP Burned: ${liquidity.lpBurnedPercent.toFixed(0)}%`);
      lines.push(`• Top 10 Holders: ${holders.top10HoldersPercent.toFixed(1)}%`);
      lines.push(`• Mint Revoked: ${contract.mintAuthorityRevoked ? 'Yes' : 'No'}`);
      lines.push(`• Freeze Revoked: ${contract.freezeAuthorityRevoked ? 'Yes' : 'No'}`);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        lines.join('\n'),
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Risk command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error analyzing risk factors.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // Handle callback for check button
  bot.action(/^check_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Use /check [full_address] for analysis');
  });

  bot.action(/^holders_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Use /holders [full_address]');
  });

  bot.action(/^lp_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Use /lp [full_address]');
  });
}
