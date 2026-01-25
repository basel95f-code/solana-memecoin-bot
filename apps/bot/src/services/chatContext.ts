import { Context } from 'telegraf';
import { database } from '../database';
import { logger } from '../utils/logger';

export type ChatType = 'private' | 'group' | 'supergroup' | 'channel';

export interface ChatContext {
  chatId: string;
  chatType: ChatType;
  userId: number;
  username?: string;
  isGroup: boolean;
}

export interface GroupSettings {
  chatId: string;
  chatType: ChatType;
  chatTitle?: string;
  
  // Alert Preferences (Opt-in)
  enableTokenAlerts: boolean;
  enableSmartMoneyAlerts: boolean;
  enableRugWarnings: boolean;
  enableSignals: boolean;
  enableVolumeSpikes: boolean;
  
  // Quality Thresholds (Anti-spam)
  minRiskScore: number;        // Default: 80 (only LOW risk tokens)
  minLiquidityUsd: number;     // Default: 50000 ($50k)
  maxAlertsPerHour: number;    // Default: 5
  
  // Features
  enableGroupWatchlist: boolean;
  enableLeaderboard: boolean;
  enableMorningBriefing: boolean;
  
  // Admin
  adminUserIds: number[];
  createdAt: number;
  updatedAt: number;
}

export interface UserSettings {
  userId: number;
  username?: string;
  
  // DM Alert Preferences
  enableTokenAlerts: boolean;
  enableSmartMoneyAlerts: boolean;
  enableRugWarnings: boolean;
  enableSignals: boolean;
  enableVolumeSpikes: boolean;
  enableWatchlistAlerts: boolean;
  
  // DM Quality Thresholds (More permissive than group)
  minRiskScore: number;        // Default: 60
  minLiquidityUsd: number;     // Default: 10000 ($10k)
  
  // Group Participation (Opt-in/out)
  participateInLeaderboard: boolean;
  
  createdAt: number;
  updatedAt: number;
}

// Default settings
const DEFAULT_GROUP_SETTINGS: Omit<GroupSettings, 'chatId' | 'chatType' | 'chatTitle' | 'adminUserIds' | 'createdAt' | 'updatedAt'> = {
  enableTokenAlerts: true,
  enableSmartMoneyAlerts: true,
  enableRugWarnings: true,
  enableSignals: true,
  enableVolumeSpikes: false,  // Off by default (can be noisy)
  
  minRiskScore: 80,           // Only LOW risk (high quality)
  minLiquidityUsd: 50000,     // $50k minimum
  maxAlertsPerHour: 5,        // Max 5 alerts/hour
  
  enableGroupWatchlist: true,
  enableLeaderboard: false,   // Opt-in
  enableMorningBriefing: true,
};

const DEFAULT_USER_SETTINGS: Omit<UserSettings, 'userId' | 'username' | 'createdAt' | 'updatedAt'> = {
  enableTokenAlerts: true,
  enableSmartMoneyAlerts: true,
  enableRugWarnings: true,
  enableSignals: true,
  enableVolumeSpikes: true,   // More permissive in DM
  enableWatchlistAlerts: true,
  
  minRiskScore: 60,           // MEDIUM risk acceptable
  minLiquidityUsd: 10000,     // $10k minimum
  
  participateInLeaderboard: false,  // Opt-in
};

class ChatContextService {
  /**
   * Extract chat context from Telegram update
   */
  getChatContext(ctx: Context): ChatContext | null {
    if (!ctx.chat || !ctx.from) {
      return null;
    }

    const chatType = ctx.chat.type as ChatType;
    const isGroup = chatType === 'group' || chatType === 'supergroup';

    return {
      chatId: ctx.chat.id.toString(),
      chatType,
      userId: ctx.from.id,
      username: ctx.from.username,
      isGroup,
    };
  }

  /**
   * Get or create group settings
   */
  async getGroupSettings(chatId: string): Promise<GroupSettings | null> {
    try {
      const db = database.getDb();
      const row = db.prepare(`
        SELECT * FROM group_settings WHERE chat_id = ?
      `).get(chatId);

      if (row) {
        return this.deserializeGroupSettings(row);
      }

      return null;
    } catch (error) {
      logger.error('ChatContext', 'Failed to get group settings', error as Error);
      return null;
    }
  }

  /**
   * Create group settings (when bot is added to group)
   */
  async createGroupSettings(
    chatId: string,
    chatType: ChatType,
    chatTitle: string | undefined,
    adminUserId: number
  ): Promise<GroupSettings> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const settings: GroupSettings = {
        chatId,
        chatType,
        chatTitle,
        ...DEFAULT_GROUP_SETTINGS,
        adminUserIds: [adminUserId],
        createdAt: now,
        updatedAt: now,
      };

      const db = database.getDb();
      db.prepare(`
        INSERT INTO group_settings (
          chat_id, chat_type, chat_title,
          enable_token_alerts, enable_smart_money_alerts, enable_rug_warnings,
          enable_signals, enable_volume_spikes,
          min_risk_score, min_liquidity_usd, max_alerts_per_hour,
          enable_group_watchlist, enable_leaderboard, enable_morning_briefing,
          admin_user_ids, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        chatId,
        chatType,
        chatTitle,
        settings.enableTokenAlerts ? 1 : 0,
        settings.enableSmartMoneyAlerts ? 1 : 0,
        settings.enableRugWarnings ? 1 : 0,
        settings.enableSignals ? 1 : 0,
        settings.enableVolumeSpikes ? 1 : 0,
        settings.minRiskScore,
        settings.minLiquidityUsd,
        settings.maxAlertsPerHour,
        settings.enableGroupWatchlist ? 1 : 0,
        settings.enableLeaderboard ? 1 : 0,
        settings.enableMorningBriefing ? 1 : 0,
        JSON.stringify(settings.adminUserIds),
        now,
        now
      );

      logger.info('ChatContext', `Created group settings for ${chatTitle || chatId}`);
      return settings;
    } catch (error) {
      logger.error('ChatContext', 'Failed to create group settings', error as Error);
      throw error;
    }
  }

  /**
   * Update group settings
   */
  async updateGroupSettings(chatId: string, updates: Partial<GroupSettings>): Promise<void> {
    try {
      const current = await this.getGroupSettings(chatId);
      if (!current) {
        throw new Error('Group settings not found');
      }

      const updated = { ...current, ...updates, updatedAt: Math.floor(Date.now() / 1000) };

      const db = database.getDb();
      db.prepare(`
        UPDATE group_settings SET
          enable_token_alerts = ?,
          enable_smart_money_alerts = ?,
          enable_rug_warnings = ?,
          enable_signals = ?,
          enable_volume_spikes = ?,
          min_risk_score = ?,
          min_liquidity_usd = ?,
          max_alerts_per_hour = ?,
          enable_group_watchlist = ?,
          enable_leaderboard = ?,
          enable_morning_briefing = ?,
          admin_user_ids = ?,
          updated_at = ?
        WHERE chat_id = ?
      `).run(
        updated.enableTokenAlerts ? 1 : 0,
        updated.enableSmartMoneyAlerts ? 1 : 0,
        updated.enableRugWarnings ? 1 : 0,
        updated.enableSignals ? 1 : 0,
        updated.enableVolumeSpikes ? 1 : 0,
        updated.minRiskScore,
        updated.minLiquidityUsd,
        updated.maxAlertsPerHour,
        updated.enableGroupWatchlist ? 1 : 0,
        updated.enableLeaderboard ? 1 : 0,
        updated.enableMorningBriefing ? 1 : 0,
        JSON.stringify(updated.adminUserIds),
        updated.updatedAt,
        chatId
      );

      logger.info('ChatContext', `Updated group settings for ${chatId}`);
    } catch (error) {
      logger.error('ChatContext', 'Failed to update group settings', error as Error);
      throw error;
    }
  }

  /**
   * Get or create user settings
   */
  async getUserSettings(userId: number): Promise<UserSettings> {
    try {
      const db = database.getDb();
      const row = db.prepare(`
        SELECT * FROM user_settings WHERE user_id = ?
      `).get(userId);

      if (row) {
        return this.deserializeUserSettings(row);
      }

      // Create default settings
      return await this.createUserSettings(userId);
    } catch (error) {
      logger.error('ChatContext', 'Failed to get user settings', error as Error);
      throw error;
    }
  }

  /**
   * Create user settings
   */
  private async createUserSettings(userId: number, username?: string): Promise<UserSettings> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const settings: UserSettings = {
        userId,
        username,
        ...DEFAULT_USER_SETTINGS,
        createdAt: now,
        updatedAt: now,
      };

      const db = database.getDb();
      db.prepare(`
        INSERT INTO user_settings (
          user_id, username,
          enable_token_alerts, enable_smart_money_alerts, enable_rug_warnings,
          enable_signals, enable_volume_spikes, enable_watchlist_alerts,
          min_risk_score, min_liquidity_usd,
          participate_in_leaderboard,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        username,
        settings.enableTokenAlerts ? 1 : 0,
        settings.enableSmartMoneyAlerts ? 1 : 0,
        settings.enableRugWarnings ? 1 : 0,
        settings.enableSignals ? 1 : 0,
        settings.enableVolumeSpikes ? 1 : 0,
        settings.enableWatchlistAlerts ? 1 : 0,
        settings.minRiskScore,
        settings.minLiquidityUsd,
        settings.participateInLeaderboard ? 1 : 0,
        now,
        now
      );

      logger.info('ChatContext', `Created user settings for ${userId}`);
      return settings;
    } catch (error) {
      logger.error('ChatContext', 'Failed to create user settings', error as Error);
      throw error;
    }
  }

  /**
   * Update user settings
   */
  async updateUserSettings(userId: number, updates: Partial<UserSettings>): Promise<void> {
    try {
      const current = await this.getUserSettings(userId);
      const updated = { ...current, ...updates, updatedAt: Math.floor(Date.now() / 1000) };

      const db = database.getDb();
      db.prepare(`
        UPDATE user_settings SET
          username = ?,
          enable_token_alerts = ?,
          enable_smart_money_alerts = ?,
          enable_rug_warnings = ?,
          enable_signals = ?,
          enable_volume_spikes = ?,
          enable_watchlist_alerts = ?,
          min_risk_score = ?,
          min_liquidity_usd = ?,
          participate_in_leaderboard = ?,
          updated_at = ?
        WHERE user_id = ?
      `).run(
        updated.username,
        updated.enableTokenAlerts ? 1 : 0,
        updated.enableSmartMoneyAlerts ? 1 : 0,
        updated.enableRugWarnings ? 1 : 0,
        updated.enableSignals ? 1 : 0,
        updated.enableVolumeSpikes ? 1 : 0,
        updated.enableWatchlistAlerts ? 1 : 0,
        updated.minRiskScore,
        updated.minLiquidityUsd,
        updated.participateInLeaderboard ? 1 : 0,
        updated.updatedAt,
        userId
      );

      logger.info('ChatContext', `Updated user settings for ${userId}`);
    } catch (error) {
      logger.error('ChatContext', 'Failed to update user settings', error as Error);
      throw error;
    }
  }

  /**
   * Check if user is admin in a group
   */
  async isGroupAdmin(chatId: string, userId: number): Promise<boolean> {
    const settings = await this.getGroupSettings(chatId);
    return settings?.adminUserIds.includes(userId) || false;
  }

  /**
   * Add admin to group
   */
  async addGroupAdmin(chatId: string, userId: number): Promise<void> {
    const settings = await this.getGroupSettings(chatId);
    if (!settings) {
      throw new Error('Group settings not found');
    }

    if (!settings.adminUserIds.includes(userId)) {
      settings.adminUserIds.push(userId);
      await this.updateGroupSettings(chatId, { adminUserIds: settings.adminUserIds });
    }
  }

  // Serialization helpers
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

export const chatContextService = new ChatContextService();
