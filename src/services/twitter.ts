import axios, { AxiosInstance } from 'axios';
import { SENTIMENT, TIMEOUTS } from '../constants';

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

class TwitterService {
  private client: AxiosInstance;
  private bearerToken: string | undefined;
  private cache: Map<string, CachedSearch> = new Map();
  private rateLimitRemaining: number = SENTIMENT.TWITTER_RATE_LIMIT;
  private rateLimitReset: number = 0;

  constructor() {
    this.bearerToken = process.env.TWITTER_BEARER_TOKEN;
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: TIMEOUTS.HTTP_REQUEST_MS,
      headers: {
        'Authorization': `Bearer ${this.bearerToken}`,
      },
    });
  }

  isConfigured(): boolean {
    return !!this.bearerToken;
  }

  async searchRecentTweets(
    searchTerms: string[],
    options: TwitterSearchOptions = {}
  ): Promise<string[]> {
    if (!this.isConfigured()) {
      return [];
    }

    // Check rate limit
    if (!this.canMakeRequest()) {
      console.log('Twitter: Rate limit reached, using cached data if available');
      return this.getCachedResults(searchTerms);
    }

    const query = this.buildQuery(searchTerms, options);

    // Check cache first
    const cached = this.cache.get(query);
    if (cached && Date.now() - cached.cachedAt < SENTIMENT.CACHE_TTL_MS) {
      return cached.tweets;
    }

    try {
      const maxResults = Math.min(options.maxResults || SENTIMENT.MAX_TWEETS, 100);

      const response = await this.client.get<TwitterSearchResponse>('/tweets/search/recent', {
        params: {
          query,
          max_results: maxResults,
          'tweet.fields': 'created_at,public_metrics',
        },
      });

      // Update rate limit tracking
      this.updateRateLimit(response.headers);

      const tweets = response.data?.data || [];
      const tweetTexts = tweets.map((t) => t.text);

      // Cache results
      this.cache.set(query, {
        query,
        tweets: tweetTexts,
        cachedAt: Date.now(),
      });

      return tweetTexts;
    } catch (error: any) {
      if (error.response?.status === 429) {
        // Rate limited - update reset time
        const resetHeader = error.response.headers['x-rate-limit-reset'];
        if (resetHeader) {
          this.rateLimitReset = parseInt(resetHeader, 10) * 1000;
        }
        this.rateLimitRemaining = 0;
        console.log('Twitter: Rate limited, using cached data');
      } else if (error.response?.status === 401) {
        console.error('Twitter: Invalid bearer token');
      } else {
        console.error('Twitter: Search failed:', error.message);
      }

      // Return cached results if available
      return this.getCachedResults(searchTerms);
    }
  }

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
    if (this.rateLimitRemaining > SENTIMENT.TWITTER_RATE_LIMIT_BUFFER) {
      return true;
    }

    // Check if reset time has passed
    if (Date.now() > this.rateLimitReset) {
      this.rateLimitRemaining = SENTIMENT.TWITTER_RATE_LIMIT;
      return true;
    }

    return false;
  }

  private updateRateLimit(headers: any): void {
    const remaining = headers['x-rate-limit-remaining'];
    const reset = headers['x-rate-limit-reset'];

    if (remaining !== undefined) {
      this.rateLimitRemaining = parseInt(remaining, 10);
    }
    if (reset !== undefined) {
      this.rateLimitReset = parseInt(reset, 10) * 1000;
    }
  }

  private getCachedResults(searchTerms: string[]): string[] {
    // Try to find any cached results for these terms (including stale)
    for (const [query, cached] of this.cache.entries()) {
      const isStaleValid = Date.now() - cached.cachedAt < SENTIMENT.STALE_CACHE_TTL_MS;
      if (isStaleValid && searchTerms.some((term) => query.includes(term))) {
        return cached.tweets;
      }
    }
    return [];
  }

  cleanupCache(): void {
    const now = Date.now();

    for (const [query, cached] of this.cache.entries()) {
      if (now - cached.cachedAt > SENTIMENT.STALE_CACHE_TTL_MS) {
        this.cache.delete(query);
      }
    }
  }

  getStats(): { cacheSize: number; rateLimitRemaining: number } {
    return {
      cacheSize: this.cache.size,
      rateLimitRemaining: this.rateLimitRemaining,
    };
  }
}

export const twitterService = new TwitterService();
