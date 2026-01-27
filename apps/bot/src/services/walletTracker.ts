/**
 * Wallet Tracker Service
 * Manages tracked wallets and their performance metrics
 */

import { getSupabaseClient } from '../database/supabase';

const supabase = getSupabaseClient();
import { logger } from '../utils/logger';
import { Connection, PublicKey } from '@solana/web3.js';
import { solanaService } from './solana';

// ============================================
// Types
// ============================================

export interface TrackedWallet {
  id: number;
  wallet_address: string;
  label: string | null;
  source: 'manual' | 'auto_discovered' | 'smart_money';
  added_by_user_id: number | null;
  added_by_username: string | null;
  score: number;
  win_rate: number;
  total_profit_sol: number;
  total_trades: number;
  is_active: boolean;
  last_checked_at: Date | null;
  added_at: Date;
  updated_at: Date;
}

export interface WalletTransaction {
  id: number;
  signature: string;
  wallet_address: string;
  token_mint: string;
  token_symbol: string | null;
  token_name: string | null;
  action: 'buy' | 'sell' | 'transfer_in' | 'transfer_out' | 'swap';
  amount: number;
  price_usd: number | null;
  value_sol: number | null;
  value_usd: number | null;
  dex_protocol: string | null;
  pool_address: string | null;
  cost_basis_usd: number | null;
  profit_usd: number | null;
  profit_percent: number | null;
  hold_duration_hours: number | null;
  block_time: Date;
  slot: number;
  fee_sol: number | null;
  alert_sent: boolean;
  alert_sent_at: Date | null;
  detected_at: Date;
}

export interface WalletPerformance {
  id: number;
  wallet_address: string;
  total_trades: number;
  total_buys: number;
  total_sells: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_profit_sol: number;
  total_profit_usd: number;
  average_profit_percent: number;
  largest_win_percent: number;
  largest_loss_percent: number;
  average_hold_time_hours: number;
  median_hold_time_hours: number;
  early_entry_rate: number;
  average_entry_timing_minutes: number;
  total_volume_sol: number;
  total_volume_usd: number;
  average_position_size_sol: number;
  active_days: number;
  trades_per_day: number;
  favorite_tokens: any;
  favorite_dexes: any;
  max_drawdown_percent: number;
  sharpe_ratio: number | null;
  reputation_score: number;
  first_trade_at: Date | null;
  last_trade_at: Date | null;
  last_updated_at: Date;
}

export interface WalletDiscovery {
  id: number;
  wallet_address: string;
  discovered_from_token: string | null;
  discovery_reason: string | null;
  initial_score: number;
  estimated_profit_sol: number | null;
  estimated_win_rate: number | null;
  status: 'pending' | 'analyzing' | 'approved' | 'rejected' | 'tracked';
  analysis_notes: string | null;
  discovered_at: Date;
  analyzed_at: Date | null;
  decision_at: Date | null;
}

export interface AddWalletOptions {
  label?: string;
  userId?: number;
  username?: string;
  source?: 'manual' | 'auto_discovered' | 'smart_money';
}

export interface WalletStats {
  wallet: TrackedWallet;
  performance: WalletPerformance | null;
  recentTransactions: WalletTransaction[];
  summary: {
    isProfiTable: boolean;
    riskLevel: 'low' | 'medium' | 'high';
    tradingStyle: 'scalper' | 'swing' | 'holder';
    recommendation: string;
  };
}

// ============================================
// Wallet Tracker Service
// ============================================

export class WalletTracker {
  private connection: Connection;

  constructor() {
    this.connection = solanaService.getConnection();
  }

  // ============================================
  // Wallet Management
  // ============================================

  /**
   * Add a wallet to tracking list
   */
  async trackWallet(
    address: string,
    options: AddWalletOptions = {}
  ): Promise<TrackedWallet> {
    try {
      // Validate address
      try {
        new PublicKey(address);
      } catch {
        throw new Error('Invalid Solana address');
      }

      // Check if already tracked
      const existing = await this.getTrackedWallet(address);
      if (existing) {
        // Reactivate if inactive
        if (!existing.is_active) {
          const { data, error } = await supabase
            .from('tracked_wallets')
            .update({ is_active: true, updated_at: new Date().toISOString() })
            .eq('wallet_address', address)
            .select()
            .single();

          if (error) throw error;
          logger.info('WalletTracker', `Reactivated wallet: ${address.slice(0, 8)}...`);
          return data;
        }
        
        logger.warn('WalletTracker', `Wallet already tracked: ${address.slice(0, 8)}...`);
        return existing;
      }

      // Add to tracking
      const { data, error } = await supabase
        .from('tracked_wallets')
        .insert({
          wallet_address: address,
          label: options.label || null,
          source: options.source || 'manual',
          added_by_user_id: options.userId || null,
          added_by_username: options.username || null,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;

      // Initialize performance record
      await this.initializePerformance(address);

      logger.info('WalletTracker', `Started tracking wallet: ${address.slice(0, 8)}... (${options.label || 'no label'})`);

      return data;
    } catch (error) {
      logger.error('WalletTracker', 'Failed to track wallet', error as Error);
      throw error;
    }
  }

  /**
   * Remove wallet from tracking list
   */
  async untrackWallet(address: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('tracked_wallets')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('wallet_address', address);

      if (error) throw error;

      logger.info('WalletTracker', `Stopped tracking wallet: ${address.slice(0, 8)}...`);
    } catch (error) {
      logger.error('WalletTracker', 'Failed to untrack wallet', error as Error);
      throw error;
    }
  }

  /**
   * Get a specific tracked wallet
   */
  async getTrackedWallet(address: string): Promise<TrackedWallet | null> {
    try {
      const { data, error } = await supabase
        .from('tracked_wallets')
        .select('*')
        .eq('wallet_address', address)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('WalletTracker', 'Failed to get tracked wallet', error as Error);
      return null;
    }
  }

  /**
   * Get all tracked wallets
   */
  async getAllTrackedWallets(activeOnly = true): Promise<TrackedWallet[]> {
    try {
      let query = supabase
        .from('tracked_wallets')
        .select('*')
        .order('score', { ascending: false });

      if (activeOnly) {
        query = query.eq('is_active', true);
      }

      const { data, error } = await query;

      if (error) throw error;

      return data || [];
    } catch (error) {
      logger.error('WalletTracker', 'Failed to get tracked wallets', error as Error);
      return [];
    }
  }

  /**
   * Get top performing wallets
   */
  async getTopWallets(limit = 10): Promise<TrackedWallet[]> {
    try {
      const { data, error } = await supabase
        .from('tracked_wallets')
        .select('*')
        .eq('is_active', true)
        .gte('total_trades', 5)
        .order('score', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return data || [];
    } catch (error) {
      logger.error('WalletTracker', 'Failed to get top wallets', error as Error);
      return [];
    }
  }

  /**
   * Update wallet metadata (label, etc.)
   */
  async updateWallet(
    address: string,
    updates: Partial<Pick<TrackedWallet, 'label' | 'is_active'>>
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('tracked_wallets')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('wallet_address', address);

      if (error) throw error;

      logger.info('WalletTracker', `Updated wallet: ${address.slice(0, 8)}...`);
    } catch (error) {
      logger.error('WalletTracker', 'Failed to update wallet', error as Error);
      throw error;
    }
  }

  // ============================================
  // Performance Management
  // ============================================

  /**
   * Initialize performance record for a wallet
   */
  private async initializePerformance(address: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('wallet_performance')
        .insert({
          wallet_address: address,
          reputation_score: 50, // Start at neutral
        });

      if (error && error.code !== '23505') { // Ignore duplicate key error
        throw error;
      }
    } catch (error) {
      logger.silentError('WalletTracker', 'Failed to initialize performance', error as Error);
    }
  }

  /**
   * Get wallet performance metrics
   */
  async getPerformance(address: string): Promise<WalletPerformance | null> {
    try {
      const { data, error } = await supabase
        .from('wallet_performance')
        .select('*')
        .eq('wallet_address', address)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('WalletTracker', 'Failed to get performance', error as Error);
      return null;
    }
  }

  /**
   * Recalculate and update wallet performance metrics
   */
  async updatePerformance(address: string): Promise<void> {
    try {
      // Get all transactions for this wallet
      const { data: transactions, error: txError } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('wallet_address', address)
        .order('block_time', { ascending: true });

      if (txError) throw txError;

      if (!transactions || transactions.length === 0) {
        logger.debug('WalletTracker', `No transactions found for ${address.slice(0, 8)}...`);
        return;
      }

      // Calculate metrics
      const metrics = this.calculatePerformanceMetrics(transactions);

      // Update performance record
      const { error: updateError } = await supabase
        .from('wallet_performance')
        .upsert({
          wallet_address: address,
          ...metrics,
          last_updated_at: new Date().toISOString(),
        });

      if (updateError) throw updateError;

      // Update tracked_wallets summary fields
      const { error: walletError } = await supabase
        .from('tracked_wallets')
        .update({
          score: metrics.reputation_score,
          win_rate: metrics.win_rate,
          total_profit_sol: metrics.total_profit_sol,
          total_trades: metrics.total_trades,
          updated_at: new Date().toISOString(),
        })
        .eq('wallet_address', address);

      if (walletError) throw walletError;

      logger.debug('WalletTracker', `Updated performance for ${address.slice(0, 8)}...`);
    } catch (error) {
      logger.error('WalletTracker', 'Failed to update performance', error as Error);
    }
  }

  /**
   * Calculate performance metrics from transactions
   */
  private calculatePerformanceMetrics(transactions: any[]): Partial<WalletPerformance> {
    const buys = transactions.filter(t => t.action === 'buy');
    const sells = transactions.filter(t => t.action === 'sell');

    // Basic counts
    const total_trades = transactions.length;
    const total_buys = buys.length;
    const total_sells = sells.length;

    // Profit calculations
    const profitableSells = sells.filter(t => (t.profit_percent || 0) > 0);
    const losingSells = sells.filter(t => (t.profit_percent || 0) <= 0);
    const winning_trades = profitableSells.length;
    const losing_trades = losingSells.length;
    const win_rate = sells.length > 0 ? (winning_trades / sells.length) * 100 : 0;

    const total_profit_sol = sells.reduce((sum, t) => sum + (t.profit_usd || 0) / 100, 0); // Rough estimate
    const total_profit_usd = sells.reduce((sum, t) => sum + (t.profit_usd || 0), 0);

    const profits = profitableSells.map(t => t.profit_percent || 0);
    const losses = losingSells.map(t => t.profit_percent || 0);

    const average_profit_percent = sells.length > 0
      ? sells.reduce((sum, t) => sum + (t.profit_percent || 0), 0) / sells.length
      : 0;

    const largest_win_percent = profits.length > 0 ? Math.max(...profits) : 0;
    const largest_loss_percent = losses.length > 0 ? Math.min(...losses) : 0;

    // Hold time calculations
    const holdTimes = sells.filter(t => t.hold_duration_hours).map(t => t.hold_duration_hours!);
    const average_hold_time_hours = holdTimes.length > 0
      ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length
      : 0;

    const sortedHoldTimes = [...holdTimes].sort((a, b) => a - b);
    const median_hold_time_hours = sortedHoldTimes.length > 0
      ? sortedHoldTimes[Math.floor(sortedHoldTimes.length / 2)]
      : 0;

    // Volume calculations
    const total_volume_sol = transactions.reduce((sum, t) => sum + (t.value_sol || 0), 0);
    const total_volume_usd = transactions.reduce((sum, t) => sum + (t.value_usd || 0), 0);
    const average_position_size_sol = buys.length > 0
      ? buys.reduce((sum, t) => sum + (t.value_sol || 0), 0) / buys.length
      : 0;

    // Activity metrics
    const uniqueDays = new Set(
      transactions.map(t => new Date(t.block_time).toISOString().split('T')[0])
    );
    const active_days = uniqueDays.size;

    const daysSinceFirst = transactions.length > 0
      ? (Date.now() - new Date(transactions[0].block_time).getTime()) / (1000 * 60 * 60 * 24)
      : 1;
    const trades_per_day = total_trades / Math.max(daysSinceFirst, 1);

    // Favorite tokens and DEXes
    const tokenCounts: Record<string, number> = {};
    const dexCounts: Record<string, number> = {};

    transactions.forEach(t => {
      if (t.token_mint) {
        tokenCounts[t.token_mint] = (tokenCounts[t.token_mint] || 0) + 1;
      }
      if (t.dex_protocol) {
        dexCounts[t.dex_protocol] = (dexCounts[t.dex_protocol] || 0) + 1;
      }
    });

    const favorite_tokens = Object.entries(tokenCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([mint, count]) => ({ mint, count }));

    const favorite_dexes = Object.entries(dexCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([dex, count]) => ({ dex, count }));

    // Reputation score
    const reputation_score = this.calculateReputationScore({
      total_trades,
      win_rate,
      total_profit_usd,
      average_profit_percent,
    });

    // Timestamps
    const first_trade_at = transactions.length > 0 ? new Date(transactions[0].block_time) : null;
    const last_trade_at = transactions.length > 0
      ? new Date(transactions[transactions.length - 1].block_time)
      : null;

    return {
      total_trades,
      total_buys,
      total_sells,
      winning_trades,
      losing_trades,
      win_rate,
      total_profit_sol,
      total_profit_usd,
      average_profit_percent,
      largest_win_percent,
      largest_loss_percent,
      average_hold_time_hours,
      median_hold_time_hours,
      total_volume_sol,
      total_volume_usd,
      average_position_size_sol,
      active_days,
      trades_per_day,
      favorite_tokens,
      favorite_dexes,
      reputation_score,
      first_trade_at: first_trade_at?.toISOString() as any,
      last_trade_at: last_trade_at?.toISOString() as any,
    };
  }

  /**
   * Calculate reputation score (0-100)
   */
  private calculateReputationScore(metrics: {
    total_trades: number;
    win_rate: number;
    total_profit_usd: number;
    average_profit_percent: number;
  }): number {
    let score = 50; // Start at neutral

    // Win rate contribution (max +30)
    score += (metrics.win_rate / 100 - 0.5) * 60;

    // Total profit contribution (max +10)
    if (metrics.total_profit_usd > 10000) score += 10;
    else if (metrics.total_profit_usd > 1000) score += 5;
    else if (metrics.total_profit_usd > 0) score += 2;

    // Average profit contribution (max +10)
    if (metrics.average_profit_percent > 50) score += 10;
    else if (metrics.average_profit_percent > 20) score += 5;
    else if (metrics.average_profit_percent > 0) score += 2;

    // Consistency penalty for low sample size
    if (metrics.total_trades < 5) score -= 20;
    else if (metrics.total_trades < 10) score -= 10;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // ============================================
  // Transaction Management
  // ============================================

  /**
   * Get recent transactions for a wallet
   */
  async getWalletTransactions(
    address: string,
    limit = 20
  ): Promise<WalletTransaction[]> {
    try {
      const { data, error } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('wallet_address', address)
        .order('block_time', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return data || [];
    } catch (error) {
      logger.error('WalletTracker', 'Failed to get wallet transactions', error as Error);
      return [];
    }
  }

  /**
   * Get comprehensive wallet statistics
   */
  async getWalletStats(address: string): Promise<WalletStats | null> {
    try {
      const wallet = await this.getTrackedWallet(address);
      if (!wallet) return null;

      const performance = await this.getPerformance(address);
      const recentTransactions = await this.getWalletTransactions(address, 10);

      // Determine trading style
      const avgHoldTime = performance?.average_hold_time_hours || 0;
      let tradingStyle: 'scalper' | 'swing' | 'holder' = 'swing';
      if (avgHoldTime < 2) tradingStyle = 'scalper';
      else if (avgHoldTime > 48) tradingStyle = 'holder';

      // Determine risk level
      const winRate = performance?.win_rate || 0;
      const profitPercent = performance?.average_profit_percent || 0;
      let riskLevel: 'low' | 'medium' | 'high' = 'medium';
      if (winRate > 70 && profitPercent > 20) riskLevel = 'low';
      else if (winRate < 40 || profitPercent < 0) riskLevel = 'high';

      // Generate recommendation
      let recommendation = 'Monitor for more data';
      if (performance && performance.total_trades >= 10) {
        if (winRate > 65 && profitPercent > 15) {
          recommendation = '✅ Strong performer - Consider copying';
        } else if (winRate > 55 && profitPercent > 5) {
          recommendation = '⚠️ Decent performer - Copy with caution';
        } else {
          recommendation = '❌ Poor performance - Avoid copying';
        }
      }

      return {
        wallet,
        performance,
        recentTransactions,
        summary: {
          isProfiTable: (performance?.total_profit_usd || 0) > 0,
          riskLevel,
          tradingStyle,
          recommendation,
        },
      };
    } catch (error) {
      logger.error('WalletTracker', 'Failed to get wallet stats', error as Error);
      return null;
    }
  }

  // ============================================
  // Discovery Queue Management
  // ============================================

  /**
   * Add wallet to discovery queue
   */
  async queueWalletDiscovery(
    address: string,
    context: {
      discoveredFromToken?: string;
      discoveryReason?: string;
      initialScore?: number;
      estimatedProfit?: number;
      estimatedWinRate?: number;
    }
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('wallet_discovery_queue')
        .insert({
          wallet_address: address,
          discovered_from_token: context.discoveredFromToken || null,
          discovery_reason: context.discoveryReason || null,
          initial_score: context.initialScore || 0,
          estimated_profit_sol: context.estimatedProfit || null,
          estimated_win_rate: context.estimatedWinRate || null,
          status: 'pending',
        });

      if (error && error.code !== '23505') { // Ignore duplicate
        throw error;
      }

      logger.info('WalletTracker', `Queued wallet for discovery: ${address.slice(0, 8)}...`);
    } catch (error) {
      logger.silentError('WalletTracker', 'Failed to queue wallet discovery', error as Error);
    }
  }

  /**
   * Get pending discoveries
   */
  async getPendingDiscoveries(limit = 10): Promise<WalletDiscovery[]> {
    try {
      const { data, error } = await supabase
        .from('wallet_discovery_queue')
        .select('*')
        .eq('status', 'pending')
        .order('initial_score', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return data || [];
    } catch (error) {
      logger.error('WalletTracker', 'Failed to get pending discoveries', error as Error);
      return [];
    }
  }
}

// Singleton instance
export const walletTracker = new WalletTracker();
