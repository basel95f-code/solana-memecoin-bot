/**
 * Retry utility with exponential backoff
 * Provides resilient API calls across all services
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
  onRetry?: (error: Error, attempt: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'retryableErrors'>> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

// Common retryable error patterns
const DEFAULT_RETRYABLE_ERRORS = [
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'socket hang up',
  'network timeout',
  'rate limit',
  '429',
  '502',
  '503',
  '504',
];

function isRetryableError(error: Error, retryablePatterns: string[]): boolean {
  const errorString = `${error.name} ${error.message} ${(error as any).code || ''}`.toLowerCase();
  return retryablePatterns.some(pattern => errorString.includes(pattern.toLowerCase()));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const retryableErrors = options.retryableErrors || DEFAULT_RETRYABLE_ERRORS;

  let lastError: Error;
  let delay = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry
      const isLastAttempt = attempt > opts.maxRetries;
      const isRetryable = isRetryableError(lastError, retryableErrors);

      if (isLastAttempt || !isRetryable) {
        throw lastError;
      }

      // Call onRetry callback if provided
      if (opts.onRetry) {
        opts.onRetry(lastError, attempt);
      }

      // Wait before retrying with exponential backoff
      await sleep(Math.min(delay, opts.maxDelayMs));
      delay *= opts.backoffMultiplier;
    }
  }

  throw lastError!;
}

/**
 * Create a retry wrapper for axios-style requests
 */
export function createRetryableAxios(axiosInstance: any, options: RetryOptions = {}) {
  return {
    async get<T>(url: string, config?: any): Promise<T> {
      const response = await withRetry<{ data: T }>(() => axiosInstance.get(url, config), {
        ...options,
        onRetry: (error, attempt) => {
          console.log(`Retry ${attempt} for GET ${url}: ${error.message}`);
          options.onRetry?.(error, attempt);
        },
      });
      return response.data;
    },
    async post<T>(url: string, data?: any, config?: any): Promise<T> {
      const response = await withRetry<{ data: T }>(() => axiosInstance.post(url, data, config), {
        ...options,
        onRetry: (error, attempt) => {
          console.log(`Retry ${attempt} for POST ${url}: ${error.message}`);
          options.onRetry?.(error, attempt);
        },
      });
      return response.data;
    },
  };
}

/**
 * Circuit breaker for failing endpoints
 */
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailure: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private threshold: number = 5,
    private resetTimeMs: number = 60000
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should be reset
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.resetTimeMs) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.failures >= this.threshold) {
      this.state = 'open';
      console.warn(`Circuit breaker opened after ${this.failures} failures`);
    }
  }

  isOpen(): boolean {
    return this.state === 'open';
  }

  getState(): string {
    return this.state;
  }

  reset(): void {
    this.failures = 0;
    this.state = 'closed';
  }
}

/**
 * Rate limiter for API calls
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number = 10,
    private refillRate: number = 1, // tokens per second
    private refillIntervalMs: number = 1000
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor(elapsed / this.refillIntervalMs) * this.refillRate;

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  async acquire(): Promise<void> {
    this.refill();

    while (this.tokens < 1) {
      await sleep(this.refillIntervalMs);
      this.refill();
    }

    this.tokens--;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    return fn();
  }

  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }
}

/**
 * Combined retry + circuit breaker + rate limiter
 */
export class ResilientExecutor {
  private circuitBreaker: CircuitBreaker;
  private rateLimiter: RateLimiter;
  private retryOptions: RetryOptions;

  constructor(options: {
    circuitBreaker?: { threshold?: number; resetTimeMs?: number };
    rateLimiter?: { maxTokens?: number; refillRate?: number };
    retry?: RetryOptions;
  } = {}) {
    this.circuitBreaker = new CircuitBreaker(
      options.circuitBreaker?.threshold,
      options.circuitBreaker?.resetTimeMs
    );
    this.rateLimiter = new RateLimiter(
      options.rateLimiter?.maxTokens,
      options.rateLimiter?.refillRate
    );
    this.retryOptions = options.retry || {};
  }

  async execute<T>(fn: () => Promise<T>, label?: string): Promise<T> {
    return this.rateLimiter.execute(() =>
      this.circuitBreaker.execute(() =>
        withRetry(fn, {
          ...this.retryOptions,
          onRetry: (error, attempt) => {
            console.log(`[${label || 'ResilientExecutor'}] Retry ${attempt}: ${error.message}`);
            this.retryOptions.onRetry?.(error, attempt);
          },
        })
      )
    );
  }

  isCircuitOpen(): boolean {
    return this.circuitBreaker.isOpen();
  }

  resetCircuit(): void {
    this.circuitBreaker.reset();
  }
}
