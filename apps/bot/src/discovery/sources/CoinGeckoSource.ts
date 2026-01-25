/**
 * CoinGecko Discovery Source
 * Polls CoinGecko API for new Solana token listings
 * Implements rate limiting and health monitoring
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import type { IDiscoverySource } from '../interfaces/IDiscoverySource';
import type { DiscoveredToken, CoinGeckoConfig } from '../interfaces/DiscoveryTypes';

interface CoinGeckoMarketData {
  id: string;
  symbol: string;
  name: string;
  current_price?: number;
  market_cap?: number;
  total_volume?: number;
  price_change_percentage_24h?: number;
  platforms?: Record<string, string>;
  last_updated?: string;
}

interface RateLimiter {
  lastRequestTime: number;
  requestCount: number;
  resetTime: number;
}

export class CoinGeckoSource implements IDiscoverySource {
  public readonly id = 'coingecko';
  public readonly name = 'CoinGecko';
  public readonly weight = 0.7; // Lower weight - CoinGecko is slower but reliable

  private config: CoinGeckoConfig;
  private client: AxiosInstance;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastSeenTimestamp = 0;
  private lastSuccessfulFetch = 0;
  private isRunning = false;
  private consecutiveErrors = 0;

  // Rate limiting
  private rateLimiter: RateLimiter = {
    lastRequestTime: 0,
    requestCount: 0,
    resetTime: Date.now() + 60 * 1000, // Reset every minute
  };

  // Deduplication - track recently seen tokens
  private seenTokens: Set<string> = new Set();
  private readonly maxSeenTokens = 1000;

  constructor(config: Partial<CoinGeckoConfig> = {}) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'https://api.coingecko.com/api/v3',
      pollIntervalMs: config.pollIntervalMs || 5 * 60 * 1000, // 5 minutes default
    };

    // Create axios client with optional API key
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000, // 30 second timeout
      headers: this.config.apiKey
        ? { 'x-cg-pro-api-key': this.config.apiKey }
        : {},
    });

    // Add response interceptor for rate limit handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => this.handleAxiosError(error)
    );

    logger.info('CoinGeckoSource', `Initialized with poll interval: ${this.config.pollIntervalMs}ms`);
  }

  /**
   * Start the discovery source
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('CoinGeckoSource', 'Already running, skipping start');
      return;
    }

    logger.info('CoinGeckoSource', 'Starting CoinGecko discovery source');
    this.isRunning = true;
    this.lastSeenTimestamp = Date.now();

    // Do initial discovery
    try {
      await this.discover();
    } catch (error: any) {
      logger.error('CoinGeckoSource', 'Initial discovery failed:', error);
    }

    // Start polling loop
    this.pollInterval = setInterval(async () => {
      try {
        await this.discover();
      } catch (error: any) {
        logger.error('CoinGeckoSource', 'Polling error:', error);
      }
    }, this.config.pollIntervalMs);

    logger.info('CoinGeckoSource', 'Started successfully');
  }

  /**
   * Stop the discovery source
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('CoinGeckoSource', 'Not running, skipping stop');
      return;
    }

    logger.info('CoinGeckoSource', 'Stopping CoinGecko discovery source');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.isRunning = false;
    this.seenTokens.clear();

    logger.info('CoinGeckoSource', 'Stopped successfully');
  }

  /**
   * Manually trigger a discovery
   */
  async discover(): Promise<DiscoveredToken[]> {
    if (!this.isRunning && this.pollInterval !== null) {
      logger.warn('CoinGeckoSource', 'Discovery called while stopped');
    }

    // Check rate limiting
    await this.enforceRateLimit();

    logger.debug('CoinGeckoSource', 'Fetching Solana tokens from CoinGecko');

    try {
      const tokens = await this.fetchSolanaTokens();
      
      this.lastSuccessfulFetch = Date.now();
      this.lastSeenTimestamp = Date.now();
      this.consecutiveErrors = 0;

      logger.info('CoinGeckoSource', `Discovered ${tokens.length} new Solana tokens`);

      return tokens;
    } catch (error: any) {
      this.consecutiveErrors++;
      logger.error('CoinGeckoSource', `Discovery failed (consecutive errors: ${this.consecutiveErrors}):`, error);

      // If too many consecutive errors, implement backoff
      if (this.consecutiveErrors >= 3) {
        logger.warn('CoinGeckoSource', `${this.consecutiveErrors} consecutive errors, implementing backoff`);
        await this.sleep(30000); // Wait 30 seconds
      }

      throw error;
    }
  }

  /**
   * Check if source is healthy
   */
  isHealthy(): boolean {
    const now = Date.now();
    const healthyThreshold = this.config.pollIntervalMs * 3; // Allow up to 3 missed polls

    // Consider unhealthy if:
    // 1. Never successfully fetched
    // 2. Last successful fetch was too long ago
    // 3. Too many consecutive errors
    if (this.lastSuccessfulFetch === 0) {
      return this.isRunning; // Healthy if just started
    }

    const isTimedOut = now - this.lastSuccessfulFetch > healthyThreshold;
    const tooManyErrors = this.consecutiveErrors >= 5;

    return !isTimedOut && !tooManyErrors;
  }

  /**
   * Get last successful discovery timestamp
   */
  getLastSeenTimestamp(): number {
    return this.lastSeenTimestamp;
  }

  /**
   * Fetch Solana tokens from CoinGecko API
   */
  private async fetchSolanaTokens(): Promise<DiscoveredToken[]> {
    const discoveredTokens: DiscoveredToken[] = [];

    try {
      // Fetch tokens from Solana ecosystem category
      const response = await this.client.get<CoinGeckoMarketData[]>('/coins/markets', {
        params: {
          vs_currency: 'usd',
          category: 'solana-ecosystem',
          order: 'market_cap_desc',
          per_page: 50,
          page: 1,
          sparkline: false,
          price_change_percentage: '24h',
        },
      });

      const markets = response.data;

      if (!Array.isArray(markets)) {
        logger.warn('CoinGeckoSource', 'Unexpected API response format');
        return [];
      }

      for (const market of markets) {
        try {
          // Extract Solana contract address from platforms
          const solanaAddress = this.extractSolanaAddress(market);

          if (!solanaAddress) {
            logger.debug('CoinGeckoSource', `No Solana address found for ${market.symbol}`);
            continue;
          }

          // Skip if we've seen this token recently
          if (this.seenTokens.has(solanaAddress)) {
            continue;
          }

          // Create discovered token
          const token: DiscoveredToken = {
            mint: solanaAddress,
            symbol: market.symbol?.toUpperCase() || 'UNKNOWN',
            name: market.name || 'Unknown Token',
            source: this.id,
            timestamp: Date.now(),
            initialPrice: market.current_price,
            initialMarketCap: market.market_cap,
            initialLiquidity: market.total_volume, // Using volume as proxy for liquidity
            metadata: {
              coinGeckoId: market.id,
              priceChange24h: market.price_change_percentage_24h,
              lastUpdated: market.last_updated,
            },
          };

          discoveredTokens.push(token);

          // Track seen token
          this.trackSeenToken(solanaAddress);

          logger.debug('CoinGeckoSource', `Discovered: ${token.symbol} (${token.mint})`);
        } catch (error: any) {
          logger.error('CoinGeckoSource', `Error processing token ${market.symbol}:`, error);
          continue;
        }
      }

      return discoveredTokens;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        logger.error('CoinGeckoSource', `API request failed: ${axiosError.message}`, {
          status: axiosError.response?.status,
          statusText: axiosError.response?.statusText,
        });
      } else {
        logger.error('CoinGeckoSource', 'Fetch error:', error);
      }
      throw error;
    }
  }

  /**
   * Extract Solana contract address from platforms object
   */
  private extractSolanaAddress(market: CoinGeckoMarketData): string | null {
    if (!market.platforms || typeof market.platforms !== 'object') {
      return null;
    }

    // CoinGecko uses 'solana' as platform key
    const solanaAddress = market.platforms['solana'] || market.platforms['Solana'];

    if (!solanaAddress || typeof solanaAddress !== 'string') {
      return null;
    }

    // Basic validation - Solana addresses are base58 and typically 32-44 chars
    if (solanaAddress.length < 32 || solanaAddress.length > 44) {
      return null;
    }

    return solanaAddress;
  }

  /**
   * Track seen token for deduplication
   */
  private trackSeenToken(mint: string): void {
    this.seenTokens.add(mint);

    // Limit cache size
    if (this.seenTokens.size > this.maxSeenTokens) {
      // Remove oldest entries (simple FIFO)
      const toRemove = this.seenTokens.size - this.maxSeenTokens;
      const iterator = this.seenTokens.values();
      for (let i = 0; i < toRemove; i++) {
        const value = iterator.next().value;
        if (value) {
          this.seenTokens.delete(value);
        }
      }
    }
  }

  /**
   * Enforce rate limiting
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();

    // Reset counter if minute has passed
    if (now >= this.rateLimiter.resetTime) {
      this.rateLimiter.requestCount = 0;
      this.rateLimiter.resetTime = now + 60 * 1000;
    }

    // CoinGecko free tier: 10-50 calls/minute depending on plan
    // Pro tier: 500 calls/minute
    const maxCallsPerMinute = this.config.apiKey ? 100 : 10; // Conservative limits

    if (this.rateLimiter.requestCount >= maxCallsPerMinute) {
      const waitTime = this.rateLimiter.resetTime - now;
      logger.warn('CoinGeckoSource', `Rate limit reached, waiting ${waitTime}ms`);
      await this.sleep(waitTime);

      // Reset after waiting
      this.rateLimiter.requestCount = 0;
      this.rateLimiter.resetTime = Date.now() + 60 * 1000;
    }

    // Ensure minimum delay between requests (100ms)
    const timeSinceLastRequest = now - this.rateLimiter.lastRequestTime;
    if (timeSinceLastRequest < 100) {
      await this.sleep(100 - timeSinceLastRequest);
    }

    this.rateLimiter.requestCount++;
    this.rateLimiter.lastRequestTime = Date.now();
  }

  /**
   * Handle axios errors with retry logic
   */
  private async handleAxiosError(error: AxiosError): Promise<never> {
    if (error.response) {
      const status = error.response.status;

      // Handle rate limiting
      if (status === 429) {
        const retryAfter = error.response.headers['retry-after'];
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
        
        logger.warn('CoinGeckoSource', `Rate limited by API, waiting ${waitTime}ms`);
        await this.sleep(waitTime);
        
        // Don't throw - will be retried
        return Promise.reject(error);
      }

      // Handle other errors
      logger.error('CoinGeckoSource', `HTTP ${status}: ${error.message}`);
    }

    throw error;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get source statistics
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      isHealthy: this.isHealthy(),
      lastSuccessfulFetch: this.lastSuccessfulFetch,
      consecutiveErrors: this.consecutiveErrors,
      seenTokensCount: this.seenTokens.size,
      rateLimitInfo: {
        requestCount: this.rateLimiter.requestCount,
        resetTime: this.rateLimiter.resetTime,
      },
    };
  }
}
