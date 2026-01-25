/**
 * ML Data Collection Job
 * Runs every 5 minutes to collect snapshots for all active tokens
 * 
 * This is the heartbeat of the self-learning system
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { tokenSnapshotCollector } from '../ml/dataCollection/TokenSnapshotCollector';
import { adaptiveSampler } from '../ml/sampling/AdaptiveSampler';
import { database } from '../database';

// ============================================
// Configuration
// ============================================

const CONFIG = {
  COLLECTION_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  CLEANUP_INTERVAL_MS: 60 * 60 * 1000, // 1 hour
  MAX_COLLECTION_DURATION_MS: 4 * 60 * 1000, // 4 minutes max
};

// ============================================
// ML Data Collection Job
// ============================================

export class MLDataCollectionJob extends EventEmitter {
  private collectionInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lastRunAt: number = 0;
  
  // Stats
  private stats = {
    runsTotal: 0,
    runsSuccess: 0,
    runsFailed: 0,
    snapshotsCollected: 0,
    lastCollectionDurationMs: 0,
  };

  /**
   * Initialize the job
   */
  async initialize(): Promise<void> {
    await tokenSnapshotCollector.initialize();
    logger.info('MLDataCollectionJob', 'Initialized');
  }

  /**
   * Start the collection job
   */
  start(): void {
    if (this.collectionInterval) return;
    
    // Start collection interval
    this.collectionInterval = setInterval(() => {
      this.runCollection().catch(err => {
        logger.error('MLDataCollectionJob', 'Collection failed', err);
      });
    }, CONFIG.COLLECTION_INTERVAL_MS);
    
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.runCleanup();
    }, CONFIG.CLEANUP_INTERVAL_MS);
    
    // Run initial collection
    setTimeout(() => {
      this.runCollection().catch(err => {
        logger.error('MLDataCollectionJob', 'Initial collection failed', err);
      });
    }, 10000);
    
    logger.info('MLDataCollectionJob', 'Started (interval: 5 minutes)');
  }

  /**
   * Stop the collection job
   */
  async stop(): Promise<void> {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    await tokenSnapshotCollector.shutdown();
    
    logger.info('MLDataCollectionJob', 'Stopped');
  }

  /**
   * Run a collection cycle
   */
  private async runCollection(): Promise<void> {
    if (this.isRunning) {
      logger.warn('MLDataCollectionJob', 'Previous collection still running, skipping');
      return;
    }
    
    this.isRunning = true;
    const startTime = Date.now();
    this.stats.runsTotal++;
    
    try {
      // Set timeout to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Collection timeout')), CONFIG.MAX_COLLECTION_DURATION_MS);
      });
      
      // Run collection
      const resultPromise = tokenSnapshotCollector.collectAllSnapshots();
      
      const result = await Promise.race([resultPromise, timeoutPromise]);
      
      const duration = Date.now() - startTime;
      this.stats.lastCollectionDurationMs = duration;
      this.stats.snapshotsCollected += result.collected;
      
      if (result.errors === 0) {
        this.stats.runsSuccess++;
      }
      
      this.lastRunAt = Date.now();
      
      // Update dataset balance for sampling
      this.updateDatasetBalance();
      
      this.emit('collectionComplete', {
        collected: result.collected,
        skipped: result.skipped,
        errors: result.errors,
        durationMs: duration,
      });
      
      logger.info('MLDataCollectionJob', 
        `Collection complete: ${result.collected} snapshots in ${duration}ms`
      );
      
    } catch (error) {
      this.stats.runsFailed++;
      logger.error('MLDataCollectionJob', 'Collection error', error as Error);
      
      this.emit('collectionFailed', { error: (error as Error).message });
      
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run cleanup tasks
   */
  private runCleanup(): void {
    try {
      // Cleanup expired token watches
      const expired = tokenSnapshotCollector.cleanupExpired();
      
      // Cleanup old snapshots (older than 30 days)
      const cutoff = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
      const { deletedCount } = database.cleanupOldSnapshots(cutoff);
      
      if (expired > 0 || deletedCount > 0) {
        logger.info('MLDataCollectionJob', 
          `Cleanup: ${expired} expired watches, ${deletedCount} old snapshots`
        );
      }
    } catch (error) {
      logger.silentError('MLDataCollectionJob', 'Cleanup failed', error as Error);
    }
  }

  /**
   * Update dataset balance for smart sampling
   */
  private updateDatasetBalance(): void {
    try {
      const db = database.getDb();
      if (!db) return;
      
      const result = db.exec(`
        SELECT outcome, COUNT(*) as count
        FROM ml_training_data
        WHERE outcome IS NOT NULL
        GROUP BY outcome
      `);
      
      if (result.length > 0) {
        const counts: Record<string, number> = {};
        for (const row of result[0].values) {
          counts[row[0] as string] = row[1] as number;
        }
        adaptiveSampler.updateDatasetBalance(counts);
      }
    } catch (error) {
      // Non-critical
    }
  }

  /**
   * Add tokens discovered by the bot to tracking
   */
  addDiscoveredToken(mint: string, symbol: string, data: {
    liquidityUsd?: number;
    riskScore?: number;
    hasPrediction?: boolean;
  }): void {
    const tier = adaptiveSampler.determineTier(data.liquidityUsd || 0, {
      hasPrediction: data.hasPrediction,
      isHighPotential: (data.riskScore || 50) >= 70,
    });
    
    tokenSnapshotCollector.addToken(mint, symbol, {
      tier,
      liquidityUsd: data.liquidityUsd,
      hasPrediction: data.hasPrediction,
      expiresInHours: 48, // Track for 48 hours
    });
  }

  /**
   * Mark token as having interesting event
   */
  markInterestingEvent(mint: string, eventType: string): void {
    tokenSnapshotCollector.markInterestingEvent(mint, eventType);
  }

  /**
   * Mark token as having prediction
   */
  markHasPrediction(mint: string): void {
    tokenSnapshotCollector.markHasPrediction(mint);
  }

  /**
   * Get job stats
   */
  getStats(): {
    isRunning: boolean;
    lastRunAt: number;
    stats: typeof this.stats;
    collectorStats: ReturnType<typeof tokenSnapshotCollector.getStats>;
  } {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      stats: { ...this.stats },
      collectorStats: tokenSnapshotCollector.getStats(),
    };
  }

  /**
   * Get health status
   */
  getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    message: string;
  } {
    const now = Date.now();
    const timeSinceLastRun = now - this.lastRunAt;
    
    // Should run every 5 minutes, allow 10 minutes tolerance
    if (timeSinceLastRun > 10 * 60 * 1000) {
      return {
        status: 'unhealthy',
        message: `No collection in ${Math.floor(timeSinceLastRun / 60000)} minutes`,
      };
    }
    
    // Check failure rate
    const failureRate = this.stats.runsTotal > 0 
      ? this.stats.runsFailed / this.stats.runsTotal 
      : 0;
    
    if (failureRate > 0.3) {
      return {
        status: 'degraded',
        message: `High failure rate: ${(failureRate * 100).toFixed(0)}%`,
      };
    }
    
    return {
      status: 'healthy',
      message: `Last run: ${Math.floor(timeSinceLastRun / 1000)}s ago`,
    };
  }
}

// Export singleton
export const mlDataCollectionJob = new MLDataCollectionJob();
