/**
 * Achievement & Badge System
 * Automatically detects and awards badges based on user performance
 */

import { database } from '../database';
import { logger } from '../utils/logger';

export interface Achievement {
  badgeType: string;
  emoji: string;
  name: string;
  description: string;
  earnedAt?: number;
}

export interface Badge {
  emoji: string;
  name: string;
  description: string;
  requirement: string;
}

/**
 * Available badges with their criteria
 */
export const AVAILABLE_BADGES: Record<string, Badge> = {
  legend: {
    emoji: '🏆',
    name: 'Legend',
    description: 'Elite trader status',
    requirement: '1000+ total points'
  },
  diamond_caller: {
    emoji: '💎',
    name: 'Diamond Caller',
    description: 'Master of moons',
    requirement: '5 calls with 10x+ ROI'
  },
  sniper: {
    emoji: '🎯',
    name: 'Sniper',
    description: 'Early bird champion',
    requirement: '10 first-hour calls that mooned'
  },
  guardian: {
    emoji: '🛡️',
    name: 'Guardian',
    description: 'Protector of the community',
    requirement: 'Identified 10+ rugs'
  },
  moonshot: {
    emoji: '🚀',
    name: 'Moonshot',
    description: 'Called a 100x gem',
    requirement: 'At least one 100x+ call'
  },
  consistent: {
    emoji: '📈',
    name: 'Consistent',
    description: 'Reliable performer',
    requirement: '70%+ hit rate with 20+ calls'
  },
  veteran: {
    emoji: '⭐',
    name: 'Veteran',
    description: 'Experienced trader',
    requirement: '100+ total calls'
  },
  whale_hunter: {
    emoji: '🐋',
    name: 'Whale Hunter',
    description: 'Tracks big players',
    requirement: '5 calls following whale wallets'
  }
};

class AchievementService {
  /**
   * Check and award achievements for a user
   */
  async checkAchievements(groupId: string, userId: string): Promise<Achievement[]> {
    try {
      // Get user stats
      const stats = database.query(
        'SELECT * FROM leaderboard_stats WHERE group_id = ? AND user_id = ?',
        [groupId, userId]
      )[0];

      if (!stats) return [];

      const newAchievements: Achievement[] = [];

      // Check each badge criteria
      if (stats.total_points >= 1000 && !this.hasAchievement(userId, groupId, 'legend')) {
        await this.awardAchievement(userId, groupId, 'legend');
        newAchievements.push(this.formatAchievement('legend'));
      }

      if (stats.calls_10x >= 5 && !this.hasAchievement(userId, groupId, 'diamond_caller')) {
        await this.awardAchievement(userId, groupId, 'diamond_caller');
        newAchievements.push(this.formatAchievement('diamond_caller'));
      }

      if (stats.calls_100x >= 1 && !this.hasAchievement(userId, groupId, 'moonshot')) {
        await this.awardAchievement(userId, groupId, 'moonshot');
        newAchievements.push(this.formatAchievement('moonshot'));
      }

      if (stats.total_calls >= 20 && stats.hit_rate >= 70 && !this.hasAchievement(userId, groupId, 'consistent')) {
        await this.awardAchievement(userId, groupId, 'consistent');
        newAchievements.push(this.formatAchievement('consistent'));
      }

      if (stats.total_calls >= 100 && !this.hasAchievement(userId, groupId, 'veteran')) {
        await this.awardAchievement(userId, groupId, 'veteran');
        newAchievements.push(this.formatAchievement('veteran'));
      }

      if (stats.calls_rug >= 10 && !this.hasAchievement(userId, groupId, 'guardian')) {
        await this.awardAchievement(userId, groupId, 'guardian');
        newAchievements.push(this.formatAchievement('guardian'));
      }

      return newAchievements;
    } catch (error) {
      logger.error('Achievements', 'Failed to check achievements', error as Error);
      return [];
    }
  }

  /**
   * Check if user has an achievement
   */
  private hasAchievement(userId: string, groupId: string, badgeType: string): boolean {
    const result = database.query(
      'SELECT 1 FROM user_achievements WHERE user_id = ? AND group_id = ? AND badge_type = ?',
      [userId, groupId, badgeType]
    )[0];

    return !!result;
  }

  /**
   * Award an achievement to a user
   */
  private async awardAchievement(userId: string, groupId: string, badgeType: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    database.run(
      `INSERT OR IGNORE INTO user_achievements (user_id, group_id, badge_type, earned_at)
       VALUES (?, ?, ?, ?)`,
      [userId, groupId, badgeType, now]
    );

    logger.info('Achievements', `Awarded ${badgeType} to user ${userId} in group ${groupId}`);
  }

  /**
   * Get all achievements for a user
   */
  async getUserAchievements(groupId: string, userId: string): Promise<Achievement[]> {
    try {
      const results = database.query(
        'SELECT * FROM user_achievements WHERE user_id = ? AND group_id = ? ORDER BY earned_at DESC',
        [userId, groupId]
      );

      return results.map(r => this.formatAchievement(r.badge_type, r.earned_at));
    } catch (error) {
      logger.error('Achievements', 'Failed to get achievements', error as Error);
      return [];
    }
  }

  /**
   * Format achievement for display
   */
  private formatAchievement(badgeType: string, earnedAt?: number): Achievement {
    const badge = AVAILABLE_BADGES[badgeType];
    return {
      badgeType,
      emoji: badge?.emoji || '🏅',
      name: badge?.name || badgeType,
      description: badge?.description || '',
      earnedAt
    };
  }

  /**
   * Get top achievers (users with most badges)
   */
  async getTopAchievers(groupId: string, limit: number = 10): Promise<any[]> {
    try {
      const results = database.query(
        `SELECT user_id, 
                (SELECT username FROM leaderboard_stats WHERE leaderboard_stats.user_id = user_achievements.user_id AND leaderboard_stats.group_id = user_achievements.group_id LIMIT 1) as username,
                COUNT(*) as badge_count,
                GROUP_CONCAT(badge_type, ',') as badges
         FROM user_achievements
         WHERE group_id = ?
         GROUP BY user_id
         ORDER BY badge_count DESC
         LIMIT ?`,
        [groupId, limit]
      );

      return results.map(r => ({
        userId: r.user_id,
        username: r.username,
        badgeCount: r.badge_count,
        badges: r.badges ? r.badges.split(',') : []
      }));
    } catch (error) {
      logger.error('Achievements', 'Failed to get top achievers', error as Error);
      return [];
    }
  }

  /**
   * Get achievement progress for a user
   */
  async getProgress(groupId: string, userId: string): Promise<Record<string, any>> {
    try {
      const stats = database.query(
        'SELECT * FROM leaderboard_stats WHERE group_id = ? AND user_id = ?',
        [groupId, userId]
      )[0];

      if (!stats) {
        return {};
      }

      return {
        legend: {
          current: stats.total_points,
          target: 1000,
          progress: Math.min((stats.total_points / 1000) * 100, 100),
          earned: stats.total_points >= 1000
        },
        diamond_caller: {
          current: stats.calls_10x,
          target: 5,
          progress: Math.min((stats.calls_10x / 5) * 100, 100),
          earned: stats.calls_10x >= 5
        },
        moonshot: {
          current: stats.calls_100x,
          target: 1,
          progress: Math.min(stats.calls_100x * 100, 100),
          earned: stats.calls_100x >= 1
        },
        consistent: {
          current: Math.round(stats.hit_rate),
          target: 70,
          calls: stats.total_calls,
          callsNeeded: Math.max(0, 20 - stats.total_calls),
          progress: (stats.total_calls >= 20 && stats.hit_rate >= 70) ? 100 : 0,
          earned: stats.total_calls >= 20 && stats.hit_rate >= 70
        },
        veteran: {
          current: stats.total_calls,
          target: 100,
          progress: Math.min((stats.total_calls / 100) * 100, 100),
          earned: stats.total_calls >= 100
        },
        guardian: {
          current: stats.calls_rug,
          target: 10,
          progress: Math.min((stats.calls_rug / 10) * 100, 100),
          earned: stats.calls_rug >= 10
        }
      };
    } catch (error) {
      logger.error('Achievements', 'Failed to get progress', error as Error);
      return {};
    }
  }
}

export const achievementService = new AchievementService();
