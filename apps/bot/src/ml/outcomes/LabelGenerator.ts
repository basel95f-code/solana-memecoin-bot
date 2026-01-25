/**
 * Label Generator
 * Auto-generates training labels from price movements and market data
 * 
 * Label Types:
 * - Price: UP (>5%), DOWN (<-5%), SIDEWAYS
 * - Whale: DUMP, ACCUMULATION, DISTRIBUTION, HOLDING
 * - Sentiment: POSITIVE_CORRELATION, NEGATIVE_CORRELATION, NO_CORRELATION
 * - Outcome: rug, pump, moon, stable, decline
 */

import { logger } from '../../utils/logger';
import type { 
  OutcomeLabel, 
  PriceLabel, 
  WhaleLabel, 
  SentimentLabel,
  OutcomeTracking 
} from '../dataCollection/types';

// ============================================
// Label Thresholds Configuration
// ============================================

export interface LabelThresholds {
  // Price labels
  price: {
    upThreshold: number; // % change for UP label (default: 5)
    downThreshold: number; // % change for DOWN label (default: -5)
    moonThreshold: number; // % change for MOON label (default: 100)
    pumpThreshold: number; // % change for PUMP label (default: 30)
    declineThreshold: number; // % change for DECLINE label (default: -30)
    rugThreshold: number; // % change for RUG label (default: -80)
  };
  
  // Whale labels
  whale: {
    largeSellPercent: number; // % of supply for "large sell" (default: 5)
    largeBuyPercent: number; // % of supply for "large buy" (default: 3)
    accumulationThreshold: number; // Net buys for accumulation (default: 3)
    distributionThreshold: number; // Net sells for distribution (default: 3)
  };
  
  // Sentiment labels
  sentiment: {
    correlationThreshold: number; // Min correlation for positive/negative (default: 0.3)
    minSamples: number; // Min samples for correlation (default: 5)
  };
  
  // Outcome confidence
  confidence: {
    highConfidencePriceMove: number; // % price move for high confidence (default: 50)
    minCheckpoints: number; // Min checkpoints for confident label (default: 2)
  };
}

const DEFAULT_THRESHOLDS: LabelThresholds = {
  price: {
    upThreshold: 5,
    downThreshold: -5,
    moonThreshold: 100, // 2x+ = moon
    pumpThreshold: 30, // 30%+ = pump
    declineThreshold: -30, // -30%+ = decline
    rugThreshold: -80, // -80%+ = rug
  },
  whale: {
    largeSellPercent: 5,
    largeBuyPercent: 3,
    accumulationThreshold: 3,
    distributionThreshold: 3,
  },
  sentiment: {
    correlationThreshold: 0.3,
    minSamples: 5,
  },
  confidence: {
    highConfidencePriceMove: 50,
    minCheckpoints: 2,
  },
};

// ============================================
// Label Generator
// ============================================

export class LabelGenerator {
  private thresholds: LabelThresholds;

  constructor(thresholds?: Partial<LabelThresholds>) {
    this.thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...thresholds,
      price: { ...DEFAULT_THRESHOLDS.price, ...thresholds?.price },
      whale: { ...DEFAULT_THRESHOLDS.whale, ...thresholds?.whale },
      sentiment: { ...DEFAULT_THRESHOLDS.sentiment, ...thresholds?.sentiment },
      confidence: { ...DEFAULT_THRESHOLDS.confidence, ...thresholds?.confidence },
    };
  }

  /**
   * Generate price movement label
   */
  generatePriceLabel(priceChange: number): PriceLabel {
    if (priceChange > this.thresholds.price.upThreshold) {
      return 'UP';
    } else if (priceChange < this.thresholds.price.downThreshold) {
      return 'DOWN';
    } else {
      return 'SIDEWAYS';
    }
  }

  /**
   * Generate overall outcome label
   */
  generateOutcomeLabel(data: {
    priceChange24h: number;
    peakMultiplier?: number;
    troughMultiplier?: number;
    liquidityChange?: number;
    holderChange?: number;
    volume24h?: number;
  }): OutcomeLabel {
    const { priceChange24h, peakMultiplier, troughMultiplier, liquidityChange } = data;
    
    // Check for rug (severe price drop + liquidity drain)
    if (priceChange24h <= this.thresholds.price.rugThreshold) {
      return 'rug';
    }
    
    // Also rug if liquidity drained significantly
    if (liquidityChange !== undefined && liquidityChange < -90 && priceChange24h < -50) {
      return 'rug';
    }
    
    // Check for moon (>100% gain)
    if (priceChange24h >= this.thresholds.price.moonThreshold) {
      return 'moon';
    }
    
    // Check peak multiplier for moon (might have pumped and come back)
    if (peakMultiplier && peakMultiplier >= 2.0 && priceChange24h > 0) {
      return 'moon';
    }
    
    // Check for pump (>30% gain)
    if (priceChange24h >= this.thresholds.price.pumpThreshold) {
      return 'pump';
    }
    
    // Check for decline
    if (priceChange24h <= this.thresholds.price.declineThreshold) {
      return 'decline';
    }
    
    // Default to stable
    return 'stable';
  }

  /**
   * Generate whale activity label
   */
  generateWhaleLabel(data: {
    largeBuys: number; // Number of large buys
    largeSells: number; // Number of large sells
    netWhaleFlow: number; // Net whale buy-sell
    whaleHoldingChange?: number; // Change in whale holdings %
  }): WhaleLabel {
    const { largeBuys, largeSells, netWhaleFlow } = data;
    
    // Significant dump
    if (largeSells >= this.thresholds.whale.distributionThreshold && netWhaleFlow < -2) {
      return 'DUMP';
    }
    
    // Accumulation pattern
    if (largeBuys >= this.thresholds.whale.accumulationThreshold && netWhaleFlow > 2) {
      return 'ACCUMULATION';
    }
    
    // Distribution (selling gradually)
    if (largeSells >= 2 && netWhaleFlow < 0) {
      return 'DISTRIBUTION';
    }
    
    // If whales have significant holdings but no activity, they're holding
    if (largeBuys === 0 && largeSells === 0) {
      return 'HOLDING';
    }
    
    return 'NONE';
  }

  /**
   * Generate sentiment correlation label
   */
  generateSentimentLabel(data: {
    sentimentScores: number[]; // Time series of sentiment scores (-1 to 1)
    priceChanges: number[]; // Corresponding price changes
  }): SentimentLabel {
    const { sentimentScores, priceChanges } = data;
    
    if (sentimentScores.length < this.thresholds.sentiment.minSamples) {
      return 'NO_CORRELATION';
    }
    
    // Calculate Pearson correlation
    const correlation = this.calculateCorrelation(sentimentScores, priceChanges);
    
    if (correlation >= this.thresholds.sentiment.correlationThreshold) {
      return 'POSITIVE_CORRELATION';
    } else if (correlation <= -this.thresholds.sentiment.correlationThreshold) {
      return 'NEGATIVE_CORRELATION';
    } else {
      return 'NO_CORRELATION';
    }
  }

  /**
   * Generate all labels for a training sample
   */
  generateAllLabels(tracking: OutcomeTracking): {
    priceLabel1h?: PriceLabel;
    priceLabel6h?: PriceLabel;
    priceLabel24h?: PriceLabel;
    outcomeLabel: OutcomeLabel;
    whaleLabel: WhaleLabel;
    confidence: number;
  } {
    const priceLabel1h = tracking.priceChange1h !== undefined 
      ? this.generatePriceLabel(tracking.priceChange1h) 
      : undefined;
    
    const priceLabel6h = tracking.priceChange6h !== undefined 
      ? this.generatePriceLabel(tracking.priceChange6h) 
      : undefined;
    
    const priceLabel24h = tracking.priceChange24h !== undefined 
      ? this.generatePriceLabel(tracking.priceChange24h) 
      : undefined;
    
    const outcomeLabel = this.generateOutcomeLabel({
      priceChange24h: tracking.priceChange24h || 0,
      peakMultiplier: tracking.peakPrice / tracking.initialPrice,
      troughMultiplier: tracking.troughPrice / tracking.initialPrice,
      liquidityChange: tracking.finalLiquidity && tracking.initialLiquidity 
        ? ((tracking.finalLiquidity - tracking.initialLiquidity) / tracking.initialLiquidity) * 100
        : undefined,
    });
    
    const whaleLabel = tracking.whaleLabel || 'NONE';
    
    // Calculate confidence
    const confidence = this.calculateLabelConfidence(tracking, outcomeLabel);
    
    return {
      priceLabel1h,
      priceLabel6h,
      priceLabel24h,
      outcomeLabel,
      whaleLabel,
      confidence,
    };
  }

  /**
   * Calculate confidence in the generated label
   */
  calculateLabelConfidence(tracking: OutcomeTracking, label: OutcomeLabel): number {
    let confidence = 0.5;
    
    // More checkpoints = more confidence
    const checkpointCount = tracking.checkpoints.length;
    if (checkpointCount >= this.thresholds.confidence.minCheckpoints) {
      confidence += 0.1 * Math.min(3, checkpointCount);
    }
    
    // Larger price moves = more confident label
    const absChange = Math.abs(tracking.priceChange24h || 0);
    if (absChange >= this.thresholds.confidence.highConfidencePriceMove) {
      confidence += 0.2;
    } else if (absChange >= 20) {
      confidence += 0.1;
    }
    
    // Clear rug/moon cases have high confidence
    if (label === 'rug' && (tracking.priceChange24h || 0) < -80) {
      confidence += 0.2;
    }
    if (label === 'moon' && (tracking.priceChange24h || 0) > 100) {
      confidence += 0.2;
    }
    
    // Consistency between checkpoints increases confidence
    if (tracking.priceChange1h !== undefined && tracking.priceChange24h !== undefined) {
      const sameDirection = (tracking.priceChange1h > 0) === (tracking.priceChange24h > 0);
      if (sameDirection) {
        confidence += 0.1;
      }
    }
    
    return Math.min(1.0, confidence);
  }

  /**
   * Calculate Pearson correlation coefficient
   */
  private calculateCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    if (n === 0 || n !== y.length) return 0;
    
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);
    
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    
    if (denominator === 0) return 0;
    return numerator / denominator;
  }

  /**
   * Handle incomplete data
   */
  handleIncompleteData(data: Partial<OutcomeTracking>): OutcomeLabel | null {
    // If token has no volume for extended period, likely dead
    if (data.finalLiquidity !== undefined && data.finalLiquidity < 100) {
      return 'rug';
    }
    
    // If we have at least 1h of data, we can generate a label
    if (data.priceChange1h !== undefined) {
      // Strong early signals
      if (data.priceChange1h > 50) return 'pump';
      if (data.priceChange1h < -50) return 'decline';
    }
    
    // Not enough data
    return null;
  }

  /**
   * Update thresholds
   */
  updateThresholds(thresholds: Partial<LabelThresholds>): void {
    this.thresholds = {
      ...this.thresholds,
      ...thresholds,
      price: { ...this.thresholds.price, ...thresholds.price },
      whale: { ...this.thresholds.whale, ...thresholds.whale },
      sentiment: { ...this.thresholds.sentiment, ...thresholds.sentiment },
      confidence: { ...this.thresholds.confidence, ...thresholds.confidence },
    };
  }

  /**
   * Get current thresholds
   */
  getThresholds(): LabelThresholds {
    return { ...this.thresholds };
  }

  /**
   * Convert outcome label to numeric for ML
   */
  static outcomeToNumeric(label: OutcomeLabel): number {
    const mapping: Record<OutcomeLabel, number> = {
      rug: 0,
      decline: 1,
      stable: 2,
      sideways: 2,
      pump: 3,
      moon: 4,
      unknown: 2,
    };
    return mapping[label] ?? 2;
  }

  /**
   * Convert numeric back to outcome label
   */
  static numericToOutcome(value: number): OutcomeLabel {
    const mapping: OutcomeLabel[] = ['rug', 'decline', 'stable', 'pump', 'moon'];
    return mapping[Math.round(value)] || 'unknown';
  }

  /**
   * One-hot encode outcome for multi-class classification
   */
  static outcomeToOneHot(label: OutcomeLabel): number[] {
    const classes: OutcomeLabel[] = ['rug', 'decline', 'stable', 'pump', 'moon'];
    const oneHot = new Array(classes.length).fill(0);
    
    // Map sideways and unknown to stable
    const normalizedLabel = label === 'sideways' || label === 'unknown' ? 'stable' : label;
    const index = classes.indexOf(normalizedLabel);
    
    if (index >= 0) {
      oneHot[index] = 1;
    }
    
    return oneHot;
  }

  /**
   * Convert one-hot back to outcome label
   */
  static oneHotToOutcome(oneHot: number[]): OutcomeLabel {
    const classes: OutcomeLabel[] = ['rug', 'decline', 'stable', 'pump', 'moon'];
    const maxIndex = oneHot.indexOf(Math.max(...oneHot));
    return classes[maxIndex] || 'unknown';
  }
}

// Export singleton with default thresholds
export const labelGenerator = new LabelGenerator();
