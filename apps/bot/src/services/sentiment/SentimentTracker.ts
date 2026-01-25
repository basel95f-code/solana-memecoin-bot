/**
 * Sentiment Tracker
 * Tracks social sentiment across Twitter, Telegram, Discord
 * Real-time volume, sentiment scoring, and influencer detection
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';

export interface SentimentData {
  tokenMint: string;
  tokenSymbol: string;
  
  // Volume metrics
  totalMentions: number;
  mentions1h: number;
  mentions24h: number;
  mentionGrowth: number;          // % change in last hour
  
  // Sentiment
  sentimentScore: number;         // -1 to +1 (negative to positive)
  bullishMentions: number;
  bearishMentions: number;
  neutralMentions: number;
  
  // By platform
  twitter: PlatformSentiment;
  telegram: PlatformSentiment;
  discord: PlatformSentiment;
  
  // Influencer activity
  influencerMentions: number;
  topInfluencers: InfluencerMention[];
  
  // Trending
  isTrending: boolean;
  trendingRank?: number;
  
  // Confidence
  dataQuality: number;            // 0-1, how reliable is this data
  
  lastUpdate: number;
}

export interface PlatformSentiment {
  mentions: number;
  sentimentScore: number;
  volume24h: number;
  topKeywords: string[];
}

export interface InfluencerMention {
  username: string;
  platform: 'twitter' | 'telegram' | 'discord';
  followers: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  timestamp: number;
  content: string;
}

export interface SentimentAlert {
  type: 'trending' | 'influencer_mention' | 'volume_spike' | 'sentiment_shift';
  tokenMint: string;
  tokenSymbol: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  data: any;
  timestamp: number;
}

export class SentimentTracker extends EventEmitter {
  private sentimentData: Map<string, SentimentData> = new Map();
  private alerts: SentimentAlert[] = [];
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Start sentiment tracking
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    logger.info('SentimentTracker', 'Started sentiment tracking');

    // Update every 5 minutes
    this.updateInterval = setInterval(() => {
      this.updateAllSentiments().catch(error => {
        logger.error('SentimentTracker', 'Update failed:', error);
      });
    }, 5 * 60 * 1000);

    // Initial update
    await this.updateAllSentiments();
  }

  /**
   * Stop tracking
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.isRunning = false;
    logger.info('SentimentTracker', 'Stopped sentiment tracking');
  }

  /**
   * Track sentiment for a token
   */
  async trackToken(tokenMint: string, tokenSymbol: string): Promise<SentimentData> {
    logger.debug('SentimentTracker', `Tracking sentiment for ${tokenSymbol}`);

    // Fetch sentiment from all platforms
    const [twitter, telegram, discord] = await Promise.all([
      this.fetchTwitterSentiment(tokenSymbol),
      this.fetchTelegramSentiment(tokenSymbol),
      this.fetchDiscordSentiment(tokenSymbol),
    ]);

    // Calculate aggregated metrics
    const totalMentions = twitter.mentions + telegram.mentions + discord.mentions;
    const mentions1h = Math.floor(totalMentions * 0.1); // Estimate
    const mentions24h = totalMentions;
    const mentionGrowth = this.calculateGrowth(tokenMint, totalMentions);

    // Aggregate sentiment (weighted by platform reliability)
    const sentimentScore = this.calculateAggregatedSentiment(twitter, telegram, discord);

    // Count bullish/bearish/neutral
    const bullishMentions = Math.floor(totalMentions * Math.max(0, sentimentScore));
    const bearishMentions = Math.floor(totalMentions * Math.max(0, -sentimentScore));
    const neutralMentions = totalMentions - bullishMentions - bearishMentions;

    // Detect influencer mentions
    const topInfluencers = await this.detectInfluencers(tokenSymbol);

    // Check if trending
    const isTrending = this.checkTrending(mentions1h, mentionGrowth);

    // Calculate data quality
    const dataQuality = this.calculateDataQuality(totalMentions, twitter, telegram, discord);

    const sentimentData: SentimentData = {
      tokenMint,
      tokenSymbol,
      totalMentions,
      mentions1h,
      mentions24h,
      mentionGrowth,
      sentimentScore,
      bullishMentions,
      bearishMentions,
      neutralMentions,
      twitter,
      telegram,
      discord,
      influencerMentions: topInfluencers.length,
      topInfluencers,
      isTrending,
      trendingRank: isTrending ? this.calculateTrendingRank(mentions1h) : undefined,
      dataQuality,
      lastUpdate: Date.now(),
    };

    // Store data
    const previousData = this.sentimentData.get(tokenMint);
    this.sentimentData.set(tokenMint, sentimentData);

    // Check for alerts
    this.checkForAlerts(sentimentData, previousData);

    return sentimentData;
  }

  /**
   * Fetch Twitter sentiment
   */
  private async fetchTwitterSentiment(symbol: string): Promise<PlatformSentiment> {
    // In real implementation, would use Twitter API
    // Placeholder implementation
    return {
      mentions: Math.floor(Math.random() * 1000),
      sentimentScore: (Math.random() - 0.5) * 2,
      volume24h: Math.floor(Math.random() * 10000),
      topKeywords: ['moon', 'gem', 'bullish'],
    };
  }

  /**
   * Fetch Telegram sentiment
   */
  private async fetchTelegramSentiment(symbol: string): Promise<PlatformSentiment> {
    // Placeholder
    return {
      mentions: Math.floor(Math.random() * 500),
      sentimentScore: (Math.random() - 0.5) * 2,
      volume24h: Math.floor(Math.random() * 5000),
      topKeywords: ['buy', 'hold', 'lfg'],
    };
  }

  /**
   * Fetch Discord sentiment
   */
  private async fetchDiscordSentiment(symbol: string): Promise<PlatformSentiment> {
    // Placeholder
    return {
      mentions: Math.floor(Math.random() * 300),
      sentimentScore: (Math.random() - 0.5) * 2,
      volume24h: Math.floor(Math.random() * 3000),
      topKeywords: ['degen', 'pump', 'hodl'],
    };
  }

  /**
   * Calculate aggregated sentiment
   */
  private calculateAggregatedSentiment(
    twitter: PlatformSentiment,
    telegram: PlatformSentiment,
    discord: PlatformSentiment
  ): number {
    // Weighted average (Twitter 40%, Telegram 35%, Discord 25%)
    const weights = { twitter: 0.4, telegram: 0.35, discord: 0.25 };
    
    return (
      twitter.sentimentScore * weights.twitter +
      telegram.sentimentScore * weights.telegram +
      discord.sentimentScore * weights.discord
    );
  }

  /**
   * Calculate mention growth
   */
  private calculateGrowth(tokenMint: string, currentMentions: number): number {
    const previous = this.sentimentData.get(tokenMint);
    if (!previous) return 0;

    const previousMentions = previous.mentions1h || 1;
    return ((currentMentions - previousMentions) / previousMentions) * 100;
  }

  /**
   * Detect influencer mentions
   */
  private async detectInfluencers(symbol: string): Promise<InfluencerMention[]> {
    // In real implementation, would check influencer accounts
    // Placeholder
    return [];
  }

  /**
   * Check if trending
   */
  private checkTrending(mentions1h: number, mentionGrowth: number): boolean {
    return mentions1h > 100 && mentionGrowth > 200; // 100+ mentions + 200% growth
  }

  /**
   * Calculate trending rank
   */
  private calculateTrendingRank(mentions1h: number): number {
    // Placeholder: rank based on mention volume
    return Math.max(1, Math.floor(1000 / mentions1h));
  }

  /**
   * Calculate data quality
   */
  private calculateDataQuality(
    totalMentions: number,
    twitter: PlatformSentiment,
    telegram: PlatformSentiment,
    discord: PlatformSentiment
  ): number {
    // Quality based on:
    // 1. Total mention volume (more = better)
    // 2. Cross-platform consistency

    const volumeScore = Math.min(1, totalMentions / 1000);
    
    // Consistency: are sentiments aligned across platforms?
    const sentiments = [twitter.sentimentScore, telegram.sentimentScore, discord.sentimentScore];
    const avgSentiment = sentiments.reduce((a, b) => a + b, 0) / 3;
    const variance = sentiments.reduce((sum, s) => sum + Math.pow(s - avgSentiment, 2), 0) / 3;
    const consistencyScore = Math.max(0, 1 - variance);

    return (volumeScore * 0.6 + consistencyScore * 0.4);
  }

  /**
   * Check for alerts
   */
  private checkForAlerts(current: SentimentData, previous?: SentimentData): void {
    // Trending alert
    if (current.isTrending && (!previous || !previous.isTrending)) {
      this.createAlert({
        type: 'trending',
        tokenMint: current.tokenMint,
        tokenSymbol: current.tokenSymbol,
        severity: 'high',
        message: `${current.tokenSymbol} is trending! ${current.totalMentions} mentions`,
        data: { mentions: current.totalMentions, rank: current.trendingRank },
        timestamp: Date.now(),
      });
    }

    // Volume spike alert
    if (current.mentionGrowth > 300) {
      this.createAlert({
        type: 'volume_spike',
        tokenMint: current.tokenMint,
        tokenSymbol: current.tokenSymbol,
        severity: 'high',
        message: `${current.tokenSymbol} volume spike: +${current.mentionGrowth.toFixed(0)}%`,
        data: { growth: current.mentionGrowth },
        timestamp: Date.now(),
      });
    }

    // Influencer mention alert
    if (current.influencerMentions > 0) {
      const topInfluencer = current.topInfluencers[0];
      this.createAlert({
        type: 'influencer_mention',
        tokenMint: current.tokenMint,
        tokenSymbol: current.tokenSymbol,
        severity: 'critical',
        message: `Influencer @${topInfluencer.username} mentioned ${current.tokenSymbol}`,
        data: { influencer: topInfluencer },
        timestamp: Date.now(),
      });
    }

    // Sentiment shift alert
    if (previous) {
      const sentimentChange = current.sentimentScore - previous.sentimentScore;
      if (Math.abs(sentimentChange) > 0.5) {
        this.createAlert({
          type: 'sentiment_shift',
          tokenMint: current.tokenMint,
          tokenSymbol: current.tokenSymbol,
          severity: 'medium',
          message: `${current.tokenSymbol} sentiment ${sentimentChange > 0 ? 'bullish' : 'bearish'} shift`,
          data: { change: sentimentChange },
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Create alert
   */
  private createAlert(alert: SentimentAlert): void {
    this.alerts.push(alert);
    this.emit('sentiment_alert', alert);
    logger.info('SentimentTracker', `Alert: ${alert.type} for ${alert.tokenSymbol}`);
  }

  /**
   * Update all tracked tokens
   */
  private async updateAllSentiments(): Promise<void> {
    const tokens = Array.from(this.sentimentData.keys());
    
    for (const tokenMint of tokens) {
      const data = this.sentimentData.get(tokenMint)!;
      await this.trackToken(tokenMint, data.tokenSymbol);
    }
  }

  /**
   * Get sentiment data
   */
  getSentiment(tokenMint: string): SentimentData | undefined {
    return this.sentimentData.get(tokenMint);
  }

  /**
   * Get trending tokens
   */
  getTrendingTokens(): SentimentData[] {
    return Array.from(this.sentimentData.values())
      .filter(d => d.isTrending)
      .sort((a, b) => (a.trendingRank || 999) - (b.trendingRank || 999));
  }

  /**
   * Get recent alerts
   */
  getAlerts(limit: number = 20): SentimentAlert[] {
    return this.alerts.slice(-limit);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalTokensTracked: this.sentimentData.size,
      trendingCount: this.getTrendingTokens().length,
      totalAlerts: this.alerts.length,
      avgSentiment: Array.from(this.sentimentData.values())
        .reduce((sum, d) => sum + d.sentimentScore, 0) / (this.sentimentData.size || 1),
    };
  }
}
