import axios from 'axios';
import { tokenCache } from '../services/cache';
import type { PoolInfo } from '../types';
import { SOL_MINT } from '../types';
import { config } from '../config';
import { EventEmitter } from 'events';
import { withRetry, CircuitBreaker } from '../utils/retry';

const METEORA_API_BASE = 'https://dlmm-api.meteora.ag';

// Fallback endpoints
const FALLBACK_ENDPOINTS = [
  'https://dlmm-api.meteora.ag/pair/all',
];

interface MeteoraPair {
  address: string;
  name: string;
  mint_x: string;
  mint_y: string;
  reserve_x: string;
  reserve_y: string;
  reserve_x_amount: number;
  reserve_y_amount: number;
  bin_step: number;
  base_fee_percentage: string;
  max_fee_percentage: string;
  protocol_fee_percentage: string;
  liquidity: string;
  reward_mint_x: string;
  reward_mint_y: string;
  fees_24h: number;
  today_fees: number;
  trade_volume_24h: number;
  cumulative_trade_volume: string;
  cumulative_fee_volume: string;
  current_price: number;
  apr: number;
  apy: number;
  farm_apr: number;
  farm_apy: number;
  hide: boolean;
  is_blacklisted: boolean;
}

interface HealthStatus {
  isHealthy: boolean;
  lastSuccessfulSync: number;
  consecutiveFailures: number;
  lastError: string | null;
}

export class MeteoraMonitor extends EventEmitter {
  private pollInterval: NodeJS.Timeout | null = null;
  private recoveryInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private knownPairs: Set<string> = new Set();
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

    console.log('Starting Meteora DLMM monitor...');
    this.isRunning = true;

    // Initial sync of all known pairs (don't block on failure)
    this.syncKnownPairs().catch(err => {
      console.warn('Meteora initial sync failed, will retry:', err.message);
    });

    // Start polling for new pairs
    const interval = config.monitors.meteora?.pollInterval || 15000;
    this.pollInterval = setInterval(() => {
      this.checkNewPairs().catch((error) => {
        console.warn('Error in Meteora polling:', error);
      });
    }, interval);

    // Start auto-recovery interval (check every 2 minutes if circuit breaker needs reset)
    this.recoveryInterval = setInterval(() => {
      this.attemptAutoRecovery().catch((error) => {
        console.warn('Error in Meteora auto-recovery:', error);
      });
    }, 120000);

    console.log(`Meteora monitor started - polling every ${interval}ms`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('Stopping Meteora monitor...');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }

    this.isRunning = false;
    console.log('Meteora monitor stopped');
  }

  private async syncKnownPairs(): Promise<void> {
    // Check circuit breaker first
    if (this.circuitBreaker.isOpen()) {
      console.log('Meteora circuit breaker is open, skipping sync');
      return;
    }

    try {
      console.log('Syncing Meteora pair list...');

      const pairs = await this.circuitBreaker.execute(async () => {
        return await this.fetchPairListWithFallback();
      });

      if (pairs.length > 0) {
        for (const pair of pairs) {
          this.knownPairs.add(pair.address);
        }

        this.lastFullSync = Date.now();
        this.health.lastSuccessfulSync = Date.now();
        this.health.consecutiveFailures = 0;
        this.health.isHealthy = true;
        this.health.lastError = null;

        console.log(`Meteora sync complete: ${this.knownPairs.size} pairs known`);
      }
    } catch (error) {
      this.handleSyncError(error as Error);
    }
  }

  private async fetchPairListWithFallback(): Promise<MeteoraPair[]> {
    // Try primary endpoint first with retry
    try {
      const pairs = await withRetry(
        async () => {
          const response = await axios.get(`${METEORA_API_BASE}/pair/all`, {
            timeout: 30000,
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });
          return response.data || [];
        },
        {
          maxRetries: 2,
          initialDelayMs: 500,
          maxDelayMs: 5000,
        }
      );

      if (pairs.length > 0) {
        return pairs;
      }
    } catch {
      console.warn('Primary Meteora endpoint failed, trying fallbacks...');
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
        if (response.data && Array.isArray(response.data)) {
          console.log(`Using fallback endpoint: ${endpoint}`);
          return response.data;
        }
      } catch {
        // Continue to next fallback
      }
    }

    // If all endpoints fail, throw error
    throw new Error('All Meteora endpoints failed');
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
      console.warn(`Meteora sync error (will retry): ${error.message}`);
    } else if (this.health.consecutiveFailures <= 3) {
      console.warn(`Meteora sync error (${this.health.consecutiveFailures} failures): ${error.message}`);
    } else {
      // After many failures, reduce log noise
      if (this.health.consecutiveFailures % 10 === 0) {
        console.error(`Meteora monitor degraded: ${this.health.consecutiveFailures} consecutive failures`);
      }
    }
  }

  private async checkNewPairs(): Promise<void> {
    // Skip if circuit breaker is open
    if (this.circuitBreaker.isOpen()) {
      return;
    }

    try {
      // Re-sync periodically to catch new additions
      const hoursSinceSync = (Date.now() - this.lastFullSync) / (1000 * 60 * 60);
      if (hoursSinceSync > 1 || this.knownPairs.size === 0) {
        await this.syncKnownPairs();
        return;
      }

      // Fetch current pair list with retry
      const currentPairs = await this.circuitBreaker.execute(async () => {
        return await withRetry(
          async () => {
            const response = await axios.get(`${METEORA_API_BASE}/pair/all`, {
              timeout: 30000,
              headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              },
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

      // Find new pairs
      for (const pair of currentPairs) {
        if (!this.knownPairs.has(pair.address)) {
          console.log(`New Meteora DLMM pair: ${pair.name} (${pair.address})`);

          this.knownPairs.add(pair.address);

          // Skip if already in cache
          if (tokenCache.has(pair.address)) continue;

          // Skip if blacklisted or hidden
          if (pair.is_blacklisted || pair.hide) continue;

          const pool = this.createPoolInfo(pair);
          if (pool) {
            this.emit('newPool', pool);
          }
        }
      }
    } catch (error) {
      this.handleSyncError(error as Error);
    }
  }

  private createPoolInfo(pair: MeteoraPair): PoolInfo | null {
    try {
      // Determine which token is SOL
      const isMintXSol = pair.mint_x === SOL_MINT;
      const isMintYSol = pair.mint_y === SOL_MINT;

      // We're primarily interested in SOL pairs
      if (!isMintXSol && !isMintYSol) {
        return null; // Skip non-SOL pairs for now
      }

      const tokenMint = isMintXSol ? pair.mint_y : pair.mint_x;
      const baseMint = pair.mint_x;
      const quoteMint = pair.mint_y;

      // Calculate reserves (convert from raw amounts if needed)
      const baseReserve = pair.reserve_x_amount;
      const quoteReserve = pair.reserve_y_amount;

      return {
        address: pair.address,
        tokenMint,
        baseMint,
        quoteMint,
        baseReserve,
        quoteReserve,
        lpMint: '',
        source: 'meteora',
        createdAt: new Date(),
      };
    } catch {
      return null;
    }
  }

  async getPairDetails(address: string): Promise<MeteoraPair | null> {
    try {
      const response = await withRetry(
        async () => {
          const res = await axios.get(`${METEORA_API_BASE}/pair/${address}`, {
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

  getKnownPairCount(): number {
    return this.knownPairs.size;
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
    console.log('Meteora monitor circuit breaker reset');
  }

  // Auto-recovery: attempt to reset circuit breaker if it's been open for a while
  private async attemptAutoRecovery(): Promise<void> {
    if (!this.circuitBreaker.isOpen()) return;

    console.log('Meteora auto-recovery: attempting to reset circuit breaker...');

    // Reset and try a single sync
    this.circuitBreaker.reset();
    this.health.consecutiveFailures = 0;

    try {
      await this.syncKnownPairs();
      console.log('Meteora auto-recovery: successful');
    } catch {
      console.warn('Meteora auto-recovery: failed, will retry later');
    }
  }
}

export const meteoraMonitor = new MeteoraMonitor();
