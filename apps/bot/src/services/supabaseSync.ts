/**
 * Supabase Sync Service
 * Synchronizes local SQLite data to Supabase for web dashboard access
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';
import { database } from '../database';

interface SyncConfig {
  enabled: boolean;
  batchSize: number;
  tokenAnalysisIntervalMs: number;
  alertHistoryIntervalMs: number;
  poolDiscoveryIntervalMs: number;
  backtestIntervalMs: number;
  snapshotIntervalMs: number;
  botStatusIntervalMs: number;
}

interface SyncMetadata {
  tableName: string;
  lastSyncedAt: number;
  lastSyncedId?: number;
  syncStatus: 'idle' | 'syncing' | 'error';
  errorMessage?: string;
}

class SupabaseSyncService {
  private client: SupabaseClient | null = null;
  private config: SyncConfig;
  private syncIntervals: Map<string, NodeJS.Timeout> = new Map();
  private syncMetadata: Map<string, SyncMetadata> = new Map();
  private initialized: boolean = false;

  constructor() {
    this.config = {
      enabled: process.env.SUPABASE_SYNC_ENABLED === 'true',
      batchSize: parseInt(process.env.SUPABASE_BATCH_SIZE || '100', 10),
      tokenAnalysisIntervalMs: 30000,  // 30s
      alertHistoryIntervalMs: 30000,   // 30s
      poolDiscoveryIntervalMs: 30000,  // 30s
      backtestIntervalMs: 60000,       // 1min
      snapshotIntervalMs: 60000,       // 1min
      botStatusIntervalMs: 10000,      // 10s
    };
  }

  /**
   * Initialize the Supabase client and start sync
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('SupabaseSync', 'Sync disabled - SUPABASE_SYNC_ENABLED is not true');
      return;
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      logger.warn('SupabaseSync', 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
      return;
    }

    try {
      this.client = createClient(supabaseUrl, supabaseKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });

      // Test connection
      const { error } = await this.client.from('sync_metadata').select('count').limit(1);
      if (error) {
        throw error;
      }

      // Load sync metadata
      await this.loadSyncMetadata();

      // Start sync intervals
      this.startSyncIntervals();

      this.initialized = true;
      logger.info('SupabaseSync', 'Initialized and connected to Supabase');
    } catch (error) {
      logger.error('SupabaseSync', 'Failed to initialize', error as Error);
    }
  }

  /**
   * Load sync metadata from Supabase
   */
  private async loadSyncMetadata(): Promise<void> {
    if (!this.client) return;

    const { data, error } = await this.client
      .from('sync_metadata')
      .select('*');

    if (error) {
      logger.error('SupabaseSync', 'Failed to load sync metadata', error);
      return;
    }

    if (data) {
      for (const row of data) {
        this.syncMetadata.set(row.table_name, {
          tableName: row.table_name,
          lastSyncedAt: new Date(row.last_synced_at).getTime(),
          lastSyncedId: row.last_synced_id,
          syncStatus: row.sync_status,
          errorMessage: row.error_message,
        });
      }
    }
  }

  /**
   * Start sync intervals for each table
   */
  private startSyncIntervals(): void {
    // Token analysis sync
    this.syncIntervals.set('token_analysis',
      setInterval(() => this.syncTokenAnalysis(), this.config.tokenAnalysisIntervalMs)
    );

    // Alert history sync
    this.syncIntervals.set('alert_history',
      setInterval(() => this.syncAlertHistory(), this.config.alertHistoryIntervalMs)
    );

    // Pool discovery sync
    this.syncIntervals.set('pool_discovery',
      setInterval(() => this.syncPoolDiscovery(), this.config.poolDiscoveryIntervalMs)
    );

    // Backtest sync
    this.syncIntervals.set('backtest',
      setInterval(() => this.syncBacktestData(), this.config.backtestIntervalMs)
    );

    // Token snapshots sync
    this.syncIntervals.set('token_snapshots',
      setInterval(() => this.syncTokenSnapshots(), this.config.snapshotIntervalMs)
    );

    // Bot status sync (more frequent)
    this.syncIntervals.set('bot_status',
      setInterval(() => this.syncBotStatus(), this.config.botStatusIntervalMs)
    );

    logger.info('SupabaseSync', 'Started sync intervals');
  }

  /**
   * Sync token analysis data
   */
  private async syncTokenAnalysis(): Promise<void> {
    if (!this.client) return;

    const metadata = this.syncMetadata.get('token_analysis');
    const lastSyncedAt = metadata?.lastSyncedAt || 0;

    try {
      await this.updateSyncStatus('token_analysis', 'syncing');

      // Get new analyses from local database
      const analyses = database.getRecentAnalyses(lastSyncedAt, this.config.batchSize);

      if (analyses.length === 0) {
        await this.updateSyncStatus('token_analysis', 'idle');
        return;
      }

      // Transform and upsert to Supabase
      const records = analyses.map((a: any) => ({
        mint: a.mint,
        symbol: a.symbol,
        name: a.name,
        risk_score: a.risk_score,
        risk_level: a.risk_level,
        liquidity_usd: a.liquidity_usd,
        lp_burned_percent: a.lp_burned_percent,
        lp_locked_percent: a.lp_locked_percent,
        total_holders: a.total_holders,
        top10_percent: a.top10_percent,
        mint_revoked: a.mint_revoked === 1,
        freeze_revoked: a.freeze_revoked === 1,
        is_honeypot: a.is_honeypot === 1,
        has_twitter: a.has_twitter === 1,
        has_telegram: a.has_telegram === 1,
        has_website: a.has_website === 1,
        source: a.source,
        analyzed_at: new Date(a.analyzed_at * 1000).toISOString(),
        synced_at: new Date().toISOString(),
      }));

      const { error } = await this.client
        .from('token_analysis')
        .upsert(records, { onConflict: 'mint,analyzed_at' });

      if (error) throw error;

      await this.updateSyncMetadata('token_analysis', Date.now());
      logger.debug('SupabaseSync', `Synced ${records.length} token analyses`);
    } catch (error) {
      await this.updateSyncStatus('token_analysis', 'error', (error as Error).message);
      logger.error('SupabaseSync', 'Token analysis sync failed', error as Error);
    }
  }

  /**
   * Sync alert history
   */
  private async syncAlertHistory(): Promise<void> {
    if (!this.client) return;

    const metadata = this.syncMetadata.get('alert_history');
    const lastSyncedAt = metadata?.lastSyncedAt || 0;

    try {
      await this.updateSyncStatus('alert_history', 'syncing');

      // Get new alerts from local database
      const alerts = database.getRecentAlerts(lastSyncedAt, this.config.batchSize);

      if (alerts.length === 0) {
        await this.updateSyncStatus('alert_history', 'idle');
        return;
      }

      const records = alerts.map((a: any) => ({
        mint: a.mint,
        symbol: a.symbol,
        chat_id: a.chat_id,
        alert_type: a.alert_type,
        risk_score: a.risk_score,
        risk_level: a.risk_level,
        sent_at: new Date(a.sent_at * 1000).toISOString(),
        synced_at: new Date().toISOString(),
      }));

      const { error } = await this.client
        .from('alert_history')
        .insert(records);

      if (error) throw error;

      await this.updateSyncMetadata('alert_history', Date.now());
      logger.debug('SupabaseSync', `Synced ${records.length} alerts`);
    } catch (error) {
      await this.updateSyncStatus('alert_history', 'error', (error as Error).message);
      logger.error('SupabaseSync', 'Alert history sync failed', error as Error);
    }
  }

  /**
   * Sync pool discoveries
   */
  private async syncPoolDiscovery(): Promise<void> {
    if (!this.client) return;

    const metadata = this.syncMetadata.get('pool_discovery');
    const lastSyncedAt = metadata?.lastSyncedAt || 0;

    try {
      await this.updateSyncStatus('pool_discovery', 'syncing');

      // Get new discoveries from local database
      const discoveries = database.getRecentDiscoveries(lastSyncedAt, this.config.batchSize);

      if (discoveries.length === 0) {
        await this.updateSyncStatus('pool_discovery', 'idle');
        return;
      }

      const records = discoveries.map((d: any) => ({
        pool_address: d.pool_address,
        token_mint: d.token_mint,
        base_mint: d.base_mint,
        quote_mint: d.quote_mint,
        source: d.source,
        initial_liquidity_usd: d.initial_liquidity_usd,
        initial_price: d.initial_price,
        discovered_at: new Date(d.discovered_at * 1000).toISOString(),
        synced_at: new Date().toISOString(),
      }));

      const { error } = await this.client
        .from('pool_discovery')
        .upsert(records, { onConflict: 'pool_address' });

      if (error) throw error;

      await this.updateSyncMetadata('pool_discovery', Date.now());
      logger.debug('SupabaseSync', `Synced ${records.length} pool discoveries`);
    } catch (error) {
      await this.updateSyncStatus('pool_discovery', 'error', (error as Error).message);
      logger.error('SupabaseSync', 'Pool discovery sync failed', error as Error);
    }
  }

  /**
   * Sync backtest data (strategies and runs)
   */
  private async syncBacktestData(): Promise<void> {
    if (!this.client) return;

    try {
      await this.updateSyncStatus('backtest_runs', 'syncing');

      // Sync strategies
      const strategies = database.getAllBacktestStrategies();
      if (strategies.length > 0) {
        const strategyRecords = strategies.map(s => ({
          name: s.name,
          description: s.description,
          entry_conditions: s.entry,
          exit_conditions: s.exit,
          position_sizing: s.sizing,
          is_preset: s.isPreset || false,
          created_at: new Date((s.createdAt || Date.now()) * 1000).toISOString(),
          updated_at: new Date((s.updatedAt || Date.now()) * 1000).toISOString(),
          synced_at: new Date().toISOString(),
        }));

        const { error: strategyError } = await this.client
          .from('backtest_strategies')
          .upsert(strategyRecords, { onConflict: 'name' });

        if (strategyError) throw strategyError;
      }

      // Sync recent runs
      const runs = database.getRecentBacktestRuns(20);
      if (runs.length > 0) {
        const runRecords = runs.map(r => ({
          strategy_name: r.strategyName,
          start_date: new Date(r.startDate * 1000).toISOString(),
          end_date: new Date(r.endDate * 1000).toISOString(),
          days_analyzed: r.daysAnalyzed,
          initial_capital: r.initialCapital,
          final_capital: r.finalCapital,
          total_trades: r.totalTrades,
          winning_trades: r.winningTrades,
          losing_trades: r.losingTrades,
          win_rate: r.winRate,
          total_profit_loss: r.totalProfitLoss,
          total_return: r.totalReturn,
          average_win: r.averageWin,
          average_loss: r.averageLoss,
          largest_win: r.largestWin,
          largest_loss: r.largestLoss,
          max_drawdown: r.maxDrawdown,
          max_drawdown_duration: r.maxDrawdownDuration,
          sharpe_ratio: r.sharpeRatio,
          sortino_ratio: r.sortinoRatio,
          profit_factor: r.profitFactor,
          average_hold_time: r.averageHoldTime,
          longest_winning_streak: r.longestWinningStreak,
          longest_losing_streak: r.longestLosingStreak,
          equity_curve: r.equityCurve,
          executed_at: new Date(r.executedAt * 1000).toISOString(),
          execution_time_ms: r.executionTimeMs,
          synced_at: new Date().toISOString(),
        }));

        const { error: runError } = await this.client
          .from('backtest_runs')
          .upsert(runRecords, { onConflict: 'strategy_name,executed_at' });

        if (runError) throw runError;
      }

      await this.updateSyncMetadata('backtest_runs', Date.now());
      await this.updateSyncStatus('backtest_runs', 'idle');
      logger.debug('SupabaseSync', `Synced backtest data`);
    } catch (error) {
      await this.updateSyncStatus('backtest_runs', 'error', (error as Error).message);
      logger.error('SupabaseSync', 'Backtest sync failed', error as Error);
    }
  }

  /**
   * Sync token snapshots
   */
  private async syncTokenSnapshots(): Promise<void> {
    if (!this.client) return;

    const metadata = this.syncMetadata.get('token_snapshots');
    const lastSyncedAt = metadata?.lastSyncedAt || 0;

    try {
      await this.updateSyncStatus('token_snapshots', 'syncing');

      // Get recent snapshots
      const watchList = database.getSnapshotWatchList();
      if (watchList.length === 0) {
        await this.updateSyncStatus('token_snapshots', 'idle');
        return;
      }

      // Get snapshots for each watched token since last sync
      const allSnapshots: any[] = [];
      for (const token of watchList.slice(0, 10)) { // Limit to 10 tokens per sync
        const snapshots = database.getTokenSnapshots(token.mint, 10);
        allSnapshots.push(...snapshots.filter((s: any) => s.recordedAt > lastSyncedAt / 1000));
      }

      if (allSnapshots.length === 0) {
        await this.updateSyncStatus('token_snapshots', 'idle');
        return;
      }

      const records = allSnapshots.map(s => ({
        mint: s.mint,
        symbol: s.symbol,
        price_usd: s.priceUsd,
        price_sol: s.priceSol,
        volume_5m: s.volume5m,
        volume_1h: s.volume1h,
        volume_24h: s.volume24h,
        liquidity_usd: s.liquidityUsd,
        market_cap: s.marketCap,
        holder_count: s.holderCount,
        price_change_5m: s.priceChange5m,
        price_change_1h: s.priceChange1h,
        price_change_24h: s.priceChange24h,
        buys_5m: s.buys5m,
        sells_5m: s.sells5m,
        buys_1h: s.buys1h,
        sells_1h: s.sells1h,
        recorded_at: new Date(s.recordedAt * 1000).toISOString(),
        synced_at: new Date().toISOString(),
      }));

      const { error } = await this.client
        .from('token_snapshots')
        .upsert(records, { onConflict: 'mint,recorded_at' });

      if (error) throw error;

      await this.updateSyncMetadata('token_snapshots', Date.now());
      logger.debug('SupabaseSync', `Synced ${records.length} token snapshots`);
    } catch (error) {
      await this.updateSyncStatus('token_snapshots', 'error', (error as Error).message);
      logger.error('SupabaseSync', 'Token snapshots sync failed', error as Error);
    }
  }

  /**
   * Sync bot status (health metrics)
   */
  private async syncBotStatus(): Promise<void> {
    if (!this.client) return;

    try {
      const memUsage = process.memoryUsage();
      const uptime = process.uptime() * 1000;

      const record = {
        status: 'healthy',
        uptime_ms: Math.floor(uptime),
        memory_heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
        memory_heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
        memory_rss_mb: Math.round(memUsage.rss / 1024 / 1024),
        checks: {},
        version: '1.0.0',
        recorded_at: new Date().toISOString(),
      };

      const { error } = await this.client
        .from('bot_status')
        .insert(record);

      if (error) throw error;
    } catch (error) {
      logger.silentError('SupabaseSync', 'Bot status sync failed', error as Error);
    }
  }

  /**
   * Push a discovery immediately (real-time)
   */
  async pushDiscovery(discovery: {
    poolAddress: string;
    tokenMint: string;
    baseMint?: string;
    quoteMint?: string;
    source: string;
    initialLiquidityUsd?: number;
    initialPrice?: number;
  }): Promise<void> {
    if (!this.client || !this.initialized) return;

    try {
      const { error } = await this.client
        .from('pool_discovery')
        .upsert({
          pool_address: discovery.poolAddress,
          token_mint: discovery.tokenMint,
          base_mint: discovery.baseMint,
          quote_mint: discovery.quoteMint,
          source: discovery.source,
          initial_liquidity_usd: discovery.initialLiquidityUsd,
          initial_price: discovery.initialPrice,
          discovered_at: new Date().toISOString(),
          synced_at: new Date().toISOString(),
        }, { onConflict: 'pool_address' });

      if (error) throw error;
      logger.debug('SupabaseSync', `Pushed discovery for ${discovery.tokenMint}`);
    } catch (error) {
      logger.silentError('SupabaseSync', 'Push discovery failed', error as Error);
    }
  }

  /**
   * Push an alert immediately (real-time)
   */
  async pushAlert(alert: {
    mint: string;
    symbol?: string;
    chatId: string;
    alertType: string;
    riskScore?: number;
    riskLevel?: string;
    title?: string;
    description?: string;
    priority?: string;
  }): Promise<void> {
    if (!this.client || !this.initialized) return;

    try {
      const { error } = await this.client
        .from('alert_history')
        .insert({
          mint: alert.mint,
          symbol: alert.symbol,
          chat_id: alert.chatId,
          alert_type: alert.alertType,
          risk_score: alert.riskScore,
          risk_level: alert.riskLevel,
          title: alert.title,
          description: alert.description,
          priority: alert.priority || 'normal',
          sent_at: new Date().toISOString(),
          synced_at: new Date().toISOString(),
        });

      if (error) throw error;
      logger.debug('SupabaseSync', `Pushed alert for ${alert.symbol}`);
    } catch (error) {
      logger.silentError('SupabaseSync', 'Push alert failed', error as Error);
    }
  }

  /**
   * Update sync status
   */
  private async updateSyncStatus(
    tableName: string,
    status: 'idle' | 'syncing' | 'error',
    errorMessage?: string
  ): Promise<void> {
    if (!this.client) return;

    const metadata = this.syncMetadata.get(tableName) || {
      tableName,
      lastSyncedAt: 0,
      syncStatus: status,
    };

    metadata.syncStatus = status;
    metadata.errorMessage = errorMessage;
    this.syncMetadata.set(tableName, metadata);

    try {
      await this.client
        .from('sync_metadata')
        .update({
          sync_status: status,
          error_message: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq('table_name', tableName);
    } catch (error) {
      logger.silentError('SupabaseSync', 'Update sync status failed', error as Error);
    }
  }

  /**
   * Update sync metadata after successful sync
   */
  private async updateSyncMetadata(tableName: string, lastSyncedAt: number): Promise<void> {
    if (!this.client) return;

    const metadata = this.syncMetadata.get(tableName) || {
      tableName,
      lastSyncedAt,
      syncStatus: 'idle' as const,
    };

    metadata.lastSyncedAt = lastSyncedAt;
    metadata.syncStatus = 'idle';
    metadata.errorMessage = undefined;
    this.syncMetadata.set(tableName, metadata);

    try {
      await this.client
        .from('sync_metadata')
        .update({
          last_synced_at: new Date(lastSyncedAt).toISOString(),
          sync_status: 'idle',
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('table_name', tableName);
    } catch (error) {
      logger.silentError('SupabaseSync', 'Update sync metadata failed', error as Error);
    }
  }

  /**
   * Get sync status for all tables
   */
  getSyncStatus(): Map<string, SyncMetadata> {
    return this.syncMetadata;
  }

  /**
   * Check if sync is enabled and connected
   */
  isConnected(): boolean {
    return this.initialized && this.client !== null;
  }

  /**
   * Stop all sync intervals
   */
  stop(): void {
    for (const [name, interval] of this.syncIntervals) {
      clearInterval(interval);
      logger.debug('SupabaseSync', `Stopped ${name} sync interval`);
    }
    this.syncIntervals.clear();
    this.initialized = false;
    logger.info('SupabaseSync', 'Stopped all sync intervals');
  }
}

export const supabaseSyncService = new SupabaseSyncService();
