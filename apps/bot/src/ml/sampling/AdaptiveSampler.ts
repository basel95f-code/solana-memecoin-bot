/**
 * Adaptive Sampler
 * Smart sampling strategy that focuses on valuable data
 * 
 * - High-value tokens (>$100k liquidity): Every 5 min
 * - Medium tokens ($10k-$100k): Every 15 min
 * - Low-value tokens (<$10k): Every 1 hour
 * - After predictions: Increase frequency
 * - Interesting events: Immediate snapshot
 */

import { logger } from '../../utils/logger';
import type { SamplingTier, SamplingConfig, TokenSamplingState } from '../dataCollection/types';

// ============================================
// Sampling Configuration
// ============================================

const SAMPLING_CONFIGS: Record<SamplingTier, SamplingConfig> = {
  high: {
    tier: 'high',
    intervalSeconds: 5 * 60, // 5 minutes
    maxSnapshotsPerToken: 1000,
    priority: 100,
  },
  medium: {
    tier: 'medium',
    intervalSeconds: 15 * 60, // 15 minutes
    maxSnapshotsPerToken: 500,
    priority: 50,
  },
  low: {
    tier: 'low',
    intervalSeconds: 60 * 60, // 1 hour
    maxSnapshotsPerToken: 200,
    priority: 25,
  },
  minimal: {
    tier: 'minimal',
    intervalSeconds: 4 * 60 * 60, // 4 hours
    maxSnapshotsPerToken: 50,
    priority: 10,
  },
};

// Liquidity thresholds for tier assignment
const LIQUIDITY_THRESHOLDS = {
  HIGH: 100_000, // $100k+
  MEDIUM: 10_000, // $10k-$100k
  LOW: 1_000, // $1k-$10k
  // Below $1k = minimal
};

// ============================================
// Dataset Balance Tracking
// ============================================

interface DatasetBalance {
  total: number;
  byOutcome: {
    rug: number;
    pump: number;
    moon: number;
    stable: number;
    decline: number;
    unknown: number;
  };
  imbalanceRatio: number;
  neededOutcomes: string[];
}

// ============================================
// Adaptive Sampler
// ============================================

export class AdaptiveSampler {
  private datasetBalance: DatasetBalance = {
    total: 0,
    byOutcome: {
      rug: 0,
      pump: 0,
      moon: 0,
      stable: 0,
      decline: 0,
      unknown: 0,
    },
    imbalanceRatio: 0,
    neededOutcomes: [],
  };

  /**
   * Determine sampling tier based on token characteristics
   */
  determineTier(
    liquidityUsd: number,
    options?: {
      hasPrediction?: boolean;
      hasInterestingEvent?: boolean;
      riskScore?: number;
      isHighPotential?: boolean;
    }
  ): SamplingTier {
    // Always high priority for tokens with predictions or interesting events
    if (options?.hasPrediction || options?.hasInterestingEvent) {
      return 'high';
    }
    
    // High potential tokens (low risk, good metrics) get upgraded
    if (options?.isHighPotential) {
      return liquidityUsd >= LIQUIDITY_THRESHOLDS.LOW ? 'high' : 'medium';
    }
    
    // Standard tier assignment by liquidity
    if (liquidityUsd >= LIQUIDITY_THRESHOLDS.HIGH) {
      return 'high';
    } else if (liquidityUsd >= LIQUIDITY_THRESHOLDS.MEDIUM) {
      return 'medium';
    } else if (liquidityUsd >= LIQUIDITY_THRESHOLDS.LOW) {
      return 'low';
    } else {
      return 'minimal';
    }
  }

  /**
   * Get sampling configuration for a tier
   */
  getSamplingConfig(tier: SamplingTier): SamplingConfig {
    return { ...SAMPLING_CONFIGS[tier] };
  }

  /**
   * Calculate dynamic interval based on current conditions
   */
  calculateDynamicInterval(
    state: TokenSamplingState,
    currentConditions: {
      priceChange1h?: number;
      volumeSpike?: boolean;
      smartMoneyActive?: boolean;
    }
  ): number {
    let baseInterval = state.currentConfig.intervalSeconds;
    
    // Reduce interval during volatile periods
    if (currentConditions.priceChange1h !== undefined) {
      const absChange = Math.abs(currentConditions.priceChange1h);
      if (absChange > 50) {
        baseInterval = Math.floor(baseInterval * 0.25); // 4x more frequent
      } else if (absChange > 20) {
        baseInterval = Math.floor(baseInterval * 0.5); // 2x more frequent
      }
    }
    
    // Reduce interval on volume spike
    if (currentConditions.volumeSpike) {
      baseInterval = Math.floor(baseInterval * 0.5);
    }
    
    // Reduce interval when smart money is active
    if (currentConditions.smartMoneyActive) {
      baseInterval = Math.floor(baseInterval * 0.5);
    }
    
    // Ensure minimum interval (1 minute)
    return Math.max(60, baseInterval);
  }

  /**
   * Determine if a token should be sampled NOW (for event-based sampling)
   */
  shouldSampleImmediately(
    state: TokenSamplingState,
    event: {
      type: 'price_spike' | 'volume_spike' | 'whale_activity' | 'pump_detected' | 'dump_detected' | 'smart_money_entry';
      magnitude?: number;
    }
  ): boolean {
    const now = Date.now();
    const timeSinceLastSnapshot = now - (state.lastSnapshotAt || 0);
    
    // Minimum cooldown of 30 seconds for any event
    if (timeSinceLastSnapshot < 30_000) {
      return false;
    }
    
    // Always sample immediately for these events
    const immediateEvents = ['pump_detected', 'dump_detected', 'smart_money_entry'];
    if (immediateEvents.includes(event.type)) {
      return true;
    }
    
    // For price/volume spikes, check magnitude
    if (event.magnitude !== undefined) {
      // Sample if spike is significant (>20% change)
      return event.magnitude > 20;
    }
    
    return false;
  }

  /**
   * Update dataset balance tracking
   */
  updateDatasetBalance(counts: Record<string, number>): void {
    this.datasetBalance.total = Object.values(counts).reduce((a, b) => a + b, 0);
    
    // Update outcome counts
    for (const outcome of Object.keys(this.datasetBalance.byOutcome)) {
      (this.datasetBalance.byOutcome as any)[outcome] = counts[outcome] || 0;
    }
    
    // Calculate imbalance ratio
    const countValues = Object.values(this.datasetBalance.byOutcome);
    const maxCount = Math.max(...countValues);
    const minCount = Math.min(...countValues.filter(v => v > 0));
    
    this.datasetBalance.imbalanceRatio = minCount > 0 ? maxCount / minCount : 0;
    
    // Identify needed outcomes (less than 1/4 of max)
    const threshold = maxCount / 4;
    this.datasetBalance.neededOutcomes = Object.entries(this.datasetBalance.byOutcome)
      .filter(([_, count]) => count < threshold)
      .map(([outcome]) => outcome);
  }

  /**
   * Get priority boost for tokens likely to produce needed outcomes
   */
  getBalancePriorityBoost(predictedOutcome?: string): number {
    if (!predictedOutcome) return 1;
    
    if (this.datasetBalance.neededOutcomes.includes(predictedOutcome)) {
      // Higher priority for tokens that might fill gaps in our dataset
      return 2.0;
    }
    
    return 1.0;
  }

  /**
   * Calculate optimal number of tokens to track
   */
  calculateOptimalTrackingCapacity(
    availableResourcesPercent: number = 100,
    averageApiCallsPerSnapshot: number = 3
  ): {
    high: number;
    medium: number;
    low: number;
    minimal: number;
  } {
    // Base capacity assuming 100% resources
    const baseCapacity = {
      high: 50, // 50 high-priority tokens
      medium: 200, // 200 medium tokens
      low: 500, // 500 low tokens
      minimal: 2000, // 2000 minimal tokens
    };
    
    // Scale by available resources
    const scale = availableResourcesPercent / 100;
    
    return {
      high: Math.floor(baseCapacity.high * scale),
      medium: Math.floor(baseCapacity.medium * scale),
      low: Math.floor(baseCapacity.low * scale),
      minimal: Math.floor(baseCapacity.minimal * scale),
    };
  }

  /**
   * Prioritize tokens for next sampling batch
   */
  prioritizeTokens(tokens: TokenSamplingState[], batchSize: number): TokenSamplingState[] {
    const now = Date.now();
    
    // Score each token
    const scored = tokens.map(token => {
      let score = token.currentConfig.priority;
      
      // Boost for tokens with predictions
      if (token.hasPrediction) {
        score += 50;
      }
      
      // Boost for tokens with interesting events
      if (token.hasInterestingEvent) {
        const timeSinceEvent = now - (token.lastEventAt || 0);
        // Decay boost over time (full boost for first hour)
        const eventBoost = Math.max(0, 50 * (1 - timeSinceEvent / (60 * 60 * 1000)));
        score += eventBoost;
      }
      
      // Boost for overdue snapshots
      const timeSinceSnapshot = now - (token.lastSnapshotAt || 0);
      const overdueRatio = timeSinceSnapshot / (token.currentConfig.intervalSeconds * 1000);
      if (overdueRatio > 1) {
        score += Math.min(30, (overdueRatio - 1) * 10);
      }
      
      // Boost for dataset balance
      score *= this.getBalancePriorityBoost();
      
      return { token, score };
    });
    
    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    
    // Return top N
    return scored.slice(0, batchSize).map(s => s.token);
  }

  /**
   * Get sampling statistics
   */
  getStats(): {
    datasetBalance: DatasetBalance;
    samplingConfigs: Record<SamplingTier, SamplingConfig>;
    liquidityThresholds: typeof LIQUIDITY_THRESHOLDS;
  } {
    return {
      datasetBalance: { ...this.datasetBalance },
      samplingConfigs: { ...SAMPLING_CONFIGS },
      liquidityThresholds: { ...LIQUIDITY_THRESHOLDS },
    };
  }
}

// Export singleton
export const adaptiveSampler = new AdaptiveSampler();
