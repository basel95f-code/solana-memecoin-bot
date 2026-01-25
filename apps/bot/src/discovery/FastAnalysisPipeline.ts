/**
 * Fast Analysis Pipeline
 * Optimized for speed - analyzes tokens in parallel with caching
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import type { DiscoveredToken } from './interfaces/DiscoveryTypes';

interface AnalysisResult {
  token: DiscoveredToken;
  analysisTimeMs: number;
  riskScore?: number;
  mlPrediction?: number;
  shouldAlert: boolean;
  priority: 'low' | 'normal' | 'high' | 'critical';
}

interface CacheEntry {
  value: any;
  timestamp: number;
}

export class FastAnalysisPipeline extends EventEmitter {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Analyze token with speed optimizations
   */
  async analyzeToken(token: DiscoveredToken): Promise<AnalysisResult> {
    const startTime = Date.now();

    logger.debug('FastAnalysisPipeline', `Analyzing ${token.symbol} (${token.mint})`);

    try {
      // Run parallel analysis
      const [riskScore, mlPrediction, metadata] = await Promise.all([
        this.getCachedOrCompute(`risk:${token.mint}`, () => this.quickRiskScore(token)),
        this.getCachedOrCompute(`ml:${token.mint}`, () => this.quickMLPrediction(token)),
        this.getCachedOrCompute(`meta:${token.mint}`, () => this.quickMetadata(token)),
      ]);

      const analysisTimeMs = Date.now() - startTime;

      // Determine priority and alert
      const { shouldAlert, priority } = this.determinePriority(riskScore, mlPrediction);

      const result: AnalysisResult = {
        token,
        analysisTimeMs,
        riskScore,
        mlPrediction,
        shouldAlert,
        priority,
      };

      logger.info('FastAnalysisPipeline', `Analyzed ${token.symbol} in ${analysisTimeMs}ms - Priority: ${priority}`);

      this.emit('analysis_complete', result);
      return result;

    } catch (error: any) {
      logger.error('FastAnalysisPipeline', `Analysis failed for ${token.mint}:`, error);
      
      // Return minimal result on error
      return {
        token,
        analysisTimeMs: Date.now() - startTime,
        shouldAlert: false,
        priority: 'low',
      };
    }
  }

  /**
   * Quick risk score (optimized version)
   */
  private async quickRiskScore(token: DiscoveredToken): Promise<number> {
    // Simplified risk scoring for speed
    // In real implementation, would check:
    // - Contract safety (mint/freeze authority)
    // - Holder distribution
    // - Liquidity
    
    let score = 50; // Base score

    // Adjust based on available metadata
    if (token.initialLiquidity) {
      if (token.initialLiquidity >= 50000) score += 20;
      else if (token.initialLiquidity >= 10000) score += 10;
      else if (token.initialLiquidity < 1000) score -= 20;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Quick ML prediction (optimized version)
   */
  private async quickMLPrediction(token: DiscoveredToken): Promise<number> {
    // Simplified ML prediction for speed
    // In real implementation, would use lightweight model
    
    // Return rug probability (0-1)
    return 0.3; // Placeholder
  }

  /**
   * Quick metadata fetch
   */
  private async quickMetadata(token: DiscoveredToken): Promise<any> {
    // Fetch token metadata quickly
    // In real implementation, would fetch from on-chain or API
    
    return {
      hasWebsite: false,
      hasTwitter: false,
      hasTelegram: false,
    };
  }

  /**
   * Determine priority and alert flag
   */
  private determinePriority(
    riskScore: number,
    mlPrediction: number
  ): { shouldAlert: boolean; priority: 'low' | 'normal' | 'high' | 'critical' } {
    // Critical: High risk + low rug probability
    if (riskScore >= 70 && mlPrediction < 0.2) {
      return { shouldAlert: true, priority: 'critical' };
    }

    // High: Good risk + low rug probability
    if (riskScore >= 60 && mlPrediction < 0.3) {
      return { shouldAlert: true, priority: 'high' };
    }

    // Normal: Decent risk
    if (riskScore >= 50 && mlPrediction < 0.5) {
      return { shouldAlert: true, priority: 'normal' };
    }

    // Low: Everything else
    return { shouldAlert: false, priority: 'low' };
  }

  /**
   * Get from cache or compute
   */
  private async getCachedOrCompute<T>(
    key: string,
    compute: () => Promise<T>
  ): Promise<T> {
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.value;
    }

    const value = await compute();
    this.cache.set(key, { value, timestamp: now });

    return value;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('FastAnalysisPipeline', 'Cache cleared');
  }

  /**
   * Cleanup old cache entries
   */
  cleanupCache(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= this.CACHE_TTL_MS) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('FastAnalysisPipeline', `Cleaned up ${removed} cache entries`);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      cacheTTL: this.CACHE_TTL_MS,
    };
  }
}
