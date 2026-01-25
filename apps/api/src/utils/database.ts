/**
 * Database integration with bot's Supabase instance
 * Reuses the existing database schema from apps/bot
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger.js';

class BotDatabase {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
    logger.info('Connected to bot database');
  }

  /**
   * Get list of monitored tokens
   */
  async getTokens(options: {
    page?: number;
    limit?: number;
    riskLevel?: string;
    minLiquidity?: number;
  } = {}) {
    const { page = 1, limit = 20, riskLevel, minLiquidity } = options;
    const offset = (page - 1) * limit;

    let query = this.supabase
      .from('token_analysis')
      .select('*', { count: 'exact' });

    if (riskLevel) {
      query = query.eq('risk_level', riskLevel);
    }

    if (minLiquidity) {
      query = query.gte('liquidity_usd', minLiquidity);
    }

    const { data, count, error } = await query
      .order('analyzed_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Failed to get tokens:', error);
      throw error;
    }

    return {
      data: data || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit)
    };
  }

  /**
   * Get token details by mint address
   */
  async getToken(mint: string) {
    const { data, error } = await this.supabase
      .from('token_analysis')
      .select('*')
      .eq('mint', mint)
      .order('analyzed_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // Not found
        return null;
      }
      logger.error('Failed to get token:', error);
      throw error;
    }

    return data;
  }

  /**
   * Get full analysis for a token (including all historical data)
   */
  async getTokenAnalysis(mint: string) {
    const { data, error } = await this.supabase
      .from('token_analysis')
      .select('*')
      .eq('mint', mint)
      .order('analyzed_at', { ascending: false });

    if (error) {
      logger.error('Failed to get token analysis:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Get pattern detection history
   */
  async getPatterns(options: {
    page?: number;
    limit?: number;
    mint?: string;
    minConfidence?: number;
  } = {}) {
    const { page = 1, limit = 20, mint, minConfidence } = options;
    const offset = (page - 1) * limit;

    let query = this.supabase
      .from('ml_predictions')
      .select('*', { count: 'exact' });

    if (mint) {
      query = query.eq('mint', mint);
    }

    if (minConfidence) {
      query = query.gte('confidence', minConfidence);
    }

    const { data, count, error } = await query
      .order('predicted_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Failed to get patterns:', error);
      throw error;
    }

    return {
      data: data || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit)
    };
  }

  /**
   * Get smart money wallets
   */
  async getSmartMoneyWallets(options: { page?: number; limit?: number } = {}) {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const { data, count, error } = await this.supabase
      .from('smart_money_wallets')
      .select('*', { count: 'exact' })
      .order('total_profit_usd', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Failed to get smart money wallets:', error);
      throw error;
    }

    return {
      data: data || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit)
    };
  }

  /**
   * Get smart money wallet details
   */
  async getSmartMoneyWallet(address: string) {
    const { data, error } = await this.supabase
      .from('smart_money_wallets')
      .select('*')
      .eq('address', address)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // Not found
        return null;
      }
      logger.error('Failed to get smart money wallet:', error);
      throw error;
    }

    return data;
  }

  /**
   * Get bot statistics
   */
  async getStats() {
    const [tokensResult, patternsResult, walletsResult] = await Promise.all([
      this.supabase.from('token_analysis').select('*', { count: 'exact', head: true }),
      this.supabase.from('ml_predictions').select('*', { count: 'exact', head: true }),
      this.supabase.from('smart_money_wallets').select('*', { count: 'exact', head: true })
    ]);

    return {
      totalTokens: tokensResult.count || 0,
      totalPatterns: patternsResult.count || 0,
      totalSmartMoney: walletsResult.count || 0
    };
  }
}

export const botDB = new BotDatabase();
