import type { AxiosInstance } from 'axios';
import axios from 'axios';
import type { DexScreenerPair, DexScreenerResponse, TrendingToken } from '../types';
import { withRetry, RateLimiter } from '../utils/retry';

const BASE_URL = 'https://api.dexscreener.com/latest/dex';
const BOOSTS_URL = 'https://api.dexscreener.com/token-boosts/latest/v1';
const PROFILES_URL = 'https://api.dexscreener.com/token-profiles/latest/v1';
const CACHE_TTL = 60000; // 60 seconds for trending data

// Rate limiter for DexScreener (avoid getting rate limited)
const rateLimiter = new RateLimiter(10, 2); // 10 tokens, 2/sec refill

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class DexScreenerService {
  private client: AxiosInstance;
  private cache: Map<string, CacheEntry<any>> = new Map();

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
      },
    });
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
      return entry.data as T;
    }
    this.cache.delete(key);
    return null;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  async getTokenPairs(tokenAddress: string): Promise<DexScreenerPair[]> {
    const cacheKey = `token:${tokenAddress}`;
    const cached = this.getCached<DexScreenerPair[]>(cacheKey);
    if (cached) return cached;

    try {
      await rateLimiter.acquire();
      const response = await withRetry(
        () => this.client.get<DexScreenerResponse>(`/tokens/${tokenAddress}`),
        { maxRetries: 3, initialDelayMs: 500 }
      );
      const pairs = response.data.pairs || [];
      // Filter for Solana pairs only
      const solanaPairs = pairs.filter(p => p.chainId === 'solana');
      this.setCache(cacheKey, solanaPairs);
      return solanaPairs;
    } catch (error) {
      console.error(`DexScreener: Failed to fetch token ${tokenAddress}:`, error);
      return [];
    }
  }

  async getTokenData(tokenAddress: string): Promise<DexScreenerPair | null> {
    const pairs = await this.getTokenPairs(tokenAddress);
    if (pairs.length === 0) return null;
    // Return the pair with highest liquidity
    return pairs.reduce((best, current) => {
      const bestLiq = best.liquidity?.usd || 0;
      const currentLiq = current.liquidity?.usd || 0;
      return currentLiq > bestLiq ? current : best;
    });
  }

  /**
   * Batch fetch multiple tokens in a single API call
   * DexScreener supports up to 30 tokens per request
   */
  async getMultipleTokensData(tokenAddresses: string[]): Promise<Map<string, DexScreenerPair>> {
    const results = new Map<string, DexScreenerPair>();
    if (tokenAddresses.length === 0) return results;

    // DexScreener supports comma-separated addresses (up to 30)
    const batchSize = 30;
    const batches: string[][] = [];
    for (let i = 0; i < tokenAddresses.length; i += batchSize) {
      batches.push(tokenAddresses.slice(i, i + batchSize));
    }

    for (const batch of batches) {
      // Check cache first
      const uncached: string[] = [];
      for (const addr of batch) {
        const cached = this.getCached<DexScreenerPair[]>(`token:${addr}`);
        if (cached && cached.length > 0) {
          // Get best pair by liquidity
          const best = cached.reduce((a, b) =>
            (b.liquidity?.usd || 0) > (a.liquidity?.usd || 0) ? b : a
          );
          results.set(addr, best);
        } else {
          uncached.push(addr);
        }
      }

      if (uncached.length === 0) continue;

      try {
        await rateLimiter.acquire();
        const response = await withRetry(
          () => this.client.get<DexScreenerResponse>(`/tokens/${uncached.join(',')}`),
          { maxRetries: 2, initialDelayMs: 500 }
        );

        const pairs = response.data.pairs || [];
        const solanaPairs = pairs.filter(p => p.chainId === 'solana');

        // Group pairs by token address
        const pairsByToken = new Map<string, DexScreenerPair[]>();
        for (const pair of solanaPairs) {
          const addr = pair.baseToken.address;
          if (!pairsByToken.has(addr)) {
            pairsByToken.set(addr, []);
          }
          pairsByToken.get(addr)!.push(pair);
        }

        // Cache and get best pair for each token
        for (const [addr, tokenPairs] of pairsByToken) {
          this.setCache(`token:${addr}`, tokenPairs);
          if (tokenPairs.length > 0) {
            const best = tokenPairs.reduce((a, b) =>
              (b.liquidity?.usd || 0) > (a.liquidity?.usd || 0) ? b : a
            );
            results.set(addr, best);
          }
        }
      } catch (error) {
        console.error(`DexScreener: Batch fetch failed for ${uncached.length} tokens:`, error);
      }
    }

    return results;
  }

  async searchTokens(query: string): Promise<DexScreenerPair[]> {
    const cacheKey = `search:${query}`;
    const cached = this.getCached<DexScreenerPair[]>(cacheKey);
    if (cached) return cached;

    try {
      await rateLimiter.acquire();
      const response = await withRetry(
        () => this.client.get<DexScreenerResponse>(`/search?q=${encodeURIComponent(query)}`),
        { maxRetries: 2, initialDelayMs: 500 }
      );
      const pairs = response.data.pairs || [];
      const solanaPairs = pairs.filter(p => p.chainId === 'solana');
      this.setCache(cacheKey, solanaPairs);
      return solanaPairs;
    } catch (error) {
      console.error(`DexScreener: Failed to search "${query}":`, error);
      return [];
    }
  }

  async getTrendingTokens(limit: number = 10): Promise<TrendingToken[]> {
    const cacheKey = `trending:${limit}`;
    const cached = this.getCached<TrendingToken[]>(cacheKey);
    if (cached) return cached;

    try {
      // Use token-boosts endpoint for actually trending/boosted tokens
      await rateLimiter.acquire();
      const boostsResponse = await withRetry(
        () => axios.get(BOOSTS_URL, { timeout: 10000 }),
        { maxRetries: 2, initialDelayMs: 500 }
      );
      const boosts = boostsResponse.data || [];

      // Filter for Solana tokens and get token addresses
      const solanaTokens = boosts
        .filter((b: any) => b.chainId === 'solana')
        .slice(0, limit * 2);

      if (solanaTokens.length === 0) {
        // Fallback to profiles endpoint
        return await this.getTrendingFromProfiles(limit);
      }

      // Batch fetch all token data at once instead of one-by-one
      const tokenAddresses = solanaTokens.map((t: any) => t.tokenAddress);
      const pairDataMap = await this.getMultipleTokensData(tokenAddresses);

      const trending: TrendingToken[] = [];
      for (const token of solanaTokens) {
        if (trending.length >= limit) break;
        const pairData = pairDataMap.get(token.tokenAddress);
        if (pairData && pairData.baseToken.symbol !== 'SOL' && (pairData.liquidity?.usd || 0) >= 1000) {
          trending.push(this.pairToTrendingToken(pairData));
        }
      }

      this.setCache(cacheKey, trending);
      return trending;
    } catch (error) {
      console.error('DexScreener: Failed to fetch trending, trying profiles:', error);
      return await this.getTrendingFromProfiles(limit);
    }
  }

  private async getTrendingFromProfiles(limit: number): Promise<TrendingToken[]> {
    try {
      await rateLimiter.acquire();
      const response = await withRetry(
        () => axios.get(PROFILES_URL, { timeout: 10000 }),
        { maxRetries: 2, initialDelayMs: 500 }
      );
      const profiles = response.data || [];

      const solanaProfiles = profiles
        .filter((p: any) => p.chainId === 'solana')
        .slice(0, limit * 2);

      // Batch fetch all token data
      const tokenAddresses = solanaProfiles.map((p: any) => p.tokenAddress);
      const pairDataMap = await this.getMultipleTokensData(tokenAddresses);

      const trending: TrendingToken[] = [];
      for (const profile of solanaProfiles) {
        if (trending.length >= limit) break;
        const pairData = pairDataMap.get(profile.tokenAddress);
        if (pairData && pairData.baseToken.symbol !== 'SOL' && (pairData.liquidity?.usd || 0) >= 1000) {
          trending.push(this.pairToTrendingToken(pairData));
        }
      }

      return trending;
    } catch (error) {
      console.error('DexScreener: Failed to fetch profiles:', error);
      return [];
    }
  }

  async getTopGainers(limit: number = 10): Promise<TrendingToken[]> {
    const cacheKey = `gainers:${limit}`;
    const cached = this.getCached<TrendingToken[]>(cacheKey);
    if (cached) return cached;

    try {
      // Get trending tokens and sort by price change
      const trending = await this.fetchSolanaPairsFromBoosts();
      const gainers = trending
        .filter((p: DexScreenerPair) => (p.priceChange?.h24 || 0) > 0)
        .sort((a: DexScreenerPair, b: DexScreenerPair) => (b.priceChange?.h24 || 0) - (a.priceChange?.h24 || 0))
        .slice(0, limit)
        .map((p: DexScreenerPair) => this.pairToTrendingToken(p));

      this.setCache(cacheKey, gainers);
      return gainers;
    } catch (error) {
      console.error('DexScreener: Failed to fetch gainers:', error);
      return [];
    }
  }

  async getTopLosers(limit: number = 10): Promise<TrendingToken[]> {
    const cacheKey = `losers:${limit}`;
    const cached = this.getCached<TrendingToken[]>(cacheKey);
    if (cached) return cached;

    try {
      const trending = await this.fetchSolanaPairsFromBoosts();
      const losers = trending
        .filter((p: DexScreenerPair) => (p.priceChange?.h24 || 0) < 0)
        .sort((a: DexScreenerPair, b: DexScreenerPair) => (a.priceChange?.h24 || 0) - (b.priceChange?.h24 || 0))
        .slice(0, limit)
        .map((p: DexScreenerPair) => this.pairToTrendingToken(p));

      this.setCache(cacheKey, losers);
      return losers;
    } catch (error) {
      console.error('DexScreener: Failed to fetch losers:', error);
      return [];
    }
  }

  async getVolumeLeaders(limit: number = 10): Promise<TrendingToken[]> {
    const cacheKey = `volume:${limit}`;
    const cached = this.getCached<TrendingToken[]>(cacheKey);
    if (cached) return cached;

    try {
      const trending = await this.fetchSolanaPairsFromBoosts();
      const leaders = trending
        .sort((a: DexScreenerPair, b: DexScreenerPair) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
        .slice(0, limit)
        .map((p: DexScreenerPair) => this.pairToTrendingToken(p));

      this.setCache(cacheKey, leaders);
      return leaders;
    } catch (error) {
      console.error('DexScreener: Failed to fetch volume leaders:', error);
      return [];
    }
  }

  async getNewTokens(maxAgeHours: number = 24, limit: number = 10): Promise<TrendingToken[]> {
    const cacheKey = `new:${maxAgeHours}:${limit}`;
    const cached = this.getCached<TrendingToken[]>(cacheKey);
    if (cached) return cached;

    try {
      const trending = await this.fetchSolanaPairsFromBoosts();
      const now = Date.now();
      const maxAge = maxAgeHours * 60 * 60 * 1000;

      const newTokens = trending
        .filter((p: DexScreenerPair) => {
          if (!p.pairCreatedAt) return false;
          return (now - p.pairCreatedAt) <= maxAge;
        })
        .sort((a: DexScreenerPair, b: DexScreenerPair) => (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0))
        .slice(0, limit)
        .map((p: DexScreenerPair) => this.pairToTrendingToken(p));

      this.setCache(cacheKey, newTokens);
      return newTokens;
    } catch (error) {
      console.error('DexScreener: Failed to fetch new tokens:', error);
      return [];
    }
  }

  // Helper to fetch Solana pairs from boosts/profiles
  private async fetchSolanaPairsFromBoosts(): Promise<DexScreenerPair[]> {
    const cacheKey = 'solana_pairs_raw';
    const cached = this.getCached<DexScreenerPair[]>(cacheKey);
    if (cached) return cached;

    try {
      // Try boosts first
      await rateLimiter.acquire();
      const boostsResponse = await withRetry(
        () => axios.get(BOOSTS_URL, { timeout: 10000 }),
        { maxRetries: 2, initialDelayMs: 500 }
      );
      const boosts = boostsResponse.data || [];
      const solanaTokens = boosts.filter((b: any) => b.chainId === 'solana').slice(0, 30);

      // Batch fetch all token data
      const tokenAddresses = solanaTokens.map((t: any) => t.tokenAddress);
      const pairDataMap = await this.getMultipleTokensData(tokenAddresses);

      const pairs: DexScreenerPair[] = [];
      const seenAddresses = new Set<string>();

      for (const token of solanaTokens) {
        const pairData = pairDataMap.get(token.tokenAddress);
        if (pairData && pairData.baseToken.symbol !== 'SOL' && (pairData.liquidity?.usd || 0) >= 500) {
          if (!seenAddresses.has(pairData.baseToken.address)) {
            pairs.push(pairData);
            seenAddresses.add(pairData.baseToken.address);
          }
        }
      }

      // If not enough from boosts, try profiles
      if (pairs.length < 10) {
        await rateLimiter.acquire();
        const profilesResponse = await withRetry(
          () => axios.get(PROFILES_URL, { timeout: 10000 }),
          { maxRetries: 2, initialDelayMs: 500 }
        );
        const profiles = profilesResponse.data || [];
        const solanaProfiles = profiles.filter((p: any) => p.chainId === 'solana').slice(0, 30);

        // Batch fetch profiles tokens
        const profileAddresses = solanaProfiles.map((p: any) => p.tokenAddress);
        const profilePairMap = await this.getMultipleTokensData(profileAddresses);

        for (const profile of solanaProfiles) {
          const pairData = profilePairMap.get(profile.tokenAddress);
          if (pairData && pairData.baseToken.symbol !== 'SOL' && (pairData.liquidity?.usd || 0) >= 500) {
            if (!seenAddresses.has(pairData.baseToken.address)) {
              pairs.push(pairData);
              seenAddresses.add(pairData.baseToken.address);
            }
          }
        }
      }

      this.setCache(cacheKey, pairs);
      return pairs;
    } catch (error) {
      console.error('DexScreener: Failed to fetch Solana pairs:', error);
      return [];
    }
  }

  private pairToTrendingToken(pair: DexScreenerPair): TrendingToken {
    return {
      mint: pair.baseToken.address,
      symbol: pair.baseToken.symbol,
      name: pair.baseToken.name,
      priceUsd: parseFloat(pair.priceUsd || '0'),
      priceChange1h: pair.priceChange?.h1 || 0,
      priceChange24h: pair.priceChange?.h24 || 0,
      volume1h: pair.volume?.h1 || 0,
      volume24h: pair.volume?.h24 || 0,
      liquidity: pair.liquidity?.usd || 0,
      marketCap: pair.marketCap,
      txns24h: {
        buys: pair.txns?.h24?.buys || 0,
        sells: pair.txns?.h24?.sells || 0,
      },
      pairAddress: pair.pairAddress,
      dexId: pair.dexId,
      createdAt: pair.pairCreatedAt,
    };
  }

  /**
   * Get pair data by pair address
   */
  async getPairByAddress(pairAddress: string): Promise<DexScreenerPair | null> {
    const cacheKey = `pair:${pairAddress}`;
    const cached = this.getCached<DexScreenerPair>(cacheKey);
    if (cached) return cached;

    try {
      await rateLimiter.acquire();
      const response = await withRetry(
        () => this.client.get<DexScreenerResponse>(`/pairs/solana/${pairAddress}`),
        { maxRetries: 2, initialDelayMs: 500 }
      );
      const pairs = response.data.pairs || [];
      if (pairs.length === 0) return null;

      const pair = pairs[0];
      this.setCache(cacheKey, pair);
      return pair;
    } catch (error) {
      console.error(`DexScreener: Failed to fetch pair ${pairAddress}:`, error);
      return null;
    }
  }

  /**
   * Get multiple pairs by addresses in batch
   */
  async getMultiplePairs(pairAddresses: string[]): Promise<Map<string, DexScreenerPair>> {
    const results = new Map<string, DexScreenerPair>();
    if (pairAddresses.length === 0) return results;

    // Check cache first
    const uncached: string[] = [];
    for (const addr of pairAddresses) {
      const cached = this.getCached<DexScreenerPair>(`pair:${addr}`);
      if (cached) {
        results.set(addr, cached);
      } else {
        uncached.push(addr);
      }
    }

    if (uncached.length === 0) return results;

    // DexScreener pairs endpoint supports comma-separated addresses
    const batchSize = 30;
    for (let i = 0; i < uncached.length; i += batchSize) {
      const batch = uncached.slice(i, i + batchSize);
      try {
        await rateLimiter.acquire();
        const response = await withRetry(
          () => this.client.get<DexScreenerResponse>(`/pairs/solana/${batch.join(',')}`),
          { maxRetries: 2, initialDelayMs: 500 }
        );

        for (const pair of response.data.pairs || []) {
          this.setCache(`pair:${pair.pairAddress}`, pair);
          results.set(pair.pairAddress, pair);
        }
      } catch (error) {
        console.error(`DexScreener: Batch pair fetch failed:`, error);
      }
    }

    return results;
  }

  /**
   * Get token profile with social links and additional info
   */
  async getTokenProfile(tokenAddress: string): Promise<{
    socials: { type: string; url: string }[];
    websites: { label: string; url: string }[];
    imageUrl?: string;
    description?: string;
  } | null> {
    const pairs = await this.getTokenPairs(tokenAddress);
    if (pairs.length === 0) return null;

    // Get the best pair with most info
    const pairWithInfo = pairs.find(p => p.info) || pairs[0];
    if (!pairWithInfo.info) return null;

    return {
      socials: pairWithInfo.info.socials || [],
      websites: pairWithInfo.info.websites || [],
      imageUrl: pairWithInfo.info.imageUrl,
      description: undefined, // DexScreener doesn't provide description
    };
  }

  /**
   * Get recently created pairs (more reliable than token-boosts for new tokens)
   */
  async getRecentPairs(maxAgeMinutes: number = 30, limit: number = 20): Promise<TrendingToken[]> {
    const cacheKey = `recent:${maxAgeMinutes}:${limit}`;
    const cached = this.getCached<TrendingToken[]>(cacheKey);
    if (cached) return cached;

    try {
      // Use search to find new Solana pairs
      await rateLimiter.acquire();
      const response = await withRetry(
        () => this.client.get<DexScreenerResponse>('/search?q=solana'),
        { maxRetries: 2, initialDelayMs: 500 }
      );

      const now = Date.now();
      const maxAge = maxAgeMinutes * 60 * 1000;

      const recentPairs = (response.data.pairs || [])
        .filter(p => {
          if (p.chainId !== 'solana') return false;
          if (!p.pairCreatedAt) return false;
          if ((now - p.pairCreatedAt) > maxAge) return false;
          if ((p.liquidity?.usd || 0) < 500) return false;
          return true;
        })
        .sort((a, b) => (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0))
        .slice(0, limit)
        .map(p => this.pairToTrendingToken(p));

      this.setCache(cacheKey, recentPairs);
      return recentPairs;
    } catch (error) {
      console.error('DexScreener: Failed to fetch recent pairs:', error);
      return [];
    }
  }

  /**
   * Enhanced token data with buy/sell ratio analysis
   */
  async getTokenWithBuySellAnalysis(tokenAddress: string): Promise<{
    pair: DexScreenerPair;
    buySellRatio1h: number;
    buySellRatio24h: number;
    isBuyPressure: boolean;
    volumeToLiquidityRatio: number;
  } | null> {
    const pair = await this.getTokenData(tokenAddress);
    if (!pair) return null;

    const buys1h = pair.txns?.h1?.buys || 0;
    const sells1h = pair.txns?.h1?.sells || 0;
    const buys24h = pair.txns?.h24?.buys || 0;
    const sells24h = pair.txns?.h24?.sells || 0;

    const buySellRatio1h = sells1h > 0 ? buys1h / sells1h : buys1h > 0 ? Infinity : 1;
    const buySellRatio24h = sells24h > 0 ? buys24h / sells24h : buys24h > 0 ? Infinity : 1;

    const volume24h = pair.volume?.h24 || 0;
    const liquidity = pair.liquidity?.usd || 0;
    const volumeToLiquidityRatio = liquidity > 0 ? volume24h / liquidity : 0;

    return {
      pair,
      buySellRatio1h,
      buySellRatio24h,
      isBuyPressure: buySellRatio1h > 1.2 && buySellRatio24h > 1,
      volumeToLiquidityRatio,
    };
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const dexScreenerService = new DexScreenerService();
