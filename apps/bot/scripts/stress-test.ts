/**
 * Stress test for parallel queue processing
 * Queues multiple known tokens to verify parallel analysis works correctly
 */

import { analyzeToken } from '../src/analysis/tokenAnalyzer';
import { PoolInfo } from '../src/types';
import { QUEUE } from '../src/constants';

// Known active Solana tokens to test with
const TEST_TOKENS = [
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  // JUP
  '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', // POPCAT
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
  'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', // MEW
  'A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump', // FARTCOIN
  'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump', // GOAT
  '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', // PNUT
  'Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs', // GRASS
];

async function runStressTest() {
  console.log('🧪 Starting parallel processing stress test...');
  console.log(`📊 Concurrency limit: ${QUEUE.CONCURRENCY}`);
  console.log(`📝 Testing with ${TEST_TOKENS.length} tokens\n`);

  const startTime = Date.now();
  let completed = 0;
  let failed = 0;

  // Create pool info objects
  const pools: PoolInfo[] = TEST_TOKENS.map(mint => ({
    address: mint,
    tokenMint: mint,
    baseMint: mint,
    quoteMint: 'So11111111111111111111111111111111111111112',
    baseReserve: 0,
    quoteReserve: 0,
    lpMint: '',
    source: 'stress-test' as any,
    createdAt: new Date(),
  }));

  // Test 1: Sequential processing (baseline)
  console.log('⏱️  Test 1: Sequential processing (baseline)...');
  const seqStart = Date.now();
  for (const pool of pools.slice(0, 5)) {
    try {
      const result = await analyzeToken(pool.tokenMint, pool);
      if (result) {
        console.log(`  ✅ ${result.token.symbol}: ${result.risk.level} (${result.risk.score}/100)`);
        completed++;
      } else {
        console.log(`  ⚠️  ${pool.tokenMint.slice(0, 8)}... returned null`);
        failed++;
      }
    } catch (e) {
      console.log(`  ❌ ${pool.tokenMint.slice(0, 8)}... error: ${e}`);
      failed++;
    }
  }
  const seqTime = Date.now() - seqStart;
  console.log(`\n📈 Sequential: 5 tokens in ${seqTime}ms (${Math.round(seqTime / 5)}ms/token)\n`);

  // Reset counters
  completed = 0;
  failed = 0;

  // Test 2: Parallel processing
  console.log('⏱️  Test 2: Parallel processing (all at once)...');
  const parStart = Date.now();

  const results = await Promise.all(
    pools.map(async (pool) => {
      try {
        const result = await analyzeToken(pool.tokenMint, pool);
        if (result) {
          return { success: true, symbol: result.token.symbol, score: result.risk.score, level: result.risk.level };
        }
        return { success: false, mint: pool.tokenMint };
      } catch (e) {
        return { success: false, mint: pool.tokenMint, error: e };
      }
    })
  );

  for (const r of results) {
    if (r.success && 'symbol' in r) {
      console.log(`  ✅ ${r.symbol}: ${r.level} (${r.score}/100)`);
      completed++;
    } else {
      const mint = 'mint' in r && r.mint ? r.mint.slice(0, 8) : 'unknown';
      console.log(`  ❌ ${mint}... failed`);
      failed++;
    }
  }

  const parTime = Date.now() - parStart;
  console.log(`\n📈 Parallel: ${TEST_TOKENS.length} tokens in ${parTime}ms (${Math.round(parTime / TEST_TOKENS.length)}ms/token)\n`);

  // Summary
  const totalTime = Date.now() - startTime;
  const speedup = seqTime > 0 ? ((seqTime / 5) * TEST_TOKENS.length / parTime).toFixed(2) : 'N/A';

  console.log('═══════════════════════════════════════════════');
  console.log('📊 RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════');
  console.log(`Sequential (5 tokens): ${seqTime}ms`);
  console.log(`Parallel (${TEST_TOKENS.length} tokens):  ${parTime}ms`);
  console.log(`Speedup factor:        ~${speedup}x`);
  console.log(`Total test time:       ${totalTime}ms`);
  console.log(`Completed:             ${completed}/${TEST_TOKENS.length}`);
  console.log(`Failed:                ${failed}/${TEST_TOKENS.length}`);
  console.log('═══════════════════════════════════════════════');
}

runStressTest().catch(console.error);
