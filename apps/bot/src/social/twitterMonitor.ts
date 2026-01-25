/**
 * Twitter Monitoring Service
 * Monitor token mentions, track sentiment, and detect trends
 * Uses Twitter API v2 (requires Bearer Token)
 */

import { SupabaseDB } from '../database/supabase-db';
import { sentimentAnalyzer, SentimentResult } from './sentimentAnalyzer';
import { InfluencerTracker } from './influencerTracker';
import { logger } from '../utils/logger';

interface TwitterAPIv2Response {
  data?: Array<{
    id: string;
    text: string;
    author_id: string;
    created_at: string;
    public_metrics: {
      retweet_count: number;
      reply_count: number;
      like_count: number;
      quote_count: number;
    };
    entities?: {
      hashtags?: Array<{ tag: string }>;
      cashtags?: Array<{ tag: string }>;
    };
  }>;
  includes?: {
    users?: Array<{
      id: string;
      username: string;
      name: string;
      public_metrics: {
        followers_count: number;
        following_count: number;
        tweet_count: number;
      };
      verified?: boolean;
    }>;
  };
  meta?: {
    newest_id?: string;
    oldest_id?: string;
    result_count: number;
    next_token?: string;
  };
}

export interface TweetMention {
  tweetId: string;
  tokenMint: string | null;
  symbol: string | null;
  authorId: string;
  authorUsername: string;
  authorFollowers: number;
  text: string;
  mentionsCount: number;
  retweetCount: number;
  likeCount: number;
  replyCount: number;
  sentimentScore: number;
  sentimentLabel: 'positive' | 'negative' | 'neutral';
  hashtags: string[];
  cashtags: string[];
  isInfluencer: boolean;
  createdAt: Date;
}

export interface TrendingToken {
  tokenMint: string | null;
  symbol: string;
  mentions24h: number;
  mentionsGrowth: number; // % change from previous period
  avgSentiment: number;
  influencerMentions: number;
  trendingScore: number;
  topTweet: TweetMention | null;
}

export class TwitterMonitor {
  private bearerToken: string;
  private baseUrl = 'https://api.twitter.com/2';
  private rateLimitRemaining = 450;
  private rateLimitReset = 0;
  private minInfluencerFollowers = 5000;
  
  // Search keywords
  private keywords = [
    '#Solana', '$SOL', '#SolanaNFT', '#solana',
    'pump.fun', 'raydium', 'jupiter',
    'memecoin', 'gem', 'moonshot'
  ];

  constructor(
    private db: SupabaseDB,
    private influencerTracker: InfluencerTracker,
    bearerToken?: string
  ) {
    this.bearerToken = bearerToken || process.env.TWITTER_BEARER_TOKEN || '';
    if (!this.bearerToken) {
      logger.warn('TwitterMonitor', 'No Twitter API token provided - monitoring disabled');
    }
  }

  /**
   * Start monitoring (poll-based for now, can upgrade to Stream API)
   */
  async start(intervalMs: number = 60000): Promise<void> {
    if (!this.bearerToken) {
      logger.warn('TwitterMonitor', 'Cannot start - no API token');
      return;
    }

    logger.info('TwitterMonitor', 'Starting Twitter monitoring...');

    // Initial fetch
    await this.fetchRecentMentions();

    // Set up polling
    setInterval(() => {
      this.fetchRecentMentions();
    }, intervalMs);
  }

  /**
   * Fetch recent tweets mentioning tracked keywords
   */
  async fetchRecentMentions(): Promise<TweetMention[]> {
    try {
      if (!this.checkRateLimit()) {
        logger.warn('TwitterMonitor', 'Rate limit exceeded, waiting...');
        return [];
      }

      // Build search query
      const query = this.keywords.join(' OR ');
      
      const url = `${this.baseUrl}/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=100&tweet.fields=created_at,public_metrics,entities&expansions=author_id&user.fields=username,name,public_metrics,verified`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.bearerToken}`
        }
      });

      this.updateRateLimit(response.headers);

      if (!response.ok) {
        throw new Error(`Twitter API error: ${response.status} ${response.statusText}`);
      }

      const data: TwitterAPIv2Response = await response.json();

      if (!data.data || data.data.length === 0) {
        return [];
      }

      // Process tweets
      const mentions = await this.processTweets(data);
      
      logger.info('TwitterMonitor', `Fetched ${mentions.length} new mentions`);
      
      return mentions;
    } catch (error) {
      logger.error('TwitterMonitor', 'Failed to fetch mentions', error);
      return [];
    }
  }

  /**
   * Process tweets and extract mentions
   */
  private async processTweets(data: TwitterAPIv2Response): Promise<TweetMention[]> {
    const mentions: TweetMention[] = [];
    
    // Create user lookup
    const users = new Map();
    if (data.includes?.users) {
      for (const user of data.includes.users) {
        users.set(user.id, user);
      }
    }

    for (const tweet of data.data || []) {
      const user = users.get(tweet.author_id);
      if (!user) continue;

      // Extract tokens from tweet
      const extracted = sentimentAnalyzer.extractTokens(tweet.text);
      
      // Analyze sentiment
      const sentiment = sentimentAnalyzer.analyze(tweet.text);

      // Check if influencer
      const isInfluencer = user.public_metrics.followers_count >= this.minInfluencerFollowers;

      // Determine token mint/symbol
      let tokenMint: string | null = null;
      let symbol: string | null = null;

      if (extracted.potentialMints.length > 0) {
        tokenMint = extracted.potentialMints[0];
      }
      if (extracted.cashtags.length > 0) {
        symbol = extracted.cashtags[0];
      }

      const mention: TweetMention = {
        tweetId: tweet.id,
        tokenMint,
        symbol,
        authorId: tweet.author_id,
        authorUsername: user.username,
        authorFollowers: user.public_metrics.followers_count,
        text: tweet.text,
        mentionsCount: 1,
        retweetCount: tweet.public_metrics.retweet_count,
        likeCount: tweet.public_metrics.like_count,
        replyCount: tweet.public_metrics.reply_count,
        sentimentScore: sentiment.score,
        sentimentLabel: sentiment.label,
        hashtags: extracted.hashtags,
        cashtags: extracted.cashtags,
        isInfluencer,
        createdAt: new Date(tweet.created_at)
      };

      // Save to database
      await this.saveMention(mention);

      // If influencer, track them and their call
      if (isInfluencer && (tokenMint || symbol)) {
        await this.handleInfluencerMention(mention, user);
      }

      mentions.push(mention);
    }

    return mentions;
  }

  /**
   * Handle influencer mention - track influencer and record call
   */
  private async handleInfluencerMention(mention: TweetMention, user: any): Promise<void> {
    try {
      // Add/update influencer
      await this.influencerTracker.addInfluencer({
        twitterId: mention.authorId,
        username: mention.authorUsername,
        displayName: user.name,
        followersCount: mention.authorFollowers,
        followingCount: user.public_metrics.following_count,
        tweetCount: user.public_metrics.tweet_count,
        verified: user.verified || false,
        isTracked: true // Auto-track influencers
      });

      // Record call if we have a token
      if (mention.tokenMint || mention.symbol) {
        await this.influencerTracker.recordCall({
          twitterId: mention.authorId,
          tweetId: mention.tweetId,
          tokenMint: mention.tokenMint || mention.symbol || '',
          symbol: mention.symbol || undefined,
          tweetText: mention.text,
          calledAt: mention.createdAt
        });

        logger.info('TwitterMonitor', `Influencer call detected: @${mention.authorUsername} mentioned ${mention.symbol || mention.tokenMint}`);
      }
    } catch (error) {
      logger.error('TwitterMonitor', 'Failed to handle influencer mention', error);
    }
  }

  /**
   * Save mention to database
   */
  private async saveMention(mention: TweetMention): Promise<void> {
    try {
      // Check if already exists
      const { data: existing } = await this.db.client
        .from('twitter_mentions')
        .select('id')
        .eq('tweet_id', mention.tweetId)
        .single();

      if (existing) return; // Already saved

      await this.db.client.from('twitter_mentions').insert({
        tweet_id: mention.tweetId,
        token_mint: mention.tokenMint,
        symbol: mention.symbol,
        author_id: mention.authorId,
        author_username: mention.authorUsername,
        author_followers: mention.authorFollowers,
        text: mention.text,
        mentions_count: mention.mentionsCount,
        retweet_count: mention.retweetCount,
        like_count: mention.likeCount,
        reply_count: mention.replyCount,
        sentiment_score: mention.sentimentScore,
        sentiment_label: mention.sentimentLabel,
        hashtags: mention.hashtags,
        cashtags: mention.cashtags,
        is_influencer: mention.isInfluencer,
        created_at: mention.createdAt.toISOString()
      });
    } catch (error) {
      logger.error('TwitterMonitor', 'Failed to save mention', error);
    }
  }

  /**
   * Get trending tokens based on mention volume
   */
  async getTrendingTokens(limit: number = 10): Promise<TrendingToken[]> {
    try {
      // Get mentions from last 24h
      const { data: mentions, error } = await this.db.client
        .from('twitter_mentions')
        .select('*')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .not('symbol', 'is', null);

      if (error) throw error;

      // Group by symbol and calculate metrics
      const grouped = new Map<string, {
        symbol: string;
        tokenMint: string | null;
        mentions: typeof mentions;
      }>();

      for (const m of mentions) {
        if (!m.symbol) continue;
        
        if (!grouped.has(m.symbol)) {
          grouped.set(m.symbol, { symbol: m.symbol, tokenMint: m.token_mint, mentions: [] });
        }
        grouped.get(m.symbol)!.mentions.push(m);
      }

      // Calculate trending scores
      const trending: TrendingToken[] = [];

      for (const [symbol, data] of grouped) {
        const mentions24h = data.mentions.length;
        const avgSentiment = data.mentions.reduce((sum, m) => sum + parseFloat(m.sentiment_score), 0) / mentions24h;
        const influencerMentions = data.mentions.filter(m => m.is_influencer).length;
        
        // Calculate trending score (weighted by mentions, sentiment, influencers)
        const trendingScore = 
          mentions24h * 1.0 +
          (avgSentiment + 1) * 10 + // Normalize -1 to 1 → 0 to 20
          influencerMentions * 5;

        // Get top tweet (highest engagement)
        const topTweet = data.mentions.reduce((best, m) => {
          const score = m.retweet_count * 2 + m.like_count + m.reply_count;
          const bestScore = best.retweet_count * 2 + best.like_count + best.reply_count;
          return score > bestScore ? m : best;
        });

        trending.push({
          tokenMint: data.tokenMint,
          symbol,
          mentions24h,
          mentionsGrowth: 0, // TODO: Calculate from historical data
          avgSentiment,
          influencerMentions,
          trendingScore,
          topTweet: topTweet ? this.mapMention(topTweet) : null
        });
      }

      // Sort by trending score
      trending.sort((a, b) => b.trendingScore - a.trendingScore);

      return trending.slice(0, limit);
    } catch (error) {
      logger.error('TwitterMonitor', 'Failed to get trending tokens', error);
      return [];
    }
  }

  /**
   * Get sentiment data for a specific token
   */
  async getTokenSentiment(tokenMint: string, hours: number = 24): Promise<{
    totalMentions: number;
    avgSentiment: number;
    sentimentLabel: string;
    distribution: { positive: number; negative: number; neutral: number };
    influencerMentions: number;
    recentMentions: TweetMention[];
  }> {
    try {
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

      const { data: mentions, error } = await this.db.client
        .from('twitter_mentions')
        .select('*')
        .eq('token_mint', tokenMint)
        .gte('created_at', cutoff.toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;

      const totalMentions = mentions.length;
      const avgSentiment = mentions.length > 0
        ? mentions.reduce((sum, m) => sum + parseFloat(m.sentiment_score), 0) / mentions.length
        : 0;

      const distribution = {
        positive: mentions.filter(m => m.sentiment_label === 'positive').length,
        negative: mentions.filter(m => m.sentiment_label === 'negative').length,
        neutral: mentions.filter(m => m.sentiment_label === 'neutral').length
      };

      const influencerMentions = mentions.filter(m => m.is_influencer).length;

      const sentimentLabel = avgSentiment > 0.2 ? 'Bullish' : 
                            avgSentiment < -0.2 ? 'Bearish' : 'Neutral';

      return {
        totalMentions,
        avgSentiment,
        sentimentLabel,
        distribution,
        influencerMentions,
        recentMentions: mentions.slice(0, 10).map(this.mapMention)
      };
    } catch (error) {
      logger.error('TwitterMonitor', 'Failed to get token sentiment', error);
      return {
        totalMentions: 0,
        avgSentiment: 0,
        sentimentLabel: 'Unknown',
        distribution: { positive: 0, negative: 0, neutral: 0 },
        influencerMentions: 0,
        recentMentions: []
      };
    }
  }

  /**
   * Detect volume spikes (mentions increasing rapidly)
   */
  async detectVolumeSpikes(threshold: number = 5): Promise<TrendingToken[]> {
    // Get trending tokens
    const trending = await this.getTrendingTokens(50);
    
    // Filter for volume spikes
    // TODO: Compare with historical baseline
    return trending.filter(t => t.mentions24h >= threshold * 5);
  }

  // Rate limiting
  private checkRateLimit(): boolean {
    const now = Date.now();
    if (now < this.rateLimitReset) {
      return this.rateLimitRemaining > 0;
    }
    return true;
  }

  private updateRateLimit(headers: Headers): void {
    const remaining = headers.get('x-rate-limit-remaining');
    const reset = headers.get('x-rate-limit-reset');
    
    if (remaining) this.rateLimitRemaining = parseInt(remaining);
    if (reset) this.rateLimitReset = parseInt(reset) * 1000;

    logger.debug('TwitterMonitor', `Rate limit: ${this.rateLimitRemaining} remaining`);
  }

  // Mapping helper
  private mapMention(data: any): TweetMention {
    return {
      tweetId: data.tweet_id,
      tokenMint: data.token_mint,
      symbol: data.symbol,
      authorId: data.author_id,
      authorUsername: data.author_username,
      authorFollowers: data.author_followers,
      text: data.text,
      mentionsCount: data.mentions_count || 1,
      retweetCount: data.retweet_count || 0,
      likeCount: data.like_count || 0,
      replyCount: data.reply_count || 0,
      sentimentScore: parseFloat(data.sentiment_score || 0),
      sentimentLabel: data.sentiment_label || 'neutral',
      hashtags: data.hashtags || [],
      cashtags: data.cashtags || [],
      isInfluencer: data.is_influencer || false,
      createdAt: new Date(data.created_at)
    };
  }
}
