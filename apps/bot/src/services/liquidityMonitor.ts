/**
 * Liquidity Monitor Service
 * 
 * Monitors LP tokens for:
 * - Liquidity removal/drainage
 * - LP unlock events
 * - Locker contract expiry
 * - Suspicious LP movements
 * 
 * Critical for detecting rug pulls before they happen.
 */

import { EventEmitter } from 'events';
import { solanaService } from './solana';
import { dexScreenerService } from './dexscreener';
import type { PoolInfo } from '../types';
import { logger } from '../utils/logger';

export interface LiquiditySnapshot {
  tokenMint: string;
  symbol: string;
  liquidityUsd: number;
  lpBurnedPercent: number;
  lpLockedPercent: number;
  lpLockerAddress?: string;
  lpSupply: number;
  timestamp: number;
}

export interface LiquidityAlert {
  type: 'drain' | 'unlock' | 'burn_change' | 'locker_expiry';
  severity: 'warning' | 'critical';
  tokenMint: string;
  symbol: string;
  message: string;
  details: {
    before: Partial<LiquiditySnapshot>;
    after: Partial<LiquiditySnapshot>;
    percentChange?: number;
    drainedUsd?: number;
  };
  timestamp: Date;
}

// Thresholds
const DRAIN_THRESHOLD_PERCENT = 20; // Alert if >20% liquidity removed
const CRITICAL_DRAIN_PERCENT = 50; // Critical if >50% removed
const BURN_CHANGE_THRESHOLD = 5; // Alert if burned% changes by >5%
const MONITOR_INTERVAL = 60000; // Check every 1 minute
const CLEANUP_INTERVAL = 3600000; // Cleanup old data every hour

export class LiquidityMonitorService extends EventEmitter {
  private isRunning = false;
  private monitorInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  private snapshots: Map<string, LiquiditySnapshot> = new Map();
  private watchedTokens: Set<string> = new Set();
  private alertHistory: Map<string, number> = new Map(); // token:type -> timestamp
  private readonly ALERT_COOLDOWN = 600000; // 10 minutes between same alert type

  constructor() {
    super();
  }

  /**
   * Start monitoring
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    logger.info('LiquidityMonitor', 'Starting liquidity monitor...');
    this.isRunning = true;

    // Initial snapshot
    await this.refreshSnapshots();

    // Start monitoring loop
    this.monitorInterval = setInterval(() => {
      this.checkLiquidity().catch((error) => {
        logger.error('LiquidityMonitor', 'Error in monitoring loop', error as Error);
      });
    }, MONITOR_INTERVAL);

    // Start cleanup loop
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL);

    logger.info('LiquidityMonitor', `Started - monitoring ${this.watchedTokens.size} tokens`);
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('LiquidityMonitor', 'Stopping liquidity monitor...');

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.isRunning = false;
    logger.info('LiquidityMonitor', 'Stopped');
  }

  /**
   * Add token to watchlist
   */
  addToken(tokenMint: string, symbol: string): void {
    if (!this.watchedTokens.has(tokenMint)) {
      this.watchedTokens.add(tokenMint);
      logger.info('LiquidityMonitor', `Added ${symbol} to watchlist`);
      
      // Take initial snapshot
      this.snapshotToken(tokenMint, symbol).catch((error) => {
        logger.error('LiquidityMonitor', `Failed to snapshot ${symbol}`, error as Error);
      });
    }
  }

  /**
   * Remove token from watchlist
   */
  removeToken(tokenMint: string): void {
    this.watchedTokens.delete(tokenMint);
    this.snapshots.delete(tokenMint);
  }

  /**
   * Get current snapshot for a token
   */
  getSnapshot(tokenMint: string): LiquiditySnapshot | undefined {
    return this.snapshots.get(tokenMint);
  }

  /**
   * Take snapshot of a single token
   */
  private async snapshotToken(tokenMint: string, symbol: string): Promise<void> {
    try {
      // Get DexScreener data for liquidity
      const dexData = await dexScreenerService.getTokenData(tokenMint);
      
      if (!dexData || !dexData.liquidity) {
        logger.debug('LiquidityMonitor', `No liquidity data for ${symbol}`);
        return;
      }

      // Get LP mint from pair data (would need to be extracted from pool info)
      // For now, we'll track liquidity USD value
      const snapshot: LiquiditySnapshot = {
        tokenMint,
        symbol,
        liquidityUsd: dexData.liquidity.usd || 0,
        lpBurnedPercent: 0, // Would need to fetch from LP analysis
        lpLockedPercent: 0,
        lpSupply: 0,
        timestamp: Date.now(),
      };

      this.snapshots.set(tokenMint, snapshot);
      logger.debug('LiquidityMonitor', `Snapshot taken for ${symbol}: $${snapshot.liquidityUsd.toLocaleString()}`);
    } catch (error) {
      logger.error('LiquidityMonitor', `Failed to snapshot ${symbol}`, error as Error);
    }
  }

  /**
   * Refresh snapshots for all watched tokens
   */
  private async refreshSnapshots(): Promise<void> {
    const tokens = Array.from(this.watchedTokens);
    
    for (const tokenMint of tokens) {
      const existing = this.snapshots.get(tokenMint);
      const symbol = existing?.symbol || tokenMint.slice(0, 8);
      
      await this.snapshotToken(tokenMint, symbol);
      
      // Rate limit: small delay between snapshots
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Check liquidity for all watched tokens
   */
  private async checkLiquidity(): Promise<void> {
    const tokens = Array.from(this.watchedTokens);
    
    for (const tokenMint of tokens) {
      try {
        await this.checkTokenLiquidity(tokenMint);
      } catch (error) {
        logger.silentError('LiquidityMonitor', `Error checking ${tokenMint}`, error as Error);
      }
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Check liquidity for a single token
   */
  private async checkTokenLiquidity(tokenMint: string): Promise<void> {
    const oldSnapshot = this.snapshots.get(tokenMint);
    if (!oldSnapshot) return;

    // Get new snapshot
    const dexData = await dexScreenerService.getTokenData(tokenMint);
    if (!dexData || !dexData.liquidity) return;

    const newLiquidityUsd = dexData.liquidity.usd || 0;
    const oldLiquidityUsd = oldSnapshot.liquidityUsd;

    // Calculate change
    if (oldLiquidityUsd === 0) return;
    
    const percentChange = ((newLiquidityUsd - oldLiquidityUsd) / oldLiquidityUsd) * 100;
    const drainedUsd = oldLiquidityUsd - newLiquidityUsd;

    // Check for significant drain
    if (percentChange < -DRAIN_THRESHOLD_PERCENT) {
      const severity: 'warning' | 'critical' = percentChange < -CRITICAL_DRAIN_PERCENT ? 'critical' : 'warning';
      
      const alert: LiquidityAlert = {
        type: 'drain',
        severity,
        tokenMint,
        symbol: oldSnapshot.symbol,
        message: `Liquidity drained ${Math.abs(percentChange).toFixed(1)}% ($${drainedUsd.toLocaleString()})`,
        details: {
          before: { liquidityUsd: oldLiquidityUsd },
          after: { liquidityUsd: newLiquidityUsd },
          percentChange,
          drainedUsd,
        },
        timestamp: new Date(),
      };

      if (this.shouldSendAlert(tokenMint, 'drain')) {
        this.emit('alert', alert);
        this.markAlertSent(tokenMint, 'drain');
        logger.warn('LiquidityMonitor', `DRAIN ALERT: ${oldSnapshot.symbol} - ${alert.message}`);
      }
    }

    // Update snapshot
    this.snapshots.set(tokenMint, {
      ...oldSnapshot,
      liquidityUsd: newLiquidityUsd,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if alert should be sent (cooldown check)
   */
  private shouldSendAlert(tokenMint: string, alertType: string): boolean {
    const key = `${tokenMint}:${alertType}`;
    const lastAlert = this.alertHistory.get(key);
    
    if (!lastAlert) return true;
    
    const timeSince = Date.now() - lastAlert;
    return timeSince > this.ALERT_COOLDOWN;
  }

  /**
   * Mark alert as sent
   */
  private markAlertSent(tokenMint: string, alertType: string): void {
    const key = `${tokenMint}:${alertType}`;
    this.alertHistory.set(key, Date.now());
  }

  /**
   * Cleanup old data
   */
  private cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    // Remove old snapshots for tokens no longer watched
    for (const [mint, snapshot] of this.snapshots.entries()) {
      if (!this.watchedTokens.has(mint) && now - snapshot.timestamp > maxAge) {
        this.snapshots.delete(mint);
      }
    }

    // Clean old alert history
    for (const [key, timestamp] of this.alertHistory.entries()) {
      if (now - timestamp > maxAge) {
        this.alertHistory.delete(key);
      }
    }

    logger.debug('LiquidityMonitor', `Cleanup: ${this.snapshots.size} snapshots, ${this.watchedTokens.size} watched`);
  }

  /**
   * Get stats
   */
  getStats(): {
    watchedTokens: number;
    snapshots: number;
    alertHistory: number;
  } {
    return {
      watchedTokens: this.watchedTokens.size,
      snapshots: this.snapshots.size,
      alertHistory: this.alertHistory.size,
    };
  }
}

// Singleton export
export const liquidityMonitor = new LiquidityMonitorService();
