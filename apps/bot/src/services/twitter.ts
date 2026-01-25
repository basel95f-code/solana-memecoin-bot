import { SENTIMENT, TIMEOUTS } from '../constants';
import { ResilientApiClient, validators } from './resilientApi';
import { logger } from '../utils/logger';

const BASE_URL = 'https://api.twitter.com/2';

interface TwitterSearchOptions {
  maxResults?: number;
  excludeRetweets?: boolean;
}

interface CachedSearch {
  query: string;
  tweets: string[];
  cachedAt: number;
}

interface TwitterTweet {
  id: string;
  text: string;
  created_at?: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
  };
}

interface TwitterSearchResponse {
  data?: TwitterTweet[];
  meta?: {
    result_count: number;
    next_token?: string;
  };
}

// ============================================
// Resilient Twitter Client
// ============================================

class TwitterService {
  private api: ResilientApiClient | null = null;
  private bearerToken: string | undefined;
  private cache: Map<string, CachedSearch> = new Map();
  private rateLimitRemaining: number = SENTIMENT.TWITTER_RATE_LIMIT;
  private rateLimitReset: number = 0;

  constructor() {
    this.bearerToken = process.env.TWITTER_BEARER_TOKEN;

    // Only create API client if configured
    if (this.bearerToken) {
      this.api = new ResilientApiClient({
        name: 'Twitter',
        baseURL: BASE_URL,
        timeout: TIMEOUTS.HTTP_REQUEST_MS || 10000,
        maxRetries: 2, // Twitter is strict, don't retry too much
        rateLimit: { maxTokens: 15, refillRate: 0.25 }, // 15 requests per minute
        circuitBreaker: { threshold: 3, resetTimeMs: 300000 }, // 5 minutes
        cacheTTL: SENTIMENT.CACHE_TTL_MS || 300000,
        headers: {
          'Authorization': `Bearer ${this.bearerToken}`,
        },
      });
    }
  }

  isConfigured(): boolean {
    return !!this.bearerToken && !!this.api;
  }

  /**
   * Search recent tweets with robust error handling
   */
  async searchRecentTweets(
    searchTerms: string[],
    options: TwitterSearchOptions = {}
  ): Promise<string[]> {
    if (!this.isConfigured() || !this.api) {
      logger.debug('Twitter', 'Service not configured (missing bearer token)');
      return [];
    }

    // Check rate limit
    if (!this.canMakeRequest()) {
      logger.info('Twitter', 'Rate limit reached, using cached data');
      return this.getCachedResults(searchTerms);
    }

    const query = this.buildQuery(searchTerms, options);
    const maxResults = Math.min(options.maxResults || SENTIMENT.MAX_TWEETS || 100, 100);

    // Make API request with resilience
    const response = await this.api.get<TwitterSearchResponse>(
      '/tweets/search/recent',
      {
        cache: true,
        cacheKey: `search:${query}:${maxResults}`,
        cacheTTL: SENTIMENT.CACHE_TTL_MS || 300000,
        validator: (data) => data && typeof data === 'object',
        config: {
          params: {
            query,
            max_results: maxResults,
            'tweet.fields': 'created_at,public_metrics',
          },
        },
      }
    );

    // Handle errors
    if (response.error) {
      if (response.error.includes('429')) {
        logger.warn('Twitter', 'Rate limited, using cached data');
        this.rateLimitRemaining = 0;
        this.rateLimitReset = Date.now() + 900000; // 15 minutes
      } else if (response.error.includes('401')) {
        logger.error('Twitter', 'Invalid bearer token');
      } else {
        logger.warn('Twitter', `Search failed: ${response.error}`);
      }

      return this.getCachedResults(searchTerms);
    }

    // Extract tweets
    if (!response.data) {
      logger.warn('Twitter', 'Empty response from API');
      return this.getCachedResults(searchTerms);
    }

    const tweets = response.data.data || [];
    const tweetTexts = tweets.map((t) => t.text);

    // Cache results
    this.cache.set(query, {
      query,
      tweets: tweetTexts,
      cachedAt: Date.now(),
    });

    logger.debug('Twitter', `Found ${tweetTexts.length} tweets for: ${searchTerms.join(', ')}`);
    return tweetTexts;
  }

  // ============================================
  // Helper Methods
  // ============================================

  private buildQuery(searchTerms: string[], options: TwitterSearchOptions): string {
    // Build OR query from search terms
    const termQuery = searchTerms.map((t) => `"${t}"`).join(' OR ');

    let query = `(${termQuery}) lang:en`;

    // Exclude retweets if requested
    if (options.excludeRetweets !== false) {
      query += ' -is:retweet';
    }

    // Filter to crypto-related context
    query += ' (crypto OR token OR solana OR $SOL OR memecoin OR defi)';

    return query;
  }

  private canMakeRequest(): boolean {
    if (this.rateLimitRemaining > (SENTIMENT.TWITTER_RATE_LIMIT_BUFFER || 2)) {
      return true;
    }

    // Check if reset time has passed
    if (Date.now() > this.rateLimitReset) {
      this.rateLimitRemaining = SENTIMENT.TWITTER_RATE_LIMIT;
      return true;
    }

    return false;
  }

  private getCachedResults(searchTerms: string[]): string[] {
    // Try to find any cached results for these terms (including stale)
    const staleTTL = SENTIMENT.STALE_CACHE_TTL_MS || 3600000; // 1 hour
    for (const [query, cached] of this.cache.entries()) {
      const isStaleValid = Date.now() - cached.cachedAt < staleTTL;
      if (isStaleValid && searchTerms.some((term) => query.includes(term))) {
        logger.debug('Twitter', `Using cached results for: ${searchTerms.join(', ')}`);
        return cached.tweets;
      }
    }
    return [];
  }

  /**
   * Clean up old cache entries
   */
  cleanupCache(): void {
    const now = Date.now();
    const staleTTL = SENTIMENT.STALE_CACHE_TTL_MS || 3600000;

    let cleaned = 0;
    for (const [query, cached] of this.cache.entries()) {
      if (now - cached.cachedAt > staleTTL) {
        this.cache.delete(query);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Twitter', `Cleaned ${cleaned} stale cache entries`);
    }
  }

  // ============================================
  // Stats & Health
  // ============================================

  getStats(): {
    configured: boolean;
    cacheSize: number;
    rateLimitRemaining: number;
    healthy: boolean;
  } {
    return {
      configured: this.isConfigured(),
      cacheSize: this.cache.size,
      rateLimitRemaining: this.rateLimitRemaining,
      healthy: this.api?.isHealthy() ?? false,
    };
  }

  clearCache(): void {
    this.cache.clear();
    this.api?.clearCache();
  }

  isHealthy(): boolean {
    return this.isConfigured() && (this.api?.isHealthy() ?? false);
  }
}

export const twitterService = new TwitterService();
