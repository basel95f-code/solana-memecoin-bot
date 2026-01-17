import axios from 'axios';
import type { GMGNToken } from '../types';

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://localhost:8191/v1';
const GMGN_URL = 'https://gmgn.ai/?chain=sol';
const REQUEST_TIMEOUT = 60000;

interface ScrapedToken {
  address: string;
  symbol: string;
  name: string;
  volume: number;
  marketCap: number;
  txCount: number;
  priceChange: string;
}

class GMGNScraper {
  private lastScrape: number = 0;
  private cachedTokens: ScrapedToken[] = [];
  private cacheTimeout: number = 60000; // 1 minute cache

  /**
   * Scrape trending tokens from GMGN web page via FlareSolverr
   */
  async scrapeTrending(limit: number = 20): Promise<ScrapedToken[]> {
    // Return cached if fresh
    if (Date.now() - this.lastScrape < this.cacheTimeout && this.cachedTokens.length > 0) {
      return this.cachedTokens.slice(0, limit);
    }

    try {
      const response = await axios.post(FLARESOLVERR_URL, {
        cmd: 'request.get',
        url: GMGN_URL,
        maxTimeout: REQUEST_TIMEOUT,
      }, {
        timeout: REQUEST_TIMEOUT + 5000,
      });

      if (response.data.status !== 'ok') {
        console.warn('[GMGNScraper] FlareSolverr request failed:', response.data.message);
        return this.cachedTokens.slice(0, limit);
      }

      const html = response.data.solution.response;
      const tokens = this.parseTokensFromHtml(html);

      if (tokens.length > 0) {
        this.cachedTokens = tokens;
        this.lastScrape = Date.now();
        console.log(`[GMGNScraper] Scraped ${tokens.length} tokens from GMGN`);
      }

      return tokens.slice(0, limit);
    } catch (error: any) {
      console.error('[GMGNScraper] Scrape error:', error.message);
      return this.cachedTokens.slice(0, limit);
    }
  }

  /**
   * Parse token data from GMGN HTML
   */
  private parseTokensFromHtml(html: string): ScrapedToken[] {
    const tokens: ScrapedToken[] = [];

    // Find all token links
    const tokenPattern = /href="\/sol\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})"/g;
    const matches = [...html.matchAll(tokenPattern)];

    for (let i = 0; i < matches.length; i++) {
      const address = matches[i][1];
      const startIdx = matches[i].index!;
      const endIdx = i + 1 < matches.length ? matches[i + 1].index! : startIdx + 5000;

      const rowContent = html.slice(startIdx, endIdx);
      const text = rowContent.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

      // Parse token data from text
      // Format: |ADDRESS_SHORT|SYMBOL|NAME|...|V|$XXX|MC|$XXX|...|TX|XX|...
      const token = this.parseTokenRow(address, text);
      if (token) {
        tokens.push(token);
      }
    }

    return tokens;
  }

  /**
   * Parse a single token row
   */
  private parseTokenRow(address: string, text: string): ScrapedToken | null {
    try {
      const parts = text.split('|').filter(p => p.trim());

      // Find symbol and name
      // Text format: ...ADDR_SHORT|SYMBOL|NAME|...
      // Symbol is typically uppercase, 2-12 chars
      // Name follows symbol
      let symbol = 'UNKNOWN';
      let name = 'Unknown';

      // Find the address shorthand (e.g., "5pXE...BAGS")
      const addrShortPattern = new RegExp(`${address.slice(0, 4)}[.]{3}${address.slice(-4)}`);
      const addrIdx = parts.findIndex(p => addrShortPattern.test(p));

      if (addrIdx >= 0 && addrIdx + 2 < parts.length) {
        // Symbol should be right after address short
        const potentialSymbol = parts[addrIdx + 1];
        const potentialName = parts[addrIdx + 2];

        // Validate symbol (uppercase, 2-12 chars, not a number)
        if (potentialSymbol && /^[A-Z][A-Z0-9]{1,11}$/.test(potentialSymbol) && !/^\d+$/.test(potentialSymbol)) {
          symbol = potentialSymbol;
          name = potentialName || symbol;
        } else if (potentialName && /^[A-Z][A-Z0-9]{1,11}$/.test(potentialName)) {
          // Sometimes symbol is in the next position
          symbol = potentialName;
          name = parts[addrIdx + 3] || symbol;
        }
      }

      // Fallback: search for symbol pattern anywhere in the text
      if (symbol === 'UNKNOWN') {
        // Look for pattern like |SYMBOL| where SYMBOL is 2-10 uppercase chars
        const symbolMatch = text.match(/\|([A-Z][A-Z0-9]{1,9})\|([^|]+)\|/);
        if (symbolMatch) {
          symbol = symbolMatch[1];
          name = symbolMatch[2] || symbol;
        }
      }

      // Extract market cap: $XXX|MC or $XXXK|MC or $XXXM|MC
      let marketCap = 0;
      const mcMatch = text.match(/\$([0-9.]+)(K|M)?\|MC/i);
      if (mcMatch) {
        const value = parseFloat(mcMatch[1]);
        const multiplier = mcMatch[2]?.toUpperCase() === 'M' ? 1000000 : mcMatch[2]?.toUpperCase() === 'K' ? 1000 : 1;
        marketCap = value * multiplier;
      }

      // Extract volume: |V|$XXX or |V|$XXXK
      let volume = 0;
      const volMatch = text.match(/\|V\|\$([0-9.]+)(K|M)?/i);
      if (volMatch) {
        const value = parseFloat(volMatch[1]);
        const multiplier = volMatch[2]?.toUpperCase() === 'M' ? 1000000 : volMatch[2]?.toUpperCase() === 'K' ? 1000 : 1;
        volume = value * multiplier;
      }

      // Extract TX count: |TX|XX
      let txCount = 0;
      const txMatch = text.match(/\|TX\|(\d+)/);
      if (txMatch) {
        txCount = parseInt(txMatch[1]);
      }

      // Extract price change percentage
      let priceChange = '0%';
      const changeMatch = text.match(/(\+?-?\d+\.?\d*)%/);
      if (changeMatch) {
        priceChange = changeMatch[0];
      }

      return {
        address,
        symbol,
        name,
        volume,
        marketCap,
        txCount,
        priceChange,
      };
    } catch {
      return null;
    }
  }

  /**
   * Convert scraped token to GMGNToken format for compatibility
   */
  toGMGNToken(token: ScrapedToken): GMGNToken {
    return {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: 9, // Default for Solana SPL tokens
      price: 0, // Not available from scraping
      market_cap: token.marketCap,
      volume_24h: token.volume,
      liquidity: 0,
      price_change_1h: parseFloat(token.priceChange) || 0,
      price_change_24h: 0,
      buys: token.txCount,
      sells: 0,
      pool_address: '',
      dex: 'unknown',
    };
  }

  /**
   * Get trending tokens in GMGNToken format
   */
  async getTrendingAsGMGNTokens(limit: number = 20): Promise<GMGNToken[]> {
    const scraped = await this.scrapeTrending(limit);
    return scraped.map(t => this.toGMGNToken(t));
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cachedTokens = [];
    this.lastScrape = 0;
  }
}

export const gmgnScraper = new GMGNScraper();
