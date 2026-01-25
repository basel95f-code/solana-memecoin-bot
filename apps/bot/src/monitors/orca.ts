import axios from 'axios';
import { tokenCache } from '../services/cache';
import type { PoolInfo } from '../types';
import { SOL_MINT } from '../types';
import { config } from '../config';
import { EventEmitter } from 'events';
import { withRetry, CircuitBreaker } from '../utils/retry';

const ORCA_API_BASE = 'https://api.mainnet.orca.so';

// Fallback endpoints
const FALLBACK_ENDPOINTS = [
  'https://api.mainnet.orca.so/v1/whirlpool/list',
];

interface OrcaToken {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  coingeckoId?: string;
  whitelisted: boolean;
  poolToken: boolean;
  token2022: boolean;
}

interface OrcaWhirlpool {
  address: string;
  tokenA: OrcaToken;
  tokenB: OrcaToken;
  whitelisted: boolean;
  token2022: boolean;
  tickSpacing: number;
  price: number;
  lpFeeRate: number;
  protocolFeeRate: number;
  whirlpoolsConfig: string;
  modifiedTimeMs: number;
  tvl: number;
  volume: {
    day: number;
    week: number;
    month: number;
  };
  volumeDenominatedA: {
    day: number;
    week: number;
    month: number;
  };
  volumeDenominatedB: {
    day: number;
    week: number;
    month: number;
  };
  feeApr: {
    day: number;
    week: number;
    month: number;
  };
}

interface OrcaWhirlpoolResponse {
  whirlpools: OrcaWhirlpool[];
}

interface HealthStatus {
  isHealthy: boolean;
  lastSuccessfulSync: number;
  consecutiveFailures: number;
  lastError: string | null;
}

export class OrcaMonitor extends EventEmitter {
  private pollInterval: NodeJS.Timeout | null = null;
  private recoveryInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private knownPools: Set<string> = new Set();
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

    console.log('Starting Orca Whirlpool monitor...');
    this.isRunning = true;

    // Initial sync of all known pools (don't block on failure)
    this.syncKnownPools().catch(err => {
      console.warn('Orca initial sync failed, will retry:', err.message);
    });

    // Start polling for new pools
    const interval = config.monitors.orca?.pollInterval || 15000;
    this.pollInterval = setInterval(() => {
      this.checkNewPools().catch((error) => {
        console.warn('Error in Orca polling:', error);
      });
    }, interval);

    // Start auto-recovery interval (check every 2 minutes if circuit breaker needs reset)
    this.recoveryInterval = setInterval(() => {
      this.attemptAutoRecovery().catch((error) => {
        console.warn('Error in Orca auto-recovery:', error);
      });
    }, 120000);

    console.log(`Orca monitor started - polling every ${interval}ms`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('Stopping Orca monitor...');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }

    this.isRunning = false;
    console.log('Orca monitor stopped');
  }

  private async syncKnownPools(): Promise<void> {
    // Check circuit breaker first
    if (this.circuitBreaker.isOpen()) {
      console.log('Orca circuit breaker is open, skipping sync');
      return;
    }

    try {
      console.log('Syncing Orca pool list...');

      const pools = await this.circuitBreaker.execute(async () => {
        return await this.fetchPoolListWithFallback();
      });

      if (pools.length > 0) {
        for (const pool of pools) {
          this.knownPools.add(pool.address);
        }

        this.lastFullSync = Date.now();
        this.health.lastSuccessfulSync = Date.now();
        this.health.consecutiveFailures = 0;
        this.health.isHealthy = true;
        this.health.lastError = null;

        console.log(`Orca sync complete: ${this.knownPools.size} pools known`);
      }
    } catch (error) {
      this.handleSyncError(error as Error);
    }
  }

  private async fetchPoolListWithFallback(): Promise<OrcaWhirlpool[]> {
    // Try primary endpoint first with retry
    try {
      const pools = await withRetry(
        async () => {
          const response = await axios.get(`${ORCA_API_BASE}/v1/whirlpool/list`, {
            timeout: 30000,
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });
          return (response.data as OrcaWhirlpoolResponse)?.whirlpools || [];
        },
        {
          maxRetries: 2,
          initialDelayMs: 500,
          maxDelayMs: 5000,
        }
      );

      if (pools.length > 0) {
        return pools;
      }
    } catch {
      console.warn('Primary Orca endpoint failed, trying fallbacks...');
    }

    // Try fallback endpoints
    for (const endpoint of FALLBACK_ENDPOINTS) {
      try {
        const response = await axios.get(endpoint, {
          timeout: 20000,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        if (response.data?.whirlpools && Array.isArray(response.data.whirlpools)) {
          console.log(`Using fallback endpoint: ${endpoint}`);
          return response.data.whirlpools;
        }
      } catch {
        // Continue to next fallback
      }
    }

    // If all endpoints fail, throw error
    throw new Error('All Orca endpoints failed');
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
      console.warn(`Orca sync error (will retry): ${error.message}`);
    } else if (this.health.consecutiveFailures <= 3) {
      console.warn(`Orca sync error (${this.health.consecutiveFailures} failures): ${error.message}`);
    } else {
      // After many failures, reduce log noise
      if (this.health.consecutiveFailures % 10 === 0) {
        console.error(`Orca monitor degraded: ${this.health.consecutiveFailures} consecutive failures`);
      }
    }
  }

  private async checkNewPools(): Promise<void> {
    // Skip if circuit breaker is open
    if (this.circuitBreaker.isOpen()) {
      return;
    }

    try {
      // Re-sync periodically to catch new additions
      const hoursSinceSync = (Date.now() - this.lastFullSync) / (1000 * 60 * 60);
      if (hoursSinceSync > 1 || this.knownPools.size === 0) {
        await this.syncKnownPools();
        return;
      }

      // Fetch current pool list with retry
      const currentPools = await this.circuitBreaker.execute(async () => {
        return await withRetry(
          async () => {
            const response = await axios.get(`${ORCA_API_BASE}/v1/whirlpool/list`, {
              timeout: 30000,
              headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              },
            });
            return (response.data as OrcaWhirlpoolResponse)?.whirlpools || [];
          },
          { maxRetries: 2, initialDelayMs: 500 }
        );
      });

      // Reset health on success
      this.health.consecutiveFailures = 0;
      this.health.isHealthy = true;
      this.health.lastError = null;

      // Find new pools
      for (const pool of currentPools) {
        if (!this.knownPools.has(pool.address)) {
          console.log(`New Orca Whirlpool: ${pool.tokenA.symbol}-${pool.tokenB.symbol} (${pool.address})`);

          this.knownPools.add(pool.address);

          // Skip if already in cache
          if (tokenCache.has(pool.address)) continue;

          const poolInfo = this.createPoolInfo(pool);
          if (poolInfo) {
            this.emit('newPool', poolInfo);
          }
        }
      }
    } catch (error) {
      this.handleSyncError(error as Error);
    }
  }

  private createPoolInfo(pool: OrcaWhirlpool): PoolInfo | null {
    try {
      // Determine which token is SOL
      const isTokenASol = pool.tokenA.mint === SOL_MINT;
      const isTokenBSol = pool.tokenB.mint === SOL_MINT;

      // We're primarily interested in SOL pairs
      if (!isTokenASol && !isTokenBSol) {
        return null; // Skip non-SOL pairs for now
      }

      const tokenMint = isTokenASol ? pool.tokenB.mint : pool.tokenA.mint;
      const baseMint = pool.tokenA.mint;
      const quoteMint = pool.tokenB.mint;

      // Calculate reserves from TVL (approximation)
      // Orca doesn't provide reserve amounts directly, so we use TVL
      const tvlUsd = pool.tvl;
      const liquidityEstimate = tvlUsd / 2; // Rough estimate for each side

      return {
        address: pool.address,
        tokenMint,
        baseMint,
        quoteMint,
        baseReserve: liquidityEstimate,
        quoteReserve: liquidityEstimate,
        lpMint: '',
        source: 'orca',
        createdAt: new Date(pool.modifiedTimeMs),
      };
    } catch {
      return null;
    }
  }

  async getPoolDetails(address: string): Promise<OrcaWhirlpool | null> {
    try {
      const response = await withRetry(
        async () => {
          const res = await axios.get(`${ORCA_API_BASE}/v1/whirlpool/${address}`, {
            timeout: 10000,
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });
          return res;
        },
        { maxRetries: 2, initialDelayMs: 500 }
      );
      return response.data || null;
    } catch {
      return null;
    }
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getKnownPoolCount(): number {
    return this.knownPools.size;
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
    console.log('Orca monitor circuit breaker reset');
  }

  // Auto-recovery: attempt to reset circuit breaker if it's been open for a while
  private async attemptAutoRecovery(): Promise<void> {
    if (!this.circuitBreaker.isOpen()) return;

    console.log('Orca auto-recovery: attempting to reset circuit breaker...');

    // Reset and try a single sync
    this.circuitBreaker.reset();
    this.health.consecutiveFailures = 0;

    try {
      await this.syncKnownPools();
      console.log('Orca auto-recovery: successful');
    } catch {
      console.warn('Orca auto-recovery: failed, will retry later');
    }
  }
}

export const orcaMonitor = new OrcaMonitor();
