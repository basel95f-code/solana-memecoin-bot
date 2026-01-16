import { PublicKey, AccountInfo } from '@solana/web3.js';
import axios from 'axios';
import { solanaService } from '../services/solana';
import { tokenCache } from '../services/cache';
import { PoolInfo, PUMPFUN_PROGRAM, SOL_MINT } from '../types';
import { config } from '../config';
import { EventEmitter } from 'events';

// Multiple endpoints for fallback
const PUMPFUN_API_ENDPOINTS = [
  'https://frontend-api.pump.fun',
  'https://client-api-2-74b1891ee9f9.herokuapp.com',
];

interface PumpFunToken {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  image_uri: string;
  metadata_uri: string;
  twitter: string | null;
  telegram: string | null;
  bonding_curve: string;
  associated_bonding_curve: string;
  creator: string;
  created_timestamp: number;
  raydium_pool: string | null;
  complete: boolean;
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  total_supply: number;
  website: string | null;
  show_name: boolean;
  king_of_the_hill_timestamp: number | null;
  market_cap: number;
  reply_count: number;
  last_reply: number | null;
  nsfw: boolean;
  market_id: string | null;
  inverted: boolean | null;
  usd_market_cap: number;
}

const MAX_SEEN_TOKENS = 5000; // Maximum number of seen tokens to track

export class PumpFunMonitor extends EventEmitter {
  private pollInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private seenTokens: Map<string, number> = new Map(); // mint -> timestamp
  private lastCheckTime: number = Date.now();

  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log('Starting Pump.fun monitor...');
    this.isRunning = true;

    // Initial fetch to populate seen tokens
    await this.fetchRecentTokens(true);

    // Start polling for new tokens
    const interval = config.monitors.pumpfun.pollInterval || 10000;
    this.pollInterval = setInterval(() => this.fetchRecentTokens(), interval);

    // Start periodic cleanup of seen tokens
    this.cleanupInterval = setInterval(() => this.cleanupSeenTokens(), 300000); // Every 5 minutes

    console.log(`Pump.fun monitor started - polling every ${interval}ms`);
  }

  private cleanupSeenTokens(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    // Remove tokens older than maxAge
    let removed = 0;
    for (const [mint, timestamp] of this.seenTokens.entries()) {
      if (now - timestamp > maxAge) {
        this.seenTokens.delete(mint);
        removed++;
      }
    }

    // If still too large, remove oldest entries using partial selection (O(n*k) instead of O(n log n))
    const excess = this.seenTokens.size - MAX_SEEN_TOKENS;
    if (excess > 0) {
      // Find k oldest entries without full sort
      const k = excess;
      const oldest: Array<{ mint: string; time: number }> = [];

      for (const [mint, time] of this.seenTokens.entries()) {
        if (oldest.length < k) {
          // Binary insert to maintain sorted order
          const pos = this.binarySearchInsertPos(oldest, time);
          oldest.splice(pos, 0, { mint, time });
        } else if (time < oldest[k - 1].time) {
          oldest.pop();
          const pos = this.binarySearchInsertPos(oldest, time);
          oldest.splice(pos, 0, { mint, time });
        }
      }

      for (const { mint } of oldest) {
        this.seenTokens.delete(mint);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`Pump.fun cleanup: removed ${removed} old tokens, ${this.seenTokens.size} remaining`);
    }
  }

  private binarySearchInsertPos(arr: Array<{ time: number }>, time: number): number {
    let low = 0;
    let high = arr.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (arr[mid].time < time) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('Stopping Pump.fun monitor...');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.isRunning = false;
    console.log('Pump.fun monitor stopped');
  }

  private async fetchRecentTokens(initialLoad: boolean = false): Promise<void> {
    try {
      // Fetch recently graduated tokens (moved to Raydium)
      const graduated = await this.fetchGraduatedTokens();

      // Fetch new token launches
      const newTokens = await this.fetchNewTokens();

      const allTokens = [...graduated, ...newTokens];

      for (const token of allTokens) {
        // Skip if already seen
        if (this.seenTokens.has(token.mint)) continue;

        this.seenTokens.set(token.mint, Date.now());

        // On initial load, just populate the seen list
        if (initialLoad) continue;

        // Skip tokens without Raydium pool (not graduated yet)
        // Unless we want to monitor pre-graduation tokens
        if (!token.raydium_pool && !token.complete) {
          continue;
        }

        console.log(`New Pump.fun token: ${token.symbol} (${token.mint})`);

        const pool = this.createPoolInfo(token);
        this.emit('newPool', pool);
      }
    } catch (error) {
      console.error('Error fetching Pump.fun tokens:', error);
    }
  }

  private async fetchGraduatedTokens(): Promise<PumpFunToken[]> {
    for (const baseUrl of PUMPFUN_API_ENDPOINTS) {
      try {
        const response = await axios.get(`${baseUrl}/coins/king-of-the-hill`, {
          params: {
            includeNsfw: false,
            limit: 20,
          },
          timeout: 10000,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });

        if (response.data && Array.isArray(response.data)) {
          return response.data;
        }
      } catch (error) {
        // Try next endpoint
        continue;
      }
    }
    return [];
  }

  private async fetchNewTokens(): Promise<PumpFunToken[]> {
    for (const baseUrl of PUMPFUN_API_ENDPOINTS) {
      try {
        // Try main coins endpoint
        const response = await axios.get(`${baseUrl}/coins`, {
          params: {
            offset: 0,
            limit: 50,
            sort: 'created_timestamp',
            order: 'DESC',
            includeNsfw: false,
          },
          timeout: 10000,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });

        if (response.data && Array.isArray(response.data)) {
          return response.data;
        }
      } catch (error) {
        // Try latest endpoint as fallback
        try {
          const response = await axios.get(`${baseUrl}/coins/latest`, {
            timeout: 10000,
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });
          if (response.data && Array.isArray(response.data)) {
            return response.data;
          }
        } catch {
          // Continue to next base URL
          continue;
        }
      }
    }
    return [];
  }

  private createPoolInfo(token: PumpFunToken): PoolInfo {
    return {
      address: token.bonding_curve || token.raydium_pool || '',
      tokenMint: token.mint,
      baseMint: token.mint,
      quoteMint: SOL_MINT,
      baseReserve: token.virtual_token_reserves / 1e6, // Pump.fun uses 6 decimals
      quoteReserve: token.virtual_sol_reserves / 1e9,
      lpMint: '',
      source: 'pumpfun',
      createdAt: new Date(token.created_timestamp),
    };
  }

  async getTokenDetails(mint: string): Promise<PumpFunToken | null> {
    for (const baseUrl of PUMPFUN_API_ENDPOINTS) {
      try {
        const response = await axios.get(`${baseUrl}/coins/${mint}`, {
          timeout: 10000,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        if (response.data) {
          return response.data;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

export const pumpFunMonitor = new PumpFunMonitor();
