/**
 * Influencer Tracking System
 * Track Twitter KOLs (Key Opinion Leaders) and their token calls
 */

import { SupabaseDB } from '../database/supabase-db';
import { sentimentAnalyzer } from './sentimentAnalyzer';
import { logger } from '../utils/logger';

export interface Influencer {
  id: number;
  twitterId: string;
  username: string;
  displayName: string | null;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  verified: boolean;
  isTracked: boolean;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  avgReturnPercent: number;
  successRate: number;
  lastTweetAt: Date | null;
  discoveredAt: Date | null;
  addedAt: Date;
}

export interface InfluencerCall {
  id: number;
  influencerId: number;
  twitterId: string;
  tweetId: string;
  tokenMint: string;
  symbol: string | null;
  callType: 'buy' | 'sell' | 'hold' | 'moon' | 'warning';
  initialPrice: number | null;
  currentPrice: number | null;
  maxPrice: number | null;
  priceChangePercent: number;
  maxGainPercent: number;
  outcome: 'success' | 'fail' | 'pending' | null;
  outcomeDeterminedAt: Date | null;
  sentimentScore: number;
  tweetText: string | null;
  calledAt: Date;
}

export interface InfluencerStats {
  influencer: Influencer;
  recentCalls: InfluencerCall[];
  performance: {
    totalCalls: number;
    successRate: number;
    avgReturn: number;
    bestCall: InfluencerCall | null;
    worstCall: InfluencerCall | null;
  };
}

export class InfluencerTracker {
  constructor(private db: SupabaseDB) {}

  /**
   * Add or update an influencer
   */
  async addInfluencer(data: {
    twitterId: string;
    username: string;
    displayName?: string;
    followersCount: number;
    followingCount?: number;
    tweetCount?: number;
    verified?: boolean;
    isTracked?: boolean;
  }): Promise<Influencer> {
    try {
      const { data: existing, error: fetchError } = await this.db.client
        .from('influencers')
        .select('*')
        .eq('twitter_id', data.twitterId)
        .single();

      if (existing) {
        // Update existing
        const { data: updated, error: updateError } = await this.db.client
          .from('influencers')
          .update({
            username: data.username,
            display_name: data.displayName || existing.display_name,
            followers_count: data.followersCount,
            following_count: data.followingCount || existing.following_count,
            tweet_count: data.tweetCount || existing.tweet_count,
            verified: data.verified ?? existing.verified,
            is_tracked: data.isTracked ?? existing.is_tracked,
            last_updated_at: new Date().toISOString()
          })
          .eq('twitter_id', data.twitterId)
          .select()
          .single();

        if (updateError) throw updateError;
        return this.mapInfluencer(updated);
      }

      // Insert new
      const { data: inserted, error: insertError } = await this.db.client
        .from('influencers')
        .insert({
          twitter_id: data.twitterId,
          username: data.username,
          display_name: data.displayName,
          followers_count: data.followersCount,
          following_count: data.followingCount || 0,
          tweet_count: data.tweetCount || 0,
          verified: data.verified || false,
          is_tracked: data.isTracked || false,
          discovered_at: new Date().toISOString()
        })
        .select()
        .single();

      if (insertError) throw insertError;
      return this.mapInfluencer(inserted);
    } catch (error) {
      logger.error('InfluencerTracker', 'Failed to add influencer', error);
      throw error;
    }
  }

  /**
   * Record an influencer's token call
   */
  async recordCall(data: {
    twitterId: string;
    tweetId: string;
    tokenMint: string;
    symbol?: string;
    callType?: 'buy' | 'sell' | 'hold' | 'moon' | 'warning';
    initialPrice?: number;
    tweetText: string;
    calledAt: Date;
  }): Promise<InfluencerCall> {
    try {
      // Get or create influencer
      const { data: influencer, error: influencerError } = await this.db.client
        .from('influencers')
        .select('id')
        .eq('twitter_id', data.twitterId)
        .single();

      if (influencerError) {
        throw new Error(`Influencer not found: ${data.twitterId}`);
      }

      // Analyze sentiment to determine call type
      const sentiment = sentimentAnalyzer.analyze(data.tweetText);
      let callType = data.callType;
      
      if (!callType) {
        if (sentiment.score > 0.3) callType = 'buy';
        else if (sentiment.score < -0.3) callType = 'sell';
        else callType = 'hold';
      }

      // Check for moon/warning keywords
      const lowerText = data.tweetText.toLowerCase();
      if (lowerText.includes('moon') || lowerText.includes('🚀')) {
        callType = 'moon';
      } else if (lowerText.includes('warning') || lowerText.includes('scam') || lowerText.includes('rug')) {
        callType = 'warning';
      }

      const { data: call, error: callError } = await this.db.client
        .from('influencer_calls')
        .insert({
          influencer_id: influencer.id,
          twitter_id: data.twitterId,
          tweet_id: data.tweetId,
          token_mint: data.tokenMint,
          symbol: data.symbol,
          call_type: callType,
          initial_price: data.initialPrice,
          sentiment_score: sentiment.score,
          tweet_text: data.tweetText,
          called_at: data.calledAt.toISOString()
        })
        .select()
        .single();

      if (callError) throw callError;

      logger.info('InfluencerTracker', `Recorded ${callType} call for ${data.symbol || data.tokenMint} by @${data.twitterId}`);

      return this.mapCall(call);
    } catch (error) {
      logger.error('InfluencerTracker', 'Failed to record call', error);
      throw error;
    }
  }

  /**
   * Update call outcome based on price performance
   */
  async updateCallOutcome(
    tweetId: string,
    currentPrice: number,
    maxPrice?: number
  ): Promise<void> {
    try {
      const { data: call, error: fetchError } = await this.db.client
        .from('influencer_calls')
        .select('*')
        .eq('tweet_id', tweetId)
        .single();

      if (fetchError || !call) return;

      const initialPrice = call.initial_price;
      if (!initialPrice) return;

      const priceChangePercent = ((currentPrice - initialPrice) / initialPrice) * 100;
      const maxGainPercent = maxPrice 
        ? ((maxPrice - initialPrice) / initialPrice) * 100
        : priceChangePercent;

      // Determine outcome based on call type and performance
      let outcome: 'success' | 'fail' | 'pending' = 'pending';
      
      if (call.call_type === 'buy' || call.call_type === 'moon') {
        if (maxGainPercent >= 50) outcome = 'success';
        else if (priceChangePercent < -30) outcome = 'fail';
      } else if (call.call_type === 'sell' || call.call_type === 'warning') {
        if (priceChangePercent < -30) outcome = 'success';
        else if (priceChangePercent > 50) outcome = 'fail';
      }

      // Only update if outcome is determined
      if (outcome !== 'pending' && !call.outcome) {
        await this.db.client
          .from('influencer_calls')
          .update({
            current_price: currentPrice,
            max_price: maxPrice || Math.max(currentPrice, call.max_price || 0),
            price_change_percent: priceChangePercent,
            max_gain_percent: maxGainPercent,
            outcome,
            outcome_determined_at: new Date().toISOString()
          })
          .eq('tweet_id', tweetId);

        logger.info('InfluencerTracker', `Call outcome updated: ${outcome} (${priceChangePercent.toFixed(1)}%)`);
      } else {
        // Just update prices
        await this.db.client
          .from('influencer_calls')
          .update({
            current_price: currentPrice,
            max_price: maxPrice || Math.max(currentPrice, call.max_price || 0),
            price_change_percent: priceChangePercent,
            max_gain_percent: maxGainPercent
          })
          .eq('tweet_id', tweetId);
      }
    } catch (error) {
      logger.error('InfluencerTracker', 'Failed to update call outcome', error);
    }
  }

  /**
   * Get tracked influencers
   */
  async getTrackedInfluencers(): Promise<Influencer[]> {
    try {
      const { data, error } = await this.db.client
        .from('influencers')
        .select('*')
        .eq('is_tracked', true)
        .order('success_rate', { ascending: false });

      if (error) throw error;
      return data.map(this.mapInfluencer);
    } catch (error) {
      logger.error('InfluencerTracker', 'Failed to get tracked influencers', error);
      return [];
    }
  }

  /**
   * Get influencer stats with recent calls
   */
  async getInfluencerStats(twitterId: string): Promise<InfluencerStats | null> {
    try {
      const { data: influencer, error: influencerError } = await this.db.client
        .from('influencers')
        .select('*')
        .eq('twitter_id', twitterId)
        .single();

      if (influencerError || !influencer) return null;

      const { data: calls, error: callsError } = await this.db.client
        .from('influencer_calls')
        .select('*')
        .eq('influencer_id', influencer.id)
        .order('called_at', { ascending: false })
        .limit(20);

      if (callsError) throw callsError;

      const recentCalls = calls.map(this.mapCall);
      const completedCalls = recentCalls.filter(c => c.outcome !== null && c.outcome !== 'pending');
      
      const bestCall = completedCalls.length > 0
        ? completedCalls.reduce((best, call) => 
            call.maxGainPercent > best.maxGainPercent ? call : best
          )
        : null;

      const worstCall = completedCalls.length > 0
        ? completedCalls.reduce((worst, call) => 
            call.priceChangePercent < worst.priceChangePercent ? call : worst
          )
        : null;

      return {
        influencer: this.mapInfluencer(influencer),
        recentCalls,
        performance: {
          totalCalls: influencer.total_calls || 0,
          successRate: influencer.success_rate || 0,
          avgReturn: influencer.avg_return_percent || 0,
          bestCall,
          worstCall
        }
      };
    } catch (error) {
      logger.error('InfluencerTracker', 'Failed to get influencer stats', error);
      return null;
    }
  }

  /**
   * Get top performing influencers
   */
  async getTopInfluencers(limit: number = 10): Promise<Influencer[]> {
    try {
      const { data, error } = await this.db.client
        .from('influencers')
        .select('*')
        .gte('total_calls', 5) // At least 5 calls
        .order('success_rate', { ascending: false })
        .order('followers_count', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data.map(this.mapInfluencer);
    } catch (error) {
      logger.error('InfluencerTracker', 'Failed to get top influencers', error);
      return [];
    }
  }

  /**
   * Auto-discover influencers from high-engagement tweets
   */
  async discoverInfluencers(minFollowers: number = 10000): Promise<Influencer[]> {
    try {
      // Get authors with high engagement who aren't tracked yet
      const { data, error } = await this.db.client
        .from('twitter_mentions')
        .select('author_id, author_username, author_followers')
        .gte('author_followers', minFollowers)
        .eq('is_influencer', false)
        .order('author_followers', { ascending: false })
        .limit(50);

      if (error) throw error;

      const discovered: Influencer[] = [];
      const seen = new Set<string>();

      for (const mention of data) {
        if (seen.has(mention.author_id)) continue;
        seen.add(mention.author_id);

        const influencer = await this.addInfluencer({
          twitterId: mention.author_id,
          username: mention.author_username,
          followersCount: mention.author_followers,
          isTracked: false
        });

        discovered.push(influencer);
      }

      logger.info('InfluencerTracker', `Discovered ${discovered.length} potential influencers`);
      return discovered;
    } catch (error) {
      logger.error('InfluencerTracker', 'Failed to discover influencers', error);
      return [];
    }
  }

  /**
   * Get pending calls (calls without outcome yet)
   */
  async getPendingCalls(maxAge: number = 7): Promise<InfluencerCall[]> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - maxAge);

      const { data, error } = await this.db.client
        .from('influencer_calls')
        .select('*')
        .is('outcome', null)
        .gte('called_at', cutoff.toISOString())
        .order('called_at', { ascending: false });

      if (error) throw error;
      return data.map(this.mapCall);
    } catch (error) {
      logger.error('InfluencerTracker', 'Failed to get pending calls', error);
      return [];
    }
  }

  // Mapping helpers
  private mapInfluencer(data: any): Influencer {
    return {
      id: data.id,
      twitterId: data.twitter_id,
      username: data.username,
      displayName: data.display_name,
      followersCount: data.followers_count || 0,
      followingCount: data.following_count || 0,
      tweetCount: data.tweet_count || 0,
      verified: data.verified || false,
      isTracked: data.is_tracked || false,
      totalCalls: data.total_calls || 0,
      successfulCalls: data.successful_calls || 0,
      failedCalls: data.failed_calls || 0,
      avgReturnPercent: parseFloat(data.avg_return_percent || 0),
      successRate: parseFloat(data.success_rate || 0),
      lastTweetAt: data.last_tweet_at ? new Date(data.last_tweet_at) : null,
      discoveredAt: data.discovered_at ? new Date(data.discovered_at) : null,
      addedAt: new Date(data.added_at)
    };
  }

  private mapCall(data: any): InfluencerCall {
    return {
      id: data.id,
      influencerId: data.influencer_id,
      twitterId: data.twitter_id,
      tweetId: data.tweet_id,
      tokenMint: data.token_mint,
      symbol: data.symbol,
      callType: data.call_type,
      initialPrice: data.initial_price ? parseFloat(data.initial_price) : null,
      currentPrice: data.current_price ? parseFloat(data.current_price) : null,
      maxPrice: data.max_price ? parseFloat(data.max_price) : null,
      priceChangePercent: parseFloat(data.price_change_percent || 0),
      maxGainPercent: parseFloat(data.max_gain_percent || 0),
      outcome: data.outcome,
      outcomeDeterminedAt: data.outcome_determined_at ? new Date(data.outcome_determined_at) : null,
      sentimentScore: parseFloat(data.sentiment_score || 0),
      tweetText: data.tweet_text,
      calledAt: new Date(data.called_at)
    };
  }
}
