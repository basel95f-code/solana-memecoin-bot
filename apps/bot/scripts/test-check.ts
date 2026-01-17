/**
 * Test script to verify token analysis is working
 */
import { analyzeToken } from '../src/analysis/tokenAnalyzer';
import { PoolInfo, SOL_MINT } from '../src/types';

// Use a smaller/newer token for testing
// POPCAT - medium size token
const TEST_MINT = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';

async function testCheck() {
  console.log('Testing /check on POPCAT token...\n');

  const pool: PoolInfo = {
    address: '',
    tokenMint: TEST_MINT,
    baseMint: TEST_MINT,
    quoteMint: SOL_MINT,
    baseReserve: 0,
    quoteReserve: 0,
    lpMint: '',
    source: 'jupiter',
    createdAt: new Date(),
  };

  try {
    const analysis = await analyzeToken(TEST_MINT, pool);

    if (analysis) {
      console.log('=== ANALYSIS RESULTS ===\n');
      console.log(`Token: ${analysis.token.name} (${analysis.token.symbol})`);
      console.log(`Mint: ${analysis.token.mint}`);
      console.log('');
      console.log('📊 LIQUIDITY:');
      console.log(`  Total USD: $${analysis.liquidity.totalLiquidityUsd.toLocaleString()}`);
      console.log(`  LP Burned: ${analysis.liquidity.lpBurnedPercent}%`);
      console.log(`  LP Locked: ${analysis.liquidity.lpLockedPercent}%`);
      console.log('');
      console.log('👥 HOLDERS:');
      console.log(`  Total Holders: ${analysis.holders.totalHolders}`);
      console.log(`  Top 10 Holders: ${analysis.holders.top10HoldersPercent.toFixed(2)}%`);
      console.log(`  Largest Holder: ${analysis.holders.largestHolderPercent.toFixed(2)}%`);
      console.log(`  Whales: ${analysis.holders.whaleAddresses.length}`);
      console.log('');
      console.log('🔒 CONTRACT:');
      console.log(`  Mint Revoked: ${analysis.contract.mintAuthorityRevoked ? '✅' : '❌'}`);
      console.log(`  Freeze Revoked: ${analysis.contract.freezeAuthorityRevoked ? '✅' : '❌'}`);
      console.log(`  Honeypot: ${analysis.contract.isHoneypot ? '⚠️ YES' : '✅ No'}`);
      console.log('');
      console.log('🌐 SOCIALS:');
      console.log(`  Twitter: ${analysis.social.hasTwitter ? '✅' : '❌'} ${analysis.social.twitterUrl || ''}`);
      console.log(`  Telegram: ${analysis.social.hasTelegram ? '✅' : '❌'} ${analysis.social.telegramUrl || ''}`);
      console.log(`  Website: ${analysis.social.hasWebsite ? '✅' : '❌'} ${analysis.social.websiteUrl || ''}`);
      console.log('');
      console.log('⚠️ RISK:');
      console.log(`  Score: ${analysis.risk.score}/100`);
      console.log(`  Level: ${analysis.risk.level}`);
      console.log('');
      console.log('✅ Analysis completed successfully!');
    } else {
      console.log('❌ Analysis failed - returned null');
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }

  process.exit(0);
}

testCheck();
