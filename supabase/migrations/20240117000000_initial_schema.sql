-- Supabase Migration: Initial Schema
-- Mirrors SQLite schema for bot data synchronization

-- ============================================
-- Token Analysis Table
-- ============================================
CREATE TABLE IF NOT EXISTS token_analysis (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  risk_score INTEGER NOT NULL,
  risk_level TEXT NOT NULL,
  liquidity_usd NUMERIC NOT NULL,
  lp_burned_percent NUMERIC,
  lp_locked_percent NUMERIC,
  total_holders INTEGER,
  top10_percent NUMERIC,
  mint_revoked BOOLEAN DEFAULT FALSE,
  freeze_revoked BOOLEAN DEFAULT FALSE,
  is_honeypot BOOLEAN DEFAULT FALSE,
  has_twitter BOOLEAN DEFAULT FALSE,
  has_telegram BOOLEAN DEFAULT FALSE,
  has_website BOOLEAN DEFAULT FALSE,
  source TEXT,
  ml_rug_probability NUMERIC,
  ml_confidence NUMERIC,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_token_analysis_mint ON token_analysis(mint);
CREATE INDEX idx_token_analysis_analyzed_at ON token_analysis(analyzed_at DESC);
CREATE INDEX idx_token_analysis_risk_score ON token_analysis(risk_score);

-- ============================================
-- Alert History Table
-- ============================================
CREATE TABLE IF NOT EXISTS alert_history (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL,
  symbol TEXT,
  chat_id TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  risk_score INTEGER,
  risk_level TEXT,
  priority TEXT DEFAULT 'normal',
  title TEXT,
  description TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alert_history_mint ON alert_history(mint);
CREATE INDEX idx_alert_history_chat_id ON alert_history(chat_id);
CREATE INDEX idx_alert_history_sent_at ON alert_history(sent_at DESC);
CREATE INDEX idx_alert_history_alert_type ON alert_history(alert_type);

-- ============================================
-- Pool Discovery Table
-- ============================================
CREATE TABLE IF NOT EXISTS pool_discovery (
  id BIGSERIAL PRIMARY KEY,
  pool_address TEXT NOT NULL UNIQUE,
  token_mint TEXT NOT NULL,
  base_mint TEXT,
  quote_mint TEXT,
  source TEXT NOT NULL,
  initial_liquidity_usd NUMERIC,
  initial_price NUMERIC,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pool_discovery_token_mint ON pool_discovery(token_mint);
CREATE INDEX idx_pool_discovery_discovered_at ON pool_discovery(discovered_at DESC);
CREATE INDEX idx_pool_discovery_source ON pool_discovery(source);

-- ============================================
-- Token Outcomes Table (for ML training)
-- ============================================
CREATE TABLE IF NOT EXISTS token_outcomes (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  initial_price NUMERIC,
  initial_liquidity NUMERIC,
  initial_risk_score INTEGER,
  initial_holders INTEGER,
  initial_top10_percent NUMERIC,
  peak_price NUMERIC,
  peak_liquidity NUMERIC,
  peak_holders INTEGER,
  final_price NUMERIC,
  final_liquidity NUMERIC,
  final_holders INTEGER,
  outcome TEXT,
  outcome_confidence NUMERIC,
  peak_price_multiplier NUMERIC,
  time_to_peak INTEGER,
  time_to_outcome INTEGER,
  discovered_at TIMESTAMPTZ NOT NULL,
  peak_at TIMESTAMPTZ,
  outcome_recorded_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_token_outcomes_mint ON token_outcomes(mint);
CREATE INDEX idx_token_outcomes_outcome ON token_outcomes(outcome);
CREATE INDEX idx_token_outcomes_discovered_at ON token_outcomes(discovered_at DESC);

-- ============================================
-- Backtest Strategies Table
-- ============================================
CREATE TABLE IF NOT EXISTS backtest_strategies (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  entry_conditions JSONB NOT NULL,
  exit_conditions JSONB NOT NULL,
  position_sizing JSONB NOT NULL,
  is_preset BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_backtest_strategies_name ON backtest_strategies(name);

-- ============================================
-- Backtest Runs Table
-- ============================================
CREATE TABLE IF NOT EXISTS backtest_runs (
  id BIGSERIAL PRIMARY KEY,
  strategy_id INTEGER REFERENCES backtest_strategies(id),
  strategy_name TEXT NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  days_analyzed INTEGER NOT NULL,
  initial_capital NUMERIC NOT NULL,
  final_capital NUMERIC NOT NULL,
  total_trades INTEGER NOT NULL,
  winning_trades INTEGER NOT NULL,
  losing_trades INTEGER NOT NULL,
  win_rate NUMERIC NOT NULL,
  total_profit_loss NUMERIC NOT NULL,
  total_return NUMERIC NOT NULL,
  average_win NUMERIC,
  average_loss NUMERIC,
  largest_win NUMERIC,
  largest_loss NUMERIC,
  max_drawdown NUMERIC,
  max_drawdown_duration INTEGER,
  sharpe_ratio NUMERIC,
  sortino_ratio NUMERIC,
  profit_factor NUMERIC,
  average_hold_time INTEGER,
  longest_winning_streak INTEGER,
  longest_losing_streak INTEGER,
  equity_curve JSONB,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  execution_time_ms INTEGER,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_backtest_runs_strategy_id ON backtest_runs(strategy_id);
CREATE INDEX idx_backtest_runs_executed_at ON backtest_runs(executed_at DESC);

-- ============================================
-- Backtest Trades Table
-- ============================================
CREATE TABLE IF NOT EXISTS backtest_trades (
  id BIGSERIAL PRIMARY KEY,
  run_id INTEGER REFERENCES backtest_runs(id) ON DELETE CASCADE,
  token_mint TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  token_name TEXT,
  entry_price NUMERIC NOT NULL,
  entry_time TIMESTAMPTZ NOT NULL,
  position_size NUMERIC NOT NULL,
  exit_price NUMERIC NOT NULL,
  exit_time TIMESTAMPTZ NOT NULL,
  exit_reason TEXT NOT NULL,
  profit_loss NUMERIC NOT NULL,
  profit_loss_percent NUMERIC NOT NULL,
  hold_time_seconds INTEGER NOT NULL,
  peak_price NUMERIC,
  peak_multiplier NUMERIC,
  entry_risk_score INTEGER,
  entry_liquidity NUMERIC,
  entry_holders INTEGER,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_backtest_trades_run_id ON backtest_trades(run_id);
CREATE INDEX idx_backtest_trades_token_mint ON backtest_trades(token_mint);

-- ============================================
-- Token Snapshots Table (price/volume history)
-- ============================================
CREATE TABLE IF NOT EXISTS token_snapshots (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL,
  symbol TEXT,
  price_usd NUMERIC NOT NULL,
  price_sol NUMERIC,
  volume_5m NUMERIC,
  volume_1h NUMERIC,
  volume_24h NUMERIC,
  liquidity_usd NUMERIC,
  market_cap NUMERIC,
  holder_count INTEGER,
  price_change_5m NUMERIC,
  price_change_1h NUMERIC,
  price_change_24h NUMERIC,
  buys_5m INTEGER,
  sells_5m INTEGER,
  buys_1h INTEGER,
  sells_1h INTEGER,
  recorded_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(mint, recorded_at)
);

CREATE INDEX idx_token_snapshots_mint ON token_snapshots(mint);
CREATE INDEX idx_token_snapshots_recorded_at ON token_snapshots(recorded_at DESC);

-- ============================================
-- User Settings Table
-- ============================================
CREATE TABLE IF NOT EXISTS user_settings (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL UNIQUE,
  filters JSONB NOT NULL,
  watchlist JSONB DEFAULT '[]',
  blacklist JSONB DEFAULT '[]',
  tracked_wallets JSONB DEFAULT '[]',
  mute_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_settings_chat_id ON user_settings(chat_id);

-- ============================================
-- Bot Status Table (health monitoring)
-- ============================================
CREATE TABLE IF NOT EXISTS bot_status (
  id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL,
  uptime_ms BIGINT NOT NULL,
  memory_heap_used_mb INTEGER,
  memory_heap_total_mb INTEGER,
  memory_rss_mb INTEGER,
  checks JSONB,
  version TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bot_status_recorded_at ON bot_status(recorded_at DESC);

-- Keep only last 24 hours of status records
CREATE OR REPLACE FUNCTION cleanup_old_bot_status()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM bot_status WHERE recorded_at < NOW() - INTERVAL '24 hours';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_cleanup_bot_status
AFTER INSERT ON bot_status
EXECUTE FUNCTION cleanup_old_bot_status();

-- ============================================
-- Sync Metadata Table
-- ============================================
CREATE TABLE IF NOT EXISTS sync_metadata (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL UNIQUE,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_id BIGINT,
  sync_status TEXT DEFAULT 'idle',
  error_message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sync_metadata (table_name, sync_status) VALUES
  ('token_analysis', 'idle'),
  ('alert_history', 'idle'),
  ('pool_discovery', 'idle'),
  ('token_outcomes', 'idle'),
  ('backtest_strategies', 'idle'),
  ('backtest_runs', 'idle'),
  ('backtest_trades', 'idle'),
  ('token_snapshots', 'idle'),
  ('user_settings', 'idle'),
  ('bot_status', 'idle')
ON CONFLICT (table_name) DO NOTHING;

-- ============================================
-- Enable Row Level Security (RLS)
-- ============================================
ALTER TABLE token_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_discovery ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_metadata ENABLE ROW LEVEL SECURITY;

-- Allow read access for authenticated and anon users
CREATE POLICY "Allow read access" ON token_analysis FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON alert_history FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON pool_discovery FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON token_outcomes FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON backtest_strategies FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON backtest_runs FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON backtest_trades FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON token_snapshots FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON user_settings FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON bot_status FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON sync_metadata FOR SELECT USING (true);

-- Allow service role to write
CREATE POLICY "Allow service write" ON token_analysis FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow service write" ON alert_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow service write" ON pool_discovery FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow service write" ON token_outcomes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow service write" ON backtest_strategies FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow service write" ON backtest_runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow service write" ON backtest_trades FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow service write" ON token_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow service write" ON user_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow service write" ON bot_status FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow service write" ON sync_metadata FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- Enable Realtime for specific tables
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE pool_discovery;
ALTER PUBLICATION supabase_realtime ADD TABLE alert_history;
ALTER PUBLICATION supabase_realtime ADD TABLE bot_status;
