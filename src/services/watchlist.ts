import { config } from '../config';
import { storageService } from './storage';
import { dexScreenerService } from './dexscreener';
import { telegramService } from './telegram';
import { WatchedToken } from '../types';
import { withRetry } from '../utils/retry';
import axios from 'axios';

// Jupiter price API supports batching
const JUPITER_PRICE_API = 'https://price.jup.ag/v6/price';
const BATCH_SIZE = 100; // Max tokens per batch request

interface TokenPriceData {
  price: number;
  mint: string;
}

class WatchlistService {
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly PRICE_CACHE_TTL = 30000; // 30 seconds

  async start(): Promise<void> {
    if (!config.watchlist.enabled) {
      console.log('Watchlist monitoring disabled');
      return;
    }

    if (this.isRunning) return;

    this.isRunning = true;
    console.log(`Watchlist monitoring started (check every ${config.watchlist.checkInterval / 1000}s)`);

    // Initial check
    await this.checkAllWatchlists();

    // Set up periodic checks
    this.checkInterval = setInterval(
      () => this.checkAllWatchlists(),
      config.watchlist.checkInterval
    );
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('Watchlist monitoring stopped');
  }

  private async checkAllWatchlists(): Promise<void> {
    try {
      const chatIds = storageService.getAllWatchlistChatIds();

      if (chatIds.length === 0) return;

      // Collect all unique mints across all watchlists
      const allMints = new Set<string>();
      const chatWatchlists = new Map<string, WatchedToken[]>();

      for (const chatId of chatIds) {
        const watchlist = storageService.getWatchlist(chatId);
        if (watchlist.length > 0) {
          chatWatchlists.set(chatId, watchlist);
          for (const token of watchlist) {
            allMints.add(token.mint);
          }
        }
      }

      if (allMints.size === 0) return;

      // Batch fetch all prices
      const prices = await this.batchFetchPrices(Array.from(allMints));

      // Process each watchlist with the fetched prices
      for (const [chatId, watchlist] of chatWatchlists) {
        try {
          await this.processWatchlist(chatId, watchlist, prices);
        } catch (error) {
          console.error(`Error processing watchlist for ${chatId}:`, error);
        }
      }
    } catch (error) {
      console.error('Error in checkAllWatchlists:', error);
    }
  }

  /**
   * Batch fetch prices for multiple tokens at once
   */
  private async batchFetchPrices(mints: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    // Check cache first and filter out cached prices
    const uncachedMints: string[] = [];
    const now = Date.now();

    for (const mint of mints) {
      const cached = this.priceCache.get(mint);
      if (cached && now - cached.timestamp < this.PRICE_CACHE_TTL) {
        prices.set(mint, cached.price);
      } else {
        uncachedMints.push(mint);
      }
    }

    if (uncachedMints.length === 0) {
      return prices;
    }

    // Fetch uncached prices in batches
    for (let i = 0; i < uncachedMints.length; i += BATCH_SIZE) {
      const batch = uncachedMints.slice(i, i + BATCH_SIZE);
      const batchPrices = await this.fetchPriceBatch(batch);

      for (const [mint, price] of batchPrices) {
        prices.set(mint, price);
        this.priceCache.set(mint, { price, timestamp: now });
      }
    }

    return prices;
  }

  /**
   * Fetch prices for a batch of tokens using Jupiter API
   */
  private async fetchPriceBatch(mints: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    try {
      // Try Jupiter batch price API first
      const ids = mints.join(',');
      const response = await withRetry(
        () => axios.get(JUPITER_PRICE_API, {
          params: { ids },
          timeout: 10000,
        }),
        { maxRetries: 2, initialDelayMs: 500 }
      );

      const data = response.data.data || {};
      for (const mint of mints) {
        if (data[mint]?.price) {
          prices.set(mint, data[mint].price);
        }
      }

      // For any mints without Jupiter data, try DexScreener as fallback
      const missingMints = mints.filter(m => !prices.has(m));
      if (missingMints.length > 0 && missingMints.length <= 10) {
        // Only use fallback for small batches to avoid rate limiting
        for (const mint of missingMints) {
          try {
            const dexData = await dexScreenerService.getTokenData(mint);
            if (dexData?.priceUsd) {
              prices.set(mint, parseFloat(dexData.priceUsd));
            }
          } catch {
            // Ignore individual failures
          }
        }
      }
    } catch (error) {
      console.warn('Batch price fetch failed, falling back to individual fetches');

      // Fallback: fetch individually with small delay
      for (const mint of mints) {
        try {
          const dexData = await dexScreenerService.getTokenData(mint);
          if (dexData?.priceUsd) {
            prices.set(mint, parseFloat(dexData.priceUsd));
          }
          await this.sleep(200); // Rate limiting
        } catch {
          // Ignore individual failures
        }
      }
    }

    return prices;
  }

  /**
   * Process a watchlist with pre-fetched prices
   */
  private async processWatchlist(
    chatId: string,
    watchlist: WatchedToken[],
    prices: Map<string, number>
  ): Promise<void> {
    for (const token of watchlist) {
      const currentPrice = prices.get(token.mint);

      if (!currentPrice) continue;

      const priceChangeFromAdded = token.addedPrice > 0
        ? ((currentPrice - token.addedPrice) / token.addedPrice) * 100
        : 0;
      const priceChangeFromLast = token.lastPrice > 0
        ? ((currentPrice - token.lastPrice) / token.lastPrice) * 100
        : 0;

      // Update token data
      storageService.updateWatchlistToken(chatId, token.mint, {
        lastPrice: currentPrice,
        lastChecked: Date.now(),
        priceChangePercent: priceChangeFromAdded,
      });

      // Check if we should alert
      const threshold = config.watchlist.priceAlertThreshold;
      const shouldAlert = Math.abs(priceChangeFromLast) >= threshold;

      // Check cooldown (don't alert for same token within 30 min)
      const cooldownMs = 30 * 60 * 1000;
      const lastAlerted = token.lastAlertedAt || 0;
      const canAlert = Date.now() - lastAlerted >= cooldownMs;

      if (shouldAlert && canAlert) {
        console.log(`Watchlist alert: ${token.symbol} moved ${priceChangeFromLast.toFixed(1)}%`);

        // Send alert
        await telegramService.sendWatchlistAlert(chatId, {
          ...token,
          lastPrice: currentPrice,
          priceChangePercent: priceChangeFromLast,
        });

        // Update last alerted time
        storageService.updateWatchlistToken(chatId, token.mint, {
          lastAlertedAt: Date.now(),
        });
      }
    }
  }

  // Manual check for a specific token
  async checkSingleToken(chatId: string, mint: string): Promise<{
    success: boolean;
    currentPrice?: number;
    priceChange?: number;
    error?: string;
  }> {
    try {
      // Use batch fetch for single token (utilizes cache)
      const prices = await this.batchFetchPrices([mint]);
      const currentPrice = prices.get(mint);

      if (!currentPrice) {
        return { success: false, error: 'No price data available' };
      }

      const watchlist = storageService.getWatchlist(chatId);
      const token = watchlist.find(t => t.mint === mint);

      if (!token) {
        return { success: false, error: 'Token not in watchlist' };
      }

      const priceChange = token.addedPrice > 0
        ? ((currentPrice - token.addedPrice) / token.addedPrice) * 100
        : 0;

      // Update token data
      storageService.updateWatchlistToken(chatId, mint, {
        lastPrice: currentPrice,
        lastChecked: Date.now(),
        priceChangePercent: priceChange,
      });

      return {
        success: true,
        currentPrice,
        priceChange,
      };
    } catch (error) {
      return { success: false, error: 'Failed to fetch price' };
    }
  }

  /**
   * Get current prices for multiple tokens (useful for UI)
   */
  async getPrices(mints: string[]): Promise<Map<string, number>> {
    return this.batchFetchPrices(mints);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isActive(): boolean {
    return this.isRunning;
  }

  // Clear price cache (useful for testing or forcing refresh)
  clearCache(): void {
    this.priceCache.clear();
  }
}

export const watchlistService = new WatchlistService();
