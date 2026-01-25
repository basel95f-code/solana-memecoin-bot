/**
 * Multi-Timeframe Token Analyzer
 * Captures token snapshots across multiple timeframes to detect trends and anomalies
 */

import { dexScreenerService } from '../services/dexscreener';
import { solanaService } from '../services/solana';
import type { TokenInfo } from '../types';
import { logger } from '../utils/logger';

export interface TimeframeSnapshot {
  timestamp: number;
  price: number;
  priceUsd?: number;
  liquidity: number;
  volume24h: number;
  holders: number;
  top10Percent: number;
  fdv: number;
  marketCap: number;
}

export interface MultiTimeframeAnalysis {
  tokenMint: string;
  tokenSymbol?: string;
  
  current: TimeframeSnapshot;
  fiveMin?: TimeframeSnapshot;
  oneHour?: TimeframeSnapshot;
  twentyFourHour?: TimeframeSnapshot;
  
  changes: {
    fiveMin: TimeframeChanges;
    oneHour: TimeframeChanges;
    twentyFourHour: TimeframeChanges;
  };
  
  trends: {
    priceDirection: 'up' | 'down' | 'sideways';
    momentumStrength: number; // 0-100
    liquidityTrend: 'increasing' | 'decreasing' | 'stable';
    holderGrowth: 'growing' | 'shrinking' | 'stable';
  };
  
  anomalies: Anomaly[];
  quality: number; // 0-100 based on data availability
  analyzedAt: number;
}

export interface TimeframeChanges {
  priceChange: number; // percentage
  liquidityChange: number; // percentage
  volumeChange: number; // percentage
  holderChange: number; // absolute
  top10Change: number; // percentage points
}

export interface Anomaly {
  type: 'price_spike' | 'liquidity_drain' | 'holder_dump' | 'volume_spike' | 'concentration_increase';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  value: number;
  threshold: number;
  detectedAt: number;
}

// In-memory storage for historical snapshots
const snapshotHistory: Map<string, TimeframeSnapshot[]> = new Map();
const MAX_SNAPSHOTS_PER_TOKEN = 288; // 24 hours at 5min intervals

export class MultiTimeframeAnalyzer {
  /**
   * Capture current snapshot for a token
   */
  async captureSnapshot(tokenMint: string, tokenInfo?: TokenInfo): Promise<TimeframeSnapshot | null> {
    try {
      // Get fresh data from DexScreener
      const dexData = await dexScreenerService.getTokenData(tokenMint);
      
      if (!dexData) {
        logger.debug('MultiTimeframe', `No DexScreener data for ${tokenMint.slice(0, 8)}...`);
        return null;
      }

      // Get holder data if token info provided
      let holders = 0;
      let top10Percent = 0;
      
      if (tokenInfo) {
        try {
          const holderAnalysis = await solanaService.getTokenHolders(tokenMint, 10);
          holders = holderAnalysis.length;
          
          // Calculate top 10 percentage
          if (holderAnalysis.length > 0 && tokenInfo.supply > 0) {
            const top10Total = holderAnalysis.slice(0, 10).reduce((sum, h) => sum + h.balance, 0);
            top10Percent = (top10Total / tokenInfo.supply) * 100;
          }
        } catch (error) {
          logger.silentError('MultiTimeframe', 'Failed to get holder data', error as Error);
        }
      }

      const snapshot: TimeframeSnapshot = {
        timestamp: Date.now(),
        price: dexData.priceNative || 0,
        priceUsd: dexData.priceUsd,
        liquidity: dexData.liquidity?.usd || 0,
        volume24h: dexData.volume?.h24 || 0,
        holders,
        top10Percent,
        fdv: dexData.fdv || 0,
        marketCap: dexData.marketCap || 0,
      };

      // Store in history
      this.addToHistory(tokenMint, snapshot);

      return snapshot;
    } catch (error) {
      logger.error('MultiTimeframe', `Failed to capture snapshot for ${tokenMint}`, error as Error);
      return null;
    }
  }

  /**
   * Analyze token across multiple timeframes
   */
  async analyze(tokenMint: string, tokenSymbol?: string, tokenInfo?: TokenInfo): Promise<MultiTimeframeAnalysis | null> {
    try {
      // Get current snapshot
      const current = await this.captureSnapshot(tokenMint, tokenInfo);
      
      if (!current) {
        return null;
      }

      // Get historical snapshots
      const history = snapshotHistory.get(tokenMint) || [];
      
      // Find snapshots at specific timeframes (5min, 1h, 24h ago)
      const now = Date.now();
      const fiveMinAgo = now - (5 * 60 * 1000);
      const oneHourAgo = now - (60 * 60 * 1000);
      const twentyFourHourAgo = now - (24 * 60 * 60 * 1000);

      const fiveMin = this.findClosestSnapshot(history, fiveMinAgo);
      const oneHour = this.findClosestSnapshot(history, oneHourAgo);
      const twentyFourHour = this.findClosestSnapshot(history, twentyFourHourAgo);

      // Calculate changes
      const changes = {
        fiveMin: fiveMin ? this.calculateChanges(fiveMin, current) : this.getZeroChanges(),
        oneHour: oneHour ? this.calculateChanges(oneHour, current) : this.getZeroChanges(),
        twentyFourHour: twentyFourHour ? this.calculateChanges(twentyFourHour, current) : this.getZeroChanges(),
      };

      // Detect trends
      const trends = this.detectTrends(history, current);

      // Detect anomalies
      const anomalies = this.detectAnomalies(history, current, changes);

      // Calculate quality score based on data availability
      let quality = 50; // Base score
      if (fiveMin) quality += 10;
      if (oneHour) quality += 20;
      if (twentyFourHour) quality += 20;
      quality = Math.min(100, quality);

      const analysis: MultiTimeframeAnalysis = {
        tokenMint,
        tokenSymbol,
        current,
        fiveMin,
        oneHour,
        twentyFourHour,
        changes,
        trends,
        anomalies,
        quality,
        analyzedAt: now,
      };

      return analysis;
    } catch (error) {
      logger.error('MultiTimeframe', `Analysis failed for ${tokenMint}`, error as Error);
      return null;
    }
  }

  /**
   * Add snapshot to history
   */
  private addToHistory(tokenMint: string, snapshot: TimeframeSnapshot): void {
    if (!snapshotHistory.has(tokenMint)) {
      snapshotHistory.set(tokenMint, []);
    }

    const history = snapshotHistory.get(tokenMint)!;
    history.push(snapshot);

    // Keep only latest snapshots
    if (history.length > MAX_SNAPSHOTS_PER_TOKEN) {
      history.shift();
    }
  }

  /**
   * Find closest snapshot to a target timestamp
   */
  private findClosestSnapshot(history: TimeframeSnapshot[], targetTime: number): TimeframeSnapshot | null {
    if (history.length === 0) return null;

    let closest = history[0];
    let minDiff = Math.abs(history[0].timestamp - targetTime);

    for (const snapshot of history) {
      const diff = Math.abs(snapshot.timestamp - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = snapshot;
      }
    }

    // Only return if within reasonable time window (30% of target timeframe)
    const maxDiff = Math.abs(Date.now() - targetTime) * 0.3;
    if (minDiff > maxDiff) {
      return null;
    }

    return closest;
  }

  /**
   * Calculate changes between two snapshots
   */
  private calculateChanges(old: TimeframeSnapshot, current: TimeframeSnapshot): TimeframeChanges {
    return {
      priceChange: old.price > 0 ? ((current.price - old.price) / old.price) * 100 : 0,
      liquidityChange: old.liquidity > 0 ? ((current.liquidity - old.liquidity) / old.liquidity) * 100 : 0,
      volumeChange: old.volume24h > 0 ? ((current.volume24h - old.volume24h) / old.volume24h) * 100 : 0,
      holderChange: current.holders - old.holders,
      top10Change: current.top10Percent - old.top10Percent,
    };
  }

  /**
   * Get zero changes (when no historical data available)
   */
  private getZeroChanges(): TimeframeChanges {
    return {
      priceChange: 0,
      liquidityChange: 0,
      volumeChange: 0,
      holderChange: 0,
      top10Change: 0,
    };
  }

  /**
   * Detect price/liquidity/holder trends
   */
  private detectTrends(history: TimeframeSnapshot[], current: TimeframeSnapshot): MultiTimeframeAnalysis['trends'] {
    // Need at least 3 snapshots for trend detection
    if (history.length < 3) {
      return {
        priceDirection: 'sideways',
        momentumStrength: 0,
        liquidityTrend: 'stable',
        holderGrowth: 'stable',
      };
    }

    // Get recent snapshots (last 6 = 30 minutes at 5min intervals)
    const recent = history.slice(-6);

    // Price direction
    const priceChanges = recent.map((s, i) => {
      if (i === 0) return 0;
      return s.price - recent[i - 1].price;
    }).filter(c => c !== 0);

    const upMoves = priceChanges.filter(c => c > 0).length;
    const downMoves = priceChanges.filter(c => c < 0).length;

    let priceDirection: 'up' | 'down' | 'sideways';
    if (upMoves > downMoves * 1.5) priceDirection = 'up';
    else if (downMoves > upMoves * 1.5) priceDirection = 'down';
    else priceDirection = 'sideways';

    // Momentum strength (based on price velocity)
    const priceVelocity = Math.abs(current.price - recent[0].price) / recent[0].price * 100;
    const momentumStrength = Math.min(100, priceVelocity * 10);

    // Liquidity trend
    const liquidityChange = ((current.liquidity - recent[0].liquidity) / recent[0].liquidity) * 100;
    let liquidityTrend: 'increasing' | 'decreasing' | 'stable';
    if (liquidityChange > 10) liquidityTrend = 'increasing';
    else if (liquidityChange < -10) liquidityTrend = 'decreasing';
    else liquidityTrend = 'stable';

    // Holder growth
    const holderChange = current.holders - recent[0].holders;
    let holderGrowth: 'growing' | 'shrinking' | 'stable';
    if (holderChange > 5) holderGrowth = 'growing';
    else if (holderChange < -5) holderGrowth = 'shrinking';
    else holderGrowth = 'stable';

    return {
      priceDirection,
      momentumStrength,
      liquidityTrend,
      holderGrowth,
    };
  }

  /**
   * Detect anomalies (sudden changes, unusual patterns)
   */
  private detectAnomalies(history: TimeframeSnapshot[], current: TimeframeSnapshot, changes: MultiTimeframeAnalysis['changes']): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const now = Date.now();

    // Price spike detection (>50% in 5min)
    if (Math.abs(changes.fiveMin.priceChange) > 50) {
      anomalies.push({
        type: 'price_spike',
        severity: Math.abs(changes.fiveMin.priceChange) > 100 ? 'critical' : 'high',
        description: `Price ${changes.fiveMin.priceChange > 0 ? 'surged' : 'crashed'} ${Math.abs(changes.fiveMin.priceChange).toFixed(1)}% in 5 minutes`,
        value: changes.fiveMin.priceChange,
        threshold: 50,
        detectedAt: now,
      });
    }

    // Liquidity drain detection (>30% decrease in 1h)
    if (changes.oneHour.liquidityChange < -30) {
      anomalies.push({
        type: 'liquidity_drain',
        severity: changes.oneHour.liquidityChange < -50 ? 'critical' : 'high',
        description: `Liquidity dropped ${Math.abs(changes.oneHour.liquidityChange).toFixed(1)}% in 1 hour - possible rug`,
        value: changes.oneHour.liquidityChange,
        threshold: -30,
        detectedAt: now,
      });
    }

    // Concentration increase (top 10 holders increased >10% points)
    if (changes.oneHour.top10Change > 10) {
      anomalies.push({
        type: 'concentration_increase',
        severity: changes.oneHour.top10Change > 20 ? 'high' : 'medium',
        description: `Top 10 holders increased by ${changes.oneHour.top10Change.toFixed(1)} percentage points`,
        value: changes.oneHour.top10Change,
        threshold: 10,
        detectedAt: now,
      });
    }

    // Volume spike (>500% increase in 1h)
    if (changes.oneHour.volumeChange > 500) {
      anomalies.push({
        type: 'volume_spike',
        severity: 'medium',
        description: `Volume increased ${changes.oneHour.volumeChange.toFixed(0)}% - unusual activity`,
        value: changes.oneHour.volumeChange,
        threshold: 500,
        detectedAt: now,
      });
    }

    return anomalies;
  }

  /**
   * Get snapshot history for a token
   */
  getHistory(tokenMint: string): TimeframeSnapshot[] {
    return snapshotHistory.get(tokenMint) || [];
  }

  /**
   * Clear old snapshots (cleanup)
   */
  cleanup(): void {
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();

    for (const [tokenMint, history] of snapshotHistory.entries()) {
      const filtered = history.filter(s => now - s.timestamp < maxAge);
      
      if (filtered.length === 0) {
        snapshotHistory.delete(tokenMint);
      } else {
        snapshotHistory.set(tokenMint, filtered);
      }
    }

    logger.debug('MultiTimeframe', 'Cleaned up old snapshots');
  }
}

// Singleton instance
export const multiTimeframeAnalyzer = new MultiTimeframeAnalyzer();
