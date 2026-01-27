/**
 * Social Metrics Service
 * 
 * Tracks social media metrics (Twitter, Telegram) to detect
 * growth patterns and community engagement. Helps identify
 * tokens with growing social presence.
 */

import { logger } from '../utils/logger';
import { toError } from '../utils/errors';
import { cacheManager, CacheKey, CacheTTL } from '../cache';
import type { TokenInfo } from '../types';
import { twitterService } from './twitter';

export interface SocialSnapshot {
  tokenMint: string;
  twitterFollowers?: number;
  telegramMembers?: number;
  discordMembers?: number;
  timestamp: number;
}

export interface SocialGrowthMetrics {
  twitterFollowers?: number;
  twitterGrowth24h?: number;
  telegramMembers?: number;
  telegramGrowth24h?: number;
  socialScore: number; // 0 to 1 (composite social growth score)
  lastUpdated: number;
}

// In-memory storage for social metrics history
const socialHistory: Map<string, SocialSnapshot[]> = new Map();
const MAX_HISTORY_DAYS = 7;

export class SocialMetricsService {
  /**
   * Track social metrics for a token
   */
  async trackSocialMetrics(tokenInfo: TokenInfo): Promise<void> {
    const mint = tokenInfo.mint;

    // Try to get Twitter followers if we have a Twitter URL
    let twitterFollowers: number | undefined;
    if (tokenInfo.metadata?.twitter) {
      try {
        const twitterHandle = this.extractTwitterHandle(tokenInfo.metadata.twitter);
        if (twitterHandle) {
          // This would need actual Twitter API integration
          // For now, we'll skip real-time tracking
          logger.debug('SocialMetrics', `Would track Twitter @${twitterHandle} for ${mint}`);
        }
      } catch (error) {
        logger.debug('SocialMetrics', `Failed to get Twitter followers for ${mint}`, error as Error);
      }
    }

    // Try to get Telegram members if we have a Telegram URL
    let telegramMembers: number | undefined;
    if (tokenInfo.metadata?.telegram) {
      try {
        // This would need Telegram API integration
        // For now, we'll skip real-time tracking
        logger.debug('SocialMetrics', `Would track Telegram for ${mint}`);
      } catch (error) {
        logger.debug('SocialMetrics', `Failed to get Telegram members for ${mint}`, error as Error);
      }
    }

    // Create snapshot
    const snapshot: SocialSnapshot = {
      tokenMint: mint,
      twitterFollowers,
      telegramMembers,
      timestamp: Date.now(),
    };

    // Get existing history
    let history = socialHistory.get(mint) || [];
    
    // Only add if metrics have changed or it's been >1h
    const shouldAdd = history.length === 0 || 
      (Date.now() - history[history.length - 1].timestamp > 60 * 60 * 1000);

    if (shouldAdd) {
      history.push(snapshot);

      // Keep only recent data
      const cutoffTime = Date.now() - MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000;
      history = history.filter((s) => s.timestamp > cutoffTime);

      socialHistory.set(mint, history);

      if (twitterFollowers || telegramMembers) {
        logger.debug('SocialMetrics', `Updated social metrics for ${mint}: Twitter=${twitterFollowers || 'N/A'}, Telegram=${telegramMembers || 'N/A'}`);
      }
    }
  }

  /**
   * Get social growth metrics
   */
  async getSocialGrowth(tokenInfo: TokenInfo): Promise<SocialGrowthMetrics | null> {
    const mint = tokenInfo.mint;

    // Check cache first
    const cached = await cacheManager.get<SocialGrowthMetrics>(CacheKey.socialGrowth(mint));
    if (cached) {
      return cached;
    }

    // Track current metrics first
    await this.trackSocialMetrics(tokenInfo);

    const history = socialHistory.get(mint);
    if (!history || history.length < 2) {
      logger.debug('SocialMetrics', `Insufficient social history for ${mint}`);
      
      // Return neutral score if we have no history
      return {
        socialScore: 0.5,
        lastUpdated: Date.now(),
      };
    }

    const latest = history[history.length - 1];

    // Find snapshot ~24 hours ago
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const snapshot24h = history.slice().reverse().find((s) => s.timestamp <= oneDayAgo);

    let twitterGrowth24h: number | undefined;
    if (latest.twitterFollowers !== undefined && snapshot24h?.twitterFollowers !== undefined) {
      twitterGrowth24h = latest.twitterFollowers - snapshot24h.twitterFollowers;
    }

    let telegramGrowth24h: number | undefined;
    if (latest.telegramMembers !== undefined && snapshot24h?.telegramMembers !== undefined) {
      telegramGrowth24h = latest.telegramMembers - snapshot24h.telegramMembers;
    }

    // Calculate composite social score
    let socialScore = 0.5; // Start neutral
    let components = 0;

    // Twitter component
    if (latest.twitterFollowers !== undefined && twitterGrowth24h !== undefined) {
      const growthRate = twitterGrowth24h / Math.max(latest.twitterFollowers, 1);
      if (growthRate > 0.1) {
        socialScore += 0.25; // >10% growth
      } else if (growthRate > 0.05) {
        socialScore += 0.15; // >5% growth
      } else if (growthRate > 0) {
        socialScore += 0.05; // Any growth
      } else if (growthRate < -0.05) {
        socialScore -= 0.1; // Losing followers
      }
      components++;
    }

    // Telegram component
    if (latest.telegramMembers !== undefined && telegramGrowth24h !== undefined) {
      const growthRate = telegramGrowth24h / Math.max(latest.telegramMembers, 1);
      if (growthRate > 0.1) {
        socialScore += 0.25;
      } else if (growthRate > 0.05) {
        socialScore += 0.15;
      } else if (growthRate > 0) {
        socialScore += 0.05;
      } else if (growthRate < -0.05) {
        socialScore -= 0.1;
      }
      components++;
    }

    // Normalize if we have components
    if (components === 0) {
      socialScore = 0.5; // No data = neutral
    } else {
      socialScore = Math.max(0, Math.min(1, socialScore));
    }

    const metrics: SocialGrowthMetrics = {
      twitterFollowers: latest.twitterFollowers,
      twitterGrowth24h,
      telegramMembers: latest.telegramMembers,
      telegramGrowth24h,
      socialScore,
      lastUpdated: latest.timestamp,
    };

    // Cache for 10 minutes
    await cacheManager.set(CacheKey.socialGrowth(mint), metrics, CacheTTL.MEDIUM);

    logger.debug('SocialMetrics', `Social growth for ${mint}: score=${socialScore.toFixed(2)}`);

    return metrics;
  }

  /**
   * Extract Twitter handle from URL
   */
  private extractTwitterHandle(url: string): string | null {
    const match = url.match(/twitter\.com\/([^\/\?]+)/i) || url.match(/x\.com\/([^\/\?]+)/i);
    return match ? match[1] : null;
  }

  /**
   * Get social history for a token (for debugging/analysis)
   */
  getHistory(mint: string): SocialSnapshot[] {
    return socialHistory.get(mint) || [];
  }

  /**
   * Clear old data (cleanup)
   */
  cleanup(): void {
    const cutoffTime = Date.now() - MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000;
    let cleanedCount = 0;

    socialHistory.forEach((history, mint) => {
      const filtered = history.filter((s) => s.timestamp > cutoffTime);
      if (filtered.length === 0) {
        socialHistory.delete(mint);
        cleanedCount++;
      } else if (filtered.length < history.length) {
        socialHistory.set(mint, filtered);
      }
    });

    if (cleanedCount > 0) {
      logger.info('SocialMetrics', `Cleaned up ${cleanedCount} stale social histories`);
    }
  }
}

// Export singleton
export const socialMetricsService = new SocialMetricsService();

// Add to cache key enum
declare module '../cache' {
  interface CacheKeyExtension {
    socialGrowth(mint: string): string;
  }
}

// Extend CacheKey
Object.assign(CacheKey, {
  socialGrowth: (mint: string) => `social:growth:${mint}`,
});
