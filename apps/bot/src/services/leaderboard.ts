import { database } from '../database';
import { logger } from '../utils/logger';
import { dexScreenerService } from './dexscreener';

export interface LeaderboardEntry {
  id: number;
  chatId: string;
  userId: number;
  username?: string;
  tokenMint: string;
  symbol: string;
  name?: string;
  discoveredAt: number;
  initialPrice: number;
  peakPrice: number;
  currentPrice: number;
  peakMultiplier: number;
  score: number;
  outcome: 'moon' | 'profit' | 'stable' | 'loss' | 'pending';
  trackedUntil: number;
  lastUpdatedAt: number;
}

export interface LeaderboardRanking {
  userId: number;
  username?: string;
  gemsFound: number;
  avgMultiplier: number;
  totalScore: number;
  successRate: number; // Percentage of profitable calls
}

export interface UserStats {
  userId: number;
  username?: string;
  totalTokens: number;
  bestMultiplier: number;
  bestTokenSymbol?: string;
  avgMultiplier: number;
  successRate: number;
  totalScore: number;
  currentRank: number;
}

class LeaderboardService {
  /**
   * Record a new token discovery
   * Called when user adds token to group watchlist
   */
  async recordDiscovery(
    chatId: string,
    userId: number,
    username: string | undefined,
    mint: string,
    symbol: string,
    name: string | undefined,
    initialPrice: number
  ): Promise<LeaderboardEntry> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const trackedUntil = now + (7 * 24 * 60 * 60); // 7 days from now

      const db = database.getDb();

      db.prepare(`
        INSERT INTO leaderboard_entries (
          chat_id, user_id, username,
          token_mint, symbol, name,
          discovered_at, initial_price,
          peak_price, current_price, peak_multiplier,
          score, outcome,
          tracked_until, last_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        chatId, userId, username,
        mint, symbol, name,
        now, initialPrice,
        initialPrice, initialPrice, 1.0, // Initial values
        0, 'pending', // Initial score and outcome
        trackedUntil, now
      );

      logger.info('Leaderboard', `Recorded discovery: ${symbol} by user ${userId} in chat ${chatId}`);

      const result = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };

      return {
        id: result.id,
        chatId,
        userId,
        username,
        tokenMint: mint,
        symbol,
        name,
        discoveredAt: now,
        initialPrice,
        peakPrice: initialPrice,
        currentPrice: initialPrice,
        peakMultiplier: 1.0,
        score: 0,
        outcome: 'pending',
        trackedUntil,
        lastUpdatedAt: now,
      };
    } catch (error) {
      logger.error('Leaderboard', 'Failed to record discovery', error as Error);
      throw error;
    }
  }

  /**
   * Update token performance
   * Fetch latest price and recalculate scores
   */
  async updateTokenPerformance(mint: string): Promise<void> {
    try {
      const db = database.getDb();
      
      // Get all active entries for this token
      const entries = db.prepare(`
        SELECT * FROM leaderboard_entries
        WHERE token_mint = ? AND outcome = 'pending'
      `).all(mint) as any[];

      if (entries.length === 0) {
        return;
      }

      // Fetch current price from DexScreener
      const dexData = await dexScreenerService.getTokenData(mint);
      if (!dexData || !dexData.priceUsd) {
        logger.warn('Leaderboard', `No price data for ${mint}`);
        return;
      }

      const currentPrice = parseFloat(dexData.priceUsd);
      const now = Math.floor(Date.now() / 1000);

      for (const entry of entries) {
        const peakPrice = Math.max(entry.peak_price, currentPrice);
        const peakMultiplier = peakPrice / entry.initial_price;

        // Calculate score
        const score = this.calculateScore({
          ...entry,
          current_price: currentPrice,
          peak_price: peakPrice,
          peak_multiplier: peakMultiplier,
          discovered_at: entry.discovered_at,
        });

        // Determine outcome
        let outcome = 'pending';
        if (now >= entry.tracked_until) {
          // Tracking period ended - classify outcome
          if (peakMultiplier >= 10) {
            outcome = 'moon';
          } else if (peakMultiplier >= 2) {
            outcome = 'profit';
          } else if (peakMultiplier >= 0.8) {
            outcome = 'stable';
          } else {
            outcome = 'loss';
          }
        } else {
          // Still tracking - check for early outcomes
          if (currentPrice < entry.initial_price * 0.2) {
            outcome = 'loss'; // Rugged (80% drop)
          }
        }

        // Update entry
        db.prepare(`
          UPDATE leaderboard_entries
          SET current_price = ?,
              peak_price = ?,
              peak_multiplier = ?,
              score = ?,
              outcome = ?,
              last_updated_at = ?
          WHERE id = ?
        `).run(currentPrice, peakPrice, peakMultiplier, score, outcome, now, entry.id);
      }

      logger.debug('Leaderboard', `Updated ${entries.length} entries for ${mint}`);
    } catch (error) {
      logger.error('Leaderboard', `Failed to update token performance for ${mint}`, error as Error);
    }
  }

  /**
   * Calculate score for an entry
   * 
   * Scoring algorithm:
   * - Base score = peak_multiplier * 100
   * - Quick moon (24h): +50
   * - Still holding peak: +25
   * - No rug: +10
   * - Rugged: -100
   * - Quick dump: -50
   */
  calculateScore(entry: any): number {
    const baseScore = entry.peak_multiplier * 100;
    let bonuses = 0;

    const now = Math.floor(Date.now() / 1000);
    const timeSinceDiscovery = now - entry.discovered_at;
    const currentMultiplier = entry.current_price / entry.initial_price;

    // Quick moon bonus (reached 10x within 24 hours)
    if (entry.peak_multiplier >= 10 && timeSinceDiscovery <= 24 * 60 * 60) {
      bonuses += 50;
    }

    // Still holding peak bonus (current price within 10% of peak)
    if (currentMultiplier >= entry.peak_multiplier * 0.9) {
      bonuses += 25;
    }

    // No rug bonus (current price still above 50% of initial)
    if (currentMultiplier >= 0.5) {
      bonuses += 10;
    }

    // Rugged penalty (dropped below 20% of initial)
    if (currentMultiplier < 0.2) {
      bonuses -= 100;
    }

    // Quick dump penalty (reached peak then dumped 50% within 6 hours)
    if (entry.peak_multiplier > 2 && currentMultiplier < entry.peak_multiplier * 0.5) {
      const timeSincePeak = now - entry.discovered_at; // Simplified - we don't track exact peak time
      if (timeSincePeak <= 6 * 60 * 60) {
        bonuses -= 50;
      }
    }

    return Math.max(0, baseScore + bonuses); // Don't allow negative scores
  }

  /**
   * Get leaderboard rankings for a chat
   */
  async getLeaderboard(
    chatId: string,
    period: 'week' | 'month' | 'alltime' = 'week'
  ): Promise<LeaderboardRanking[]> {
    try {
      const db = database.getDb();
      const now = Math.floor(Date.now() / 1000);

      let timeFilter = '';
      if (period === 'week') {
        timeFilter = `AND discovered_at >= ${now - 7 * 24 * 60 * 60}`;
      } else if (period === 'month') {
        timeFilter = `AND discovered_at >= ${now - 30 * 24 * 60 * 60}`;
      }

      const rows = db.prepare(`
        SELECT 
          le.user_id,
          le.username,
          COUNT(*) as gems_found,
          AVG(peak_multiplier) as avg_multiplier,
          SUM(score) as total_score,
          SUM(CASE WHEN outcome IN ('moon', 'profit') THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate,
          COALESCE(us.participate_in_leaderboard, 0) as opted_in
        FROM leaderboard_entries le
        LEFT JOIN user_settings us ON le.user_id = us.user_id
        WHERE le.chat_id = ? ${timeFilter}
        GROUP BY le.user_id
        ORDER BY total_score DESC
        LIMIT 10
      `).all(chatId) as any[];

      return rows.map(row => ({
        userId: row.user_id,
        username: row.opted_in ? row.username : undefined, // Anonymize if opted out
        gemsFound: row.gems_found,
        avgMultiplier: parseFloat(row.avg_multiplier || 0),
        totalScore: parseFloat(row.total_score || 0),
        successRate: parseFloat(row.success_rate || 0),
      }));
    } catch (error) {
      logger.error('Leaderboard', 'Failed to get leaderboard', error as Error);
      return [];
    }
  }

  /**
   * Get individual user stats
   */
  async getUserStats(chatId: string, userId: number): Promise<UserStats | null> {
    try {
      const db = database.getDb();

      const stats = db.prepare(`
        SELECT 
          user_id,
          username,
          COUNT(*) as total_tokens,
          MAX(peak_multiplier) as best_multiplier,
          AVG(peak_multiplier) as avg_multiplier,
          SUM(score) as total_score,
          SUM(CASE WHEN outcome IN ('moon', 'profit') THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate
        FROM leaderboard_entries
        WHERE chat_id = ? AND user_id = ?
        GROUP BY user_id
      `).get(chatId, userId) as any;

      if (!stats) {
        return null;
      }

      // Get best performing token
      const bestToken = db.prepare(`
        SELECT symbol FROM leaderboard_entries
        WHERE chat_id = ? AND user_id = ?
        ORDER BY peak_multiplier DESC
        LIMIT 1
      `).get(chatId, userId) as any;

      // Get user's rank
      const rankResult = db.prepare(`
        SELECT COUNT(*) + 1 as rank
        FROM (
          SELECT user_id, SUM(score) as total_score
          FROM leaderboard_entries
          WHERE chat_id = ?
          GROUP BY user_id
          HAVING total_score > (
            SELECT SUM(score)
            FROM leaderboard_entries
            WHERE chat_id = ? AND user_id = ?
          )
        )
      `).get(chatId, chatId, userId) as any;

      return {
        userId: stats.user_id,
        username: stats.username,
        totalTokens: stats.total_tokens,
        bestMultiplier: parseFloat(stats.best_multiplier || 0),
        bestTokenSymbol: bestToken?.symbol,
        avgMultiplier: parseFloat(stats.avg_multiplier || 0),
        successRate: parseFloat(stats.success_rate || 0),
        totalScore: parseFloat(stats.total_score || 0),
        currentRank: rankResult?.rank || 0,
      };
    } catch (error) {
      logger.error('Leaderboard', 'Failed to get user stats', error as Error);
      return null;
    }
  }

  /**
   * Prune old entries (cleanup job)
   * Removes entries that are past their tracking window and marked as completed
   */
  async pruneOldEntries(): Promise<number> {
    try {
      const db = database.getDb();
      const now = Math.floor(Date.now() / 1000);
      const cutoff = now - 30 * 24 * 60 * 60; // Keep for 30 days after tracking ends

      const result = db.prepare(`
        DELETE FROM leaderboard_entries
        WHERE tracked_until < ? AND outcome != 'pending'
      `).run(cutoff);

      const deleted = result.changes || 0;
      if (deleted > 0) {
        logger.info('Leaderboard', `Pruned ${deleted} old entries`);
      }

      return deleted;
    } catch (error) {
      logger.error('Leaderboard', 'Failed to prune old entries', error as Error);
      return 0;
    }
  }

  /**
   * Get all active entries that need updating
   */
  async getActiveEntries(): Promise<LeaderboardEntry[]> {
    try {
      const db = database.getDb();
      const now = Math.floor(Date.now() / 1000);

      const rows = db.prepare(`
        SELECT DISTINCT token_mint
        FROM leaderboard_entries
        WHERE outcome = 'pending' AND tracked_until > ?
      `).all(now) as any[];

      return rows;
    } catch (error) {
      logger.error('Leaderboard', 'Failed to get active entries', error as Error);
      return [];
    }
  }

  /**
   * Check if user has opted into leaderboard
   */
  async hasOptedIn(userId: number): Promise<boolean> {
    try {
      const db = database.getDb();
      const result = db.prepare(`
        SELECT participate_in_leaderboard
        FROM user_settings
        WHERE user_id = ?
      `).get(userId) as any;

      return result?.participate_in_leaderboard === 1;
    } catch (error) {
      logger.error('Leaderboard', 'Failed to check opt-in status', error as Error);
      return false;
    }
  }

  /**
   * Check if leaderboard is enabled in group
   */
  async isEnabledInGroup(chatId: string): Promise<boolean> {
    try {
      const db = database.getDb();
      const result = db.prepare(`
        SELECT enable_leaderboard
        FROM group_settings
        WHERE chat_id = ?
      `).get(chatId) as any;

      return result?.enable_leaderboard === 1;
    } catch (error) {
      logger.error('Leaderboard', 'Failed to check group leaderboard status', error as Error);
      return false;
    }
  }
}

export const leaderboardService = new LeaderboardService();
