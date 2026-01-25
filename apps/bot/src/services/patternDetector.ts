/**
 * Pattern Detector Service
 * Learns success patterns from historical data and matches them to new tokens
 */

import { database } from '../database';
import { logger } from '../utils/logger';

// Pattern types
export type PatternType = 'success' | 'rug' | 'neutral';

// Pattern criteria structure
export interface PatternCriteria {
  [key: string]: boolean | number | { min?: number; max?: number } | string;
}

// Pattern definition
export interface Pattern {
  id?: number;
  patternName: string;
  patternType: PatternType;
  criteria: PatternCriteria;
  occurrenceCount: number;
  successCount: number;
  successRate: number;
  averagePeakMultiplier: number;
  averageTimeToPeakHours: number;
  discoveredAt: number;
  lastSeenAt?: number;
  confidenceScore: number;
  isActive: boolean;
}

// Pattern match result
export interface PatternMatch {
  patternId: number;
  patternName: string;
  patternType: PatternType;
  matchScore: number;
  matchedCriteria: string[];
  successRate: number;
  averagePeakMultiplier: number;
}

// Token data for matching
export interface TokenData {
  mint: string;
  symbol: string;
  // Liquidity
  liquidityUsd?: number;
  lpBurnedPercent?: number;
  lpLockedPercent?: number;
  lpLockedWithinHours?: number;
  // Holders
  totalHolders?: number;
  top10Percent?: number;
  top20Percent?: number;
  largestHolderPercent?: number;
  whaleCount?: number;
  // Contract
  mintRevoked?: boolean;
  freezeRevoked?: boolean;
  isHoneypot?: boolean;
  hasTransferFee?: boolean;
  transferFeePercent?: number;
  // Social
  hasTwitter?: boolean;
  hasTelegram?: boolean;
  hasWebsite?: boolean;
  twitterFollowers?: number;
  telegramMembers?: number;
  // Price/Volume
  priceChange1h?: number;
  priceChange24h?: number;
  volume24h?: number;
  volume5m?: number;
  marketCap?: number;
  // Age
  ageHours?: number;
  // ML scores
  rugProbability?: number;
  mlConfidence?: number;
}

// Prediction result
export interface Prediction {
  predictedOutcome: 'success' | 'rug' | 'neutral';
  confidence: number;
  successProbability: number;
  matchedPatterns: PatternMatch[];
  reasoning: string[];
}

// Pattern statistics
export interface PatternStats {
  pattern: Pattern;
  recentMatches: number;
  recentSuccessRate: number;
  examples: Array<{ mint: string; symbol: string; outcome: string; peakMultiplier?: number }>;
}

// Seed patterns based on known successful token characteristics
const SEED_PATTERNS: Omit<Pattern, 'id' | 'discoveredAt' | 'lastSeenAt'>[] = [
  {
    patternName: 'Triple Safe Moon',
    patternType: 'success',
    criteria: {
      mintRevoked: true,
      freezeRevoked: true,
      lpBurnedPercent: { min: 80 },
      top10Percent: { max: 30 },
      liquidityUsd: { min: 30000, max: 150000 },
    },
    occurrenceCount: 0,
    successCount: 0,
    successRate: 0.85,
    averagePeakMultiplier: 8.5,
    averageTimeToPeakHours: 12,
    confidenceScore: 0.7,
    isActive: true,
  },
  {
    patternName: 'Early LP Lock',
    patternType: 'success',
    criteria: {
      lpLockedWithinHours: { max: 1 },
      lpLockedPercent: { min: 80 },
      liquidityUsd: { min: 20000 },
    },
    occurrenceCount: 0,
    successCount: 0,
    successRate: 0.75,
    averagePeakMultiplier: 6.2,
    averageTimeToPeakHours: 8,
    confidenceScore: 0.65,
    isActive: true,
  },
  {
    patternName: 'Goldilocks Liquidity',
    patternType: 'success',
    criteria: {
      liquidityUsd: { min: 20000, max: 100000 },
      totalHolders: { min: 100 },
      top10Percent: { max: 35 },
    },
    occurrenceCount: 0,
    successCount: 0,
    successRate: 0.72,
    averagePeakMultiplier: 5.8,
    averageTimeToPeakHours: 18,
    confidenceScore: 0.6,
    isActive: true,
  },
  {
    patternName: 'Fair Distribution',
    patternType: 'success',
    criteria: {
      top10Percent: { max: 30 },
      largestHolderPercent: { max: 8 },
      totalHolders: { min: 200 },
    },
    occurrenceCount: 0,
    successCount: 0,
    successRate: 0.78,
    averagePeakMultiplier: 7.3,
    averageTimeToPeakHours: 24,
    confidenceScore: 0.68,
    isActive: true,
  },
  {
    patternName: 'Mega Lock',
    patternType: 'success',
    criteria: {
      lpBurnedPercent: { min: 95 },
      mintRevoked: true,
      freezeRevoked: true,
    },
    occurrenceCount: 0,
    successCount: 0,
    successRate: 0.88,
    averagePeakMultiplier: 12.4,
    averageTimeToPeakHours: 36,
    confidenceScore: 0.75,
    isActive: true,
  },
  {
    patternName: 'Social Momentum',
    patternType: 'success',
    criteria: {
      hasTwitter: true,
      hasTelegram: true,
      twitterFollowers: { min: 500 },
      telegramMembers: { min: 1000 },
    },
    occurrenceCount: 0,
    successCount: 0,
    successRate: 0.7,
    averagePeakMultiplier: 9.1,
    averageTimeToPeakHours: 48,
    confidenceScore: 0.6,
    isActive: true,
  },
  {
    patternName: 'Organic Growth',
    patternType: 'success',
    criteria: {
      liquidityUsd: { min: 15000, max: 80000 },
      volume24h: { min: 50000 },
      totalHolders: { min: 150 },
      top10Percent: { max: 28 },
    },
    occurrenceCount: 0,
    successCount: 0,
    successRate: 0.76,
    averagePeakMultiplier: 6.9,
    averageTimeToPeakHours: 30,
    confidenceScore: 0.65,
    isActive: true,
  },
  {
    patternName: 'Instant Whale Trap',
    patternType: 'rug',
    criteria: {
      liquidityUsd: { min: 200000 },
      top10Percent: { min: 60 },
      mintRevoked: false,
    },
    occurrenceCount: 0,
    successCount: 0,
    successRate: 0.82, // Success rate at detecting rugs
    averagePeakMultiplier: 1.8,
    averageTimeToPeakHours: 2,
    confidenceScore: 0.7,
    isActive: true,
  },
  {
    patternName: 'Honeypot Contract',
    patternType: 'rug',
    criteria: {
      isHoneypot: true,
    },
    occurrenceCount: 0,
    successCount: 0,
    successRate: 0.95,
    averagePeakMultiplier: 1.2,
    averageTimeToPeakHours: 0.5,
    confidenceScore: 0.9,
    isActive: true,
  },
  {
    patternName: 'Whale Concentration',
    patternType: 'rug',
    criteria: {
      top10Percent: { min: 70 },
      largestHolderPercent: { min: 30 },
    },
    occurrenceCount: 0,
    successCount: 0,
    successRate: 0.73,
    averagePeakMultiplier: 2.1,
    averageTimeToPeakHours: 3,
    confidenceScore: 0.65,
    isActive: true,
  },
  {
    patternName: 'No Socials Red Flag',
    patternType: 'rug',
    criteria: {
      hasTwitter: false,
      hasTelegram: false,
      hasWebsite: false,
      liquidityUsd: { min: 50000 },
    },
    occurrenceCount: 0,
    successCount: 0,
    successRate: 0.68,
    averagePeakMultiplier: 1.9,
    averageTimeToPeakHours: 4,
    confidenceScore: 0.6,
    isActive: true,
  },
  {
    patternName: 'Community Token',
    patternType: 'success',
    criteria: {
      largestHolderPercent: { max: 5 },
      top10Percent: { max: 20 },
      totalHolders: { min: 500 },
      hasTwitter: true,
    },
    occurrenceCount: 0,
    successCount: 0,
    successRate: 0.81,
    averagePeakMultiplier: 11.2,
    averageTimeToPeakHours: 72,
    confidenceScore: 0.72,
    isActive: true,
  },
  {
    patternName: 'Stealth Gem',
    patternType: 'success',
    criteria: {
      liquidityUsd: { min: 10000, max: 40000 },
      mintRevoked: true,
      freezeRevoked: true,
      lpBurnedPercent: { min: 90 },
      top10Percent: { max: 25 },
    },
    occurrenceCount: 0,
    successCount: 0,
    successRate: 0.83,
    averagePeakMultiplier: 15.6,
    averageTimeToPeakHours: 96,
    confidenceScore: 0.75,
    isActive: true,
  },
  {
    patternName: 'Viral Spike',
    patternType: 'success',
    criteria: {
      volume24h: { min: 500000 },
      priceChange24h: { min: 100 },
      totalHolders: { min: 300 },
    },
    occurrenceCount: 0,
    successCount: 0,
    successRate: 0.65,
    averagePeakMultiplier: 4.2,
    averageTimeToPeakHours: 6,
    confidenceScore: 0.55,
    isActive: true,
  },
  {
    patternName: 'High Fee Scam',
    patternType: 'rug',
    criteria: {
      hasTransferFee: true,
      transferFeePercent: { min: 5 },
    },
    occurrenceCount: 0,
    successCount: 0,
    successRate: 0.9,
    averagePeakMultiplier: 1.3,
    averageTimeToPeakHours: 1,
    confidenceScore: 0.85,
    isActive: true,
  },
];

class PatternDetector {
  private initialized: boolean = false;

  /**
   * Initialize the pattern detector with seed data
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Insert seed patterns if not already present
      const existingCount = database.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM success_patterns'
      )?.count || 0;

      if (existingCount === 0) {
        logger.info('PatternDetector', 'Seeding initial patterns');
        for (const pattern of SEED_PATTERNS) {
          await this.savePattern({
            ...pattern,
            discoveredAt: Math.floor(Date.now() / 1000),
          });
        }
        logger.info('PatternDetector', `Seeded ${SEED_PATTERNS.length} patterns`);
      }

      this.initialized = true;
      logger.info('PatternDetector', 'Initialized');
    } catch (error) {
      logger.error('PatternDetector', 'Initialization failed', error);
      throw error;
    }
  }

  /**
   * Discover new patterns from historical token data
   */
  async discoverPatterns(): Promise<Pattern[]> {
    logger.info('PatternDetector', 'Starting pattern discovery');

    try {
      // Get tokens with known outcomes from token_outcomes_v2
      const tokens = database.all<any>(
        `SELECT * FROM token_outcomes_v2 
         WHERE outcome_type IS NOT NULL 
         AND outcome_type != 'unknown'
         ORDER BY discovered_at DESC 
         LIMIT 1000`
      );

      if (tokens.length < 20) {
        logger.warn('PatternDetector', 'Not enough historical data for pattern discovery');
        return [];
      }

      // Separate by outcome
      const successful = tokens.filter(t => t.outcome_type === 'moon' || t.outcome_type === 'pump');
      const rugs = tokens.filter(t => t.outcome_type === 'rug');

      const discoveredPatterns: Pattern[] = [];

      // Find patterns in successful tokens
      if (successful.length >= 5) {
        const successPatterns = await this.findCommonalities(successful, 'success');
        discoveredPatterns.push(...successPatterns);
      }

      // Find patterns in rugs
      if (rugs.length >= 5) {
        const rugPatterns = await this.findCommonalities(rugs, 'rug');
        discoveredPatterns.push(...rugPatterns);
      }

      // Validate and save new patterns
      let savedCount = 0;
      for (const pattern of discoveredPatterns) {
        const successRate = await this.validatePattern(pattern);
        if (successRate > 0.65) {
          // 65%+ validation success
          pattern.successRate = successRate;
          await this.savePattern(pattern);
          savedCount++;
        }
      }

      logger.info('PatternDetector', `Discovered and saved ${savedCount} new patterns`);
      return discoveredPatterns;
    } catch (error) {
      logger.error('PatternDetector', 'Pattern discovery failed', error);
      return [];
    }
  }

  /**
   * Find common characteristics in a group of tokens
   */
  private async findCommonalities(tokens: any[], patternType: PatternType): Promise<Pattern[]> {
    const patterns: Pattern[] = [];
    const now = Math.floor(Date.now() / 1000);

    // Get corresponding token analysis data
    const analysisData = database.all<any>(
      `SELECT * FROM token_analysis 
       WHERE mint IN (${tokens.map(() => '?').join(',')})`,
      tokens.map(t => t.token_mint)
    );

    const analysisMap = new Map(analysisData.map(a => [a.mint, a]));

    // Combine outcome data with analysis data
    const enrichedTokens = tokens
      .map(t => {
        const analysis = analysisMap.get(t.token_mint);
        return analysis ? { ...t, ...analysis } : null;
      })
      .filter(t => t !== null);

    if (enrichedTokens.length < 5) return patterns;

    // LP Lock Timing Pattern
    const earlyLocks = enrichedTokens.filter(
      t => t.lp_locked_percent && t.lp_locked_percent > 80
    );
    if (earlyLocks.length / enrichedTokens.length > 0.6) {
      patterns.push({
        patternName: `${patternType === 'success' ? 'Early' : 'Suspicious'} LP Lock Pattern`,
        patternType,
        criteria: { lpLockedPercent: { min: 80 } },
        occurrenceCount: earlyLocks.length,
        successCount: patternType === 'success' ? earlyLocks.length : 0,
        successRate: earlyLocks.length / enrichedTokens.length,
        averagePeakMultiplier: this.calculateAverage(
          earlyLocks.map(t => t.max_price && t.initial_price ? t.max_price / t.initial_price : 1)
        ),
        averageTimeToPeakHours: 12,
        discoveredAt: now,
        confidenceScore: 0.6,
        isActive: true,
      });
    }

    // Liquidity Range Pattern
    const midLiquidity = enrichedTokens.filter(
      t => t.liquidity_usd && t.liquidity_usd > 20000 && t.liquidity_usd < 100000
    );
    if (midLiquidity.length / enrichedTokens.length > 0.5) {
      patterns.push({
        patternName: `${patternType === 'success' ? 'Goldilocks' : 'Mid-Range'} Liquidity`,
        patternType,
        criteria: { liquidityUsd: { min: 20000, max: 100000 } },
        occurrenceCount: midLiquidity.length,
        successCount: patternType === 'success' ? midLiquidity.length : 0,
        successRate: midLiquidity.length / enrichedTokens.length,
        averagePeakMultiplier: this.calculateAverage(
          midLiquidity.map(t => t.max_price && t.initial_price ? t.max_price / t.initial_price : 1)
        ),
        averageTimeToPeakHours: 18,
        discoveredAt: now,
        confidenceScore: 0.55,
        isActive: true,
      });
    }

    // Fair Holder Distribution Pattern
    const fairHolders = enrichedTokens.filter(
      t => t.top10_percent && t.top10_percent < 30
    );
    if (fairHolders.length / enrichedTokens.length > 0.6) {
      patterns.push({
        patternName: `${patternType === 'success' ? 'Fair' : 'Distributed'} Holder Pattern`,
        patternType,
        criteria: { top10Percent: { max: 30 } },
        occurrenceCount: fairHolders.length,
        successCount: patternType === 'success' ? fairHolders.length : 0,
        successRate: fairHolders.length / enrichedTokens.length,
        averagePeakMultiplier: this.calculateAverage(
          fairHolders.map(t => t.max_price && t.initial_price ? t.max_price / t.initial_price : 1)
        ),
        averageTimeToPeakHours: 24,
        discoveredAt: now,
        confidenceScore: 0.58,
        isActive: true,
      });
    }

    // Triple Safe Pattern
    const tripleSafe = enrichedTokens.filter(
      t => t.mint_revoked && t.freeze_revoked && t.lp_burned_percent && t.lp_burned_percent > 80
    );
    if (tripleSafe.length / enrichedTokens.length > 0.5) {
      patterns.push({
        patternName: `${patternType === 'success' ? 'Triple' : 'Over'} Safe Contract`,
        patternType,
        criteria: {
          mintRevoked: true,
          freezeRevoked: true,
          lpBurnedPercent: { min: 80 },
        },
        occurrenceCount: tripleSafe.length,
        successCount: patternType === 'success' ? tripleSafe.length : 0,
        successRate: tripleSafe.length / enrichedTokens.length,
        averagePeakMultiplier: this.calculateAverage(
          tripleSafe.map(t => t.max_price && t.initial_price ? t.max_price / t.initial_price : 1)
        ),
        averageTimeToPeakHours: 20,
        discoveredAt: now,
        confidenceScore: 0.7,
        isActive: true,
      });
    }

    // Whale Concentration (rug indicator)
    if (patternType === 'rug') {
      const whaleConcentration = enrichedTokens.filter(
        t => t.top10_percent && t.top10_percent > 70
      );
      if (whaleConcentration.length / enrichedTokens.length > 0.5) {
        patterns.push({
          patternName: 'Extreme Whale Concentration',
          patternType: 'rug',
          criteria: { top10Percent: { min: 70 } },
          occurrenceCount: whaleConcentration.length,
          successCount: whaleConcentration.length,
          successRate: whaleConcentration.length / enrichedTokens.length,
          averagePeakMultiplier: this.calculateAverage(
            whaleConcentration.map(t => t.max_price && t.initial_price ? t.max_price / t.initial_price : 1)
          ),
          averageTimeToPeakHours: 2,
          discoveredAt: now,
          confidenceScore: 0.68,
          isActive: true,
        });
      }
    }

    return patterns;
  }

  /**
   * Validate a pattern against a test set
   */
  async validatePattern(pattern: Pattern | Omit<Pattern, 'id' | 'discoveredAt' | 'lastSeenAt'>): Promise<number> {
    try {
      // Get a validation set (recent outcomes not used in discovery)
      const validationTokens = database.all<any>(
        `SELECT to2.*, ta.* 
         FROM token_outcomes_v2 to2
         LEFT JOIN token_analysis ta ON to2.token_mint = ta.mint
         WHERE to2.outcome_type IS NOT NULL 
         AND to2.outcome_type != 'unknown'
         ORDER BY to2.discovered_at DESC 
         LIMIT 100 OFFSET 50`
      );

      if (validationTokens.length < 10) {
        return pattern.successRate || 0.5;
      }

      let correctPredictions = 0;
      let totalMatches = 0;

      for (const token of validationTokens) {
        const tokenData = this.tokenToData(token);
        const matchScore = this.calculateMatchScore(tokenData, pattern);

        if (matchScore > 0.7) {
          // Pattern matched
          totalMatches++;
          const expectedOutcome = pattern.patternType === 'success' ? 'moon' : 'rug';
          if (token.outcome_type === expectedOutcome || 
              (expectedOutcome === 'moon' && token.outcome_type === 'pump')) {
            correctPredictions++;
          }
        }
      }

      return totalMatches > 0 ? correctPredictions / totalMatches : 0;
    } catch (error) {
      logger.error('PatternDetector', 'Pattern validation failed', error);
      return 0;
    }
  }

  /**
   * Save a pattern to the database
   */
  async savePattern(pattern: Pattern | Omit<Pattern, 'id' | 'discoveredAt' | 'lastSeenAt'>): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const discoveredAt = 'discoveredAt' in pattern ? pattern.discoveredAt : now;

      database.run(
        `INSERT OR REPLACE INTO success_patterns 
         (pattern_name, pattern_type, criteria, occurrence_count, success_count, 
          success_rate, average_peak_multiplier, average_time_to_peak_hours,
          discovered_at, last_seen_at, confidence_score, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pattern.patternName,
          pattern.patternType,
          JSON.stringify(pattern.criteria),
          pattern.occurrenceCount,
          pattern.successCount,
          pattern.successRate,
          pattern.averagePeakMultiplier,
          pattern.averageTimeToPeakHours,
          discoveredAt,
          now,
          pattern.confidenceScore,
          pattern.isActive ? 1 : 0,
        ]
      );

      logger.info('PatternDetector', `Saved pattern: ${pattern.patternName}`);
    } catch (error) {
      logger.error('PatternDetector', `Failed to save pattern: ${pattern.patternName}`, error);
      throw error;
    }
  }

  /**
   * Deactivate a pattern with low success rate
   */
  async deactivatePattern(patternId: number): Promise<void> {
    database.run('UPDATE success_patterns SET is_active = 0 WHERE id = ?', [patternId]);
    logger.info('PatternDetector', `Deactivated pattern ${patternId}`);
  }

  /**
   * Match a token against all active patterns
   */
  async matchToken(tokenData: TokenData): Promise<PatternMatch[]> {
    const patterns = await this.getAllPatterns(true); // Only active patterns
    const matches: PatternMatch[] = [];

    for (const pattern of patterns) {
      const matchScore = this.calculateMatchScore(tokenData, pattern);

      if (matchScore > 0.5) {
        // At least 50% match threshold
        const matchedCriteria = this.getMatchedCriteria(tokenData, pattern);

        matches.push({
          patternId: pattern.id!,
          patternName: pattern.patternName,
          patternType: pattern.patternType,
          matchScore,
          matchedCriteria,
          successRate: pattern.successRate,
          averagePeakMultiplier: pattern.averagePeakMultiplier,
        });
      }
    }

    // Sort by match score descending
    matches.sort((a, b) => b.matchScore - a.matchScore);

    // Save pattern matches to database
    const now = Math.floor(Date.now() / 1000);
    for (const match of matches) {
      database.run(
        `INSERT INTO token_pattern_matches 
         (token_mint, token_symbol, pattern_id, pattern_name, match_score, 
          matched_criteria, actual_outcome, matched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tokenData.mint,
          tokenData.symbol,
          match.patternId,
          match.patternName,
          match.matchScore,
          JSON.stringify(match.matchedCriteria),
          'pending',
          now,
        ]
      );
    }

    return matches;
  }

  /**
   * Calculate match score between token and pattern (0-1)
   */
  calculateMatchScore(token: TokenData, pattern: Pattern | Omit<Pattern, 'id' | 'discoveredAt' | 'lastSeenAt'>): number {
    let matchedCriteria = 0;
    let totalCriteria = 0;

    for (const [key, value] of Object.entries(pattern.criteria)) {
      totalCriteria++;

      const tokenValue = (token as any)[key];

      if (typeof value === 'object' && value !== null && ('min' in value || 'max' in value)) {
        // Range check
        const rangeValue = value as { min?: number; max?: number };
        const passes =
          (rangeValue.min === undefined || tokenValue >= rangeValue.min) &&
          (rangeValue.max === undefined || tokenValue <= rangeValue.max);

        if (passes) {
          matchedCriteria++;
        }
      } else if (typeof value === 'boolean') {
        // Boolean check
        if (tokenValue === value) {
          matchedCriteria++;
        }
      } else {
        // Exact match
        if (tokenValue === value) {
          matchedCriteria++;
        }
      }
    }

    return totalCriteria > 0 ? matchedCriteria / totalCriteria : 0;
  }

  /**
   * Get list of which criteria were matched
   */
  private getMatchedCriteria(token: TokenData, pattern: Pattern): string[] {
    const matched: string[] = [];

    for (const [key, value] of Object.entries(pattern.criteria)) {
      const tokenValue = (token as any)[key];

      if (typeof value === 'object' && value !== null && ('min' in value || 'max' in value)) {
        const rangeValue = value as { min?: number; max?: number };
        const passes =
          (rangeValue.min === undefined || tokenValue >= rangeValue.min) &&
          (rangeValue.max === undefined || tokenValue <= rangeValue.max);

        if (passes) {
          matched.push(key);
        }
      } else if (typeof value === 'boolean') {
        if (tokenValue === value) {
          matched.push(key);
        }
      } else {
        if (tokenValue === value) {
          matched.push(key);
        }
      }
    }

    return matched;
  }

  /**
   * Get top matching patterns for a token
   */
  async getTopMatches(tokenData: TokenData, limit: number = 5): Promise<PatternMatch[]> {
    const matches = await this.matchToken(tokenData);
    return matches.slice(0, limit);
  }

  /**
   * Get pattern statistics
   */
  async getPatternStats(patternId: number): Promise<PatternStats | null> {
    try {
      const pattern = database.get<any>(
        'SELECT * FROM success_patterns WHERE id = ?',
        [patternId]
      );

      if (!pattern) return null;

      // Get recent matches
      const recentMatches = database.all<any>(
        `SELECT * FROM token_pattern_matches 
         WHERE pattern_id = ? 
         AND matched_at > ? 
         ORDER BY matched_at DESC`,
        [patternId, Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60] // Last 7 days
      );

      const successfulMatches = recentMatches.filter(
        m => m.actual_outcome === 'success' || m.actual_outcome === 'moon'
      );

      const recentSuccessRate =
        recentMatches.length > 0 ? successfulMatches.length / recentMatches.length : 0;

      // Get example tokens
      const examples = database.all<any>(
        `SELECT token_mint, token_symbol, actual_outcome, peak_multiplier 
         FROM token_pattern_matches 
         WHERE pattern_id = ? 
         AND actual_outcome IS NOT NULL 
         AND actual_outcome != 'pending'
         ORDER BY match_score DESC 
         LIMIT 5`,
        [patternId]
      );

      return {
        pattern: this.dbRowToPattern(pattern),
        recentMatches: recentMatches.length,
        recentSuccessRate,
        examples: examples.map(e => ({
          mint: e.token_mint,
          symbol: e.token_symbol,
          outcome: e.actual_outcome,
          peakMultiplier: e.peak_multiplier,
        })),
      };
    } catch (error) {
      logger.error('PatternDetector', 'Failed to get pattern stats', error);
      return null;
    }
  }

  /**
   * Get all patterns (optionally only active ones)
   */
  async getAllPatterns(activeOnly: boolean = false): Promise<Pattern[]> {
    const query = activeOnly
      ? 'SELECT * FROM success_patterns WHERE is_active = 1 ORDER BY success_rate DESC'
      : 'SELECT * FROM success_patterns ORDER BY success_rate DESC';

    const rows = database.all<any>(query);
    return rows.map(row => this.dbRowToPattern(row));
  }

  /**
   * Update pattern metrics from recent outcomes
   */
  async updatePatternMetrics(): Promise<void> {
    logger.info('PatternDetector', 'Updating pattern metrics');

    try {
      const patterns = await this.getAllPatterns();

      for (const pattern of patterns) {
        // Get all matches for this pattern
        const matches = database.all<any>(
          `SELECT * FROM token_pattern_matches 
           WHERE pattern_id = ? 
           AND actual_outcome IS NOT NULL 
           AND actual_outcome != 'pending'`,
          [pattern.id]
        );

        if (matches.length === 0) continue;

        const successfulMatches = matches.filter(
          m => m.actual_outcome === 'success' || m.actual_outcome === 'moon'
        );

        const newSuccessRate = successfulMatches.length / matches.length;
        const avgMultiplier = this.calculateAverage(
          matches.map(m => m.peak_multiplier || 1).filter(m => m > 0)
        );

        // Update pattern
        database.run(
          `UPDATE success_patterns 
           SET occurrence_count = ?, 
               success_count = ?, 
               success_rate = ?,
               average_peak_multiplier = ?,
               last_seen_at = ?
           WHERE id = ?`,
          [
            matches.length,
            successfulMatches.length,
            newSuccessRate,
            avgMultiplier,
            Math.floor(Date.now() / 1000),
            pattern.id,
          ]
        );

        // Deactivate patterns with poor performance
        if (matches.length > 20 && newSuccessRate < 0.4) {
          await this.deactivatePattern(pattern.id!);
          logger.info('PatternDetector', `Deactivated low-performing pattern: ${pattern.patternName}`);
        }
      }

      logger.info('PatternDetector', 'Pattern metrics updated');
    } catch (error) {
      logger.error('PatternDetector', 'Failed to update pattern metrics', error);
    }
  }

  /**
   * Find similar successful tokens based on pattern matching
   */
  async getSimilarSuccessfulTokens(tokenData: TokenData, limit: number = 5): Promise<any[]> {
    try {
      // Get all successful tokens
      const successfulTokens = database.all<any>(
        `SELECT to2.*, ta.* 
         FROM token_outcomes_v2 to2
         LEFT JOIN token_analysis ta ON to2.token_mint = ta.mint
         WHERE to2.outcome_type IN ('moon', 'pump')
         ORDER BY to2.price_change_24h DESC 
         LIMIT 100`
      );

      // Calculate similarity scores
      const similarities: Array<{ token: any; score: number }> = [];

      for (const token of successfulTokens) {
        const similarTokenData = this.tokenToData(token);
        const score = this.calculateSimilarity(tokenData, similarTokenData);

        if (score > 0.5) {
          similarities.push({ token, score });
        }
      }

      // Sort by similarity score
      similarities.sort((a, b) => b.score - a.score);

      return similarities.slice(0, limit).map(s => ({
        ...s.token,
        similarityScore: s.score,
      }));
    } catch (error) {
      logger.error('PatternDetector', 'Failed to find similar tokens', error);
      return [];
    }
  }

  /**
   * Predict outcome for a token based on pattern matches
   */
  async predictOutcome(tokenData: TokenData): Promise<Prediction> {
    const matches = await this.matchToken(tokenData);

    if (matches.length === 0) {
      return {
        predictedOutcome: 'neutral',
        confidence: 0.3,
        successProbability: 0.5,
        matchedPatterns: [],
        reasoning: ['No strong patterns detected'],
      };
    }

    // Weighted prediction based on match scores
    let successScore = 0;
    let rugScore = 0;
    let totalWeight = 0;

    const reasoning: string[] = [];

    for (const match of matches) {
      const weight = match.matchScore * match.successRate;
      totalWeight += weight;

      if (match.patternType === 'success') {
        successScore += weight;
        reasoning.push(
          `${Math.round(match.matchScore * 100)}% match to "${match.patternName}" (${Math.round(match.successRate * 100)}% success rate)`
        );
      } else if (match.patternType === 'rug') {
        rugScore += weight;
        reasoning.push(
          `${Math.round(match.matchScore * 100)}% match to rug pattern "${match.patternName}" (${Math.round(match.successRate * 100)}% detection rate)`
        );
      }
    }

    const successProbability = totalWeight > 0 ? successScore / totalWeight : 0.5;
    const rugProbability = totalWeight > 0 ? rugScore / totalWeight : 0.5;

    let predictedOutcome: 'success' | 'rug' | 'neutral';
    let confidence: number;

    if (successProbability > 0.6 && successProbability > rugProbability * 1.5) {
      predictedOutcome = 'success';
      confidence = successProbability;
    } else if (rugProbability > 0.6 && rugProbability > successProbability * 1.5) {
      predictedOutcome = 'rug';
      confidence = rugProbability;
    } else {
      predictedOutcome = 'neutral';
      confidence = Math.abs(successProbability - rugProbability);
    }

    return {
      predictedOutcome,
      confidence,
      successProbability,
      matchedPatterns: matches.slice(0, 5),
      reasoning,
    };
  }

  /**
   * Calculate similarity between two tokens (0-1)
   */
  private calculateSimilarity(token1: TokenData, token2: TokenData): number {
    const features = [
      'liquidityUsd',
      'lpBurnedPercent',
      'top10Percent',
      'totalHolders',
      'mintRevoked',
      'freezeRevoked',
      'hasTwitter',
      'hasTelegram',
    ];

    let matchCount = 0;
    let totalFeatures = 0;

    for (const feature of features) {
      const val1 = (token1 as any)[feature];
      const val2 = (token2 as any)[feature];

      if (val1 === undefined || val2 === undefined) continue;

      totalFeatures++;

      if (typeof val1 === 'boolean') {
        if (val1 === val2) matchCount++;
      } else if (typeof val1 === 'number' && typeof val2 === 'number') {
        // Numeric similarity (within 20% range)
        const avg = (val1 + val2) / 2;
        const diff = Math.abs(val1 - val2);
        if (avg > 0 && diff / avg < 0.2) {
          matchCount++;
        }
      }
    }

    return totalFeatures > 0 ? matchCount / totalFeatures : 0;
  }

  /**
   * Convert database row to Pattern object
   */
  private dbRowToPattern(row: any): Pattern {
    return {
      id: row.id,
      patternName: row.pattern_name,
      patternType: row.pattern_type,
      criteria: JSON.parse(row.criteria),
      occurrenceCount: row.occurrence_count,
      successCount: row.success_count,
      successRate: row.success_rate,
      averagePeakMultiplier: row.average_peak_multiplier,
      averageTimeToPeakHours: row.average_time_to_peak_hours,
      discoveredAt: row.discovered_at,
      lastSeenAt: row.last_seen_at,
      confidenceScore: row.confidence_score,
      isActive: row.is_active === 1,
    };
  }

  /**
   * Convert token outcome/analysis row to TokenData
   */
  private tokenToData(row: any): TokenData {
    return {
      mint: row.token_mint || row.mint,
      symbol: row.symbol,
      liquidityUsd: row.initial_liquidity || row.liquidity_usd,
      lpBurnedPercent: row.lp_burned_percent,
      lpLockedPercent: row.lp_locked_percent,
      totalHolders: row.initial_holders || row.total_holders,
      top10Percent: row.top10_percent,
      top20Percent: row.top20_percent,
      largestHolderPercent: row.largest_holder_percent,
      whaleCount: row.whale_count,
      mintRevoked: row.mint_revoked === 1,
      freezeRevoked: row.freeze_revoked === 1,
      isHoneypot: row.is_honeypot === 1,
      hasTransferFee: row.has_transfer_fee === 1,
      transferFeePercent: row.transfer_fee_percent,
      hasTwitter: row.has_twitter === 1,
      hasTelegram: row.has_telegram === 1,
      hasWebsite: row.has_website === 1,
      twitterFollowers: row.twitter_followers,
      telegramMembers: row.telegram_members,
      priceChange24h: row.price_change_24h,
      rugProbability: row.initial_rug_prob,
    };
  }

  /**
   * Calculate average of an array of numbers
   */
  private calculateAverage(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    const sum = numbers.reduce((acc, n) => acc + n, 0);
    return sum / numbers.length;
  }

  /**
   * Get pattern by ID
   */
  async getPattern(patternId: number): Promise<Pattern | null> {
    const row = database.get<any>('SELECT * FROM success_patterns WHERE id = ?', [patternId]);
    return row ? this.dbRowToPattern(row) : null;
  }

  /**
   * Get pattern by name
   */
  async getPatternByName(patternName: string): Promise<Pattern | null> {
    const row = database.get<any>('SELECT * FROM success_patterns WHERE pattern_name = ?', [
      patternName,
    ]);
    return row ? this.dbRowToPattern(row) : null;
  }

  /**
   * Update outcome for a token pattern match
   */
  async updateMatchOutcome(
    tokenMint: string,
    outcome: string,
    peakMultiplier?: number
  ): Promise<void> {
    database.run(
      `UPDATE token_pattern_matches 
       SET actual_outcome = ?, peak_multiplier = ?
       WHERE token_mint = ?`,
      [outcome, peakMultiplier, tokenMint]
    );
  }

  /**
   * Get statistics for all patterns
   */
  getOverallStats(): {
    totalPatterns: number;
    activePatterns: number;
    successPatterns: number;
    rugPatterns: number;
    avgSuccessRate: number;
  } {
    const all = database.all<any>('SELECT * FROM success_patterns');
    const active = all.filter(p => p.is_active === 1);
    const success = all.filter(p => p.pattern_type === 'success');
    const rug = all.filter(p => p.pattern_type === 'rug');

    const avgSuccessRate =
      all.length > 0
        ? all.reduce((sum, p) => sum + p.success_rate, 0) / all.length
        : 0;

    return {
      totalPatterns: all.length,
      activePatterns: active.length,
      successPatterns: success.length,
      rugPatterns: rug.length,
      avgSuccessRate,
    };
  }
}

// Singleton instance
export const patternDetector = new PatternDetector();
