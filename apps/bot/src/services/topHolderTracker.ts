/**
 * Top Holder Changes Tracker
 * 
 * Monitors top holder positions for:
 * - Whale accumulation (increasing position)
 * - Whale dumping (decreasing position)
 * - New whales entering top 10/20
 * - Whales exiting positions
 * 
 * Provides early signals for price movements.
 */

import { EventEmitter } from 'events';
import { solanaService } from './solana';
import type { HolderInfo } from '../types';
import { logger } from '../utils/logger';

export interface HolderSnapshot {
  address: string;
  percentage: number;
  balance: number;
  rank: number; // 1-based rank in top holders
}

export interface TokenHolderState {
  tokenMint: string;
  symbol: string;
  holders: HolderSnapshot[];
  totalSupply: number;
  timestamp: number;
}

export interface HolderChangeAlert {
  type: 'whale_accumulation' | 'whale_dump' | 'new_whale' | 'whale_exit' | 'rank_change';
  severity: 'info' | 'warning' | 'critical';
  tokenMint: string;
  symbol: string;
  walletAddress: string;
  message: string;
  details: {
    oldPercent?: number;
    newPercent?: number;
    percentChange?: number;
    oldRank?: number;
    newRank?: number;
    amountChanged?: number;
  };
  timestamp: Date;
}

// Thresholds
const ACCUMULATION_THRESHOLD = 1; // +1% increase = accumulation
const DUMP_THRESHOLD = 1; // -1% decrease = dump
const LARGE_ACCUMULATION = 3; // +3% = large accumulation
const LARGE_DUMP = 3; // -3% = large dump
const CHECK_INTERVAL = 180000; // Check every 3 minutes
const CLEANUP_INTERVAL = 3600000; // Cleanup every hour

export class TopHolderTrackerService extends EventEmitter {
  private isRunning = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  private trackedTokens: Map<string, TokenHolderState> = new Map(); // tokenMint -> state
  private alertHistory: Map<string, number> = new Map(); // token:wallet:type -> timestamp
  private readonly ALERT_COOLDOWN = 1800000; // 30 minutes between same alert

  constructor() {
    super();
  }

  /**
   * Start tracker
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    logger.info('TopHolderTracker', 'Starting top holder tracker...');
    this.isRunning = true;

    // Start monitoring loop
    this.checkInterval = setInterval(() => {
      this.checkAllTokens().catch((error) => {
        logger.error('TopHolderTracker', 'Error in monitoring loop', error as Error);
      });
    }, CHECK_INTERVAL);

    // Start cleanup loop
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL);

    logger.info('TopHolderTracker', `Started - monitoring ${this.trackedTokens.size} tokens`);
  }

  /**
   * Stop tracker
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('TopHolderTracker', 'Stopping top holder tracker...');

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.isRunning = false;
    logger.info('TopHolderTracker', 'Stopped');
  }

  /**
   * Add token to tracking
   */
  async addToken(tokenMint: string, symbol: string, holders: HolderInfo[], totalSupply: number): Promise<void> {
    try {
      // Create initial snapshot
      const snapshots: HolderSnapshot[] = holders.slice(0, 20).map((h, index) => ({
        address: h.address,
        percentage: h.percentage,
        balance: h.balance,
        rank: index + 1,
      }));

      const state: TokenHolderState = {
        tokenMint,
        symbol,
        holders: snapshots,
        totalSupply,
        timestamp: Date.now(),
      };

      this.trackedTokens.set(tokenMint, state);
      logger.info('TopHolderTracker', `Tracking ${symbol}: ${snapshots.length} holders`);
    } catch (error) {
      logger.error('TopHolderTracker', `Failed to add ${symbol}`, error as Error);
    }
  }

  /**
   * Remove token from tracking
   */
  removeToken(tokenMint: string): void {
    this.trackedTokens.delete(tokenMint);
  }

  /**
   * Get current holder state
   */
  getHolderState(tokenMint: string): TokenHolderState | undefined {
    return this.trackedTokens.get(tokenMint);
  }

  /**
   * Check all tracked tokens
   */
  private async checkAllTokens(): Promise<void> {
    const tokens = Array.from(this.trackedTokens.keys());
    
    for (const tokenMint of tokens) {
      try {
        await this.checkHolderChanges(tokenMint);
      } catch (error) {
        logger.silentError('TopHolderTracker', `Error checking ${tokenMint}`, error as Error);
      }
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  /**
   * Check holder changes for a single token
   */
  private async checkHolderChanges(tokenMint: string): Promise<void> {
    const oldState = this.trackedTokens.get(tokenMint);
    if (!oldState) return;

    // Get current holders
    const tokenInfo = await solanaService.getTokenInfo(tokenMint);
    if (!tokenInfo) return;

    const currentHolders = await solanaService.getTokenHolders(tokenMint, 20);
    if (currentHolders.length === 0) return;

    // Create new snapshots
    const newSnapshots: HolderSnapshot[] = currentHolders.map((h, index) => ({
      address: h.address,
      percentage: (h.balance / tokenInfo.supply) * 100,
      balance: h.balance,
      rank: index + 1,
    }));

    // Compare with old state
    await this.detectChanges(oldState, newSnapshots);

    // Update state
    oldState.holders = newSnapshots;
    oldState.timestamp = Date.now();
    this.trackedTokens.set(tokenMint, oldState);
  }

  /**
   * Detect changes between old and new snapshots
   */
  private async detectChanges(oldState: TokenHolderState, newHolders: HolderSnapshot[]): Promise<void> {
    const oldMap = new Map(oldState.holders.map(h => [h.address, h]));
    const newMap = new Map(newHolders.map(h => [h.address, h]));

    // Check existing holders for changes
    for (const [address, newHolder] of newMap) {
      const oldHolder = oldMap.get(address);

      if (oldHolder) {
        // Existing holder - check for position changes
        const percentChange = newHolder.percentage - oldHolder.percentage;
        const rankChange = oldHolder.rank - newHolder.rank; // Positive = moved up

        // Accumulation
        if (percentChange >= ACCUMULATION_THRESHOLD) {
          const severity = percentChange >= LARGE_ACCUMULATION ? 'warning' : 'info';
          
          const alert: HolderChangeAlert = {
            type: 'whale_accumulation',
            severity,
            tokenMint: oldState.tokenMint,
            symbol: oldState.symbol,
            walletAddress: address,
            message: `Whale increased position by ${percentChange.toFixed(2)}%`,
            details: {
              oldPercent: oldHolder.percentage,
              newPercent: newHolder.percentage,
              percentChange,
              oldRank: oldHolder.rank,
              newRank: newHolder.rank,
            },
            timestamp: new Date(),
          };

          if (this.shouldSendAlert(oldState.tokenMint, address, 'whale_accumulation')) {
            this.emit('alert', alert);
            this.markAlertSent(oldState.tokenMint, address, 'whale_accumulation');
            logger.info('TopHolderTracker', `ACCUMULATION: ${oldState.symbol} - Whale ${address.slice(0, 8)} +${percentChange.toFixed(2)}%`);
          }
        }

        // Dumping
        if (percentChange <= -DUMP_THRESHOLD) {
          const severity = percentChange <= -LARGE_DUMP ? 'critical' : 'warning';
          
          const alert: HolderChangeAlert = {
            type: 'whale_dump',
            severity,
            tokenMint: oldState.tokenMint,
            symbol: oldState.symbol,
            walletAddress: address,
            message: `Whale decreased position by ${Math.abs(percentChange).toFixed(2)}%`,
            details: {
              oldPercent: oldHolder.percentage,
              newPercent: newHolder.percentage,
              percentChange,
              oldRank: oldHolder.rank,
              newRank: newHolder.rank,
            },
            timestamp: new Date(),
          };

          if (this.shouldSendAlert(oldState.tokenMint, address, 'whale_dump')) {
            this.emit('alert', alert);
            this.markAlertSent(oldState.tokenMint, address, 'whale_dump');
            logger.warn('TopHolderTracker', `DUMP: ${oldState.symbol} - Whale ${address.slice(0, 8)} -${Math.abs(percentChange).toFixed(2)}%`);
          }
        }

        // Significant rank change (moved up 3+ spots)
        if (rankChange >= 3) {
          const alert: HolderChangeAlert = {
            type: 'rank_change',
            severity: 'info',
            tokenMint: oldState.tokenMint,
            symbol: oldState.symbol,
            walletAddress: address,
            message: `Moved from #${oldHolder.rank} to #${newHolder.rank}`,
            details: {
              oldRank: oldHolder.rank,
              newRank: newHolder.rank,
              oldPercent: oldHolder.percentage,
              newPercent: newHolder.percentage,
            },
            timestamp: new Date(),
          };

          if (this.shouldSendAlert(oldState.tokenMint, address, 'rank_change')) {
            this.emit('alert', alert);
            this.markAlertSent(oldState.tokenMint, address, 'rank_change');
          }
        }
      } else {
        // New whale in top holders
        if (newHolder.rank <= 10) {
          const alert: HolderChangeAlert = {
            type: 'new_whale',
            severity: 'info',
            tokenMint: oldState.tokenMint,
            symbol: oldState.symbol,
            walletAddress: address,
            message: `New whale entered top 10 at rank #${newHolder.rank} (${newHolder.percentage.toFixed(2)}%)`,
            details: {
              newPercent: newHolder.percentage,
              newRank: newHolder.rank,
            },
            timestamp: new Date(),
          };

          if (this.shouldSendAlert(oldState.tokenMint, address, 'new_whale')) {
            this.emit('alert', alert);
            this.markAlertSent(oldState.tokenMint, address, 'new_whale');
            logger.info('TopHolderTracker', `NEW WHALE: ${oldState.symbol} - ${address.slice(0, 8)} at #${newHolder.rank}`);
          }
        }
      }
    }

    // Check for whales that exited top 20
    for (const [address, oldHolder] of oldMap) {
      if (!newMap.has(address) && oldHolder.rank <= 10) {
        const alert: HolderChangeAlert = {
          type: 'whale_exit',
          severity: 'warning',
          tokenMint: oldState.tokenMint,
          symbol: oldState.symbol,
          walletAddress: address,
          message: `Whale exited top 20 (was #${oldHolder.rank} with ${oldHolder.percentage.toFixed(2)}%)`,
          details: {
            oldPercent: oldHolder.percentage,
            oldRank: oldHolder.rank,
          },
          timestamp: new Date(),
        };

        if (this.shouldSendAlert(oldState.tokenMint, address, 'whale_exit')) {
          this.emit('alert', alert);
          this.markAlertSent(oldState.tokenMint, address, 'whale_exit');
          logger.warn('TopHolderTracker', `WHALE EXIT: ${oldState.symbol} - ${address.slice(0, 8)} left top 20`);
        }
      }
    }
  }

  /**
   * Check if alert should be sent (cooldown check)
   */
  private shouldSendAlert(tokenMint: string, walletAddress: string, alertType: string): boolean {
    const key = `${tokenMint}:${walletAddress}:${alertType}`;
    const lastAlert = this.alertHistory.get(key);
    
    if (!lastAlert) return true;
    
    const timeSince = Date.now() - lastAlert;
    return timeSince > this.ALERT_COOLDOWN;
  }

  /**
   * Mark alert as sent
   */
  private markAlertSent(tokenMint: string, walletAddress: string, alertType: string): void {
    const key = `${tokenMint}:${walletAddress}:${alertType}`;
    this.alertHistory.set(key, Date.now());
  }

  /**
   * Cleanup old data
   */
  private cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    // Remove old tracked tokens (no activity in 24h)
    for (const [mint, state] of this.trackedTokens.entries()) {
      if (now - state.timestamp > maxAge) {
        this.trackedTokens.delete(mint);
      }
    }

    // Clean old alert history
    for (const [key, timestamp] of this.alertHistory.entries()) {
      if (now - timestamp > maxAge) {
        this.alertHistory.delete(key);
      }
    }

    logger.debug('TopHolderTracker', `Cleanup: ${this.trackedTokens.size} tracked tokens`);
  }

  /**
   * Get stats
   */
  getStats(): {
    trackedTokens: number;
    alertHistory: number;
  } {
    return {
      trackedTokens: this.trackedTokens.size,
      alertHistory: this.alertHistory.size,
    };
  }
}

// Singleton export
export const topHolderTracker = new TopHolderTrackerService();
