/**
 * Database service for persistent storage
 * Uses sql.js (SQLite compiled to WebAssembly) for cross-platform compatibility
 */

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { SCHEMA, MIGRATIONS } from './schema';
import { logger } from '../utils/logger';

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
