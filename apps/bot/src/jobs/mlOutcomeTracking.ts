/**
 * ML Outcome Tracking Job
 * Runs every 15 minutes to track prediction outcomes
 * 
 * - Checks predictions made 1h/6h/24h ago
 * - Updates outcomes
 * - Calculates prediction accuracy
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { outcomeTracker } from '../ml/outcomes/OutcomeTracker';
import { autoTrainer } from '../ml/training/AutoTrainer';

// ============================================
// Configuration
// ============================================

const CONFIG = {
  TRACKING_INTERVAL_MS: 15 * 60 * 1000, // 15 minutes
  MAX_TRACKING_DURATION_MS: 10 * 60 * 1000, // 10 minutes max
};

// ============================================
// ML Outcome Tracking Job
// ============================================

export class MLOutcomeTrackingJob extends EventEmitter {
  private trackingInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lastRunAt: number = 0;
  
  // Stats
  private stats = {
    runsTotal: 0,
    runsSuccess: 0,
    runsFailed: 0,
    outcomesRecorded: 0,
    checkpointsRecorded: 0,
    lastDurationMs: 0,
  };

  /**
   * Initialize the job
   */
  async initialize(): Promise<void> {
    await outcomeTracker.initialize();
    logger.info('MLOutcomeTrackingJob', 'Initialized');
  }

  /**
   * Start the tracking job
   */
  start(): void {
    if (this.trackingInterval) return;
    
    this.trackingInterval = setInterval(() => {
      this.runTracking().catch(err => {
        logger.error('MLOutcomeTrackingJob', 'Tracking failed', err);
      });
    }, CONFIG.TRACKING_INTERVAL_MS);
    
    // Run initial tracking after delay
    setTimeout(() => {
      this.runTracking().catch(err => {
        logger.error('MLOutcomeTrackingJob', 'Initial tracking failed', err);
      });
    }, 30000);
    
    logger.info('MLOutcomeTrackingJob', 'Started (interval: 15 minutes)');
  }

  /**
   * Stop the tracking job
   */
  stop(): void {
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
    
    logger.info('MLOutcomeTrackingJob', 'Stopped');
  }

  /**
   * Run a tracking cycle
   */
  private async runTracking(): Promise<void> {
    if (this.isRunning) {
      logger.warn('MLOutcomeTrackingJob', 'Previous tracking still running, skipping');
      return;
    }
    
    this.isRunning = true;
    const startTime = Date.now();
    this.stats.runsTotal++;
    
    try {
      // Set timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Tracking timeout')), CONFIG.MAX_TRACKING_DURATION_MS);
      });
      
      // Run outcome tracking
      const resultPromise = outcomeTracker.processOutcomes();
      
      const result = await Promise.race([resultPromise, timeoutPromise]);
      
      const duration = Date.now() - startTime;
      this.stats.lastDurationMs = duration;
      this.stats.outcomesRecorded += result.outcomesRecorded;
      this.stats.checkpointsRecorded += result.checkpointsAdded;
      this.stats.runsSuccess++;
      
      this.lastRunAt = Date.now();
      
      // Record new samples for training trigger
      if (result.outcomesRecorded > 0) {
        for (let i = 0; i < result.outcomesRecorded; i++) {
          autoTrainer.recordNewSample();
        }
      }
      
      this.emit('trackingComplete', {
        processed: result.processed,
        checkpoints: result.checkpointsAdded,
        outcomes: result.outcomesRecorded,
        durationMs: duration,
      });
      
      if (result.outcomesRecorded > 0) {
        logger.info('MLOutcomeTrackingJob', 
          `Tracking complete: ${result.outcomesRecorded} outcomes, ${result.checkpointsAdded} checkpoints`
        );
      }
      
    } catch (error) {
      this.stats.runsFailed++;
      logger.error('MLOutcomeTrackingJob', 'Tracking error', error as Error);
      
      this.emit('trackingFailed', { error: (error as Error).message });
      
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start tracking a token
   */
  startTracking(data: {
    mint: string;
    symbol: string;
    initialPrice: number;
    initialLiquidity: number;
    initialRiskScore: number;
    initialHolders: number;
    initialTop10Percent?: number;
    initialSentiment?: number;
    predictedOutcome?: string;
    predictedConfidence?: number;
    predictedRugProb?: number;
    predictionModelVersion?: string;
  }): void {
    outcomeTracker.startTracking(data as any);
  }

  /**
   * Get accuracy stats
   */
  getAccuracyStats(): {
    totalTested: number;
    correct: number;
    accuracy: number;
  } {
    return outcomeTracker.getAccuracyStats();
  }

  /**
   * Get job stats
   */
  getStats(): {
    isRunning: boolean;
    lastRunAt: number;
    stats: typeof this.stats;
    trackerStats: ReturnType<typeof outcomeTracker.getStats>;
  } {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      stats: { ...this.stats },
      trackerStats: outcomeTracker.getStats(),
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
    
    // Should run every 15 minutes, allow 30 minutes tolerance
    if (timeSinceLastRun > 30 * 60 * 1000 && this.lastRunAt > 0) {
      return {
        status: 'unhealthy',
        message: `No tracking in ${Math.floor(timeSinceLastRun / 60000)} minutes`,
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
      message: this.lastRunAt > 0 
        ? `Last run: ${Math.floor(timeSinceLastRun / 1000)}s ago` 
        : 'Not yet run',
    };
  }
}

// Export singleton
export const mlOutcomeTrackingJob = new MLOutcomeTrackingJob();
