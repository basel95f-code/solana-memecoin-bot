/**
 * Whale Activity Tracker
 * Monitors whale accumulation/distribution patterns and coordinated movements
 */

import { EventEmitter } from 'events';
import { smartMoneyTracker } from './smartMoneyTracker';
import type { WalletTrade } from './smartMoneyTracker';
import { dexScreenerService } from './dexscreener';
import { logger } from '../utils/logger';

export interface WhaleActivityEvent {
  walletAddress: string;
  walletLabel?: string;
  tokenMint: string;
  tokenSymbol?: string;
  timestamp: number;
  action: 'buy' | 'sell';
  amount: number;
  solValue: number;
  priceUsd?: number;
  estimatedPosition: number; // Running total
}

export interface WhaleTimeline {
  walletAddress: string;
  walletLabel?: string;
  tokenMint: string;
  tokenSymbol?: string;
  events: WhaleActivityEvent[];
  currentPosition: number; // Estimated current holdings
  totalBought: number;
  totalSold: number;
  buyPressure: number; // 0-100 (100 = only buying, 0 = only selling)
  isAccumulating: boolean;
  isDistributing: boolean;
  accumulationScore: number; // 0-100 (higher = stronger accumulation)
  distributionScore: number; // 0-100 (higher = stronger distribution)
  lastActivity: number;
  activityPattern: 'buying_spree' | 'selling_spree' | 'balanced' | 'inactive';
}

export interface CoordinatedMovement {
  tokenMint: string;
  tokenSymbol?: string;
  wallets: string[];
  action: 'buy' | 'sell';
  timeWindow: number; // milliseconds
  avgAmount: number;
  totalValue: number;
  isSuspicious: boolean;
  suspicionScore: number; // 0-100
  timestamp: number;
}

export interface AccumulationAlert {
  walletAddress: string;
  walletLabel?: string;
  tokenMint: string;
  tokenSymbol?: string;
  buyCount: number;
  totalSolValue: number;
  timeWindow: number; // hours
  avgBuySize: number;
  estimatedPosition: number;
  priceChange: number; // % price change during accumulation
  timestamp: number;
}

export interface DistributionAlert {
  walletAddress: string;
  walletLabel?: string;
  tokenMint: string;
  tokenSymbol?: string;
  sellCount: number;
  totalSolValue: number;
  timeWindow: number; // hours
  avgSellSize: number;
  remainingPosition: number;
  percentSold: number;
  timestamp: number;
}

export class WhaleActivityTracker extends EventEmitter {
  private timelines: Map<string, Map<string, WhaleTimeline>> = new Map(); // walletAddress -> tokenMint -> timeline
  private recentActivity: WhaleActivityEvent[] = []; // Last 1000 events
  private readonly MAX_EVENTS = 1000;
  private readonly ACCUMULATION_WINDOW = 24 * 60 * 60 * 1000; // 24 hours
  private readonly DISTRIBUTION_WINDOW = 12 * 60 * 60 * 1000; // 12 hours
  private readonly COORDINATED_WINDOW = 5 * 60 * 1000; // 5 minutes
  private readonly MIN_BUYS_FOR_ACCUMULATION = 3;
  private readonly MIN_SELLS_FOR_DISTRIBUTION = 2;

  constructor() {
    super();
  }

  /**
   * Record whale activity (buy or sell)
   */
  recordActivity(
    walletAddress: string,
    walletLabel: string | undefined,
    tokenMint: string,
    tokenSymbol: string | undefined,
    action: 'buy' | 'sell',
    amount: number,
    solValue: number,
    priceUsd?: number
  ): void {
    // Get or create timeline for this wallet + token
    if (!this.timelines.has(walletAddress)) {
      this.timelines.set(walletAddress, new Map());
    }

    const walletTimelines = this.timelines.get(walletAddress)!;
    let timeline = walletTimelines.get(tokenMint);

    if (!timeline) {
      timeline = {
        walletAddress,
        walletLabel,
        tokenMint,
        tokenSymbol,
        events: [],
        currentPosition: 0,
        totalBought: 0,
        totalSold: 0,
        buyPressure: 50,
        isAccumulating: false,
        isDistributing: false,
        accumulationScore: 0,
        distributionScore: 0,
        lastActivity: Date.now(),
        activityPattern: 'inactive',
      };
      walletTimelines.set(tokenMint, timeline);
    }

    // Create event
    const event: WhaleActivityEvent = {
      walletAddress,
      walletLabel,
      tokenMint,
      tokenSymbol,
      timestamp: Date.now(),
      action,
      amount,
      solValue,
      priceUsd,
      estimatedPosition: timeline.currentPosition,
    };

    // Update position estimate
    if (action === 'buy') {
      timeline.currentPosition += amount;
      timeline.totalBought += solValue;
    } else {
      timeline.currentPosition -= amount;
      timeline.totalSold += solValue;
    }

    event.estimatedPosition = timeline.currentPosition;

    // Add event to timeline
    timeline.events.push(event);
    this.recentActivity.push(event);

    // Trim recent activity
    if (this.recentActivity.length > this.MAX_EVENTS) {
      this.recentActivity.shift();
    }

    // Update metrics
    timeline.lastActivity = Date.now();
    this.updateTimelineMetrics(timeline);

    // Check for accumulation/distribution patterns
    this.checkForAccumulation(timeline);
    this.checkForDistribution(timeline);

    // Check for coordinated movements
    this.checkCoordinatedMovements(tokenMint, action);

    logger.debug('WhaleActivity', `Recorded ${action} for ${walletLabel || walletAddress.slice(0, 8)}... - ${tokenSymbol || tokenMint.slice(0, 8)}`);
  }

  /**
   * Update timeline metrics (buy pressure, activity pattern)
   */
  private updateTimelineMetrics(timeline: WhaleTimeline): void {
    const totalValue = timeline.totalBought + timeline.totalSold;
    if (totalValue > 0) {
      timeline.buyPressure = (timeline.totalBought / totalValue) * 100;
    }

    // Determine activity pattern based on recent events
    const now = Date.now();
    const recentEvents = timeline.events.filter(e => now - e.timestamp < this.ACCUMULATION_WINDOW);

    if (recentEvents.length === 0) {
      timeline.activityPattern = 'inactive';
      return;
    }

    const buyCount = recentEvents.filter(e => e.action === 'buy').length;
    const sellCount = recentEvents.filter(e => e.action === 'sell').length;

    if (buyCount >= 3 && sellCount === 0) {
      timeline.activityPattern = 'buying_spree';
    } else if (sellCount >= 2 && buyCount === 0) {
      timeline.activityPattern = 'selling_spree';
    } else if (buyCount > 0 && sellCount > 0) {
      timeline.activityPattern = 'balanced';
    } else {
      timeline.activityPattern = 'inactive';
    }
  }

  /**
   * Check for accumulation pattern (multiple buys in short time)
   */
  private checkForAccumulation(timeline: WhaleTimeline): void {
    const now = Date.now();
    const windowStart = now - this.ACCUMULATION_WINDOW;

    // Get recent buys
    const recentBuys = timeline.events.filter(
      e => e.action === 'buy' && e.timestamp >= windowStart
    );

    if (recentBuys.length >= this.MIN_BUYS_FOR_ACCUMULATION) {
      const totalSol = recentBuys.reduce((sum, e) => sum + e.solValue, 0);
      const avgBuySize = totalSol / recentBuys.length;
      const timeSpan = now - recentBuys[0].timestamp;

      // Calculate accumulation score (0-100)
      let score = 0;
      score += Math.min(30, recentBuys.length * 5); // More buys = higher score
      score += Math.min(30, (totalSol / 10) * 10); // Larger total = higher score
      score += Math.min(20, (24 * 60 * 60 * 1000 - timeSpan) / (24 * 60 * 60 * 1000) * 20); // Faster = higher score
      
      // Consistent buy sizes boost score
      const buyVariance = this.calculateVariance(recentBuys.map(e => e.solValue));
      if (buyVariance < 0.2) score += 20; // Consistent sizes (DCA pattern)

      timeline.accumulationScore = Math.min(100, score);
      timeline.isAccumulating = timeline.accumulationScore >= 50;

      if (timeline.isAccumulating && recentBuys.length === this.MIN_BUYS_FOR_ACCUMULATION) {
        // First time hitting accumulation threshold - emit alert
        this.emitAccumulationAlert({
          walletAddress: timeline.walletAddress,
          walletLabel: timeline.walletLabel,
          tokenMint: timeline.tokenMint,
          tokenSymbol: timeline.tokenSymbol,
          buyCount: recentBuys.length,
          totalSolValue: totalSol,
          timeWindow: timeSpan / (60 * 60 * 1000),
          avgBuySize,
          estimatedPosition: timeline.currentPosition,
          priceChange: 0, // TODO: Calculate from DexScreener
          timestamp: now,
        });
      }
    } else {
      timeline.isAccumulating = false;
      timeline.accumulationScore = 0;
    }
  }

  /**
   * Check for distribution pattern (multiple sells in short time)
   */
  private checkForDistribution(timeline: WhaleTimeline): void {
    const now = Date.now();
    const windowStart = now - this.DISTRIBUTION_WINDOW;

    // Get recent sells
    const recentSells = timeline.events.filter(
      e => e.action === 'sell' && e.timestamp >= windowStart
    );

    if (recentSells.length >= this.MIN_SELLS_FOR_DISTRIBUTION) {
      const totalSol = recentSells.reduce((sum, e) => sum + e.solValue, 0);
      const avgSellSize = totalSol / recentSells.length;
      const timeSpan = now - recentSells[0].timestamp;

      // Calculate how much was sold vs total bought
      const percentSold = timeline.totalBought > 0 
        ? (timeline.totalSold / timeline.totalBought) * 100 
        : 0;

      // Calculate distribution score (0-100)
      let score = 0;
      score += Math.min(30, recentSells.length * 10); // More sells = higher score
      score += Math.min(30, percentSold / 3); // Higher % sold = higher score
      score += Math.min(20, (12 * 60 * 60 * 1000 - timeSpan) / (12 * 60 * 60 * 1000) * 20); // Faster = higher score
      
      // Dumping pattern (large sells)
      const avgSellPercent = (totalSol / timeline.totalBought) * 100;
      if (avgSellPercent > 30) score += 20; // Dumping large portions

      timeline.distributionScore = Math.min(100, score);
      timeline.isDistributing = timeline.distributionScore >= 50;

      if (timeline.isDistributing && recentSells.length === this.MIN_SELLS_FOR_DISTRIBUTION) {
        // First time hitting distribution threshold - emit alert
        this.emitDistributionAlert({
          walletAddress: timeline.walletAddress,
          walletLabel: timeline.walletLabel,
          tokenMint: timeline.tokenMint,
          tokenSymbol: timeline.tokenSymbol,
          sellCount: recentSells.length,
          totalSolValue: totalSol,
          timeWindow: timeSpan / (60 * 60 * 1000),
          avgSellSize,
          remainingPosition: timeline.currentPosition,
          percentSold,
          timestamp: now,
        });
      }
    } else {
      timeline.isDistributing = false;
      timeline.distributionScore = 0;
    }
  }

  /**
   * Check for coordinated movements (multiple wallets buying/selling same token)
   */
  private checkCoordinatedMovements(tokenMint: string, action: 'buy' | 'sell'): void {
    const now = Date.now();
    const windowStart = now - this.COORDINATED_WINDOW;

    // Get recent activity for this token
    const recentActivity = this.recentActivity.filter(
      e => e.tokenMint === tokenMint && 
           e.action === action && 
           e.timestamp >= windowStart
    );

    // Need at least 3 wallets for coordination
    const uniqueWallets = new Set(recentActivity.map(e => e.walletAddress));
    
    if (uniqueWallets.size >= 3) {
      const totalValue = recentActivity.reduce((sum, e) => sum + e.solValue, 0);
      const avgAmount = totalValue / recentActivity.length;

      // Calculate suspicion score
      let suspicionScore = 0;
      
      // More wallets = more suspicious
      suspicionScore += Math.min(30, uniqueWallets.size * 5);
      
      // Within narrow time window = suspicious
      const timeSpan = now - recentActivity[0].timestamp;
      if (timeSpan < 60 * 1000) suspicionScore += 30; // Within 1 minute
      else if (timeSpan < 3 * 60 * 1000) suspicionScore += 20; // Within 3 minutes
      
      // Similar amounts = suspicious
      const amounts = recentActivity.map(e => e.solValue);
      const variance = this.calculateVariance(amounts);
      if (variance < 0.1) suspicionScore += 40; // Very similar amounts
      else if (variance < 0.3) suspicionScore += 20; // Somewhat similar

      const movement: CoordinatedMovement = {
        tokenMint,
        tokenSymbol: recentActivity[0].tokenSymbol,
        wallets: Array.from(uniqueWallets),
        action,
        timeWindow: timeSpan,
        avgAmount,
        totalValue,
        isSuspicious: suspicionScore >= 60,
        suspicionScore,
        timestamp: now,
      };

      if (movement.isSuspicious) {
        this.emit('coordinatedMovement', movement);
        logger.info('WhaleActivity', `Coordinated ${action} detected: ${uniqueWallets.size} wallets, suspicion=${suspicionScore}`);
      }
    }
  }

  /**
   * Get timeline for a specific wallet and token
   */
  getTimeline(walletAddress: string, tokenMint: string): WhaleTimeline | null {
    const walletTimelines = this.timelines.get(walletAddress);
    if (!walletTimelines) return null;
    return walletTimelines.get(tokenMint) || null;
  }

  /**
   * Get all timelines for a wallet (all tokens)
   */
  getWalletTimelines(walletAddress: string): WhaleTimeline[] {
    const walletTimelines = this.timelines.get(walletAddress);
    if (!walletTimelines) return [];
    return Array.from(walletTimelines.values());
  }

  /**
   * Get all whale activity for a specific token (all wallets)
   */
  getTokenActivity(tokenMint: string): WhaleTimeline[] {
    const result: WhaleTimeline[] = [];
    
    for (const walletTimelines of this.timelines.values()) {
      const timeline = walletTimelines.get(tokenMint);
      if (timeline) {
        result.push(timeline);
      }
    }

    return result;
  }

  /**
   * Get active accumulation patterns across all wallets
   */
  getActiveAccumulations(): WhaleTimeline[] {
    const result: WhaleTimeline[] = [];
    
    for (const walletTimelines of this.timelines.values()) {
      for (const timeline of walletTimelines.values()) {
        if (timeline.isAccumulating) {
          result.push(timeline);
        }
      }
    }

    // Sort by accumulation score
    result.sort((a, b) => b.accumulationScore - a.accumulationScore);
    
    return result;
  }

  /**
   * Get active distribution patterns across all wallets
   */
  getActiveDistributions(): WhaleTimeline[] {
    const result: WhaleTimeline[] = [];
    
    for (const walletTimelines of this.timelines.values()) {
      for (const timeline of walletTimelines.values()) {
        if (timeline.isDistributing) {
          result.push(timeline);
        }
      }
    }

    // Sort by distribution score
    result.sort((a, b) => b.distributionScore - a.distributionScore);
    
    return result;
  }

  /**
   * Calculate variance of an array of numbers (for detecting similar amounts)
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    // Return coefficient of variation (std dev / mean)
    return mean > 0 ? stdDev / mean : 0;
  }

  /**
   * Emit accumulation alert
   */
  private emitAccumulationAlert(alert: AccumulationAlert): void {
    this.emit('accumulation', alert);
    logger.info('WhaleActivity', `🟢 ACCUMULATION: ${alert.walletLabel || alert.walletAddress.slice(0, 8)}... buying ${alert.tokenSymbol || alert.tokenMint.slice(0, 8)}`);
  }

  /**
   * Emit distribution alert
   */
  private emitDistributionAlert(alert: DistributionAlert): void {
    this.emit('distribution', alert);
    logger.info('WhaleActivity', `🔴 DISTRIBUTION: ${alert.walletLabel || alert.walletAddress.slice(0, 8)}... selling ${alert.tokenSymbol || alert.tokenMint.slice(0, 8)}`);
  }

  /**
   * Clear old timelines to prevent memory bloat
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

    for (const [walletAddress, walletTimelines] of this.timelines.entries()) {
      for (const [tokenMint, timeline] of walletTimelines.entries()) {
        if (now - timeline.lastActivity > maxAge) {
          walletTimelines.delete(tokenMint);
        }
      }

      // Remove wallet if no timelines left
      if (walletTimelines.size === 0) {
        this.timelines.delete(walletAddress);
      }
    }

    logger.debug('WhaleActivity', 'Cleaned up old timelines');
  }
}

// Singleton instance
export const whaleActivityTracker = new WhaleActivityTracker();
