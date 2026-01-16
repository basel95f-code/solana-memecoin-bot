/**
 * Snapshot Collector Service
 * Collects periodic price/volume/liquidity snapshots for backtesting
 */

import { dexScreenerService } from '../services/dexscreener';
import { database } from '../database';
import { logger } from '../utils/logger';

// Snapshot interval: 5 minutes
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
// Default watch duration: 24 hours
const DEFAULT_WATCH_DURATION_MS = 24 * 60 * 60 * 1000;
// Max tokens to watch simultaneously
const MAX_WATCHED_TOKENS = 100;
// Batch size for DexScreener API
const BATCH_SIZE = 30;

export interface TokenSnapshot {
  mint: string;
  symbol?: string;
  priceUsd: number;
  priceSol?: number;
  volume5m?: number;
  volume1h?: number;
  volume24h?: number;
  liquidityUsd?: number;
  marketCap?: number;
  holderCount?: number;
  priceChange5m?: number;
  priceChange1h?: number;
  priceChange24h?: number;
  buys5m?: number;
  sells5m?: number;
  buys1h?: number;
  sells1h?: number;
  recordedAt: number;
}

export interface WatchedToken {
  mint: string;
  symbol?: string;
  addedAt: number;
  lastSnapshotAt?: number;
  snapshotCount: number;
  isActive: boolean;
  expiresAt?: number;
}

class SnapshotCollector {
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private initialized: boolean = false;

  /**
   * Initialize the snapshot collector
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Clean up expired watch entries
    this.cleanupExpiredWatches();

    this.initialized = true;
    logger.info('SnapshotCollector', 'Initialized');
  }

  /**
   * Start collecting snapshots
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('SnapshotCollector', 'Already running');
      return;
    }

    this.isRunning = true;
    logger.info('SnapshotCollector', 'Started snapshot collection');

    // Run immediately, then on interval
    void this.collectSnapshots();
    this.intervalId = setInterval(() => {
      void this.collectSnapshots();
    }, SNAPSHOT_INTERVAL_MS);
  }

  /**
   * Stop collecting snapshots
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info('SnapshotCollector', 'Stopped snapshot collection');
  }

  /**
   * Add a token to the watch list
   */
  addToWatchList(
    mint: string,
    symbol?: string,
    durationMs: number = DEFAULT_WATCH_DURATION_MS
  ): boolean {
    const watchList = this.getWatchList();
    const activeCount = watchList.filter(w => w.isActive).length;

    if (activeCount >= MAX_WATCHED_TOKENS) {
      logger.warn('SnapshotCollector', `Max watched tokens (${MAX_WATCHED_TOKENS}) reached`);
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + Math.floor(durationMs / 1000);

    database.addToSnapshotWatchList(mint, symbol, expiresAt);
    logger.info('SnapshotCollector', `Added ${symbol || mint} to watch list`);
    return true;
  }

  /**
   * Remove a token from the watch list
   */
  removeFromWatchList(mint: string): void {
    database.removeFromSnapshotWatchList(mint);
    logger.info('SnapshotCollector', `Removed ${mint} from watch list`);
  }

  /**
   * Get the current watch list
   */
  getWatchList(): WatchedToken[] {
    return database.getSnapshotWatchList();
  }

  /**
   * Get snapshots for a token
   */
  getSnapshots(mint: string, limit: number = 288): TokenSnapshot[] {
    // 288 = 24 hours at 5-minute intervals
    return database.getTokenSnapshots(mint, limit);
  }

  /**
   * Get snapshots for a token within a time range
   */
  getSnapshotsInRange(mint: string, startTime: number, endTime: number): TokenSnapshot[] {
    return database.getTokenSnapshotsInRange(mint, startTime, endTime);
  }

  /**
   * Trigger immediate snapshot for a token (used on discovery)
   */
  async triggerSnapshot(mint: string, symbol?: string): Promise<TokenSnapshot | null> {
    try {
      const pairData = await dexScreenerService.getTokenData(mint);
      if (!pairData) {
        logger.debug('SnapshotCollector', `No pair data for ${mint}`);
        return null;
      }

      const snapshot = this.createSnapshot(mint, pairData, symbol);
      database.saveTokenSnapshot(snapshot);

      logger.debug('SnapshotCollector', `Triggered snapshot for ${symbol || mint}`);
      return snapshot;
    } catch (error) {
      logger.error('SnapshotCollector', `Failed to trigger snapshot for ${mint}`, error as Error);
      return null;
    }
  }

  /**
   * Collect snapshots for all watched tokens
   */
  private async collectSnapshots(): Promise<void> {
    const watchList = this.getWatchList().filter(w => w.isActive);

    if (watchList.length === 0) {
      logger.debug('SnapshotCollector', 'No tokens to collect snapshots for');
      return;
    }

    logger.debug('SnapshotCollector', `Collecting snapshots for ${watchList.length} tokens`);

    // Process in batches
    const mints = watchList.map(w => w.mint);

    for (let i = 0; i < mints.length; i += BATCH_SIZE) {
      const batch = mints.slice(i, i + BATCH_SIZE);
      await this.collectBatchSnapshots(batch, watchList);
    }

    // Cleanup expired watches
    this.cleanupExpiredWatches();
  }

  /**
   * Collect snapshots for a batch of tokens
   */
  private async collectBatchSnapshots(
    mints: string[],
    watchList: WatchedToken[]
  ): Promise<void> {
    try {
      const pairDataMap = await dexScreenerService.getMultipleTokensData(mints);

      for (const mint of mints) {
        const pairData = pairDataMap.get(mint);
        const watchEntry = watchList.find(w => w.mint === mint);

        if (pairData) {
          const snapshot = this.createSnapshot(mint, pairData, watchEntry?.symbol);
          database.saveTokenSnapshot(snapshot);
          database.updateSnapshotWatchEntry(mint);
        }
      }

      logger.debug('SnapshotCollector', `Collected ${pairDataMap.size} snapshots from batch of ${mints.length}`);
    } catch (error) {
      logger.error('SnapshotCollector', 'Batch snapshot collection failed', error as Error);
    }
  }

  /**
   * Create a snapshot from DexScreener pair data
   */
  private createSnapshot(mint: string, pairData: any, symbol?: string): TokenSnapshot {
    const now = Math.floor(Date.now() / 1000);

    return {
      mint,
      symbol: symbol || pairData.baseToken?.symbol,
      priceUsd: parseFloat(pairData.priceUsd || '0'),
      priceSol: parseFloat(pairData.priceNative || '0'),
      volume5m: pairData.volume?.m5,
      volume1h: pairData.volume?.h1,
      volume24h: pairData.volume?.h24,
      liquidityUsd: pairData.liquidity?.usd,
      marketCap: pairData.marketCap,
      holderCount: undefined, // Not available from DexScreener
      priceChange5m: pairData.priceChange?.m5,
      priceChange1h: pairData.priceChange?.h1,
      priceChange24h: pairData.priceChange?.h24,
      buys5m: pairData.txns?.m5?.buys,
      sells5m: pairData.txns?.m5?.sells,
      buys1h: pairData.txns?.h1?.buys,
      sells1h: pairData.txns?.h1?.sells,
      recordedAt: now,
    };
  }

  /**
   * Clean up expired watch entries
   */
  private cleanupExpiredWatches(): void {
    const now = Math.floor(Date.now() / 1000);
    database.cleanupExpiredSnapshotWatches(now);
  }

  /**
   * Get statistics about snapshot collection
   */
  getStats(): {
    isRunning: boolean;
    watchedTokens: number;
    totalSnapshots: number;
  } {
    const watchList = this.getWatchList();
    const stats = database.getSnapshotStats();

    return {
      isRunning: this.isRunning,
      watchedTokens: watchList.filter(w => w.isActive).length,
      totalSnapshots: stats.totalSnapshots,
    };
  }
}

export const snapshotCollector = new SnapshotCollector();
