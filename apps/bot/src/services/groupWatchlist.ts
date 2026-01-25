import { database } from '../database';
import { logger } from '../utils/logger';
import { dexScreenerService } from './dexscreener';

export interface GroupWatchlistToken {
  id: number;
  chatId: string;
  tokenMint: string;
  symbol: string;
  name?: string;
  addedByUserId: number;
  addedByUsername?: string;
  addedAt: number;
  alertCount: number;
  lastAlertedAt?: number;
}

class GroupWatchlistService {
  /**
   * Add token to group watchlist
   */
  async addToGroupWatchlist(
    chatId: string,
    mint: string,
    userId: number,
    username?: string
  ): Promise<GroupWatchlistToken> {
    try {
      // Fetch token info from DexScreener
      const dexData = await dexScreenerService.getTokenData(mint);
      const symbol = dexData?.baseToken.symbol || 'UNKNOWN';
      const name = dexData?.baseToken.name || undefined;

      const now = Math.floor(Date.now() / 1000);
      const db = database.getDb();

      db.prepare(`
        INSERT INTO group_watchlist (
          chat_id, token_mint, symbol, name,
          added_by_user_id, added_by_username, added_at,
          alert_count, last_alerted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
      `).run(chatId, mint, symbol, name, userId, username, now);

      logger.info('GroupWatchlist', `Added ${symbol} to watchlist for chat ${chatId} by user ${userId}`);

      return {
        id: db.prepare('SELECT last_insert_rowid() as id').get() as any,
        chatId,
        tokenMint: mint,
        symbol,
        name,
        addedByUserId: userId,
        addedByUsername: username,
        addedAt: now,
        alertCount: 0,
        lastAlertedAt: undefined,
      };
    } catch (error) {
      logger.error('GroupWatchlist', 'Failed to add to group watchlist', error as Error);
      throw error;
    }
  }

  /**
   * Remove token from group watchlist
   */
  async removeFromGroupWatchlist(chatId: string, mint: string, userId: number): Promise<boolean> {
    try {
      const db = database.getDb();

      // Check if user is the one who added it (for permission check)
      const token = db.prepare(`
        SELECT added_by_user_id FROM group_watchlist
        WHERE chat_id = ? AND token_mint = ?
      `).get(chatId, mint) as { added_by_user_id: number } | undefined;

      if (!token) {
        return false;
      }

      // Delete the token
      db.prepare(`
        DELETE FROM group_watchlist
        WHERE chat_id = ? AND token_mint = ?
      `).run(chatId, mint);

      logger.info('GroupWatchlist', `Removed token ${mint} from chat ${chatId} by user ${userId}`);
      return true;
    } catch (error) {
      logger.error('GroupWatchlist', 'Failed to remove from group watchlist', error as Error);
      throw error;
    }
  }

  /**
   * Get full group watchlist
   */
  async getGroupWatchlist(chatId: string): Promise<GroupWatchlistToken[]> {
    try {
      const db = database.getDb();
      const rows = db.prepare(`
        SELECT * FROM group_watchlist
        WHERE chat_id = ?
        ORDER BY added_at DESC
      `).all(chatId);

      return rows.map((row: any) => this.deserializeToken(row));
    } catch (error) {
      logger.error('GroupWatchlist', 'Failed to get group watchlist', error as Error);
      return [];
    }
  }

  /**
   * Get hotlist (most active tokens)
   */
  async getHotlist(chatId: string, limit: number = 10): Promise<GroupWatchlistToken[]> {
    try {
      const db = database.getDb();
      const rows = db.prepare(`
        SELECT * FROM group_watchlist
        WHERE chat_id = ?
        ORDER BY alert_count DESC, last_alerted_at DESC
        LIMIT ?
      `).all(chatId, limit);

      return rows.map((row: any) => this.deserializeToken(row));
    } catch (error) {
      logger.error('GroupWatchlist', 'Failed to get hotlist', error as Error);
      return [];
    }
  }

  /**
   * Check if token is watched by group
   */
  async isWatchedByGroup(chatId: string, mint: string): Promise<boolean> {
    try {
      const db = database.getDb();
      const result = db.prepare(`
        SELECT COUNT(*) as count FROM group_watchlist
        WHERE chat_id = ? AND token_mint = ?
      `).get(chatId, mint) as { count: number };

      return result.count > 0;
    } catch (error) {
      logger.error('GroupWatchlist', 'Failed to check if watched', error as Error);
      return false;
    }
  }

  /**
   * Record that an alert was sent for a watched token
   */
  async recordGroupAlert(chatId: string, mint: string): Promise<void> {
    try {
      const db = database.getDb();
      const now = Math.floor(Date.now() / 1000);

      db.prepare(`
        UPDATE group_watchlist
        SET alert_count = alert_count + 1,
            last_alerted_at = ?
        WHERE chat_id = ? AND token_mint = ?
      `).run(now, chatId, mint);

      logger.debug('GroupWatchlist', `Recorded alert for ${mint} in chat ${chatId}`);
    } catch (error) {
      logger.error('GroupWatchlist', 'Failed to record group alert', error as Error);
    }
  }

  /**
   * Get token from watchlist
   */
  async getWatchedToken(chatId: string, mint: string): Promise<GroupWatchlistToken | null> {
    try {
      const db = database.getDb();
      const row = db.prepare(`
        SELECT * FROM group_watchlist
        WHERE chat_id = ? AND token_mint = ?
      `).get(chatId, mint);

      return row ? this.deserializeToken(row) : null;
    } catch (error) {
      logger.error('GroupWatchlist', 'Failed to get watched token', error as Error);
      return null;
    }
  }

  /**
   * Get watchlist count for a group
   */
  async getWatchlistCount(chatId: string): Promise<number> {
    try {
      const db = database.getDb();
      const result = db.prepare(`
        SELECT COUNT(*) as count FROM group_watchlist
        WHERE chat_id = ?
      `).get(chatId) as { count: number };

      return result.count;
    } catch (error) {
      logger.error('GroupWatchlist', 'Failed to get watchlist count', error as Error);
      return 0;
    }
  }

  /**
   * Find token by partial mint address or symbol
   */
  async findToken(chatId: string, searchTerm: string): Promise<GroupWatchlistToken | null> {
    try {
      const db = database.getDb();
      
      // Try exact mint match first
      let row = db.prepare(`
        SELECT * FROM group_watchlist
        WHERE chat_id = ? AND token_mint = ?
      `).get(chatId, searchTerm);

      // Try partial mint match
      if (!row) {
        row = db.prepare(`
          SELECT * FROM group_watchlist
          WHERE chat_id = ? AND token_mint LIKE ?
          LIMIT 1
        `).get(chatId, `${searchTerm}%`);
      }

      // Try symbol match (case insensitive)
      if (!row) {
        row = db.prepare(`
          SELECT * FROM group_watchlist
          WHERE chat_id = ? AND LOWER(symbol) = LOWER(?)
          LIMIT 1
        `).get(chatId, searchTerm);
      }

      return row ? this.deserializeToken(row) : null;
    } catch (error) {
      logger.error('GroupWatchlist', 'Failed to find token', error as Error);
      return null;
    }
  }

  /**
   * Deserialize database row to GroupWatchlistToken
   */
  private deserializeToken(row: any): GroupWatchlistToken {
    return {
      id: row.id,
      chatId: row.chat_id,
      tokenMint: row.token_mint,
      symbol: row.symbol,
      name: row.name,
      addedByUserId: row.added_by_user_id,
      addedByUsername: row.added_by_username,
      addedAt: row.added_at,
      alertCount: row.alert_count,
      lastAlertedAt: row.last_alerted_at,
    };
  }
}

export const groupWatchlistService = new GroupWatchlistService();
