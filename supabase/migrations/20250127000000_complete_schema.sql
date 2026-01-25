-- Supabase Migration: Complete Schema
-- Adds all missing tables from SQLite schema (migrations v1-v16)
-- Timestamp: 2025-01-27

-- ============================================
-- Wallet Clusters (ML Feature)
-- ============================================
CREATE TABLE IF NOT EXISTS wallet_clusters (
  id BIGSERIAL PRIMARY KEY,
  cluster_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  common_funder TEXT,
  percent_of_supply NUMERIC,
  detected_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(cluster_id, wallet_address, token_mint)
);

CREATE INDEX idx_wallet_clusters_mint ON wallet_clusters(token_mint);
CREATE INDEX idx_wallet_clusters_cluster ON wallet_clusters(cluster_id);
CREATE INDEX idx_wallet_clusters_detected_at ON wallet_clusters(detected_at DESC);

-- ============================================
-- ML Models Metadata
-- ============================================
CREATE TABLE IF NOT EXISTS ml_models (
  id BIGSERIAL PRIMARY KEY,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  training_samples INTEGER NOT NULL,
  validation_accuracy NUMERIC,
  training_loss NUMERIC,
  model_path TEXT,
  trained_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(model_name, model_version)
);

CREATE INDEX idx_ml_models_name ON ml_models(model_name);
CREATE INDEX idx_ml_models_trained_at ON ml_models(trained_at DESC);

-- ============================================
-- ML Training Samples
-- ============================================
CREATE TABLE IF NOT EXISTS ml_training_samples (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL,
  symbol TEXT,
  features JSONB NOT NULL,
  feature_version TEXT DEFAULT 'v2',
  outcome TEXT CHECK(outcome IN ('rug', 'pump', 'stable', 'decline', NULL)),
  outcome_confidence NUMERIC,
  label_source TEXT,
  labeled_by TEXT,
  discovered_at TIMESTAMPTZ,
  labeled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(mint, feature_version)
);

CREATE INDEX idx_ml_samples_mint ON ml_training_samples(mint);
CREATE INDEX idx_ml_samples_outcome ON ml_training_samples(outcome);
CREATE INDEX idx_ml_samples_source ON ml_training_samples(label_source);
CREATE INDEX idx_ml_samples_labeled_at ON ml_training_samples(labeled_at DESC);

-- ============================================
-- ML Training Runs
-- ============================================
CREATE TABLE IF NOT EXISTS ml_training_runs (
  id BIGSERIAL PRIMARY KEY,
  model_version TEXT NOT NULL UNIQUE,
  feature_version TEXT DEFAULT 'v2',
  samples_used INTEGER,
  train_samples INTEGER,
  validation_samples INTEGER,
  test_samples INTEGER,
  accuracy NUMERIC,
  precision_score NUMERIC,
  recall_score NUMERIC,
  f1_score NUMERIC,
  auc_score NUMERIC,
  training_loss NUMERIC,
  validation_loss NUMERIC,
  epochs INTEGER,
  training_duration_ms INTEGER,
  is_active BOOLEAN DEFAULT FALSE,
  is_challenger BOOLEAN DEFAULT FALSE,
  feature_importance JSONB,
  confusion_matrix JSONB,
  trained_at TIMESTAMPTZ NOT NULL,
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ml_runs_version ON ml_training_runs(model_version);
CREATE INDEX idx_ml_runs_active ON ml_training_runs(is_active);
CREATE INDEX idx_ml_runs_trained_at ON ml_training_runs(trained_at DESC);

-- ============================================
-- ML Pending Labels
-- ============================================
CREATE TABLE IF NOT EXISTS ml_pending_labels (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL UNIQUE,
  symbol TEXT,
  initial_price NUMERIC,
  initial_liquidity NUMERIC,
  initial_risk_score INTEGER,
  current_price NUMERIC,
  price_change_percent NUMERIC,
  suggested_label TEXT,
  suggest_confidence NUMERIC,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'labeled', 'skipped')),
  discovered_at TIMESTAMPTZ NOT NULL,
  last_updated_at TIMESTAMPTZ,
  labeled_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ml_pending_mint ON ml_pending_labels(mint);
CREATE INDEX idx_ml_pending_status ON ml_pending_labels(status);
CREATE INDEX idx_ml_pending_discovered_at ON ml_pending_labels(discovered_at DESC);

-- ============================================
-- Feature Importance Analysis
-- ============================================
CREATE TABLE IF NOT EXISTS feature_importance_analysis (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  total_features INTEGER NOT NULL,
  analyzed_samples INTEGER NOT NULL,
  improvement_estimate NUMERIC,
  importance_scores JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feature_importance_timestamp ON feature_importance_analysis(timestamp DESC);

-- ============================================
-- Positions (Portfolio Tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS positions (
  id BIGSERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  side TEXT NOT NULL CHECK(side IN ('long', 'short')),
  entry_price NUMERIC NOT NULL,
  current_price NUMERIC NOT NULL,
  quantity NUMERIC NOT NULL,
  entry_value NUMERIC NOT NULL,
  current_value NUMERIC NOT NULL,
  unrealized_pnl NUMERIC DEFAULT 0,
  unrealized_pnl_percent NUMERIC DEFAULT 0,
  entry_time TIMESTAMPTZ NOT NULL,
  last_updated TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed')),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_positions_status ON positions(status);
CREATE INDEX idx_positions_mint ON positions(token_mint);
CREATE INDEX idx_positions_entry_time ON positions(entry_time DESC);

-- ============================================
-- Trades (Portfolio Tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS trades (
  id BIGSERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('long', 'short')),
  action TEXT NOT NULL CHECK(action IN ('open', 'close', 'partial_close')),
  entry_price NUMERIC NOT NULL,
  exit_price NUMERIC,
  quantity NUMERIC NOT NULL,
  entry_value NUMERIC NOT NULL,
  exit_value NUMERIC,
  realized_pnl NUMERIC,
  realized_pnl_percent NUMERIC,
  fees NUMERIC DEFAULT 0,
  timestamp TIMESTAMPTZ NOT NULL,
  notes TEXT,
  position_id BIGINT REFERENCES positions(id),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trades_mint ON trades(token_mint);
CREATE INDEX idx_trades_action ON trades(action);
CREATE INDEX idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX idx_trades_position ON trades(position_id);

-- ============================================
-- Portfolio Snapshots
-- ============================================
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  total_value NUMERIC NOT NULL,
  total_invested NUMERIC NOT NULL,
  unrealized_pnl NUMERIC NOT NULL,
  realized_pnl NUMERIC NOT NULL,
  total_pnl NUMERIC NOT NULL,
  open_positions INTEGER NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_portfolio_snapshots_timestamp ON portfolio_snapshots(timestamp DESC);

-- ============================================
-- Scan Filters
-- ============================================
CREATE TABLE IF NOT EXISTS scan_filters (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  min_risk_score INTEGER,
  max_risk_score INTEGER,
  min_liquidity NUMERIC,
  max_liquidity NUMERIC,
  min_holders INTEGER,
  max_holders INTEGER,
  max_top10_percent NUMERIC,
  require_mint_revoked BOOLEAN DEFAULT FALSE,
  require_freeze_revoked BOOLEAN DEFAULT FALSE,
  require_lp_burned BOOLEAN DEFAULT FALSE,
  min_lp_burned_percent NUMERIC,
  require_socials BOOLEAN DEFAULT FALSE,
  min_price_change_1h NUMERIC,
  max_price_change_1h NUMERIC,
  min_volume_24h NUMERIC,
  max_rug_probability NUMERIC,
  min_ml_confidence NUMERIC,
  min_age_hours NUMERIC,
  max_age_hours NUMERIC,
  created_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scan_filters_enabled ON scan_filters(enabled);

-- ============================================
-- Scan Matches
-- ============================================
CREATE TABLE IF NOT EXISTS scan_matches (
  id BIGSERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  filter_id BIGINT REFERENCES scan_filters(id) ON DELETE CASCADE,
  filter_name TEXT NOT NULL,
  risk_score INTEGER,
  liquidity_usd NUMERIC,
  holder_count INTEGER,
  rug_probability NUMERIC,
  matched_at TIMESTAMPTZ NOT NULL,
  alerted BOOLEAN DEFAULT FALSE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(token_mint, filter_id)
);

CREATE INDEX idx_scan_matches_mint ON scan_matches(token_mint);
CREATE INDEX idx_scan_matches_filter ON scan_matches(filter_id);
CREATE INDEX idx_scan_matches_matched_at ON scan_matches(matched_at DESC);

-- ============================================
-- Token Outcomes V2 (Enhanced for Learning)
-- ============================================
CREATE TABLE IF NOT EXISTS token_outcomes_v2 (
  id BIGSERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL,
  initial_price NUMERIC,
  initial_liquidity NUMERIC,
  initial_risk_score INTEGER,
  initial_rug_prob NUMERIC,
  outcome_type TEXT CHECK(outcome_type IN ('moon', 'rug', 'stable', 'decline', 'unknown', NULL)),
  price_change_24h NUMERIC,
  price_change_7d NUMERIC,
  final_price NUMERIC,
  max_price NUMERIC,
  min_price NUMERIC,
  was_traded BOOLEAN DEFAULT FALSE,
  trade_profit NUMERIC,
  trade_profit_percent NUMERIC,
  checked_at TIMESTAMPTZ NOT NULL,
  confidence NUMERIC DEFAULT 0.5,
  used_for_training BOOLEAN DEFAULT FALSE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outcomes_v2_mint ON token_outcomes_v2(token_mint);
CREATE INDEX idx_outcomes_v2_type ON token_outcomes_v2(outcome_type);
CREATE INDEX idx_outcomes_v2_discovered ON token_outcomes_v2(discovered_at DESC);
CREATE INDEX idx_outcomes_v2_traded ON token_outcomes_v2(was_traded);

-- ============================================
-- Automation Rules
-- ============================================
CREATE TABLE IF NOT EXISTS automation_rules (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 50,
  conditions JSONB NOT NULL,
  actions JSONB NOT NULL,
  match_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_automation_rules_enabled ON automation_rules(enabled);
CREATE INDEX idx_automation_rules_priority ON automation_rules(priority DESC);

-- ============================================
-- Automation Decisions
-- ============================================
CREATE TABLE IF NOT EXISTS automation_decisions (
  id BIGSERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('gem', 'watch', 'avoid', 'unknown')),
  confidence NUMERIC DEFAULT 0,
  reasons JSONB,
  actions JSONB,
  rule_name TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_automation_decisions_mint ON automation_decisions(token_mint);
CREATE INDEX idx_automation_decisions_category ON automation_decisions(category);
CREATE INDEX idx_automation_decisions_timestamp ON automation_decisions(timestamp DESC);

-- ============================================
-- Risk Parameters
-- ============================================
CREATE TABLE IF NOT EXISTS risk_parameters (
  id INTEGER PRIMARY KEY DEFAULT 1,
  account_balance NUMERIC NOT NULL,
  max_daily_loss NUMERIC NOT NULL,
  max_position_size NUMERIC NOT NULL,
  base_risk_percent NUMERIC NOT NULL,
  max_risk_percent NUMERIC NOT NULL,
  max_open_positions INTEGER NOT NULL,
  max_correlated_positions INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id = 1)
);

INSERT INTO risk_parameters (
  id, account_balance, max_daily_loss, max_position_size,
  base_risk_percent, max_risk_percent, max_open_positions,
  max_correlated_positions, updated_at
) VALUES (1, 10000, 5, 10, 1, 2, 5, 2, NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Group Settings
-- ============================================
CREATE TABLE IF NOT EXISTS group_settings (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL UNIQUE,
  chat_type TEXT NOT NULL,
  chat_title TEXT,
  enable_token_alerts BOOLEAN DEFAULT TRUE,
  enable_smart_money_alerts BOOLEAN DEFAULT TRUE,
  enable_rug_warnings BOOLEAN DEFAULT TRUE,
  enable_signals BOOLEAN DEFAULT TRUE,
  enable_volume_spikes BOOLEAN DEFAULT FALSE,
  min_risk_score INTEGER DEFAULT 80,
  min_liquidity_usd NUMERIC DEFAULT 50000,
  max_alerts_per_hour INTEGER DEFAULT 5,
  enable_group_watchlist BOOLEAN DEFAULT TRUE,
  enable_leaderboard BOOLEAN DEFAULT FALSE,
  enable_morning_briefing BOOLEAN DEFAULT TRUE,
  admin_user_ids JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_group_settings_chat_id ON group_settings(chat_id);
CREATE INDEX idx_group_settings_chat_type ON group_settings(chat_type);

-- ============================================
-- User Settings (Extended)
-- ============================================
CREATE TABLE IF NOT EXISTS user_settings_extended (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  enable_token_alerts BOOLEAN DEFAULT TRUE,
  enable_smart_money_alerts BOOLEAN DEFAULT TRUE,
  enable_rug_warnings BOOLEAN DEFAULT TRUE,
  enable_signals BOOLEAN DEFAULT TRUE,
  enable_volume_spikes BOOLEAN DEFAULT TRUE,
  enable_watchlist_alerts BOOLEAN DEFAULT TRUE,
  min_risk_score INTEGER DEFAULT 60,
  min_liquidity_usd NUMERIC DEFAULT 10000,
  participate_in_leaderboard BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_settings_ext_user_id ON user_settings_extended(user_id);
CREATE INDEX idx_user_settings_ext_username ON user_settings_extended(username);

-- ============================================
-- Group Alert Throttle
-- ============================================
CREATE TABLE IF NOT EXISTS group_alert_throttle (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(chat_id, token_mint, alert_type)
);

CREATE INDEX idx_alert_throttle_chat ON group_alert_throttle(chat_id);
CREATE INDEX idx_alert_throttle_sent_at ON group_alert_throttle(sent_at DESC);

-- ============================================
-- Group Watchlist
-- ============================================
CREATE TABLE IF NOT EXISTS group_watchlist (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  added_by_user_id BIGINT NOT NULL,
  added_by_username TEXT,
  added_at TIMESTAMPTZ NOT NULL,
  alert_count INTEGER DEFAULT 0,
  last_alerted_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(chat_id, token_mint)
);

CREATE INDEX idx_group_watchlist_chat ON group_watchlist(chat_id);
CREATE INDEX idx_group_watchlist_mint ON group_watchlist(token_mint);
CREATE INDEX idx_group_watchlist_added_at ON group_watchlist(added_at DESC);
CREATE INDEX idx_group_watchlist_alert_count ON group_watchlist(alert_count DESC);

-- ============================================
-- Leaderboard Entries
-- ============================================
CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL,
  user_id BIGINT NOT NULL,
  username TEXT,
  token_mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  discovered_at TIMESTAMPTZ NOT NULL,
  initial_price NUMERIC NOT NULL,
  peak_price NUMERIC NOT NULL,
  current_price NUMERIC NOT NULL,
  peak_multiplier NUMERIC NOT NULL,
  score NUMERIC DEFAULT 0,
  outcome TEXT DEFAULT 'pending' CHECK(outcome IN ('moon', 'profit', 'stable', 'loss', 'pending')),
  tracked_until TIMESTAMPTZ NOT NULL,
  last_updated_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(chat_id, user_id, token_mint)
);

CREATE INDEX idx_leaderboard_chat ON leaderboard_entries(chat_id);
CREATE INDEX idx_leaderboard_user ON leaderboard_entries(user_id);
CREATE INDEX idx_leaderboard_discovered ON leaderboard_entries(discovered_at DESC);
CREATE INDEX idx_leaderboard_score ON leaderboard_entries(score DESC);
CREATE INDEX idx_leaderboard_outcome ON leaderboard_entries(outcome);
CREATE INDEX idx_leaderboard_tracked_until ON leaderboard_entries(tracked_until);

-- ============================================
-- Topic Configurations (Telegram Forum Groups)
-- ============================================
CREATE TABLE IF NOT EXISTS topic_configs (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL,
  topic_id INTEGER NOT NULL,
  topic_name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('command_only', 'normal', 'read_only')),
  allowed_commands JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(chat_id, topic_id)
);

CREATE INDEX idx_topic_configs_chat ON topic_configs(chat_id);
CREATE INDEX idx_topic_configs_topic ON topic_configs(chat_id, topic_id);
CREATE INDEX idx_topic_configs_mode ON topic_configs(mode);

-- ============================================
-- Smart Money Wallets
-- ============================================
CREATE TABLE IF NOT EXISTS smart_money_wallets (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  win_rate NUMERIC DEFAULT 0,
  total_profit_sol NUMERIC DEFAULT 0,
  average_profit_percent NUMERIC DEFAULT 0,
  largest_win_percent NUMERIC DEFAULT 0,
  largest_loss_percent NUMERIC DEFAULT 0,
  average_hold_time_hours NUMERIC DEFAULT 0,
  average_entry_liquidity NUMERIC DEFAULT 0,
  preferred_risk_range TEXT,
  trading_style TEXT,
  common_entry_patterns JSONB,
  common_exit_patterns JSONB,
  first_tracked_at TIMESTAMPTZ NOT NULL,
  last_trade_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ NOT NULL,
  reputation_score INTEGER DEFAULT 50,
  is_verified BOOLEAN DEFAULT FALSE,
  is_suspicious BOOLEAN DEFAULT FALSE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_smart_money_reputation ON smart_money_wallets(reputation_score DESC);
CREATE INDEX idx_smart_money_winrate ON smart_money_wallets(win_rate DESC);
CREATE INDEX idx_smart_money_last_trade ON smart_money_wallets(last_trade_at DESC);

-- ============================================
-- Smart Money Trades
-- ============================================
CREATE TABLE IF NOT EXISTS smart_money_trades (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL REFERENCES smart_money_wallets(wallet_address),
  token_mint TEXT NOT NULL,
  token_symbol TEXT,
  entry_price NUMERIC NOT NULL,
  entry_time TIMESTAMPTZ NOT NULL,
  entry_liquidity NUMERIC,
  entry_risk_score INTEGER,
  exit_price NUMERIC,
  exit_time TIMESTAMPTZ,
  exit_reason TEXT,
  profit_percent NUMERIC,
  hold_time_hours NUMERIC,
  status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sm_trades_wallet ON smart_money_trades(wallet_address);
CREATE INDEX idx_sm_trades_token ON smart_money_trades(token_mint);
CREATE INDEX idx_sm_trades_status ON smart_money_trades(status);
CREATE INDEX idx_sm_trades_entry_time ON smart_money_trades(entry_time DESC);

-- ============================================
-- Smart Money Alerts
-- ============================================
CREATE TABLE IF NOT EXISTS smart_money_alerts (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL REFERENCES smart_money_wallets(wallet_address),
  token_mint TEXT NOT NULL,
  token_symbol TEXT,
  alert_type TEXT NOT NULL CHECK(alert_type IN ('entry', 'exit', 'large_buy', 'large_sell')),
  amount_sol NUMERIC,
  price NUMERIC,
  wallet_reputation INTEGER,
  wallet_win_rate NUMERIC,
  alerted_at TIMESTAMPTZ NOT NULL,
  chat_id TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sm_alerts_alerted_at ON smart_money_alerts(alerted_at DESC);
CREATE INDEX idx_sm_alerts_wallet ON smart_money_alerts(wallet_address);
CREATE INDEX idx_sm_alerts_token ON smart_money_alerts(token_mint);

-- ============================================
-- Success Patterns
-- ============================================
CREATE TABLE IF NOT EXISTS success_patterns (
  id BIGSERIAL PRIMARY KEY,
  pattern_name TEXT NOT NULL UNIQUE,
  pattern_type TEXT NOT NULL CHECK(pattern_type IN ('success', 'rug', 'neutral')),
  criteria JSONB NOT NULL,
  occurrence_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  success_rate NUMERIC DEFAULT 0,
  average_peak_multiplier NUMERIC DEFAULT 0,
  average_time_to_peak_hours NUMERIC DEFAULT 0,
  discovered_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ,
  confidence_score NUMERIC DEFAULT 0.5,
  is_active BOOLEAN DEFAULT TRUE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_patterns_type ON success_patterns(pattern_type);
CREATE INDEX idx_patterns_success_rate ON success_patterns(success_rate DESC);
CREATE INDEX idx_patterns_active ON success_patterns(is_active);

-- ============================================
-- Token Pattern Matches
-- ============================================
CREATE TABLE IF NOT EXISTS token_pattern_matches (
  id BIGSERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL,
  token_symbol TEXT,
  pattern_id BIGINT REFERENCES success_patterns(id),
  pattern_name TEXT NOT NULL,
  match_score NUMERIC NOT NULL,
  matched_criteria JSONB,
  actual_outcome TEXT,
  peak_multiplier NUMERIC,
  matched_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pattern_matches_token ON token_pattern_matches(token_mint);
CREATE INDEX idx_pattern_matches_pattern ON token_pattern_matches(pattern_id);
CREATE INDEX idx_pattern_matches_score ON token_pattern_matches(match_score DESC);
CREATE INDEX idx_pattern_matches_outcome ON token_pattern_matches(actual_outcome);
CREATE INDEX idx_pattern_matches_matched_at ON token_pattern_matches(matched_at DESC);

-- ============================================
-- ML Model Versions (Enhanced)
-- ============================================
CREATE TABLE IF NOT EXISTS ml_model_versions (
  id BIGSERIAL PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  trained_at TIMESTAMPTZ NOT NULL,
  training_samples INTEGER NOT NULL,
  validation_samples INTEGER NOT NULL,
  test_samples INTEGER NOT NULL,
  accuracy NUMERIC NOT NULL,
  precision_score NUMERIC NOT NULL,
  recall_score NUMERIC NOT NULL,
  f1_score NUMERIC NOT NULL,
  auc_score NUMERIC,
  training_loss NUMERIC,
  validation_loss NUMERIC,
  feature_importance JSONB,
  confusion_matrix JSONB,
  is_active BOOLEAN DEFAULT FALSE,
  is_production BOOLEAN DEFAULT FALSE,
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  accuracy_delta NUMERIC,
  notes TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ml_model_versions_active ON ml_model_versions(is_active);
CREATE INDEX idx_ml_model_versions_accuracy ON ml_model_versions(accuracy DESC);
CREATE INDEX idx_ml_model_versions_trained_at ON ml_model_versions(trained_at DESC);

-- ============================================
-- Prediction Performance
-- ============================================
CREATE TABLE IF NOT EXISTS prediction_performance (
  id BIGSERIAL PRIMARY KEY,
  model_version TEXT NOT NULL REFERENCES ml_model_versions(version),
  token_mint TEXT NOT NULL,
  token_symbol TEXT,
  predicted_outcome TEXT NOT NULL,
  predicted_confidence NUMERIC NOT NULL,
  rug_probability NUMERIC NOT NULL,
  actual_outcome TEXT,
  actual_peak_multiplier NUMERIC,
  was_correct BOOLEAN,
  confidence_calibration NUMERIC,
  predicted_at TIMESTAMPTZ NOT NULL,
  outcome_recorded_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pred_perf_model ON prediction_performance(model_version);
CREATE INDEX idx_pred_perf_correct ON prediction_performance(was_correct);
CREATE INDEX idx_pred_perf_token ON prediction_performance(token_mint);
CREATE INDEX idx_pred_perf_predicted_at ON prediction_performance(predicted_at DESC);

-- ============================================
-- Training Schedule
-- ============================================
CREATE TABLE IF NOT EXISTS training_schedule (
  id BIGSERIAL PRIMARY KEY,
  frequency_days INTEGER DEFAULT 7,
  min_new_samples INTEGER DEFAULT 50,
  last_run_at TIMESTAMPTZ,
  last_version_trained TEXT,
  next_run_at TIMESTAMPTZ,
  is_enabled BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO training_schedule (frequency_days, min_new_samples, next_run_at, updated_at)
VALUES (7, 50, NOW() + INTERVAL '7 days', NOW())
ON CONFLICT DO NOTHING;

-- ============================================
-- Trading Signals
-- ============================================
CREATE TABLE IF NOT EXISTS trading_signals (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  symbol TEXT,
  name TEXT,
  type TEXT NOT NULL CHECK(type IN ('BUY', 'SELL', 'TAKE_PROFIT', 'STOP_LOSS')),
  confidence INTEGER,
  suggested_position_size NUMERIC,
  position_size_type TEXT,
  rug_probability NUMERIC,
  risk_score INTEGER,
  smart_money_score NUMERIC,
  momentum_score NUMERIC,
  holder_score NUMERIC,
  entry_price NUMERIC,
  target_price NUMERIC,
  stop_loss_price NUMERIC,
  reasons JSONB,
  warnings JSONB,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'acknowledged', 'expired', 'executed')),
  generated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  actual_entry NUMERIC,
  actual_exit NUMERIC,
  profit_loss_percent NUMERIC,
  was_accurate BOOLEAN,
  hit_target BOOLEAN,
  hit_stop_loss BOOLEAN,
  entry_recorded_at TIMESTAMPTZ,
  exit_recorded_at TIMESTAMPTZ,
  outcome_notes TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trading_signals_mint ON trading_signals(mint);
CREATE INDEX idx_trading_signals_type ON trading_signals(type);
CREATE INDEX idx_trading_signals_status ON trading_signals(status);
CREATE INDEX idx_trading_signals_generated_at ON trading_signals(generated_at DESC);

-- ============================================
-- Signal Webhooks
-- ============================================
CREATE TABLE IF NOT EXISTS signal_webhooks (
  id BIGSERIAL PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  name TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  events JSONB,
  min_confidence INTEGER DEFAULT 60,
  total_sent INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ,
  last_triggered_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_signal_webhooks_enabled ON signal_webhooks(enabled);

-- ============================================
-- Snapshot Watch List (Already exists but ensure it's there)
-- ============================================
CREATE TABLE IF NOT EXISTS snapshot_watch_list (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL UNIQUE,
  symbol TEXT,
  added_at TIMESTAMPTZ NOT NULL,
  last_snapshot_at TIMESTAMPTZ,
  snapshot_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_snapshot_watch_mint ON snapshot_watch_list(mint);
CREATE INDEX idx_snapshot_watch_active ON snapshot_watch_list(is_active);

-- ============================================
-- Watchlist Price History
-- ============================================
CREATE TABLE IF NOT EXISTS watchlist_price_history (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL,
  symbol TEXT,
  price_usd NUMERIC,
  volume_1h NUMERIC,
  volume_24h NUMERIC,
  liquidity_usd NUMERIC,
  holder_count INTEGER,
  market_cap NUMERIC,
  price_change_1h NUMERIC,
  price_change_24h NUMERIC,
  recorded_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_price_history_mint ON watchlist_price_history(mint);
CREATE INDEX idx_price_history_recorded_at ON watchlist_price_history(recorded_at DESC);

-- ============================================
-- Enable Row Level Security (RLS)
-- ============================================
ALTER TABLE wallet_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_training_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_training_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_pending_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_importance_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_outcomes_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_parameters ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings_extended ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_alert_throttle ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE smart_money_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE smart_money_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE smart_money_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE success_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_pattern_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshot_watch_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_price_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow read for all, write for service role
CREATE POLICY "Allow read access" ON wallet_clusters FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON wallet_clusters FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON ml_models FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON ml_models FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON ml_training_samples FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON ml_training_samples FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON ml_training_runs FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON ml_training_runs FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON ml_pending_labels FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON ml_pending_labels FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON feature_importance_analysis FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON feature_importance_analysis FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON positions FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON positions FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON trades FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON trades FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON portfolio_snapshots FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON portfolio_snapshots FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON scan_filters FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON scan_filters FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON scan_matches FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON scan_matches FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON token_outcomes_v2 FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON token_outcomes_v2 FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON automation_rules FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON automation_rules FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON automation_decisions FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON automation_decisions FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON risk_parameters FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON risk_parameters FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON group_settings FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON group_settings FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON user_settings_extended FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON user_settings_extended FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON group_alert_throttle FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON group_alert_throttle FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON group_watchlist FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON group_watchlist FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON leaderboard_entries FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON leaderboard_entries FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON topic_configs FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON topic_configs FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON smart_money_wallets FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON smart_money_wallets FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON smart_money_trades FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON smart_money_trades FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON smart_money_alerts FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON smart_money_alerts FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON success_patterns FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON success_patterns FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON token_pattern_matches FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON token_pattern_matches FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON ml_model_versions FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON ml_model_versions FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON prediction_performance FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON prediction_performance FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON training_schedule FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON training_schedule FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON trading_signals FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON trading_signals FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON signal_webhooks FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON signal_webhooks FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON snapshot_watch_list FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON snapshot_watch_list FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read access" ON watchlist_price_history FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON watchlist_price_history FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- Update sync_metadata with new tables
-- ============================================
INSERT INTO sync_metadata (table_name, sync_status) VALUES
  ('wallet_clusters', 'idle'),
  ('ml_models', 'idle'),
  ('ml_training_samples', 'idle'),
  ('ml_training_runs', 'idle'),
  ('ml_pending_labels', 'idle'),
  ('feature_importance_analysis', 'idle'),
  ('positions', 'idle'),
  ('trades', 'idle'),
  ('portfolio_snapshots', 'idle'),
  ('scan_filters', 'idle'),
  ('scan_matches', 'idle'),
  ('token_outcomes_v2', 'idle'),
  ('automation_rules', 'idle'),
  ('automation_decisions', 'idle'),
  ('risk_parameters', 'idle'),
  ('group_settings', 'idle'),
  ('user_settings_extended', 'idle'),
  ('group_alert_throttle', 'idle'),
  ('group_watchlist', 'idle'),
  ('leaderboard_entries', 'idle'),
  ('topic_configs', 'idle'),
  ('smart_money_wallets', 'idle'),
  ('smart_money_trades', 'idle'),
  ('smart_money_alerts', 'idle'),
  ('success_patterns', 'idle'),
  ('token_pattern_matches', 'idle'),
  ('ml_model_versions', 'idle'),
  ('prediction_performance', 'idle'),
  ('training_schedule', 'idle'),
  ('trading_signals', 'idle'),
  ('signal_webhooks', 'idle'),
  ('snapshot_watch_list', 'idle'),
  ('watchlist_price_history', 'idle')
ON CONFLICT (table_name) DO NOTHING;
