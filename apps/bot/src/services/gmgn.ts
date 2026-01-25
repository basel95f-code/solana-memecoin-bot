import type { GMGNToken, GMGNResponse, SmartMoneyActivity, TrendingToken } from '../types';
import { ResilientApiClient, validators } from './resilientApi';
import { logger } from '../utils/logger';
import { flareSolverr } from './flaresolverr';
import { gmgnScraper } from './gmgnScraper';

const BASE_URL = 'https://gmgn.ai/defi/quotation/v1';

// Track GMGN availability
let gmgnDirectBlocked = false;
let lastAvailabilityCheck = 0;
const AVAILABILITY_CHECK_INTERVAL = 60000; // Re-check every minute

type TimeFrame = '1m' | '5m' | '1h' | '6h' | '24h';
type OrderBy = 'smartmoney' | 'volume' | 'marketcap' | 'swaps' | 'holder_count' | 'open_timestamp' | 'liquidity';

// ============================================
// Resilient GMGN Client
// ============================================

class GMGNService {
  private api: ResilientApiClient;

  constructor() {
    // Conservative rate limiting (GMGN uses Cloudflare protection)
    this.api = new ResilientApiClient({
      name: 'GMGN',
      baseURL: BASE_URL,
      timeout: 15000,
      maxRetries: 2,
      rateLimit: { maxTokens: 5, refillRate: 0.5 }, // 5 tokens, 0.5/sec refill
      circuitBreaker: { threshold: 5, resetTimeMs: 60000 },
      cacheTTL: 30000, // 30 seconds (GMGN updates frequently)
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://gmgn.ai',
        'Referer': 'https://gmgn.ai/',
      },
    });
  }

  // ============================================
  // Core API Methods
  // ============================================

  /**
   * Check if GMGN API is currently available
   */
  isAvailable(): boolean {
    return this.api.isHealthy();
  }

  /**
   * Fetch trending tokens with robust error handling and Cloudflare bypass
   */
  async getTrending(
    timeFrame: TimeFrame = '1h',
    orderBy: OrderBy = 'volume',
    limit: number = 20,
    filters: string[] = ['not_honeypot']
  ): Promise<GMGNToken[]> {
    const now = Date.now();

    // Check if we should skip entirely
    if (!this.api.isHealthy() && (now - lastAvailabilityCheck) < AVAILABILITY_CHECK_INTERVAL) {
      logger.info('GMGN', 'Circuit breaker open, skipping request');
      return [];
    }

    const filterParams = filters.map(f => `filters[]=${f}`).join('&');
    const urlPath = `/rank/sol/swaps/${timeFrame}?orderby=${orderBy}&direction=desc&${filterParams}`;

    // Try direct request first if not blocked
    if (!gmgnDirectBlocked) {
      const response = await this.api.get<GMGNResponse>(
        urlPath,
        {
          cache: true,
          cacheKey: `trending:${timeFrame}:${orderBy}:${limit}:${filters.join(',')}`,
          cacheTTL: 30000,
          validator: validators.all(
            validators.hasFields(['code']),
            (data) => data.code === 0 || data.code === '0'
          ),
        }
      );

      // Success with direct request
      if (!response.error && response.data && response.data.code === 0) {
        gmgnDirectBlocked = false;
        lastAvailabilityCheck = now;
        const tokens = (response.data.data?.rank || []).slice(0, limit);
        return tokens;
      }

      // Check if it's a 403 (Cloudflare block)
      if (response.error && response.error.includes('403')) {
        gmgnDirectBlocked = true;
        logger.warn('GMGN', 'Cloudflare blocked direct request, trying fallback methods');
      } else if (response.error) {
        logger.warn('GMGN', `API request failed: ${response.error}`);
        return [];
      }
    }

    // Fallback to FlareSolverr if available
    if (gmgnDirectBlocked && flareSolverr.available) {
      const fullUrl = `${BASE_URL}${urlPath}`;
      const result = await this.fetchViaFlareSolverr(fullUrl, limit);
      if (result) {
        lastAvailabilityCheck = now;
        return result;
      }
    }

    // Last resort: web scraping
    logger.warn('GMGN', 'Trying web scraping as last resort');
    const scraped = await this.fetchViaScraping(limit);
    if (scraped) {
      lastAvailabilityCheck = now;
      return scraped;
    }

    // All methods failed
    lastAvailabilityCheck = now;
    logger.error('GMGN', 'All methods failed (direct, FlareSolverr, scraping)');
    return [];
  }

  /**
   * Fetch via FlareSolverr proxy
   */
  private async fetchViaFlareSolverr(url: string, limit: number): Promise<GMGNToken[] | null> {
    try {
      const response = await flareSolverr.get<GMGNResponse>(url, {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });

      if (!response || response.code !== 0) {
        logger.warn('GMGN', 'FlareSolverr returned invalid response');
        return null;
      }

      logger.info('GMGN', 'Successfully fetched via FlareSolverr');
      return (response.data?.rank || []).slice(0, limit);
    } catch (error: any) {
      logger.error('GMGN', `FlareSolverr request failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch via web scraping (last resort)
   */
  private async fetchViaScraping(limit: number): Promise<GMGNToken[] | null> {
    try {
      const tokens = await gmgnScraper.getTrendingAsGMGNTokens(limit);

      if (tokens.length === 0) {
        logger.warn('GMGN', 'Scraping returned no tokens');
        return null;
      }

      logger.info('GMGN', `Successfully scraped ${tokens.length} tokens from web page`);
      return tokens;
    } catch (error: any) {
      logger.error('GMGN', `Scraping failed: ${error.message}`);
      return null;
    }
  }

  // ============================================
  // Specialized Queries
  // ============================================

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
   * Get token info by address
   */
  async getTokenInfo(address: string): Promise<GMGNToken | null> {
    const response = await this.api.get<{ code: number; data?: { token: GMGNToken } }>(
      `/tokens/sol/${address}`,
      {
        cache: true,
        cacheKey: `token:${address}`,
        cacheTTL: 60000, // 1 minute
        validator: validators.hasFields(['code']),
      }
    );

    if (response.error || !response.data || response.data.code !== 0) {
      if (!response.error || !response.error.includes('404')) {
        logger.warn('GMGN', `Failed to fetch token ${address}: ${response.error || 'Invalid response'}`);
      }
      return null;
    }

    return response.data.data?.token || null;
  }

  /**
   * Get smart money activity for a specific token
   */
  async getSmartMoneyForToken(address: string): Promise<SmartMoneyActivity | null> {
    const token = await this.getTokenInfo(address);
    if (!token) return null;
    return this.extractSmartMoneyActivity(token);
  }

  // ============================================
  // Data Transformation & Analysis
  // ============================================

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
   * Convert GMGN token to TrendingToken format
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

  // ============================================
  // Health & Utility
  // ============================================

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    const response = await this.api.get<GMGNResponse>(
      '/rank/sol/swaps/1h?orderby=volume&direction=desc&limit=1',
      {
        cache: false,
        validator: validators.hasFields(['code']),
      }
    );

    return !response.error && response.data?.code === 0;
  }

  clearCache(): void {
    this.api.clearCache();
  }

  getStats(): any {
    return this.api.getStats();
  }

  resetCircuit(): void {
    this.api.resetCircuit();
    gmgnDirectBlocked = false;
  }
}

export const gmgnService = new GMGNService();
