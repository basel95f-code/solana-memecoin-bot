/**
 * Group Leaderboard Service
 * Tracks token calls and maintains leaderboard stats for group chats
 */

import { database } from '../database';
import { logger } from '../utils/logger';

export interface GroupCall {
  id?: number;
  groupId: string;
  userId: string;
  username?: string;
  tokenMint: string;
  symbol?: string;
  entryPrice: number;
  entryMcap?: number;
  calledAt: number;
  athPrice?: number;
  athMcap?: number;
  athTimestamp?: number;
  currentPrice?: number;
  currentReturn?: number;
  points: number;
  isRug: boolean;
  notes?: string;
}

export interface LeaderboardStats {
  groupId: string;
  userId: string;
  username?: string;
  totalCalls: number;
  totalPoints: number;
  hitRate: number;
  avgReturn: number;
  medianReturn: number;
  bestCall?: string;
  bestReturn: number;
  calls2x: number;
  calls5x: number;
  calls10x: number;
  calls50x: number;
  calls100x: number;
  callsRug: number;
  firstCallAt?: number;
  lastCallAt?: number;
}

export interface LeaderboardEntry extends LeaderboardStats {
  rank: number;
  tier: string;
}

class GroupLeaderboardService {
  /**
   * Record a new token call
   */
  async recordCall(
    groupId: string,
    userId: string,
    username: string | undefined,
    tokenMint: string,
    entryPrice: number,
    entryMcap?: number,
    symbol?: string
  ): Promise<GroupCall> {
    try {
      // Validate inputs
      if (!groupId || !userId || !tokenMint) {
        throw new Error('Missing required fields: groupId, userId, tokenMint');
      }

      if (entryPrice <= 0) {
        throw new Error('Entry price must be positive');
      }

      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tokenMint)) {
        throw new Error('Invalid Solana mint address');
      }

      const now = Math.floor(Date.now() / 1000);

      // Check for duplicate call (same token within last 5 minutes)
      const recentCall = database.query(
        `SELECT * FROM group_calls 
         WHERE group_id = ? AND user_id = ? AND token_mint = ? 
         AND called_at > ?`,
        [groupId, userId, tokenMint, now - 300]
      )[0];

      if (recentCall) {
        throw new Error('Duplicate call - this token was already called recently');
      }

      // Insert call
      database.run(
        `INSERT INTO group_calls 
         (group_id, user_id, username, token_mint, symbol, entry_price, entry_mcap, called_at, points, is_rug, current_return, current_price) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1.0, ?)`,
        [groupId, userId, username || null, tokenMint, symbol || null, entryPrice, entryMcap || null, now, entryPrice]
      );

      const call: GroupCall = {
        groupId,
        userId,
        username,
        tokenMint,
        symbol,
        entryPrice,
        entryMcap,
        calledAt: now,
        currentPrice: entryPrice,
        currentReturn: 1.0,
        points: 0,
        isRug: false
      };

      logger.info('GroupLeaderboard', `Call recorded: ${username || userId} called ${symbol || tokenMint} at $${entryPrice}`);

      return call;
    } catch (error) {
      logger.error('GroupLeaderboard', 'Failed to record call', error as Error);
      throw error;
    }
  }

  /**
   * Update call performance with current price data
   */
  async updateCallPerformance(
    callId: number,
    currentPrice: number,
    currentMcap?: number
  ): Promise<void> {
    try {
      const call = database.query(
        'SELECT * FROM group_calls WHERE id = ?',
        [callId]
      )[0];

      if (!call) {
        throw new Error(`Call not found: ${callId}`);
      }

      const currentReturn = currentPrice / call.entryPrice;
      const points = this.calculatePoints(currentReturn, call.isRug);

      // Update ATH if current price is higher
      const athPrice = Math.max(call.athPrice || 0, currentPrice);
      const athTimestamp = athPrice === currentPrice ? Math.floor(Date.now() / 1000) : call.athTimestamp;

      database.run(
        `UPDATE group_calls 
         SET current_price = ?, current_return = ?, points = ?, ath_price = ?, ath_timestamp = ?, updated_at = ?
         WHERE id = ?`,
        [currentPrice, currentReturn, points, athPrice, athTimestamp, Math.floor(Date.now() / 1000), callId]
      );

      logger.debug('GroupLeaderboard', `Updated call ${callId}: ${currentReturn.toFixed(2)}x (${points} points)`);
    } catch (error) {
      logger.error('GroupLeaderboard', 'Failed to update call performance', error as Error);
      throw error;
    }
  }

  /**
   * Calculate points based on ROI
   */
  calculatePoints(currentReturn: number, isRug: boolean): number {
    if (isRug) return -5;
    if (currentReturn < 1.0) return -2;
    if (currentReturn >= 100) return 30;
    if (currentReturn >= 50) return 20;
    if (currentReturn >= 10) return 10;
    if (currentReturn >= 5) return 5;
    if (currentReturn >= 2) return 2;
    return 0;
  }

  /**
   * Get leaderboard for a group
   */
  async getGroupLeaderboard(
    groupId: string,
    timeframe: string = '7d',
    limit: number = 10
  ): Promise<LeaderboardEntry[]> {
    try {
      // Calculate time filter
      const now = Math.floor(Date.now() / 1000);
      let timeFilter = 0;

      switch (timeframe) {
        case '1d':
          timeFilter = now - 86400;
          break;
        case '7d':
          timeFilter = now - 604800;
          break;
        case '30d':
          timeFilter = now - 2592000;
          break;
        case 'all':
        default:
          timeFilter = 0;
      }

      // Query leaderboard stats
      const stats = database.query(
        `SELECT 
          group_id as groupId,
          user_id as userId,
          username,
          total_calls as totalCalls,
          total_points as totalPoints,
          hit_rate as hitRate,
          avg_return as avgReturn,
          median_return as medianReturn,
          best_call as bestCall,
          best_return as bestReturn,
          calls_2x as calls2x,
          calls_5x as calls5x,
          calls_10x as calls10x,
          calls_50x as calls50x,
          calls_100x as calls100x,
          calls_rug as callsRug
        FROM leaderboard_stats
        WHERE group_id = ?
        ORDER BY total_points DESC
        LIMIT ?`,
        [groupId, limit]
      );

      // Add ranking and tier
      const leaderboard: LeaderboardEntry[] = stats.map((stat, index) => ({
        ...stat,
        rank: index + 1,
        tier: this.getTier(stat.totalPoints)
      }));

      return leaderboard;
    } catch (error) {
      logger.error('GroupLeaderboard', 'Failed to get leaderboard', error as Error);
      return [];
    }
  }

  /**
   * Get user stats in a group
   */
  async getUserStats(groupId: string, userId: string): Promise<LeaderboardStats | null> {
    try {
      const stats = database.query(
        `SELECT 
          group_id as groupId,
          user_id as userId,
          username,
          total_calls as totalCalls,
          total_points as totalPoints,
          hit_rate as hitRate,
          avg_return as avgReturn,
          median_return as medianReturn,
          best_call as bestCall,
          best_return as bestReturn,
          calls_2x as calls2x,
          calls_5x as calls5x,
          calls_10x as calls10x,
          calls_50x as calls50x,
          calls_100x as calls100x,
          calls_rug as callsRug,
          first_call_at as firstCallAt,
          last_call_at as lastCallAt
        FROM leaderboard_stats
        WHERE group_id = ? AND user_id = ?`,
        [groupId, userId]
      )[0];

      return stats || null;
    } catch (error) {
      logger.error('GroupLeaderboard', 'Failed to get user stats', error as Error);
      return null;
    }
  }

  /**
   * Get recent calls in a group
   */
  async getRecentCalls(groupId: string, limit: number = 20): Promise<GroupCall[]> {
    try {
      const calls = database.query(
        `SELECT 
          id, group_id as groupId, user_id as userId, username,
          token_mint as tokenMint, symbol, entry_price as entryPrice,
          current_price as currentPrice, current_return as currentReturn,
          points, is_rug as isRug, called_at as calledAt
        FROM group_calls
        WHERE group_id = ?
        ORDER BY called_at DESC
        LIMIT ?`,
        [groupId, limit]
      );

      return calls;
    } catch (error) {
      logger.error('GroupLeaderboard', 'Failed to get recent calls', error as Error);
      return [];
    }
  }

  /**
   * Mark a call as rug
   */
  async markAsRug(callId: number): Promise<void> {
    try {
      database.run(
        `UPDATE group_calls SET is_rug = 1, points = -5, updated_at = ? WHERE id = ?`,
        [Math.floor(Date.now() / 1000), callId]
      );

      logger.info('GroupLeaderboard', `Marked call ${callId} as rug`);
    } catch (error) {
      logger.error('GroupLeaderboard', 'Failed to mark as rug', error as Error);
      throw error;
    }
  }

  /**
   * Delete a call (within 5 minutes of creation)
   */
  async deleteCall(callId: number, userId: string): Promise<boolean> {
    try {
      const call = database.query(
        'SELECT * FROM group_calls WHERE id = ? AND user_id = ?',
        [callId, userId]
      )[0];

      if (!call) {
        return false;
      }

      const now = Math.floor(Date.now() / 1000);
      if (now - call.calledAt > 300) {
        throw new Error('Cannot delete calls older than 5 minutes');
      }

      database.run('DELETE FROM group_calls WHERE id = ?', [callId]);

      logger.info('GroupLeaderboard', `Deleted call ${callId}`);
      return true;
    } catch (error) {
      logger.error('GroupLeaderboard', 'Failed to delete call', error as Error);
      throw error;
    }
  }

  /**
   * Get tier emoji based on points
   */
  private getTier(points: number): string {
    if (points >= 100) return '🏆 Champion';
    if (points >= 50) return '💎 Diamond';
    if (points >= 25) return '🚀 Rocket';
    if (points >= 10) return '📈 Trader';
    if (points >= 1) return '🌱 Seedling';
    return '😭 Rekt';
  }
}

export const groupLeaderboard = new GroupLeaderboardService();
