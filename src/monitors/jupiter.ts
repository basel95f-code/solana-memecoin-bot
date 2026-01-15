import axios from 'axios';
import { tokenCache } from '../services/cache';
import { PoolInfo, SOL_MINT } from '../types';
import { config } from '../config';
import { EventEmitter } from 'events';
import { withRetry, CircuitBreaker } from '../utils/retry';

const JUPITER_API_BASE = 'https://cache.jup.ag';
const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';

// Alternative API endpoints for fallback
const FALLBACK_ENDPOINTS = [
  'https://cache.jup.ag/tokens',
  'https://tokens.jup.ag/tokens?tags=verified',
];

interface JupiterToken {
  address: string;
  chainId: number;
  decimals: number;
  name: string;
  symbol: string;
  logoURI?: string;
  tags?: string[];
  extensions?: {
    coingeckoId?: string;
  };
}

// Health status for the monitor
interface HealthStatus {
  isHealthy: boolean;
  lastSuccessfulSync: number;
  consecutiveFailures: number;
  lastError: string | null;
}

export class JupiterMonitor extends EventEmitter {
  private pollInterval: NodeJS.Timeout | null = null;
  private recoveryInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private knownTokens: Set<string> = new Set();
  private lastFullSync: number = 0;
  private circuitBreaker: CircuitBreaker;
  private health: HealthStatus = {
    isHealthy: true,
    lastSuccessfulSync: 0,
    consecutiveFailures: 0,
    lastError: null,
  };

  constructor() {
    super();
    // Circuit breaker: open after 5 failures, reset after 5 minutes
    this.circuitBreaker = new CircuitBreaker(5, 300000);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log('Starting Jupiter monitor...');
    this.isRunning = true;

    // Initial sync of all known tokens (don't block on failure)
    this.syncKnownTokens().catch(err => {
      console.warn('Jupiter initial sync failed, will retry:', err.message);
    });

    // Start polling for new tokens
    const interval = config.monitors.jupiter.pollInterval || 30000;
    this.pollInterval = setInterval(() => this.checkNewTokens(), interval);

    // Start auto-recovery interval (check every 2 minutes if circuit breaker needs reset)
    this.recoveryInterval = setInterval(() => this.attemptAutoRecovery(), 120000);

    console.log(`Jupiter monitor started - polling every ${interval}ms`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('Stopping Jupiter monitor...');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }

    this.isRunning = false;
    console.log('Jupiter monitor stopped');
  }

  private async syncKnownTokens(): Promise<void> {
    // Check circuit breaker first
    if (this.circuitBreaker.isOpen()) {
      console.log('Jupiter circuit breaker is open, skipping sync');
      return;
    }

    try {
      console.log('Syncing Jupiter token list...');

      const tokens = await this.circuitBreaker.execute(async () => {
        return await this.fetchTokenListWithFallback();
      });

      if (tokens.length > 0) {
        for (const token of tokens) {
          this.knownTokens.add(token.address);
        }

        this.lastFullSync = Date.now();
        this.health.lastSuccessfulSync = Date.now();
        this.health.consecutiveFailures = 0;
        this.health.isHealthy = true;
        this.health.lastError = null;

        console.log(`Jupiter sync complete: ${this.knownTokens.size} tokens known`);
      }
    } catch (error) {
      this.handleSyncError(error as Error);
    }
  }

  private async fetchTokenListWithFallback(): Promise<JupiterToken[]> {
    // Try primary endpoint first with retry
    try {
      const tokens = await withRetry(
        async () => {
          const strictResponse = await axios.get(`${JUPITER_API_BASE}/tokens`, {
            timeout: 15000,
          });
          return strictResponse.data || [];
        },
        {
          maxRetries: 2,
          initialDelayMs: 500,
          maxDelayMs: 5000,
        }
      );

      if (tokens.length > 0) {
        return tokens;
      }
    } catch (primaryError) {
      console.warn('Primary Jupiter endpoint failed, trying fallbacks...');
    }

    // Try fallback endpoints
    for (const endpoint of FALLBACK_ENDPOINTS) {
      try {
        const response = await axios.get(endpoint, { timeout: 10000 });
        if (response.data && Array.isArray(response.data)) {
          console.log(`Using fallback endpoint: ${endpoint}`);
          return response.data;
        }
      } catch {
        // Continue to next fallback
      }
    }

    // If all endpoints fail, throw error
    throw new Error('All Jupiter endpoints failed');
  }

  private handleSyncError(error: Error): void {
    this.health.consecutiveFailures++;
    this.health.lastError = error.message;

    // Mark as unhealthy after 3 consecutive failures
    if (this.health.consecutiveFailures >= 3) {
      this.health.isHealthy = false;
    }

    // Log based on severity
    if (this.health.consecutiveFailures <= 1) {
      console.warn(`Jupiter sync error (will retry): ${error.message}`);
    } else if (this.health.consecutiveFailures <= 3) {
      console.warn(`Jupiter sync error (${this.health.consecutiveFailures} failures): ${error.message}`);
    } else {
      // After many failures, reduce log noise
      if (this.health.consecutiveFailures % 10 === 0) {
        console.error(`Jupiter monitor degraded: ${this.health.consecutiveFailures} consecutive failures`);
      }
    }
  }

  private async checkNewTokens(): Promise<void> {
    // Skip if circuit breaker is open
    if (this.circuitBreaker.isOpen()) {
      return;
    }

    try {
      // Re-sync periodically to catch new additions
      const hoursSinceSync = (Date.now() - this.lastFullSync) / (1000 * 60 * 60);
      if (hoursSinceSync > 1 || this.knownTokens.size === 0) {
        await this.syncKnownTokens();
        return;
      }

      // If we've never successfully synced, just try to sync
      if (this.knownTokens.size === 0) {
        await this.syncKnownTokens();
        return;
      }

      // Fetch current token list with retry
      const currentTokens = await this.circuitBreaker.execute(async () => {
        return await withRetry(
          async () => {
            const response = await axios.get(`${JUPITER_API_BASE}/tokens`, {
              timeout: 30000,
            });
            return response.data || [];
          },
          { maxRetries: 2, initialDelayMs: 500 }
        );
      });

      // Reset health on success
      this.health.consecutiveFailures = 0;
      this.health.isHealthy = true;
      this.health.lastError = null;

      // Find new tokens
      for (const token of currentTokens) {
        if (!this.knownTokens.has(token.address)) {
          console.log(`New Jupiter token: ${token.symbol} (${token.address})`);

          this.knownTokens.add(token.address);

          // Skip if already in cache
          if (tokenCache.has(token.address)) continue;

          const pool = await this.createPoolInfo(token);
          if (pool) {
            this.emit('newPool', pool);
          }
        }
      }
    } catch (error) {
      this.handleSyncError(error as Error);
    }
  }

  private async createPoolInfo(token: JupiterToken): Promise<PoolInfo | null> {
    try {
      // Get price and liquidity from Jupiter
      const priceData = await this.getTokenPrice(token.address);

      return {
        address: token.address, // Jupiter doesn't have pool addresses
        tokenMint: token.address,
        baseMint: token.address,
        quoteMint: SOL_MINT,
        baseReserve: 0,
        quoteReserve: priceData?.liquidity || 0,
        lpMint: '',
        source: 'jupiter',
        createdAt: new Date(),
      };
    } catch {
      return {
        address: token.address,
        tokenMint: token.address,
        baseMint: token.address,
        quoteMint: SOL_MINT,
        baseReserve: 0,
        quoteReserve: 0,
        lpMint: '',
        source: 'jupiter',
        createdAt: new Date(),
      };
    }
  }

  private async getTokenPrice(
    mint: string
  ): Promise<{ price: number; liquidity: number } | null> {
    try {
      const response = await withRetry(
        () => axios.get(JUPITER_PRICE_API, {
          params: { ids: mint },
          timeout: 5000,
        }),
        { maxRetries: 2, initialDelayMs: 300 }
      );

      const data = response.data.data?.[mint];
      if (data) {
        return {
          price: parseFloat(data.price) || 0,
          liquidity: 0, // v2 API doesn't include liquidity directly
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async searchToken(query: string): Promise<JupiterToken[]> {
    try {
      const response = await withRetry(
        () => axios.get('https://tokens.jup.ag/tokens', {
          params: { tags: 'verified' },
          timeout: 10000,
        }),
        { maxRetries: 2, initialDelayMs: 500 }
      );
      // Filter locally since cache endpoint doesn't have search
      const tokens = response.data || [];
      const lowerQuery = query.toLowerCase();
      return tokens.filter((t: JupiterToken) =>
        t.symbol?.toLowerCase().includes(lowerQuery) ||
        t.name?.toLowerCase().includes(lowerQuery) ||
        t.address === query
      );
    } catch {
      return [];
    }
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getKnownTokenCount(): number {
    return this.knownTokens.size;
  }

  getHealth(): HealthStatus {
    return { ...this.health };
  }

  isHealthy(): boolean {
    return this.health.isHealthy;
  }

  // Manual reset for circuit breaker (useful for admin commands)
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    this.health.consecutiveFailures = 0;
    this.health.isHealthy = true;
    console.log('Jupiter monitor circuit breaker reset');
  }

  // Auto-recovery: attempt to reset circuit breaker if it's been open for a while
  private async attemptAutoRecovery(): Promise<void> {
    if (!this.circuitBreaker.isOpen()) return;

    console.log('Jupiter auto-recovery: attempting to reset circuit breaker...');

    // Reset and try a single sync
    this.circuitBreaker.reset();
    this.health.consecutiveFailures = 0;

    try {
      await this.syncKnownTokens();
      console.log('Jupiter auto-recovery: successful');
    } catch (error) {
      console.warn('Jupiter auto-recovery: failed, will retry later');
    }
  }
}

export const jupiterMonitor = new JupiterMonitor();
