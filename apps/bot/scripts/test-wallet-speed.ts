/**
 * Speed test for wallet tracking functionality
 * Measures latency for wallet transaction fetching and processing
 */

import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';

dotenv.config();

// Known active whale/trader wallets for testing
const TEST_WALLETS = [
  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium Authority
  'JCFRaPJt4i2cFbMbCQNqxVYLMFjDfaPSVZXLK3qdDJLH', // Known active trader
  'GThUX1Atko4tqhN2NaiTazws8v9WfSqoSKQXBSfGMrFF', // Active memecoin trader
];

interface TimingResult {
  operation: string;
  durationMs: number;
  details?: string;
}

async function measureOperation<T>(
  name: string,
  operation: () => Promise<T>,
  details?: string
): Promise<{ result: T; timing: TimingResult }> {
  const start = performance.now();
  const result = await operation();
  const durationMs = Math.round(performance.now() - start);
  return {
    result,
    timing: { operation: name, durationMs, details },
  };
}

async function testWalletSpeed() {
  console.log('===============================================');
  console.log('  WALLET TRACKER SPEED TEST');
  console.log('===============================================\n');

  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    console.error('SOLANA_RPC_URL environment variable is required');
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
  });

  const timings: TimingResult[] = [];
  const walletTimings: { wallet: string; fetchSigs: number; fetchTx: number; total: number }[] = [];

  // Test 1: Connection warmup
  console.log('1. Warming up connection...');
  const warmup = await measureOperation('Connection warmup', async () => {
    return connection.getSlot();
  });
  timings.push(warmup.timing);
  console.log(`   Current slot: ${warmup.result} (${warmup.timing.durationMs}ms)\n`);

  // Test 2: Test each wallet
  console.log('2. Testing wallet transaction fetching...\n');

  for (const walletAddress of TEST_WALLETS) {
    const walletLabel = walletAddress.slice(0, 8) + '...';
    console.log(`   Testing wallet: ${walletLabel}`);

    const walletStart = performance.now();

    // Fetch signatures
    const sigResult = await measureOperation(
      'Fetch signatures',
      async () => {
        const pubkey = new PublicKey(walletAddress);
        return connection.getSignaturesForAddress(pubkey, { limit: 20 });
      },
      walletLabel
    );
    timings.push(sigResult.timing);
    console.log(`     - Signatures: ${sigResult.result.length} found (${sigResult.timing.durationMs}ms)`);

    // Fetch first transaction details
    let txFetchTime = 0;
    if (sigResult.result.length > 0) {
      const txResult = await measureOperation(
        'Fetch transaction',
        async () => {
          return connection.getParsedTransaction(sigResult.result[0].signature, {
            maxSupportedTransactionVersion: 0,
          });
        },
        walletLabel
      );
      timings.push(txResult.timing);
      txFetchTime = txResult.timing.durationMs;
      console.log(`     - Transaction fetch: ${txFetchTime}ms`);
    }

    const walletTotal = Math.round(performance.now() - walletStart);
    walletTimings.push({
      wallet: walletLabel,
      fetchSigs: sigResult.timing.durationMs,
      fetchTx: txFetchTime,
      total: walletTotal,
    });
    console.log(`     - Total: ${walletTotal}ms\n`);
  }

  // Test 3: Parallel signature fetching (simulates checking multiple wallets)
  console.log('3. Testing parallel wallet checking...');
  const parallelResult = await measureOperation(
    'Parallel fetch (3 wallets)',
    async () => {
      const promises = TEST_WALLETS.map(async (addr) => {
        const pubkey = new PublicKey(addr);
        return connection.getSignaturesForAddress(pubkey, { limit: 10 });
      });
      return Promise.all(promises);
    }
  );
  timings.push(parallelResult.timing);
  console.log(`   Parallel fetch of 3 wallets: ${parallelResult.timing.durationMs}ms\n`);

  // Test 4: Rapid sequential calls (simulates polling)
  console.log('4. Testing rapid polling simulation (5 calls)...');
  const pollingTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const pollResult = await measureOperation(
      `Poll ${i + 1}`,
      async () => {
        const pubkey = new PublicKey(TEST_WALLETS[0]);
        return connection.getSignaturesForAddress(pubkey, { limit: 5 });
      }
    );
    pollingTimes.push(pollResult.timing.durationMs);
    process.stdout.write(`   Poll ${i + 1}: ${pollResult.timing.durationMs}ms`);
    if (i < 4) process.stdout.write(' | ');
  }
  console.log('\n');

  // Summary
  console.log('===============================================');
  console.log('  RESULTS SUMMARY');
  console.log('===============================================\n');

  console.log('Per-wallet timings:');
  console.log('┌──────────────┬────────────┬────────────┬──────────┐');
  console.log('│ Wallet       │ Signatures │ Tx Fetch   │ Total    │');
  console.log('├──────────────┼────────────┼────────────┼──────────┤');
  for (const wt of walletTimings) {
    console.log(
      `│ ${wt.wallet.padEnd(12)} │ ${String(wt.fetchSigs + 'ms').padEnd(10)} │ ${String(wt.fetchTx + 'ms').padEnd(10)} │ ${String(wt.total + 'ms').padEnd(8)} │`
    );
  }
  console.log('└──────────────┴────────────┴────────────┴──────────┘\n');

  const avgSigFetch = Math.round(walletTimings.reduce((a, b) => a + b.fetchSigs, 0) / walletTimings.length);
  const avgTxFetch = Math.round(walletTimings.reduce((a, b) => a + b.fetchTx, 0) / walletTimings.length);
  const avgTotal = Math.round(walletTimings.reduce((a, b) => a + b.total, 0) / walletTimings.length);
  const avgPolling = Math.round(pollingTimes.reduce((a, b) => a + b, 0) / pollingTimes.length);

  console.log('Averages:');
  console.log(`  - Signature fetch:    ${avgSigFetch}ms`);
  console.log(`  - Transaction fetch:  ${avgTxFetch}ms`);
  console.log(`  - Per-wallet total:   ${avgTotal}ms`);
  console.log(`  - Polling call:       ${avgPolling}ms`);
  console.log(`  - Parallel 3 wallets: ${parallelResult.timing.durationMs}ms\n`);

  // Calculate expected latency
  const pollInterval = 15000; // Current poll interval in walletMonitor.ts
  const expectedLatency = pollInterval / 2 + avgTotal;

  console.log('Expected alert latency:');
  console.log(`  - Poll interval:      ${pollInterval}ms (${pollInterval / 1000}s)`);
  console.log(`  - Avg detection time: ${expectedLatency}ms (~${(expectedLatency / 1000).toFixed(1)}s)`);
  console.log(`  - Best case:          ${avgTotal}ms`);
  console.log(`  - Worst case:         ${pollInterval + avgTotal}ms\n`);

  // Performance assessment
  console.log('Performance assessment:');
  if (avgPolling < 500) {
    console.log('  RPC response time: EXCELLENT (<500ms)');
  } else if (avgPolling < 1000) {
    console.log('  RPC response time: GOOD (<1000ms)');
  } else if (avgPolling < 2000) {
    console.log('  RPC response time: ACCEPTABLE (<2000ms)');
  } else {
    console.log('  RPC response time: SLOW (>2000ms) - consider switching RPC');
  }

  if (parallelResult.timing.durationMs < avgSigFetch * 2) {
    console.log('  Parallel efficiency: GOOD (parallelization working well)');
  } else {
    console.log('  Parallel efficiency: LIMITED (consider batching or rate limiting)');
  }

  console.log('\n===============================================');
}

testWalletSpeed().catch(console.error);
