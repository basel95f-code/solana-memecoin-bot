import { PublicKey, AccountInfo } from '@solana/web3.js';
import axios from 'axios';
import { solanaService } from '../services/solana';
import { tokenCache } from '../services/cache';
import { PoolInfo, PUMPFUN_PROGRAM, SOL_MINT } from '../types';
import { config } from '../config';
import { EventEmitter } from 'events';

const PUMPFUN_API_BASE = 'https://frontend-api.pump.fun';

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

    // If still too large, remove oldest entries
    if (this.seenTokens.size > MAX_SEEN_TOKENS) {
      const sorted = Array.from(this.seenTokens.entries())
        .sort((a, b) => a[1] - b[1]);

      const toRemove = sorted.slice(0, this.seenTokens.size - MAX_SEEN_TOKENS);
      for (const [mint] of toRemove) {
        this.seenTokens.delete(mint);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`Pump.fun cleanup: removed ${removed} old tokens, ${this.seenTokens.size} remaining`);
    }
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
    try {
      const response = await axios.get(`${PUMPFUN_API_BASE}/coins/king-of-the-hill`, {
        params: {
          includeNsfw: false,
          limit: 20,
        },
        timeout: 10000,
      });

      return response.data || [];
    } catch (error) {
      // API might not be available or rate limited
      return [];
    }
  }

  private async fetchNewTokens(): Promise<PumpFunToken[]> {
    try {
      const response = await axios.get(`${PUMPFUN_API_BASE}/coins`, {
        params: {
          offset: 0,
          limit: 50,
          sort: 'created_timestamp',
          order: 'DESC',
          includeNsfw: false,
        },
        timeout: 10000,
      });

      return response.data || [];
    } catch (error) {
      // Fallback: try alternative endpoint
      try {
        const response = await axios.get(
          `${PUMPFUN_API_BASE}/coins/latest`,
          { timeout: 10000 }
        );
        return response.data || [];
      } catch {
        return [];
      }
    }
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
    try {
      const response = await axios.get(
        `${PUMPFUN_API_BASE}/coins/${mint}`,
        { timeout: 10000 }
      );
      return response.data;
    } catch {
      return null;
    }
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

export const pumpFunMonitor = new PumpFunMonitor();
