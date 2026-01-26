import { database } from '../database';
import { logger } from '../utils/logger';
import type { Message } from 'telegraf/types';

export type TopicMode = 'command_only' | 'normal' | 'read_only';

export interface TopicConfig {
  chatId: string;
  topicId: number;
  topicName: string;
  mode: TopicMode;
  allowedCommands?: string[]; // If specified, only these commands allowed
  createdAt: number;
  updatedAt: number;
}

class TopicManagerService {
  /**
   * Get topic configuration
   */
  async getTopicConfig(chatId: string, topicId: number): Promise<TopicConfig | null> {
    try {
      const db = database.getDb();
      if (!db) return null;

      const result = db.exec(`
        SELECT * FROM topic_configs
        WHERE chat_id = ? AND topic_id = ?
      `, [chatId, topicId]);

      if (result.length === 0 || result[0].values.length === 0) {
        return null;
      }

      const columns = result[0].columns;
      const values = result[0].values[0];
      const row: any = {};
      columns.forEach((col, i) => {
        row[col] = values[i];
      });

      return this.deserializeTopicConfig(row);
    } catch (error) {
      logger.error('TopicManager', 'Failed to get topic config', error as Error);
      return null;
    }
  }

  /**
   * Get all topics for a chat
   */
  async getChatTopics(chatId: string): Promise<TopicConfig[]> {
    try {
      const db = database.getDb();
      if (!db) return [];

      const result = db.exec(`
        SELECT * FROM topic_configs
        WHERE chat_id = ?
        ORDER BY topic_name
      `, [chatId]);

      if (result.length === 0) return [];

      const columns = result[0].columns;
      return result[0].values.map(values => {
        const row: any = {};
        columns.forEach((col, i) => {
          row[col] = values[i];
        });
        return this.deserializeTopicConfig(row);
      });
    } catch (error) {
      logger.error('TopicManager', 'Failed to get chat topics', error as Error);
      return [];
    }
  }

  /**
   * Set topic mode
   */
  async setTopicMode(
    chatId: string,
    topicId: number,
    mode: TopicMode,
    topicName: string
  ): Promise<void> {
    try {
      const db = database.getDb();
      if (!db) throw new Error('Database not available');

      const now = Math.floor(Date.now() / 1000);

      const existing = await this.getTopicConfig(chatId, topicId);

      if (existing) {
        // Update existing
        db.run(`
          UPDATE topic_configs
          SET mode = ?, topic_name = ?, updated_at = ?
          WHERE chat_id = ? AND topic_id = ?
        `, [mode, topicName, now, chatId, topicId]);
      } else {
        // Create new
        db.run(`
          INSERT INTO topic_configs (chat_id, topic_id, topic_name, mode, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [chatId, topicId, topicName, mode, now, now]);
      }

      logger.info('TopicManager', `Set topic ${topicName} (${topicId}) to ${mode} mode in chat ${chatId}`);
    } catch (error) {
      logger.error('TopicManager', 'Failed to set topic mode', error as Error);
      throw error;
    }
  }

  /**
   * Set allowed commands for a topic
   */
  async setAllowedCommands(
    chatId: string,
    topicId: number,
    commands: string[]
  ): Promise<void> {
    try {
      const db = database.getDb();
      if (!db) throw new Error('Database not available');

      const now = Math.floor(Date.now() / 1000);

      db.run(`
        UPDATE topic_configs
        SET allowed_commands = ?, updated_at = ?
        WHERE chat_id = ? AND topic_id = ?
      `, [JSON.stringify(commands), now, chatId, topicId]);

      logger.info('TopicManager', `Updated allowed commands for topic ${topicId} in chat ${chatId}`);
    } catch (error) {
      logger.error('TopicManager', 'Failed to set allowed commands', error as Error);
      throw error;
    }
  }

  /**
   * Apply a preset configuration to a topic
   */
  async applyPreset(
    chatId: string,
    topicId: number,
    topicName: string,
    preset: { mode: TopicMode; allowedCommands?: string[] }
  ): Promise<void> {
    try {
      const db = database.getDb();
      if (!db) throw new Error('Database not available');

      const now = Math.floor(Date.now() / 1000);

      const existing = await this.getTopicConfig(chatId, topicId);

      if (existing) {
        // Update existing
        db.run(`
          UPDATE topic_configs
          SET mode = ?, topic_name = ?, allowed_commands = ?, updated_at = ?
          WHERE chat_id = ? AND topic_id = ?
        `, [
          preset.mode,
          topicName,
          preset.allowedCommands ? JSON.stringify(preset.allowedCommands) : null,
          now,
          chatId,
          topicId
        ]);
      } else {
        // Create new
        db.run(`
          INSERT INTO topic_configs (chat_id, topic_id, topic_name, mode, allowed_commands, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          chatId,
          topicId,
          topicName,
          preset.mode,
          preset.allowedCommands ? JSON.stringify(preset.allowedCommands) : null,
          now,
          now
        ]);
      }

      logger.info('TopicManager', `Applied preset to topic ${topicName} (${topicId}) in chat ${chatId}`);
    } catch (error) {
      logger.error('TopicManager', 'Failed to apply preset', error as Error);
      throw error;
    }
  }

  /**
   * Delete topic configuration
   */
  async deleteTopicConfig(chatId: string, topicId: number): Promise<void> {
    try {
      const db = database.getDb();
      if (!db) throw new Error('Database not available');

      db.run(`
        DELETE FROM topic_configs
        WHERE chat_id = ? AND topic_id = ?
      `, [chatId, topicId]);

      logger.info('TopicManager', `Deleted topic config for topic ${topicId} in chat ${chatId}`);
    } catch (error) {
      logger.error('TopicManager', 'Failed to delete topic config', error as Error);
      throw error;
    }
  }

  /**
   * Check if topic is command-only
   */
  async isCommandOnlyTopic(chatId: string, topicId: number): Promise<boolean> {
    const config = await this.getTopicConfig(chatId, topicId);
    return config?.mode === 'command_only';
  }

  /**
   * Check if a message should be deleted based on topic rules
   */
  async shouldDeleteMessage(
    chatId: string,
    topicId: number,
    message: Message
  ): Promise<{ shouldDelete: boolean; reason?: string }> {
    const config = await this.getTopicConfig(chatId, topicId);

    // No config = normal mode, don't delete
    if (!config || config.mode === 'normal') {
      return { shouldDelete: false };
    }

    // Read-only mode: only bot can post
    if (config.mode === 'read_only') {
      // Check if message is from bot (we'll get bot info from context)
      // For now, assume we need to check this in middleware
      return {
        shouldDelete: true,
        reason: `read-only`,
      };
    }

    // Command-only mode
    if (config.mode === 'command_only') {
      const text = 'text' in message ? message.text : '';
      const isCommand = text?.startsWith('/');

      if (!isCommand) {
        return {
          shouldDelete: true,
          reason: `command-only`,
        };
      }

      // If allowedCommands is specified, check if command is allowed
      if (config.allowedCommands && config.allowedCommands.length > 0) {
        const command = text.split(' ')[0].substring(1).toLowerCase();
        if (!config.allowedCommands.includes(command)) {
          return {
            shouldDelete: true,
            reason: `command-not-allowed`,
          };
        }
      }
    }

    return { shouldDelete: false };
  }

  /**
   * Get topic routing info for alerts
   * Returns the topic ID where a specific alert type should be posted
   */
  async getTopicForAlertType(chatId: string, alertType: string): Promise<number | null> {
    try {
      const topics = await this.getChatTopics(chatId);

      // Map alert types to topic names
      const topicMapping: Record<string, string[]> = {
        token: ['token-scanner', 'token scanner', 'scanner'],
        smart_money: ['whale-tracker', 'whale tracker', 'whales'],
        signal: ['signals', 'trading signals'],
        watchlist: ['aped-tokens', 'aped tokens', 'watchlist'],
        leaderboard: ['leaderboard', 'rankings'],
      };

      const possibleNames = topicMapping[alertType] || [];

      // Find matching topic
      for (const topic of topics) {
        const nameLower = topic.topicName.toLowerCase();
        if (possibleNames.some(name => nameLower.includes(name))) {
          return topic.topicId;
        }
      }

      return null;
    } catch (error) {
      logger.error('TopicManager', 'Failed to get topic for alert type', error as Error);
      return null;
    }
  }

  // Serialization helpers
  private deserializeTopicConfig(row: any): TopicConfig {
    return {
      chatId: row.chat_id,
      topicId: row.topic_id,
      topicName: row.topic_name,
      mode: row.mode,
      allowedCommands: row.allowed_commands ? JSON.parse(row.allowed_commands) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const topicManager = new TopicManagerService();
