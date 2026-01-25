/**
 * Resilient API Client
 * Centralized robust API handling with retry, circuit breaker, rate limiting, caching, and validation
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { ResilientExecutor, CircuitBreaker, RateLimiter } from '../utils/retry';
import { logger } from '../utils/logger';

// ============================================
// Types
// ============================================

export interface ResilientApiConfig {
  name: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
  rateLimit?: { maxTokens: number; refillRate: number };
  circuitBreaker?: { threshold: number; resetTimeMs: number };
  cacheTTL?: number;
  headers?: Record<string, string>;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  cached: boolean;
  timestamp: number;
}

// ============================================
// Resilient API Client
// ============================================

export class ResilientApiClient {
  private client: AxiosInstance;
  private executor: ResilientExecutor;
  private cache: Map<string, CacheEntry<any>> = new Map();
  private config: Required<ResilientApiConfig>;
  private circuitBreaker: CircuitBreaker;
  private rateLimiter: RateLimiter;

  constructor(config: ResilientApiConfig) {
    this.config = {
      name: config.name,
      baseURL: config.baseURL || '',
      timeout: config.timeout || 15000,
      maxRetries: config.maxRetries || 3,
      rateLimit: config.rateLimit || { maxTokens: 10, refillRate: 2 },
      circuitBreaker: config.circuitBreaker || { threshold: 5, resetTimeMs: 60000 },
      cacheTTL: config.cacheTTL || 300000, // 5 minutes default
      headers: config.headers || {},
    };

    // Create axios instance
    this.client = axios.create({
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...this.config.headers,
      },
    });

    // Create rate limiter and circuit breaker
    this.rateLimiter = new RateLimiter(
      this.config.rateLimit.maxTokens,
      this.config.rateLimit.refillRate
    );

    this.circuitBreaker = new CircuitBreaker(
      this.config.circuitBreaker.threshold,
      this.config.circuitBreaker.resetTimeMs
    );

    // Create resilient executor
    this.executor = new ResilientExecutor({
      circuitBreaker: this.config.circuitBreaker,
      rateLimiter: this.config.rateLimit,
      retry: {
        maxRetries: this.config.maxRetries,
        initialDelayMs: 500,
        maxDelayMs: 15000,
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
          '500',
          '502',
          '503',
          '504',
        ],
      },
    });
  }

  // ============================================
  // HTTP Methods
  // ============================================

  /**
   * GET request with full resilience features
   */
  async get<T>(
    url: string,
    options?: {
      cache?: boolean;
      cacheKey?: string;
      cacheTTL?: number;
      validator?: (data: any) => boolean;
      transform?: (data: any) => T;
      config?: AxiosRequestConfig;
    }
  ): Promise<ApiResponse<T>> {
    const cacheKey = options?.cacheKey || `GET:${url}`;
    const cacheTTL = options?.cacheTTL || this.config.cacheTTL;

    // Check cache first
    if (options?.cache !== false) {
      const cached = this.getCached<T>(cacheKey, cacheTTL);
      if (cached !== null) {
        return {
          data: cached,
          error: null,
          cached: true,
          timestamp: Date.now(),
        };
      }
    }

    // Execute request with resilience
    try {
      const response = await this.executor.execute(
        async () => {
          // Add timeout using AbortController
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

          try {
            const res = await this.client.get<any>(url, {
              ...options?.config,
              signal: controller.signal,
            });
            clearTimeout(timeoutId);

            // Validate status
            if (res.status < 200 || res.status >= 300) {
              throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }

            return res;
          } catch (error) {
            clearTimeout(timeoutId);
            throw error;
          }
        },
        `${this.config.name}:GET:${url}`
      );

      // Validate response data
      if (options?.validator && !options.validator(response.data)) {
        logger.warn(this.config.name, `Invalid response structure for GET ${url}`);
        return {
          data: null,
          error: 'Invalid response structure',
          cached: false,
          timestamp: Date.now(),
        };
      }

      // Transform data if transformer provided
      const data = options?.transform ? options.transform(response.data) : response.data;

      // Cache response
      if (options?.cache !== false) {
        this.setCache(cacheKey, data, cacheTTL);
      }

      return {
        data,
        error: null,
        cached: false,
        timestamp: Date.now(),
      };
    } catch (error) {
      return this.handleError<T>(error, `GET ${url}`);
    }
  }

  /**
   * POST request with full resilience features
   */
  async post<T>(
    url: string,
    data?: any,
    options?: {
      validator?: (data: any) => boolean;
      transform?: (data: any) => T;
      config?: AxiosRequestConfig;
    }
  ): Promise<ApiResponse<T>> {
    try {
      const response = await this.executor.execute(
        async () => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

          try {
            const res = await this.client.post<any>(url, data, {
              ...options?.config,
              signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (res.status < 200 || res.status >= 300) {
              throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }

            return res;
          } catch (error) {
            clearTimeout(timeoutId);
            throw error;
          }
        },
        `${this.config.name}:POST:${url}`
      );

      // Validate response
      if (options?.validator && !options.validator(response.data)) {
        logger.warn(this.config.name, `Invalid response structure for POST ${url}`);
        return {
          data: null,
          error: 'Invalid response structure',
          cached: false,
          timestamp: Date.now(),
        };
      }

      const responseData = options?.transform ? options.transform(response.data) : response.data;

      return {
        data: responseData,
        error: null,
        cached: false,
        timestamp: Date.now(),
      };
    } catch (error) {
      return this.handleError<T>(error, `POST ${url}`);
    }
  }

  // ============================================
  // Cache Management
  // ============================================

  private getCached<T>(key: string, ttl: number): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < ttl) {
      return entry.data as T;
    }
    if (entry) {
      this.cache.delete(key);
    }
    return null;
  }

  private setCache<T>(key: string, data: T, ttl: number): void {
    // Auto-cleanup: remove expired entries when cache gets large
    if (this.cache.size > 1000) {
      const now = Date.now();
      for (const [k, v] of this.cache.entries()) {
        if (now - v.timestamp > ttl) {
          this.cache.delete(k);
        }
      }
    }

    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clearCache(): void {
    this.cache.clear();
  }

  clearCachePattern(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  // ============================================
  // Error Handling
  // ============================================

  private handleError<T>(error: unknown, context: string): ApiResponse<T> {
    const axiosError = error as AxiosError;
    let errorMessage = 'Unknown error occurred';

    if (axiosError.response) {
      // Server responded with error status
      const status = axiosError.response.status;
      errorMessage = this.getErrorMessage(status, context);
      
      logger.error(
        this.config.name,
        `${context} failed with status ${status}: ${axiosError.message}`
      );
    } else if (axiosError.request) {
      // Request made but no response
      errorMessage = 'Unable to reach server. Please try again.';
      logger.error(this.config.name, `${context} - no response: ${axiosError.message}`);
    } else if (axiosError.message?.includes('timeout')) {
      // Timeout
      errorMessage = 'Request timed out. Please try again.';
      logger.error(this.config.name, `${context} - timeout`);
    } else if (this.circuitBreaker.isOpen()) {
      // Circuit breaker open
      errorMessage = 'Service temporarily unavailable. Please try again later.';
      logger.warn(this.config.name, `${context} - circuit breaker open`);
    } else {
      // Other error
      logger.error(this.config.name, `${context} failed: ${axiosError.message}`);
    }

    return {
      data: null,
      error: errorMessage,
      cached: false,
      timestamp: Date.now(),
    };
  }

  private getErrorMessage(status: number, context: string): string {
    switch (status) {
      case 429:
        return 'Rate limit exceeded. Please wait a moment and try again.';
      case 404:
        return 'Resource not found.';
      case 500:
      case 502:
      case 503:
      case 504:
        return 'Server error. Please try again later.';
      case 403:
        return 'Access denied. This may be due to API restrictions.';
      case 401:
        return 'Authentication failed. Please check your API credentials.';
      default:
        return `Request failed (${status}). Please try again.`;
    }
  }

  // ============================================
  // Health & Stats
  // ============================================

  isHealthy(): boolean {
    return !this.circuitBreaker.isOpen();
  }

  getStats(): {
    healthy: boolean;
    circuitState: string;
    availableTokens: number;
    cacheSize: number;
  } {
    return {
      healthy: this.isHealthy(),
      circuitState: this.circuitBreaker.getState(),
      availableTokens: this.rateLimiter.getAvailableTokens(),
      cacheSize: this.cache.size,
    };
  }

  resetCircuit(): void {
    this.circuitBreaker.reset();
    logger.info(this.config.name, 'Circuit breaker manually reset');
  }

  /**
   * Health check - attempt a lightweight request to verify API is reachable
   */
  async healthCheck(url: string = '/'): Promise<boolean> {
    try {
      await this.client.head(url, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// Validation Helpers
// ============================================

export const validators = {
  /**
   * Check if response has required fields
   */
  hasFields: (requiredFields: string[]) => (data: any): boolean => {
    if (!data || typeof data !== 'object') return false;
    return requiredFields.every(field => field in data && data[field] !== undefined);
  },

  /**
   * Check if response is an array with minimum length
   */
  isArray: (minLength: number = 0) => (data: any): boolean => {
    return Array.isArray(data) && data.length >= minLength;
  },

  /**
   * Check if response has nested field
   */
  hasNestedField: (path: string) => (data: any): boolean => {
    const parts = path.split('.');
    let current = data;
    for (const part of parts) {
      if (!current || typeof current !== 'object' || !(part in current)) {
        return false;
      }
      current = current[part];
    }
    return current !== undefined;
  },

  /**
   * Combine multiple validators (all must pass)
   */
  all: (...validators: Array<(data: any) => boolean>) => (data: any): boolean => {
    return validators.every(v => v(data));
  },
};
