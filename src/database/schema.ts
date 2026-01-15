/**
 * SQLite database schema for persistent storage
 * Stores token analysis history, alerts, and ML training data
 */

export const SCHEMA = `
-- ============================================
-- Token Analysis History
-- Stores full analysis results for each token
-- ============================================
CREATE TABLE IF NOT EXISTS token_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  symbol TEXT,
  name TEXT,

  -- Risk classification
  risk_score INTEGER,
  risk_level TEXT,

  -- Liquidity data
  liquidity_usd REAL,
  lp_burned_percent REAL,
  lp_locked_percent REAL,

  -- Holder data
  total_holders INTEGER,
  top10_percent REAL,
  top20_percent REAL,
  largest_holder_percent REAL,
  whale_count INTEGER,

  -- Contract data
  mint_revoked INTEGER DEFAULT 0,
  freeze_revoked INTEGER DEFAULT 0,
  is_honeypot INTEGER DEFAULT 0,
  has_transfer_fee INTEGER DEFAULT 0,
  transfer_fee_percent REAL,

  -- Social data
  has_twitter INTEGER DEFAULT 0,
  has_telegram INTEGER DEFAULT 0,
  has_website INTEGER DEFAULT 0,
  twitter_followers INTEGER,
  telegram_members INTEGER,

  -- Source metadata
  source TEXT,
  pool_address TEXT,

  -- Timestamps (Unix epoch seconds)
  analyzed_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_token_analysis_mint ON token_analysis(mint);
CREATE INDEX IF NOT EXISTS idx_token_analysis_time ON token_analysis(analyzed_at);
CREATE INDEX IF NOT EXISTS idx_token_analysis_risk ON token_analysis(risk_level);

-- ============================================
-- Alert History
-- Tracks all alerts sent to prevent duplicates
-- ============================================
CREATE TABLE IF NOT EXISTS alert_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  symbol TEXT,
  chat_id TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  risk_score INTEGER,
  risk_level TEXT,
  liquidity_usd REAL,
  message_preview TEXT,

  -- Timestamps
  sent_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_alert_history_mint ON alert_history(mint);
CREATE INDEX IF NOT EXISTS idx_alert_history_chat ON alert_history(chat_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_time ON alert_history(sent_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_unique ON alert_history(mint, chat_id, alert_type, sent_at);

-- ============================================
-- Watchlist Price History
-- For tracking price changes and ML training
-- ============================================
CREATE TABLE IF NOT EXISTS watchlist_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  symbol TEXT,
  price_usd REAL,
  volume_1h REAL,
  volume_24h REAL,
  liquidity_usd REAL,
  holder_count INTEGER,
  market_cap REAL,

  -- Price changes
  price_change_1h REAL,
  price_change_24h REAL,

  -- Timestamps
  recorded_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_history_mint ON watchlist_price_history(mint);
CREATE INDEX IF NOT EXISTS idx_price_history_time ON watchlist_price_history(recorded_at);

-- ============================================
-- Pool Discovery Log
-- Tracks when and where pools are discovered
-- ============================================
CREATE TABLE IF NOT EXISTS pool_discovery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_address TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  source TEXT NOT NULL,

  -- Processing status
  analyzed INTEGER DEFAULT 0,
  alert_sent INTEGER DEFAULT 0,

  -- Timestamps
  discovered_at INTEGER NOT NULL,
  analyzed_at INTEGER,

  UNIQUE(pool_address)
);

CREATE INDEX IF NOT EXISTS idx_pool_discovery_mint ON pool_discovery(token_mint);
CREATE INDEX IF NOT EXISTS idx_pool_discovery_source ON pool_discovery(source);
CREATE INDEX IF NOT EXISTS idx_pool_discovery_time ON pool_discovery(discovered_at);

-- ============================================
-- Token Outcomes (ML Training Data)
-- Tracks what happened to tokens after discovery
-- ============================================
CREATE TABLE IF NOT EXISTS token_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL UNIQUE,
  symbol TEXT,

  -- Initial state at discovery
  initial_liquidity REAL,
  initial_risk_score INTEGER,
  initial_holders INTEGER,
  initial_top10_percent REAL,
  initial_price REAL,

  -- Peak values
  peak_price REAL,
  peak_liquidity REAL,
  peak_holders INTEGER,

  -- Final values (at outcome determination)
  final_price REAL,
  final_liquidity REAL,
  final_holders INTEGER,

  -- Outcome classification
  outcome TEXT, -- 'rug', 'pump', 'stable', 'slow_decline', 'unknown'
  outcome_confidence REAL, -- 0-1 confidence score
  peak_price_multiplier REAL, -- How much it pumped (peak/initial)
  time_to_peak INTEGER, -- Seconds from discovery to peak
  time_to_outcome INTEGER, -- Seconds from discovery to outcome

  -- Timestamps
  discovered_at INTEGER NOT NULL,
  peak_at INTEGER,
  outcome_recorded_at INTEGER,

  -- Metadata
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_token_outcomes_outcome ON token_outcomes(outcome);
CREATE INDEX IF NOT EXISTS idx_token_outcomes_time ON token_outcomes(discovered_at);

-- ============================================
-- Wallet Clusters (ML Feature)
-- Tracks related wallet groups
-- ============================================
CREATE TABLE IF NOT EXISTS wallet_clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  token_mint TEXT NOT NULL,

  -- Cluster metadata
  common_funder TEXT,
  percent_of_supply REAL,

  -- Timestamps
  detected_at INTEGER NOT NULL,

  UNIQUE(cluster_id, wallet_address, token_mint)
);

CREATE INDEX IF NOT EXISTS idx_wallet_clusters_mint ON wallet_clusters(token_mint);
CREATE INDEX IF NOT EXISTS idx_wallet_clusters_cluster ON wallet_clusters(cluster_id);

-- ============================================
-- ML Model Metadata
-- Tracks model training history
-- ============================================
CREATE TABLE IF NOT EXISTS ml_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,

  -- Training metadata
  training_samples INTEGER,
  validation_accuracy REAL,
  training_loss REAL,

  -- Model path
  model_path TEXT,

  -- Timestamps
  trained_at INTEGER NOT NULL,

  UNIQUE(model_name, model_version)
);

CREATE INDEX IF NOT EXISTS idx_ml_models_name ON ml_models(model_name);
`;

/**
 * Migration scripts for schema updates
 */
export const MIGRATIONS: { version: number; sql: string }[] = [
  // Future migrations go here
  // { version: 2, sql: 'ALTER TABLE token_analysis ADD COLUMN new_field TEXT;' }
];
