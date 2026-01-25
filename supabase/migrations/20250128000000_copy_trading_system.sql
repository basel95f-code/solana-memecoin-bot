-- ============================================
-- Copy Trading System - Smart Wallet Tracking
-- ============================================
-- Migration: 20250128000000_copy_trading_system.sql
-- Description: Adds tables for tracking wallets and their transactions

-- ============================================
-- Tracked Wallets (User-Added Wallets to Monitor)
-- ============================================
CREATE TABLE IF NOT EXISTS tracked_wallets (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,
  label TEXT, -- User-friendly name/label
  
  -- Discovery source
  source TEXT DEFAULT 'manual' CHECK(source IN ('manual', 'auto_discovered', 'smart_money')),
  added_by_user_id BIGINT,
  added_by_username TEXT,
  
  -- Performance scores (updated periodically)
  score NUMERIC DEFAULT 0, -- Overall performance score (0-100)
  win_rate NUMERIC DEFAULT 0,
  total_profit_sol NUMERIC DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  
  -- Tracking status
  is_active BOOLEAN DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  
  -- Timestamps
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tracked_wallets_address ON tracked_wallets(wallet_address);
CREATE INDEX idx_tracked_wallets_score ON tracked_wallets(score DESC);
CREATE INDEX idx_tracked_wallets_active ON tracked_wallets(is_active);
CREATE INDEX idx_tracked_wallets_source ON tracked_wallets(source);
CREATE INDEX idx_tracked_wallets_added_at ON tracked_wallets(added_at DESC);

-- ============================================
-- Wallet Transactions (All Detected Transactions)
-- ============================================
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id BIGSERIAL PRIMARY KEY,
  
  -- Transaction details
  signature TEXT NOT NULL UNIQUE,
  wallet_address TEXT NOT NULL,
  
  -- Token details
  token_mint TEXT NOT NULL,
  token_symbol TEXT,
  token_name TEXT,
  
  -- Action details
  action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'transfer_in', 'transfer_out', 'swap')),
  amount NUMERIC NOT NULL, -- Token amount
  price_usd NUMERIC, -- Price at time of transaction
  value_sol NUMERIC, -- Value in SOL
  value_usd NUMERIC, -- Value in USD
  
  -- DEX/Protocol
  dex_protocol TEXT, -- e.g., 'raydium', 'jupiter', 'pumpfun'
  pool_address TEXT,
  
  -- Profit tracking (for sells)
  cost_basis_usd NUMERIC, -- Original purchase cost
  profit_usd NUMERIC, -- Profit/loss on this transaction
  profit_percent NUMERIC, -- Profit percentage
  hold_duration_hours NUMERIC, -- Time held before selling
  
  -- Transaction metadata
  block_time TIMESTAMPTZ NOT NULL,
  slot BIGINT NOT NULL,
  fee_sol NUMERIC,
  
  -- Alert tracking
  alert_sent BOOLEAN DEFAULT FALSE,
  alert_sent_at TIMESTAMPTZ,
  
  -- Timestamps
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_txs_wallet ON wallet_transactions(wallet_address);
CREATE INDEX idx_wallet_txs_token ON wallet_transactions(token_mint);
CREATE INDEX idx_wallet_txs_action ON wallet_transactions(action);
CREATE INDEX idx_wallet_txs_block_time ON wallet_transactions(block_time DESC);
CREATE INDEX idx_wallet_txs_signature ON wallet_transactions(signature);
CREATE INDEX idx_wallet_txs_alert_sent ON wallet_transactions(alert_sent);
CREATE INDEX idx_wallet_txs_wallet_token ON wallet_transactions(wallet_address, token_mint);

-- ============================================
-- Wallet Performance (Aggregated Metrics)
-- ============================================
CREATE TABLE IF NOT EXISTS wallet_performance (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,
  
  -- Trading statistics
  total_trades INTEGER DEFAULT 0,
  total_buys INTEGER DEFAULT 0,
  total_sells INTEGER DEFAULT 0,
  
  -- Win/Loss tracking
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  win_rate NUMERIC DEFAULT 0, -- Percentage
  
  -- Profit metrics
  total_profit_sol NUMERIC DEFAULT 0,
  total_profit_usd NUMERIC DEFAULT 0,
  average_profit_percent NUMERIC DEFAULT 0,
  largest_win_percent NUMERIC DEFAULT 0,
  largest_loss_percent NUMERIC DEFAULT 0,
  
  -- Timing metrics
  average_hold_time_hours NUMERIC DEFAULT 0,
  median_hold_time_hours NUMERIC DEFAULT 0,
  
  -- Entry timing (how early they buy)
  early_entry_rate NUMERIC DEFAULT 0, -- % of trades made within first hour
  average_entry_timing_minutes NUMERIC DEFAULT 0, -- Average time after token launch
  
  -- Volume metrics
  total_volume_sol NUMERIC DEFAULT 0,
  total_volume_usd NUMERIC DEFAULT 0,
  average_position_size_sol NUMERIC DEFAULT 0,
  
  -- Activity metrics
  active_days INTEGER DEFAULT 0,
  trades_per_day NUMERIC DEFAULT 0,
  favorite_tokens JSONB, -- Array of most-traded token mints
  favorite_dexes JSONB, -- Array of most-used DEXes
  
  -- Risk metrics
  max_drawdown_percent NUMERIC DEFAULT 0,
  sharpe_ratio NUMERIC, -- Risk-adjusted return
  
  -- Reputation
  reputation_score INTEGER DEFAULT 50, -- 0-100 score
  
  -- Timestamps
  first_trade_at TIMESTAMPTZ,
  last_trade_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT fk_wallet_performance_wallet 
    FOREIGN KEY (wallet_address) 
    REFERENCES tracked_wallets(wallet_address) 
    ON DELETE CASCADE
);

CREATE INDEX idx_wallet_perf_wallet ON wallet_performance(wallet_address);
CREATE INDEX idx_wallet_perf_win_rate ON wallet_performance(win_rate DESC);
CREATE INDEX idx_wallet_perf_total_profit ON wallet_performance(total_profit_usd DESC);
CREATE INDEX idx_wallet_perf_reputation ON wallet_performance(reputation_score DESC);
CREATE INDEX idx_wallet_perf_last_trade ON wallet_performance(last_trade_at DESC);

-- ============================================
-- Wallet Discovery Queue (Auto-Discovery)
-- ============================================
CREATE TABLE IF NOT EXISTS wallet_discovery_queue (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,
  
  -- Discovery context
  discovered_from_token TEXT, -- Token mint where wallet was discovered
  discovery_reason TEXT, -- 'early_buyer', 'profitable_seller', 'large_holder'
  
  -- Initial metrics
  initial_score NUMERIC DEFAULT 0,
  estimated_profit_sol NUMERIC,
  estimated_win_rate NUMERIC,
  
  -- Processing status
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'analyzing', 'approved', 'rejected', 'tracked')),
  analysis_notes TEXT,
  
  -- Timestamps
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  analyzed_at TIMESTAMPTZ,
  decision_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_discovery_status ON wallet_discovery_queue(status);
CREATE INDEX idx_wallet_discovery_score ON wallet_discovery_queue(initial_score DESC);
CREATE INDEX idx_wallet_discovery_discovered_at ON wallet_discovery_queue(discovered_at DESC);

-- ============================================
-- Copy Trading Alerts (Alert History)
-- ============================================
CREATE TABLE IF NOT EXISTS copy_trading_alerts (
  id BIGSERIAL PRIMARY KEY,
  
  -- Alert details
  wallet_address TEXT NOT NULL,
  wallet_label TEXT,
  transaction_id BIGINT REFERENCES wallet_transactions(id) ON DELETE CASCADE,
  
  -- Token details
  token_mint TEXT NOT NULL,
  token_symbol TEXT,
  
  -- Action details
  action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'large_buy', 'large_sell')),
  amount NUMERIC NOT NULL,
  price_usd NUMERIC,
  value_sol NUMERIC,
  value_usd NUMERIC,
  
  -- Wallet context
  wallet_score NUMERIC,
  wallet_win_rate NUMERIC,
  wallet_reputation INTEGER,
  
  -- Alert metadata
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
  channels_sent JSONB, -- Array of channels where alert was sent
  
  -- Timestamps
  alerted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_copy_alerts_wallet ON copy_trading_alerts(wallet_address);
CREATE INDEX idx_copy_alerts_token ON copy_trading_alerts(token_mint);
CREATE INDEX idx_copy_alerts_action ON copy_trading_alerts(action);
CREATE INDEX idx_copy_alerts_priority ON copy_trading_alerts(priority);
CREATE INDEX idx_copy_alerts_alerted_at ON copy_trading_alerts(alerted_at DESC);

-- ============================================
-- Helper Functions
-- ============================================

-- Function to update wallet performance after transaction
CREATE OR REPLACE FUNCTION update_wallet_performance()
RETURNS TRIGGER AS $$
BEGIN
  -- Update last_checked_at on tracked_wallets
  UPDATE tracked_wallets
  SET last_checked_at = NEW.block_time,
      updated_at = NOW()
  WHERE wallet_address = NEW.wallet_address;
  
  -- Note: Full performance recalculation is done in application layer
  -- This trigger just updates the last checked timestamp
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update wallet tracking
CREATE TRIGGER trigger_update_wallet_performance
AFTER INSERT ON wallet_transactions
FOR EACH ROW
EXECUTE FUNCTION update_wallet_performance();

-- Function to auto-approve high-score discovered wallets
CREATE OR REPLACE FUNCTION auto_approve_discovered_wallets()
RETURNS TRIGGER AS $$
BEGIN
  -- If initial score is very high, auto-approve and track
  IF NEW.initial_score >= 80 AND NEW.estimated_win_rate >= 70 THEN
    -- Add to tracked_wallets
    INSERT INTO tracked_wallets (
      wallet_address,
      label,
      source,
      score,
      win_rate,
      added_at
    ) VALUES (
      NEW.wallet_address,
      'Auto-discovered (Score: ' || NEW.initial_score || ')',
      'auto_discovered',
      NEW.initial_score,
      NEW.estimated_win_rate,
      NOW()
    )
    ON CONFLICT (wallet_address) DO NOTHING;
    
    -- Update discovery status
    NEW.status = 'tracked';
    NEW.analyzed_at = NOW();
    NEW.decision_at = NOW();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-approval
CREATE TRIGGER trigger_auto_approve_wallets
BEFORE INSERT ON wallet_discovery_queue
FOR EACH ROW
EXECUTE FUNCTION auto_approve_discovered_wallets();

-- ============================================
-- Sample Data / Comments
-- ============================================

COMMENT ON TABLE tracked_wallets IS 'User-tracked wallets for copy trading alerts';
COMMENT ON TABLE wallet_transactions IS 'All detected transactions from tracked wallets';
COMMENT ON TABLE wallet_performance IS 'Aggregated performance metrics for tracked wallets';
COMMENT ON TABLE wallet_discovery_queue IS 'Queue for auto-discovered profitable wallets';
COMMENT ON TABLE copy_trading_alerts IS 'History of all copy trading alerts sent';
