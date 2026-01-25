-- Portfolio Management System
-- Comprehensive position tracking, P&L, and performance analytics
-- Timestamp: 2025-01-28

-- ============================================
-- Portfolio Positions (Current Holdings)
-- ============================================
CREATE TABLE IF NOT EXISTS portfolio_positions (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT DEFAULT 'default',  -- Support multiple users in future
  token_mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  
  -- Position details
  side TEXT CHECK(side IN ('long', 'short')) DEFAULT 'long',
  status TEXT CHECK(status IN ('open', 'closed')) DEFAULT 'open',
  
  -- Entry information
  entry_price NUMERIC NOT NULL,
  entry_amount NUMERIC NOT NULL,  -- Token quantity
  entry_value NUMERIC NOT NULL,   -- USD value at entry
  entry_timestamp TIMESTAMPTZ NOT NULL,
  
  -- Current information
  current_price NUMERIC NOT NULL,
  current_amount NUMERIC NOT NULL,  -- Can change with partial exits
  current_value NUMERIC NOT NULL,
  
  -- Accumulated values (for averaging)
  total_bought NUMERIC DEFAULT 0,
  total_sold NUMERIC DEFAULT 0,
  avg_entry_price NUMERIC NOT NULL,  -- Weighted average
  
  -- P&L
  unrealized_pnl NUMERIC DEFAULT 0,
  unrealized_pnl_percent NUMERIC DEFAULT 0,
  realized_pnl NUMERIC DEFAULT 0,
  
  -- Cost basis method
  cost_basis_method TEXT CHECK(cost_basis_method IN ('FIFO', 'LIFO', 'AVERAGE')) DEFAULT 'FIFO',
  
  -- Metadata
  notes TEXT,
  tags JSONB,  -- Custom tags for categorization
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT unique_user_token UNIQUE(user_id, token_mint, status)
);

CREATE INDEX idx_portfolio_positions_user ON portfolio_positions(user_id);
CREATE INDEX idx_portfolio_positions_status ON portfolio_positions(status);
CREATE INDEX idx_portfolio_positions_token ON portfolio_positions(token_mint);
CREATE INDEX idx_portfolio_positions_created ON portfolio_positions(created_at DESC);

-- ============================================
-- Portfolio Trades (All Buy/Sell Transactions)
-- ============================================
CREATE TABLE IF NOT EXISTS portfolio_trades (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT DEFAULT 'default',
  position_id BIGINT REFERENCES portfolio_positions(id) ON DELETE SET NULL,
  
  -- Token info
  token_mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  
  -- Trade details
  side TEXT CHECK(side IN ('long', 'short')) DEFAULT 'long',
  action TEXT CHECK(action IN ('buy', 'sell', 'partial_sell')) NOT NULL,
  
  -- Prices and amounts
  price NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,  -- Token quantity
  value NUMERIC NOT NULL,   -- USD value
  
  -- For sells - track realized P&L
  cost_basis NUMERIC,  -- Cost basis of sold tokens (using selected method)
  realized_pnl NUMERIC,
  realized_pnl_percent NUMERIC,
  
  -- Fees
  fee_amount NUMERIC DEFAULT 0,
  fee_currency TEXT DEFAULT 'USD',
  
  -- Tax info
  holding_period_days INTEGER,  -- Days held (for tax purposes)
  is_short_term BOOLEAN,  -- < 365 days
  
  -- Transaction details
  tx_signature TEXT,  -- On-chain signature
  wallet_address TEXT,
  
  -- Metadata
  notes TEXT,
  source TEXT,  -- 'manual', 'auto', 'wallet_sync'
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT idx_portfolio_trades_unique UNIQUE(user_id, tx_signature, token_mint)
);

CREATE INDEX idx_portfolio_trades_user ON portfolio_trades(user_id);
CREATE INDEX idx_portfolio_trades_position ON portfolio_trades(position_id);
CREATE INDEX idx_portfolio_trades_token ON portfolio_trades(token_mint);
CREATE INDEX idx_portfolio_trades_action ON portfolio_trades(action);
CREATE INDEX idx_portfolio_trades_timestamp ON portfolio_trades(timestamp DESC);
CREATE INDEX idx_portfolio_trades_tax ON portfolio_trades(is_short_term, timestamp);

-- ============================================
-- Portfolio Snapshots (Daily Portfolio Value)
-- ============================================
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT DEFAULT 'default',
  
  -- Portfolio values
  total_value NUMERIC NOT NULL,
  total_invested NUMERIC NOT NULL,
  total_pnl NUMERIC NOT NULL,
  total_pnl_percent NUMERIC NOT NULL,
  
  -- Breakdown
  unrealized_pnl NUMERIC DEFAULT 0,
  realized_pnl NUMERIC DEFAULT 0,
  
  -- Position counts
  open_positions INTEGER DEFAULT 0,
  total_positions INTEGER DEFAULT 0,
  
  -- Performance
  daily_change NUMERIC,
  daily_change_percent NUMERIC,
  
  -- Snapshot time
  snapshot_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT unique_user_snapshot UNIQUE(user_id, snapshot_date)
);

CREATE INDEX idx_portfolio_snapshots_user ON portfolio_snapshots(user_id);
CREATE INDEX idx_portfolio_snapshots_date ON portfolio_snapshots(snapshot_date DESC);

-- ============================================
-- Portfolio Performance (Performance Metrics)
-- ============================================
CREATE TABLE IF NOT EXISTS portfolio_performance (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT DEFAULT 'default',
  
  -- Time period
  period TEXT CHECK(period IN ('daily', 'weekly', 'monthly', 'all_time')) NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  
  -- P&L metrics
  realized_pnl NUMERIC DEFAULT 0,
  unrealized_pnl NUMERIC DEFAULT 0,
  total_pnl NUMERIC DEFAULT 0,
  roi_percent NUMERIC DEFAULT 0,
  
  -- Trade metrics
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  win_rate NUMERIC DEFAULT 0,
  
  -- Win/Loss analysis
  avg_win NUMERIC DEFAULT 0,
  avg_loss NUMERIC DEFAULT 0,
  largest_win NUMERIC DEFAULT 0,
  largest_loss NUMERIC DEFAULT 0,
  profit_factor NUMERIC DEFAULT 0,  -- Gross profit / Gross loss
  
  -- Advanced metrics
  sharpe_ratio NUMERIC,  -- Risk-adjusted returns
  max_drawdown NUMERIC,
  max_drawdown_percent NUMERIC,
  
  -- Streak tracking
  current_streak INTEGER DEFAULT 0,  -- Current win/loss streak
  best_streak INTEGER DEFAULT 0,     -- Best winning streak
  worst_streak INTEGER DEFAULT 0,    -- Worst losing streak
  
  -- Holding times
  avg_holding_time_hours NUMERIC,
  median_holding_time_hours NUMERIC,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT unique_user_period UNIQUE(user_id, period, period_start)
);

CREATE INDEX idx_portfolio_performance_user ON portfolio_performance(user_id);
CREATE INDEX idx_portfolio_performance_period ON portfolio_performance(period, period_end DESC);

-- ============================================
-- Tax Reporting Data
-- ============================================
CREATE TABLE IF NOT EXISTS portfolio_tax_lots (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT DEFAULT 'default',
  position_id BIGINT REFERENCES portfolio_positions(id) ON DELETE CASCADE,
  
  -- Token info
  token_mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  
  -- Lot details (for FIFO/LIFO tracking)
  purchase_date TIMESTAMPTZ NOT NULL,
  purchase_price NUMERIC NOT NULL,
  purchase_amount NUMERIC NOT NULL,
  purchase_value NUMERIC NOT NULL,
  
  -- Remaining amount (after partial sales)
  remaining_amount NUMERIC NOT NULL,
  
  -- Sale tracking
  sale_date TIMESTAMPTZ,
  sale_price NUMERIC,
  sale_amount NUMERIC,
  sale_value NUMERIC,
  
  -- Tax calculations
  cost_basis NUMERIC NOT NULL,
  realized_gain_loss NUMERIC,
  holding_period_days INTEGER,
  is_short_term BOOLEAN,
  
  status TEXT CHECK(status IN ('open', 'partial', 'closed')) DEFAULT 'open',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tax_lots_user ON portfolio_tax_lots(user_id);
CREATE INDEX idx_tax_lots_position ON portfolio_tax_lots(position_id);
CREATE INDEX idx_tax_lots_token ON portfolio_tax_lots(token_mint);
CREATE INDEX idx_tax_lots_purchase ON portfolio_tax_lots(purchase_date);
CREATE INDEX idx_tax_lots_sale ON portfolio_tax_lots(sale_date);

-- ============================================
-- Price Alerts (Target/Stop-Loss)
-- ============================================
CREATE TABLE IF NOT EXISTS portfolio_price_alerts (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT DEFAULT 'default',
  position_id BIGINT REFERENCES portfolio_positions(id) ON DELETE CASCADE,
  
  token_mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  
  -- Alert config
  alert_type TEXT CHECK(alert_type IN ('target', 'stop_loss', 'trailing_stop')) NOT NULL,
  trigger_price NUMERIC NOT NULL,
  
  -- Trailing stop specific
  trailing_percent NUMERIC,  -- For trailing stops
  highest_price NUMERIC,     -- Track highest price for trailing
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  triggered_at TIMESTAMPTZ,
  triggered_price NUMERIC,
  
  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_price_alerts_user ON portfolio_price_alerts(user_id);
CREATE INDEX idx_price_alerts_position ON portfolio_price_alerts(position_id);
CREATE INDEX idx_price_alerts_token ON portfolio_price_alerts(token_mint);
CREATE INDEX idx_price_alerts_active ON portfolio_price_alerts(is_active);

-- ============================================
-- Helper Functions
-- ============================================

-- Function to calculate unrealized P&L
CREATE OR REPLACE FUNCTION calculate_unrealized_pnl(
  p_current_price NUMERIC,
  p_avg_entry_price NUMERIC,
  p_current_amount NUMERIC
) RETURNS TABLE(
  unrealized_pnl NUMERIC,
  unrealized_pnl_percent NUMERIC
) AS $$
BEGIN
  RETURN QUERY SELECT
    (p_current_price - p_avg_entry_price) * p_current_amount AS unrealized_pnl,
    CASE 
      WHEN p_avg_entry_price > 0 THEN
        ((p_current_price - p_avg_entry_price) / p_avg_entry_price * 100)
      ELSE 0
    END AS unrealized_pnl_percent;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to update position prices
CREATE OR REPLACE FUNCTION update_position_price(
  p_position_id BIGINT,
  p_new_price NUMERIC
) RETURNS VOID AS $$
DECLARE
  v_current_amount NUMERIC;
  v_avg_entry_price NUMERIC;
  v_new_value NUMERIC;
  v_pnl_result RECORD;
BEGIN
  -- Get current position data
  SELECT current_amount, avg_entry_price
  INTO v_current_amount, v_avg_entry_price
  FROM portfolio_positions
  WHERE id = p_position_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Position % not found', p_position_id;
  END IF;
  
  -- Calculate new values
  v_new_value := p_new_price * v_current_amount;
  
  -- Calculate P&L
  SELECT * INTO v_pnl_result
  FROM calculate_unrealized_pnl(p_new_price, v_avg_entry_price, v_current_amount);
  
  -- Update position
  UPDATE portfolio_positions
  SET 
    current_price = p_new_price,
    current_value = v_new_value,
    unrealized_pnl = v_pnl_result.unrealized_pnl,
    unrealized_pnl_percent = v_pnl_result.unrealized_pnl_percent,
    last_updated = NOW()
  WHERE id = p_position_id;
END;
$$ LANGUAGE plpgsql;

-- Function to create daily snapshot
CREATE OR REPLACE FUNCTION create_portfolio_snapshot(p_user_id TEXT DEFAULT 'default')
RETURNS VOID AS $$
DECLARE
  v_total_value NUMERIC;
  v_total_invested NUMERIC;
  v_unrealized_pnl NUMERIC;
  v_realized_pnl NUMERIC;
  v_open_count INTEGER;
  v_total_count INTEGER;
  v_prev_value NUMERIC;
BEGIN
  -- Calculate current values
  SELECT 
    COALESCE(SUM(current_value), 0),
    COALESCE(SUM(entry_value), 0),
    COALESCE(SUM(unrealized_pnl), 0)
  INTO v_total_value, v_total_invested, v_unrealized_pnl
  FROM portfolio_positions
  WHERE user_id = p_user_id AND status = 'open';
  
  -- Get realized P&L
  SELECT COALESCE(SUM(realized_pnl), 0)
  INTO v_realized_pnl
  FROM portfolio_trades
  WHERE user_id = p_user_id AND action IN ('sell', 'partial_sell');
  
  -- Get position counts
  SELECT 
    COUNT(*) FILTER (WHERE status = 'open'),
    COUNT(*)
  INTO v_open_count, v_total_count
  FROM portfolio_positions
  WHERE user_id = p_user_id;
  
  -- Get previous day value
  SELECT total_value INTO v_prev_value
  FROM portfolio_snapshots
  WHERE user_id = p_user_id
  ORDER BY snapshot_date DESC
  LIMIT 1;
  
  -- Insert snapshot
  INSERT INTO portfolio_snapshots (
    user_id, total_value, total_invested, total_pnl, total_pnl_percent,
    unrealized_pnl, realized_pnl, open_positions, total_positions,
    daily_change, daily_change_percent, snapshot_date
  ) VALUES (
    p_user_id,
    v_total_value,
    v_total_invested,
    v_unrealized_pnl + v_realized_pnl,
    CASE WHEN v_total_invested > 0 THEN
      ((v_unrealized_pnl + v_realized_pnl) / v_total_invested * 100)
    ELSE 0 END,
    v_unrealized_pnl,
    v_realized_pnl,
    v_open_count,
    v_total_count,
    v_total_value - COALESCE(v_prev_value, v_total_value),
    CASE WHEN v_prev_value > 0 THEN
      ((v_total_value - v_prev_value) / v_prev_value * 100)
    ELSE 0 END,
    CURRENT_DATE
  )
  ON CONFLICT (user_id, snapshot_date)
  DO UPDATE SET
    total_value = EXCLUDED.total_value,
    total_invested = EXCLUDED.total_invested,
    total_pnl = EXCLUDED.total_pnl,
    total_pnl_percent = EXCLUDED.total_pnl_percent,
    unrealized_pnl = EXCLUDED.unrealized_pnl,
    realized_pnl = EXCLUDED.realized_pnl,
    open_positions = EXCLUDED.open_positions,
    total_positions = EXCLUDED.total_positions,
    daily_change = EXCLUDED.daily_change,
    daily_change_percent = EXCLUDED.daily_change_percent;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_tax_lots_updated_at
  BEFORE UPDATE ON portfolio_tax_lots
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_price_alerts_updated_at
  BEFORE UPDATE ON portfolio_price_alerts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE portfolio_positions IS 'Current and historical positions with P&L tracking';
COMMENT ON TABLE portfolio_trades IS 'All buy/sell transactions with realized P&L';
COMMENT ON TABLE portfolio_snapshots IS 'Daily portfolio value snapshots for performance tracking';
COMMENT ON TABLE portfolio_performance IS 'Calculated performance metrics by time period';
COMMENT ON TABLE portfolio_tax_lots IS 'Tax lot tracking for FIFO/LIFO cost basis';
COMMENT ON TABLE portfolio_price_alerts IS 'Price alerts for target/stop-loss notifications';
