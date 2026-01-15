/**
 * Test Token Script
 *
 * Usage: npx ts-node scripts/test-token.ts <TOKEN_ADDRESS>
 *
 * Analyzes any Solana token and outputs full analysis results.
 */

import 'dotenv/config';
import { solanaService } from '../src/services/solana';
import { rugCheckService } from '../src/services/rugcheck';
import { dexScreenerService } from '../src/services/dexscreener';
import { analyzeLiquidity } from '../src/analysis/liquidityCheck';
import { analyzeHolders } from '../src/analysis/holderAnalysis';
import { analyzeContract } from '../src/analysis/contractCheck';
import { analyzeSocials } from '../src/analysis/socialCheck';
import { classifyRisk } from '../src/risk/classifier';
import { PoolInfo } from '../src/types';

async function testToken(tokenAddress: string) {
  console.log('='.repeat(60));
  console.log('TOKEN ANALYSIS');
  console.log('='.repeat(60));
  console.log(`\nToken: ${tokenAddress}\n`);

  try {
    // Get token info
    console.log('Fetching token info...');
    const tokenInfo = await solanaService.getTokenInfo(tokenAddress);

    if (!tokenInfo) {
      console.error('Failed to fetch token info');
      process.exit(1);
    }

    console.log(`Name: ${tokenInfo.name}`);
    console.log(`Symbol: ${tokenInfo.symbol}`);
    console.log(`Decimals: ${tokenInfo.decimals}`);
    console.log(`Supply: ${tokenInfo.supply?.toLocaleString() || 'Unknown'}`);

    // Get DexScreener data
    console.log('\nFetching DexScreener data...');
    const dexData = await dexScreenerService.getTokenPairs(tokenAddress);

    let pool: PoolInfo;
    if (dexData && dexData.length > 0) {
      const pair = dexData[0];
      console.log(`Price: $${pair.priceUsd || 'N/A'}`);
      console.log(`Liquidity: $${pair.liquidity?.usd?.toLocaleString() || 'N/A'}`);
      console.log(`24h Volume: $${pair.volume?.h24?.toLocaleString() || 'N/A'}`);
      console.log(`Market Cap: $${pair.marketCap?.toLocaleString() || 'N/A'}`);

      pool = {
        address: pair.pairAddress,
        tokenMint: tokenAddress,
        baseMint: pair.baseToken?.address || tokenAddress,
        quoteMint: pair.quoteToken?.address || 'So11111111111111111111111111111111111111112',
        baseReserve: pair.liquidity?.base || 0,
        quoteReserve: pair.liquidity?.quote || 0,
        lpMint: pair.pairAddress,
        source: (pair.dexId as 'raydium' | 'pumpfun' | 'jupiter') || 'raydium',
        createdAt: new Date(),
      };
    } else {
      console.log('No DexScreener data available');
      pool = {
        address: 'unknown',
        tokenMint: tokenAddress,
        baseMint: tokenAddress,
        quoteMint: 'So11111111111111111111111111111111111111112',
        baseReserve: 0,
        quoteReserve: 0,
        lpMint: 'unknown',
        source: 'raydium',
        createdAt: new Date(),
      };
    }

    // Run all analyses
    console.log('\n' + '-'.repeat(60));
    console.log('RUNNING ANALYSES');
    console.log('-'.repeat(60));

    // Liquidity Analysis
    console.log('\n[1/5] Liquidity Analysis...');
    const liquidity = await analyzeLiquidity(pool);
    console.log(`  Total Liquidity: $${liquidity.totalLiquidityUsd.toLocaleString()}`);
    console.log(`  LP Burned: ${liquidity.lpBurned ? `Yes (${liquidity.lpBurnedPercent.toFixed(1)}%)` : 'No'}`);
    console.log(`  LP Locked: ${liquidity.lpLocked ? `Yes (${liquidity.lpLockedPercent.toFixed(1)}%)` : 'No'}`);

    // Holder Analysis
    console.log('\n[2/5] Holder Analysis...');
    const holders = await analyzeHolders(tokenInfo);
    console.log(`  Total Holders: ${holders.totalHolders}`);
    console.log(`  Top 10 Hold: ${holders.top10HoldersPercent.toFixed(1)}%`);
    console.log(`  Top 20 Hold: ${holders.top20HoldersPercent.toFixed(1)}%`);
    console.log(`  Largest Holder: ${holders.largestHolderPercent.toFixed(1)}%`);
    console.log(`  Concentrated: ${holders.isConcentrated ? 'Yes' : 'No'}`);

    // Contract Analysis
    console.log('\n[3/5] Contract Analysis...');
    const contract = await analyzeContract(tokenAddress);
    console.log(`  Mint Authority Revoked: ${contract.mintAuthorityRevoked ? 'Yes' : 'No'}`);
    console.log(`  Freeze Authority Revoked: ${contract.freezeAuthorityRevoked ? 'Yes' : 'No'}`);
    console.log(`  Honeypot Detected: ${contract.isHoneypot ? 'YES - DANGER!' : 'No'}`);
    console.log(`  Transfer Fee: ${contract.hasTransferFee ? 'Yes' : 'No'}`);

    // Social Analysis
    console.log('\n[4/5] Social Analysis...');
    const social = await analyzeSocials(tokenInfo.metadata);
    console.log(`  Has Twitter: ${social.hasTwitter ? 'Yes' : 'No'}`);
    console.log(`  Has Telegram: ${social.hasTelegram ? 'Yes' : 'No'}`);
    console.log(`  Has Website: ${social.hasWebsite ? 'Yes' : 'No'}`);
    if (social.twitterFollowers) console.log(`  Twitter Followers: ${social.twitterFollowers.toLocaleString()}`);
    if (social.telegramMembers) console.log(`  Telegram Members: ${social.telegramMembers.toLocaleString()}`);

    // RugCheck
    console.log('\n[5/5] RugCheck Report...');
    const rugcheck = await rugCheckService.getTokenReport(tokenAddress);
    if (rugcheck) {
      console.log(`  RugCheck Score: ${rugcheck.score}/100`);
      console.log(`  Verified: ${rugcheck.verified ? 'Yes' : 'No'}`);
      if (rugcheck.risks && rugcheck.risks.length > 0) {
        console.log('  Risks:');
        rugcheck.risks.slice(0, 5).forEach(risk => {
          console.log(`    - [${risk.level}] ${risk.name}: ${risk.description}`);
        });
      }
    } else {
      console.log('  RugCheck data not available');
    }

    // Risk Classification
    console.log('\n' + '='.repeat(60));
    console.log('RISK CLASSIFICATION');
    console.log('='.repeat(60));

    const risk = classifyRisk({
      liquidity,
      holders,
      contract,
      social,
      rugcheck: rugcheck || undefined,
    });

    console.log(`\n  RISK LEVEL: ${risk.level}`);
    console.log(`  RISK SCORE: ${risk.score}/100`);
    console.log('\n  Risk Factors:');
    risk.factors.forEach(factor => {
      const sign = factor.impact >= 0 ? '+' : '';
      console.log(`    ${sign}${factor.impact}: ${factor.name} - ${factor.description}`);
    });

    // Final Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    const safetyChecks = [
      { name: 'Mint Revoked', pass: contract.mintAuthorityRevoked },
      { name: 'Freeze Revoked', pass: contract.freezeAuthorityRevoked },
      { name: 'Not Honeypot', pass: !contract.isHoneypot },
      { name: 'LP Burned/Locked', pass: liquidity.lpBurned || liquidity.lpLocked },
      { name: 'Not Concentrated', pass: !holders.isConcentrated },
      { name: 'Has Liquidity', pass: liquidity.totalLiquidityUsd > 1000 },
    ];

    console.log('\n  Safety Checks:');
    safetyChecks.forEach(check => {
      const icon = check.pass ? '[PASS]' : '[FAIL]';
      console.log(`    ${icon} ${check.name}`);
    });

    const passCount = safetyChecks.filter(c => c.pass).length;
    console.log(`\n  Passed: ${passCount}/${safetyChecks.length}`);

    // Links
    console.log('\n  Links:');
    console.log(`    DexScreener: https://dexscreener.com/solana/${tokenAddress}`);
    console.log(`    Birdeye: https://birdeye.so/token/${tokenAddress}`);
    console.log(`    Solscan: https://solscan.io/token/${tokenAddress}`);
    console.log(`    RugCheck: https://rugcheck.xyz/tokens/${tokenAddress}`);

    console.log('\n' + '='.repeat(60));

  } catch (error) {
    console.error('\nError during analysis:', error);
    process.exit(1);
  }
}

// Get token address from command line
const tokenAddress = process.argv[2];

if (!tokenAddress) {
  console.log('Usage: npx ts-node scripts/test-token.ts <TOKEN_ADDRESS>');
  console.log('\nExample:');
  console.log('  npx ts-node scripts/test-token.ts DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
  process.exit(1);
}

// Validate address format (basic check)
if (tokenAddress.length < 32 || tokenAddress.length > 44) {
  console.error('Invalid token address format');
  process.exit(1);
}

testToken(tokenAddress).then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
