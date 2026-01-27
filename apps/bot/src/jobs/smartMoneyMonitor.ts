/**
 * Smart Money Monitor Job
 * Runs every 5 minutes to track smart money wallet activity
 */

import { smartMoneyLearner } from '../services/smartMoneyLearner';
import { solanaService } from '../services/solana';
import { dexScreenerService } from '../services/dexscreener';
import { logger } from '../utils/logger';
import type { ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js';

interface WalletTransaction {
  signature: string;
  tokenMint: string;
  amount: number;
  type: 'buy' | 'sell';
  price: number;
  timestamp: number;
}

export class SmartMoneyMonitor {
  private isRunning: boolean = false;
  private interval: NodeJS.Timeout | null = null;
  private lastCheckTime: Map<string, number> = new Map(); // wallet -> timestamp

  /**
   * Start the monitor
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('SmartMoneyMonitor', 'Already running');
      return;
    }

    this.isRunning = true;
    logger.info('SmartMoneyMonitor', 'Starting smart money monitor');

    // Initialize the learner
    smartMoneyLearner.initialize();

    // Run immediately
    await this.runMonitorCycle();

    // Then run every 5 minutes
    this.interval = setInterval(async () => {
      await this.runMonitorCycle();
    }, 5 * 60 * 1000);

    logger.info('SmartMoneyMonitor', 'Smart money monitor started (5 min interval)');
  }

  /**
   * Stop the monitor
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    logger.info('SmartMoneyMonitor', 'Smart money monitor stopped');
  }

  /**
   * Run a single monitoring cycle
   */
  private async runMonitorCycle(): Promise<void> {
    try {
      logger.debug('SmartMoneyMonitor', 'Running monitor cycle...');

      // 1. Get all tracked wallets
      const wallets = await smartMoneyLearner.getAllTrackedWallets();
      
      if (wallets.length === 0) {
        logger.debug('SmartMoneyMonitor', 'No wallets to monitor');
        return;
      }

      logger.debug('SmartMoneyMonitor', `Monitoring ${wallets.length} wallets`);

      // 2. Check each wallet for new transactions
      for (const wallet of wallets) {
        await this.checkWalletActivity(wallet.wallet_address);
      }

      // 3. Update trade statuses (check if open trades have exited)
      await smartMoneyLearner.updateTradeStatus();

      // 4. Recalculate wallet metrics and reputation scores
      // (This is done automatically when trades are closed)

      // 5. Generate alerts for new moves
      const alerts = await smartMoneyLearner.checkForNewMoves();
      
      if (alerts.length > 0) {
        logger.info('SmartMoneyMonitor', `Generated ${alerts.length} smart money alerts`);
        // TODO: Post alerts to groups/users
      }

      logger.debug('SmartMoneyMonitor', 'Monitor cycle completed');
    } catch (error) {
      logger.error('SmartMoneyMonitor', 'Monitor cycle failed', error as Error);
    }
  }

  /**
   * Check a specific wallet for new activity
   */
  private async checkWalletActivity(walletAddress: string): Promise<void> {
    try {
      const connection = solanaService.getConnection();
      const publicKey = new (await import('@solana/web3.js')).PublicKey(walletAddress);

      // Get transaction signatures since last check
      const lastCheck = this.lastCheckTime.get(walletAddress) || (Date.now() - 5 * 60 * 1000);
      const signatures = await connection.getSignaturesForAddress(publicKey, {
        limit: 10,
      });

      if (signatures.length === 0) return;

      // Update last check time
      this.lastCheckTime.set(walletAddress, Date.now());

      // Process recent transactions
      for (const sig of signatures) {
        // Skip if transaction is older than last check
        if (sig.blockTime && sig.blockTime * 1000 < lastCheck) {
          continue;
        }

        await this.processTransaction(walletAddress, sig.signature);
      }
    } catch (error) {
      logger.silentError('SmartMoneyMonitor', `Failed to check wallet ${walletAddress.slice(0, 8)}...`, error as Error);
    }
  }

  /**
   * Process a transaction to detect buy/sell activity
   */
  private async processTransaction(walletAddress: string, signature: string): Promise<void> {
    try {
      const connection = solanaService.getConnection();
      const tx = await connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || !tx.meta) return;

      // Parse transaction for token transfers
      const tokenTransfers = this.parseTokenTransfers(tx, walletAddress);

      for (const transfer of tokenTransfers) {
        // Get token data
        const tokenData = await dexScreenerService.getTokenData(transfer.tokenMint);
        const price = tokenData?.priceUsd || 0;

        if (transfer.type === 'buy') {
          // Record entry
          await smartMoneyLearner.recordTrade(walletAddress, transfer.tokenMint, {
            tokenSymbol: tokenData?.baseToken?.symbol,
            entryPrice: Number(price),
            entryLiquidity: tokenData?.liquidity?.usd ? Number(tokenData.liquidity.usd) : undefined,
          });
        } else if (transfer.type === 'sell') {
          // Close trade
          await smartMoneyLearner.closeTrade(walletAddress, transfer.tokenMint, {
            exitPrice: Number(price),
            exitReason: 'user_exit'
          });
        }
      }
    } catch (error) {
      logger.silentError('SmartMoneyMonitor', `Failed to process transaction ${signature}`, error as Error);
    }
  }

  /**
   * Parse token transfers from a transaction
   */
  private parseTokenTransfers(tx: ParsedTransactionWithMeta, walletAddress: string): WalletTransaction[] {
    const transfers: WalletTransaction[] = [];

    try {
      if (!tx.meta || !tx.blockTime) return transfers;

      const instructions = tx.transaction.message.instructions;

      for (const instruction of instructions) {
        // Check if it's a parsed instruction
        if (!('parsed' in instruction)) continue;

        const parsed = instruction.parsed;
        
        // Check for token transfers
        if (parsed.type === 'transfer' || parsed.type === 'transferChecked') {
          const info = parsed.info;
          
          // Determine if this is a buy or sell
          const isReceiving = info.destination && info.destination === walletAddress;
          const isSending = info.source && info.source === walletAddress;

          if (isReceiving || isSending) {
            transfers.push({
              signature: tx.transaction.signatures[0],
              tokenMint: info.mint || 'unknown',
              amount: parseFloat(info.amount || info.tokenAmount?.uiAmount || '0'),
              type: isReceiving ? 'buy' : 'sell',
              price: 0, // Will be fetched separately
              timestamp: tx.blockTime,
            });
          }
        }
      }
    } catch (error) {
      logger.silentError('SmartMoneyMonitor', 'Failed to parse token transfers', error as Error);
    }

    return transfers;
  }

  /**
   * Get monitor status
   */
  getStatus(): {
    isRunning: boolean;
    walletsMonitored: number;
    lastCheckTimes: Record<string, number>;
  } {
    return {
      isRunning: this.isRunning,
      walletsMonitored: this.lastCheckTime.size,
      lastCheckTimes: Object.fromEntries(this.lastCheckTime),
    };
  }
}

// Singleton instance
export const smartMoneyMonitor = new SmartMoneyMonitor();
