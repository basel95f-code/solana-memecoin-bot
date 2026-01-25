# Performance Integration - Complete Guide

## 🎯 Overview

This performance integration adds comprehensive caching, parallel processing, and monitoring to the Solana memecoin bot. Target improvements:

- **Response Time**: <3s (from ~8s)
- **Cache Hit Rate**: >70%
- **Memory Usage**: <500MB
- **Parallel Analysis**: 5+ tokens simultaneously

## 📦 Components

### 1. Cache Integration

**Files Modified:**
- ✅ `apps/bot/src/analysis/tokenAnalyzer.ts` - Main token analysis caching
- ✅ `apps/bot/src/analysis/liquidityCheck.ts` - Pool liquidity caching
- ✅ `apps/bot/src/analysis/holderAnalysis.ts` - Holder data caching
- ✅ `apps/bot/src/analysis/contractCheck.ts` - Contract info caching
- ✅ `apps/bot/src/analysis/socialCheck.ts` - Social metrics caching
- ✅ `apps/bot/src/ml/rugPredictor.ts` - ML prediction caching (1min TTL)

**Cache TTLs:**
```typescript
TOKEN_ANALYSIS: 5 minutes
HOLDER_DATA: 5 minutes
SOCIAL_DATA: 15 minutes
ML_PREDICTION: 1 minute
```

**Usage:**
```typescript
import { cacheManager, CacheKey, CacheTTL } from './cache';

// Get or compute with automatic caching
const data = await cacheManager.getOrCompute(
  CacheKey.tokenAnalysis(mint),
  CacheTTL.TOKEN_ANALYSIS,
  async () => {
    return await expensiveAnalysis(mint);
  }
);

// Manual cache operations
await cacheManager.set(key, value, ttl);
const value = await cacheManager.get(key);
await cacheManager.delete(key);
```

### 2. Parallel Processing

**New File:** `apps/bot/src/analysis/parallel.ts`

**Features:**
- Concurrent token analysis with rate limiting
- Per-token error handling (doesn't fail batch)
- Progress tracking callbacks
- Timeout protection per token
- Batch processing for large sets

**Usage:**
```typescript
import { analyzeTokensBatch, analyzeTokensInBatches } from './analysis/parallel';

// Analyze multiple tokens in parallel
const results = await analyzeTokensBatch(
  [{ mint: 'token1', pool: pool1 }, { mint: 'token2', pool: pool2 }],
  {
    maxConcurrent: 5,
    timeoutMs: 30000,
    onProgress: (completed, total) => {
      console.log(`Progress: ${completed}/${total}`);
    }
  }
);

// Process large sets in batches
const allResults = await analyzeTokensInBatches(tokens, {
  batchSize: 10,
  maxConcurrent: 5,
  delayBetweenBatches: 1000,
  onBatchComplete: (batch, total) => {
    console.log(`Batch ${batch}/${total} complete`);
  }
});

// Quick safety check (minimal analysis)
const quickChecks = await quickBatchCheck(mints, { maxConcurrent: 10 });
```

### 3. Performance Monitoring

**New File:** `apps/bot/src/performance/monitor.ts`

**Tracks:**
- Response times (avg, min, max, p50, p95, p99)
- Cache hit rate
- Memory usage
- Analysis success rate
- Slow operations (>3s)

**Usage:**
```typescript
import { performanceMonitor, measureOperation } from './performance/monitor';

// Track an operation
const result = await measureOperation('tokenAnalysis', async () => {
  return await analyzeToken(mint, pool);
});

// Get metrics
const metrics = performanceMonitor.getMetrics();
console.log(`Avg response: ${metrics.avgResponseTime}ms`);
console.log(`Cache hit rate: ${metrics.cacheHitRate}%`);
console.log(`Memory: ${metrics.memoryUsedMB}MB`);

// Log metrics
performanceMonitor.logMetrics();

// Check alerts
if (performanceMonitor.isMemoryHigh()) {
  console.warn('Memory usage is high!');
}

if (performanceMonitor.isCacheHitRateLow()) {
  console.warn('Cache hit rate is low!');
}
```

### 4. Function Profiling

**New File:** `apps/bot/src/performance/profiler.ts`

**Usage:**
```typescript
import { profiler, measureBlock, Timer } from './performance/profiler';

// Profile a function
const result = await profiler.profile('expensiveOperation', async () => {
  return await doExpensiveWork();
});

// Measure a code block
const measure = measureBlock('myBlock');
// ... code ...
const duration = measure.end();

// Simple timer
const timer = new Timer('tokenFetch');
await fetchToken();
timer.log('Token fetched');
const elapsed = timer.end();

// Get profiling stats
const stats = profiler.getStats('expensiveOperation');
console.log(`Avg: ${stats.avg}ms, Min: ${stats.min}ms, Max: ${stats.max}ms`);

// Print report
profiler.printReport();
```

### 5. Cache Warmup

**New File:** `apps/bot/src/cache/warmup.ts`

**Features:**
- Automatic popular token tracking
- Background cache refresh
- Smart eviction (keeps hot data)
- Pre-caching for known tokens

**Usage:**
```typescript
import { cacheWarmup } from './cache/warmup';

// Start background warmup (refreshes every 2 minutes)
cacheWarmup.start(120000);

// Pre-cache specific tokens
await cacheWarmup.precacheToken(mint, pool);

// Pre-cache batch
const result = await cacheWarmup.precacheTokens([
  { mint: 'token1', pool: pool1 },
  { mint: 'token2', pool: pool2 }
]);

// Record access for popularity tracking
cacheWarmup.recordAccess(mint);

// Get stats
const stats = cacheWarmup.getStats();
console.log(`Popular tokens: ${stats.popularTokens.join(', ')}`);

// Stop warmup
cacheWarmup.stop();
```

### 6. Benchmarking

**New File:** `apps/bot/src/performance/benchmark.ts`

**Usage:**
```typescript
import { benchmarkEngine } from './performance/benchmark';

// Run benchmark
const result = await benchmarkEngine.runBenchmark(
  'My Test',
  tokens,
  { parallel: true, maxConcurrent: 5 }
);

// Quick benchmark with synthetic data
const quickResult = await benchmarkEngine.runQuickBenchmark(50, {
  parallel: true,
  maxConcurrent: 5
});

// Scalability test
const results = await benchmarkEngine.runScalabilityTest(
  [10, 50, 100],
  { parallel: true }
);

// Compare before/after
const comparison = benchmarkEngine.compare(beforeResult, afterResult);
console.log(comparison.summary);

// Generate and save report
const report = benchmarkEngine.generateReport();
await benchmarkEngine.saveReport('benchmark-2024-01-01.txt');
await benchmarkEngine.saveResultsJSON('results.json');
```

## 🚀 Quick Start

### 1. Environment Setup

Add to `.env`:
```bash
# Redis (optional - falls back to in-memory LRU if unavailable)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password  # optional
```

### 2. Initialize Performance Monitoring

```typescript
import { performanceMonitor } from './performance/monitor';
import { cacheWarmup } from './cache/warmup';

// Start monitoring
performanceMonitor.reset();

// Start cache warmup
cacheWarmup.start();

// Log metrics every 5 minutes
setInterval(() => {
  performanceMonitor.logMetrics();
}, 300000);
```

### 3. Use Parallel Analysis

```typescript
import { analyzeTokensBatch } from './analysis/parallel';

// Instead of sequential analysis:
for (const token of tokens) {
  await analyzeToken(token.mint, token.pool);
}

// Use parallel processing:
const results = await analyzeTokensBatch(
  tokens.map(t => ({ mint: t.mint, pool: t.pool })),
  { maxConcurrent: 5 }
);
```

### 4. Run Benchmarks

```typescript
import { benchmarkEngine } from './performance/benchmark';

// Benchmark before optimization
const before = await benchmarkEngine.runQuickBenchmark(50);

// ... make optimizations ...

// Benchmark after optimization
const after = await benchmarkEngine.runQuickBenchmark(50);

// Compare
const comparison = benchmarkEngine.compare(before, after);
console.log(comparison.summary);
```

## 📊 Performance Targets

### ✅ Achieved Targets

- [x] All analyzers use cache
- [x] Parallel processing implemented
- [x] Cache hit rate tracking
- [x] Response time monitoring
- [x] Memory usage tracking
- [x] Benchmark tools created

### 🎯 Expected Improvements

**Response Time:**
- Before: ~8s per token
- Target: <3s per token
- Method: Cache + parallel processing

**Cache Hit Rate:**
- Target: >70%
- Mechanism: Popularity-based warmup

**Memory Usage:**
- Target: <500MB
- Mechanism: LRU eviction + smart TTLs

**Throughput:**
- Target: 5+ tokens simultaneously
- Mechanism: Parallel processing with rate limiting

## 🧪 Testing

### Run Quick Benchmark

```typescript
import { benchmarkEngine } from './performance/benchmark';

const result = await benchmarkEngine.runQuickBenchmark(50, {
  parallel: true,
  maxConcurrent: 5
});

console.log(`Avg: ${result.avgDuration}ms`);
console.log(`Cache hit rate: ${result.cacheHitRate}%`);
console.log(`Throughput: ${result.tokensPerSecond} tokens/sec`);
```

### Test Cache Effectiveness

```typescript
import { cacheManager } from './cache';

// First run (cache miss)
const start1 = Date.now();
const result1 = await analyzeToken(mint, pool);
console.log(`First run: ${Date.now() - start1}ms`);

// Second run (cache hit)
const start2 = Date.now();
const result2 = await analyzeToken(mint, pool);
console.log(`Second run: ${Date.now() - start2}ms`);

// Check cache stats
const stats = await cacheManager.getStats();
console.log(`Cache hit rate: ${stats.lru.hitRate}%`);
```

### Monitor Performance

```typescript
import { performanceMonitor } from './performance/monitor';

// Run some operations
for (let i = 0; i < 100; i++) {
  await analyzeToken(randomMint, randomPool);
}

// Check metrics
const metrics = performanceMonitor.getMetrics();
console.log(`P95 response time: ${metrics.p95ResponseTime}ms`);
console.log(`Cache hit rate: ${metrics.cacheHitRate}%`);
console.log(`Memory: ${metrics.memoryUsedMB}MB`);

// Check for issues
if (metrics.avgResponseTime > 3000) {
  console.warn('⚠️  Avg response time exceeds target!');
}

if (metrics.cacheHitRate < 70) {
  console.warn('⚠️  Cache hit rate below target!');
}
```

## 🔍 Troubleshooting

### Low Cache Hit Rate

**Causes:**
- Not enough traffic to warm cache
- TTL too short
- High variance in requests

**Solutions:**
```typescript
// Increase TTLs
export const CacheTTL = {
  TOKEN_ANALYSIS: 10 * 60 * 1000, // 10 minutes instead of 5
  // ...
};

// Start cache warmup
cacheWarmup.start(120000);

// Pre-cache popular tokens
await cacheWarmup.precacheTokens(popularTokens);
```

### High Memory Usage

**Causes:**
- Too many cached items
- Large cache entries
- Memory leaks

**Solutions:**
```typescript
// Reduce LRU cache size
const lruCache = new LRUCache({
  maxSize: 5000, // Reduce from 10000
  maxMemoryMB: 50, // Reduce from 100
});

// Clear cache periodically
setInterval(() => {
  cacheManager.cleanup();
}, 3600000); // Every hour

// Monitor memory
if (performanceMonitor.isMemoryHigh()) {
  cacheManager.clear();
}
```

### Slow Response Times

**Causes:**
- External API slowness
- Network latency
- Rate limiting

**Solutions:**
```typescript
// Increase parallel processing
const results = await analyzeTokensBatch(tokens, {
  maxConcurrent: 10, // Increase from 5
});

// Pre-cache before peak times
await cacheWarmup.precacheTokens(expectedTokens);

// Adjust timeouts
const analysis = await Promise.race([
  analyzeToken(mint, pool),
  timeout(5000), // Reduce from 30s
]);
```

## 📝 Configuration

### Cache Configuration

```typescript
// apps/bot/src/cache/index.ts
export const CacheTTL = {
  TOKEN_ANALYSIS: 5 * 60 * 1000,
  DEXSCREENER: 2 * 60 * 1000,
  SMART_MONEY: 10 * 60 * 1000,
  ML_PREDICTION: 1 * 60 * 1000,
  RUGCHECK: 5 * 60 * 1000,
  TOKEN_INFO: 10 * 60 * 1000,
  HOLDER_DATA: 5 * 60 * 1000,
  SOCIAL_DATA: 15 * 60 * 1000,
};
```

### Parallel Processing Configuration

```typescript
// apps/bot/src/analysis/parallel.ts
const parallelLimiter = new ParallelRateLimiter(
  5,    // maxConcurrent
  200   // delayMs between requests
);
```

### Performance Monitoring Configuration

```typescript
// apps/bot/src/performance/monitor.ts
private readonly maxHistorySize = 1000;
private readonly slowThresholdMs = 3000;
private readonly memoryLimitMB = 500;
```

## 🎉 Results

After implementing this performance integration, you should see:

1. **Faster Analysis**: Sub-3s response times for cached tokens
2. **Higher Throughput**: Analyze 5+ tokens simultaneously
3. **Better Resource Usage**: Consistent <500MB memory
4. **Improved Reliability**: Graceful fallbacks and error handling
5. **Better Observability**: Detailed metrics and benchmarking

## 🚨 Important Notes

1. **Backward Compatible**: All caching is optional - system works without Redis
2. **Graceful Degradation**: Falls back to in-memory LRU if Redis unavailable
3. **No Breaking Changes**: Existing code continues to work
4. **Production Ready**: Tested error handling and edge cases
5. **Observable**: Comprehensive metrics and logging

## 📚 Additional Resources

- Cache API: `apps/bot/src/cache/index.ts`
- Performance Monitoring: `apps/bot/src/performance/monitor.ts`
- Benchmarking: `apps/bot/src/performance/benchmark.ts`
- Parallel Processing: `apps/bot/src/analysis/parallel.ts`

---

**Ready to commit!** 🎯
