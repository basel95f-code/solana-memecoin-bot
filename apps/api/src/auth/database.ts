/**
 * Database service for API keys and usage tracking
 * Integrates with the bot's existing Supabase database
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { APIKey, APIKeyUsage } from '../types/index.js';
import { logger } from '../utils/logger.js';

class APIKeyDatabase {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Initialize API key tables
   */
  async initialize(): Promise<void> {
    try {
      // Create API keys table if not exists
      const { error: keysError } = await this.supabase.rpc('create_api_keys_table', {});
      if (keysError && !keysError.message.includes('already exists')) {
        logger.warn('Could not create api_keys table:', keysError);
      }

      // Create usage tracking table if not exists
      const { error: usageError } = await this.supabase.rpc('create_api_usage_table', {});
      if (usageError && !usageError.message.includes('already exists')) {
        logger.warn('Could not create api_usage table:', usageError);
      }

      logger.info('API key database initialized');
    } catch (error) {
      logger.error('Failed to initialize API key database:', error);
      throw error;
    }
  }

  /**
   * Create a new API key
   */
  async createAPIKey(data: {
    key: string; // Already hashed
    name: string;
    userId?: string;
    rateLimit?: number;
    expiresAt?: Date;
  }): Promise<APIKey> {
    const { data: result, error } = await this.supabase
      .from('api_keys')
      .insert({
        key: data.key,
        name: data.name,
        user_id: data.userId,
        rate_limit: data.rateLimit || 60,
        is_active: true,
        expires_at: data.expiresAt?.toISOString()
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create API key:', error);
      throw error;
    }

    return this.mapToAPIKey(result);
  }

  /**
   * Get API key by hashed value
   */
  async getAPIKey(hashedKey: string): Promise<APIKey | null> {
    const { data, error } = await this.supabase
      .from('api_keys')
      .select('*')
      .eq('key', hashedKey)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // Not found
        return null;
      }
      logger.error('Failed to get API key:', error);
      throw error;
    }

    if (!data) return null;

    // Check expiration
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return null;
    }

    return this.mapToAPIKey(data);
  }

  /**
   * Update API key last used timestamp
   */
  async updateLastUsed(keyId: string): Promise<void> {
    const { error } = await this.supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyId);

    if (error) {
      logger.error('Failed to update last used:', error);
    }
  }

  /**
   * Track API usage
   */
  async trackUsage(keyId: string): Promise<void> {
    const now = new Date();
    const currentMinute = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());

    const { error } = await this.supabase
      .rpc('increment_api_usage', {
        p_key_id: keyId,
        p_timestamp: currentMinute.toISOString()
      });

    if (error) {
      logger.error('Failed to track usage:', error);
    }
  }

  /**
   * Get usage count for current minute
   */
  async getUsageCount(keyId: string): Promise<number> {
    const now = new Date();
    const currentMinute = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());

    const { data, error } = await this.supabase
      .from('api_usage')
      .select('request_count')
      .eq('key_id', keyId)
      .eq('timestamp', currentMinute.toISOString())
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // Not found
        return 0;
      }
      logger.error('Failed to get usage count:', error);
      return 0;
    }

    return data?.request_count || 0;
  }

  /**
   * List all API keys
   */
  async listAPIKeys(userId?: string): Promise<APIKey[]> {
    let query = this.supabase.from('api_keys').select('*');

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to list API keys:', error);
      throw error;
    }

    return (data || []).map(this.mapToAPIKey);
  }

  /**
   * Revoke (deactivate) an API key
   */
  async revokeAPIKey(keyId: string): Promise<void> {
    const { error } = await this.supabase
      .from('api_keys')
      .update({ is_active: false })
      .eq('id', keyId);

    if (error) {
      logger.error('Failed to revoke API key:', error);
      throw error;
    }
  }

  /**
   * Map database row to APIKey type
   */
  private mapToAPIKey(row: any): APIKey {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      userId: row.user_id,
      rateLimit: row.rate_limit,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined
    };
  }
}

export const apiKeyDB = new APIKeyDatabase();
