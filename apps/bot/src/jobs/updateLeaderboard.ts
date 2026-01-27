import { leaderboardService } from '../services/leaderboard';
import { logger } from '../utils/logger';

/**
 * Update Leaderboard Job
 * 
 * Runs every 6 hours to:
 * - Update prices for all active leaderboard entries
 * - Recalculate scores
 * - Mark entries as completed after 7 days
 * - Prune old entries
 */
export async function runLeaderboardUpdate(): Promise<void> {
  logger.info('LeaderboardJob', 'Starting leaderboard update...');
  
  const startTime = Date.now();
  let updatedCount = 0;
  let errorCount = 0;

  try {
    // Get all active entries (pending and within tracking window)
    const entries = await leaderboardService.getActiveEntries();
    
    if (entries.length === 0) {
      logger.info('LeaderboardJob', 'No active entries to update');
      return;
    }

    logger.info('LeaderboardJob', `Updating ${entries.length} active tokens...`);

    // Update each token (with rate limiting)
    for (const entry of entries) {
      try {
        await leaderboardService.updateTokenPerformance(entry.tokenMint);
        updatedCount++;

        // Rate limit: 1 update per second to avoid API throttling
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error('LeaderboardJob', `Failed to update ${entry.tokenMint}`, error as Error);
        errorCount++;
      }
    }

    // Prune old entries (keep for 30 days after tracking ends)
    const pruned = await leaderboardService.pruneOldEntries();
    if (pruned > 0) {
      logger.info('LeaderboardJob', `Pruned ${pruned} old entries`);
    }

    const duration = Date.now() - startTime;
    logger.info(
      'LeaderboardJob',
      `Update completed: ${updatedCount} updated, ${errorCount} errors, ${pruned} pruned (${duration}ms)`
    );
  } catch (error) {
    logger.error('LeaderboardJob', 'Leaderboard update failed', error as Error);
  }
}

/**
 * Initialize leaderboard update cron job
 * Runs every 6 hours
 */
export function initLeaderboardJob(): void {
  // Run immediately on startup
  runLeaderboardUpdate();

  // Then run every 6 hours
  setInterval(() => {
    runLeaderboardUpdate();
  }, 6 * 60 * 60 * 1000); // 6 hours in milliseconds

  logger.info('LeaderboardJob', 'Leaderboard update job initialized (runs every 6 hours)');
}
