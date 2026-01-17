/**
 * Database service for persistent storage
 * Uses sql.js (SQLite compiled to WebAssembly) for cross-platform compatibility
 */

import type { Database as SqlJsDatabase } from 'sql.js';
import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';
import { SCHEMA, MIGRATIONS } from './schema';
import { logger } from '../utils/logger';
import type {
  BacktestStrategy,
  BacktestResults,
  BacktestTrade,
  TokenWithOutcome
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

class DatabaseService {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;
  private initialized: boolean = false;
  private saveInterval: NodeJS.Timeout | null = null;
  private dirty: boolean = false;

  constructor() {
    this.dbPath = path.join(process.cwd(), 'data', 'bot.db');
  }

  /**
   * Initialize the database connection and create tables
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Initialize sql.js
      const SQL = await initSqlJs();

      // Load existing database or create new one
      if (fs.existsSync(this.dbPath)) {
        const fileBuffer = fs.readFileSync(this.dbPath);
        this.db = new SQL.Database(fileBuffer);
        logger.info('Database', `Loaded existing database from ${this.dbPath}`);
      } else {
        this.db = new SQL.Database();
        logger.info('Database', `Created new database at ${this.dbPath}`);
      }

      // Create tables
      this.db.run(SCHEMA);

      // Run migrations
      this.runMigrations();

      // Auto-save every 30 seconds if there are changes
      this.saveInterval = setInterval(() => {
        if (this.dirty) {
          this.saveToDisk();
        }
      }, 30000);

      this.initialized = true;
      logger.info('Database', 'Initialized successfully');
    } catch (error) {
      logger.error('Database', 'Failed to initialize', error as Error);
      throw error;
    }
  }

  /**
   * Save database to disk
   */
  private saveToDisk(): void {
    if (!this.db) return;

    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
      this.dirty = false;
      logger.debug('Database', 'Saved to disk');
    } catch (error) {
      logger.error('Database', 'Failed to save to disk', error as Error);
    }
  }

  /**
   * Run any pending migrations
   */
  private runMigrations(): void {
    if (!this.db) return;

    // Create migrations table if not exists
    this.db.run(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);

    // Get current version
    const result = this.db.exec('SELECT MAX(version) as version FROM migrations');
    const startVersion = result.length > 0 && result[0].values.length > 0
      ? (result[0].values[0][0] as number) ?? 0
      : 0;

    // Apply pending migrations
    for (const migration of MIGRATIONS) {
      if (migration.version > startVersion) {
        try {
          this.db.run(migration.sql);
          this.db.run(
            'INSERT INTO migrations (version, applied_at) VALUES (?, ?)',
            [migration.version, Math.floor(Date.now() / 1000)]
          );
          this.dirty = true;
          logger.info('Database', `Applied migration v${migration.version}`);
        } catch (error) {
          logger.error('Database', `Migration v${migration.version} failed`, error as Error);
          throw error;
        }
      }
    }
  }

  /**
   * Save a token analysis to the database
   */
  saveAnalysis(input: AnalysisInput): void {
    if (!this.db) return;

    try {
      this.db.run(`
        INSERT INTO token_analysis (
          mint, symbol, name, risk_score, risk_level,
          liquidity_usd, lp_burned_percent, lp_locked_percent,
          total_holders, top10_percent,
          mint_revoked, freeze_revoked, is_honeypot,
          has_twitter, has_telegram, has_website,
          source, analyzed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        input.tokenMint,
        input.symbol,
        input.name,
        input.riskScore,
        input.riskLevel,
        input.liquidityUsd,
        input.lpBurnedPercent,
        input.lpLockedPercent,
        input.holderCount,
        input.top10Percent,
        input.mintRevoked ? 1 : 0,
        input.freezeRevoked ? 1 : 0,
        input.isHoneypot ? 1 : 0,
        input.hasTwitter ? 1 : 0,
        input.hasTelegram ? 1 : 0,
        input.hasWebsite ? 1 : 0,
        input.source,
        Math.floor(Date.now() / 1000),
      ]);

      this.dirty = true;
      logger.debug('Database', `Saved analysis for ${input.symbol}`);
    } catch (error) {
      logger.silentError('Database', 'Failed to save analysis', error as Error);
    }
  }

  /**
   * Get recent analyses for sync
   */
  getRecentAnalyses(afterTimestamp: number, limit: number = 100): any[] {
    if (!this.db) return [];

    try {
      const result = this.db.exec(
        `SELECT * FROM token_analysis WHERE analyzed_at > ? ORDER BY analyzed_at ASC LIMIT ?`,
        [Math.floor(afterTimestamp / 1000), limit]
      );

      if (result.length === 0) return [];

      const columns = result[0].columns;
      return result[0].values.map(values => {
        const row: any = {};
        columns.forEach((col, i) => {
          row[col] = values[i];
        });
        return row;
      });
    } catch (error) {
      logger.silentError('Database', 'Failed to get recent analyses', error as Error);
      return [];
    }
  }

  /**
   * Check if we've recently analyzed a token
   */
  wasRecentlyAnalyzed(mint: string, withinSeconds: number = 3600): boolean {
    if (!this.db) return false;

    try {
      const cutoff = Math.floor(Date.now() / 1000) - withinSeconds;
      const result = this.db.exec(
        'SELECT COUNT(*) as count FROM token_analysis WHERE mint = ? AND analyzed_at > ?',
        [mint, cutoff]
      );

      return result.length > 0 && result[0].values.length > 0 && (result[0].values[0][0] as number) > 0;
    } catch (error) {
      logger.silentError('Database', 'Failed to check recent analysis', error as Error);
      return false;
    }
  }

  /**
   * Save an alert to history
   */
  saveAlert(input: AlertInput): void {
    if (!this.db) return;

    try {
      this.db.run(`
        INSERT INTO alert_history (
          mint, symbol, chat_id, alert_type, risk_score, risk_level, sent_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        input.tokenMint,
        input.symbol,
        input.chatId,
        input.alertType,
        input.riskScore,
        input.riskLevel,
        Math.floor(Date.now() / 1000),
      ]);

      this.dirty = true;
    } catch (error) {
      logger.silentError('Database', 'Failed to save alert', error as Error);
    }
  }

  /**
   * Get recent alerts for sync
   */
  getRecentAlerts(afterTimestamp: number, limit: number = 100): any[] {
    if (!this.db) return [];

    try {
      const result = this.db.exec(
        `SELECT * FROM alert_history WHERE sent_at > ? ORDER BY sent_at ASC LIMIT ?`,
        [Math.floor(afterTimestamp / 1000), limit]
      );

      if (result.length === 0) return [];

      const columns = result[0].columns;
      return result[0].values.map(values => {
        const row: any = {};
        columns.forEach((col, i) => {
          row[col] = values[i];
        });
        return row;
      });
    } catch (error) {
      logger.silentError('Database', 'Failed to get recent alerts', error as Error);
      return [];
    }
  }

  /**
   * Check if alert was already sent for this token to this chat
   */
  wasAlertSent(mint: string, chatId: string, alertType: string, withinSeconds: number = 86400): boolean {
    if (!this.db) return false;

    try {
      const cutoff = Math.floor(Date.now() / 1000) - withinSeconds;
      const result = this.db.exec(
        'SELECT COUNT(*) as count FROM alert_history WHERE mint = ? AND chat_id = ? AND alert_type = ? AND sent_at > ?',
        [mint, chatId, alertType, cutoff]
      );

      return result.length > 0 && result[0].values.length > 0 && (result[0].values[0][0] as number) > 0;
    } catch (error) {
      logger.silentError('Database', 'Failed to check alert history', error as Error);
      return false;
    }
  }

  /**
   * Get ML training data
   */
  getMLTrainingData(limit: number = 10000): any[] {
    if (!this.db) return [];

    try {
      const result = this.db.exec(`
        SELECT
          ta.*,
          toc.outcome,
          toc.peak_price_multiplier
        FROM token_analysis ta
        LEFT JOIN token_outcomes toc ON ta.mint = toc.mint
        WHERE toc.outcome IS NOT NULL
          AND toc.outcome != 'unknown'
        ORDER BY ta.analyzed_at DESC
        LIMIT ?
      `, [limit]);

      if (result.length === 0) return [];

      // Convert to array of objects
      const columns = result[0].columns;
      return result[0].values.map(row => {
        const obj: any = {};
        columns.forEach((col, i) => {
          obj[col] = row[i];
        });
        return obj;
      });
    } catch (error) {
      logger.silentError('Database', 'Failed to get ML training data', error as Error);
      return [];
    }
  }

  /**
   * Get database statistics
   */
  getStats(): {
    totalAnalyses: number;
    totalAlerts: number;
    alertsToday: number;
    dbSizeBytes: number;
  } {
    if (!this.db) {
      return { totalAnalyses: 0, totalAlerts: 0, alertsToday: 0, dbSizeBytes: 0 };
    }

    try {
      const analysesResult = this.db.exec('SELECT COUNT(*) FROM token_analysis');
      const alertsResult = this.db.exec('SELECT COUNT(*) FROM alert_history');

      const todayCutoff = Math.floor(Date.now() / 1000) - 86400;
      const alertsTodayResult = this.db.exec(
        'SELECT COUNT(*) FROM alert_history WHERE sent_at > ?',
        [todayCutoff]
      );

      let dbSizeBytes = 0;
      if (fs.existsSync(this.dbPath)) {
        dbSizeBytes = fs.statSync(this.dbPath).size;
      }

      return {
        totalAnalyses: analysesResult.length > 0 ? (analysesResult[0].values[0][0] as number) : 0,
        totalAlerts: alertsResult.length > 0 ? (alertsResult[0].values[0][0] as number) : 0,
        alertsToday: alertsTodayResult.length > 0 ? (alertsTodayResult[0].values[0][0] as number) : 0,
        dbSizeBytes,
      };
    } catch (error) {
      logger.silentError('Database', 'Failed to get stats', error as Error);
      return { totalAnalyses: 0, totalAlerts: 0, alertsToday: 0, dbSizeBytes: 0 };
    }
  }

  /**
   * Get recent pool discoveries for sync
   */
  getRecentDiscoveries(afterTimestamp: number, limit: number = 100): any[] {
    if (!this.db) return [];

    try {
      const result = this.db.exec(
        `SELECT * FROM pool_discovery WHERE discovered_at > ? ORDER BY discovered_at ASC LIMIT ?`,
        [Math.floor(afterTimestamp / 1000), limit]
      );

      if (result.length === 0) return [];

      const columns = result[0].columns;
      return result[0].values.map(values => {
        const row: any = {};
        columns.forEach((col, i) => {
          row[col] = values[i];
        });
        return row;
      });
    } catch (error) {
      logger.silentError('Database', 'Failed to get recent discoveries', error as Error);
      return [];
    }
  }

  /**
   * Cleanup old data to keep database size manageable
   */
  cleanup(keepDays: number = 30): void {
    if (!this.db) return;

    const cutoff = Math.floor(Date.now() / 1000) - (keepDays * 24 * 60 * 60);

    try {
      this.db.run('DELETE FROM watchlist_price_history WHERE recorded_at < ?', [cutoff]);

      const poolCutoff = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
      this.db.run('DELETE FROM pool_discovery WHERE discovered_at < ?', [poolCutoff]);

      this.dirty = true;
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
  getTokensWithOutcomes(startDate: number, endDate: number): TokenWithOutcome[] {
    if (!this.db) return [];

    try {
      const result = this.db.exec(`
        SELECT
          toc.mint,
          toc.symbol,
          toc.initial_price,
          toc.initial_liquidity,
          toc.initial_risk_score,
          toc.initial_holders,
          toc.initial_top10_percent,
          toc.peak_price,
          toc.peak_liquidity,
          toc.final_price,
          toc.final_liquidity,
          toc.outcome,
          toc.peak_price_multiplier,
          toc.time_to_peak,
          toc.discovered_at,
          toc.peak_at,
          toc.outcome_recorded_at,
          ta.mint_revoked,
          ta.freeze_revoked,
          ta.lp_burned_percent,
          ta.has_twitter,
          ta.has_telegram,
          ta.has_website
        FROM token_outcomes toc
        LEFT JOIN token_analysis ta ON toc.mint = ta.mint
        WHERE toc.discovered_at >= ? AND toc.discovered_at <= ?
          AND toc.outcome IS NOT NULL
          AND toc.initial_price > 0
          AND toc.peak_price > 0
        ORDER BY toc.discovered_at ASC
      `, [startDate, endDate]);

      if (result.length === 0) return [];

      const columns = result[0].columns;
      return result[0].values.map(row => {
        const obj: any = {};
        columns.forEach((col, i) => {
          obj[col] = row[i];
        });

        return {
          mint: obj.mint,
          symbol: obj.symbol,
          initialPrice: obj.initial_price || 0,
          initialLiquidity: obj.initial_liquidity || 0,
          initialRiskScore: obj.initial_risk_score || 0,
          initialHolders: obj.initial_holders || 0,
          initialTop10Percent: obj.initial_top10_percent,
          peakPrice: obj.peak_price || obj.initial_price,
          peakLiquidity: obj.peak_liquidity,
          finalPrice: obj.final_price || obj.initial_price,
          finalLiquidity: obj.final_liquidity,
          outcome: obj.outcome || 'unknown',
          peakMultiplier: obj.peak_price_multiplier || 1,
          timeToPeak: obj.time_to_peak,
          discoveredAt: obj.discovered_at,
          peakAt: obj.peak_at,
          outcomeRecordedAt: obj.outcome_recorded_at,
          mintRevoked: obj.mint_revoked === 1,
          freezeRevoked: obj.freeze_revoked === 1,
          lpBurned: (obj.lp_burned_percent || 0) > 50,
          lpBurnedPercent: obj.lp_burned_percent,
          hasTwitter: obj.has_twitter === 1,
          hasTelegram: obj.has_telegram === 1,
          hasWebsite: obj.has_website === 1,
        } as TokenWithOutcome;
      });
    } catch (error) {
      logger.error('Database', 'Failed to get tokens with outcomes', error as Error);
      return [];
    }
  }

  /**
   * Save a backtest strategy
   */
  saveBacktestStrategy(strategy: BacktestStrategy): number {
    if (!this.db) return 0;

    try {
      const now = Math.floor(Date.now() / 1000);

      this.db.run(`
        INSERT OR REPLACE INTO backtest_strategies (
          name, description, entry_conditions, exit_conditions,
          position_sizing, is_preset, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        strategy.name,
        strategy.description,
        JSON.stringify(strategy.entry),
        JSON.stringify(strategy.exit),
        JSON.stringify(strategy.sizing),
        strategy.isPreset ? 1 : 0,
        strategy.createdAt ?? now,
        now,
      ]);

      this.dirty = true;

      // Get the ID
      const result = this.db.exec('SELECT last_insert_rowid()');
      return result.length > 0 ? (result[0].values[0][0] as number) : 0;
    } catch (error) {
      logger.error('Database', 'Failed to save backtest strategy', error as Error);
      return 0;
    }
  }

  /**
   * Get a backtest strategy by name
   */
  getBacktestStrategy(name: string): BacktestStrategy | null {
    if (!this.db) return null;

    try {
      const result = this.db.exec(
        'SELECT * FROM backtest_strategies WHERE name = ?',
        [name]
      );

      if (result.length === 0 || result[0].values.length === 0) return null;

      const columns = result[0].columns;
      const row: any = {};
      columns.forEach((col, i) => {
        row[col] = result[0].values[0][i];
      });

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        entry: JSON.parse(row.entry_conditions),
        exit: JSON.parse(row.exit_conditions),
        sizing: JSON.parse(row.position_sizing),
        isPreset: row.is_preset === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } catch (error) {
      logger.error('Database', 'Failed to get backtest strategy', error as Error);
      return null;
    }
  }

  /**
   * Get all backtest strategies
   */
  getAllBacktestStrategies(): BacktestStrategy[] {
    if (!this.db) return [];

    try {
      const result = this.db.exec('SELECT * FROM backtest_strategies ORDER BY name');

      if (result.length === 0) return [];

      const columns = result[0].columns;
      return result[0].values.map(values => {
        const row: any = {};
        columns.forEach((col, i) => {
          row[col] = values[i];
        });

        return {
          id: row.id,
          name: row.name,
          description: row.description,
          entry: JSON.parse(row.entry_conditions),
          exit: JSON.parse(row.exit_conditions),
          sizing: JSON.parse(row.position_sizing),
          isPreset: row.is_preset === 1,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      });
    } catch (error) {
      logger.error('Database', 'Failed to get all backtest strategies', error as Error);
      return [];
    }
  }

  /**
   * Save backtest run results
   */
  saveBacktestRun(results: BacktestResults, trades: BacktestTrade[]): number {
    if (!this.db) return 0;

    try {
      this.db.run(`
        INSERT INTO backtest_runs (
          strategy_id, strategy_name, start_date, end_date, days_analyzed,
          initial_capital, final_capital, total_trades, winning_trades, losing_trades,
          win_rate, total_profit_loss, total_return, average_win, average_loss,
          largest_win, largest_loss, max_drawdown, max_drawdown_duration,
          sharpe_ratio, sortino_ratio, profit_factor, average_hold_time,
          longest_winning_streak, longest_losing_streak, equity_curve,
          executed_at, execution_time_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        results.strategyId,
        results.strategyName,
        results.startDate,
        results.endDate,
        results.daysAnalyzed,
        results.initialCapital,
        results.finalCapital,
        results.totalTrades,
        results.winningTrades,
        results.losingTrades,
        results.winRate,
        results.totalProfitLoss,
        results.totalReturn,
        results.averageWin,
        results.averageLoss,
        results.largestWin,
        results.largestLoss,
        results.maxDrawdown,
        results.maxDrawdownDuration,
        results.sharpeRatio,
        results.sortinoRatio,
        results.profitFactor,
        results.averageHoldTime,
        results.longestWinningStreak,
        results.longestLosingStreak,
        JSON.stringify(results.equityCurve),
        results.executedAt,
        results.executionTimeMs,
      ]);

      this.dirty = true;

      // Get the run ID
      const idResult = this.db.exec('SELECT last_insert_rowid()');
      const runId = idResult.length > 0 ? (idResult[0].values[0][0] as number) : 0;

      // Save trades
      for (const trade of trades) {
        this.db.run(`
          INSERT INTO backtest_trades (
            run_id, token_mint, token_symbol, token_name,
            entry_price, entry_time, position_size,
            exit_price, exit_time, exit_reason,
            profit_loss, profit_loss_percent, hold_time_seconds,
            peak_price, peak_multiplier,
            entry_risk_score, entry_liquidity, entry_holders
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          runId,
          trade.tokenMint,
          trade.tokenSymbol,
          trade.tokenName ?? null,
          trade.entryPrice,
          trade.entryTime,
          trade.positionSize,
          trade.exitPrice,
          trade.exitTime,
          trade.exitReason,
          trade.profitLoss,
          trade.profitLossPercent,
          trade.holdTimeSeconds,
          trade.peakPrice,
          trade.peakMultiplier,
          trade.entryRiskScore ?? null,
          trade.entryLiquidity ?? null,
          trade.entryHolders ?? null,
        ]);
      }

      return runId;
    } catch (error) {
      logger.error('Database', 'Failed to save backtest run', error as Error);
      return 0;
    }
  }

  /**
   * Get backtest run by ID
   */
  getBacktestRun(runId: number): BacktestResults | null {
    if (!this.db) return null;

    try {
      const result = this.db.exec('SELECT * FROM backtest_runs WHERE id = ?', [runId]);

      if (result.length === 0 || result[0].values.length === 0) return null;

      const columns = result[0].columns;
      const row: any = {};
      columns.forEach((col, i) => {
        row[col] = result[0].values[0][i];
      });

      return {
        id: row.id,
        strategyId: row.strategy_id,
        strategyName: row.strategy_name,
        startDate: row.start_date,
        endDate: row.end_date,
        daysAnalyzed: row.days_analyzed,
        initialCapital: row.initial_capital,
        finalCapital: row.final_capital,
        totalTrades: row.total_trades,
        winningTrades: row.winning_trades,
        losingTrades: row.losing_trades,
        winRate: row.win_rate,
        totalProfitLoss: row.total_profit_loss,
        totalReturn: row.total_return,
        averageWin: row.average_win,
        averageLoss: row.average_loss,
        largestWin: row.largest_win,
        largestLoss: row.largest_loss,
        maxDrawdown: row.max_drawdown,
        maxDrawdownDuration: row.max_drawdown_duration,
        sharpeRatio: row.sharpe_ratio,
        sortinoRatio: row.sortino_ratio,
        profitFactor: row.profit_factor,
        averageHoldTime: row.average_hold_time,
        longestWinningStreak: row.longest_winning_streak,
        longestLosingStreak: row.longest_losing_streak,
        equityCurve: JSON.parse(row.equity_curve || '[]'),
        executedAt: row.executed_at,
        executionTimeMs: row.execution_time_ms,
      };
    } catch (error) {
      logger.error('Database', 'Failed to get backtest run', error as Error);
      return null;
    }
  }

  /**
   * Get trades for a backtest run
   */
  getBacktestTrades(runId: number, limit: number = 100): BacktestTrade[] {
    if (!this.db) return [];

    try {
      const result = this.db.exec(
        'SELECT * FROM backtest_trades WHERE run_id = ? ORDER BY entry_time LIMIT ?',
        [runId, limit]
      );

      if (result.length === 0) return [];

      const columns = result[0].columns;
      return result[0].values.map(values => {
        const row: any = {};
        columns.forEach((col, i) => {
          row[col] = values[i];
        });

        return {
          id: row.id,
          runId: row.run_id,
          tokenMint: row.token_mint,
          tokenSymbol: row.token_symbol,
          tokenName: row.token_name,
          entryPrice: row.entry_price,
          entryTime: row.entry_time,
          positionSize: row.position_size,
          exitPrice: row.exit_price,
          exitTime: row.exit_time,
          exitReason: row.exit_reason,
          profitLoss: row.profit_loss,
          profitLossPercent: row.profit_loss_percent,
          holdTimeSeconds: row.hold_time_seconds,
          peakPrice: row.peak_price,
          peakMultiplier: row.peak_multiplier,
          entryRiskScore: row.entry_risk_score,
          entryLiquidity: row.entry_liquidity,
          entryHolders: row.entry_holders,
        };
      });
    } catch (error) {
      logger.error('Database', 'Failed to get backtest trades', error as Error);
      return [];
    }
  }

  /**
   * Get recent backtest runs
   */
  getRecentBacktestRuns(limit: number = 10): BacktestResults[] {
    if (!this.db) return [];

    try {
      const result = this.db.exec(
        'SELECT * FROM backtest_runs ORDER BY executed_at DESC LIMIT ?',
        [limit]
      );

      if (result.length === 0) return [];

      const columns = result[0].columns;
      return result[0].values.map(values => {
        const row: any = {};
        columns.forEach((col, i) => {
          row[col] = values[i];
        });

        return {
          id: row.id,
          strategyId: row.strategy_id,
          strategyName: row.strategy_name,
          startDate: row.start_date,
          endDate: row.end_date,
          daysAnalyzed: row.days_analyzed,
          initialCapital: row.initial_capital,
          finalCapital: row.final_capital,
          totalTrades: row.total_trades,
          winningTrades: row.winning_trades,
          losingTrades: row.losing_trades,
          winRate: row.win_rate,
          totalProfitLoss: row.total_profit_loss,
          totalReturn: row.total_return,
          averageWin: row.average_win,
          averageLoss: row.average_loss,
          largestWin: row.largest_win,
          largestLoss: row.largest_loss,
          maxDrawdown: row.max_drawdown,
          maxDrawdownDuration: row.max_drawdown_duration,
          sharpeRatio: row.sharpe_ratio,
          sortinoRatio: row.sortino_ratio,
          profitFactor: row.profit_factor,
          averageHoldTime: row.average_hold_time,
          longestWinningStreak: row.longest_winning_streak,
          longestLosingStreak: row.longest_losing_streak,
          equityCurve: JSON.parse(row.equity_curve || '[]'),
          executedAt: row.executed_at,
          executionTimeMs: row.execution_time_ms,
        };
      });
    } catch (error) {
      logger.error('Database', 'Failed to get recent backtest runs', error as Error);
      return [];
    }
  }

  /**
   * Delete a backtest strategy
   */
  deleteBacktestStrategy(name: string): void {
    if (!this.db) return;

    try {
      this.db.run('DELETE FROM backtest_strategies WHERE name = ? AND is_preset = 0', [name]);
      this.dirty = true;
    } catch (error) {
      logger.error('Database', 'Failed to delete backtest strategy', error as Error);
    }
  }

  // ============================================
  // Snapshot Methods
  // ============================================

  /**
   * Save a token snapshot
   */
  saveTokenSnapshot(snapshot: {
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
  }): void {
    if (!this.db) return;

    try {
      this.db.run(`
        INSERT OR REPLACE INTO token_snapshots (
          mint, symbol, price_usd, price_sol,
          volume_5m, volume_1h, volume_24h,
          liquidity_usd, market_cap, holder_count,
          price_change_5m, price_change_1h, price_change_24h,
          buys_5m, sells_5m, buys_1h, sells_1h,
          recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        snapshot.mint,
        snapshot.symbol ?? null,
        snapshot.priceUsd,
        snapshot.priceSol ?? null,
        snapshot.volume5m ?? null,
        snapshot.volume1h ?? null,
        snapshot.volume24h ?? null,
        snapshot.liquidityUsd ?? null,
        snapshot.marketCap ?? null,
        snapshot.holderCount ?? null,
        snapshot.priceChange5m ?? null,
        snapshot.priceChange1h ?? null,
        snapshot.priceChange24h ?? null,
        snapshot.buys5m ?? null,
        snapshot.sells5m ?? null,
        snapshot.buys1h ?? null,
        snapshot.sells1h ?? null,
        snapshot.recordedAt,
      ]);
      this.dirty = true;
    } catch (error) {
      logger.silentError('Database', 'Failed to save token snapshot', error as Error);
    }
  }

  /**
   * Get token snapshots
   */
  getTokenSnapshots(mint: string, limit: number = 288): any[] {
    if (!this.db) return [];

    try {
      const result = this.db.exec(
        'SELECT * FROM token_snapshots WHERE mint = ? ORDER BY recorded_at DESC LIMIT ?',
        [mint, limit]
      );

      if (result.length === 0) return [];

      const columns = result[0].columns;
      return result[0].values.map(values => {
        const row: any = {};
        columns.forEach((col, i) => {
          row[col] = values[i];
        });
        return {
          mint: row.mint,
          symbol: row.symbol,
          priceUsd: row.price_usd,
          priceSol: row.price_sol,
          volume5m: row.volume_5m,
          volume1h: row.volume_1h,
          volume24h: row.volume_24h,
          liquidityUsd: row.liquidity_usd,
          marketCap: row.market_cap,
          holderCount: row.holder_count,
          priceChange5m: row.price_change_5m,
          priceChange1h: row.price_change_1h,
          priceChange24h: row.price_change_24h,
          buys5m: row.buys_5m,
          sells5m: row.sells_5m,
          buys1h: row.buys_1h,
          sells1h: row.sells_1h,
          recordedAt: row.recorded_at,
        };
      });
    } catch (error) {
      logger.silentError('Database', 'Failed to get token snapshots', error as Error);
      return [];
    }
  }

  /**
   * Get token snapshots within a time range
   */
  getTokenSnapshotsInRange(mint: string, startTime: number, endTime: number): any[] {
    if (!this.db) return [];

    try {
      const result = this.db.exec(
        'SELECT * FROM token_snapshots WHERE mint = ? AND recorded_at >= ? AND recorded_at <= ? ORDER BY recorded_at ASC',
        [mint, startTime, endTime]
      );

      if (result.length === 0) return [];

      const columns = result[0].columns;
      return result[0].values.map(values => {
        const row: any = {};
        columns.forEach((col, i) => {
          row[col] = values[i];
        });
        return {
          mint: row.mint,
          symbol: row.symbol,
          priceUsd: row.price_usd,
          priceSol: row.price_sol,
          volume5m: row.volume_5m,
          volume1h: row.volume_1h,
          volume24h: row.volume_24h,
          liquidityUsd: row.liquidity_usd,
          marketCap: row.market_cap,
          holderCount: row.holder_count,
          priceChange5m: row.price_change_5m,
          priceChange1h: row.price_change_1h,
          priceChange24h: row.price_change_24h,
          buys5m: row.buys_5m,
          sells5m: row.sells_5m,
          buys1h: row.buys_1h,
          sells1h: row.sells_1h,
          recordedAt: row.recorded_at,
        };
      });
    } catch (error) {
      logger.silentError('Database', 'Failed to get token snapshots in range', error as Error);
      return [];
    }
  }

  /**
   * Add token to snapshot watch list
   */
  addToSnapshotWatchList(mint: string, symbol?: string, expiresAt?: number): void {
    if (!this.db) return;

    try {
      const now = Math.floor(Date.now() / 1000);
      this.db.run(`
        INSERT OR REPLACE INTO snapshot_watch_list (
          mint, symbol, added_at, is_active, expires_at
        ) VALUES (?, ?, ?, 1, ?)
      `, [mint, symbol ?? null, now, expiresAt ?? null]);
      this.dirty = true;
    } catch (error) {
      logger.silentError('Database', 'Failed to add to snapshot watch list', error as Error);
    }
  }

  /**
   * Remove token from snapshot watch list
   */
  removeFromSnapshotWatchList(mint: string): void {
    if (!this.db) return;

    try {
      this.db.run('UPDATE snapshot_watch_list SET is_active = 0 WHERE mint = ?', [mint]);
      this.dirty = true;
    } catch (error) {
      logger.silentError('Database', 'Failed to remove from snapshot watch list', error as Error);
    }
  }

  /**
   * Get snapshot watch list
   */
  getSnapshotWatchList(): any[] {
    if (!this.db) return [];

    try {
      const result = this.db.exec('SELECT * FROM snapshot_watch_list WHERE is_active = 1');

      if (result.length === 0) return [];

      const columns = result[0].columns;
      return result[0].values.map(values => {
        const row: any = {};
        columns.forEach((col, i) => {
          row[col] = values[i];
        });
        return {
          mint: row.mint,
          symbol: row.symbol,
          addedAt: row.added_at,
          lastSnapshotAt: row.last_snapshot_at,
          snapshotCount: row.snapshot_count,
          isActive: row.is_active === 1,
          expiresAt: row.expires_at,
        };
      });
    } catch (error) {
      logger.silentError('Database', 'Failed to get snapshot watch list', error as Error);
      return [];
    }
  }

  /**
   * Update snapshot watch entry after collecting a snapshot
   */
  updateSnapshotWatchEntry(mint: string): void {
    if (!this.db) return;

    try {
      const now = Math.floor(Date.now() / 1000);
      this.db.run(`
        UPDATE snapshot_watch_list
        SET last_snapshot_at = ?, snapshot_count = snapshot_count + 1
        WHERE mint = ?
      `, [now, mint]);
      this.dirty = true;
    } catch (error) {
      logger.silentError('Database', 'Failed to update snapshot watch entry', error as Error);
    }
  }

  /**
   * Clean up expired snapshot watches
   */
  cleanupExpiredSnapshotWatches(now: number): void {
    if (!this.db) return;

    try {
      this.db.run(
        'UPDATE snapshot_watch_list SET is_active = 0 WHERE expires_at IS NOT NULL AND expires_at < ?',
        [now]
      );
      this.dirty = true;
    } catch (error) {
      logger.silentError('Database', 'Failed to cleanup expired snapshot watches', error as Error);
    }
  }

  /**
   * Get snapshot statistics
   */
  getSnapshotStats(): { totalSnapshots: number; watchedTokens: number } {
    if (!this.db) return { totalSnapshots: 0, watchedTokens: 0 };

    try {
      const snapshotsResult = this.db.exec('SELECT COUNT(*) FROM token_snapshots');
      const watchedResult = this.db.exec('SELECT COUNT(*) FROM snapshot_watch_list WHERE is_active = 1');

      return {
        totalSnapshots: snapshotsResult.length > 0 ? (snapshotsResult[0].values[0][0] as number) : 0,
        watchedTokens: watchedResult.length > 0 ? (watchedResult[0].values[0][0] as number) : 0,
      };
    } catch (error) {
      logger.silentError('Database', 'Failed to get snapshot stats', error as Error);
      return { totalSnapshots: 0, watchedTokens: 0 };
    }
  }

  // ============================================
  // Outcome Tracking Methods
  // ============================================

  /**
   * Save initial token outcome state (when first discovered)
   */
  saveTokenOutcomeInitial(data: {
    mint: string;
    symbol: string;
    initialPrice: number;
    initialLiquidity: number;
    initialRiskScore: number;
    initialHolders: number;
    initialTop10Percent?: number;
    discoveredAt: number;
  }): void {
    if (!this.db) return;

    try {
      this.db.run(`
        INSERT OR IGNORE INTO token_outcomes (
          mint, symbol, initial_price, initial_liquidity, initial_risk_score,
          initial_holders, initial_top10_percent, discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        data.mint,
        data.symbol,
        data.initialPrice,
        data.initialLiquidity,
        data.initialRiskScore,
        data.initialHolders,
        data.initialTop10Percent ?? null,
        data.discoveredAt,
      ]);

      this.dirty = true;
    } catch (error) {
      logger.error('Database', 'Failed to save initial token outcome', error as Error);
    }
  }

  /**
   * Save final token outcome (when outcome is classified)
   */
  saveTokenOutcomeFinal(data: {
    mint: string;
    symbol: string;
    outcome: string;
    outcomeConfidence: number;
    peakPrice: number;
    peakLiquidity?: number;
    peakHolders?: number;
    finalPrice: number;
    finalLiquidity?: number;
    finalHolders?: number;
    peakMultiplier: number;
    timeToPeak?: number;
    timeToOutcome: number;
    peakAt?: number;
    outcomeRecordedAt: number;
  }): void {
    if (!this.db) return;

    try {
      this.db.run(`
        UPDATE token_outcomes SET
          outcome = ?,
          outcome_confidence = ?,
          peak_price = ?,
          peak_liquidity = ?,
          peak_holders = ?,
          final_price = ?,
          final_liquidity = ?,
          final_holders = ?,
          peak_price_multiplier = ?,
          time_to_peak = ?,
          time_to_outcome = ?,
          peak_at = ?,
          outcome_recorded_at = ?
        WHERE mint = ?
      `, [
        data.outcome,
        data.outcomeConfidence,
        data.peakPrice,
        data.peakLiquidity ?? null,
        data.peakHolders ?? null,
        data.finalPrice,
        data.finalLiquidity ?? null,
        data.finalHolders ?? null,
        data.peakMultiplier,
        data.timeToPeak ?? null,
        data.timeToOutcome,
        data.peakAt ?? null,
        data.outcomeRecordedAt,
        data.mint,
      ]);

      this.dirty = true;
      logger.debug('Database', `Saved outcome for ${data.symbol}: ${data.outcome}`);
    } catch (error) {
      logger.error('Database', 'Failed to save token outcome', error as Error);
    }
  }

  /**
   * Get pending outcomes (tokens tracked but not yet classified)
   */
  getPendingOutcomes(): Array<{
    mint: string;
    symbol: string;
    initialPrice: number;
    initialLiquidity: number;
    initialRiskScore: number;
    initialHolders: number;
    initialTop10Percent?: number;
    peakPrice?: number;
    peakLiquidity?: number;
    peakHolders?: number;
    finalPrice?: number;
    finalLiquidity?: number;
    finalHolders?: number;
    discoveredAt: number;
    peakAt?: number;
  }> {
    if (!this.db) return [];

    try {
      const result = this.db.exec(`
        SELECT * FROM token_outcomes
        WHERE outcome IS NULL
        ORDER BY discovered_at DESC
      `);

      if (result.length === 0) return [];

      const columns = result[0].columns;
      return result[0].values.map(values => {
        const row: any = {};
        columns.forEach((col, i) => {
          row[col] = values[i];
        });

        return {
          mint: row.mint,
          symbol: row.symbol,
          initialPrice: row.initial_price || 0,
          initialLiquidity: row.initial_liquidity || 0,
          initialRiskScore: row.initial_risk_score || 0,
          initialHolders: row.initial_holders || 0,
          initialTop10Percent: row.initial_top10_percent,
          peakPrice: row.peak_price,
          peakLiquidity: row.peak_liquidity,
          peakHolders: row.peak_holders,
          finalPrice: row.final_price,
          finalLiquidity: row.final_liquidity,
          finalHolders: row.final_holders,
          discoveredAt: row.discovered_at,
          peakAt: row.peak_at,
        };
      });
    } catch (error) {
      logger.error('Database', 'Failed to get pending outcomes', error as Error);
      return [];
    }
  }

  /**
   * Get outcome statistics
   */
  getOutcomeStats(): {
    total: number;
    byOutcome: Record<string, number>;
    avgPeakMultiplier: number;
  } {
    if (!this.db) return { total: 0, byOutcome: {}, avgPeakMultiplier: 0 };

    try {
      const totalResult = this.db.exec('SELECT COUNT(*) FROM token_outcomes WHERE outcome IS NOT NULL');
      const total = totalResult.length > 0 ? (totalResult[0].values[0][0] as number) : 0;

      const byOutcomeResult = this.db.exec(`
        SELECT outcome, COUNT(*) as count
        FROM token_outcomes
        WHERE outcome IS NOT NULL
        GROUP BY outcome
      `);

      const byOutcome: Record<string, number> = {};
      if (byOutcomeResult.length > 0) {
        for (const row of byOutcomeResult[0].values) {
          byOutcome[row[0] as string] = row[1] as number;
        }
      }

      const avgResult = this.db.exec(`
        SELECT AVG(peak_price_multiplier)
        FROM token_outcomes
        WHERE outcome IS NOT NULL AND peak_price_multiplier IS NOT NULL
      `);
      const avgPeakMultiplier = avgResult.length > 0 && avgResult[0].values[0][0]
        ? (avgResult[0].values[0][0] as number)
        : 0;

      return { total, byOutcome, avgPeakMultiplier };
    } catch (error) {
      logger.error('Database', 'Failed to get outcome stats', error as Error);
      return { total: 0, byOutcome: {}, avgPeakMultiplier: 0 };
    }
  }

  /**
   * Clean up old token outcomes
   */
  cleanupOldOutcomes(cutoffTimestamp: number): { deletedCount: number } {
    if (!this.db) return { deletedCount: 0 };

    try {
      // Get count before deletion
      const countResult = this.db.exec(
        'SELECT COUNT(*) FROM token_outcomes WHERE outcome_recorded_at IS NOT NULL AND outcome_recorded_at < ?',
        [cutoffTimestamp]
      );
      const count = countResult.length > 0 ? (countResult[0].values[0][0] as number) : 0;

      // Delete old records
      this.db.run(
        'DELETE FROM token_outcomes WHERE outcome_recorded_at IS NOT NULL AND outcome_recorded_at < ?',
        [cutoffTimestamp]
      );

      if (count > 0) {
        this.dirty = true;
      }

      return { deletedCount: count };
    } catch (error) {
      logger.silentError('Database', 'Failed to clean up old outcomes', error as Error);
      return { deletedCount: 0 };
    }
  }

  /**
   * Clean up old token snapshots
   */
  cleanupOldSnapshots(cutoffTimestamp: number): { deletedCount: number } {
    if (!this.db) return { deletedCount: 0 };

    try {
      // Get count before deletion
      const countResult = this.db.exec(
        'SELECT COUNT(*) FROM token_snapshots WHERE recorded_at < ?',
        [cutoffTimestamp]
      );
      const count = countResult.length > 0 ? (countResult[0].values[0][0] as number) : 0;

      // Delete old records
      this.db.run('DELETE FROM token_snapshots WHERE recorded_at < ?', [cutoffTimestamp]);

      if (count > 0) {
        this.dirty = true;
      }

      return { deletedCount: count };
    } catch (error) {
      logger.silentError('Database', 'Failed to clean up old snapshots', error as Error);
      return { deletedCount: 0 };
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    if (this.db) {
      // Final save before closing
      this.saveToDisk();
      this.db.close();
      this.db = null;
      this.initialized = false;
      logger.info('Database', 'Connection closed');
    }
  }
}

// Export singleton instance
export const database = new DatabaseService();

// Export class for testing
export { DatabaseService };
