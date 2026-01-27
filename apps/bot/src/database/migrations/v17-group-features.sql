-- v17: Group Features - Leaderboard System
-- Created: 2026-01-27
-- Purpose: Track group calls and leaderboard stats

-- ============================================
-- GROUP CALLS TABLE
-- ============================================
-- Tracks individual token calls made by users in groups
CREATE TABLE IF NOT EXISTS group_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Group and User Info
  group_id TEXT NOT NULL,              -- Telegram group ID
  user_id TEXT NOT NULL,               -- Telegram user ID
  username TEXT,                       -- Telegram username (optional)
  
  -- Token Info
  token_mint TEXT NOT NULL,            -- Solana mint address
  symbol TEXT,                         -- Token symbol (e.g., BONK)
  
  -- Entry Data
  entry_price REAL NOT NULL,           -- Price when called
  entry_mcap REAL,                     -- Market cap when called
  called_at INTEGER NOT NULL,          -- Unix timestamp
  
  -- Performance Tracking
  ath_price REAL,                      -- All-time high price reached
  ath_mcap REAL,                       -- ATH market cap
  ath_timestamp INTEGER,               -- When ATH was reached
  current_price REAL,                  -- Last known current price
  current_return REAL,                 -- Current ROI (multiplier)
  
  -- Scoring
  points INTEGER DEFAULT 0,            -- Points earned for this call
  is_rug BOOLEAN DEFAULT 0,            -- Flagged as rug
  
  -- Metadata
  notes TEXT,                          -- Optional user notes
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  
  -- Indexes for fast lookups
  FOREIGN KEY (group_id, user_id) REFERENCES leaderboard_stats(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_calls_group ON group_calls(group_id);
CREATE INDEX IF NOT EXISTS idx_group_calls_user ON group_calls(group_id, user_id);
CREATE INDEX IF NOT EXISTS idx_group_calls_token ON group_calls(token_mint);
CREATE INDEX IF NOT EXISTS idx_group_calls_time ON group_calls(called_at DESC);

-- ============================================
-- LEADERBOARD STATS TABLE
-- ============================================
-- Aggregated stats per user per group
CREATE TABLE IF NOT EXISTS leaderboard_stats (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT,
  
  -- Call Statistics
  total_calls INTEGER DEFAULT 0,       -- Total calls made
  total_points INTEGER DEFAULT 0,      -- Total points earned
  
  -- Performance Metrics
  hit_rate REAL DEFAULT 0,             -- % of profitable calls
  avg_return REAL DEFAULT 0,           -- Average ROI across all calls
  median_return REAL DEFAULT 0,        -- Median ROI
  
  -- Best Performance
  best_call TEXT,                      -- Mint of best performing call
  best_return REAL DEFAULT 0,          -- Best ROI achieved
  
  -- Breakdown
  calls_2x INTEGER DEFAULT 0,          -- Calls that hit 2x
  calls_5x INTEGER DEFAULT 0,          -- Calls that hit 5x
  calls_10x INTEGER DEFAULT 0,         -- Calls that hit 10x
  calls_50x INTEGER DEFAULT 0,         -- Calls that hit 50x
  calls_100x INTEGER DEFAULT 0,        -- Calls that hit 100x
  calls_rug INTEGER DEFAULT 0,         -- Calls that rugged
  
  -- Timestamps
  first_call_at INTEGER,               -- First call timestamp
  last_call_at INTEGER,                -- Most recent call
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_group ON leaderboard_stats(group_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_points ON leaderboard_stats(group_id, total_points DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_hit_rate ON leaderboard_stats(group_id, hit_rate DESC);

-- ============================================
-- GROUP SETTINGS TABLE
-- ============================================
-- Configuration per group
CREATE TABLE IF NOT EXISTS group_settings (
  group_id TEXT PRIMARY KEY,
  
  -- Feature Toggles
  leaderboard_enabled BOOLEAN DEFAULT 1,
  auto_track_enabled BOOLEAN DEFAULT 1,    -- Auto-detect contract addresses
  min_mcap_filter REAL DEFAULT 0,          -- Minimum mcap to track
  
  -- Display Settings
  leaderboard_title TEXT DEFAULT 'Leaderboard', -- Custom title
  show_usernames BOOLEAN DEFAULT 1,        -- Show/hide usernames
  default_timeframe TEXT DEFAULT '7d',     -- Default timeframe for /lb
  
  -- Point Multipliers (for custom scoring)
  multiplier_2x REAL DEFAULT 2,
  multiplier_5x REAL DEFAULT 5,
  multiplier_10x REAL DEFAULT 10,
  multiplier_50x REAL DEFAULT 20,
  multiplier_100x REAL DEFAULT 30,
  penalty_rug REAL DEFAULT -5,
  penalty_loss REAL DEFAULT -2,
  
  -- Metadata
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- ============================================
-- VIEWS FOR CONVENIENCE
-- ============================================

-- View: Active calls with current performance
CREATE VIEW IF NOT EXISTS v_active_calls AS
SELECT 
  c.id,
  c.group_id,
  c.user_id,
  c.username,
  c.symbol,
  c.token_mint,
  c.entry_price,
  c.current_price,
  c.current_return,
  c.points,
  c.called_at,
  ROUND((julianday('now') - julianday(c.called_at, 'unixepoch')) * 24, 1) as hours_ago,
  CASE 
    WHEN c.current_return >= 100 THEN '💎 100x+'
    WHEN c.current_return >= 50 THEN '🚀 50x+'
    WHEN c.current_return >= 10 THEN '🔥 10x+'
    WHEN c.current_return >= 5 THEN '📈 5x+'
    WHEN c.current_return >= 2 THEN '✅ 2x+'
    WHEN c.is_rug THEN '🚨 RUG'
    ELSE '📊 Active'
  END as status
FROM group_calls c
WHERE c.is_rug = 0
ORDER BY c.called_at DESC;

-- View: Leaderboard with rankings
CREATE VIEW IF NOT EXISTS v_leaderboard_ranked AS
SELECT 
  ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY total_points DESC) as rank,
  group_id,
  user_id,
  username,
  total_calls,
  total_points,
  hit_rate,
  avg_return,
  best_return,
  CASE 
    WHEN total_points >= 100 THEN '🏆 Champion'
    WHEN total_points >= 50 THEN '💎 Diamond'
    WHEN total_points >= 25 THEN '🚀 Rocket'
    WHEN total_points >= 10 THEN '📈 Trader'
    WHEN total_points >= 1 THEN '🌱 Seedling'
    ELSE '😭 Rekt'
  END as tier
FROM leaderboard_stats;

-- ============================================
-- TRIGGERS FOR AUTO-UPDATE
-- ============================================

-- Trigger: Update leaderboard stats when call is updated
CREATE TRIGGER IF NOT EXISTS update_leaderboard_on_call_change
AFTER UPDATE ON group_calls
BEGIN
  -- Recalculate stats for this user in this group
  INSERT OR REPLACE INTO leaderboard_stats (
    group_id,
    user_id,
    username,
    total_calls,
    total_points,
    hit_rate,
    avg_return,
    median_return,
    best_return,
    calls_2x,
    calls_5x,
    calls_10x,
    calls_50x,
    calls_100x,
    calls_rug,
    first_call_at,
    last_call_at,
    updated_at
  )
  SELECT 
    NEW.group_id,
    NEW.user_id,
    NEW.username,
    COUNT(*) as total_calls,
    SUM(points) as total_points,
    ROUND(AVG(CASE WHEN current_return >= 1.0 THEN 1 ELSE 0 END) * 100, 1) as hit_rate,
    ROUND(AVG(current_return), 2) as avg_return,
    ROUND(AVG(current_return), 2) as median_return, -- Simplified, real median needs more logic
    MAX(current_return) as best_return,
    SUM(CASE WHEN current_return >= 2 THEN 1 ELSE 0 END) as calls_2x,
    SUM(CASE WHEN current_return >= 5 THEN 1 ELSE 0 END) as calls_5x,
    SUM(CASE WHEN current_return >= 10 THEN 1 ELSE 0 END) as calls_10x,
    SUM(CASE WHEN current_return >= 50 THEN 1 ELSE 0 END) as calls_50x,
    SUM(CASE WHEN current_return >= 100 THEN 1 ELSE 0 END) as calls_100x,
    SUM(CASE WHEN is_rug = 1 THEN 1 ELSE 0 END) as calls_rug,
    MIN(called_at) as first_call_at,
    MAX(called_at) as last_call_at,
    strftime('%s', 'now') as updated_at
  FROM group_calls
  WHERE group_id = NEW.group_id AND user_id = NEW.user_id;
END;

-- ============================================
-- INITIAL DATA
-- ============================================

-- Insert default settings for new groups (will be populated on first use)
-- No initial data needed - will be created on-demand

-- ============================================
-- ROLLBACK (if needed)
-- ============================================
-- DROP TABLE IF EXISTS group_calls;
-- DROP TABLE IF EXISTS leaderboard_stats;
-- DROP TABLE IF EXISTS group_settings;
-- DROP VIEW IF EXISTS v_active_calls;
-- DROP VIEW IF EXISTS v_leaderboard_ranked;
-- DROP TRIGGER IF EXISTS update_leaderboard_on_call_change;
