import { PublicKey, AccountInfo } from '@solana/web3.js';
import { solanaService } from '../services/solana';
import { tokenCache } from '../services/cache';
import { PoolInfo, RAYDIUM_AMM_PROGRAM, SOL_MINT } from '../types';
import { EventEmitter } from 'events';

// Raydium AMM Pool layout offsets
const RAYDIUM_POOL_LAYOUT = {
  STATUS: 0,
  NONCE: 8,
  BASE_MINT: 128,
  QUOTE_MINT: 160,
  LP_MINT: 192,
  BASE_VAULT: 224,
  QUOTE_VAULT: 256,
};

export class RaydiumMonitor extends EventEmitter {
  private subscriptionId: number | null = null;
  private isRunning: boolean = false;

  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log('Starting Raydium monitor...');
    this.isRunning = true;

    try {
      // Subscribe to Raydium AMM program account changes
      this.subscriptionId = solanaService.subscribeToProgram(
        RAYDIUM_AMM_PROGRAM,
        (accountInfo, pubkey) => this.handleAccountChange(accountInfo, pubkey)
      );

      console.log('Raydium monitor started - watching for new pools');
    } catch (error) {
      console.error('Failed to start Raydium monitor:', error);
      this.isRunning = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('Stopping Raydium monitor...');

    if (this.subscriptionId !== null) {
      await solanaService.unsubscribe(this.subscriptionId);
      this.subscriptionId = null;
    }

    this.isRunning = false;
    console.log('Raydium monitor stopped');
  }

  private async handleAccountChange(
    accountInfo: AccountInfo<Buffer>,
    pubkey: PublicKey
  ): Promise<void> {
    try {
      const poolAddress = pubkey.toBase58();

      // Skip if we've already seen this pool
      if (tokenCache.has(poolAddress)) {
        return;
      }

      // Parse pool data
      const pool = this.parsePoolData(accountInfo.data, poolAddress);
      if (!pool) return;

      // Skip non-SOL pairs for now (focus on SOL pairs)
      if (pool.quoteMint !== SOL_MINT) {
        return;
      }

      console.log(`New Raydium pool detected: ${pool.tokenMint}`);

      // Emit event for the main bot to handle
      this.emit('newPool', pool);
    } catch (error) {
      // Silently ignore parsing errors for non-pool accounts
    }
  }

  private parsePoolData(data: Buffer, address: string): PoolInfo | null {
    try {
      if (data.length < 300) return null;

      // Parse mint addresses
      const baseMint = new PublicKey(
        data.slice(RAYDIUM_POOL_LAYOUT.BASE_MINT, RAYDIUM_POOL_LAYOUT.BASE_MINT + 32)
      ).toBase58();

      const quoteMint = new PublicKey(
        data.slice(RAYDIUM_POOL_LAYOUT.QUOTE_MINT, RAYDIUM_POOL_LAYOUT.QUOTE_MINT + 32)
      ).toBase58();

      const lpMint = new PublicKey(
        data.slice(RAYDIUM_POOL_LAYOUT.LP_MINT, RAYDIUM_POOL_LAYOUT.LP_MINT + 32)
      ).toBase58();

      // Determine which is the token (non-SOL)
      const tokenMint = baseMint === SOL_MINT ? quoteMint : baseMint;

      return {
        address,
        tokenMint,
        baseMint,
        quoteMint,
        baseReserve: 0, // Will be fetched during analysis
        quoteReserve: 0,
        lpMint,
        source: 'raydium',
        createdAt: new Date(),
      };
    } catch {
      return null;
    }
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

export const raydiumMonitor = new RaydiumMonitor();
