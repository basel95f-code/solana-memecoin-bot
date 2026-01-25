/**
 * Pattern Detector
 * Identifies successful entry patterns from top wallets
 * Detects when current behavior matches historical winners
 */

import { logger } from '../../utils/logger';
import type { WalletProfile } from './WalletProfiler';

export interface EntryPattern {
  id: string;
  name: string;
  description: string;
  
  // Pattern characteristics
  avgTimeToEntry: number;          // Average entry time from launch
  avgPositionSize: number;          // Typical position size
  avgTokenAge: number;              // Age of token at entry (ms)
  
  // Performance
  winRate: number;                  // Success rate
  avgReturn: number;                // Average return %
  sampleSize: number;               // Number of occurrences
  
  // Conditions that define this pattern
  conditions: PatternCondition[];
  
  // Confidence
  confidence: number;               // How reliable is this pattern
  lastSeen: number;
}

export interface PatternCondition {
  field: 'timeToEntry' | 'positionSize' | 'tokenAge' | 'liquidity' | 'holderCount';
  operator: '<' | '>' | '==' | 'between';
  value: number | [number, number];
}

export interface PatternMatch {
  pattern: EntryPattern;
  walletAddress: string;
  tokenMint: string;
  matchScore: number;               // 0-1, how well it matches
  matchedConditions: string[];
  timestamp: number;
}

export class PatternDetector {
  private patterns: Map<string, EntryPattern> = new Map();
  private matches: PatternMatch[] = [];

  constructor() {
    // Initialize with common winning patterns
    this.initializeCommonPatterns();
  }

  /**
   * Initialize common winning patterns
   */
  private initializeCommonPatterns(): void {
    // Pattern 1: Ultra-fast sniper
    this.patterns.set('ultra-fast-sniper', {
      id: 'ultra-fast-sniper',
      name: 'Ultra-Fast Sniper',
      description: 'Enters within 2 minutes of launch with medium position',
      avgTimeToEntry: 2 * 60 * 1000, // 2 minutes
      avgPositionSize: 5,
      avgTokenAge: 2 * 60 * 1000,
      winRate: 0.72,
      avgReturn: 145,
      sampleSize: 150,
      conditions: [
        { field: 'timeToEntry', operator: '<', value: 2 * 60 * 1000 },
        { field: 'positionSize', operator: 'between', value: [2, 10] },
      ],
      confidence: 0.85,
      lastSeen: Date.now(),
    });

    // Pattern 2: Early whale accumulation
    this.patterns.set('early-whale', {
      id: 'early-whale',
      name: 'Early Whale Accumulation',
      description: 'Large position within 5 minutes',
      avgTimeToEntry: 5 * 60 * 1000,
      avgPositionSize: 20,
      avgTokenAge: 5 * 60 * 1000,
      winRate: 0.68,
      avgReturn: 95,
      sampleSize: 80,
      conditions: [
        { field: 'timeToEntry', operator: '<', value: 5 * 60 * 1000 },
        { field: 'positionSize', operator: '>', value: 15 },
      ],
      confidence: 0.75,
      lastSeen: Date.now(),
    });

    // Pattern 3: Conservative early entry
    this.patterns.set('conservative-early', {
      id: 'conservative-early',
      name: 'Conservative Early Entry',
      description: 'Small position within 10 minutes',
      avgTimeToEntry: 10 * 60 * 1000,
      avgPositionSize: 2,
      avgTokenAge: 10 * 60 * 1000,
      winRate: 0.62,
      avgReturn: 65,
      sampleSize: 200,
      conditions: [
        { field: 'timeToEntry', operator: '<', value: 10 * 60 * 1000 },
        { field: 'positionSize', operator: 'between', value: [1, 5] },
      ],
      confidence: 0.70,
      lastSeen: Date.now(),
    });

    logger.info('PatternDetector', `Initialized ${this.patterns.size} common patterns`);
  }

  /**
   * Detect patterns in a wallet's trade
   */
  detectPattern(
    walletProfile: WalletProfile,
    tokenMint: string,
    entryTime: number,
    positionSize: number,
    tokenLaunchTime: number
  ): PatternMatch | null {
    const timeToEntry = entryTime - tokenLaunchTime;

    let bestMatch: PatternMatch | null = null;
    let bestScore = 0;

    for (const pattern of this.patterns.values()) {
      const matchScore = this.calculateMatchScore(
        pattern,
        timeToEntry,
        positionSize,
        entryTime - tokenLaunchTime
      );

      if (matchScore > bestScore && matchScore >= 0.7) {
        const matchedConditions = this.getMatchedConditions(
          pattern,
          timeToEntry,
          positionSize
        );

        bestMatch = {
          pattern,
          walletAddress: walletProfile.walletAddress,
          tokenMint,
          matchScore,
          matchedConditions,
          timestamp: Date.now(),
        };
        bestScore = matchScore;
      }
    }

    if (bestMatch) {
      this.matches.push(bestMatch);
      logger.info('PatternDetector', `Detected pattern "${bestMatch.pattern.name}" (score: ${(bestMatch.matchScore * 100).toFixed(1)}%)`);
      return bestMatch;
    }

    return null;
  }

  /**
   * Calculate match score
   */
  private calculateMatchScore(
    pattern: EntryPattern,
    timeToEntry: number,
    positionSize: number,
    tokenAge: number
  ): number {
    let score = 0;
    let matchedCount = 0;

    for (const condition of pattern.conditions) {
      const matches = this.evaluateCondition(
        condition,
        timeToEntry,
        positionSize,
        tokenAge
      );

      if (matches) {
        matchedCount++;
      }
    }

    // Base score from matched conditions
    score = matchedCount / pattern.conditions.length;

    // Boost for similarity to average values
    const timeToEntrySimilarity = 1 - Math.abs(timeToEntry - pattern.avgTimeToEntry) / pattern.avgTimeToEntry;
    const positionSizeSimilarity = 1 - Math.abs(positionSize - pattern.avgPositionSize) / pattern.avgPositionSize;

    // Weight: 60% condition match, 40% similarity
    score = score * 0.6 + (timeToEntrySimilarity * 0.2 + positionSizeSimilarity * 0.2);

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Evaluate condition
   */
  private evaluateCondition(
    condition: PatternCondition,
    timeToEntry: number,
    positionSize: number,
    tokenAge: number
  ): boolean {
    let fieldValue: number;

    switch (condition.field) {
      case 'timeToEntry':
        fieldValue = timeToEntry;
        break;
      case 'positionSize':
        fieldValue = positionSize;
        break;
      case 'tokenAge':
        fieldValue = tokenAge;
        break;
      default:
        return false;
    }

    switch (condition.operator) {
      case '<':
        return fieldValue < (condition.value as number);
      case '>':
        return fieldValue > (condition.value as number);
      case '==':
        return fieldValue === (condition.value as number);
      case 'between':
        const [min, max] = condition.value as [number, number];
        return fieldValue >= min && fieldValue <= max;
      default:
        return false;
    }
  }

  /**
   * Get matched conditions
   */
  private getMatchedConditions(
    pattern: EntryPattern,
    timeToEntry: number,
    positionSize: number
  ): string[] {
    const matched: string[] = [];

    for (const condition of pattern.conditions) {
      const isMatch = this.evaluateCondition(
        condition,
        timeToEntry,
        positionSize,
        timeToEntry
      );

      if (isMatch) {
        matched.push(this.formatCondition(condition));
      }
    }

    return matched;
  }

  /**
   * Format condition as string
   */
  private formatCondition(condition: PatternCondition): string {
    const field = condition.field.replace(/([A-Z])/g, ' $1').toLowerCase();

    switch (condition.operator) {
      case '<':
        return `${field} < ${this.formatValue(condition.value)}`;
      case '>':
        return `${field} > ${this.formatValue(condition.value)}`;
      case '==':
        return `${field} = ${this.formatValue(condition.value)}`;
      case 'between':
        const [min, max] = condition.value as [number, number];
        return `${field} between ${this.formatValue(min)} and ${this.formatValue(max)}`;
      default:
        return '';
    }
  }

  /**
   * Format value (convert ms to minutes, etc.)
   */
  private formatValue(value: number | [number, number]): string {
    if (Array.isArray(value)) {
      return `[${value.map(v => this.formatValue(v)).join(', ')}]`;
    }

    // If it looks like milliseconds, convert to minutes
    if (value > 60000) {
      return `${Math.floor(value / 60000)}min`;
    }

    return value.toString();
  }

  /**
   * Learn new pattern from successful trades
   */
  learnPattern(
    trades: any[],
    minWinRate: number = 0.65,
    minSampleSize: number = 20
  ): EntryPattern | null {
    const successfulTrades = trades.filter(t => t.isWin);

    if (successfulTrades.length < minSampleSize) {
      return null;
    }

    const winRate = successfulTrades.length / trades.length;
    if (winRate < minWinRate) {
      return null;
    }

    // Calculate averages
    const avgTimeToEntry = this.calculateAverage(trades, 'timeToEntry');
    const avgPositionSize = this.calculateAverage(trades, 'entrySolValue');
    const avgReturn = this.calculateAverage(successfulTrades, 'profitLossPercent');

    // Create pattern
    const pattern: EntryPattern = {
      id: `learned-${Date.now()}`,
      name: `Learned Pattern ${this.patterns.size + 1}`,
      description: `Automatically learned from ${trades.length} trades`,
      avgTimeToEntry,
      avgPositionSize,
      avgTokenAge: avgTimeToEntry,
      winRate,
      avgReturn,
      sampleSize: trades.length,
      conditions: [
        { field: 'timeToEntry', operator: '<', value: avgTimeToEntry * 1.2 },
        { field: 'positionSize', operator: 'between', value: [avgPositionSize * 0.5, avgPositionSize * 1.5] },
      ],
      confidence: Math.min(1, winRate * (trades.length / 100)),
      lastSeen: Date.now(),
    };

    this.patterns.set(pattern.id, pattern);
    logger.info('PatternDetector', `Learned new pattern: ${pattern.name} (${(winRate * 100).toFixed(1)}% win rate)`);

    return pattern;
  }

  /**
   * Calculate average
   */
  private calculateAverage(trades: any[], field: string): number {
    const values = trades.map(t => t[field] || 0);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }

  /**
   * Get all patterns
   */
  getAllPatterns(): EntryPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Get best patterns
   */
  getBestPatterns(minConfidence: number = 0.7): EntryPattern[] {
    return Array.from(this.patterns.values())
      .filter(p => p.confidence >= minConfidence)
      .sort((a, b) => b.winRate - a.winRate);
  }

  /**
   * Get pattern matches
   */
  getMatches(limit: number = 50): PatternMatch[] {
    return this.matches.slice(-limit);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalPatterns: this.patterns.size,
      totalMatches: this.matches.length,
      avgMatchScore: this.matches.length > 0
        ? this.matches.reduce((sum, m) => sum + m.matchScore, 0) / this.matches.length
        : 0,
    };
  }
}
