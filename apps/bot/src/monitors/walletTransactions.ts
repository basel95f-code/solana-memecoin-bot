/**
 * Wallet Transaction Monitor
 * Real-time monitoring of tracked wallet transactions using WebSocket
 */

import { EventEmitter } from 'events';
import { Connection, PublicKey, ParsedTransactionWithMeta, PartiallyDecodedInstruction } from '@solana/web3.js';
import { config } from '../config';
import { solanaService } from '../services/solana';
import { walletTracker, type WalletTransaction } from '../services/walletTracker';
import { supabase } from '../database/supabase';
import { logger } from '../utils/logger';
import { dexScreenerService } from '../services/dexscreener';

// ============================================
// Constants
// ============================================

const KNOWN_PROGRAM_IDS = {
  TOKEN_PROGRAM: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  ASSOCIATED_TOKEN_PROGRAM: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  RAYDIUM_AMM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  RAYDIUM_AMM_V4: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  JUPITER_AGG_V6: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  PUMPFUN: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  ORCA_WHIRLPOOL: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  METEORA: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
};

const SPL_TOKEN_MINT = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// ============================================
// Types
// ============================================

export interface WalletActivity {
  wallet: string;
  signature: string;
  action: 'buy' | 'sell' | 'transfer_in' | 'transfer_out' | 'swap';
  tokenMint: string;
  tokenSymbol?: string;
  amount: number;
  valueSol?: number;
  valueUsd?: number;
  priceUsd?: number;
  dexProtocol?: string;
  poolAddress?: string;
  blockTime: Date;
  slot: number;
}

// ============================================
// Wallet Transaction Monitor
// ============================================

export class WalletTransactionMonitor extends EventEmitter {
  private connection: Connection;
  private isRunning = false;
  private trackedWallets: Set<string> = new Set();
  private subscriptions: Map<string, number> = new Map();
  private signaturesSeen: Set<string> = new Set();
  private refreshInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  // Rate limiting
  private lastCheckTime: Map<string, number> = new Map();
  private MIN_CHECK_INTERVAL = 5000; // 5 seconds between checks per wallet

  constructor() {
    super();
    this.connection = solanaService.getConnection();
  }

  /**
   * Start monitoring
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('WalletTransactionMonitor', 'Already running');
      return;
    }

    logger.info('WalletTransactionMonitor', 'Starting wallet transaction monitor...');
    this.isRunning = true;

    // Load tracked wallets
    await this.refreshTrackedWallets();

    // Setup WebSocket subscriptions
    await this.setupSubscriptions();

    // Refresh tracked wallets periodically
    this.refreshInterval = setInterval(async () => {
      await this.refreshTrackedWallets();
    }, 60000); // Every minute

    // Cleanup old signatures
    this.cleanupInterval = setInterval(() => {
      this.cleanupSeenSignatures();
    }, 300000); // Every 5 minutes

    logger.info('WalletTransactionMonitor', `Monitoring ${this.trackedWallets.size} wallets`);
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('WalletTransactionMonitor', 'Stopping wallet transaction monitor...');

    // Clear intervals
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Unsubscribe from all wallets
    for (const [wallet, subId] of this.subscriptions.entries()) {
      try {
        await this.connection.removeAccountChangeListener(subId);
      } catch (error) {
        logger.silentError('WalletTransactionMonitor', `Failed to unsubscribe from ${wallet}`, error as Error);
      }
    }

    this.subscriptions.clear();
    this.trackedWallets.clear();
    this.isRunning = false;

    logger.info('WalletTransactionMonitor', 'Stopped');
  }

  /**
   * Refresh list of tracked wallets
   */
  private async refreshTrackedWallets(): Promise<void> {
    try {
      const wallets = await walletTracker.getAllTrackedWallets(true);
      
      const newWallets = new Set(wallets.map(w => w.wallet_address));

      // Add new wallets
      for (const wallet of newWallets) {
        if (!this.trackedWallets.has(wallet)) {
          await this.subscribeToWallet(wallet);
        }
      }

      // Remove wallets that are no longer tracked
      for (const wallet of this.trackedWallets) {
        if (!newWallets.has(wallet)) {
          await this.unsubscribeFromWallet(wallet);
        }
      }

      this.trackedWallets = newWallets;
    } catch (error) {
      logger.error('WalletTransactionMonitor', 'Failed to refresh tracked wallets', error as Error);
    }
  }

  /**
   * Setup WebSocket subscriptions for all tracked wallets
   */
  private async setupSubscriptions(): Promise<void> {
    for (const wallet of this.trackedWallets) {
      await this.subscribeToWallet(wallet);
    }
  }

  /**
   * Subscribe to a wallet's transactions
   */
  private async subscribeToWallet(walletAddress: string): Promise<void> {
    try {
      if (this.subscriptions.has(walletAddress)) {
        logger.debug('WalletTransactionMonitor', `Already subscribed to ${walletAddress.slice(0, 8)}...`);
        return;
      }

      const pubkey = new PublicKey(walletAddress);

      // Subscribe to account changes (this triggers when wallet activity occurs)
      const subscriptionId = this.connection.onAccountChange(
        pubkey,
        async () => {
          // When account changes, check for new transactions
          await this.checkWalletTransactions(walletAddress);
        },
        'confirmed'
      );

      this.subscriptions.set(walletAddress, subscriptionId);
      
      // Initial check for recent transactions
      await this.checkWalletTransactions(walletAddress);

      logger.debug('WalletTransactionMonitor', `Subscribed to wallet: ${walletAddress.slice(0, 8)}...`);
    } catch (error) {
      logger.error('WalletTransactionMonitor', `Failed to subscribe to wallet ${walletAddress}`, error as Error);
    }
  }

  /**
   * Unsubscribe from a wallet
   */
  private async unsubscribeFromWallet(walletAddress: string): Promise<void> {
    try {
      const subId = this.subscriptions.get(walletAddress);
      if (subId !== undefined) {
        await this.connection.removeAccountChangeListener(subId);
        this.subscriptions.delete(walletAddress);
        logger.debug('WalletTransactionMonitor', `Unsubscribed from wallet: ${walletAddress.slice(0, 8)}...`);
      }
    } catch (error) {
      logger.silentError('WalletTransactionMonitor', `Failed to unsubscribe from wallet ${walletAddress}`, error as Error);
    }
  }

  /**
   * Check wallet for new transactions
   */
  private async checkWalletTransactions(walletAddress: string): Promise<void> {
    try {
      // Rate limiting - don't check too frequently
      const lastCheck = this.lastCheckTime.get(walletAddress) || 0;
      const now = Date.now();
      if (now - lastCheck < this.MIN_CHECK_INTERVAL) {
        return;
      }
      this.lastCheckTime.set(walletAddress, now);

      const pubkey = new PublicKey(walletAddress);

      // Get recent signatures (last 10)
      const signatures = await this.connection.getSignaturesForAddress(pubkey, {
        limit: 10,
      });

      // Process each signature
      for (const sigInfo of signatures) {
        // Skip if already seen
        if (this.signaturesSeen.has(sigInfo.signature)) {
          continue;
        }

        this.signaturesSeen.add(sigInfo.signature);

        // Get transaction details
        const tx = await this.connection.getParsedTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (tx && tx.meta && !tx.meta.err) {
          await this.processTransaction(walletAddress, sigInfo.signature, tx);
        }
      }
    } catch (error) {
      logger.silentError('WalletTransactionMonitor', `Failed to check transactions for ${walletAddress}`, error as Error);
    }
  }

  /**
   * Process a transaction and extract token swaps/transfers
   */
  private async processTransaction(
    walletAddress: string,
    signature: string,
    tx: ParsedTransactionWithMeta
  ): Promise<void> {
    try {
      if (!tx.meta || !tx.blockTime) return;

      const blockTime = new Date(tx.blockTime * 1000);
      const slot = tx.slot;

      // Extract token balances changes
      const preBalances = tx.meta.preTokenBalances || [];
      const postBalances = tx.meta.postTokenBalances || [];

      // Group by token mint
      const balanceChanges = new Map<string, { pre: number; post: number; decimals: number }>();

      for (const preBalance of preBalances) {
        if (preBalance.owner === walletAddress) {
          const mint = preBalance.mint;
          const amount = preBalance.uiTokenAmount.uiAmount || 0;
          balanceChanges.set(mint, {
            pre: amount,
            post: 0,
            decimals: preBalance.uiTokenAmount.decimals,
          });
        }
      }

      for (const postBalance of postBalances) {
        if (postBalance.owner === walletAddress) {
          const mint = postBalance.mint;
          const amount = postBalance.uiTokenAmount.uiAmount || 0;
          const existing = balanceChanges.get(mint) || { pre: 0, post: 0, decimals: postBalance.uiTokenAmount.decimals };
          existing.post = amount;
          balanceChanges.set(mint, existing);
        }
      }

      // Detect DEX protocol
      const dexProtocol = this.detectDexProtocol(tx);

      // Process each token balance change
      for (const [mint, balances] of balanceChanges.entries()) {
        const change = balances.post - balances.pre;
        if (Math.abs(change) < 0.001) continue; // Ignore dust

        const action = change > 0 ? 'buy' : 'sell';
        const amount = Math.abs(change);

        // Get token price and metadata
        const tokenData = await dexScreenerService.getTokenData(mint);
        const priceUsd = tokenData?.priceUsd ? parseFloat(tokenData.priceUsd) : undefined;
        const valueUsd = priceUsd ? amount * priceUsd : undefined;

        // Estimate SOL value (rough)
        const valueSol = valueUsd ? valueUsd / 100 : undefined; // Assuming SOL ~$100

        const activity: WalletActivity = {
          wallet: walletAddress,
          signature,
          action,
          tokenMint: mint,
          tokenSymbol: tokenData?.baseToken?.symbol,
          amount,
          valueSol,
          valueUsd,
          priceUsd,
          dexProtocol,
          blockTime,
          slot,
        };

        // Save to database and emit event
        await this.saveTransaction(activity);
        this.emit('wallet_activity', activity);

        logger.info(
          'WalletTransactionMonitor',
          `${walletAddress.slice(0, 8)}... ${action.toUpperCase()} ${amount.toFixed(2)} ${activity.tokenSymbol || mint.slice(0, 8)}... ($${valueUsd?.toFixed(2) || '?'})`
        );
      }
    } catch (error) {
      logger.silentError('WalletTransactionMonitor', `Failed to process transaction ${signature}`, error as Error);
    }
  }

  /**
   * Detect which DEX/protocol was used
   */
  private detectDexProtocol(tx: ParsedTransactionWithMeta): string | undefined {
    const instructions = tx.transaction.message.instructions;

    for (const instruction of instructions) {
      const programId = instruction.programId.toString();

      if (programId === KNOWN_PROGRAM_IDS.RAYDIUM_AMM || programId === KNOWN_PROGRAM_IDS.RAYDIUM_AMM_V4) {
        return 'raydium';
      } else if (programId === KNOWN_PROGRAM_IDS.JUPITER_AGG_V6) {
        return 'jupiter';
      } else if (programId === KNOWN_PROGRAM_IDS.PUMPFUN) {
        return 'pumpfun';
      } else if (programId === KNOWN_PROGRAM_IDS.ORCA_WHIRLPOOL) {
        return 'orca';
      } else if (programId === KNOWN_PROGRAM_IDS.METEORA) {
        return 'meteora';
      }
    }

    return undefined;
  }

  /**
   * Save transaction to database
   */
  private async saveTransaction(activity: WalletActivity): Promise<void> {
    try {
      // Check if signature already exists
      const { data: existing } = await supabase
        .from('wallet_transactions')
        .select('id')
        .eq('signature', activity.signature)
        .single();

      if (existing) {
        logger.debug('WalletTransactionMonitor', `Transaction already recorded: ${activity.signature}`);
        return;
      }

      // Insert transaction
      const { error } = await supabase.from('wallet_transactions').insert({
        signature: activity.signature,
        wallet_address: activity.wallet,
        token_mint: activity.tokenMint,
        token_symbol: activity.tokenSymbol || null,
        token_name: null, // TODO: fetch if needed
        action: activity.action,
        amount: activity.amount,
        price_usd: activity.priceUsd || null,
        value_sol: activity.valueSol || null,
        value_usd: activity.valueUsd || null,
        dex_protocol: activity.dexProtocol || null,
        pool_address: activity.poolAddress || null,
        block_time: activity.blockTime.toISOString(),
        slot: activity.slot,
        fee_sol: null, // TODO: calculate from transaction
        alert_sent: false,
      });

      if (error) {
        logger.error('WalletTransactionMonitor', 'Failed to save transaction', error);
        return;
      }

      // Update wallet performance (async, don't wait)
      walletTracker.updatePerformance(activity.wallet).catch(err => {
        logger.silentError('WalletTransactionMonitor', 'Failed to update performance', err);
      });

    } catch (error) {
      logger.error('WalletTransactionMonitor', 'Failed to save transaction', error as Error);
    }
  }

  /**
   * Cleanup old seen signatures to prevent memory leak
   */
  private cleanupSeenSignatures(): void {
    // Keep only the most recent 10,000 signatures
    if (this.signaturesSeen.size > 10000) {
      const toRemove = this.signaturesSeen.size - 5000;
      const iterator = this.signaturesSeen.values();
      
      for (let i = 0; i < toRemove; i++) {
        const value = iterator.next().value;
        if (value) {
          this.signaturesSeen.delete(value);
        }
      }
      
      logger.debug('WalletTransactionMonitor', `Cleaned up ${toRemove} old signatures`);
    }
  }

  /**
   * Get monitoring status
   */
  getStatus(): {
    isRunning: boolean;
    trackedWallets: number;
    activeSubscriptions: number;
    seenSignatures: number;
  } {
    return {
      isRunning: this.isRunning,
      trackedWallets: this.trackedWallets.size,
      activeSubscriptions: this.subscriptions.size,
      seenSignatures: this.signaturesSeen.size,
    };
  }
}

// Singleton instance
export const walletTransactionMonitor = new WalletTransactionMonitor();
