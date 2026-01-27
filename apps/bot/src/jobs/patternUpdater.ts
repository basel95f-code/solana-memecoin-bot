/**
 * Pattern Updater Job
 * Runs daily to update pattern metrics and discover new patterns
 */

import { patternDetector } from '../services/patternDetector';
import { database } from '../database';
import { logger } from '../utils/logger';
import { telegramService as telegram } from '../services/telegram';
import { config } from '../config';

export async function updatePatterns(): Promise<void> {
  try {
    logger.info('PatternUpdater', 'Starting pattern update cycle');

    const startTime = Date.now();

    // 1. Update pattern metrics from recent outcomes
    await patternDetector.updatePatternMetrics();
    logger.info('PatternUpdater', 'Pattern metrics updated');

    // 2. Discover new patterns from new data
    const discoveredPatterns = await patternDetector.discoverPatterns();
    logger.info('PatternUpdater', `Discovered ${discoveredPatterns.length} new patterns`);

    // 3. Deactivate patterns with declining success rates
    const patterns = await patternDetector.getAllPatterns(true);
    let deactivatedCount = 0;

    for (const pattern of patterns) {
      if (pattern.occurrenceCount > 20 && pattern.successRate < 0.4) {
        await patternDetector.deactivatePattern(pattern.id!);
        deactivatedCount++;
        logger.warn('PatternUpdater', `Deactivated low-performing pattern: ${pattern.patternName}`);
      }
    }

    // 4. Recalculate confidence scores
    await recalculateConfidenceScores();
    logger.info('PatternUpdater', 'Confidence scores recalculated');

    // 5. Update pattern matches with actual outcomes
    await updateMatchOutcomes();
    logger.info('PatternUpdater', 'Pattern match outcomes updated');

    // 6. Generate performance report
    const report = generatePerformanceReport(discoveredPatterns, deactivatedCount);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info('PatternUpdater', `Pattern update cycle completed in ${duration}s`);

    // 7. Notify admins
    await notifyAdmins(report);

  } catch (error) {
    logger.error('PatternUpdater', 'Error during pattern update cycle', error as Error);

    // Notify admins of failure
    try {
      await telegram.sendMessage(
        config.ADMIN_CHAT_ID || '',
        `⚠️ Pattern Updater Failed\n\nError: ${(error as Error).message}\n\nPlease check logs.`
      );
    } catch (notifyError) {
      logger.error('PatternUpdater', 'Failed to notify admins', notifyError as Error);
    }
  }
}

/**
 * Recalculate confidence scores based on recent performance
 */
async function recalculateConfidenceScores(): Promise<void> {
  const patterns = await patternDetector.getAllPatterns(true);

  for (const pattern of patterns) {
    // Base confidence on success rate and sample size
    const sampleScore = Math.min(pattern.occurrenceCount / 50, 1); // Caps at 50 samples
    const performanceScore = pattern.successRate;

    // Recent performance weight (last 30 days)
    const recentMatches = database.all<any>(
      `SELECT * FROM token_pattern_matches 
       WHERE pattern_id = ? 
       AND matched_at > ? 
       AND actual_outcome IS NOT NULL 
       AND actual_outcome != 'pending'`,
      [pattern.id, Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60]
    );

    let recentScore = 0.5;
    if (recentMatches.length > 0) {
      const successfulMatches = recentMatches.filter(
        m => m.actual_outcome === 'success' || m.actual_outcome === 'moon'
      );
      recentScore = successfulMatches.length / recentMatches.length;
    }

    // Weighted confidence score
    const confidenceScore = 
      (performanceScore * 0.5) + 
      (sampleScore * 0.25) + 
      (recentScore * 0.25);

    database.run(
      'UPDATE success_patterns SET confidence_score = ? WHERE id = ?',
      [confidenceScore, pattern.id]
    );
  }
}

/**
 * Update pattern matches with actual outcomes from token_outcomes_v2
 */
async function updateMatchOutcomes(): Promise<void> {
  // Get all pending matches
  const pendingMatches = database.all<any>(
    `SELECT tpm.*, to2.outcome_type, to2.max_price, to2.initial_price
     FROM token_pattern_matches tpm
     LEFT JOIN token_outcomes_v2 to2 ON tpm.token_mint = to2.token_mint
     WHERE tpm.actual_outcome = 'pending'
     AND to2.outcome_type IS NOT NULL
     AND to2.outcome_type != 'unknown'`
  );

  for (const match of pendingMatches) {
    // Map outcome types
    const outcomeMap: Record<string, string> = {
      moon: 'success',
      pump: 'success',
      rug: 'rug',
      stable: 'neutral',
      decline: 'neutral',
    };

    const outcome = outcomeMap[match.outcome_type] || 'neutral';
    
    // Calculate peak multiplier
    const peakMultiplier = match.max_price && match.initial_price
      ? match.max_price / match.initial_price
      : null;

    database.run(
      `UPDATE token_pattern_matches 
       SET actual_outcome = ?, peak_multiplier = ?
       WHERE id = ?`,
      [outcome, peakMultiplier, match.id]
    );
  }

  logger.info('PatternUpdater', `Updated ${pendingMatches.length} match outcomes`);
}

/**
 * Generate performance report
 */
function generatePerformanceReport(discoveredPatterns: any[], deactivatedCount: number): string {
  const stats = patternDetector.getOverallStats();

  // Get top performing patterns
  const topPatterns = database.all<any>(
    `SELECT * FROM success_patterns 
     WHERE is_active = 1 AND pattern_type = 'success'
     ORDER BY success_rate DESC 
     LIMIT 5`
  );

  // Get pattern matches from last 24h
  const recentMatches = database.all<any>(
    `SELECT COUNT(*) as count, pattern_name, 
            SUM(CASE WHEN actual_outcome = 'success' THEN 1 ELSE 0 END) as successes
     FROM token_pattern_matches 
     WHERE matched_at > ?
     AND actual_outcome IS NOT NULL
     AND actual_outcome != 'pending'
     GROUP BY pattern_name
     ORDER BY count DESC
     LIMIT 5`,
    [Math.floor(Date.now() / 1000) - 24 * 60 * 60]
  );

  let report = '📊 Pattern Update Report\n\n';
  report += `Active Patterns: ${stats.activePatterns}\n`;
  report += `Success Patterns: ${stats.successPatterns}\n`;
  report += `Rug Patterns: ${stats.rugPatterns}\n`;
  report += `Avg Success Rate: ${(stats.avgSuccessRate * 100).toFixed(1)}%\n\n`;

  if (discoveredPatterns.length > 0) {
    report += `🆕 Discovered ${discoveredPatterns.length} new patterns\n`;
  }

  if (deactivatedCount > 0) {
    report += `❌ Deactivated ${deactivatedCount} low-performing patterns\n`;
  }

  if (topPatterns.length > 0) {
    report += '\n🏆 Top Patterns:\n';
    for (const pattern of topPatterns) {
      report += `  • ${pattern.pattern_name} (${(pattern.success_rate * 100).toFixed(0)}%)\n`;
    }
  }

  if (recentMatches.length > 0) {
    report += '\n📈 Last 24h Activity:\n';
    for (const match of recentMatches) {
      const successRate = match.count > 0 ? (match.successes / match.count * 100).toFixed(0) : 0;
      report += `  • ${match.pattern_name}: ${match.count} matches (${successRate}% success)\n`;
    }
  }

  return report;
}

/**
 * Notify admins about pattern updates
 */
async function notifyAdmins(report: string): Promise<void> {
  try {
    const adminChatId = config.ADMIN_CHAT_ID;
    if (!adminChatId) {
      logger.warn('PatternUpdater', 'No admin chat ID configured');
      return;
    }

    await telegram.sendMessage(adminChatId, report);
    logger.info('PatternUpdater', 'Admin notification sent');
  } catch (error) {
    logger.error('PatternUpdater', 'Error notifying admins', error as Error);
  }
}

/**
 * Start the pattern update scheduler
 * Runs daily at 2 AM
 */
export function startPatternUpdateScheduler(): void {
  const DAILY_CHECK_HOUR = 2;
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;

  // Calculate time until next 2 AM
  const now = new Date();
  const next2AM = new Date();
  next2AM.setHours(DAILY_CHECK_HOUR, 0, 0, 0);

  if (now.getHours() >= DAILY_CHECK_HOUR) {
    next2AM.setDate(next2AM.getDate() + 1);
  }

  const timeUntilNext = next2AM.getTime() - now.getTime();

  logger.info('PatternUpdater', `Scheduler started. Next update in ${(timeUntilNext / HOUR_MS).toFixed(1)} hours`);

  // Initial update after delay
  setTimeout(() => {
    updatePatterns().catch(error => {
      logger.error('PatternUpdater', 'Scheduled update failed', error as Error);
    });

    // Then update daily
    setInterval(() => {
      updatePatterns().catch(error => {
        logger.error('PatternUpdater', 'Scheduled update failed', error as Error);
      });
    }, DAY_MS);

  }, timeUntilNext);
}
