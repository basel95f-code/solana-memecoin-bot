import { analyzeToken } from '../analysis/tokenAnalyzer';
import { analyzeTokensBatch } from '../analysis/parallel';
import { performanceMonitor } from './monitor';
import { profiler } from './profiler';
import { cacheManager } from '../cache';
import { logger } from '../utils/logger';
import type { PoolInfo } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Benchmark results for a single test
 */
export interface BenchmarkResult {
  testName: string;
  timestamp: number;
  
  // Performance metrics
  totalTokens: number;
  successfulAnalyses: number;
  failedAnalyses: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;

  // Cache metrics
  cacheHitRate: number;
  cacheHits: number;
  cacheMisses: number;

  // Memory metrics
  memoryStartMB: number;
  memoryEndMB: number;
  memoryPeakMB: number;

  // Throughput
  tokensPerSecond: number;
}

/**
 * Comparison report between two benchmark results
 */
export interface ComparisonReport {
  before: BenchmarkResult;
  after: BenchmarkResult;
  improvements: {
    avgDurationPercent: number;
    p95DurationPercent: number;
    cacheHitRatePercent: number;
    throughputPercent: number;
    memoryUsagePercent: number;
  };
  summary: string;
}

/**
 * Benchmarking engine for performance testing
 */
export class BenchmarkEngine {
  private results: BenchmarkResult[] = [];

  /**
   * Run benchmark on a set of tokens
   */
  async runBenchmark(
    testName: string,
    tokens: Array<{ mint: string; pool: PoolInfo }>,
    options: {
      parallel?: boolean;
      maxConcurrent?: number;
      warmup?: boolean;
    } = {}
  ): Promise<BenchmarkResult> {
    const { parallel = false, maxConcurrent = 5, warmup = false } = options;

    logger.info('benchmark', `Starting benchmark: ${testName}`);
    logger.info('benchmark', `Tokens: ${tokens.length}, Parallel: ${parallel}, Warmup: ${warmup}`);

    // Clear cache if not warmup
    if (!warmup) {
      await cacheManager.clear();
      performanceMonitor.reset();
    }

    // Memory tracking
    const memoryStart = process.memoryUsage().heapUsed / 1024 / 1024;
    let memoryPeak = memoryStart;

    const memoryInterval = setInterval(() => {
      const current = process.memoryUsage().heapUsed / 1024 / 1024;
      if (current > memoryPeak) {
        memoryPeak = current;
      }
    }, 100);

    // Run benchmark
    const startTime = Date.now();
    const durations: number[] = [];
    let successCount = 0;
    let failCount = 0;

    try {
      if (parallel) {
        // Parallel execution
        const results = await analyzeTokensBatch(tokens, {
          maxConcurrent,
          onProgress: (completed, total) => {
            logger.info('benchmark', `Progress: ${completed}/${total}`);
          },
        });

        successCount = results.size;
        failCount = tokens.length - results.size;
      } else {
        // Sequential execution
        for (const { mint, pool } of tokens) {
          const tokenStart = Date.now();
          
          try {
            const result = await analyzeToken(mint, pool);
            if (result) {
              successCount++;
            } else {
              failCount++;
            }
          } catch (error) {
            failCount++;
          }

          durations.push(Date.now() - tokenStart);
        }
      }
    } finally {
      clearInterval(memoryInterval);
    }

    const totalDuration = Date.now() - startTime;
    const memoryEnd = process.memoryUsage().heapUsed / 1024 / 1024;

    // Calculate statistics
    const sorted = [...durations].sort((a, b) => a - b);
    const len = sorted.length;

    const avgDuration = len > 0 ? sorted.reduce((sum, d) => sum + d, 0) / len : 0;
    const p50Index = Math.floor(len * 0.5);
    const p95Index = Math.floor(len * 0.95);
    const p99Index = Math.floor(len * 0.99);

    const metrics = performanceMonitor.getMetrics();
    const tokensPerSecond = (successCount / totalDuration) * 1000;

    const result: BenchmarkResult = {
      testName,
      timestamp: Date.now(),
      
      totalTokens: tokens.length,
      successfulAnalyses: successCount,
      failedAnalyses: failCount,
      totalDuration,
      avgDuration: Math.round(avgDuration),
      minDuration: len > 0 ? sorted[0] : 0,
      maxDuration: len > 0 ? sorted[len - 1] : 0,
      p50Duration: len > 0 ? sorted[p50Index] : 0,
      p95Duration: len > 0 ? sorted[p95Index] : 0,
      p99Duration: len > 0 ? sorted[p99Index] : 0,

      cacheHitRate: metrics.cacheHitRate,
      cacheHits: metrics.cacheHits,
      cacheMisses: metrics.cacheMisses,

      memoryStartMB: Math.round(memoryStart * 100) / 100,
      memoryEndMB: Math.round(memoryEnd * 100) / 100,
      memoryPeakMB: Math.round(memoryPeak * 100) / 100,

      tokensPerSecond: Math.round(tokensPerSecond * 100) / 100,
    };

    this.results.push(result);

    logger.info('benchmark', `Benchmark complete: ${testName}`);
    this.logResult(result);

    return result;
  }

  /**
   * Run a quick benchmark with synthetic data
   */
  async runQuickBenchmark(
    tokenCount: number,
    options?: {
      parallel?: boolean;
      maxConcurrent?: number;
    }
  ): Promise<BenchmarkResult> {
    // Generate synthetic token data
    const tokens = this.generateSyntheticTokens(tokenCount);
    
    return await this.runBenchmark(
      `Quick Benchmark (${tokenCount} tokens)`,
      tokens,
      options
    );
  }

  /**
   * Run a series of benchmarks to test scalability
   */
  async runScalabilityTest(
    sizes: number[] = [10, 50, 100],
    options?: {
      parallel?: boolean;
      maxConcurrent?: number;
    }
  ): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];

    for (const size of sizes) {
      logger.info('benchmark', `Running scalability test with ${size} tokens`);
      
      const result = await this.runQuickBenchmark(size, options);
      results.push(result);

      // Pause between tests
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return results;
  }

  /**
   * Compare two benchmark results
   */
  compare(before: BenchmarkResult, after: BenchmarkResult): ComparisonReport {
    const improvements = {
      avgDurationPercent: this.percentChange(before.avgDuration, after.avgDuration),
      p95DurationPercent: this.percentChange(before.p95Duration, after.p95Duration),
      cacheHitRatePercent: ((after.cacheHitRate - before.cacheHitRate) / Math.max(before.cacheHitRate, 1)) * 100,
      throughputPercent: ((after.tokensPerSecond - before.tokensPerSecond) / before.tokensPerSecond) * 100,
      memoryUsagePercent: this.percentChange(before.memoryPeakMB, after.memoryPeakMB),
    };

    const summary = this.generateComparisonSummary(improvements);

    return {
      before,
      after,
      improvements,
      summary,
    };
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    if (this.results.length === 0) {
      return 'No benchmark results available';
    }

    const lines: string[] = [];
    lines.push('=== PERFORMANCE BENCHMARK REPORT ===\n');

    for (const result of this.results) {
      lines.push(`Test: ${result.testName}`);
      lines.push(`Date: ${new Date(result.timestamp).toLocaleString()}`);
      lines.push(`Tokens: ${result.totalTokens} (${result.successfulAnalyses} success, ${result.failedAnalyses} failed)`);
      lines.push(`Duration: ${result.totalDuration}ms total, ${result.avgDuration}ms avg`);
      lines.push(`Percentiles: p50=${result.p50Duration}ms, p95=${result.p95Duration}ms, p99=${result.p99Duration}ms`);
      lines.push(`Cache: ${result.cacheHitRate}% hit rate (${result.cacheHits} hits, ${result.cacheMisses} misses)`);
      lines.push(`Memory: ${result.memoryStartMB}MB → ${result.memoryEndMB}MB (peak: ${result.memoryPeakMB}MB)`);
      lines.push(`Throughput: ${result.tokensPerSecond} tokens/sec`);
      lines.push('---\n');
    }

    return lines.join('\n');
  }

  /**
   * Save report to file
   */
  async saveReport(filename: string): Promise<void> {
    const report = this.generateReport();
    const filepath = path.join(process.cwd(), 'benchmarks', filename);
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, report);
    
    logger.info('benchmark', `Report saved to ${filepath}`);
  }

  /**
   * Save results as JSON
   */
  async saveResultsJSON(filename: string): Promise<void> {
    const filepath = path.join(process.cwd(), 'benchmarks', filename);
    
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, JSON.stringify(this.results, null, 2));
    
    logger.info('benchmark', `Results saved to ${filepath}`);
  }

  /**
   * Get all results
   */
  getResults(): BenchmarkResult[] {
    return [...this.results];
  }

  /**
   * Clear results
   */
  clearResults(): void {
    this.results = [];
  }

  // ============================================
  // Private Methods
  // ============================================

  private generateSyntheticTokens(count: number): Array<{ mint: string; pool: PoolInfo }> {
    const tokens: Array<{ mint: string; pool: PoolInfo }> = [];

    for (let i = 0; i < count; i++) {
      const mint = this.generateRandomMint();
      const pool: PoolInfo = {
        address: this.generateRandomMint(),
        tokenMint: mint,
        baseMint: mint,
        quoteMint: 'So11111111111111111111111111111111111111112', // SOL
        baseReserve: Math.random() * 1000000,
        quoteReserve: Math.random() * 100,
        lpMint: this.generateRandomMint(),
        source: 'raydium' as const,
        createdAt: new Date(),
      };

      tokens.push({ mint, pool });
    }

    return tokens;
  }

  private generateRandomMint(): string {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < 44; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private percentChange(before: number, after: number): number {
    if (before === 0) return 0;
    return Math.round(((after - before) / before) * 10000) / 100;
  }

  private generateComparisonSummary(improvements: ComparisonReport['improvements']): string {
    const parts: string[] = [];

    if (improvements.avgDurationPercent < -5) {
      parts.push(`✅ ${Math.abs(improvements.avgDurationPercent).toFixed(1)}% faster avg response`);
    } else if (improvements.avgDurationPercent > 5) {
      parts.push(`❌ ${improvements.avgDurationPercent.toFixed(1)}% slower avg response`);
    }

    if (improvements.cacheHitRatePercent > 10) {
      parts.push(`✅ ${improvements.cacheHitRatePercent.toFixed(1)}% better cache hit rate`);
    }

    if (improvements.throughputPercent > 10) {
      parts.push(`✅ ${improvements.throughputPercent.toFixed(1)}% better throughput`);
    }

    if (improvements.memoryUsagePercent < -10) {
      parts.push(`✅ ${Math.abs(improvements.memoryUsagePercent).toFixed(1)}% less memory`);
    } else if (improvements.memoryUsagePercent > 10) {
      parts.push(`⚠️  ${improvements.memoryUsagePercent.toFixed(1)}% more memory`);
    }

    return parts.length > 0 ? parts.join(', ') : 'No significant changes';
  }

  private logResult(result: BenchmarkResult): void {
    logger.info('benchmark', `✅ ${result.successfulAnalyses}/${result.totalTokens} tokens analyzed`);
    logger.info('benchmark', `⏱️  Avg: ${result.avgDuration}ms, P95: ${result.p95Duration}ms`);
    logger.info('benchmark', `💾 Cache hit rate: ${result.cacheHitRate}%`);
    logger.info('benchmark', `🚀 Throughput: ${result.tokensPerSecond} tokens/sec`);
    logger.info('benchmark', `💻 Memory: ${result.memoryPeakMB}MB peak`);
  }
}

// Singleton instance
export const benchmarkEngine = new BenchmarkEngine();
