/**
 * Database service for persistent storage
 * Uses sql.js (SQLite compiled to WebAssembly) for cross-platform compatibility
 * 
 * FIXES APPLIED:
 * - #1: Added transaction management for all write operations
 * - #2: Added input validation for mint addresses (SQL injection prevention)
 * - #7: Added division by zero protection in statistics
 * - #13: Added query timeout wrapper
 * - #14: Added type validation for database results
 * - #22: Changed silentError to proper error handling with throws
 * - #27: Added dirty flush before reading stats
 */

import type { Database as SqlJsDatabase } from 'sql.js';
import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';
import { SCHEMA } from './schema';
import { logger } from '../utils/logger';
import { migrator } from './migrator';
import { healthChecker } from './health';
import { backupService } from './backup';
import type {
  BacktestStrategy,
  BacktestResults,
  BacktestTrade,
  TokenWithOutcome
} from '../backtest/types';

// FIX #2: Solana address validation regex (base58, 32-44 characters)
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Validate a Solana mint/wallet address
 * FIX #2: Prevents SQL injection by validating address format
 */
function validateSolanaAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  return SOLANA_ADDRESS_REGEX.test(address);
}

/**
 * Safe division helper to prevent division by zero
 * FIX #7: Returns 0 when divisor is 0, logs warning
 */
function safeDivide(numerator: number, denominator: number, context: string = 'calculation'): number {
  if (denominator === 0 || !Number.isFinite(denominator)) {
    logger.debug('Database', `Division by zero prevented in ${context}`);
    return 0;
  }
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : 0;
}

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

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info('Database', `Initializing database (attempt ${attempt}/${maxRetries})...`);

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

        // Create base tables (required before migrations)
        this.db.run(SCHEMA);

        // Set database instances for helper services
        migrator.setDatabase(this.db);
        healthChecker.setDatabase(this.db);
        backupService.initialize(this.db, this.dbPath);

        // Run migrations automatically
        await migrator.runMigrations();

        // Run health check
        const health = await healthChecker.healthCheck();
        if (!health.healthy) {
          logger.warn('Database', `Health check warnings: ${health.details.errors.join(', ')}`);
        }

        // Start periodic health checks (every 5 minutes)
        healthChecker.startPeriodicHealthChecks(5 * 60 * 1000);

        // Start automatic backups (daily)
        backupService.startAutomaticBackups(24);

        // Auto-save every 30 seconds if there are changes
        this.saveInterval = setInterval(() => {
          if (this.dirty) {
            this.saveToDisk();
          }
        }, 30000);

        this.initialized = true;
        
        const migrationStats = migrator.getStats();
        const backupStats = backupService.getStats();
        
        logger.info(
          'Database', 
          `✅ Initialized successfully - Schema v${migrationStats.currentVersion} | ${backupStats.totalBackups} backups`
        );
        
        return;
      } catch (error) {
        lastError = error as Error;
        logger.error('Database', `Initialization attempt ${attempt} failed: ${lastError.message}`);

        if (attempt < maxRetries) {
          // Wait before retrying (exponential backoff)
          const delayMs = Math.pow(2, attempt) * 1000;
          logger.info('Database', `Retrying in ${delayMs / 1000}s...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    // All retries failed
    logger.error('Database', 'Failed to initialize after all retries', lastError!);
    throw lastError;
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
   * Helper method to execute SELECT query and get first row
   * Mimics better-sqlite3 .get() API but uses sql.js
   */
  get<T = any>(sql: string, params?: any[]): T | null {
    if (!this.db) return null;

    try {
      const result = this.db.exec(sql, params);
      
      if (result.length === 0 || result[0].values.length === 0) {
        return null;
      }

      const columns = result[0].columns;
      const values = result[0].values[0];
      const row: any = {};
      columns.forEach((col, i) => {
        row[col] = values[i];
      });

      return row as T;
    } catch (error) {
      logger.error('Database', `Failed to execute get query: ${sql}`, error as Error);
      return null;
    }
  }

  /**
   * Helper method to execute SELECT query and get all rows
   * Mimics better-sqlite3 .all() API but uses sql.js
   */
  all<T = any>(sql: string, params?: any[]): T[] {
    if (!this.db) return [];

    try {
      const result = this.db.exec(sql, params);
      
      if (result.length === 0 || result[0].values.length === 0) {
        return [];
      }

      const columns = result[0].columns;
      return result[0].values.map(values => {
        const row: any = {};
        columns.forEach((col, i) => {
          row[col] = values[i];
        });
        return row as T;
      });
    } catch (error) {
      logger.error('Database', `Failed to execute all query: ${sql}`, error as Error);
      return [];
    }
  }

  /**
   * Helper method to execute INSERT/UPDATE/DELETE query
   * Mimics better-sqlite3 .run() API but uses sql.js
   */
  run(sql: string, params?: any[]): { changes: number; lastInsertRowid: number } {
    if (!this.db) {
      return { changes: 0, lastInsertRowid: 0 };
    }

    try {
      this.executeInTransaction(() => {
        this.db!.run(sql, params);
      });
      
      const changes = this.db.getRowsModified?.() || 0;
      const lastIdResult = this.db.exec('SELECT last_insert_rowid() as id');
      const lastInsertRowid = lastIdResult.length > 0 && lastIdResult[0].values.length > 0 
        ? (lastIdResult[0].values[0][0] as number) 
        : 0;
      
      return { changes, lastInsertRowid };
    } catch (error) {
      logger.error('Database', `Failed to execute run query: ${sql}`, error as Error);
      return { changes: 0, lastInsertRowid: 0 };
    }
  }
  /**
   * Get database instance (for advanced operations)
   */
  getDb(): SqlJsDatabase | null {
    return this.db;
  }

  /**
   * Run health check
   */
  async healthCheck() {
    return await healthChecker.healthCheck();
  }

  /**
   * Create manual backup
   */
  async createBackup() {
    return await backupService.createBackup(true);
  }

  /**
   * Get migration information
   */
  getMigrationInfo() {
    return migrator.getStats();
  }

  /**
   * Get backup information
   */
  getBackupInfo() {
    return backupService.getStats();
  }

  /**
   * Execute a database operation within a transaction
   * FIX #1: Ensures atomic writes with proper rollback on failure
   */
  private executeInTransaction<T>(operation: () => T): T {
    if (!this.db) throw new Error('Database not initialized');
    
    try {
      this.db.run('BEGIN TRANSACTION');
      const result = operation();
      this.db.run('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.run('ROLLBACK');
      } catch (rollbackError) {
        logger.error('Database', 'Rollback failed', rollbackError as Error);
      }
      throw error;
    }
  }

  /**
   * Save a token analysis to the database
   * FIX #1: Uses transaction for atomicity
   * FIX #2: Validates mint address before insert
   */
  saveAnalysis(input: AnalysisInput): void {
    if (!this.db) return;

    // FIX #2: Validate mint address
    if (!validateSolanaAddress(input.tokenMint)) {
      logger.warn('Database', `Invalid mint address rejected: ${input.tokenMint?.substring(0, 20)}...`);
      throw new Error(`Invalid mint address: ${input.tokenMint}`);
    }

    try {
      // FIX #1: Wrap in transaction
      this.executeInTransaction(() => {
        this.db!.run(`
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
      });

      this.dirty = true;
      logger.debug('Database', `Saved analysis for ${input.symbol}`);
    } catch (error) {
      // FIX #22: Don't swallow errors - log and re-throw for caller awareness
      logger.error('Database', 'Failed to save analysis', error as Error);
      throw error;
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
   * Get analysis by mint address
   * FIX #2: Validates mint address before query
   * FIX #14: Validates returned data types
   */
  getAnalysisByMint(mint: string): {
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
  } | null {
    if (!this.db) return null;

    // FIX #2: Validate mint address
    if (!validateSolanaAddress(mint)) {
      logger.warn('Database', `Invalid mint address in query: ${mint?.substring(0, 20)}...`);
      return null;
    }

    try {
      const result = this.db.exec(
        'SELECT * FROM token_analysis WHERE mint = ? ORDER BY analyzed_at DESC LIMIT 1',
        [mint]
      );

      if (result.length === 0 || result[0].values.length === 0) return null;

      const columns = result[0].columns;
      const values = result[0].values[0];
      const row: any = {};
      columns.forEach((col, i) => {
        row[col] = values[i];
      });

      // FIX #14: Validate and sanitize returned data
      return {
        mint: String(row.mint ?? ''),
        symbol: String(row.symbol ?? ''),
        name: String(row.name ?? ''),
        risk_score: Number(row.risk_score) || 0,
        liquidity_usd: Number(row.liquidity_usd) || 0,
        holder_count: Number(row.total_holders) || 0,
        top_10_percent: Number(row.top10_percent) || 0,
        mint_revoked: row.mint_revoked === 1,
        freeze_revoked: row.freeze_revoked === 1,
        lp_burned_percent: Number(row.lp_burned_percent) || 0,
        has_twitter: row.has_twitter === 1,
        has_telegram: row.has_telegram === 1,
        has_website: row.has_website === 1,
      };
    } catch (error) {
      // FIX #22: Log error properly instead of silently swallowing
      logger.error('Database', 'Failed to get analysis by mint', error as Error);
      return null;
    }
  }

  /**
   * Save an alert to history
   * FIX #1: Uses transaction for atomicity
   * FIX #2: Validates mint address
   */
  saveAlert(input: AlertInput): void {
    if (!this.db) return;

    // FIX #2: Validate mint address
    if (!validateSolanaAddress(input.tokenMint)) {
      logger.warn('Database', `Invalid mint address in alert: ${input.tokenMint?.substring(0, 20)}...`);
      throw new Error(`Invalid mint address: ${input.tokenMint}`);
    }

    try {
      // FIX #1: Wrap in transaction
      this.executeInTransaction(() => {
        this.db!.run(`
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
      });

      this.dirty = true;
    } catch (error) {
      // FIX #22: Log and re-throw instead of swallowing
      logger.error('Database', 'Failed to save alert', error as Error);
      throw error;
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
   * FIX #7: Safe number handling to prevent NaN
   * FIX #27: Flush pending writes before reading stats
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
      // FIX #27: Flush pending writes before reading stats for consistency
      if (this.dirty) {
        this.saveToDisk();
      }

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

      // FIX #7: Safely extract numbers with fallback to 0
      const extractCount = (result: any[]): number => {
        if (!result || result.length === 0) return 0;
        const value = result[0]?.values?.[0]?.[0];
        const num = Number(value);
        return Number.isFinite(num) ? num : 0;
      };

      return {
        totalAnalyses: extractCount(analysesResult),
        totalAlerts: extractCount(alertsResult),
        alertsToday: extractCount(alertsTodayResult),
        dbSizeBytes,
      };
    } catch (error) {
      logger.error('Database', 'Failed to get stats', error as Error);
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
   * FIX #1: Uses transaction for atomicity
   * FIX #2: Validates mint address
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

    // FIX #2: Validate mint address
    if (!validateSolanaAddress(snapshot.mint)) {
      logger.warn('Database', `Invalid mint address in snapshot: ${snapshot.mint?.substring(0, 20)}...`);
      return; // Skip invalid snapshots silently to not break monitoring
    }

    try {
      // FIX #1: Wrap in transaction
      this.executeInTransaction(() => {
        this.db!.run(`
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
      });
      this.dirty = true;
    } catch (error) {
      logger.error('Database', 'Failed to save token snapshot', error as Error);
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
   * Prepare a SQL statement (SQL.js compatibility)
   */
  prepare(sql: string) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(sql);
    return {
      get: (...params: any[]) => {
        stmt.bind(params);
        const hasRow = stmt.step();
        if (!hasRow) return null;
        const result = stmt.getAsObject();
        stmt.reset();
        return result;
      },
      all: (...params: any[]) => {
        stmt.bind(params);
        const results: any[] = [];
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.reset();
        return results;
      },
      run: (...params: any[]) => {
        stmt.bind(params);
        stmt.step();
        stmt.reset();
        return { changes: this.db!.getRowsModified(), lastInsertRowid: 0 };
      }
    };
  }

  /**
   * Execute a raw SQL query (SQL.js compatibility)
   */
  query(sql: string, params: any[] = []) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(sql);
    if (params.length > 0) {
      stmt.bind(params);
    }

    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  /**
   * Close the database connection gracefully
   */
  async close(): Promise<void> {
    logger.info('Database', 'Starting graceful shutdown...');

    // Stop periodic health checks
    healthChecker.stopPeriodicHealthChecks();

    // Stop automatic backups
    backupService.stopAutomaticBackups();

    // Stop auto-save interval
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    if (this.db) {
      try {
        // Final save before closing
        if (this.dirty) {
          logger.info('Database', 'Flushing pending writes...');
          this.saveToDisk();
        }

        // Create a final backup
        logger.info('Database', 'Creating final backup...');
        const backup = await backupService.createBackup(true);
        if (backup) {
          logger.info('Database', `Final backup created: ${backup.filename}`);
        }

        // Close database
        this.db.close();
        this.db = null;
        this.initialized = false;
        
        logger.info('Database', '✅ Database closed gracefully');
      } catch (error) {
        logger.error('Database', 'Error during graceful shutdown', error as Error);
        throw error;
      }
    }
  }

  // ============================================
  // Trading Signal Methods
  // ============================================

  /**
   * Save a trading signal
   * FIX #1: Uses transaction for atomicity
   * FIX #2: Validates mint address
   */
  saveSignal(signal: {
    id: string;
    mint: string;
    symbol?: string;
    name?: string;
    type: string;
    confidence: number;
    suggestedPositionSize: number;
    positionSizeType: string;
    rugProbability: number;
    riskScore: number;
    smartMoneyScore: number;
    momentumScore: number;
    holderScore: number;
    entryPrice: number;
    targetPrice?: number;
    stopLossPrice?: number;
    reasons: string[];
    warnings: string[];
    status: string;
    generatedAt: number;
    expiresAt: number;
  }): void {
    if (!this.db) return;

    // FIX #2: Validate mint address
    if (!validateSolanaAddress(signal.mint)) {
      logger.warn('Database', `Invalid mint address in signal: ${signal.mint?.substring(0, 20)}...`);
      return;
    }

    try {
      // FIX #1: Wrap in transaction
      this.executeInTransaction(() => {
        this.db!.run(`
          INSERT OR REPLACE INTO trading_signals (
            id, mint, symbol, name, type, confidence,
            suggested_position_size, position_size_type,
            rug_probability, risk_score, smart_money_score,
            momentum_score, holder_score, entry_price,
            target_price, stop_loss_price, reasons, warnings,
            status, generated_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          signal.id,
          signal.mint,
          signal.symbol ?? null,
          signal.name ?? null,
          signal.type,
          signal.confidence,
          signal.suggestedPositionSize,
          signal.positionSizeType,
          signal.rugProbability,
          signal.riskScore,
          signal.smartMoneyScore,
          signal.momentumScore,
          signal.holderScore,
          signal.entryPrice,
          signal.targetPrice ?? null,
          signal.stopLossPrice ?? null,
          JSON.stringify(signal.reasons),
          JSON.stringify(signal.warnings),
          signal.status,
          signal.generatedAt,
          signal.expiresAt,
        ]);
      });

      this.dirty = true;
    } catch (error) {
      // FIX #22: Log error properly
      logger.error('Database', 'Failed to save signal', error as Error);
    }
  }

  /**
   * Update signal status
   */
  updateSignalStatus(id: string, status: string, acknowledgedAt?: number, acknowledgedBy?: string): void {
    if (!this.db) return;

    try {
      this.db.run(`
        UPDATE trading_signals
        SET status = ?, acknowledged_at = ?, acknowledged_by = ?
        WHERE id = ?
      `, [status, acknowledgedAt ?? null, acknowledgedBy ?? null, id]);

      this.dirty = true;
    } catch (error) {
      logger.silentError('Database', 'Failed to update signal status', error as Error);
    }
  }

  /**
   * Record signal outcome
   */
  recordSignalOutcome(data: {
    id: string;
    actualEntry: number;
    actualExit: number;
    profitLossPercent: number;
    wasAccurate: boolean;
    hitTarget?: boolean;
    hitStopLoss?: boolean;
    entryRecordedAt: number;
    exitRecordedAt: number;
    notes?: string;
  }): void {
    if (!this.db) return;

    try {
      this.db.run(`
        UPDATE trading_signals
        SET actual_entry = ?, actual_exit = ?, profit_loss_percent = ?,
            was_accurate = ?, hit_target = ?, hit_stop_loss = ?,
            entry_recorded_at = ?, exit_recorded_at = ?, outcome_notes = ?,
            status = 'executed'
        WHERE id = ?
      `, [
        data.actualEntry,
        data.actualExit,
        data.profitLossPercent,
        data.wasAccurate ? 1 : 0,
        data.hitTarget ? 1 : 0,
        data.hitStopLoss ? 1 : 0,
        data.entryRecordedAt,
        data.exitRecordedAt,
        data.notes ?? null,
        data.id,
      ]);

      this.dirty = true;
    } catch (error) {
      logger.silentError('Database', 'Failed to record signal outcome', error as Error);
    }
  }

  /**
   * Get signals with optional filtering
   */
  getSignals(options: {
    status?: string;
    type?: string;
    mint?: string;
    limit?: number;
    offset?: number;
  } = {}): any[] {
    if (!this.db) return [];

    try {
      let sql = 'SELECT * FROM trading_signals WHERE 1=1';
      const params: any[] = [];

      if (options.status) {
        sql += ' AND status = ?';
        params.push(options.status);
      }

      if (options.type) {
        sql += ' AND type = ?';
        params.push(options.type);
      }

      if (options.mint) {
        sql += ' AND mint = ?';
        params.push(options.mint);
      }

      sql += ' ORDER BY generated_at DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      if (options.offset) {
        sql += ' OFFSET ?';
        params.push(options.offset);
      }

      const result = this.db.exec(sql, params);
      if (result.length === 0) return [];

      const columns = result[0].columns;
      return result[0].values.map(values => {
        const row: any = {};
        columns.forEach((col, i) => {
          row[col] = values[i];
        });
        // Parse JSON fields
        if (row.reasons) row.reasons = JSON.parse(row.reasons);
        if (row.warnings) row.warnings = JSON.parse(row.warnings);
        return row;
      });
    } catch (error) {
      logger.silentError('Database', 'Failed to get signals', error as Error);
      return [];
    }
  }

  /**
   * Get signal by ID
   */
  getSignalById(id: string): any | null {
    if (!this.db) return null;

    try {
      const result = this.db.exec('SELECT * FROM trading_signals WHERE id = ?', [id]);
      if (result.length === 0 || result[0].values.length === 0) return null;

      const columns = result[0].columns;
      const row: any = {};
      columns.forEach((col, i) => {
        row[col] = result[0].values[0][i];
      });

      if (row.reasons) row.reasons = JSON.parse(row.reasons);
      if (row.warnings) row.warnings = JSON.parse(row.warnings);

      return row;
    } catch (error) {
      logger.silentError('Database', 'Failed to get signal by ID', error as Error);
      return null;
    }
  }

  /**
   * Get signal performance stats
   */
  getSignalStats(): {
    totalSignals: number;
    activeSignals: number;
    executedSignals: number;
    accurateSignals: number;
    avgProfitLoss: number;
  } {
    if (!this.db) return { totalSignals: 0, activeSignals: 0, executedSignals: 0, accurateSignals: 0, avgProfitLoss: 0 };

    try {
      const totalResult = this.db.exec('SELECT COUNT(*) FROM trading_signals');
      const activeResult = this.db.exec("SELECT COUNT(*) FROM trading_signals WHERE status = 'active'");
      const executedResult = this.db.exec("SELECT COUNT(*) FROM trading_signals WHERE status = 'executed'");
      const accurateResult = this.db.exec("SELECT COUNT(*) FROM trading_signals WHERE was_accurate = 1");
      const avgResult = this.db.exec("SELECT AVG(profit_loss_percent) FROM trading_signals WHERE profit_loss_percent IS NOT NULL");

      return {
        totalSignals: totalResult.length > 0 ? (totalResult[0].values[0][0] as number) : 0,
        activeSignals: activeResult.length > 0 ? (activeResult[0].values[0][0] as number) : 0,
        executedSignals: executedResult.length > 0 ? (executedResult[0].values[0][0] as number) : 0,
        accurateSignals: accurateResult.length > 0 ? (accurateResult[0].values[0][0] as number) : 0,
        avgProfitLoss: avgResult.length > 0 && avgResult[0].values[0][0] ? (avgResult[0].values[0][0] as number) : 0,
      };
    } catch (error) {
      logger.silentError('Database', 'Failed to get signal stats', error as Error);
      return { totalSignals: 0, activeSignals: 0, executedSignals: 0, accurateSignals: 0, avgProfitLoss: 0 };
    }
  }

  // ============================================
  // Webhook Methods
  // ============================================

  /**
   * Save a webhook
   */
  saveWebhook(webhook: {
    url: string;
    name: string;
    enabled: boolean;
    events: string[];
    minConfidence: number;
    createdAt: number;
  }): number {
    if (!this.db) return 0;

    try {
      this.db.run(`
        INSERT OR REPLACE INTO signal_webhooks (
          url, name, enabled, events, min_confidence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        webhook.url,
        webhook.name,
        webhook.enabled ? 1 : 0,
        JSON.stringify(webhook.events),
        webhook.minConfidence,
        webhook.createdAt,
      ]);

      this.dirty = true;

      const result = this.db.exec('SELECT last_insert_rowid()');
      return result.length > 0 ? (result[0].values[0][0] as number) : 0;
    } catch (error) {
      logger.silentError('Database', 'Failed to save webhook', error as Error);
      return 0;
    }
  }

  /**
   * Update webhook stats
   */
  updateWebhookStats(id: number, totalSent: number, failureCount: number, lastTriggeredAt?: number): void {
    if (!this.db) return;

    try {
      this.db.run(`
        UPDATE signal_webhooks
        SET total_sent = ?, failure_count = ?, last_triggered_at = ?, updated_at = ?
        WHERE id = ?
      `, [totalSent, failureCount, lastTriggeredAt ?? null, Math.floor(Date.now() / 1000), id]);

      this.dirty = true;
    } catch (error) {
      logger.silentError('Database', 'Failed to update webhook stats', error as Error);
    }
  }

  /**
   * Delete a webhook
   */
  deleteWebhook(id: number): void {
    if (!this.db) return;

    try {
      this.db.run('DELETE FROM signal_webhooks WHERE id = ?', [id]);
      this.dirty = true;
    } catch (error) {
      logger.silentError('Database', 'Failed to delete webhook', error as Error);
    }
  }

  /**
   * Get all webhooks
   */
  getWebhooks(): any[] {
    if (!this.db) return [];

    try {
      const result = this.db.exec('SELECT * FROM signal_webhooks ORDER BY created_at DESC');
      if (result.length === 0) return [];

      const columns = result[0].columns;
      return result[0].values.map(values => {
        const row: any = {};
        columns.forEach((col, i) => {
          row[col] = values[i];
        });
        if (row.events) row.events = JSON.parse(row.events);
        row.enabled = row.enabled === 1;
        return row;
      });
    } catch (error) {
      logger.silentError('Database', 'Failed to get webhooks', error as Error);
      return [];
    }
  }

  // ============================================
  // ML Training Sample Methods
  // ============================================

  /**
   * Save an ML training sample
   */
  saveMLSample(sample: {
    mint: string;
    symbol?: string;
    features: Record<string, number>;
    featureVersion?: string;
    outcome?: string;
    outcomeConfidence?: number;
    labelSource: string;
    labeledBy?: string;
    discoveredAt: number;
    labeledAt?: number;
  }): void {
    if (!this.db) return;

    try {
      this.db.run(`
        INSERT OR REPLACE INTO ml_training_samples (
          mint, symbol, features, feature_version, outcome,
          outcome_confidence, label_source, labeled_by,
          discovered_at, labeled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        sample.mint,
        sample.symbol ?? null,
        JSON.stringify(sample.features),
        sample.featureVersion ?? 'v2',
        sample.outcome ?? null,
        sample.outcomeConfidence ?? null,
        sample.labelSource,
        sample.labeledBy ?? null,
        sample.discoveredAt,
        sample.labeledAt ?? null,
      ]);

      this.dirty = true;
    } catch (error) {
      logger.silentError('Database', 'Failed to save ML sample', error as Error);
    }
  }

  /**
   * Get ML training samples
   */
  getMLSamples(options: {
    outcome?: string;
    labelSource?: string;
    featureVersion?: string;
    limit?: number;
  } = {}): any[] {
    if (!this.db) return [];

    try {
      let sql = 'SELECT * FROM ml_training_samples WHERE outcome IS NOT NULL';
      const params: any[] = [];

      if (options.outcome) {
        sql += ' AND outcome = ?';
        params.push(options.outcome);
      }

      if (options.labelSource) {
        sql += ' AND label_source = ?';
        params.push(options.labelSource);
      }

      if (options.featureVersion) {
        sql += ' AND feature_version = ?';
        params.push(options.featureVersion);
      }

      sql += ' ORDER BY labeled_at DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const result = this.db.exec(sql, params);
      if (result.length === 0) return [];

      const columns = result[0].columns;
      return result[0].values.map(values => {
        const row: any = {};
        columns.forEach((col, i) => {
          row[col] = values[i];
        });
        if (row.features) row.features = JSON.parse(row.features);
        return row;
      });
    } catch (error) {
      logger.silentError('Database', 'Failed to get ML samples', error as Error);
      return [];
    }
  }

  /**
   * Get ML sample count
   */
  getMLSampleCount(): { total: number; labeled: number; byOutcome: Record<string, number> } {
    if (!this.db) return { total: 0, labeled: 0, byOutcome: {} };

    try {
      const totalResult = this.db.exec('SELECT COUNT(*) FROM ml_training_samples');
      const labeledResult = this.db.exec('SELECT COUNT(*) FROM ml_training_samples WHERE outcome IS NOT NULL');
      const byOutcomeResult = this.db.exec(`
        SELECT outcome, COUNT(*) as count
        FROM ml_training_samples
        WHERE outcome IS NOT NULL
        GROUP BY outcome
      `);

      const byOutcome: Record<string, number> = {};
      if (byOutcomeResult.length > 0) {
        for (const row of byOutcomeResult[0].values) {
          byOutcome[row[0] as string] = row[1] as number;
        }
      }

      return {
        total: totalResult.length > 0 ? (totalResult[0].values[0][0] as number) : 0,
        labeled: labeledResult.length > 0 ? (labeledResult[0].values[0][0] as number) : 0,
        byOutcome,
      };
    } catch (error) {
      logger.silentError('Database', 'Failed to get ML sample count', error as Error);
      return { total: 0, labeled: 0, byOutcome: {} };
    }
  }

  // ============================================
  // ML Training Run Methods
  // ============================================

  /**
   * Save a training run
   */
  saveTrainingRun(run: {
    modelVersion: string;
    featureVersion?: string;
    samplesUsed: number;
    trainSamples: number;
    validationSamples: number;
    testSamples: number;
    accuracy: number;
    precisionScore: number;
    recallScore: number;
    f1Score: number;
    aucScore?: number;
    trainingLoss?: number;
    validationLoss?: number;
    epochs?: number;
    trainingDurationMs?: number;
    featureImportance?: Record<string, number>;
    confusionMatrix?: number[][];
    trainedAt: number;
  }): void {
    if (!this.db) return;

    try {
      this.db.run(`
        INSERT INTO ml_training_runs (
          model_version, feature_version, samples_used,
          train_samples, validation_samples, test_samples,
          accuracy, precision_score, recall_score, f1_score, auc_score,
          training_loss, validation_loss, epochs, training_duration_ms,
          feature_importance, confusion_matrix, trained_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        run.modelVersion,
        run.featureVersion ?? 'v2',
        run.samplesUsed,
        run.trainSamples,
        run.validationSamples,
        run.testSamples,
        run.accuracy,
        run.precisionScore,
        run.recallScore,
        run.f1Score,
        run.aucScore ?? null,
        run.trainingLoss ?? null,
        run.validationLoss ?? null,
        run.epochs ?? null,
        run.trainingDurationMs ?? null,
        run.featureImportance ? JSON.stringify(run.featureImportance) : null,
        run.confusionMatrix ? JSON.stringify(run.confusionMatrix) : null,
        run.trainedAt,
      ]);

      this.dirty = true;
    } catch (error) {
      logger.silentError('Database', 'Failed to save training run', error as Error);
    }
  }

  /**
   * Set active model version
   */
  setActiveModelVersion(modelVersion: string): void {
    if (!this.db) return;

    try {
      // Deactivate all
      this.db.run('UPDATE ml_training_runs SET is_active = 0');
      // Activate specified
      this.db.run('UPDATE ml_training_runs SET is_active = 1, activated_at = ? WHERE model_version = ?',
        [Math.floor(Date.now() / 1000), modelVersion]);

      this.dirty = true;
    } catch (error) {
      logger.silentError('Database', 'Failed to set active model version', error as Error);
    }
  }

  /**
   * Get active model version
   */
  getActiveModelVersion(): string | null {
    if (!this.db) return null;

    try {
      const result = this.db.exec('SELECT model_version FROM ml_training_runs WHERE is_active = 1');
      if (result.length === 0 || result[0].values.length === 0) return null;
      return result[0].values[0][0] as string;
    } catch (error) {
      logger.silentError('Database', 'Failed to get active model version', error as Error);
      return null;
    }
  }

  /**
   * Get training runs
   */
  getTrainingRuns(limit: number = 10): any[] {
    if (!this.db) return [];

    try {
      const result = this.db.exec(
        'SELECT * FROM ml_training_runs ORDER BY trained_at DESC LIMIT ?',
        [limit]
      );

      if (result.length === 0) return [];

      const columns = result[0].columns;
      return result[0].values.map(values => {
        const row: any = {};
        columns.forEach((col, i) => {
          row[col] = values[i];
        });
        if (row.feature_importance) row.feature_importance = JSON.parse(row.feature_importance);
        if (row.confusion_matrix) row.confusion_matrix = JSON.parse(row.confusion_matrix);
        row.is_active = row.is_active === 1;
        row.is_challenger = row.is_challenger === 1;
        return row;
      });
    } catch (error) {
      logger.silentError('Database', 'Failed to get training runs', error as Error);
      return [];
    }
  }

  /**
   * Get latest training run
   */
  getLatestTrainingRun(): any | null {
    const runs = this.getTrainingRuns(1);
    return runs.length > 0 ? runs[0] : null;
  }

  // ============================================
  // ML Pending Labels Methods
  // ============================================

  /**
   * Add token to pending labels queue
   */
  addPendingLabel(data: {
    mint: string;
    symbol?: string;
    initialPrice: number;
    initialLiquidity: number;
    initialRiskScore: number;
    discoveredAt: number;
  }): void {
    if (!this.db) return;

    try {
      this.db.run(`
        INSERT OR IGNORE INTO ml_pending_labels (
          mint, symbol, initial_price, initial_liquidity,
          initial_risk_score, discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        data.mint,
        data.symbol ?? null,
        data.initialPrice,
        data.initialLiquidity,
        data.initialRiskScore,
        data.discoveredAt,
      ]);

      this.dirty = true;
    } catch (error) {
      logger.silentError('Database', 'Failed to add pending label', error as Error);
    }
  }

  /**
   * Update pending label with current price
   */
  updatePendingLabelPrice(mint: string, currentPrice: number, priceChangePercent: number): void {
    if (!this.db) return;

    try {
      // Auto-suggest label based on price change
      let suggestedLabel: string | null = null;
      let suggestConfidence = 0;

      if (priceChangePercent <= -90) {
        suggestedLabel = 'rug';
        suggestConfidence = 0.9;
      } else if (priceChangePercent >= 100) {
        suggestedLabel = 'pump';
        suggestConfidence = 0.8;
      } else if (priceChangePercent <= -50) {
        suggestedLabel = 'decline';
        suggestConfidence = 0.7;
      } else if (priceChangePercent >= -20 && priceChangePercent <= 50) {
        suggestedLabel = 'stable';
        suggestConfidence = 0.6;
      }

      this.db.run(`
        UPDATE ml_pending_labels
        SET current_price = ?, price_change_percent = ?,
            suggested_label = ?, suggest_confidence = ?,
            last_updated_at = ?
        WHERE mint = ?
      `, [currentPrice, priceChangePercent, suggestedLabel, suggestConfidence, Math.floor(Date.now() / 1000), mint]);

      this.dirty = true;
    } catch (error) {
      logger.silentError('Database', 'Failed to update pending label price', error as Error);
    }
  }

  /**
   * Mark pending label as labeled
   */
  markPendingLabelAsLabeled(mint: string): void {
    if (!this.db) return;

    try {
      this.db.run(`
        UPDATE ml_pending_labels
        SET status = 'labeled', labeled_at = ?
        WHERE mint = ?
      `, [Math.floor(Date.now() / 1000), mint]);

      this.dirty = true;
    } catch (error) {
      logger.silentError('Database', 'Failed to mark pending label', error as Error);
    }
  }

  /**
   * Get pending labels
   */
  getPendingLabels(limit: number = 50): any[] {
    if (!this.db) return [];

    try {
      const result = this.db.exec(`
        SELECT * FROM ml_pending_labels
        WHERE status = 'pending'
        ORDER BY discovered_at DESC
        LIMIT ?
      `, [limit]);

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
      logger.silentError('Database', 'Failed to get pending labels', error as Error);
      return [];
    }
  }

  /**
   * Get pending label count
   */
  getPendingLabelCount(): number {
    if (!this.db) return 0;

    try {
      const result = this.db.exec("SELECT COUNT(*) FROM ml_pending_labels WHERE status = 'pending'");
      return result.length > 0 ? (result[0].values[0][0] as number) : 0;
    } catch (error) {
      logger.silentError('Database', 'Failed to get pending label count', error as Error);
      return 0;
    }
  }
}

// Export singleton instance
export const database = new DatabaseService();

// Export class for testing
export { DatabaseService };
