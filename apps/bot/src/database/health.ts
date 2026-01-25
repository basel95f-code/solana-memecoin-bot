/**
 * Database Health Monitoring System
 * Checks database connectivity, integrity, and performance
 */

import type { Database as SqlJsDatabase } from 'sql.js';
import { logger } from '../utils/logger';
import { migrator } from './migrator';

export interface HealthCheckResult {
  healthy: boolean;
  timestamp: number;
  checks: {
    connection: boolean;
    schema: boolean;
    integrity: boolean;
    performance: boolean;
  };
  details: {
    connectionTime: number;
    schemaVersion: number;
    tableCount: number;
    recordCount: number;
    dbSizeBytes: number;
    errors: string[];
  };
}

export class DatabaseHealthChecker {
  private db: SqlJsDatabase | null = null;
  private lastHealthCheck: HealthCheckResult | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  /**
   * Set the database instance
   */
  setDatabase(db: SqlJsDatabase): void {
    this.db = db;
  }

  /**
   * Test basic database connectivity
   */
  private async testConnection(): Promise<{ success: boolean; timeMs: number; error?: string }> {
    if (!this.db) {
      return { success: false, timeMs: 0, error: 'Database not initialized' };
    }

    const startTime = Date.now();

    try {
      // Simple query to test connectivity
      this.db.exec('SELECT 1');
      const timeMs = Date.now() - startTime;
      return { success: true, timeMs };
    } catch (error) {
      const timeMs = Date.now() - startTime;
      return {
        success: false,
        timeMs,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Verify critical tables exist
   */
  private verifyCriticalTables(): { success: boolean; tableCount: number; errors: string[] } {
    if (!this.db) {
      return { success: false, tableCount: 0, errors: ['Database not initialized'] };
    }

    const errors: string[] = [];
    const criticalTables = [
      'schema_migrations',
      'token_analysis',
      'alert_history',
      'token_outcomes',
      'trading_signals',
      'backtest_strategies',
      'token_snapshots',
    ];

    let tableCount = 0;

    try {
      // Get all tables
      const result = this.db.exec(`
        SELECT name FROM sqlite_master 
        WHERE type='table'
      `);

      if (result.length > 0) {
        tableCount = result[0].values.length;
        const existingTables = result[0].values.map((row) => row[0] as string);

        // Check each critical table
        for (const table of criticalTables) {
          if (!existingTables.includes(table)) {
            errors.push(`Critical table '${table}' is missing`);
          }
        }
      } else {
        errors.push('No tables found in database');
      }

      return {
        success: errors.length === 0,
        tableCount,
        errors,
      };
    } catch (error) {
      errors.push(`Table verification failed: ${(error as Error).message}`);
      return { success: false, tableCount, errors };
    }
  }

  /**
   * Run database integrity check
   */
  private checkIntegrity(): { success: boolean; errors: string[] } {
    if (!this.db) {
      return { success: false, errors: ['Database not initialized'] };
    }

    const errors: string[] = [];

    try {
      // SQLite integrity check
      const result = this.db.exec('PRAGMA integrity_check');

      if (result.length > 0 && result[0].values.length > 0) {
        const status = result[0].values[0][0] as string;

        if (status !== 'ok') {
          errors.push(`Integrity check failed: ${status}`);
        }
      }

      // Verify schema migrations are consistent
      const schemaValidation = migrator.validateSchema();
      if (!schemaValidation.valid) {
        errors.push(...schemaValidation.errors);
      }

      return {
        success: errors.length === 0,
        errors,
      };
    } catch (error) {
      errors.push(`Integrity check error: ${(error as Error).message}`);
      return { success: false, errors };
    }
  }

  /**
   * Check database performance metrics
   */
  private checkPerformance(): {
    success: boolean;
    recordCount: number;
    dbSizeBytes: number;
    errors: string[];
  } {
    if (!this.db) {
      return { success: false, recordCount: 0, dbSizeBytes: 0, errors: ['Database not initialized'] };
    }

    const errors: string[] = [];
    let recordCount = 0;
    let dbSizeBytes = 0;

    try {
      // Count total records across main tables
      const tables = ['token_analysis', 'alert_history', 'trading_signals', 'token_snapshots'];

      for (const table of tables) {
        try {
          const result = this.db.exec(`SELECT COUNT(*) FROM ${table}`);
          if (result.length > 0 && result[0].values.length > 0) {
            recordCount += result[0].values[0][0] as number;
          }
        } catch (error) {
          // Table might not exist yet, skip
          logger.debug('Health', `Could not count records in ${table}: ${(error as Error).message}`);
        }
      }

      // Get database size
      try {
        const data = this.db.export();
        dbSizeBytes = data.byteLength;
      } catch (error) {
        errors.push(`Could not calculate database size: ${(error as Error).message}`);
      }

      // Warn if database is getting large (>500MB)
      if (dbSizeBytes > 500 * 1024 * 1024) {
        errors.push(`Database size is large: ${(dbSizeBytes / 1024 / 1024).toFixed(2)} MB - consider cleanup`);
      }

      return {
        success: errors.length === 0,
        recordCount,
        dbSizeBytes,
        errors,
      };
    } catch (error) {
      errors.push(`Performance check error: ${(error as Error).message}`);
      return { success: false, recordCount, dbSizeBytes, errors };
    }
  }

  /**
   * Run comprehensive health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const timestamp = Math.floor(Date.now() / 1000);
    const allErrors: string[] = [];

    // Test connection
    const connectionTest = await this.testConnection();
    if (connectionTest.error) {
      allErrors.push(connectionTest.error);
    }

    // Verify tables
    const tableCheck = this.verifyCriticalTables();
    allErrors.push(...tableCheck.errors);

    // Check integrity
    const integrityCheck = this.checkIntegrity();
    allErrors.push(...integrityCheck.errors);

    // Check performance
    const perfCheck = this.checkPerformance();
    allErrors.push(...perfCheck.errors);

    // Get schema version
    const schemaVersion = migrator.getCurrentVersion();

    const result: HealthCheckResult = {
      healthy: allErrors.length === 0,
      timestamp,
      checks: {
        connection: connectionTest.success,
        schema: tableCheck.success,
        integrity: integrityCheck.success,
        performance: perfCheck.success,
      },
      details: {
        connectionTime: connectionTest.timeMs,
        schemaVersion,
        tableCount: tableCheck.tableCount,
        recordCount: perfCheck.recordCount,
        dbSizeBytes: perfCheck.dbSizeBytes,
        errors: allErrors,
      },
    };

    this.lastHealthCheck = result;

    // Log results
    if (result.healthy) {
      logger.info(
        'Health',
        `✅ Database healthy - v${schemaVersion} | ${tableCheck.tableCount} tables | ${perfCheck.recordCount.toLocaleString()} records | ${(perfCheck.dbSizeBytes / 1024 / 1024).toFixed(2)} MB`
      );
    } else {
      logger.error('Health', `❌ Database health check failed: ${allErrors.join(', ')}`);
    }

    return result;
  }

  /**
   * Get last health check result
   */
  getLastHealthCheck(): HealthCheckResult | null {
    return this.lastHealthCheck;
  }

  /**
   * Start periodic health checks
   */
  startPeriodicHealthChecks(intervalMs: number = 5 * 60 * 1000): void {
    if (this.healthCheckInterval) {
      logger.warn('Health', 'Periodic health checks already running');
      return;
    }

    logger.info('Health', `Starting periodic health checks (every ${intervalMs / 1000 / 60} minutes)`);

    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.healthCheck();
      } catch (error) {
        logger.error('Health', 'Periodic health check failed', error as Error);
      }
    }, intervalMs);
  }

  /**
   * Stop periodic health checks
   */
  stopPeriodicHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      logger.info('Health', 'Periodic health checks stopped');
    }
  }

  /**
   * Quick health status check
   */
  isHealthy(): boolean {
    if (!this.lastHealthCheck) {
      return false;
    }

    // Check if health check is recent (within last 10 minutes)
    const now = Math.floor(Date.now() / 1000);
    const age = now - this.lastHealthCheck.timestamp;

    if (age > 600) {
      // Stale health check
      return false;
    }

    return this.lastHealthCheck.healthy;
  }
}

// Singleton instance
export const healthChecker = new DatabaseHealthChecker();
