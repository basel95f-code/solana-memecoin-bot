import { logger } from '../utils/logger';
import { cacheManager } from '../cache';

/**
 * Performance metrics tracked by the system
 */
export interface PerformanceMetrics {
  // Response times
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  p50ResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;

  // Cache metrics
  cacheHitRate: number;
  cacheHits: number;
  cacheMisses: number;

  // Memory usage
  memoryUsedMB: number;
  memoryLimitMB: number;
  memoryUsagePercent: number;

  // Analysis metrics
  totalAnalyses: number;
  successfulAnalyses: number;
  failedAnalyses: number;
  successRate: number;

  // Timing breakdown
  slowOperations: Array<{
    operation: string;
    duration: number;
    timestamp: number;
  }>;
}

/**
 * Performance monitor for tracking analysis response times and cache effectiveness
 */
export class PerformanceMonitor {
  private responseTimes: number[] = [];
  private cacheHits = 0;
  private cacheMisses = 0;
  private totalAnalyses = 0;
  private successfulAnalyses = 0;
  private failedAnalyses = 0;
  private slowOperations: Array<{
    operation: string;
    duration: number;
    timestamp: number;
  }> = [];
  private readonly maxHistorySize = 1000;
  private readonly slowThresholdMs = 3000;
  private readonly memoryLimitMB = 500;

  /**
   * Track an analysis operation
   */
  trackAnalysis(
    operation: string,
    startTime: number,
    success: boolean
  ): void {
    const duration = Date.now() - startTime;
    this.responseTimes.push(duration);
    
    // Keep only recent times
    if (this.responseTimes.length > this.maxHistorySize) {
      this.responseTimes.shift();
    }

    this.totalAnalyses++;
    if (success) {
      this.successfulAnalyses++;
    } else {
      this.failedAnalyses++;
    }

    // Track slow operations
    if (duration > this.slowThresholdMs) {
      logger.warn('performance', `Slow operation: ${operation} took ${duration}ms`);
      
      this.slowOperations.push({
        operation,
        duration,
        timestamp: Date.now(),
      });

      // Keep only recent slow operations (last 100)
      if (this.slowOperations.length > 100) {
        this.slowOperations.shift();
      }
    }
  }

  /**
   * Track cache hit
   */
  trackCacheHit(): void {
    this.cacheHits++;
  }

  /**
   * Track cache miss
   */
  trackCacheMiss(): void {
    this.cacheMisses++;
  }

  /**
   * Get current performance metrics
   */
  getMetrics(): PerformanceMetrics {
    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    const len = sorted.length;

    const avgResponseTime = len > 0
      ? sorted.reduce((sum, t) => sum + t, 0) / len
      : 0;

    const p50Index = Math.floor(len * 0.5);
    const p95Index = Math.floor(len * 0.95);
    const p99Index = Math.floor(len * 0.99);

    const totalCacheRequests = this.cacheHits + this.cacheMisses;
    const cacheHitRate = totalCacheRequests > 0
      ? (this.cacheHits / totalCacheRequests) * 100
      : 0;

    const memory = process.memoryUsage();
    const memoryUsedMB = memory.heapUsed / 1024 / 1024;
    const memoryUsagePercent = (memoryUsedMB / this.memoryLimitMB) * 100;

    const successRate = this.totalAnalyses > 0
      ? (this.successfulAnalyses / this.totalAnalyses) * 100
      : 0;

    return {
      avgResponseTime: Math.round(avgResponseTime),
      minResponseTime: len > 0 ? sorted[0] : 0,
      maxResponseTime: len > 0 ? sorted[len - 1] : 0,
      p50ResponseTime: len > 0 ? sorted[p50Index] : 0,
      p95ResponseTime: len > 0 ? sorted[p95Index] : 0,
      p99ResponseTime: len > 0 ? sorted[p99Index] : 0,
      
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,

      memoryUsedMB: Math.round(memoryUsedMB * 100) / 100,
      memoryLimitMB: this.memoryLimitMB,
      memoryUsagePercent: Math.round(memoryUsagePercent * 100) / 100,

      totalAnalyses: this.totalAnalyses,
      successfulAnalyses: this.successfulAnalyses,
      failedAnalyses: this.failedAnalyses,
      successRate: Math.round(successRate * 100) / 100,

      slowOperations: this.slowOperations.slice(-10), // Last 10 slow operations
    };
  }

  /**
   * Get detailed cache statistics
   */
  async getCacheStats(): Promise<any> {
    return await cacheManager.getStats();
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.responseTimes = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.totalAnalyses = 0;
    this.successfulAnalyses = 0;
    this.failedAnalyses = 0;
    this.slowOperations = [];
    logger.info('performance', 'Metrics reset');
  }

  /**
   * Log current metrics
   */
  logMetrics(): void {
    const metrics = this.getMetrics();
    
    logger.info('performance', '=== Performance Metrics ===');
    logger.info('performance', `Response Time: avg=${metrics.avgResponseTime}ms p95=${metrics.p95ResponseTime}ms p99=${metrics.p99ResponseTime}ms`);
    logger.info('performance', `Cache Hit Rate: ${metrics.cacheHitRate}% (${metrics.cacheHits} hits, ${metrics.cacheMisses} misses)`);
    logger.info('performance', `Memory Usage: ${metrics.memoryUsedMB}MB / ${metrics.memoryLimitMB}MB (${metrics.memoryUsagePercent}%)`);
    logger.info('performance', `Analyses: ${metrics.totalAnalyses} total, ${metrics.successRate}% success rate`);
    
    if (metrics.slowOperations.length > 0) {
      logger.warn('performance', `Slow Operations: ${metrics.slowOperations.length} operations >${this.slowThresholdMs}ms`);
    }
  }

  /**
   * Check if memory usage is high
   */
  isMemoryHigh(): boolean {
    const metrics = this.getMetrics();
    return metrics.memoryUsagePercent > 80;
  }

  /**
   * Check if cache hit rate is low
   */
  isCacheHitRateLow(): boolean {
    const metrics = this.getMetrics();
    return metrics.cacheHitRate < 50 && (metrics.cacheHits + metrics.cacheMisses) > 100;
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

/**
 * Utility function to measure and track operation time
 */
export async function measureOperation<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  
  try {
    const result = await fn();
    performanceMonitor.trackAnalysis(operation, startTime, true);
    return result;
  } catch (error) {
    performanceMonitor.trackAnalysis(operation, startTime, false);
    throw error;
  }
}
