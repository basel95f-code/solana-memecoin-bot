/**
 * Retry Service
 * Provides retry logic with exponential backoff for API calls
 */

import { logger } from '../utils/logger';

// ============================================
// Types
// ============================================

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
  onRetry?: (error: Error, attempt: number) => void;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenRequests: number;
}

type CircuitState = 'closed' | 'open' | 'half-open';

// ============================================
// Default Configurations
// ============================================

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'socket hang up',
    'network error',
    '429',
    '503',
    '502',
    '504',
  ],
};

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60000, // 1 minute
  halfOpenRequests: 3,
};

// ============================================
// Retry Service
// ============================================

export class RetryService {
  private config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /**
   * Execute a function with retry logic
   */
  async execute<T>(
    fn: () => Promise<T>,
    context: string,
    overrideConfig?: Partial<RetryConfig>
  ): Promise<T> {
    const config = { ...this.config, ...overrideConfig };
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        const errorMessage = lastError.message || String(lastError);

        // Check if error is retryable
        const isRetryable = this.isRetryableError(errorMessage, config.retryableErrors);

        if (!isRetryable || attempt === config.maxRetries) {
          logger.debug('RetryService', `${context}: Failed after ${attempt + 1} attempts - ${errorMessage}`);
          throw lastError;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(attempt, config);

        logger.debug('RetryService',
          `${context}: Attempt ${attempt + 1} failed, retrying in ${delay}ms - ${errorMessage}`
        );

        // Call onRetry callback if provided
        if (config.onRetry) {
          config.onRetry(lastError, attempt + 1);
        }

        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(errorMessage: string, retryableErrors: string[]): boolean {
    const lowerMessage = errorMessage.toLowerCase();
    return retryableErrors.some(err => lowerMessage.includes(err.toLowerCase()));
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private calculateDelay(attempt: number, config: RetryConfig): number {
    const exponentialDelay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);
    const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
    const delay = Math.min(exponentialDelay + jitter, config.maxDelayMs);
    return Math.floor(delay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================
// Circuit Breaker
// ============================================

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number = 0;
  private config: CircuitBreakerConfig;
  private name: string;

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should transition from open to half-open
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
        this.state = 'half-open';
        this.successes = 0;
        logger.info('CircuitBreaker', `${this.name}: Transitioning to half-open`);
      } else {
        throw new Error(`Circuit breaker ${this.name} is open`);
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

  /**
   * Record a successful call
   */
  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= this.config.halfOpenRequests) {
        this.state = 'closed';
        this.failures = 0;
        logger.info('CircuitBreaker', `${this.name}: Circuit closed`);
      }
    } else if (this.state === 'closed') {
      this.failures = 0;
    }
  }

  /**
   * Record a failed call
   */
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      this.state = 'open';
      logger.warn('CircuitBreaker', `${this.name}: Circuit opened (half-open failed)`);
    } else if (this.failures >= this.config.failureThreshold) {
      this.state = 'open';
      logger.warn('CircuitBreaker', `${this.name}: Circuit opened (threshold reached)`);
    }
  }

  /**
   * Get circuit breaker state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit breaker stats
   */
  getStats(): {
    state: CircuitState;
    failures: number;
    lastFailureTime: number;
  } {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    logger.info('CircuitBreaker', `${this.name}: Manually reset`);
  }
}

// ============================================
// Health Monitor
// ============================================

export class HealthMonitor {
  private services: Map<string, {
    healthy: boolean;
    lastCheck: number;
    consecutiveFailures: number;
    circuitBreaker: CircuitBreaker;
  }> = new Map();

  private checkInterval: NodeJS.Timeout | null = null;
  private healthChecks: Map<string, () => Promise<boolean>> = new Map();

  /**
   * Register a service for health monitoring
   */
  registerService(name: string, healthCheck: () => Promise<boolean>): void {
    this.healthChecks.set(name, healthCheck);
    this.services.set(name, {
      healthy: true,
      lastCheck: 0,
      consecutiveFailures: 0,
      circuitBreaker: new CircuitBreaker(name),
    });
    logger.debug('HealthMonitor', `Registered service: ${name}`);
  }

  /**
   * Start periodic health checks
   */
  start(intervalMs: number = 30000): void {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      this.checkAllServices().catch(err => {
        logger.silentError('HealthMonitor', 'Health check failed', err as Error);
      });
    }, intervalMs);

    logger.info('HealthMonitor', `Started with ${intervalMs}ms interval`);
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check all registered services
   */
  async checkAllServices(): Promise<void> {
    for (const [name, healthCheck] of this.healthChecks) {
      try {
        const service = this.services.get(name)!;
        const isHealthy = await healthCheck();

        service.healthy = isHealthy;
        service.lastCheck = Date.now();

        if (isHealthy) {
          service.consecutiveFailures = 0;
        } else {
          service.consecutiveFailures++;
          logger.warn('HealthMonitor', `${name}: Health check failed (${service.consecutiveFailures} consecutive)`);
        }
      } catch (error) {
        const service = this.services.get(name)!;
        service.healthy = false;
        service.lastCheck = Date.now();
        service.consecutiveFailures++;
        logger.warn('HealthMonitor', `${name}: Health check error - ${(error as Error).message}`);
      }
    }
  }

  /**
   * Get health status of all services
   */
  getStatus(): Map<string, {
    healthy: boolean;
    lastCheck: number;
    consecutiveFailures: number;
    circuitState: CircuitState;
  }> {
    const status = new Map();
    for (const [name, service] of this.services) {
      status.set(name, {
        healthy: service.healthy,
        lastCheck: service.lastCheck,
        consecutiveFailures: service.consecutiveFailures,
        circuitState: service.circuitBreaker.getState(),
      });
    }
    return status;
  }

  /**
   * Check if a specific service is healthy
   */
  isHealthy(name: string): boolean {
    const service = this.services.get(name);
    return service?.healthy ?? false;
  }

  /**
   * Get circuit breaker for a service
   */
  getCircuitBreaker(name: string): CircuitBreaker | undefined {
    return this.services.get(name)?.circuitBreaker;
  }
}

// ============================================
// Exports
// ============================================

export const retryService = new RetryService();
export const healthMonitor = new HealthMonitor();
