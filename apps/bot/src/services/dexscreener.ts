import type { DexScreenerPair, DexScreenerResponse, TrendingToken } from '../types';
import { ResilientApiClient, validators } from './resilientApi';
import { logger } from '../utils/logger';

const BASE_URL = 'https://api.dexscreener.com/latest/dex';
const BOOSTS_URL = 'https://api.dexscreener.com/token-boosts/latest/v1';
const PROFILES_URL = 'https://api.dexscreener.com/token-profiles/latest/v1';

// ============================================
// Resilient DexScreener Client
// ============================================

class DexScreenerService {
  private api: ResilientApiClient;
  private boostsApi: ResilientApiClient;
  private profilesApi: ResilientApiClient;

  constructor() {
    // Main API client (rate limit: 10 req/2s = 5 req/s)
    this.api = new ResilientApiClient({
      name: 'DexScreener',
      baseURL: BASE_URL,
      timeout: 15000,
      maxRetries: 3,
      rateLimit: { maxTokens: 10, refillRate: 5 },
      circuitBreaker: { threshold: 5, resetTimeMs: 60000 },
      cacheTTL: 300000, // 5 minutes
      headers: {
        'Accept': 'application/json',
      },
    });

    // Boosts API (separate client to avoid rate limit conflicts)
    this.boostsApi = new ResilientApiClient({
      name: 'DexScreener-Boosts',
      baseURL: BOOSTS_URL.replace('/latest/v1', ''),
      timeout: 15000,
      maxRetries: 2,
      rateLimit: { maxTokens: 5, refillRate: 2 },
      circuitBreaker: { threshold: 5, resetTimeMs: 60000 },
      cacheTTL: 60000, // 1 minute for trending data
    });

    // Profiles API
    this.profilesApi = new ResilientApiClient({
      name: 'DexScreener-Profiles',
      baseURL: PROFILES_URL.replace('/latest/v1', ''),
      timeout: 15000,
      maxRetries: 2,
      rateLimit: { maxTokens: 5, refillRate: 2 },
      circuitBreaker: { threshold: 5, resetTimeMs: 60000 },
      cacheTTL: 60000,
    });
  }

  // ============================================
  // Core API Methods
  // ============================================

  /**
   * Get all pairs for a token address
   */
  async getTokenPairs(tokenAddress: string): Promise<DexScreenerPair[]> {
    const response = await this.api.get<DexScreenerResponse>(
      `/tokens/${tokenAddress}`,
      {
        cache: true,
        cacheKey: `token:${tokenAddress}`,
        cacheTTL: 300000, // 5 minutes
        validator: validators.hasFields(['pairs']),
        transform: (data) => data,
      }
    );

    if (response.error || !response.data) {
      logger.warn('DexScreener', `Failed to fetch token ${tokenAddress}: ${response.error}`);
      return [];
    }

    const pairs = response.data.pairs || [];
    // Filter for Solana pairs only
    return pairs.filter(p => p.chainId === 'solana');
  }

  /**
   * Get best pair for a token (highest liquidity)
   */
  async getTokenData(tokenAddress: string): Promise<DexScreenerPair | null> {
    const pairs = await this.getTokenPairs(tokenAddress);
    if (pairs.length === 0) return null;

    // Return pair with highest liquidity
    return pairs.reduce((best, current) => {
      const bestLiq = best.liquidity?.usd || 0;
      const currentLiq = current.liquidity?.usd || 0;
      return currentLiq > bestLiq ? current : best;
    });
  }

  /**
   * Alias for getTokenData (backward compatibility)
   */
  async getPair(tokenAddress: string): Promise<DexScreenerPair | null> {
    return this.getTokenData(tokenAddress);
  }

  /**
   * Batch fetch multiple tokens (up to 30 per request)
   */
  async getMultipleTokensData(tokenAddresses: string[]): Promise<Map<string, DexScreenerPair>> {
    const results = new Map<string, DexScreenerPair>();
    if (tokenAddresses.length === 0) return results;

    const batchSize = 30;
    const batches: string[][] = [];
    for (let i = 0; i < tokenAddresses.length; i += batchSize) {
      batches.push(tokenAddresses.slice(i, i + batchSize));
    }

    for (const batch of batches) {
      const response = await this.api.get<DexScreenerResponse>(
        `/tokens/${batch.join(',')}`,
        {
          cache: true,
          cacheKey: `tokens:batch:${batch.join(',')}`,
          cacheTTL: 300000,
          validator: (data) => data && typeof data === 'object',
        }
      );

      if (response.error || !response.data) {
        logger.warn('DexScreener', `Batch fetch failed: ${response.error}`);
        continue;
      }

      const pairs = response.data.pairs || [];
      const solanaPairs = pairs.filter(p => p.chainId === 'solana');

      // Group pairs by token and get best for each
      const pairsByToken = new Map<string, DexScreenerPair[]>();
      for (const pair of solanaPairs) {
        const addr = pair.baseToken.address;
        if (!pairsByToken.has(addr)) {
          pairsByToken.set(addr, []);
        }
        pairsByToken.get(addr)!.push(pair);
      }

      for (const [addr, tokenPairs] of pairsByToken) {
        if (tokenPairs.length > 0) {
          const best = tokenPairs.reduce((a, b) =>
            (b.liquidity?.usd || 0) > (a.liquidity?.usd || 0) ? b : a
          );
          results.set(addr, best);
        }
      }
    }

    return results;
  }

  /**
   * Search tokens by query
   */
  async searchTokens(query: string): Promise<DexScreenerPair[]> {
    const response = await this.api.get<DexScreenerResponse>(
      `/search?q=${encodeURIComponent(query)}`,
      {
        cache: true,
        cacheKey: `search:${query}`,
        cacheTTL: 180000, // 3 minutes
        validator: (data) => data && typeof data === 'object',
      }
    );

    if (response.error || !response.data) {
      logger.warn('DexScreener', `Search failed for "${query}": ${response.error}`);
      return [];
    }

    const pairs = response.data.pairs || [];
    return pairs.filter(p => p.chainId === 'solana');
  }

  // ============================================
  // Trending & Discovery
  // ============================================

  /**
   * Get trending tokens from boosts/profiles
   */
  async getTrendingTokens(limit: number = 10, minLiquidity: number = 1000, minMcap: number = 0, minAgeDays: number = 0): Promise<TrendingToken[]> {
    // Try boosts endpoint first
    const boostsResponse = await this.boostsApi.get<any[]>(
      '/latest/v1',
      {
        cache: true,
        cacheKey: `boosts:trending:${limit}`,
        cacheTTL: 60000, // 1 minute
        validator: validators.isArray(0),
      }
    );

    let solanaTokens: any[] = [];

    if (!boostsResponse.error && boostsResponse.data) {
      solanaTokens = boostsResponse.data
        .filter((b: any) => b.chainId === 'solana')
        .slice(0, limit * 2);
    }

    // Fallback to profiles if no boosts
    if (solanaTokens.length === 0) {
      return await this.getTrendingFromProfiles(limit);
    }

    // Batch fetch token data
    const tokenAddresses = solanaTokens.map((t: any) => t.tokenAddress);
    const pairDataMap = await this.getMultipleTokensData(tokenAddresses);

    const trending: TrendingToken[] = [];
    const maxAgeDays = minAgeDays * 24 * 60 * 60 * 1000; // Convert days to milliseconds
    const now = Date.now();

    for (const token of solanaTokens) {
      if (trending.length >= limit) break;
      const pairData = pairDataMap.get(token.tokenAddress);
      if (pairData && pairData.baseToken.symbol !== 'SOL' && (pairData.liquidity?.usd || 0) >= minLiquidity) {
        // Apply market cap filter
        if (minMcap > 0 && (pairData.marketCap || 0) < minMcap) continue;

        // Apply age filter
        if (minAgeDays > 0 && pairData.pairCreatedAt && (now - pairData.pairCreatedAt) < maxAgeDays) continue;

        trending.push(this.pairToTrendingToken(pairData));
      }
    }

    // Fill with profiles if not enough
    if (trending.length < limit) {
      const profileTokens = await this.getTrendingFromProfiles(limit - trending.length, minLiquidity, minMcap, minAgeDays);
      trending.push(...profileTokens);
    }

    return trending.slice(0, limit);
  }

  private async getTrendingFromProfiles(limit: number, minLiquidity: number = 1000, minMcap: number = 0, minAgeDays: number = 0): Promise<TrendingToken[]> {
    const response = await this.profilesApi.get<any[]>(
      '/latest/v1',
      {
        cache: true,
        cacheKey: `profiles:trending:${limit}`,
        cacheTTL: 60000,
        validator: validators.isArray(0),
      }
    );

    if (response.error || !response.data) {
      logger.warn('DexScreener', `Failed to fetch profiles: ${response.error}`);
      return [];
    }

    const solanaProfiles = response.data
      .filter((p: any) => p.chainId === 'solana')
      .slice(0, limit * 2);

    const tokenAddresses = solanaProfiles.map((p: any) => p.tokenAddress);
    const pairDataMap = await this.getMultipleTokensData(tokenAddresses);

    const trending: TrendingToken[] = [];
    const maxAgeDays = minAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (const profile of solanaProfiles) {
      if (trending.length >= limit) break;
      const pairData = pairDataMap.get(profile.tokenAddress);
      if (pairData && pairData.baseToken.symbol !== 'SOL' && (pairData.liquidity?.usd || 0) >= minLiquidity) {
        // Apply market cap filter
        if (minMcap > 0 && (pairData.marketCap || 0) < minMcap) continue;

        // Apply age filter
        if (minAgeDays > 0 && pairData.pairCreatedAt && (now - pairData.pairCreatedAt) < maxAgeDays) continue;

        trending.push(this.pairToTrendingToken(pairData));
      }
    }

    return trending;
  }

  /**
   * Get top gainers
   */
  async getTopGainers(limit: number = 10, minLiquidity: number = 500, minMcap: number = 0, minAgeDays: number = 0): Promise<TrendingToken[]> {
    const trending = await this.fetchSolanaPairsFromBoosts(minLiquidity, minMcap, minAgeDays);
    return trending
      .filter((p: DexScreenerPair) => (p.priceChange?.h24 || 0) > 0)
      .sort((a: DexScreenerPair, b: DexScreenerPair) => (b.priceChange?.h24 || 0) - (a.priceChange?.h24 || 0))
      .slice(0, limit)
      .map((p: DexScreenerPair) => this.pairToTrendingToken(p));
  }

  /**
   * Get top losers
   */
  async getTopLosers(limit: number = 10, minLiquidity: number = 500, minMcap: number = 0, minAgeDays: number = 0): Promise<TrendingToken[]> {
    const trending = await this.fetchSolanaPairsFromBoosts(minLiquidity, minMcap, minAgeDays);
    return trending
      .filter((p: DexScreenerPair) => (p.priceChange?.h24 || 0) < 0)
      .sort((a: DexScreenerPair, b: DexScreenerPair) => (a.priceChange?.h24 || 0) - (b.priceChange?.h24 || 0))
      .slice(0, limit)
      .map((p: DexScreenerPair) => this.pairToTrendingToken(p));
  }

  /**
   * Get volume leaders
   */
  async getVolumeLeaders(limit: number = 10, minLiquidity: number = 500, minMcap: number = 0, minAgeDays: number = 0): Promise<TrendingToken[]> {
    const trending = await this.fetchSolanaPairsFromBoosts(minLiquidity, minMcap, minAgeDays);
    return trending
      .sort((a: DexScreenerPair, b: DexScreenerPair) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
      .slice(0, limit)
      .map((p: DexScreenerPair) => this.pairToTrendingToken(p));
  }

  /**
   * Get new tokens
   */
  async getNewTokens(maxAgeHours: number = 24, limit: number = 10): Promise<TrendingToken[]> {
    const trending = await this.fetchSolanaPairsFromBoosts();
    const now = Date.now();
    const maxAge = maxAgeHours * 60 * 60 * 1000;

    return trending
      .filter((p: DexScreenerPair) => {
        if (!p.pairCreatedAt) return false;
        return (now - p.pairCreatedAt) <= maxAge;
      })
      .sort((a: DexScreenerPair, b: DexScreenerPair) => (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0))
      .slice(0, limit)
      .map((p: DexScreenerPair) => this.pairToTrendingToken(p));
  }

  // ============================================
  // Pair Methods
  // ============================================

  /**
   * Get pair by address
   */
  async getPairByAddress(pairAddress: string): Promise<DexScreenerPair | null> {
    const response = await this.api.get<DexScreenerResponse>(
      `/pairs/solana/${pairAddress}`,
      {
        cache: true,
        cacheKey: `pair:${pairAddress}`,
        cacheTTL: 300000,
        validator: validators.hasFields(['pairs']),
      }
    );

    if (response.error || !response.data) {
      logger.warn('DexScreener', `Failed to fetch pair ${pairAddress}: ${response.error}`);
      return null;
    }

    const pairs = response.data.pairs || [];
    return pairs.length > 0 ? pairs[0] : null;
  }

  /**
   * Get multiple pairs in batch
   */
  async getMultiplePairs(pairAddresses: string[]): Promise<Map<string, DexScreenerPair>> {
    const results = new Map<string, DexScreenerPair>();
    if (pairAddresses.length === 0) return results;

    const batchSize = 30;
    for (let i = 0; i < pairAddresses.length; i += batchSize) {
      const batch = pairAddresses.slice(i, i + batchSize);
      const response = await this.api.get<DexScreenerResponse>(
        `/pairs/solana/${batch.join(',')}`,
        {
          cache: true,
          cacheKey: `pairs:batch:${batch.join(',')}`,
          cacheTTL: 300000,
        }
      );

      if (response.error || !response.data) {
        logger.warn('DexScreener', `Batch pair fetch failed: ${response.error}`);
        continue;
      }

      for (const pair of response.data.pairs || []) {
        results.set(pair.pairAddress, pair);
      }
    }

    return results;
  }

  // ============================================
  // Advanced Features
  // ============================================

  /**
   * Get token profile with social links
   */
  async getTokenProfile(tokenAddress: string): Promise<{
    socials: { type: string; url: string }[];
    websites: { label: string; url: string }[];
    imageUrl?: string;
    description?: string;
  } | null> {
    const pairs = await this.getTokenPairs(tokenAddress);
    if (pairs.length === 0) return null;

    const pairWithInfo = pairs.find(p => p.info) || pairs[0];
    if (!pairWithInfo.info) return null;

    return {
      socials: pairWithInfo.info.socials || [],
      websites: pairWithInfo.info.websites || [],
      imageUrl: pairWithInfo.info.imageUrl,
      description: undefined,
    };
  }

  /**
   * Get token with buy/sell analysis
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

  /**
   * Get recently created pairs
   */
  async getRecentPairs(maxAgeMinutes: number = 30, limit: number = 20): Promise<TrendingToken[]> {
    const response = await this.api.get<DexScreenerResponse>(
      '/search?q=solana',
      {
        cache: true,
        cacheKey: `recent:${maxAgeMinutes}:${limit}`,
        cacheTTL: 60000, // 1 minute
      }
    );

    if (response.error || !response.data) {
      logger.warn('DexScreener', `Failed to fetch recent pairs: ${response.error}`);
      return [];
    }

    const now = Date.now();
    const maxAge = maxAgeMinutes * 60 * 1000;

    return (response.data.pairs || [])
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
  }

  // ============================================
  // Helper Methods
  // ============================================

  private async fetchSolanaPairsFromBoosts(minLiquidity: number = 500, minMcap: number = 0, minAgeDays: number = 0): Promise<DexScreenerPair[]> {
    // Try boosts first
    const boostsResponse = await this.boostsApi.get<any[]>(
      '/latest/v1',
      { cache: true, cacheKey: 'solana_pairs_raw', cacheTTL: 60000 }
    );

    const pairs: DexScreenerPair[] = [];
    const seenAddresses = new Set<string>();
    const maxAgeDays = minAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    if (!boostsResponse.error && boostsResponse.data) {
      const solanaTokens = boostsResponse.data
        .filter((b: any) => b.chainId === 'solana')
        .slice(0, 30);

      const tokenAddresses = solanaTokens.map((t: any) => t.tokenAddress);
      const pairDataMap = await this.getMultipleTokensData(tokenAddresses);

      for (const token of solanaTokens) {
        const pairData = pairDataMap.get(token.tokenAddress);
        if (pairData && pairData.baseToken.symbol !== 'SOL' && (pairData.liquidity?.usd || 0) >= minLiquidity) {
          // Apply market cap filter
          if (minMcap > 0 && (pairData.marketCap || 0) < minMcap) continue;

          // Apply age filter
          if (minAgeDays > 0 && pairData.pairCreatedAt && (now - pairData.pairCreatedAt) < maxAgeDays) continue;

          if (!seenAddresses.has(pairData.baseToken.address)) {
            pairs.push(pairData);
            seenAddresses.add(pairData.baseToken.address);
          }
        }
      }
    }

    // Fill from profiles if not enough
    if (pairs.length < 10) {
      const profilesResponse = await this.profilesApi.get<any[]>(
        '/latest/v1',
        { cache: true, cacheTTL: 60000 }
      );

      if (!profilesResponse.error && profilesResponse.data) {
        const solanaProfiles = profilesResponse.data
          .filter((p: any) => p.chainId === 'solana')
          .slice(0, 30);

        const profileAddresses = solanaProfiles.map((p: any) => p.tokenAddress);
        const profilePairMap = await this.getMultipleTokensData(profileAddresses);

        for (const profile of solanaProfiles) {
          const pairData = profilePairMap.get(profile.tokenAddress);
          if (pairData && pairData.baseToken.symbol !== 'SOL' && (pairData.liquidity?.usd || 0) >= minLiquidity) {
            // Apply market cap filter
            if (minMcap > 0 && (pairData.marketCap || 0) < minMcap) continue;

            // Apply age filter
            if (minAgeDays > 0 && pairData.pairCreatedAt && (now - pairData.pairCreatedAt) < maxAgeDays) continue;

            if (!seenAddresses.has(pairData.baseToken.address)) {
              pairs.push(pairData);
              seenAddresses.add(pairData.baseToken.address);
            }
          }
        }
      }
    }

    return pairs;
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

  // ============================================
  // Utility Methods
  // ============================================

  clearCache(): void {
    this.api.clearCache();
    this.boostsApi.clearCache();
    this.profilesApi.clearCache();
  }

  getStats(): {
    main: any;
    boosts: any;
    profiles: any;
  } {
    return {
      main: this.api.getStats(),
      boosts: this.boostsApi.getStats(),
      profiles: this.profilesApi.getStats(),
    };
  }

  isHealthy(): boolean {
    return this.api.isHealthy();
  }
}

export const dexScreenerService = new DexScreenerService();
