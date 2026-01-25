/**
 * Database Factory
 * Switches between SQLite and Supabase based on configuration
 */

import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

const DATABASE_TYPE = process.env.DATABASE_TYPE || 'sqlite';

// Type guard interfaces
export interface DatabaseService {
  initialize(): Promise<void>;
  saveAnalysis(input: any): Promise<void> | void;
  getAnalysisByMint(mint: string): Promise<any> | any;
  wasRecentlyAnalyzed(mint: string, withinSeconds?: number): Promise<boolean> | boolean;
  saveAlert(input: any): Promise<void> | void;
  wasAlertSent(mint: string, chatId: string, alertType: string, withinSeconds?: number): Promise<boolean> | boolean;
  getStats(): Promise<any> | any;
  cleanup(keepDays?: number): Promise<void> | void;
  close(): Promise<void>;
  healthCheck(): Promise<any> | any;
  createBackup(): Promise<any> | any;
  getMigrationInfo(): any;
  getBackupInfo(): any;
  getDb(): any;
  
  // Backtest methods
  getTokensWithOutcomes?(startDate: number, endDate: number): Promise<any[]> | any[];
  saveBacktestStrategy?(strategy: any): Promise<number> | number;
  getBacktestStrategy?(name: string): Promise<any> | any;
  getAllBacktestStrategies?(): Promise<any[]> | any[];
  saveBacktestRun?(results: any, trades: any[]): Promise<number> | number;
  deleteBacktestStrategy?(name: string): Promise<void> | void;
  
  // Snapshot methods
  saveTokenSnapshot?(snapshot: any): Promise<void> | void;
  getTokenSnapshots?(mint: string, limit?: number): Promise<any[]> | any[];
  addToSnapshotWatchList?(mint: string, symbol?: string, expiresAt?: number): Promise<void> | void;
  removeFromSnapshotWatchList?(mint: string): Promise<void> | void;
  getSnapshotWatchList?(): Promise<any[]> | any[];
  updateSnapshotWatchEntry?(mint: string): Promise<void> | void;
  cleanupExpiredSnapshotWatches?(now: number): Promise<void> | void;
}

/**
 * Get database service instance
 */
async function getDatabaseService(): Promise<DatabaseService> {
  if (DATABASE_TYPE === 'supabase') {
    logger.info('Database', 'Using Supabase (PostgreSQL) backend');
    const { supabaseDb } = await import('./supabase-db');
    return supabaseDb;
  } else {
    logger.info('Database', 'Using SQLite backend');
    const { db } = await import('./index');
    
    // Wrap SQLite db to match async interface
    return {
      async initialize() {
        return db.initialize();
      },
      async saveAnalysis(input: any) {
        return db.saveAnalysis(input);
      },
      async getAnalysisByMint(mint: string) {
        return db.getAnalysisByMint(mint);
      },
      async wasRecentlyAnalyzed(mint: string, withinSeconds?: number) {
        return db.wasRecentlyAnalyzed(mint, withinSeconds);
      },
      async saveAlert(input: any) {
        return db.saveAlert(input);
      },
      async wasAlertSent(mint: string, chatId: string, alertType: string, withinSeconds?: number) {
        return db.wasAlertSent(mint, chatId, alertType, withinSeconds);
      },
      async getStats() {
        return db.getStats();
      },
      async cleanup(keepDays?: number) {
        return db.cleanup(keepDays);
      },
      async close() {
        return db.close();
      },
      async healthCheck() {
        return db.healthCheck();
      },
      async createBackup() {
        return db.createBackup();
      },
      getMigrationInfo() {
        return db.getMigrationInfo();
      },
      getBackupInfo() {
        return db.getBackupInfo();
      },
      getDb() {
        return db.getDb();
      },
      async getTokensWithOutcomes(startDate: number, endDate: number) {
        return db.getTokensWithOutcomes(startDate, endDate);
      },
      async saveBacktestStrategy(strategy: any) {
        return db.saveBacktestStrategy(strategy);
      },
      async getBacktestStrategy(name: string) {
        return db.getBacktestStrategy(name);
      },
      async getAllBacktestStrategies() {
        return db.getAllBacktestStrategies();
      },
      async saveBacktestRun(results: any, trades: any[]) {
        return db.saveBacktestRun(results, trades);
      },
      async deleteBacktestStrategy(name: string) {
        return db.deleteBacktestStrategy(name);
      },
      async saveTokenSnapshot(snapshot: any) {
        return db.saveTokenSnapshot(snapshot);
      },
      async getTokenSnapshots(mint: string, limit?: number) {
        return db.getTokenSnapshots(mint, limit);
      },
      async addToSnapshotWatchList(mint: string, symbol?: string, expiresAt?: number) {
        return db.addToSnapshotWatchList(mint, symbol, expiresAt);
      },
      async removeFromSnapshotWatchList(mint: string) {
        return db.removeFromSnapshotWatchList(mint);
      },
      async getSnapshotWatchList() {
        return db.getSnapshotWatchList();
      },
      async updateSnapshotWatchEntry(mint: string) {
        return db.updateSnapshotWatchEntry(mint);
      },
      async cleanupExpiredSnapshotWatches(now: number) {
        return db.cleanupExpiredSnapshotWatches(now);
      },
    };
  }
}

// Create singleton instance
let dbInstance: DatabaseService | null = null;

/**
 * Get initialized database instance
 */
export async function getDatabase(): Promise<DatabaseService> {
  if (!dbInstance) {
    dbInstance = await getDatabaseService();
    await dbInstance.initialize();
  }
  return dbInstance;
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
  }
}

export default getDatabase;
