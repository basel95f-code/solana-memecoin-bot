/**
 * Performance Integration Demo
 * 
 * This file demonstrates how to use the new performance features:
 * - Cache integration
 * - Parallel processing
 * - Performance monitoring
 * - Benchmarking
 */

import { analyzeToken } from '../apps/bot/src/analysis/tokenAnalyzer';
import { analyzeTokensBatch, analyzeTokensInBatches } from '../apps/bot/src/analysis/parallel';
import { performanceMonitor, measureOperation } from '../apps/bot/src/performance/monitor';
import { profiler, Timer } from '../apps/bot/src/performance/profiler';
import { cacheWarmup } from '../apps/bot/src/cache/warmup';
import { benchmarkEngine } from '../apps/bot/src/performance/benchmark';
import { cacheManager } from '../apps/bot/src/cache';
import type { PoolInfo } from '../apps/bot/src/types';

// Example token mints (replace with real ones)
const EXAMPLE_TOKENS = [
  {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    pool: {
      address: 'pool1',
      tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      baseMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      quoteMint: 'So11111111111111111111111111111111111111112',
      baseReserve: 1000000,
      quoteReserve: 100,
    } as PoolInfo,
  },
  // Add more tokens...
];

/**
 * Demo 1: Basic Cache Usage
 */
async function demoCache() {
  console.log('\n=== Demo 1: Cache Usage ===');

  const { mint, pool } = EXAMPLE_TOKENS[0];

  // First analysis (cache miss)
  const timer1 = new Timer('First Analysis');
  const result1 = await analyzeToken(mint, pool);
  timer1.log('Cache MISS');

  // Second analysis (cache hit)
  const timer2 = new Timer('Second Analysis');
  const result2 = await analyzeToken(mint, pool);
  timer2.log('Cache HIT');

  // Check cache stats
  const stats = await cacheManager.getStats();
  console.log('Cache Stats:', {
    lruHitRate: stats.lru.hitRate,
    lruSize: stats.lru.size,
    redisAvailable: stats.usingRedis,
  });
}

/**
 * Demo 2: Parallel Processing
 */
async function demoParallel() {
  console.log('\n=== Demo 2: Parallel Processing ===');

  const tokens = EXAMPLE_TOKENS.slice(0, 5); // First 5 tokens

  // Sequential processing (old way)
  const seqTimer = new Timer('Sequential');
  for (const { mint, pool } of tokens) {
    await analyzeToken(mint, pool);
  }
  const seqDuration = seqTimer.end();

  // Clear cache for fair comparison
  await cacheManager.clear();

  // Parallel processing (new way)
  const parTimer = new Timer('Parallel');
  const results = await analyzeTokensBatch(
    tokens.map(t => ({ mint: t.mint, pool: t.pool })),
    {
      maxConcurrent: 5,
      onProgress: (completed, total) => {
        console.log(`Progress: ${completed}/${total}`);
      },
    }
  );
  const parDuration = parTimer.end();

  console.log(`Sequential: ${seqDuration}ms`);
  console.log(`Parallel: ${parDuration}ms`);
  console.log(`Speedup: ${(seqDuration / parDuration).toFixed(2)}x`);
  console.log(`Success: ${results.size}/${tokens.length}`);
}

/**
 * Demo 3: Performance Monitoring
 */
async function demoMonitoring() {
  console.log('\n=== Demo 3: Performance Monitoring ===');

  // Reset metrics
  performanceMonitor.reset();

  // Run some operations
  for (let i = 0; i < 10; i++) {
    const { mint, pool } = EXAMPLE_TOKENS[i % EXAMPLE_TOKENS.length];
    
    await measureOperation(`analysis-${i}`, async () => {
      return await analyzeToken(mint, pool);
    });
  }

  // Get and log metrics
  const metrics = performanceMonitor.getMetrics();
  console.log('Performance Metrics:');
  console.log(`  Avg Response: ${metrics.avgResponseTime}ms`);
  console.log(`  P95 Response: ${metrics.p95ResponseTime}ms`);
  console.log(`  Cache Hit Rate: ${metrics.cacheHitRate}%`);
  console.log(`  Memory: ${metrics.memoryUsedMB}MB`);
  console.log(`  Success Rate: ${metrics.successRate}%`);

  // Check alerts
  if (performanceMonitor.isMemoryHigh()) {
    console.warn('⚠️  Memory usage is high!');
  }

  if (performanceMonitor.isCacheHitRateLow()) {
    console.warn('⚠️  Cache hit rate is low!');
  }

  // Full metrics log
  performanceMonitor.logMetrics();
}

/**
 * Demo 4: Function Profiling
 */
async function demoProfiling() {
  console.log('\n=== Demo 4: Function Profiling ===');

  const { mint, pool } = EXAMPLE_TOKENS[0];

  // Profile an operation
  await profiler.profile('tokenAnalysis', async () => {
    return await analyzeToken(mint, pool);
  });

  // Get profiling stats
  const stats = profiler.getStats('tokenAnalysis');
  if (stats) {
    console.log('Profiling Stats:');
    console.log(`  Count: ${stats.count}`);
    console.log(`  Avg: ${stats.avg}ms`);
    console.log(`  Min: ${stats.min}ms`);
    console.log(`  Max: ${stats.max}ms`);
  }

  // Print full report
  profiler.printReport();
}

/**
 * Demo 5: Cache Warmup
 */
async function demoWarmup() {
  console.log('\n=== Demo 5: Cache Warmup ===');

  // Start cache warmup service
  cacheWarmup.start(60000); // Refresh every minute

  // Pre-cache some tokens
  console.log('Pre-caching tokens...');
  const result = await cacheWarmup.precacheTokens(
    EXAMPLE_TOKENS.slice(0, 3).map(t => ({ mint: t.mint, pool: t.pool }))
  );

  console.log(`Pre-cached: ${result.success} success, ${result.failed} failed`);

  // Record some accesses (to track popularity)
  for (let i = 0; i < 10; i++) {
    cacheWarmup.recordAccess(EXAMPLE_TOKENS[0].mint);
    cacheWarmup.recordAccess(EXAMPLE_TOKENS[1].mint);
    cacheWarmup.recordAccess(EXAMPLE_TOKENS[0].mint); // Access token 0 more
  }

  // Get stats
  const stats = cacheWarmup.getStats();
  console.log('Warmup Stats:');
  console.log(`  Running: ${stats.running}`);
  console.log(`  Popular tokens: ${stats.popularTokens.join(', ')}`);
  console.log(`  Tracked: ${stats.popularityStats.trackedTokens}`);

  // Stop warmup
  cacheWarmup.stop();
}

/**
 * Demo 6: Benchmarking
 */
async function demoBenchmarking() {
  console.log('\n=== Demo 6: Benchmarking ===');

  // Run a quick benchmark
  console.log('Running benchmark with 20 tokens...');
  const result = await benchmarkEngine.runQuickBenchmark(20, {
    parallel: true,
    maxConcurrent: 5,
  });

  console.log('Benchmark Results:');
  console.log(`  Tokens: ${result.totalTokens}`);
  console.log(`  Success: ${result.successfulAnalyses}`);
  console.log(`  Avg Duration: ${result.avgDuration}ms`);
  console.log(`  P95 Duration: ${result.p95Duration}ms`);
  console.log(`  Cache Hit Rate: ${result.cacheHitRate}%`);
  console.log(`  Throughput: ${result.tokensPerSecond} tokens/sec`);
  console.log(`  Memory Peak: ${result.memoryPeakMB}MB`);

  // Run scalability test
  console.log('\nRunning scalability test...');
  const scalability = await benchmarkEngine.runScalabilityTest(
    [10, 25, 50],
    { parallel: true, maxConcurrent: 5 }
  );

  console.log('Scalability Results:');
  for (const r of scalability) {
    console.log(`  ${r.totalTokens} tokens: ${r.avgDuration}ms avg, ${r.tokensPerSecond} tokens/sec`);
  }

  // Compare before/after (simulate optimization)
  if (scalability.length >= 2) {
    const comparison = benchmarkEngine.compare(scalability[0], scalability[1]);
    console.log('\nComparison:');
    console.log(`  Summary: ${comparison.summary}`);
    console.log(`  Avg Duration: ${comparison.improvements.avgDurationPercent.toFixed(1)}%`);
    console.log(`  Cache Hit Rate: ${comparison.improvements.cacheHitRatePercent.toFixed(1)}%`);
    console.log(`  Throughput: ${comparison.improvements.throughputPercent.toFixed(1)}%`);
  }

  // Save report
  const report = benchmarkEngine.generateReport();
  console.log('\n' + report);

  // Save to files
  await benchmarkEngine.saveReport(`benchmark-${Date.now()}.txt`);
  await benchmarkEngine.saveResultsJSON(`results-${Date.now()}.json`);
  console.log('Reports saved to ./benchmarks/');
}

/**
 * Run all demos
 */
async function runAllDemos() {
  console.log('🚀 Performance Integration Demo\n');

  try {
    await demoCache();
    await demoParallel();
    await demoMonitoring();
    await demoProfiling();
    await demoWarmup();
    await demoBenchmarking();

    console.log('\n✅ All demos completed successfully!');
  } catch (error) {
    console.error('❌ Demo failed:', error);
  }
}

// Run demos if executed directly
if (require.main === module) {
  runAllDemos()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export {
  demoCache,
  demoParallel,
  demoMonitoring,
  demoProfiling,
  demoWarmup,
  demoBenchmarking,
};
