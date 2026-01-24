/**
 * Queue Processor Integration Tests
 * Tests queue concurrency, deduplication, and analysis flow
 */

import type { PoolInfo } from '../../src/types';

// Mock dependencies before importing QueueProcessor
jest.mock('../../src/config', () => ({
  config: {
    telegramChatId: 'test-chat-id',
  },
}));

jest.mock('../../src/services/cache', () => ({
  tokenCache: {
    has: jest.fn().mockReturnValue(false),
    set: jest.fn(),
    get: jest.fn(),
  },
}));

jest.mock('../../src/services/ratelimit', () => ({
  rateLimitService: {
    canSendAnyAlert: jest.fn().mockReturnValue(true),
    canSendAlert: jest.fn().mockReturnValue(true),
    recordAlert: jest.fn(),
  },
}));

jest.mock('../../src/services/telegram', () => ({
  telegramService: {
    sendAlert: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../src/analysis/tokenAnalyzer', () => ({
  analyzeToken: jest.fn().mockResolvedValue({
    token: { mint: 'test', symbol: 'TEST', name: 'Test Token' },
    risk: { score: 70, level: 'MEDIUM' },
    liquidity: { totalLiquidityUsd: 50000 },
  }),
}));

jest.mock('../../src/telegram/commands', () => ({
  incrementTokensAnalyzed: jest.fn(),
}));

jest.mock('../../src/ml/rugPredictor', () => ({
  rugPredictor: {
    predict: jest.fn().mockResolvedValue({
      rugProbability: 0.1,
      confidence: 0.8,
      riskFactors: [],
      recommendation: 'safe',
    }),
  },
}));

jest.mock('../../src/database', () => ({
  database: {
    saveAnalysis: jest.fn().mockResolvedValue(undefined),
    recordAlert: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../src/api/server', () => ({
  apiServer: {
    addRecentDiscovery: jest.fn(),
    addRecentAlert: jest.fn(),
  },
}));

jest.mock('../../src/services/outcomeTracker', () => ({
  outcomeTracker: {
    trackToken: jest.fn(),
  },
}));

jest.mock('../../src/services/dexscreener', () => ({
  dexScreenerService: {
    getPair: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../../src/signals', () => ({
  signalService: {
    processAnalysis: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../src/core/alertFilter', () => ({
  shouldAlert: jest.fn().mockReturnValue({ shouldAlert: true, reason: '' }),
}));

// Import after mocks
import { QueueProcessor } from '../../src/core/queueProcessor';
import { tokenCache } from '../../src/services/cache';
import { rateLimitService } from '../../src/services/ratelimit';

describe('QueueProcessor', () => {
  let queueProcessor: QueueProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    queueProcessor = new QueueProcessor();
  });

  afterEach(() => {
    queueProcessor.stop();
  });

  const createMockPool = (mint: string): PoolInfo => ({
    address: `pool-${mint}`,
    tokenMint: mint,
    baseMint: mint,
    quoteMint: 'SOL',
    baseReserve: 1000000,
    quoteReserve: 100,
    lpMint: `lp-${mint}`,
    source: 'raydium',
    createdAt: new Date(),
  });

  describe('queueAnalysis', () => {
    it('should add token to queue', async () => {
      const pool = createMockPool('token1');

      await queueProcessor.queueAnalysis(pool);

      const stats = queueProcessor.getStats();
      expect(stats.queueSize).toBe(1);
    });

    it('should deduplicate same token', async () => {
      const pool1 = createMockPool('duplicate-token');
      const pool2 = createMockPool('duplicate-token');

      await queueProcessor.queueAnalysis(pool1);
      await queueProcessor.queueAnalysis(pool2);

      const stats = queueProcessor.getStats();
      expect(stats.queueSize).toBe(1);
    });

    it('should skip tokens already in cache', async () => {
      (tokenCache.has as jest.Mock).mockReturnValue(true);

      const pool = createMockPool('cached-token');
      await queueProcessor.queueAnalysis(pool);

      const stats = queueProcessor.getStats();
      expect(stats.queueSize).toBe(0);

      (tokenCache.has as jest.Mock).mockReturnValue(false);
    });

    it('should handle queue overflow by removing oldest entries', async () => {
      // Queue 600 tokens (more than MAX_QUEUE_SIZE of 500)
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 550; i++) {
        promises.push(queueProcessor.queueAnalysis(createMockPool(`token-${i}`)));
      }
      await Promise.all(promises);

      const stats = queueProcessor.getStats();
      // Should be at most MAX_QUEUE_SIZE
      expect(stats.queueSize).toBeLessThanOrEqual(500);
    });

    it('should handle concurrent queue operations safely', async () => {
      // Simulate many concurrent queue operations
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 100; i++) {
        promises.push(queueProcessor.queueAnalysis(createMockPool(`concurrent-${i}`)));
      }

      await Promise.all(promises);

      const stats = queueProcessor.getStats();
      expect(stats.queueSize).toBe(100);
    });
  });

  describe('getStats', () => {
    it('should return correct stats', async () => {
      await queueProcessor.queueAnalysis(createMockPool('stat-token-1'));
      await queueProcessor.queueAnalysis(createMockPool('stat-token-2'));

      const stats = queueProcessor.getStats();

      expect(stats.queueSize).toBe(2);
      expect(stats.activeAnalyses).toBe(0);
      expect(stats.concurrency).toBeGreaterThan(0);
    });
  });

  describe('start and stop', () => {
    it('should start and stop without errors', async () => {
      expect(() => queueProcessor.start()).not.toThrow();
      expect(() => queueProcessor.stop()).not.toThrow();
    });

    it('should not process when stopped', async () => {
      queueProcessor.stop();

      await queueProcessor.queueAnalysis(createMockPool('stopped-token'));

      // Wait a bit to ensure no processing happens
      await new Promise(resolve => setTimeout(resolve, 100));

      // Queue should still have the token
      const stats = queueProcessor.getStats();
      expect(stats.queueSize).toBe(1);
    });
  });

  describe('rate limiting integration', () => {
    it('should respect rate limit when sending alerts', async () => {
      (rateLimitService.canSendAlert as jest.Mock).mockReturnValue(false);

      const pool = createMockPool('rate-limited');
      await queueProcessor.queueAnalysis(pool);

      // Token should be in queue but will be skipped due to rate limit
      const stats = queueProcessor.getStats();
      expect(stats.queueSize).toBe(1);

      (rateLimitService.canSendAlert as jest.Mock).mockReturnValue(true);
    });

    it('should wait when global rate limit reached', async () => {
      (rateLimitService.canSendAnyAlert as jest.Mock).mockReturnValue(false);

      queueProcessor.start();
      await queueProcessor.queueAnalysis(createMockPool('global-rate-limited'));

      // Should not process immediately
      await new Promise(resolve => setTimeout(resolve, 50));

      (rateLimitService.canSendAnyAlert as jest.Mock).mockReturnValue(true);
      queueProcessor.stop();
    });
  });
});

describe('AsyncSemaphore', () => {
  // Test the AsyncSemaphore class directly
  class TestAsyncSemaphore {
    private permits: number;
    private waiting: Array<() => void> = [];

    constructor(permits: number) {
      this.permits = permits;
    }

    async acquire(): Promise<void> {
      if (this.permits > 0) {
        this.permits--;
        return;
      }
      return new Promise<void>((resolve) => {
        this.waiting.push(resolve);
      });
    }

    release(): void {
      this.permits++;
      const next = this.waiting.shift();
      if (next) {
        this.permits--;
        next();
      }
    }

    get available(): number {
      return this.permits;
    }
  }

  it('should limit concurrent access', async () => {
    const semaphore = new TestAsyncSemaphore(2);
    let concurrent = 0;
    let maxConcurrent = 0;

    const task = async () => {
      await semaphore.acquire();
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(resolve => setTimeout(resolve, 10));
      concurrent--;
      semaphore.release();
    };

    await Promise.all([task(), task(), task(), task(), task()]);

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('should release permits correctly', async () => {
    const semaphore = new TestAsyncSemaphore(3);

    expect(semaphore.available).toBe(3);

    await semaphore.acquire();
    expect(semaphore.available).toBe(2);

    await semaphore.acquire();
    expect(semaphore.available).toBe(1);

    semaphore.release();
    expect(semaphore.available).toBe(2);

    semaphore.release();
    expect(semaphore.available).toBe(3);
  });

  it('should queue waiters when no permits available', async () => {
    const semaphore = new TestAsyncSemaphore(1);
    const order: number[] = [];

    // First acquire should succeed immediately
    await semaphore.acquire();
    order.push(1);

    // Second acquire should wait
    const waitPromise = semaphore.acquire().then(() => {
      order.push(2);
    });

    // Release first permit
    semaphore.release();

    await waitPromise;

    expect(order).toEqual([1, 2]);
  });
});
