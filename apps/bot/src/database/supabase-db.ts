/**
 * Supabase Database Service
 * Drop-in replacement for sql.js database with PostgreSQL backend
 * Maintains the same API surface as the original DatabaseService
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, unixToISO, isoToUnix, nowISO, nowUnix } from './supabase';
import { logger } from '../utils/logger';
import type {
  BacktestStrategy,
  BacktestResults,
  BacktestTrade,
  TokenWithOutcome,
} from '../backtest/types';

interface AnalysisInput {
  tokenMint: string;
  symbol: string;
  name: string;
  riskScore: number;
  riskLevel: string;
  liquidityUsd: number;
  lpBurnedPercent: number;
  lpLockedPercent: number;
  holderCount: number;
  top10Percent: number;
  mintRevoked: boolean;
  freezeRevoked: boolean;
  isHoneypot: boolean;
  hasTwitter: boolean;
  hasTelegram: boolean;
  hasWebsite: boolean;
  source: string;
  mlRugProbability?: number;
  mlConfidence?: number;
}

interface AlertInput {
  tokenMint: string;
  symbol: string;
  alertType: string;
  chatId: string;
  riskScore: number;
  riskLevel: string;
}

class SupabaseDatabaseService {
  public client: SupabaseClient | null;
  private initialized: boolean = false;

  constructor() {
    this.client = getSupabaseClient();
  }

  /**
   * Initialize the database connection
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      logger.info('Database', 'Initializing Supabase connection...');

      // Test connection
      const { error } = await this.client.from('sync_metadata').select('count').limit(1);

      if (error) {
        throw new Error(`Connection test failed: ${error.message}`);
      }

      this.initialized = true;
      logger.info('Database', '✅ Supabase database initialized');
    } catch (error) {
      logger.error('Database', 'Failed to initialize', error as Error);
      throw error;
    }
  }

  /**
   * Save a token analysis to the database
   */
  async saveAnalysis(input: AnalysisInput): Promise<void> {
    try {
      const { error } = await this.client.from('token_analysis').insert({
        mint: input.tokenMint,
        symbol: input.symbol,
        name: input.name,
        risk_score: input.riskScore,
        risk_level: input.riskLevel,
        liquidity_usd: input.liquidityUsd,
        lp_burned_percent: input.lpBurnedPercent,
        lp_locked_percent: input.lpLockedPercent,
        total_holders: input.holderCount,
        top10_percent: input.top10Percent,
        mint_revoked: input.mintRevoked,
        freeze_revoked: input.freezeRevoked,
        is_honeypot: input.isHoneypot,
        has_twitter: input.hasTwitter,
        has_telegram: input.hasTelegram,
        has_website: input.hasWebsite,
        source: input.source,
        ml_rug_probability: input.mlRugProbability,
        ml_confidence: input.mlConfidence,
        analyzed_at: nowISO(),
      });

      if (error) throw error;
      logger.debug('Database', `Saved analysis for ${input.symbol}`);
    } catch (error) {
      logger.silentError('Database', 'Failed to save analysis', error as Error);
    }
  }

  /**
   * Get recent analyses for sync
   */
  async getRecentAnalyses(afterTimestamp: number, limit: number = 100): Promise<any[]> {
    try {
      const { data, error } = await this.client
        .from('token_analysis')
        .select('*')
        .gt('analyzed_at', unixToISO(afterTimestamp))
        .order('analyzed_at', { ascending: true })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      logger.silentError('Database', 'Failed to get recent analyses', error as Error);
      return [];
    }
  }

  /**
   * Check if we've recently analyzed a token
   */
  async wasRecentlyAnalyzed(mint: string, withinSeconds: number = 3600): Promise<boolean> {
    try {
      const cutoff = new Date(Date.now() - withinSeconds * 1000).toISOString();

      const { data, error } = await this.client
        .from('token_analysis')
        .select('id')
        .eq('mint', mint)
        .gt('analyzed_at', cutoff)
        .limit(1);

      if (error) throw error;
      return (data?.length || 0) > 0;
    } catch (error) {
      logger.silentError('Database', 'Failed to check recent analysis', error as Error);
      return false;
    }
  }

  /**
   * Get analysis by mint address
   */
  async getAnalysisByMint(mint: string): Promise<{
    mint: string;
    symbol: string;
    name: string;
    risk_score: number;
    liquidity_usd: number;
    holder_count: number;
    top_10_percent: number;
    mint_revoked: boolean;
    freeze_revoked: boolean;
    lp_burned_percent: number;
    has_twitter: boolean;
    has_telegram: boolean;
    has_website: boolean;
  } | null> {
    try {
      const { data, error } = await this.client
        .from('token_analysis')
        .select('*')
        .eq('mint', mint)
        .order('analyzed_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !data) return null;

      return {
        mint: data.mint,
        symbol: data.symbol,
        name: data.name,
        risk_score: data.risk_score,
        liquidity_usd: data.liquidity_usd,
        holder_count: data.total_holders,
        top_10_percent: data.top10_percent,
        mint_revoked: data.mint_revoked,
        freeze_revoked: data.freeze_revoked,
        lp_burned_percent: data.lp_burned_percent,
        has_twitter: data.has_twitter,
        has_telegram: data.has_telegram,
        has_website: data.has_website,
      };
    } catch (error) {
      logger.silentError('Database', 'Failed to get analysis by mint', error as Error);
      return null;
    }
  }

  /**
   * Save an alert to history
   */
  async saveAlert(input: AlertInput): Promise<void> {
    try {
      const { error } = await this.client.from('alert_history').insert({
        mint: input.tokenMint,
        symbol: input.symbol,
        chat_id: input.chatId,
        alert_type: input.alertType,
        risk_score: input.riskScore,
        risk_level: input.riskLevel,
        sent_at: nowISO(),
      });

      if (error) throw error;
    } catch (error) {
      logger.silentError('Database', 'Failed to save alert', error as Error);
    }
  }

  /**
   * Get recent alerts for sync
   */
  async getRecentAlerts(afterTimestamp: number, limit: number = 100): Promise<any[]> {
    try {
      const { data, error } = await this.client
        .from('alert_history')
        .select('*')
        .gt('sent_at', unixToISO(afterTimestamp))
        .order('sent_at', { ascending: true })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      logger.silentError('Database', 'Failed to get recent alerts', error as Error);
      return [];
    }
  }

  /**
   * Check if alert was already sent for this token to this chat
   */
  async wasAlertSent(
    mint: string,
    chatId: string,
    alertType: string,
    withinSeconds: number = 86400
  ): Promise<boolean> {
    try {
      const cutoff = new Date(Date.now() - withinSeconds * 1000).toISOString();

      const { data, error } = await this.client
        .from('alert_history')
        .select('id')
        .eq('mint', mint)
        .eq('chat_id', chatId)
        .eq('alert_type', alertType)
        .gt('sent_at', cutoff)
        .limit(1);

      if (error) throw error;
      return (data?.length || 0) > 0;
    } catch (error) {
      logger.silentError('Database', 'Failed to check alert history', error as Error);
      return false;
    }
  }

  /**
   * Get ML training data
   */
  async getMLTrainingData(limit: number = 10000): Promise<any[]> {
    try {
      const { data, error } = await this.client
        .from('token_analysis')
        .select(
          `
          *,
          token_outcomes!inner(outcome, peak_price_multiplier)
        `
        )
        .not('token_outcomes.outcome', 'is', null)
        .neq('token_outcomes.outcome', 'unknown')
        .order('analyzed_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      logger.silentError('Database', 'Failed to get ML training data', error as Error);
      return [];
    }
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{
    totalAnalyses: number;
    totalAlerts: number;
    alertsToday: number;
    dbSizeBytes: number;
  }> {
    try {
      const [analysesRes, alertsRes, alertsTodayRes] = await Promise.all([
        this.client.from('token_analysis').select('*', { count: 'exact', head: true }),
        this.client.from('alert_history').select('*', { count: 'exact', head: true }),
        this.client
          .from('alert_history')
          .select('*', { count: 'exact', head: true })
          .gt('sent_at', new Date(Date.now() - 86400000).toISOString()),
      ]);

      return {
        totalAnalyses: analysesRes.count || 0,
        totalAlerts: alertsRes.count || 0,
        alertsToday: alertsTodayRes.count || 0,
        dbSizeBytes: 0, // N/A for Supabase
      };
    } catch (error) {
      logger.silentError('Database', 'Failed to get stats', error as Error);
      return { totalAnalyses: 0, totalAlerts: 0, alertsToday: 0, dbSizeBytes: 0 };
    }
  }

  /**
   * Get recent pool discoveries
   */
  async getRecentDiscoveries(afterTimestamp: number, limit: number = 100): Promise<any[]> {
    try {
      const { data, error } = await this.client
        .from('pool_discovery')
        .select('*')
        .gt('discovered_at', unixToISO(afterTimestamp))
        .order('discovered_at', { ascending: true })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      logger.silentError('Database', 'Failed to get recent discoveries', error as Error);
      return [];
    }
  }

  /**
   * Cleanup old data
   */
  async cleanup(keepDays: number = 30): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString();

      await Promise.all([
        this.client.from('watchlist_price_history').delete().lt('recorded_at', cutoff),
        this.client
          .from('pool_discovery')
          .delete()
          .lt('discovered_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
      ]);

      logger.debug('Database', 'Cleanup completed');
    } catch (error) {
      logger.silentError('Database', 'Cleanup failed', error as Error);
    }
  }

  // ============================================
  // Backtest Methods
  // ============================================

  /**
   * Get tokens with outcomes for backtesting
   */
  async getTokensWithOutcomes(startDate: number, endDate: number): Promise<TokenWithOutcome[]> {
    try {
      const { data, error } = await this.client
        .from('token_outcomes')
        .select(
          `
          *,
          token_analysis!inner(mint_revoked, freeze_revoked, lp_burned_percent, has_twitter, has_telegram, has_website)
        `
        )
        .gte('discovered_at', unixToISO(startDate))
        .lte('discovered_at', unixToISO(endDate))
        .not('outcome', 'is', null)
        .gt('initial_price', 0)
        .gt('peak_price', 0)
        .order('discovered_at', { ascending: true });

      if (error) throw error;

      return (data || []).map((row: any) => ({
        mint: row.mint,
        symbol: row.symbol,
        initialPrice: row.initial_price || 0,
        initialLiquidity: row.initial_liquidity || 0,
        initialRiskScore: row.initial_risk_score || 0,
        initialHolders: row.initial_holders || 0,
        initialTop10Percent: row.initial_top10_percent,
        peakPrice: row.peak_price || row.initial_price,
        peakLiquidity: row.peak_liquidity,
        finalPrice: row.final_price || row.initial_price,
        finalLiquidity: row.final_liquidity,
        outcome: row.outcome || 'unknown',
        peakMultiplier: row.peak_price_multiplier || 1,
        timeToPeak: row.time_to_peak,
        discoveredAt: isoToUnix(row.discovered_at),
        peakAt: row.peak_at ? isoToUnix(row.peak_at) : undefined,
        outcomeRecordedAt: row.outcome_recorded_at ? isoToUnix(row.outcome_recorded_at) : undefined,
        mintRevoked: row.token_analysis?.mint_revoked || false,
        freezeRevoked: row.token_analysis?.freeze_revoked || false,
        lpBurned: (row.token_analysis?.lp_burned_percent || 0) > 50,
        lpBurnedPercent: row.token_analysis?.lp_burned_percent,
        hasTwitter: row.token_analysis?.has_twitter || false,
        hasTelegram: row.token_analysis?.has_telegram || false,
        hasWebsite: row.token_analysis?.has_website || false,
      }));
    } catch (error) {
      logger.error('Database', 'Failed to get tokens with outcomes', error as Error);
      return [];
    }
  }

  /**
   * Save a backtest strategy
   */
  async saveBacktestStrategy(strategy: BacktestStrategy): Promise<number> {
    try {
      const { data, error } = await this.client
        .from('backtest_strategies')
        .upsert({
          name: strategy.name,
          description: strategy.description,
          entry_conditions: strategy.entry,
          exit_conditions: strategy.exit,
          position_sizing: strategy.sizing,
          is_preset: strategy.isPreset || false,
          created_at: strategy.createdAt ? unixToISO(strategy.createdAt) : nowISO(),
          updated_at: nowISO(),
        })
        .select('id')
        .single();

      if (error) throw error;
      return data?.id || 0;
    } catch (error) {
      logger.error('Database', 'Failed to save backtest strategy', error as Error);
      return 0;
    }
  }

  /**
   * Get a backtest strategy by name
   */
  async getBacktestStrategy(name: string): Promise<BacktestStrategy | null> {
    try {
      const { data, error } = await this.client
        .from('backtest_strategies')
        .select('*')
        .eq('name', name)
        .single();

      if (error || !data) return null;

      return {
        id: data.id,
        name: data.name,
        description: data.description,
        entry: data.entry_conditions,
        exit: data.exit_conditions,
        sizing: data.position_sizing,
        isPreset: data.is_preset,
        createdAt: isoToUnix(data.created_at),
        updatedAt: isoToUnix(data.updated_at),
      };
    } catch (error) {
      logger.error('Database', 'Failed to get backtest strategy', error as Error);
      return null;
    }
  }

  /**
   * Get all backtest strategies
   */
  async getAllBacktestStrategies(): Promise<BacktestStrategy[]> {
    try {
      const { data, error } = await this.client
        .from('backtest_strategies')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;

      return (data || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        entry: row.entry_conditions,
        exit: row.exit_conditions,
        sizing: row.position_sizing,
        isPreset: row.is_preset,
        createdAt: isoToUnix(row.created_at),
        updatedAt: isoToUnix(row.updated_at),
      }));
    } catch (error) {
      logger.error('Database', 'Failed to get all backtest strategies', error as Error);
      return [];
    }
  }

  /**
   * Save backtest run results
   */
  async saveBacktestRun(results: BacktestResults, trades: BacktestTrade[]): Promise<number> {
    try {
      // Insert run
      const { data: runData, error: runError } = await this.client
        .from('backtest_runs')
        .insert({
          strategy_id: results.strategyId,
          strategy_name: results.strategyName,
          start_date: unixToISO(results.startDate),
          end_date: unixToISO(results.endDate),
          days_analyzed: results.daysAnalyzed,
          initial_capital: results.initialCapital,
          final_capital: results.finalCapital,
          total_trades: results.totalTrades,
          winning_trades: results.winningTrades,
          losing_trades: results.losingTrades,
          win_rate: results.winRate,
          total_profit_loss: results.totalProfitLoss,
          total_return: results.totalReturn,
          average_win: results.averageWin,
          average_loss: results.averageLoss,
          largest_win: results.largestWin,
          largest_loss: results.largestLoss,
          max_drawdown: results.maxDrawdown,
          max_drawdown_duration: results.maxDrawdownDuration,
          sharpe_ratio: results.sharpeRatio,
          sortino_ratio: results.sortinoRatio,
          profit_factor: results.profitFactor,
          average_hold_time: results.averageHoldTime,
          longest_winning_streak: results.longestWinningStreak,
          longest_losing_streak: results.longestLosingStreak,
          equity_curve: results.equityCurve,
          executed_at: unixToISO(results.executedAt),
          execution_time_ms: results.executionTimeMs,
        })
        .select('id')
        .single();

      if (runError) throw runError;
      const runId = runData.id;

      // Insert trades
      if (trades.length > 0) {
        const tradesData = trades.map((trade) => ({
          run_id: runId,
          token_mint: trade.tokenMint,
          token_symbol: trade.tokenSymbol,
          token_name: trade.tokenName,
          entry_price: trade.entryPrice,
          entry_time: unixToISO(trade.entryTime),
          position_size: trade.positionSize,
          exit_price: trade.exitPrice,
          exit_time: unixToISO(trade.exitTime),
          exit_reason: trade.exitReason,
          profit_loss: trade.profitLoss,
          profit_loss_percent: trade.profitLossPercent,
          hold_time_seconds: trade.holdTimeSeconds,
          peak_price: trade.peakPrice,
          peak_multiplier: trade.peakMultiplier,
          entry_risk_score: trade.entryRiskScore,
          entry_liquidity: trade.entryLiquidity,
          entry_holders: trade.entryHolders,
        }));

        const { error: tradesError } = await this.client.from('backtest_trades').insert(tradesData);

        if (tradesError) throw tradesError;
      }

      return runId;
    } catch (error) {
      logger.error('Database', 'Failed to save backtest run', error as Error);
      return 0;
    }
  }

  /**
   * Delete a backtest strategy
   */
  async deleteBacktestStrategy(name: string): Promise<void> {
    try {
      const { error } = await this.client
        .from('backtest_strategies')
        .delete()
        .eq('name', name)
        .eq('is_preset', false);

      if (error) throw error;
    } catch (error) {
      logger.error('Database', 'Failed to delete backtest strategy', error as Error);
    }
  }

  // ============================================
  // Token Snapshot Methods
  // ============================================

  /**
   * Save a token snapshot
   */
  async saveTokenSnapshot(snapshot: {
    mint: string;
    symbol?: string;
    priceUsd: number;
    priceSol?: number;
    volume5m?: number;
    volume1h?: number;
    volume24h?: number;
    liquidityUsd?: number;
    marketCap?: number;
    holderCount?: number;
    priceChange5m?: number;
    priceChange1h?: number;
    priceChange24h?: number;
    buys5m?: number;
    sells5m?: number;
    buys1h?: number;
    sells1h?: number;
    recordedAt: number;
  }): Promise<void> {
    try {
      const { error } = await this.client.from('token_snapshots').upsert({
        mint: snapshot.mint,
        symbol: snapshot.symbol,
        price_usd: snapshot.priceUsd,
        price_sol: snapshot.priceSol,
        volume_5m: snapshot.volume5m,
        volume_1h: snapshot.volume1h,
        volume_24h: snapshot.volume24h,
        liquidity_usd: snapshot.liquidityUsd,
        market_cap: snapshot.marketCap,
        holder_count: snapshot.holderCount,
        price_change_5m: snapshot.priceChange5m,
        price_change_1h: snapshot.priceChange1h,
        price_change_24h: snapshot.priceChange24h,
        buys_5m: snapshot.buys5m,
        sells_5m: snapshot.sells5m,
        buys_1h: snapshot.buys1h,
        sells_1h: snapshot.sells1h,
        recorded_at: unixToISO(snapshot.recordedAt),
      });

      if (error) throw error;
    } catch (error) {
      logger.silentError('Database', 'Failed to save token snapshot', error as Error);
    }
  }

  /**
   * Get token snapshots
   */
  async getTokenSnapshots(mint: string, limit: number = 288): Promise<any[]> {
    try {
      const { data, error } = await this.client
        .from('token_snapshots')
        .select('*')
        .eq('mint', mint)
        .order('recorded_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (data || []).map((row: any) => ({
        ...row,
        recordedAt: isoToUnix(row.recorded_at),
      }));
    } catch (error) {
      logger.silentError('Database', 'Failed to get token snapshots', error as Error);
      return [];
    }
  }

  /**
   * Add token to snapshot watch list
   */
  async addToSnapshotWatchList(mint: string, symbol?: string, expiresAt?: number): Promise<void> {
    try {
      const { error } = await this.client.from('snapshot_watch_list').upsert({
        mint,
        symbol,
        added_at: nowISO(),
        is_active: true,
        expires_at: expiresAt ? unixToISO(expiresAt) : null,
      });

      if (error) throw error;
    } catch (error) {
      logger.silentError('Database', 'Failed to add to snapshot watch list', error as Error);
    }
  }

  /**
   * Remove token from snapshot watch list
   */
  async removeFromSnapshotWatchList(mint: string): Promise<void> {
    try {
      const { error } = await this.client
        .from('snapshot_watch_list')
        .update({ is_active: false })
        .eq('mint', mint);

      if (error) throw error;
    } catch (error) {
      logger.silentError('Database', 'Failed to remove from snapshot watch list', error as Error);
    }
  }

  /**
   * Get snapshot watch list
   */
  async getSnapshotWatchList(): Promise<any[]> {
    try {
      const { data, error } = await this.client
        .from('snapshot_watch_list')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;

      return (data || []).map((row: any) => ({
        ...row,
        addedAt: isoToUnix(row.added_at),
        lastSnapshotAt: row.last_snapshot_at ? isoToUnix(row.last_snapshot_at) : null,
        expiresAt: row.expires_at ? isoToUnix(row.expires_at) : null,
        isActive: row.is_active,
      }));
    } catch (error) {
      logger.silentError('Database', 'Failed to get snapshot watch list', error as Error);
      return [];
    }
  }

  /**
   * Update snapshot watch entry after collecting a snapshot
   */
  async updateSnapshotWatchEntry(mint: string): Promise<void> {
    try {
      // Use RPC function to increment count
      const { error: rpcError } = await this.client.rpc('increment_snapshot_count', {
        mint_param: mint,
      });

      if (rpcError) throw rpcError;

      // Update last snapshot time
      const { error } = await this.client
        .from('snapshot_watch_list')
        .update({
          last_snapshot_at: nowISO(),
        })
        .eq('mint', mint);

      if (error) throw error;
    } catch (error) {
      logger.silentError('Database', 'Failed to update snapshot watch entry', error as Error);
    }
  }

  /**
   * Clean up expired snapshot watches
   */
  async cleanupExpiredSnapshotWatches(now: number): Promise<void> {
    try {
      const { error } = await this.client
        .from('snapshot_watch_list')
        .update({ is_active: false })
        .not('expires_at', 'is', null)
        .lt('expires_at', unixToISO(now));

      if (error) throw error;
    } catch (error) {
      logger.silentError('Database', 'Failed to cleanup expired snapshot watches', error as Error);
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const { data, error } = await this.client.from('sync_metadata').select('count').limit(1);

      if (error) {
        return {
          healthy: false,
          details: { errors: [error.message] },
        };
      }

      return {
        healthy: true,
        details: { errors: [] },
      };
    } catch (error) {
      return {
        healthy: false,
        details: { errors: [(error as Error).message] },
      };
    }
  }

  /**
   * Create manual backup (N/A for Supabase - handled by platform)
   */
  async createBackup() {
    logger.info('Database', 'Backups are managed by Supabase platform');
    return null;
  }

  /**
   * Get migration information (N/A for Supabase - use Supabase CLI)
   */
  getMigrationInfo() {
    return {
      currentVersion: 'managed-by-supabase',
      appliedCount: 0,
      pendingCount: 0,
    };
  }

  /**
   * Get backup information (N/A for Supabase)
   */
  getBackupInfo() {
    return {
      totalBackups: 0,
      latestBackup: null,
    };
  }

  /**
   * Get database instance (for advanced operations)
   */
  getDb(): SupabaseClient {
    return this.client;
  }

  /**
   * Close the database connection gracefully
   */
  async close(): Promise<void> {
    logger.info('Database', 'Closing Supabase connection...');
    // Supabase client manages connections automatically
    this.initialized = false;
    logger.info('Database', '✅ Database closed gracefully');
  }
}

export const supabaseDb = new SupabaseDatabaseService();
export default supabaseDb;
