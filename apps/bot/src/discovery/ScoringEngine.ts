/**
 * Scoring Engine
 * Tracks source credibility based on historical performance
 * Sources that find "mooners" get higher scores, sources that find "rugs" get lower scores
 */

import { logger } from '../utils/logger';
import type { SourceScore, SourceMetrics, TokenScore, DiscoveryRecord } from './interfaces/DiscoveryTypes';

interface TokenOutcome {
  mint: string;
  sourceId: string;
  discoveryLatency: number; // ms from creation to discovery
  maxMultiplier: number; // best price increase
  wasRug: boolean;
  tradingVolume: number;
}

export class ScoringEngine {
  private sourceMetrics: Map<string, SourceMetrics> = new Map();
  private tokenOutcomes: Map<string, TokenOutcome> = new Map();

  // Scoring weights
  private readonly WEIGHT_SUCCESS_RATE = 0.4;
  private readonly WEIGHT_AVG_GAIN = 0.3;
  private readonly WEIGHT_LATENCY = 0.2;
  private readonly WEIGHT_RECENT = 0.1;

  /**
   * Initialize source metrics
   */
  initializeSource(sourceId: string, baseWeight: number = 1.0): void {
    if (this.sourceMetrics.has(sourceId)) return;

    this.sourceMetrics.set(sourceId, {
      totalTokensFound: 0,
      successfulTokensFound: 0,
      rugCount: 0,
      averageLatencyMs: 0,
      averageGain: 0,
      credibilityScore: baseWeight,
      lastSeen: Date.now(),
    });

    logger.info('ScoringEngine', `Initialized metrics for source: ${sourceId}`);
  }

  /**
   * Record a token discovery
   */
  recordDiscovery(sourceId: string): void {
    const metrics = this.sourceMetrics.get(sourceId);
    if (!metrics) return;

    metrics.totalTokensFound++;
    metrics.lastSeen = Date.now();
  }

  /**
   * Record token outcome (after some time has passed)
   */
  recordOutcome(
    mint: string,
    sourceId: string,
    outcome: {
      discoveryLatency: number;
      maxMultiplier: number;
      wasRug: boolean;
      tradingVolume: number;
    }
  ): void {
    this.tokenOutcomes.set(mint, {
      mint,
      sourceId,
      ...outcome,
    });

    // Update source metrics
    this.updateSourceMetrics(sourceId, outcome);
    
    // Recalculate credibility score
    this.updateCredibilityScore(sourceId);

    logger.debug('ScoringEngine', `Recorded outcome for ${mint} from ${sourceId}: ${outcome.wasRug ? 'RUG' : `${outcome.maxMultiplier}x`}`);
  }

  /**
   * Update source metrics based on outcome
   */
  private updateSourceMetrics(
    sourceId: string,
    outcome: {
      discoveryLatency: number;
      maxMultiplier: number;
      wasRug: boolean;
      tradingVolume: number;
    }
  ): void {
    const metrics = this.sourceMetrics.get(sourceId);
    if (!metrics) return;

    // Update rug count
    if (outcome.wasRug) {
      metrics.rugCount++;
    } else if (outcome.maxMultiplier >= 2.0 || outcome.tradingVolume > 100000) {
      // Consider it "successful" if 2x gain or high volume
      metrics.successfulTokensFound++;
    }

    // Update averages (running average)
    const count = metrics.totalTokensFound;
    metrics.averageLatencyMs = ((metrics.averageLatencyMs * (count - 1)) + outcome.discoveryLatency) / count;
    metrics.averageGain = ((metrics.averageGain * (count - 1)) + outcome.maxMultiplier) / count;
  }

  /**
   * Calculate credibility score for a source
   */
  private updateCredibilityScore(sourceId: string): void {
    const metrics = this.sourceMetrics.get(sourceId);
    if (!metrics || metrics.totalTokensFound < 5) {
      // Need at least 5 tokens to have meaningful score
      return;
    }

    // Success rate component (0-1)
    const successRate = metrics.successfulTokensFound / metrics.totalTokensFound;
    const rugPenalty = metrics.rugCount / metrics.totalTokensFound;
    const successScore = Math.max(0, successRate - (rugPenalty * 2)); // Rugs count double

    // Average gain component (normalized)
    const avgGainScore = Math.min(1, metrics.averageGain / 10); // 10x = perfect score

    // Latency component (lower is better)
    const avgLatencyMinutes = metrics.averageLatencyMs / (60 * 1000);
    const latencyScore = Math.max(0, 1 - (avgLatencyMinutes / 60)); // 0 = instant, 1h = worst

    // Recent performance (last 7 days)
    const recentScore = this.calculateRecentPerformance(sourceId);

    // Weighted final score
    const credibilityScore =
      this.WEIGHT_SUCCESS_RATE * successScore +
      this.WEIGHT_AVG_GAIN * avgGainScore +
      this.WEIGHT_LATENCY * latencyScore +
      this.WEIGHT_RECENT * recentScore;

    metrics.credibilityScore = Math.max(0.1, Math.min(1.0, credibilityScore)); // Clamp to 0.1-1.0

    logger.info('ScoringEngine', `Updated credibility for ${sourceId}: ${metrics.credibilityScore.toFixed(3)} (success: ${successScore.toFixed(2)}, gain: ${avgGainScore.toFixed(2)}, latency: ${latencyScore.toFixed(2)})`);
  }

  /**
   * Calculate recent performance (last 7 days)
   */
  private calculateRecentPerformance(sourceId: string): number {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    const recentOutcomes = Array.from(this.tokenOutcomes.values()).filter(
      outcome => outcome.sourceId === sourceId && this.getDiscoveryTimestamp(outcome.mint) > sevenDaysAgo
    );

    if (recentOutcomes.length === 0) return 0.5; // Neutral if no recent data

    const recentSuccessCount = recentOutcomes.filter(
      o => !o.wasRug && (o.maxMultiplier >= 2.0 || o.tradingVolume > 100000)
    ).length;

    return recentSuccessCount / recentOutcomes.length;
  }

  /**
   * Get discovery timestamp for a token (placeholder - would come from DB)
   */
  private getDiscoveryTimestamp(mint: string): number {
    // In real implementation, this would query the database
    // For now, return current time
    return Date.now();
  }

  /**
   * Get source score
   */
  getSourceScore(sourceId: string, baseWeight: number = 1.0): SourceScore {
    const metrics = this.sourceMetrics.get(sourceId);

    if (!metrics) {
      return {
        sourceId,
        credibilityScore: baseWeight,
        successRate: 0,
        averageLatency: 0,
        recentPerformance: 0,
        weight: baseWeight,
      };
    }

    const successRate = metrics.totalTokensFound > 0
      ? metrics.successfulTokensFound / metrics.totalTokensFound
      : 0;

    const recentPerformance = this.calculateRecentPerformance(sourceId);

    return {
      sourceId,
      credibilityScore: metrics.credibilityScore,
      successRate,
      averageLatency: metrics.averageLatencyMs,
      recentPerformance,
      weight: baseWeight * metrics.credibilityScore,
    };
  }

  /**
   * Calculate token score based on which sources found it
   */
  calculateTokenScore(record: DiscoveryRecord): TokenScore {
    // Get weights from all sources that confirmed this token
    const weights = [record.firstSourceId, ...record.confirmations.map(c => c.sourceId)]
      .map(sourceId => {
        const metrics = this.sourceMetrics.get(sourceId);
        return metrics?.credibilityScore || 1.0;
      });

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const credibilityScore = weights.length > 0 ? totalWeight / weights.length : 1.0;

    // First discovery latency (if available)
    const firstConfirmation = record.confirmations.length > 0
      ? record.confirmations[0].latencyFromFirstMs
      : 0;

    return {
      mint: record.mint,
      totalWeight,
      confirmationCount: weights.length,
      firstDiscoveryLatency: firstConfirmation,
      credibilityScore,
    };
  }

  /**
   * Get all source scores
   */
  getAllSourceScores(): SourceScore[] {
    return Array.from(this.sourceMetrics.entries()).map(([sourceId, _]) =>
      this.getSourceScore(sourceId, 1.0)
    );
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalSources: this.sourceMetrics.size,
      totalTokensTracked: this.tokenOutcomes.size,
      sourceMetrics: Object.fromEntries(this.sourceMetrics),
    };
  }

  /**
   * Reset metrics for a source
   */
  resetSource(sourceId: string): void {
    this.sourceMetrics.delete(sourceId);
    logger.info('ScoringEngine', `Reset metrics for source: ${sourceId}`);
  }
}
