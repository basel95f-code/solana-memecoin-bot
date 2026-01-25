/**
 * Pattern Matcher
 * Tests patterns against historical data and tracks performance
 */

import { logger } from '../utils/logger';
import type {
  Pattern,
  PatternCondition,
  PatternMatch,
  PatternPerformance,
  HistoricalToken,
} from './types';

export class PatternMatcher {
  private patterns: Map<string, Pattern> = new Map();
  private matches: PatternMatch[] = [];

  /**
   * Register a pattern to test
   */
  registerPattern(pattern: Pattern): void {
    this.patterns.set(pattern.id, pattern);
    logger.info('PatternMatcher', `Registered pattern: ${pattern.name}`);
  }

  /**
   * Test all patterns against historical tokens
   */
  testPatterns(historicalTokens: HistoricalToken[]): PatternMatch[] {
    logger.info('PatternMatcher', `Testing ${this.patterns.size} patterns against ${historicalTokens.length} tokens`);

    this.matches = [];

    for (const token of historicalTokens) {
      for (const pattern of this.patterns.values()) {
        if (this.matchesPattern(token, pattern)) {
          this.matches.push({
            pattern,
            token,
            matchedAt: token.launchTimestamp,
            outcome: token.outcome,
          });
        }
      }
    }

    logger.info('PatternMatcher', `Found ${this.matches.length} pattern matches`);
    return this.matches;
  }

  /**
   * Check if token matches pattern
   */
  private matchesPattern(token: HistoricalToken, pattern: Pattern): boolean {
    return pattern.conditions.every(condition =>
      this.evaluateCondition(token, condition)
    );
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(
    token: HistoricalToken,
    condition: PatternCondition
  ): boolean {
    const value = this.getTokenFieldValue(token, condition.field);

    switch (condition.operator) {
      case '>':
        return value > (condition.value as number);
      case '<':
        return value < (condition.value as number);
      case '>=':
        return value >= (condition.value as number);
      case '<=':
        return value <= (condition.value as number);
      case '==':
        return value === (condition.value as number);
      case 'between':
        const [min, max] = condition.value as [number, number];
        return value >= min && value <= max;
      default:
        return false;
    }
  }

  /**
   * Get token field value
   */
  private getTokenFieldValue(token: HistoricalToken, field: string): number {
    switch (field) {
      case 'liquidity':
        return token.initialLiquidity;
      case 'holderCount':
        return token.initialHolderCount;
      case 'marketCap':
        return token.initialMarketCap;
      case 'priceChange1h':
        return token.priceHistory[0]?.priceChange1h || 0;
      case 'volume24h':
        return token.volumeHistory[0]?.volume24h || 0;
      case 'top10Percent':
        return token.holderHistory[0]?.top10Percent || 0;
      default:
        return 0;
    }
  }

  /**
   * Get performance for a specific pattern
   */
  getPatternPerformance(patternId: string): PatternPerformance | null {
    const pattern = this.patterns.get(patternId);
    if (!pattern) return null;

    const patternMatches = this.matches.filter(m => m.pattern.id === patternId);

    if (patternMatches.length === 0) {
      return {
        patternId,
        totalMatches: 0,
        moonCount: 0,
        rugCount: 0,
        avgReturn: 0,
        winRate: 0,
        confidence: 0,
      };
    }

    const moonCount = patternMatches.filter(m => m.outcome.maxMultiplier >= 2.0).length;
    const rugCount = patternMatches.filter(m => m.outcome.wasRug).length;
    
    const avgReturn =
      patternMatches.reduce((sum, m) => sum + (m.outcome.finalMultiplier - 1), 0) /
      patternMatches.length;

    const winCount = patternMatches.filter(m => m.outcome.finalMultiplier >= 1.0).length;
    const winRate = winCount / patternMatches.length;

    // Calculate confidence based on sample size and performance
    const sampleSizeConfidence = Math.min(1, patternMatches.length / 100);
    const performanceConfidence = Math.max(0, (winRate - 0.5) * 2); // 0.5 = break-even
    const confidence = (sampleSizeConfidence * 0.4 + performanceConfidence * 0.6);

    return {
      patternId,
      totalMatches: patternMatches.length,
      moonCount,
      rugCount,
      avgReturn,
      winRate,
      confidence,
    };
  }

  /**
   * Get all pattern performances
   */
  getAllPatternPerformances(): PatternPerformance[] {
    return Array.from(this.patterns.keys())
      .map(id => this.getPatternPerformance(id))
      .filter(p => p !== null) as PatternPerformance[];
  }

  /**
   * Get best patterns
   */
  getBestPatterns(minMatches: number = 10, sortBy: 'winRate' | 'avgReturn' = 'winRate'): PatternPerformance[] {
    const performances = this.getAllPatternPerformances()
      .filter(p => p.totalMatches >= minMatches);

    performances.sort((a, b) => {
      if (sortBy === 'winRate') {
        return b.winRate - a.winRate;
      } else {
        return b.avgReturn - a.avgReturn;
      }
    });

    return performances;
  }

  /**
   * Get pattern matches
   */
  getMatches(patternId?: string): PatternMatch[] {
    if (patternId) {
      return this.matches.filter(m => m.pattern.id === patternId);
    }
    return this.matches;
  }

  /**
   * Clear all matches
   */
  clearMatches(): void {
    this.matches = [];
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalPatterns: this.patterns.size,
      totalMatches: this.matches.length,
      avgMatchesPerPattern: this.matches.length / (this.patterns.size || 1),
    };
  }
}
