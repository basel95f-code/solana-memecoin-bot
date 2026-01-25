/**
 * Database schema for Alert Rule Engine
 * Adds tables for rules, delivery tracking, and user channel preferences
 */

export const ALERT_RULES_SCHEMA = `
-- ============================================
-- Alert Rules
-- Stores user-defined alert rules with conditions
-- ============================================
CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER DEFAULT 1,
  
  -- Rule definition (JSON)
  root_condition TEXT NOT NULL, -- JSON-serialized Condition
  
  -- Priority and channels
  priority TEXT DEFAULT 'normal', -- low, normal, high, critical
  channels TEXT NOT NULL, -- JSON array of channel IDs
  message TEXT, -- Custom message template
  
  -- Rate limiting
  cooldown_seconds INTEGER DEFAULT 300, -- 5 minutes
  max_alerts_per_hour INTEGER DEFAULT 10,
  
  -- Tracking
  created_by TEXT NOT NULL, -- user ID
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  last_triggered_at INTEGER,
  trigger_count INTEGER DEFAULT 0,
  
  -- Metadata
  tags TEXT, -- JSON array
  metadata TEXT -- JSON object
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_user ON alert_rules(created_by);
CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_alert_rules_priority ON alert_rules(priority);

-- ============================================
-- Alert Delivery Log
-- Tracks delivery status per channel
-- ============================================
CREATE TABLE IF NOT EXISTS alert_delivery_log (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL,
  rule_id TEXT,
  channel_id TEXT NOT NULL,
  channel_type TEXT NOT NULL, -- telegram, discord, email, websocket
  
  -- Delivery status
  status TEXT NOT NULL, -- pending, sending, sent, failed, retrying, cancelled
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  
  -- Timestamps
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  delivered_at INTEGER,
  next_retry_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_delivery_log_alert ON alert_delivery_log(alert_id);
CREATE INDEX IF NOT EXISTS idx_delivery_log_rule ON alert_delivery_log(rule_id);
CREATE INDEX IF NOT EXISTS idx_delivery_log_channel ON alert_delivery_log(channel_id);
CREATE INDEX IF NOT EXISTS idx_delivery_log_status ON alert_delivery_log(status);
CREATE INDEX IF NOT EXISTS idx_delivery_log_retry ON alert_delivery_log(next_retry_at);

-- ============================================
-- User Channel Preferences
-- User-specific channel configurations
-- ============================================
CREATE TABLE IF NOT EXISTS user_channel_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel_type TEXT NOT NULL, -- telegram, discord, email, websocket
  enabled INTEGER DEFAULT 1,
  
  -- Channel-specific config (JSON)
  config TEXT NOT NULL, -- JSON object with channel-specific settings
  
  -- Routing rules (JSON)
  routing_rules TEXT, -- JSON array of routing rules
  
  -- Rate limiting
  max_per_minute INTEGER DEFAULT 5,
  max_per_hour INTEGER DEFAULT 30,
  
  -- Timestamps
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_user_channels_user ON user_channel_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_channels_type ON user_channel_preferences(channel_type);
CREATE INDEX IF NOT EXISTS idx_user_channels_enabled ON user_channel_preferences(enabled);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_channel_unique ON user_channel_preferences(user_id, channel_type);

-- ============================================
-- Alert Deduplication Cache
-- Temporary storage for deduplication (cleaned periodically)
-- ============================================
CREATE TABLE IF NOT EXISTS alert_dedup_cache (
  dedup_key TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL,
  rule_id TEXT,
  token_mint TEXT,
  
  -- Dedup metadata
  dedup_hash TEXT,
  similarity_score REAL,
  
  -- Timestamps
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dedup_expires ON alert_dedup_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_dedup_token ON alert_dedup_cache(token_mint);

-- ============================================
-- Alert Batch Tracking
-- Tracks batched alerts
-- ============================================
CREATE TABLE IF NOT EXISTS alert_batches (
  id TEXT PRIMARY KEY,
  batch_type TEXT NOT NULL, -- alert type
  priority TEXT NOT NULL,
  summary TEXT NOT NULL,
  alert_count INTEGER NOT NULL,
  
  -- Alert IDs in batch (JSON array)
  alert_ids TEXT NOT NULL,
  
  -- Timestamps
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_batches_type ON alert_batches(batch_type);
CREATE INDEX IF NOT EXISTS idx_batches_created ON alert_batches(created_at);
`;

/**
 * Apply alert rules schema migration
 */
export function applyAlertRulesSchema(db: any): void {
  try {
    db.exec(ALERT_RULES_SCHEMA);
    console.log('✓ Alert rules schema applied successfully');
  } catch (error) {
    console.error('✗ Failed to apply alert rules schema:', error);
    throw error;
  }
}

/**
 * Clean up expired deduplication cache entries
 */
export function cleanupDedupCache(db: any): number {
  try {
    const now = Math.floor(Date.now() / 1000);
    const result = db.prepare(`
      DELETE FROM alert_dedup_cache
      WHERE expires_at < ?
    `).run(now);
    
    return result.changes || 0;
  } catch (error) {
    console.error('Failed to cleanup dedup cache:', error);
    return 0;
  }
}

/**
 * Clean up old delivery logs (older than 7 days)
 */
export function cleanupOldDeliveryLogs(db: any, daysToKeep: number = 7): number {
  try {
    const cutoff = Math.floor(Date.now() / 1000) - (daysToKeep * 24 * 60 * 60);
    const result = db.prepare(`
      DELETE FROM alert_delivery_log
      WHERE created_at < ? AND status IN ('sent', 'failed', 'cancelled')
    `).run(cutoff);
    
    return result.changes || 0;
  } catch (error) {
    console.error('Failed to cleanup delivery logs:', error);
    return 0;
  }
}
