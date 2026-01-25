import { database } from '../database';
import { chatContextService } from './chatContext';
import { groupWatchlistService } from './groupWatchlist';
import { topicManager } from './topicManager';
import type { GroupSettings, UserSettings } from './chatContext';
import { logger } from '../utils/logger';

export type AlertType = 'token' | 'smart_money' | 'rug_warning' | 'signal' | 'volume_spike' | 'watchlist' | 'leaderboard';

export interface AlertMetadata {
  type: AlertType;
  tokenMint: string;
  symbol: string;
  riskScore: number;
  liquidityUsd: number;
  rugProbability?: number;
  isGroupWatched?: boolean;  // Tag if token is in group watchlist
}

export interface AlertTarget {
  chatId: string;
  chatType: 'private' | 'group' | 'supergroup';
  topicId?: number;  // Forum topic ID (if applicable)
}

class AlertRouterService {
  /**
   * Determine which chats should receive an alert
   * Returns array of chat IDs that passed all filters
   */
  async routeAlert(metadata: AlertMetadata): Promise<AlertTarget[]> {
    const targets: AlertTarget[] = [];

    try {
      // Get all configured groups
      const groups = await this.getAllGroups();
      
      // Check each group
      for (const group of groups) {
        // Check if token is in group watchlist
        const isWatched = await groupWatchlistService.isWatchedByGroup(group.chatId, metadata.tokenMint);
        
        // Tag the metadata
        if (isWatched) {
          metadata.isGroupWatched = true;
        }

        if (await this.shouldSendToGroup(group, metadata, isWatched)) {
          // Check if group has forum topics and route to appropriate topic
          const topicId = await topicManager.getTopicForAlertType(group.chatId, metadata.type);
          
          targets.push({
            chatId: group.chatId,
            chatType: group.chatType === 'supergroup' ? 'supergroup' : 'group',
            topicId: topicId || undefined,
          });

          // Record alert for watchlist token
          if (isWatched) {
            await groupWatchlistService.recordGroupAlert(group.chatId, metadata.tokenMint);
          }
        }
      }

      // Get all users with DM alerts enabled
      const users = await this.getAllUsersWithAlerts();
      
      // Check each user
      for (const user of users) {
        if (await this.shouldSendToUser(user, metadata)) {
          targets.push({
            chatId: user.userId.toString(),
            chatType: 'private',
          });
        }
      }

      logger.debug('AlertRouter', `Routed ${metadata.type} alert for ${metadata.symbol} to ${targets.length} chats`);
      
    } catch (error) {
      logger.error('AlertRouter', 'Failed to route alert', error as Error);
    }

    return targets;
  }

  /**
   * Check if alert should be sent to a specific group
   */
  private async shouldSendToGroup(
    group: GroupSettings,
    metadata: AlertMetadata,
    isWatched: boolean = false
  ): Promise<boolean> {
    // Priority boost for group-watched tokens
    // Watched tokens skip some quality filters
    if (isWatched) {
      // Still check if alert type is enabled
      if (!this.isAlertTypeEnabled(group, metadata.type, 'group')) {
        return false;
      }

      // Skip quality thresholds for watched tokens (group wants to see them)
      
      // Still check for duplicates
      if (await this.isDuplicate(group.chatId, metadata.tokenMint, metadata.type)) {
        return false;
      }

      // Watched tokens bypass throttling
      return true;
    }

    // Normal flow for non-watched tokens
    // Check if alert type is enabled
    if (!this.isAlertTypeEnabled(group, metadata.type, 'group')) {
      return false;
    }

    // Check quality thresholds
    if (metadata.riskScore < group.minRiskScore) {
      return false;
    }

    if (metadata.liquidityUsd < group.minLiquidityUsd) {
      return false;
    }

    // Check throttling (max alerts per hour)
    if (await this.isThrottled(group.chatId, metadata)) {
      return false;
    }

    // Check if this specific token was recently alerted
    if (await this.isDuplicate(group.chatId, metadata.tokenMint, metadata.type)) {
      return false;
    }

    return true;
  }

  /**
   * Check if alert should be sent to a specific user (DM)
   */
  private async shouldSendToUser(user: UserSettings, metadata: AlertMetadata): Promise<boolean> {
    // Check if alert type is enabled
    if (!this.isAlertTypeEnabled(user, metadata.type, 'user')) {
      return false;
    }

    // Check quality thresholds (more permissive than groups)
    if (metadata.riskScore < user.minRiskScore) {
      return false;
    }

    if (metadata.liquidityUsd < user.minLiquidityUsd) {
      return false;
    }

    // Watchlist alerts are special - always send if user has watchlist enabled
    if (metadata.type === 'watchlist' && user.enableWatchlistAlerts) {
      return true;
    }

    return true;
  }

  /**
   * Check if an alert type is enabled for a chat
   */
  private isAlertTypeEnabled(
    settings: GroupSettings | UserSettings,
    alertType: AlertType,
    settingsType: 'group' | 'user'
  ): boolean {
    switch (alertType) {
      case 'token':
        return settings.enableTokenAlerts;
      case 'smart_money':
        return settings.enableSmartMoneyAlerts;
      case 'rug_warning':
        return settings.enableRugWarnings;
      case 'signal':
        return settings.enableSignals;
      case 'volume_spike':
        return settings.enableVolumeSpikes;
      case 'watchlist':
        // Watchlist only for users (DM)
        return settingsType === 'user' && (settings as UserSettings).enableWatchlistAlerts;
      default:
        return false;
    }
  }

  /**
   * Check if group has hit rate limit for alerts
   */
  private async isThrottled(chatId: string, metadata: AlertMetadata): Promise<boolean> {
    try {
      const settings = await chatContextService.getGroupSettings(chatId);
      if (!settings) return false;

      const db = database.getDb();
      const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;

      // Count alerts in last hour
      const result = db.prepare(`
        SELECT COUNT(*) as count
        FROM group_alert_throttle
        WHERE chat_id = ? AND sent_at > ?
      `).get(chatId, oneHourAgo) as { count: number };

      const isThrottled = result.count >= settings.maxAlertsPerHour;
      
      if (isThrottled) {
        logger.debug('AlertRouter', `Group ${chatId} throttled (${result.count}/${settings.maxAlertsPerHour} alerts/hour)`);
      }

      return isThrottled;
    } catch (error) {
      logger.error('AlertRouter', 'Failed to check throttle', error as Error);
      return false;
    }
  }

  /**
   * Check if this exact token+type was recently alerted to this chat
   */
  private async isDuplicate(chatId: string, tokenMint: string, alertType: AlertType): Promise<boolean> {
    try {
      const db = database.getDb();
      const fourHoursAgo = Math.floor(Date.now() / 1000) - (4 * 3600);

      const result = db.prepare(`
        SELECT COUNT(*) as count
        FROM group_alert_throttle
        WHERE chat_id = ? AND token_mint = ? AND alert_type = ? AND sent_at > ?
      `).get(chatId, tokenMint, alertType, fourHoursAgo) as { count: number };

      return result.count > 0;
    } catch (error) {
      logger.error('AlertRouter', 'Failed to check duplicate', error as Error);
      return false;
    }
  }

  /**
   * Record that an alert was sent (for throttling/deduplication)
   */
  async recordAlert(chatId: string, metadata: AlertMetadata): Promise<void> {
    try {
      const db = database.getDb();
      const now = Math.floor(Date.now() / 1000);

      db.prepare(`
        INSERT OR REPLACE INTO group_alert_throttle (chat_id, token_mint, alert_type, sent_at)
        VALUES (?, ?, ?, ?)
      `).run(chatId, metadata.tokenMint, metadata.type, now);

      // Clean up old entries (older than 24h)
      const twentyFourHoursAgo = now - (24 * 3600);
      db.prepare(`
        DELETE FROM group_alert_throttle WHERE sent_at < ?
      `).run(twentyFourHoursAgo);

    } catch (error) {
      logger.error('AlertRouter', 'Failed to record alert', error as Error);
    }
  }

  /**
   * Get all configured groups
   */
  private async getAllGroups(): Promise<GroupSettings[]> {
    try {
      const db = database.getDb();
      const rows = db.prepare(`
        SELECT * FROM group_settings
      `).all();

      return rows.map((row: any) => this.deserializeGroupSettings(row));
    } catch (error) {
      logger.error('AlertRouter', 'Failed to get groups', error as Error);
      return [];
    }
  }

  /**
   * Get all users with at least one alert type enabled
   */
  private async getAllUsersWithAlerts(): Promise<UserSettings[]> {
    try {
      const db = database.getDb();
      const rows = db.prepare(`
        SELECT * FROM user_settings
        WHERE enable_token_alerts = 1
           OR enable_smart_money_alerts = 1
           OR enable_rug_warnings = 1
           OR enable_signals = 1
           OR enable_volume_spikes = 1
           OR enable_watchlist_alerts = 1
      `).all();

      return rows.map((row: any) => this.deserializeUserSettings(row));
    } catch (error) {
      logger.error('AlertRouter', 'Failed to get users', error as Error);
      return [];
    }
  }

  // Serialization helpers (same as chatContextService)
  private deserializeGroupSettings(row: any): GroupSettings {
    return {
      chatId: row.chat_id,
      chatType: row.chat_type,
      chatTitle: row.chat_title,
      enableTokenAlerts: Boolean(row.enable_token_alerts),
      enableSmartMoneyAlerts: Boolean(row.enable_smart_money_alerts),
      enableRugWarnings: Boolean(row.enable_rug_warnings),
      enableSignals: Boolean(row.enable_signals),
      enableVolumeSpikes: Boolean(row.enable_volume_spikes),
      minRiskScore: row.min_risk_score,
      minLiquidityUsd: row.min_liquidity_usd,
      maxAlertsPerHour: row.max_alerts_per_hour,
      enableGroupWatchlist: Boolean(row.enable_group_watchlist),
      enableLeaderboard: Boolean(row.enable_leaderboard),
      enableMorningBriefing: Boolean(row.enable_morning_briefing),
      adminUserIds: JSON.parse(row.admin_user_ids || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private deserializeUserSettings(row: any): UserSettings {
    return {
      userId: row.user_id,
      username: row.username,
      enableTokenAlerts: Boolean(row.enable_token_alerts),
      enableSmartMoneyAlerts: Boolean(row.enable_smart_money_alerts),
      enableRugWarnings: Boolean(row.enable_rug_warnings),
      enableSignals: Boolean(row.enable_signals),
      enableVolumeSpikes: Boolean(row.enable_volume_spikes),
      enableWatchlistAlerts: Boolean(row.enable_watchlist_alerts),
      minRiskScore: row.min_risk_score,
      minLiquidityUsd: row.min_liquidity_usd,
      participateInLeaderboard: Boolean(row.participate_in_leaderboard),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const alertRouter = new AlertRouterService();
