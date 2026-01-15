import axios, { AxiosInstance } from 'axios';
import { DexScreenerPair, DexScreenerResponse, TrendingToken } from '../types';
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

      // Fetch pair data for each boosted token
      const trending: TrendingToken[] = [];
      for (const token of solanaTokens) {
        if (trending.length >= limit) break;
        try {
          const pairData = await this.getTokenData(token.tokenAddress);
          if (pairData && pairData.baseToken.symbol !== 'SOL' && (pairData.liquidity?.usd || 0) >= 1000) {
            trending.push(this.pairToTrendingToken(pairData));
          }
        } catch (e) {
          // Skip failed tokens
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

      const trending: TrendingToken[] = [];
      for (const profile of solanaProfiles) {
        if (trending.length >= limit) break;
        try {
          const pairData = await this.getTokenData(profile.tokenAddress);
          if (pairData && pairData.baseToken.symbol !== 'SOL' && (pairData.liquidity?.usd || 0) >= 1000) {
            trending.push(this.pairToTrendingToken(pairData));
          }
        } catch (e) {
          // Skip failed tokens
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

      const pairs: DexScreenerPair[] = [];
      for (const token of solanaTokens) {
        try {
          const pairData = await this.getTokenData(token.tokenAddress);
          if (pairData && pairData.baseToken.symbol !== 'SOL' && (pairData.liquidity?.usd || 0) >= 500) {
            pairs.push(pairData);
          }
        } catch (e) {
          // Skip failed tokens
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

        for (const profile of solanaProfiles) {
          try {
            const pairData = await this.getTokenData(profile.tokenAddress);
            if (pairData && pairData.baseToken.symbol !== 'SOL' && (pairData.liquidity?.usd || 0) >= 500) {
              // Check if not already in pairs
              if (!pairs.find(p => p.baseToken.address === pairData.baseToken.address)) {
                pairs.push(pairData);
              }
            }
          } catch (e) {
            // Skip failed tokens
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

  clearCache(): void {
    this.cache.clear();
  }
}

export const dexScreenerService = new DexScreenerService();
