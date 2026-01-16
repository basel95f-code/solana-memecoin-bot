import axios, { AxiosInstance } from 'axios';
import { GMGNToken, GMGNResponse, SmartMoneyActivity, TrendingToken } from '../types';
import { withRetry, RateLimiter } from '../utils/retry';
import { flareSolverr } from './flaresolverr';

const BASE_URL = 'https://gmgn.ai/defi/quotation/v1';
const CACHE_TTL = 30000; // 30 seconds (GMGN updates frequently)

// Rate limiter for GMGN (be conservative - they use Cloudflare)
const rateLimiter = new RateLimiter(5, 0.5); // 5 tokens, 0.5/sec refill

// Track if GMGN is available (Cloudflare may block)
let gmgnAvailable = true;
let gmgnDirectBlocked = false; // Track if direct requests are blocked
let lastAvailabilityCheck = 0;
const AVAILABILITY_CHECK_INTERVAL = 60000; // Re-check every minute

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

type TimeFrame = '1m' | '5m' | '1h' | '6h' | '24h';
type OrderBy = 'smartmoney' | 'volume' | 'marketcap' | 'swaps' | 'holder_count' | 'open_timestamp' | 'liquidity';

class GMGNService {
  private client: AxiosInstance;
  private cache: Map<string, CacheEntry<any>> = new Map();

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 15000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://gmgn.ai',
        'Referer': 'https://gmgn.ai/',
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

  /**
   * Check if GMGN API is currently available
   */
  isAvailable(): boolean {
    return gmgnAvailable;
  }

  /**
   * Fetch trending tokens from GMGN with various sorting options
   * Uses FlareSolverr to bypass Cloudflare when direct requests are blocked
   */
  async getTrending(
    timeFrame: TimeFrame = '1h',
    orderBy: OrderBy = 'volume',
    limit: number = 20,
    filters: string[] = ['not_honeypot']
  ): Promise<GMGNToken[]> {
    const now = Date.now();

    // Check if we should skip entirely
    if (!gmgnAvailable && (now - lastAvailabilityCheck) < AVAILABILITY_CHECK_INTERVAL) {
      return [];
    }

    const cacheKey = `trending:${timeFrame}:${orderBy}:${limit}:${filters.join(',')}`;
    const cached = this.getCached<GMGNToken[]>(cacheKey);
    if (cached) return cached;

    // Build full URL
    const filterParams = filters.map(f => `filters[]=${f}`).join('&');
    const urlPath = `/rank/sol/swaps/${timeFrame}?orderby=${orderBy}&direction=desc&${filterParams}`;
    const fullUrl = `${BASE_URL}${urlPath}`;

    // Try FlareSolverr first if direct requests are blocked
    if (gmgnDirectBlocked && flareSolverr.available) {
      const result = await this.fetchViaFlareSolverr(fullUrl, cacheKey, limit);
      if (result) return result;
    }

    // Try direct request
    try {
      await rateLimiter.acquire();

      const response = await withRetry(
        () => this.client.get<GMGNResponse>(urlPath),
        { maxRetries: 2, initialDelayMs: 1000 }
      );

      if (response.data.code !== 0) {
        console.error(`GMGN API error: ${response.data.msg}`);
        return [];
      }

      // Mark as available - direct requests work
      gmgnAvailable = true;
      gmgnDirectBlocked = false;
      lastAvailabilityCheck = now;

      const tokens = (response.data.data?.rank || []).slice(0, limit);
      this.setCache(cacheKey, tokens);
      return tokens;
    } catch (error: any) {
      lastAvailabilityCheck = now;

      // Handle Cloudflare blocking - try FlareSolverr as fallback
      if (error.response?.status === 403) {
        gmgnDirectBlocked = true;
        console.warn('GMGN: Cloudflare blocked direct request. Trying FlareSolverr...');

        // Try FlareSolverr as fallback
        const result = await this.fetchViaFlareSolverr(fullUrl, cacheKey, limit);
        if (result) return result;

        // Both failed
        gmgnAvailable = false;
        console.warn('GMGN: FlareSolverr not available. Will retry in 60s.');
      } else {
        console.error('GMGN: Failed to fetch trending:', error.message);
      }
      return [];
    }
  }

  /**
   * Fetch data via FlareSolverr proxy
   */
  private async fetchViaFlareSolverr(url: string, cacheKey: string, limit: number): Promise<GMGNToken[] | null> {
    try {
      const response = await flareSolverr.get<GMGNResponse>(url, {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });

      if (!response || response.code !== 0) {
        return null;
      }

      // Success via FlareSolverr
      gmgnAvailable = true;
      console.log('GMGN: Successfully fetched via FlareSolverr');

      const tokens = (response.data?.rank || []).slice(0, limit);
      this.setCache(cacheKey, tokens);
      return tokens;
    } catch (error: any) {
      console.error('GMGN: FlareSolverr request failed:', error.message);
      return null;
    }
  }

  /**
   * Get smart money activity - tokens with high smart money buying
   */
  async getSmartMoneyTokens(
    timeFrame: TimeFrame = '6h',
    limit: number = 20
  ): Promise<GMGNToken[]> {
    return this.getTrending(timeFrame, 'smartmoney', limit, ['not_honeypot', 'renounced']);
  }

  /**
   * Get newly created tokens
   */
  async getNewTokens(
    timeFrame: TimeFrame = '1h',
    limit: number = 20
  ): Promise<GMGNToken[]> {
    return this.getTrending(timeFrame, 'open_timestamp', limit, ['not_honeypot']);
  }

  /**
   * Get high volume tokens
   */
  async getHighVolume(
    timeFrame: TimeFrame = '24h',
    limit: number = 20
  ): Promise<GMGNToken[]> {
    return this.getTrending(timeFrame, 'volume', limit, ['not_honeypot']);
  }

  /**
   * Get tokens with growing holder count
   */
  async getGrowingHolders(
    timeFrame: TimeFrame = '6h',
    limit: number = 20
  ): Promise<GMGNToken[]> {
    return this.getTrending(timeFrame, 'holder_count', limit, ['not_honeypot']);
  }

  /**
   * Extract smart money activity metrics from GMGN token data
   */
  extractSmartMoneyActivity(token: GMGNToken): SmartMoneyActivity {
    const smartBuys = token.smart_buy_24h || 0;
    const smartSells = token.smart_sell_24h || 0;
    const netSmartMoney = smartBuys - smartSells;

    return {
      mint: token.address,
      symbol: token.symbol,
      smartBuys24h: smartBuys,
      smartSells24h: smartSells,
      netSmartMoney,
      smartMoneyHolding: token.smart_money_holding || 0,
      isSmartMoneyBullish: netSmartMoney > 0 && smartBuys > 2,
    };
  }

  /**
   * Convert GMGN token to TrendingToken format for unified handling
   */
  toTrendingToken(token: GMGNToken): TrendingToken {
    return {
      mint: token.address,
      symbol: token.symbol,
      name: token.name,
      priceUsd: token.price || 0,
      priceChange1h: token.price_change_1h || 0,
      priceChange24h: token.price_change_24h || 0,
      volume1h: 0, // GMGN doesn't provide 1h volume directly
      volume24h: token.volume_24h || 0,
      liquidity: token.liquidity || 0,
      marketCap: token.market_cap,
      txns24h: {
        buys: token.buys || 0,
        sells: token.sells || 0,
      },
      pairAddress: token.pool_address || '',
      dexId: token.dex || 'raydium',
      createdAt: token.open_timestamp ? token.open_timestamp * 1000 : undefined,
    };
  }

  /**
   * Get trending tokens in unified TrendingToken format
   */
  async getTrendingUnified(limit: number = 10): Promise<TrendingToken[]> {
    const tokens = await this.getTrending('1h', 'volume', limit);
    return tokens.map(t => this.toTrendingToken(t));
  }

  /**
   * Get smart money picks - tokens smart money is accumulating
   */
  async getSmartMoneyPicks(limit: number = 10): Promise<Array<TrendingToken & { smartMoney: SmartMoneyActivity }>> {
    const tokens = await this.getSmartMoneyTokens('6h', limit * 2);

    return tokens
      .filter(t => {
        const activity = this.extractSmartMoneyActivity(t);
        return activity.isSmartMoneyBullish && activity.netSmartMoney >= 2;
      })
      .slice(0, limit)
      .map(t => ({
        ...this.toTrendingToken(t),
        smartMoney: this.extractSmartMoneyActivity(t),
      }));
  }

  /**
   * Check if GMGN API is accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      await rateLimiter.acquire();
      const response = await this.client.get('/rank/sol/swaps/1h?orderby=volume&direction=desc&limit=1', {
        timeout: 5000,
      });
      return response.data.code === 0;
    } catch {
      return false;
    }
  }

  /**
   * Get token info by address (if available)
   */
  async getTokenInfo(address: string): Promise<GMGNToken | null> {
    const cacheKey = `token:${address}`;
    const cached = this.getCached<GMGNToken>(cacheKey);
    if (cached) return cached;

    try {
      await rateLimiter.acquire();

      // GMGN token info endpoint
      const response = await withRetry(
        () => this.client.get(`/tokens/sol/${address}`),
        { maxRetries: 2, initialDelayMs: 1000 }
      );

      if (response.data.code !== 0 || !response.data.data?.token) {
        return null;
      }

      const token = response.data.data.token;
      this.setCache(cacheKey, token);
      return token;
    } catch (error: any) {
      if (error.response?.status !== 404) {
        console.error(`GMGN: Failed to fetch token ${address}:`, error.message);
      }
      return null;
    }
  }

  /**
   * Get smart money activity for a specific token
   */
  async getSmartMoneyForToken(address: string): Promise<SmartMoneyActivity | null> {
    const token = await this.getTokenInfo(address);
    if (!token) return null;
    return this.extractSmartMoneyActivity(token);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const gmgnService = new GMGNService();
