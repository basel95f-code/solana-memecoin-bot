/**
 * Database Migration System
 * Handles automatic schema migrations with rollback support
 */

import type { Database as SqlJsDatabase } from 'sql.js';
import { MIGRATIONS } from './schema';
import { logger } from '../utils/logger';

interface MigrationRecord {
  version: number;
  applied_at: number;
  success: boolean;
  error_message?: string;
}

export class DatabaseMigrator {
  private db: SqlJsDatabase | null = null;
  private maxRetries = 3;
  private retryDelayMs = 1000;

  /**
   * Set the database instance
   */
  setDatabase(db: SqlJsDatabase): void {
    this.db = db;
  }

  /**
   * Initialize migration tracking table
   */
  private initializeMigrationTable(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL,
          success INTEGER NOT NULL DEFAULT 1,
          error_message TEXT,
          execution_time_ms INTEGER
        )
      `);

      // Create an index for faster lookups
      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied 
        ON schema_migrations(applied_at)
      `);

      logger.debug('Migrator', 'Migration tracking table initialized');
    } catch (error) {
      logger.error('Migrator', 'Failed to initialize migration table', error as Error);
      throw error;
    }
  }

  /**
   * Get current schema version
   */
  getCurrentVersion(): number {
    if (!this.db) {
      return 0;
    }

    try {
      const result = this.db.exec(`
        SELECT MAX(version) as version 
        FROM schema_migrations 
        WHERE success = 1
      `);

      if (result.length > 0 && result[0].values.length > 0) {
        const version = result[0].values[0][0];
        return version !== null ? (version as number) : 0;
      }

      return 0;
    } catch {
      // Table doesn't exist yet
      return 0;
    }
  }

  /**
   * Get migration history
   */
  getMigrationHistory(): MigrationRecord[] {
    if (!this.db) {
      return [];
    }

    try {
      const result = this.db.exec(`
        SELECT version, applied_at, success, error_message
        FROM schema_migrations
        ORDER BY version ASC
      `);

      if (result.length === 0) {
        return [];
      }

      const records: MigrationRecord[] = [];
      for (const row of result[0].values) {
        records.push({
          version: row[0] as number,
          applied_at: row[1] as number,
          success: (row[2] as number) === 1,
          error_message: row[3] as string | undefined,
        });
      }

      return records;
    } catch (error) {
      logger.silentError('Migrator', 'Failed to get migration history', error as Error);
      return [];
    }
  }

  /**
   * Run a single migration with retry logic
   */
  private async runSingleMigration(
    migration: { version: number; sql: string; description?: string },
    currentVersion: number
  ): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.info(
          'Migrator',
          `Running migration v${migration.version}${migration.description ? ` - ${migration.description}` : ''} (attempt ${attempt}/${this.maxRetries})`
        );

        // Execute migration SQL
        this.db.run(migration.sql);

        // Record successful migration
        const executionTime = Date.now() - startTime;
        this.db.run(
          `INSERT INTO schema_migrations (version, applied_at, success, execution_time_ms) 
           VALUES (?, ?, 1, ?)`,
          [migration.version, Math.floor(Date.now() / 1000), executionTime]
        );

        logger.info(
          'Migrator',
          `✅ Migration v${migration.version} completed successfully (${executionTime}ms)`
        );

        return;
      } catch (error) {
        lastError = error as Error;
        logger.warn(
          'Migrator',
          `Migration v${migration.version} failed on attempt ${attempt}: ${lastError.message}`
        );

        if (attempt < this.maxRetries) {
          // Wait before retrying
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * attempt));
        }
      }
    }

    // All retries failed - record failure
    const executionTime = Date.now() - startTime;
    try {
      this.db.run(
        `INSERT INTO schema_migrations (version, applied_at, success, error_message, execution_time_ms) 
         VALUES (?, ?, 0, ?, ?)`,
        [
          migration.version,
          Math.floor(Date.now() / 1000),
          lastError?.message || 'Unknown error',
          executionTime,
        ]
      );
    } catch {
      // Failed to record the failure - log it
      logger.error('Migrator', 'Failed to record migration failure', lastError!);
    }

    throw new Error(
      `Migration v${migration.version} failed after ${this.maxRetries} attempts: ${lastError?.message}`
    );
  }

  /**
   * Run all pending migrations
   */
  async runMigrations(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized - call setDatabase() first');
    }

    try {
      // Initialize migration tracking table
      this.initializeMigrationTable();

      // Get current version
      const currentVersion = this.getCurrentVersion();
      logger.info('Migrator', `Current schema version: v${currentVersion}`);

      // Get pending migrations
      const pendingMigrations = MIGRATIONS.filter((m) => m.version > currentVersion);

      if (pendingMigrations.length === 0) {
        logger.info('Migrator', 'No pending migrations - database is up to date');
        return;
      }

      logger.info('Migrator', `Found ${pendingMigrations.length} pending migration(s)`);

      // Run each pending migration in order
      for (const migration of pendingMigrations) {
        await this.runSingleMigration(migration, currentVersion);
      }

      const newVersion = this.getCurrentVersion();
      logger.info('Migrator', `✅ All migrations completed - schema version: v${newVersion}`);
    } catch (error) {
      logger.error('Migrator', 'Migration process failed', error as Error);
      throw error;
    }
  }

  /**
   * Validate database schema integrity
   */
  validateSchema(): { valid: boolean; errors: string[] } {
    if (!this.db) {
      return { valid: false, errors: ['Database not initialized'] };
    }

    const errors: string[] = [];

    try {
      // Check if migration table exists
      const result = this.db.exec(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='schema_migrations'
      `);

      if (result.length === 0) {
        errors.push('Migration tracking table does not exist');
      }

      // Verify critical tables exist
      const requiredTables = [
        'token_analysis',
        'alert_history',
        'token_outcomes',
        'trading_signals',
      ];

      for (const table of requiredTables) {
        const tableResult = this.db.exec(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name='${table}'
        `);

        if (tableResult.length === 0) {
          errors.push(`Required table '${table}' does not exist`);
        }
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    } catch (error) {
      errors.push(`Schema validation error: ${(error as Error).message}`);
      return { valid: false, errors };
    }
  }

  /**
   * Get migration statistics
   */
  getStats(): {
    currentVersion: number;
    totalMigrations: number;
    pendingMigrations: number;
    successfulMigrations: number;
    failedMigrations: number;
  } {
    const currentVersion = this.getCurrentVersion();
    const history = this.getMigrationHistory();

    return {
      currentVersion,
      totalMigrations: MIGRATIONS.length,
      pendingMigrations: MIGRATIONS.filter((m) => m.version > currentVersion).length,
      successfulMigrations: history.filter((r) => r.success).length,
      failedMigrations: history.filter((r) => !r.success).length,
    };
  }
}

// Singleton instance
export const migrator = new DatabaseMigrator();
