import { analyzeToken } from './tokenAnalyzer';
import { rateLimitService } from '../services/ratelimit';
import type { TokenAnalysis, PoolInfo } from '../types';
import { logger } from '../utils/logger';

/**
 * Rate limiter for parallel operations
 */
class ParallelRateLimiter {
  private queue: Array<() => Promise<void>> = [];
  private activeCount = 0;
  private readonly maxConcurrent: number;
  private readonly delayMs: number;

  constructor(maxConcurrent: number = 5, delayMs: number = 100) {
    this.maxConcurrent = maxConcurrent;
    this.delayMs = delayMs;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    while (this.activeCount >= this.maxConcurrent) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    this.activeCount++;
    
    try {
      // Add small delay between requests to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, this.delayMs));
      const result = await fn();
      return result;
    } finally {
      this.activeCount--;
    }
  }

  getActiveCount(): number {
    return this.activeCount;
  }
}

// Singleton rate limiter
const parallelLimiter = new ParallelRateLimiter(5, 200);

/**
 * Analyze multiple tokens in parallel with rate limiting
 * @param tokens Array of {mint: string, pool: PoolInfo} objects
 * @param options Configuration options
 * @returns Map of mint -> TokenAnalysis (only successful analyses)
 */
export async function analyzeTokensBatch(
  tokens: Array<{ mint: string; pool: PoolInfo }>,
  options: {
    maxConcurrent?: number;
    timeoutMs?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<Map<string, TokenAnalysis>> {
  const {
    maxConcurrent = 5,
    timeoutMs = 30000, // 30s per token
    onProgress,
  } = options;

  const results = new Map<string, TokenAnalysis>();
  const limiter = new ParallelRateLimiter(maxConcurrent, 200);
  
  let completed = 0;
  const total = tokens.length;

  logger.info('parallel', `Starting batch analysis of ${total} tokens (${maxConcurrent} concurrent)`);

  // Create analysis promises with individual error handling
  const promises = tokens.map(async ({ mint, pool }) => {
    try {
      const result = await limiter.execute(async () => {
        // Wrap with timeout
        return await Promise.race([
          analyzeToken(mint, pool),
          new Promise<null>((resolve) => 
            setTimeout(() => resolve(null), timeoutMs)
          ),
        ]);
      });

      if (result) {
        results.set(mint, result);
      }

      completed++;
      if (onProgress) {
        onProgress(completed, total);
      }

      return result;
    } catch (error) {
      logger.error('parallel', `Failed to analyze ${mint}: ${error}`);
      completed++;
      if (onProgress) {
        onProgress(completed, total);
      }
      return null;
    }
  });

  // Wait for all promises to complete
  await Promise.allSettled(promises);

  logger.info('parallel', `Batch analysis complete: ${results.size}/${total} successful`);

  return results;
}

/**
 * Analyze tokens in batches with progress tracking
 * Useful for large sets of tokens
 */
export async function analyzeTokensInBatches(
  tokens: Array<{ mint: string; pool: PoolInfo }>,
  options: {
    batchSize?: number;
    maxConcurrent?: number;
    delayBetweenBatches?: number;
    onBatchComplete?: (batchIndex: number, totalBatches: number) => void;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<Map<string, TokenAnalysis>> {
  const {
    batchSize = 10,
    maxConcurrent = 5,
    delayBetweenBatches = 1000,
    onBatchComplete,
    onProgress,
  } = options;

  const results = new Map<string, TokenAnalysis>();
  const batches: Array<Array<{ mint: string; pool: PoolInfo }>> = [];

  // Split into batches
  for (let i = 0; i < tokens.length; i += batchSize) {
    batches.push(tokens.slice(i, i + batchSize));
  }

  logger.info('parallel', `Processing ${tokens.length} tokens in ${batches.length} batches`);

  // Process batches sequentially
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    
    logger.info('parallel', `Processing batch ${i + 1}/${batches.length} (${batch.length} tokens)`);

    const batchResults = await analyzeTokensBatch(batch, {
      maxConcurrent,
      onProgress,
    });

    // Merge results
    for (const [mint, analysis] of batchResults) {
      results.set(mint, analysis);
    }

    if (onBatchComplete) {
      onBatchComplete(i + 1, batches.length);
    }

    // Delay between batches (except after last batch)
    if (i < batches.length - 1 && delayBetweenBatches > 0) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }

  logger.info('parallel', `All batches complete: ${results.size}/${tokens.length} successful`);

  return results;
}

/**
 * Quick parallel analysis with minimal data
 * Returns only basic info (safe/unsafe) without full analysis
 */
export async function quickBatchCheck(
  mints: string[],
  options: {
    maxConcurrent?: number;
  } = {}
): Promise<Map<string, { safe: boolean; reason?: string }>> {
  const { maxConcurrent = 10 } = options;
  const results = new Map<string, { safe: boolean; reason?: string }>();
  const limiter = new ParallelRateLimiter(maxConcurrent, 100);

  const { quickAnalysis } = await import('./tokenAnalyzer');

  const promises = mints.map(async (mint) => {
    try {
      const result = await limiter.execute(async () => {
        return await quickAnalysis(mint);
      });

      if (result) {
        results.set(mint, result);
      }
    } catch (error) {
      logger.error('parallel', `Quick check failed for ${mint}: ${error}`);
    }
  });

  await Promise.allSettled(promises);

  return results;
}

/**
 * Get current parallel processing stats
 */
export function getParallelStats(): {
  activeAnalyses: number;
  maxConcurrent: number;
} {
  return {
    activeAnalyses: parallelLimiter.getActiveCount(),
    maxConcurrent: 5,
  };
}
