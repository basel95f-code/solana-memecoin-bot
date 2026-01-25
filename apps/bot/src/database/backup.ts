/**
 * Database Backup System
 * Handles automated backups with compression and rotation
 */

import type { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

interface BackupInfo {
  filename: string;
  path: string;
  sizeBytes: number;
  compressed: boolean;
  timestamp: number;
}

export class DatabaseBackupService {
  private db: SqlJsDatabase | null = null;
  private dbPath: string = '';
  private backupDir: string = '';
  private backupInterval: NodeJS.Timeout | null = null;
  private readonly maxBackups = 7; // Keep last 7 backups

  /**
   * Initialize backup service
   */
  initialize(db: SqlJsDatabase, dbPath: string): void {
    this.db = db;
    this.dbPath = dbPath;
    this.backupDir = path.join(path.dirname(dbPath), 'backups');

    // Create backup directory if it doesn't exist
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
      logger.info('Backup', `Created backup directory: ${this.backupDir}`);
    }
  }

  /**
   * Create a backup of the database
   */
  async createBackup(compress: boolean = true): Promise<BackupInfo | null> {
    if (!this.db) {
      logger.error('Backup', 'Database not initialized');
      return null;
    }

    const timestamp = Date.now();
    const dateStr = new Date(timestamp).toISOString().replace(/[:.]/g, '-').split('T')[0];
    const timeStr = new Date(timestamp).toISOString().replace(/[:.]/g, '-').split('T')[1].split('Z')[0];
    const filename = `bot-db-${dateStr}_${timeStr}.db`;
    const backupPath = path.join(this.backupDir, filename);

    try {
      // Export database to buffer
      const data = this.db.export();
      const buffer = Buffer.from(data);

      // Write to file
      fs.writeFileSync(backupPath, buffer);
      logger.info('Backup', `Created backup: ${filename} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

      let finalPath = backupPath;
      let finalSize = buffer.length;
      let isCompressed = false;

      // Compress if requested and file is large enough
      if (compress && buffer.length > 1024 * 1024) {
        // Only compress if > 1MB
        try {
          const compressedPath = await this.compressBackup(backupPath);
          if (compressedPath) {
            // Remove uncompressed file
            fs.unlinkSync(backupPath);
            finalPath = compressedPath;
            finalSize = fs.statSync(compressedPath).size;
            isCompressed = true;
            logger.info(
              'Backup',
              `Compressed backup: ${(finalSize / 1024 / 1024).toFixed(2)} MB (${((1 - finalSize / buffer.length) * 100).toFixed(1)}% reduction)`
            );
          }
        } catch (error) {
          logger.warn('Backup', `Failed to compress backup: ${(error as Error).message}`);
          // Keep uncompressed version
        }
      }

      return {
        filename: path.basename(finalPath),
        path: finalPath,
        sizeBytes: finalSize,
        compressed: isCompressed,
        timestamp,
      };
    } catch (error) {
      logger.error('Backup', 'Failed to create backup', error as Error);
      return null;
    }
  }

  /**
   * Compress a backup file using gzip
   */
  private async compressBackup(backupPath: string): Promise<string | null> {
    const gzipPath = `${backupPath}.gz`;

    try {
      // Check if gzip is available
      try {
        await execAsync('gzip --version');
      } catch {
        // gzip not available
        return null;
      }

      // Compress using gzip
      await execAsync(`gzip -c "${backupPath}" > "${gzipPath}"`);

      if (fs.existsSync(gzipPath)) {
        return gzipPath;
      }

      return null;
    } catch (error) {
      logger.silentError('Backup', 'Compression failed', error as Error);
      return null;
    }
  }

  /**
   * List all backups
   */
  listBackups(): BackupInfo[] {
    if (!fs.existsSync(this.backupDir)) {
      return [];
    }

    try {
      const files = fs.readdirSync(this.backupDir);
      const backups: BackupInfo[] = [];

      for (const file of files) {
        if (file.startsWith('bot-db-') && (file.endsWith('.db') || file.endsWith('.db.gz'))) {
          const filePath = path.join(this.backupDir, file);
          const stats = fs.statSync(filePath);

          backups.push({
            filename: file,
            path: filePath,
            sizeBytes: stats.size,
            compressed: file.endsWith('.gz'),
            timestamp: stats.mtimeMs,
          });
        }
      }

      // Sort by timestamp (newest first)
      backups.sort((a, b) => b.timestamp - a.timestamp);

      return backups;
    } catch (error) {
      logger.silentError('Backup', 'Failed to list backups', error as Error);
      return [];
    }
  }

  /**
   * Clean up old backups (keep only the most recent N backups)
   */
  cleanupOldBackups(): void {
    const backups = this.listBackups();

    if (backups.length <= this.maxBackups) {
      return;
    }

    const toDelete = backups.slice(this.maxBackups);

    logger.info('Backup', `Cleaning up ${toDelete.length} old backup(s)`);

    for (const backup of toDelete) {
      try {
        fs.unlinkSync(backup.path);
        logger.debug('Backup', `Deleted old backup: ${backup.filename}`);
      } catch (error) {
        logger.silentError('Backup', `Failed to delete backup: ${backup.filename}`, error as Error);
      }
    }
  }

  /**
   * Restore from a backup
   */
  async restoreBackup(backupPath: string): Promise<boolean> {
    try {
      if (!fs.existsSync(backupPath)) {
        logger.error('Backup', `Backup file not found: ${backupPath}`);
        return false;
      }

      let dataBuffer: Buffer;

      // Check if compressed
      if (backupPath.endsWith('.gz')) {
        // Decompress first
        const tempPath = backupPath.replace('.gz', '.tmp');
        await execAsync(`gzip -dc "${backupPath}" > "${tempPath}"`);
        dataBuffer = fs.readFileSync(tempPath);
        fs.unlinkSync(tempPath);
      } else {
        dataBuffer = fs.readFileSync(backupPath);
      }

      // Write to database path
      fs.writeFileSync(this.dbPath, dataBuffer);

      logger.info('Backup', `✅ Database restored from: ${path.basename(backupPath)}`);
      return true;
    } catch (error) {
      logger.error('Backup', 'Failed to restore backup', error as Error);
      return false;
    }
  }

  /**
   * Start automatic daily backups
   */
  startAutomaticBackups(intervalHours: number = 24): void {
    if (this.backupInterval) {
      logger.warn('Backup', 'Automatic backups already running');
      return;
    }

    const intervalMs = intervalHours * 60 * 60 * 1000;

    logger.info('Backup', `Starting automatic backups (every ${intervalHours} hours)`);

    // Create initial backup
    this.createBackup(true).then((backup) => {
      if (backup) {
        this.cleanupOldBackups();
      }
    });

    // Schedule periodic backups
    this.backupInterval = setInterval(async () => {
      try {
        const backup = await this.createBackup(true);
        if (backup) {
          this.cleanupOldBackups();
        }
      } catch (error) {
        logger.error('Backup', 'Automatic backup failed', error as Error);
      }
    }, intervalMs);
  }

  /**
   * Stop automatic backups
   */
  stopAutomaticBackups(): void {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
      logger.info('Backup', 'Automatic backups stopped');
    }
  }

  /**
   * Get backup statistics
   */
  getStats(): {
    totalBackups: number;
    totalSizeBytes: number;
    oldestBackup: number | null;
    newestBackup: number | null;
  } {
    const backups = this.listBackups();

    const totalSizeBytes = backups.reduce((sum, b) => sum + b.sizeBytes, 0);

    return {
      totalBackups: backups.length,
      totalSizeBytes,
      oldestBackup: backups.length > 0 ? backups[backups.length - 1].timestamp : null,
      newestBackup: backups.length > 0 ? backups[0].timestamp : null,
    };
  }
}

// Singleton instance
export const backupService = new DatabaseBackupService();
