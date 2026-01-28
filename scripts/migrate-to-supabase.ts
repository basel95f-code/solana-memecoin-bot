/**
 * SQLite to Supabase Migration Script
 * Exports data from SQLite and imports to Supabase with data integrity checks
 */

import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { getSupabaseClient, unixToISO } from '../apps/bot/src/database/supabase';
import { SupabaseClient } from '@supabase/supabase-js';

// Tables to migrate (in order due to foreign key constraints)
const TABLES_TO_MIGRATE = [
  // Core tables
  'token_analysis',
  'alert_history',
  'pool_discovery',
  'token_outcomes',
  
  // Backtest tables
  'backtest_strategies',
  'backtest_runs',
  'backtest_trades',
  
  // Snapshot tables
  'token_snapshots',
  'snapshot_watch_list',
  'watchlist_price_history',
  
  // ML tables
  'wallet_clusters',
  'ml_models',
  'ml_training_samples',
  'ml_training_runs',
  'ml_pending_labels',
  'feature_importance_analysis',
  
  // Portfolio tables
  'positions',
  'trades',
  'portfolio_snapshots',
  
  // Scanner tables
  'scan_filters',
  'scan_matches',
  
  // Outcome tracking
  'token_outcomes_v2',
  
  // Automation tables
  'automation_rules',
  'automation_decisions',
  'risk_parameters',
  
  // Group/User settings
  'group_settings',
  'user_settings_extended',
  'group_alert_throttle',
  'group_watchlist',
  'leaderboard_entries',
  'topic_configs',
  
  // Smart money tables
  'smart_money_wallets',
  'smart_money_trades',
  'smart_money_alerts',
  
  // Pattern tables
  'success_patterns',
  'token_pattern_matches',
  
  // ML versioning
  'ml_model_versions',
  'prediction_performance',
  'training_schedule',
  
  // Signals
  'trading_signals',
  'signal_webhooks',
];

// Column mappings: SQLite -> PostgreSQL
const COLUMN_MAPPINGS: Record<string, Record<string, string>> = {
  token_analysis: {
    analyzed_at: 'unix_to_iso',
    created_at: 'unix_to_iso',
  },
  alert_history: {
    sent_at: 'unix_to_iso',
    created_at: 'unix_to_iso',
  },
  pool_discovery: {
    discovered_at: 'unix_to_iso',
    analyzed_at: 'unix_to_iso',
  },
  token_outcomes: {
    discovered_at: 'unix_to_iso',
    peak_at: 'unix_to_iso',
    outcome_recorded_at: 'unix_to_iso',
  },
  backtest_strategies: {
    created_at: 'unix_to_iso',
    updated_at: 'unix_to_iso',
    entry_conditions: 'json_parse',
    exit_conditions: 'json_parse',
    position_sizing: 'json_parse',
  },
  backtest_runs: {
    start_date: 'unix_to_iso',
    end_date: 'unix_to_iso',
    executed_at: 'unix_to_iso',
    equity_curve: 'json_parse',
  },
  backtest_trades: {
    entry_time: 'unix_to_iso',
    exit_time: 'unix_to_iso',
  },
  token_snapshots: {
    recorded_at: 'unix_to_iso',
  },
  snapshot_watch_list: {
    added_at: 'unix_to_iso',
    last_snapshot_at: 'unix_to_iso',
    expires_at: 'unix_to_iso',
  },
  watchlist_price_history: {
    recorded_at: 'unix_to_iso',
  },
};

interface MigrationStats {
  table: string;
  exported: number;
  imported: number;
  errors: number;
  startTime: number;
  endTime: number;
}

class MigrationService {
  private sqliteDb: SqlJsDatabase | null = null;
  private supabase: SupabaseClient;
  private stats: MigrationStats[] = [];
  private backupPath: string = '';

  constructor() {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error('Supabase client not initialized. Check your environment variables.');
    }
    this.supabase = client;
  }

  /**
   * Load SQLite database
   */
  async loadSQLite(dbPath: string): Promise<void> {
    console.log(`📖 Loading SQLite database from ${dbPath}...`);

    if (!fs.existsSync(dbPath)) {
      throw new Error(`SQLite database not found at ${dbPath}`);
    }

    // Create backup
    this.backupPath = `${dbPath}.backup-${Date.now()}`;
    fs.copyFileSync(dbPath, this.backupPath);
    console.log(`✅ Created backup at ${this.backupPath}`);

    const SQL = await initSqlJs();
    const fileBuffer = fs.readFileSync(dbPath);
    this.sqliteDb = new SQL.Database(fileBuffer);

    console.log('✅ SQLite database loaded');
  }

  /**
   * Export data from a table
   */
  async exportTable(tableName: string): Promise<any[]> {
    if (!this.sqliteDb) throw new Error('SQLite database not loaded');

    try {
      const result = this.sqliteDb.exec(`SELECT * FROM ${tableName}`);

      if (result.length === 0) {
        return [];
      }

      const columns = result[0].columns;
      const rows = result[0].values.map((row) => {
        const obj: any = {};
        columns.forEach((col, i) => {
          obj[col] = row[i];
        });
        return obj;
      });

      return rows;
    } catch (error) {
      // Table might not exist in SQLite
      console.warn(`⚠️  Table ${tableName} not found in SQLite, skipping...`);
      return [];
    }
  }

  /**
   * Transform row data for PostgreSQL
   */
  transformRow(tableName: string, row: any): any {
    const mappings = COLUMN_MAPPINGS[tableName] || {};
    const transformed: any = { ...row };

    // Add synced_at timestamp
    transformed.synced_at = new Date().toISOString();

    // Apply column transformations
    for (const [column, transform] of Object.entries(mappings)) {
      if (transformed[column] === null || transformed[column] === undefined) continue;

      switch (transform) {
        case 'unix_to_iso':
          // Convert Unix timestamp (seconds) to ISO string
          if (typeof transformed[column] === 'number') {
            transformed[column] = unixToISO(transformed[column]);
          }
          break;
        case 'json_parse':
          // Parse JSON string to object
          if (typeof transformed[column] === 'string') {
            try {
              transformed[column] = JSON.parse(transformed[column]);
            } catch {
              // Leave as string if parsing fails
            }
          }
          break;
      }
    }

    return transformed;
  }

  /**
   * Import data to Supabase table
   */
  async importTable(tableName: string, rows: any[]): Promise<{ imported: number; errors: number }> {
    if (rows.length === 0) {
      return { imported: 0, errors: 0 };
    }

    let imported = 0;
    let errors = 0;
    const batchSize = 100;

    console.log(`   Importing ${rows.length} rows in batches of ${batchSize}...`);

    // Transform rows
    const transformedRows = rows.map((row) => this.transformRow(tableName, row));

    // Import in batches
    for (let i = 0; i < transformedRows.length; i += batchSize) {
      const batch = transformedRows.slice(i, i + batchSize);

      try {
        const { data, error } = await this.supabase.from(tableName).upsert(batch);

        if (error) {
          console.error(`   ❌ Batch ${i / batchSize + 1} failed:`, error.message);
          errors += batch.length;
        } else {
          imported += batch.length;
        }
      } catch (error) {
        console.error(`   ❌ Batch ${i / batchSize + 1} exception:`, (error as Error).message);
        errors += batch.length;
      }

      // Progress indicator
      if ((i + batchSize) % 500 === 0) {
        console.log(`   Progress: ${Math.min(i + batchSize, transformedRows.length)}/${transformedRows.length}`);
      }
    }

    return { imported, errors };
  }

  /**
   * Migrate a single table
   */
  async migrateTable(tableName: string): Promise<MigrationStats> {
    const startTime = Date.now();

    console.log(`\n🔄 Migrating ${tableName}...`);

    // Export
    const rows = await this.exportTable(tableName);
    console.log(`   Exported ${rows.length} rows`);

    // Import
    const { imported, errors } = await this.importTable(tableName, rows);

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`   ✅ Imported ${imported} rows (${errors} errors) in ${duration}s`);

    return {
      table: tableName,
      exported: rows.length,
      imported,
      errors,
      startTime,
      endTime,
    };
  }

  /**
   * Verify data integrity
   */
  async verifyTable(tableName: string, expectedCount: number): Promise<boolean> {
    try {
      const { count, error } = await this.supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });

      if (error) {
        console.error(`   ❌ Verification failed: ${error.message}`);
        return false;
      }

      const match = count === expectedCount;

      if (match) {
        console.log(`   ✅ Verified ${count} rows`);
      } else {
        console.warn(`   ⚠️  Count mismatch: expected ${expectedCount}, got ${count}`);
      }

      return match;
    } catch (error) {
      console.error(`   ❌ Verification exception:`, (error as Error).message);
      return false;
    }
  }

  /**
   * Run full migration
   */
  async migrate(dbPath: string): Promise<void> {
    console.log('🚀 Starting SQLite → Supabase Migration\n');
    console.log('=' .repeat(60));

    const startTime = Date.now();

    // Load SQLite database
    await this.loadSQLite(dbPath);

    // Migrate tables
    for (const tableName of TABLES_TO_MIGRATE) {
      try {
        const stats = await this.migrateTable(tableName);
        this.stats.push(stats);

        // Verify
        await this.verifyTable(tableName, stats.exported);
      } catch (error) {
        console.error(`❌ Failed to migrate ${tableName}:`, (error as Error).message);
        this.stats.push({
          table: tableName,
          exported: 0,
          imported: 0,
          errors: 1,
          startTime: Date.now(),
          endTime: Date.now(),
        });
      }
    }

    const endTime = Date.now();
    const totalDuration = ((endTime - startTime) / 1000).toFixed(2);

    // Print summary
    this.printSummary(totalDuration);

    // Save migration report
    this.saveMigrationReport();
  }

  /**
   * Print migration summary
   */
  printSummary(totalDuration: string): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary');
    console.log('='.repeat(60));

    let totalExported = 0;
    let totalImported = 0;
    let totalErrors = 0;

    for (const stat of this.stats) {
      totalExported += stat.exported;
      totalImported += stat.imported;
      totalErrors += stat.errors;

      const duration = ((stat.endTime - stat.startTime) / 1000).toFixed(2);
      const status = stat.errors > 0 ? '⚠️' : '✅';

      console.log(
        `${status} ${stat.table.padEnd(30)} | ` +
        `Exported: ${stat.exported.toString().padStart(6)} | ` +
        `Imported: ${stat.imported.toString().padStart(6)} | ` +
        `Errors: ${stat.errors.toString().padStart(4)} | ` +
        `${duration}s`
      );
    }

    console.log('='.repeat(60));
    console.log(`Total Exported: ${totalExported}`);
    console.log(`Total Imported: ${totalImported}`);
    console.log(`Total Errors:   ${totalErrors}`);
    console.log(`Total Duration: ${totalDuration}s`);
    console.log('='.repeat(60));

    if (totalErrors === 0) {
      console.log('✅ Migration completed successfully!');
    } else {
      console.log('⚠️  Migration completed with errors. Check the report for details.');
    }

    console.log(`\n📦 SQLite backup saved at: ${this.backupPath}`);
  }

  /**
   * Save migration report to JSON
   */
  saveMigrationReport(): void {
    const reportPath = path.join(
      process.cwd(),
      'data',
      `migration-report-${Date.now()}.json`
    );

    const report = {
      timestamp: new Date().toISOString(),
      backupPath: this.backupPath,
      tables: this.stats,
      summary: {
        totalExported: this.stats.reduce((sum, s) => sum + s.exported, 0),
        totalImported: this.stats.reduce((sum, s) => sum + s.imported, 0),
        totalErrors: this.stats.reduce((sum, s) => sum + s.errors, 0),
      },
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📄 Migration report saved to: ${reportPath}`);
  }

  /**
   * Rollback migration (restore from backup)
   */
  async rollback(backupPath: string, originalPath: string): Promise<void> {
    console.log('🔄 Rolling back migration...');

    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    fs.copyFileSync(backupPath, originalPath);
    console.log(`✅ Restored SQLite database from ${backupPath}`);

    // Note: This doesn't delete data from Supabase
    console.log('⚠️  Note: This only restores SQLite. Data remains in Supabase.');
    console.log('   To clear Supabase data, use the Supabase dashboard or SQL.');
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'migrate';

  const dbPath = path.join(process.cwd(), 'data', 'bot.db');
  const migration = new MigrationService();

  try {
    if (command === 'migrate') {
      await migration.migrate(dbPath);
    } else if (command === 'rollback') {
      const backupPath = args[1];
      if (!backupPath) {
        console.error('❌ Please provide backup path: npm run migrate:rollback <backup-path>');
        process.exit(1);
      }
      await migration.rollback(backupPath, dbPath);
    } else {
      console.error(`❌ Unknown command: ${command}`);
      console.log('Usage:');
      console.log('  npm run migrate           - Run migration');
      console.log('  npm run migrate:rollback <backup-path>  - Rollback to backup');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Migration failed:', (error as Error).message);
    console.error((error as Error).stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { MigrationService };
