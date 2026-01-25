/**
 * Birdeye Discovery Source
 * Discovers new Solana tokens via Birdeye API
 * Implements rate limiting, polling, and health monitoring
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import type { IDiscoverySource } from '../interfaces/IDiscoverySource';
import type { DiscoveredToken, BirdeyeConfig } from '../interfaces/DiscoveryTypes';

interface BirdeyeTokenResponse {
  data: {
    tokens?: Array<{
      address: string;
      symbol: string;
      name: string;
      decimals: number;
      liquidity?: number;
      v24hUSD?: number;
      v24hChangePercent?: number;
      price?: number;
      mc?: number;
      holder?: number;
      createdAt?: number;
    }>;
    updateTime?: number;
  };
  success: boolean;
}

interface RateLimitState {
  requestsThisMinute: number;
  requestsThisHour: number;
  minuteResetAt: number;
  hourResetAt: number;
  lastRequestAt: number;
}

export class BirdeyeSource implements IDiscoverySource {
  readonly id = 'birdeye';
  readonly name = 'Birdeye API';
  readonly weight = 0.8; // High credibility for Birdeye

  private config: BirdeyeConfig;
  private client: AxiosInstance;
  private pollingInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastSuccessfulFetch = 0;
  private consecutiveErrors = 0;
  private seenTokens = new Set<string>();

  // Rate limiting state
  private rateLimit: RateLimitState = {
    requestsThisMinute: 0,
    requestsThisHour: 0,
    minuteResetAt: Date.now() + 60 * 1000,
    hourResetAt: Date.now() + 60 * 60 * 1000,
    lastRequestAt: 0,
  };

  // Rate limits (conservative to respect Birdeye API)
  private readonly MAX_REQUESTS_PER_MINUTE = 30;
  private readonly MAX_REQUESTS_PER_HOUR = 500;
  private readonly MIN_REQUEST_INTERVAL_MS = 2000; // 2s between requests
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 5000;
  private readonly HEALTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  constructor(config: BirdeyeConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'https://public-api.birdeye.so',
      pollIntervalMs: config.pollIntervalMs || 60000, // 1 minute default
    };

    // Create axios client with default config
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
      headers: {
        'X-API-KEY': this.config.apiKey,
        'Accept': 'application/json',
      },
    });

    logger.info('BirdeyeSource', `Initialized with poll interval ${this.config.pollIntervalMs}ms`);
  }

  /**
   * Start polling for new tokens
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('BirdeyeSource', 'Already running, ignoring start request');
      return;
    }

    this.isRunning = true;
    logger.info('BirdeyeSource', 'Starting token discovery');

    // Do initial discovery
    try {
      await this.discover();
    } catch (error: any) {
      logger.error('BirdeyeSource', 'Initial discovery failed', error);
    }

    // Start polling loop
    this.pollingInterval = setInterval(async () => {
      if (this.isRunning) {
        try {
          await this.discover();
        } catch (error: any) {
          logger.error('BirdeyeSource', 'Discovery error in polling loop', error);
        }
      }
    }, this.config.pollIntervalMs);

    logger.info('BirdeyeSource', 'Polling started');
  }

  /**
   * Stop polling
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    logger.info('BirdeyeSource', 'Stopped');
  }

  /**
   * Discover new tokens
   */
  async discover(): Promise<DiscoveredToken[]> {
    if (!this.canMakeRequest()) {
      logger.warn('BirdeyeSource', 'Rate limit reached, skipping discovery');
      return [];
    }

    logger.debug('BirdeyeSource', 'Starting token discovery');

    try {
      const tokens = await this.fetchNewTokens();
      
      // Filter out already seen tokens
      const newTokens = tokens.filter((token) => {
        if (this.seenTokens.has(token.mint)) {
          return false;
        }
        this.seenTokens.add(token.mint);
        return true;
      });

      // Clean up seen tokens set if it gets too large (keep last 10k)
      if (this.seenTokens.size > 10000) {
        const tokensArray = Array.from(this.seenTokens);
        this.seenTokens = new Set(tokensArray.slice(-5000));
      }

      this.lastSuccessfulFetch = Date.now();
      this.consecutiveErrors = 0;

      if (newTokens.length > 0) {
        logger.info('BirdeyeSource', `Discovered ${newTokens.length} new tokens`);
      } else {
        logger.debug('BirdeyeSource', 'No new tokens found');
      }

      return newTokens;
    } catch (error: any) {
      this.consecutiveErrors++;
      logger.error('BirdeyeSource', `Discovery failed (consecutive errors: ${this.consecutiveErrors})`, error);

      // If too many consecutive errors, consider source unhealthy
      if (this.consecutiveErrors >= 5) {
        logger.error('BirdeyeSource', 'Too many consecutive errors, source may be unhealthy');
      }

      return [];
    }
  }

  /**
   * Fetch new tokens from Birdeye API
   */
  private async fetchNewTokens(retryCount = 0): Promise<DiscoveredToken[]> {
    try {
      // Update rate limit state
      this.updateRateLimitState();

      // Make request
      const response = await this.client.get<BirdeyeTokenResponse>('/defi/v3/token/new', {
        params: {
          chain: 'solana',
          sort_by: 'time',
          sort_type: 'desc',
          limit: 50,
        },
      });

      this.recordRequest();

      if (!response.data.success || !response.data.data.tokens) {
        logger.warn('BirdeyeSource', 'API response indicates failure or no tokens');
        return [];
      }

      const tokens = response.data.data.tokens;

      // Convert to DiscoveredToken format
      return tokens.map((token) => ({
        mint: token.address,
        symbol: token.symbol || 'UNKNOWN',
        name: token.name || 'Unknown Token',
        source: this.id,
        timestamp: Date.now(),
        initialPrice: token.price,
        initialLiquidity: token.liquidity,
        initialMarketCap: token.mc,
        metadata: {
          decimals: token.decimals,
          volume24h: token.v24hUSD,
          volume24hChange: token.v24hChangePercent,
          holders: token.holder,
          createdAt: token.createdAt,
        },
      }));
    } catch (error: any) {
      // Handle rate limiting
      if (this.isRateLimitError(error)) {
        logger.warn('BirdeyeSource', 'Rate limited by API, backing off');
        this.handleRateLimit();
        throw error;
      }

      // Handle retries
      if (retryCount < this.MAX_RETRIES) {
        const delay = this.RETRY_DELAY_MS * Math.pow(2, retryCount);
        logger.warn('BirdeyeSource', `Request failed, retrying in ${delay}ms (attempt ${retryCount + 1}/${this.MAX_RETRIES})`);
        
        await this.sleep(delay);
        return this.fetchNewTokens(retryCount + 1);
      }

      // Log detailed error
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        logger.error(
          'BirdeyeSource',
          `API request failed: ${axiosError.response?.status || 'unknown'} - ${axiosError.message}`,
          error
        );
      } else {
        logger.error('BirdeyeSource', 'Unexpected error during token fetch', error);
      }

      throw error;
    }
  }

  /**
   * Check if source is healthy
   */
  isHealthy(): boolean {
    // Unhealthy if never successfully fetched
    if (this.lastSuccessfulFetch === 0) {
      return false;
    }

    // Unhealthy if last successful fetch was too long ago
    const timeSinceLastSuccess = Date.now() - this.lastSuccessfulFetch;
    if (timeSinceLastSuccess > this.HEALTH_TIMEOUT_MS) {
      return false;
    }

    // Unhealthy if too many consecutive errors
    if (this.consecutiveErrors >= 5) {
      return false;
    }

    return true;
  }

  /**
   * Get last successful discovery timestamp
   */
  getLastSeenTimestamp(): number {
    return this.lastSuccessfulFetch;
  }

  /**
   * Check if we can make a request based on rate limits
   */
  private canMakeRequest(): boolean {
    this.updateRateLimitState();

    // Check minute limit
    if (this.rateLimit.requestsThisMinute >= this.MAX_REQUESTS_PER_MINUTE) {
      return false;
    }

    // Check hour limit
    if (this.rateLimit.requestsThisHour >= this.MAX_REQUESTS_PER_HOUR) {
      return false;
    }

    // Check minimum interval between requests
    const timeSinceLastRequest = Date.now() - this.rateLimit.lastRequestAt;
    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL_MS) {
      return false;
    }

    return true;
  }

  /**
   * Update rate limit state (reset counters if windows expired)
   */
  private updateRateLimitState(): void {
    const now = Date.now();

    // Reset minute counter if window expired
    if (now >= this.rateLimit.minuteResetAt) {
      this.rateLimit.requestsThisMinute = 0;
      this.rateLimit.minuteResetAt = now + 60 * 1000;
    }

    // Reset hour counter if window expired
    if (now >= this.rateLimit.hourResetAt) {
      this.rateLimit.requestsThisHour = 0;
      this.rateLimit.hourResetAt = now + 60 * 60 * 1000;
    }
  }

  /**
   * Record a request for rate limiting
   */
  private recordRequest(): void {
    this.rateLimit.requestsThisMinute++;
    this.rateLimit.requestsThisHour++;
    this.rateLimit.lastRequestAt = Date.now();
  }

  /**
   * Check if error is a rate limit error
   */
  private isRateLimitError(error: any): boolean {
    if (!axios.isAxiosError(error)) {
      return false;
    }

    const status = error.response?.status;
    return status === 429 || status === 403;
  }

  /**
   * Handle rate limit by backing off
   */
  private handleRateLimit(): void {
    // Reset to conservative limits
    this.rateLimit.requestsThisMinute = this.MAX_REQUESTS_PER_MINUTE;
    this.rateLimit.requestsThisHour = this.MAX_REQUESTS_PER_HOUR;
    
    // Set reset times further in the future
    this.rateLimit.minuteResetAt = Date.now() + 2 * 60 * 1000; // 2 minutes
    this.rateLimit.hourResetAt = Date.now() + 10 * 60 * 1000; // 10 minutes
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
      rateLimit: {
        requestsThisMinute: this.rateLimit.requestsThisMinute,
        requestsThisHour: this.rateLimit.requestsThisHour,
        minuteResetIn: Math.max(0, this.rateLimit.minuteResetAt - Date.now()),
        hourResetIn: Math.max(0, this.rateLimit.hourResetAt - Date.now()),
      },
    };
  }
}
