-- Helper Functions for Database Operations

-- ============================================
-- Increment snapshot count for a token
-- ============================================
CREATE OR REPLACE FUNCTION increment_snapshot_count(mint_param TEXT)
RETURNS INTEGER AS $$
DECLARE
  new_count INTEGER;
BEGIN
  UPDATE snapshot_watch_list
  SET snapshot_count = snapshot_count + 1
  WHERE mint = mint_param
  RETURNING snapshot_count INTO new_count;
  
  RETURN new_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Clean up old snapshots (run periodically)
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_old_snapshots(days_to_keep INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM token_snapshots
  WHERE recorded_at < NOW() - (days_to_keep || ' days')::INTERVAL;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Clean up old price history (run periodically)
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_old_price_history(days_to_keep INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM watchlist_price_history
  WHERE recorded_at < NOW() - (days_to_keep || ' days')::INTERVAL;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Clean up old pool discoveries (run periodically)
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_old_pool_discoveries(days_to_keep INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM pool_discovery
  WHERE discovered_at < NOW() - (days_to_keep || ' days')::INTERVAL;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Get token count by outcome
-- ============================================
CREATE OR REPLACE FUNCTION get_outcome_stats()
RETURNS TABLE(outcome TEXT, count BIGINT, avg_peak_multiplier NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT
    to.outcome,
    COUNT(*) as count,
    AVG(to.peak_price_multiplier) as avg_peak_multiplier
  FROM token_outcomes to
  WHERE to.outcome IS NOT NULL
  GROUP BY to.outcome
  ORDER BY count DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Update portfolio snapshot (called periodically)
-- ============================================
CREATE OR REPLACE FUNCTION update_portfolio_snapshot()
RETURNS VOID AS $$
DECLARE
  total_val NUMERIC;
  total_inv NUMERIC;
  unrealized NUMERIC;
  realized NUMERIC;
  open_pos INTEGER;
BEGIN
  -- Calculate total unrealized PnL from open positions
  SELECT COALESCE(SUM(unrealized_pnl), 0), COALESCE(SUM(entry_value), 0), COUNT(*)
  INTO unrealized, total_inv, open_pos
  FROM positions
  WHERE status = 'open';
  
  -- Calculate total realized PnL from closed trades
  SELECT COALESCE(SUM(realized_pnl), 0)
  INTO realized
  FROM trades
  WHERE action IN ('close', 'partial_close');
  
  total_val := total_inv + unrealized;
  
  -- Insert snapshot
  INSERT INTO portfolio_snapshots (
    timestamp, total_value, total_invested, unrealized_pnl,
    realized_pnl, total_pnl, open_positions
  ) VALUES (
    NOW(), total_val, total_inv, unrealized, realized,
    unrealized + realized, open_pos
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Get leaderboard for a chat
-- ============================================
CREATE OR REPLACE FUNCTION get_chat_leaderboard(
  chat_id_param TEXT,
  limit_param INTEGER DEFAULT 10
)
RETURNS TABLE(
  username TEXT,
  total_discoveries BIGINT,
  total_score NUMERIC,
  best_multiplier NUMERIC,
  win_rate NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    le.username,
    COUNT(*) as total_discoveries,
    SUM(le.score) as total_score,
    MAX(le.peak_multiplier) as best_multiplier,
    (COUNT(CASE WHEN le.outcome IN ('moon', 'profit') THEN 1 END)::NUMERIC / COUNT(*)::NUMERIC * 100) as win_rate
  FROM leaderboard_entries le
  WHERE le.chat_id = chat_id_param
  GROUP BY le.username
  ORDER BY total_score DESC
  LIMIT limit_param;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Update smart money wallet stats
-- ============================================
CREATE OR REPLACE FUNCTION update_smart_money_stats(wallet_addr TEXT)
RETURNS VOID AS $$
DECLARE
  total INTEGER;
  winning INTEGER;
  losing INTEGER;
  win_pct NUMERIC;
  total_profit NUMERIC;
  avg_profit NUMERIC;
  last_trade TIMESTAMPTZ;
BEGIN
  -- Count trades
  SELECT COUNT(*), COUNT(CASE WHEN profit_percent > 0 THEN 1 END), COUNT(CASE WHEN profit_percent < 0 THEN 1 END)
  INTO total, winning, losing
  FROM smart_money_trades
  WHERE wallet_address = wallet_addr AND status = 'closed';
  
  -- Calculate win rate
  IF total > 0 THEN
    win_pct := (winning::NUMERIC / total::NUMERIC);
  ELSE
    win_pct := 0;
  END IF;
  
  -- Calculate total profit
  SELECT COALESCE(SUM(profit_percent), 0), COALESCE(AVG(profit_percent), 0)
  INTO total_profit, avg_profit
  FROM smart_money_trades
  WHERE wallet_address = wallet_addr AND status = 'closed';
  
  -- Get last trade time
  SELECT MAX(entry_time)
  INTO last_trade
  FROM smart_money_trades
  WHERE wallet_address = wallet_addr;
  
  -- Update wallet stats
  UPDATE smart_money_wallets
  SET
    total_trades = total,
    winning_trades = winning,
    losing_trades = losing,
    win_rate = win_pct,
    total_profit_sol = total_profit,
    average_profit_percent = avg_profit,
    last_trade_at = last_trade,
    last_updated_at = NOW()
  WHERE wallet_address = wallet_addr;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Grant execute permissions to authenticated and service role
-- ============================================
GRANT EXECUTE ON FUNCTION increment_snapshot_count TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION cleanup_old_snapshots TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION cleanup_old_price_history TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION cleanup_old_pool_discoveries TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION get_outcome_stats TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION update_portfolio_snapshot TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION get_chat_leaderboard TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION update_smart_money_stats TO authenticated, anon, service_role;
