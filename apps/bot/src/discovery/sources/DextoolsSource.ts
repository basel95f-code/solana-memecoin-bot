/**
 * DextoolsSource - Dextools API Token Discovery
 * Polls Dextools API for new Solana pairs and hot tokens
 * Phase 31: Multi-source token discovery
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import type { IDiscoverySource } from '../interfaces/IDiscoverySource';
import type { DiscoveredToken, DextoolsConfig } from '../interfaces/DiscoveryTypes';

interface DextoolsPoolResponse {
  statusCode: number;
  data?: {
    results?: DextoolsPool[];
  };
  message?: string;
}

interface DextoolsPool {
  address: string;
  name: string;
  symbol: string;
  price?: number;
  liquidity?: number;
  marketCap?: number;
  creationTime?: number;
  token0?: {
    address: string;
    name: string;
    symbol: string;
  };
  token1?: {
    address: string;
    name: string;
    symbol: string;
  };
}

interface RateLimitState {
  requestCount: number;
  windowStart: number;
  lastRequest: number;
}

export class DextoolsSource implements IDiscoverySource {
  readonly id = 'dextools';
  readonly name = 'Dextools';
  readonly weight = 0.75; // Base credibility weight

  private config: DextoolsConfig;
  private client: AxiosInstance;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastSeenTimestamp = 0;
  private isRunning = false;
  private healthStatus = true;
  private consecutiveErrors = 0;
  private readonly maxConsecutiveErrors = 5;

  // Rate limiting
  private rateLimit: RateLimitState = {
    requestCount: 0,
    windowStart: Date.now(),
    lastRequest: 0,
  };
  private readonly rateLimitPerMinute = 60; // Dextools free tier limit
  private readonly minRequestIntervalMs = 1000; // 1 second between requests

  constructor(config: DextoolsConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'https://api.dextools.io',
      pollIntervalMs: config.pollIntervalMs || 30000, // 30 seconds default
      minLiquidity: config.minLiquidity || 1000, // $1000 minimum liquidity
    };

    // Initialize axios client
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 10000,
      headers: {
        'X-API-Key': this.config.apiKey,
        'Accept': 'application/json',
      },
    });

    logger.info('DextoolsSource', `Initialized with poll interval: ${this.config.pollIntervalMs}ms, min liquidity: $${this.config.minLiquidity}`);
  }

  /**
   * Start polling for new tokens
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('DextoolsSource', 'Already running, ignoring start()');
      return;
    }

    logger.info('DextoolsSource', 'Starting discovery source');
    this.isRunning = true;
    this.healthStatus = true;
    this.consecutiveErrors = 0;

    // Initial discovery
    try {
      await this.discover();
    } catch (error: any) {
      logger.error('DextoolsSource', 'Initial discovery failed', error);
    }

    // Start polling loop
    this.pollInterval = setInterval(async () => {
      try {
        await this.discover();
      } catch (error: any) {
        logger.error('DextoolsSource', 'Discovery poll failed', error);
      }
    }, this.config.pollIntervalMs);

    logger.info('DextoolsSource', 'Started successfully');
  }

  /**
   * Stop polling and cleanup
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('DextoolsSource', 'Not running, ignoring stop()');
      return;
    }

    logger.info('DextoolsSource', 'Stopping discovery source');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.isRunning = false;
    logger.info('DextoolsSource', 'Stopped successfully');
  }

  /**
   * Manually trigger discovery
   */
  async discover(): Promise<DiscoveredToken[]> {
    const allTokens: DiscoveredToken[] = [];

    try {
      // Fetch from both endpoints (new pairs and hot pairs)
      const [newPairs, hotPairs] = await Promise.allSettled([
        this.fetchNewPairs(),
        this.fetchHotPairs(),
      ]);

      if (newPairs.status === 'fulfilled') {
        allTokens.push(...newPairs.value);
      } else {
        logger.warn('DextoolsSource', 'Failed to fetch new pairs', newPairs.reason);
      }

      if (hotPairs.status === 'fulfilled') {
        allTokens.push(...hotPairs.value);
      } else {
        logger.warn('DextoolsSource', 'Failed to fetch hot pairs', hotPairs.reason);
      }

      // Update health status
      if (allTokens.length > 0) {
        this.lastSeenTimestamp = Date.now();
        this.consecutiveErrors = 0;
        this.healthStatus = true;
      }

      logger.debug('DextoolsSource', `Discovered ${allTokens.length} tokens`);
      return allTokens;

    } catch (error: any) {
      this.handleError(error);
      return [];
    }
  }

  /**
   * Fetch new pairs from Dextools
   */
  private async fetchNewPairs(): Promise<DiscoveredToken[]> {
    await this.checkRateLimit();

    try {
      const response = await this.client.get<DextoolsPoolResponse>(
        '/v2/pool/solana/new',
        {
          params: {
            sort: 'creationTime',
            order: 'desc',
          },
        }
      );

      this.updateRateLimit();

      if (response.data.statusCode === 200 && response.data.data?.results) {
        return this.parsePools(response.data.data.results, 'new_pairs');
      }

      logger.warn('DextoolsSource', `Unexpected response from new pairs: ${response.data.statusCode}`);
      return [];

    } catch (error) {
      this.handleApiError(error as AxiosError, 'fetchNewPairs');
      throw error;
    }
  }

  /**
   * Fetch hot pairs from Dextools
   */
  private async fetchHotPairs(): Promise<DiscoveredToken[]> {
    await this.checkRateLimit();

    try {
      const response = await this.client.get<DextoolsPoolResponse>(
        '/v2/pool/solana/hot',
        {
          params: {
            sort: 'volume',
            order: 'desc',
          },
        }
      );

      this.updateRateLimit();

      if (response.data.statusCode === 200 && response.data.data?.results) {
        return this.parsePools(response.data.data.results, 'hot_pairs');
      }

      logger.warn('DextoolsSource', `Unexpected response from hot pairs: ${response.data.statusCode}`);
      return [];

    } catch (error) {
      this.handleApiError(error as AxiosError, 'fetchHotPairs');
      throw error;
    }
  }

  /**
   * Parse Dextools pools into DiscoveredToken format
   */
  private parsePools(pools: DextoolsPool[], endpoint: string): DiscoveredToken[] {
    const tokens: DiscoveredToken[] = [];
    const now = Date.now();

    for (const pool of pools) {
      try {
        // Filter by liquidity threshold
        if (this.config.minLiquidity && pool.liquidity && pool.liquidity < this.config.minLiquidity) {
          continue;
        }

        // Determine which token is the actual token (not SOL/USDC)
        const token = this.extractTokenFromPool(pool);
        if (!token) {
          continue;
        }

        const discoveredToken: DiscoveredToken = {
          mint: token.address,
          symbol: token.symbol,
          name: token.name,
          source: this.id,
          timestamp: now,
          initialPrice: pool.price,
          initialLiquidity: pool.liquidity,
          initialMarketCap: pool.marketCap,
          metadata: {
            poolAddress: pool.address,
            endpoint,
            creationTime: pool.creationTime,
            dextoolsUrl: `https://www.dextools.io/app/solana/pair-explorer/${pool.address}`,
          },
        };

        tokens.push(discoveredToken);

      } catch (error: any) {
        logger.silentError('DextoolsSource', `Failed to parse pool ${pool.address}`, error);
        continue;
      }
    }

    logger.debug('DextoolsSource', `Parsed ${tokens.length} tokens from ${endpoint} (filtered from ${pools.length} pools)`);
    return tokens;
  }

  /**
   * Extract the actual token from a pool (not SOL/USDC)
   */
  private extractTokenFromPool(pool: DextoolsPool): { address: string; symbol: string; name: string } | null {
    const knownBaseTokens = ['SOL', 'USDC', 'USDT', 'WSOL'];

    // Check token0
    if (pool.token0 && !knownBaseTokens.includes(pool.token0.symbol.toUpperCase())) {
      return {
        address: pool.token0.address,
        symbol: pool.token0.symbol,
        name: pool.token0.name,
      };
    }

    // Check token1
    if (pool.token1 && !knownBaseTokens.includes(pool.token1.symbol.toUpperCase())) {
      return {
        address: pool.token1.address,
        symbol: pool.token1.symbol,
        name: pool.token1.name,
      };
    }

    // Fallback to pool name/symbol
    if (pool.symbol && pool.name) {
      // Extract address from pool if available
      const address = pool.token0?.address || pool.token1?.address || pool.address;
      return {
        address,
        symbol: pool.symbol,
        name: pool.name,
      };
    }

    return null;
  }

  /**
   * Check rate limit before making request
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const windowDuration = 60 * 1000; // 1 minute

    // Reset window if needed
    if (now - this.rateLimit.windowStart >= windowDuration) {
      this.rateLimit.requestCount = 0;
      this.rateLimit.windowStart = now;
    }

    // Check if we've hit the rate limit
    if (this.rateLimit.requestCount >= this.rateLimitPerMinute) {
      const waitTime = windowDuration - (now - this.rateLimit.windowStart);
      logger.warn('DextoolsSource', `Rate limit reached, waiting ${Math.ceil(waitTime / 1000)}s`);
      await this.sleep(waitTime);
      
      // Reset after waiting
      this.rateLimit.requestCount = 0;
      this.rateLimit.windowStart = Date.now();
    }

    // Ensure minimum interval between requests
    const timeSinceLastRequest = now - this.rateLimit.lastRequest;
    if (timeSinceLastRequest < this.minRequestIntervalMs) {
      await this.sleep(this.minRequestIntervalMs - timeSinceLastRequest);
    }
  }

  /**
   * Update rate limit state after successful request
   */
  private updateRateLimit(): void {
    this.rateLimit.requestCount++;
    this.rateLimit.lastRequest = Date.now();
  }

  /**
   * Handle API errors with retry logic
   */
  private handleApiError(error: AxiosError, context: string): void {
    if (error.response) {
      const status = error.response.status;
      
      if (status === 429) {
        logger.warn('DextoolsSource', `Rate limited on ${context}, backing off`);
      } else if (status === 401 || status === 403) {
        logger.error('DextoolsSource', `Authentication error on ${context}: ${status}`);
        this.healthStatus = false;
      } else if (status >= 500) {
        logger.warn('DextoolsSource', `Server error on ${context}: ${status}`);
      } else {
        logger.warn('DextoolsSource', `API error on ${context}: ${status} - ${error.message}`);
      }
    } else if (error.request) {
      logger.warn('DextoolsSource', `No response received on ${context}: ${error.message}`);
    } else {
      logger.error('DextoolsSource', `Request setup error on ${context}`, error);
    }
  }

  /**
   * Handle general errors
   */
  private handleError(error: Error): void {
    this.consecutiveErrors++;
    
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
      this.healthStatus = false;
      logger.error('DextoolsSource', `Health check failed: ${this.consecutiveErrors} consecutive errors`);
    }

    logger.error('DextoolsSource', 'Discovery error', error);
  }

  /**
   * Check if source is healthy
   */
  isHealthy(): boolean {
    // Unhealthy if too many consecutive errors
    if (!this.healthStatus) {
      return false;
    }

    // Unhealthy if no successful response in the last 5 minutes
    const maxStaleness = 5 * 60 * 1000;
    if (this.lastSeenTimestamp > 0 && Date.now() - this.lastSeenTimestamp > maxStaleness) {
      return false;
    }

    return true;
  }

  /**
   * Get last successful discovery timestamp
   */
  getLastSeenTimestamp(): number {
    return this.lastSeenTimestamp;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get source statistics
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      isHealthy: this.isHealthy(),
      lastSeen: this.lastSeenTimestamp,
      consecutiveErrors: this.consecutiveErrors,
      rateLimit: {
        requestCount: this.rateLimit.requestCount,
        windowStart: this.rateLimit.windowStart,
      },
    };
  }
}
