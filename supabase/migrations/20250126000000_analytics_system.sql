-- ============================================
-- Analytics System Tables
-- For learning what works and what doesn't
-- ============================================

-- ============================================
-- Analytics Cache Table
-- Pre-computed analytics for faster queries
-- ============================================
CREATE TABLE IF NOT EXISTS analytics_cache (
  id SERIAL PRIMARY KEY,
  cache_key TEXT UNIQUE NOT NULL,
  cache_type TEXT NOT NULL,  -- 'pattern_perf', 'time_stats', 'lifecycle', 'risk_validation'
  cache_data JSONB NOT NULL,
  sample_size INTEGER DEFAULT 0,
  confidence REAL DEFAULT 0,
  computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_analytics_cache_key ON analytics_cache(cache_key);
CREATE INDEX idx_analytics_cache_type ON analytics_cache(cache_type);
CREATE INDEX idx_analytics_cache_expires ON analytics_cache(expires_at);

-- ============================================
-- Performance Snapshots Table
-- Daily/weekly summary of overall performance
-- ============================================
CREATE TABLE IF NOT EXISTS performance_snapshots (
  id SERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL UNIQUE,
  snapshot_type TEXT NOT NULL CHECK(snapshot_type IN ('daily', 'weekly', 'monthly')),
  
  -- Overall metrics
  total_tokens_analyzed INTEGER DEFAULT 0,
  total_signals_generated INTEGER DEFAULT 0,
  total_patterns_matched INTEGER DEFAULT 0,
  
  -- Performance
  overall_win_rate REAL DEFAULT 0,
  avg_return_percent REAL DEFAULT 0,
  total_profit_loss REAL DEFAULT 0,
  
  -- Pattern performance
  top_pattern TEXT,
  top_pattern_win_rate REAL DEFAULT 0,
  
  -- Time insights
  best_entry_hour INTEGER,
  best_entry_hour_win_rate REAL DEFAULT 0,
  
  -- Risk metrics
  risk_score_accuracy REAL DEFAULT 0,
  false_positive_rate REAL DEFAULT 0,
  false_negative_rate REAL DEFAULT 0,
  
  -- Sample sizes
  tokens_with_outcomes INTEGER DEFAULT 0,
  successful_outcomes INTEGER DEFAULT 0,
  failed_outcomes INTEGER DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_perf_snapshots_date ON performance_snapshots(snapshot_date DESC);
CREATE INDEX idx_perf_snapshots_type ON performance_snapshots(snapshot_type);

-- ============================================
-- Pattern Performance History
-- Track pattern performance over time
-- ============================================
CREATE TABLE IF NOT EXISTS pattern_performance_history (
  id SERIAL PRIMARY KEY,
  pattern_id INTEGER REFERENCES success_patterns(id) ON DELETE CASCADE,
  pattern_name TEXT NOT NULL,
  
  -- Metrics
  win_rate REAL DEFAULT 0,
  accuracy REAL DEFAULT 0,
  precision_score REAL DEFAULT 0,
  recall_score REAL DEFAULT 0,
  f1_score REAL DEFAULT 0,
  
  -- Performance
  avg_return REAL DEFAULT 0,
  median_return REAL DEFAULT 0,
  
  -- Sample
  total_matches INTEGER DEFAULT 0,
  successful_matches INTEGER DEFAULT 0,
  
  -- Timestamp
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_pattern_perf_hist_pattern ON pattern_performance_history(pattern_id);
CREATE INDEX idx_pattern_perf_hist_time ON pattern_performance_history(recorded_at DESC);

-- ============================================
-- Time-Based Performance History
-- Track performance by time of day/week
-- ============================================
CREATE TABLE IF NOT EXISTS time_performance_history (
  id SERIAL PRIMARY KEY,
  hour_of_day INTEGER CHECK(hour_of_day >= 0 AND hour_of_day < 24),
  day_of_week INTEGER CHECK(day_of_week >= 0 AND day_of_week < 7),
  
  -- Metrics
  total_trades INTEGER DEFAULT 0,
  successful_trades INTEGER DEFAULT 0,
  win_rate REAL DEFAULT 0,
  avg_return REAL DEFAULT 0,
  
  -- Timestamp
  week_start DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(hour_of_day, day_of_week, week_start)
);

CREATE INDEX idx_time_perf_hist_week ON time_performance_history(week_start DESC);

-- ============================================
-- Feature Importance History
-- Track which features matter most over time
-- ============================================
CREATE TABLE IF NOT EXISTS feature_importance_history (
  id SERIAL PRIMARY KEY,
  feature_name TEXT NOT NULL,
  importance_score REAL DEFAULT 0,
  correlation REAL DEFAULT 0,
  sample_size INTEGER DEFAULT 0,
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_feature_imp_hist_feature ON feature_importance_history(feature_name);
CREATE INDEX idx_feature_imp_hist_time ON feature_importance_history(recorded_at DESC);

-- ============================================
-- Analytics Jobs Log
-- Track when analytics computations run
-- ============================================
CREATE TABLE IF NOT EXISTS analytics_jobs_log (
  id SERIAL PRIMARY KEY,
  job_type TEXT NOT NULL,  -- 'pattern_update', 'time_analysis', 'risk_validation', 'cache_refresh'
  status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failed')),
  records_processed INTEGER DEFAULT 0,
  execution_time_ms INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_analytics_jobs_type ON analytics_jobs_log(job_type);
CREATE INDEX idx_analytics_jobs_status ON analytics_jobs_log(status);
CREATE INDEX idx_analytics_jobs_time ON analytics_jobs_log(started_at DESC);

-- ============================================
-- Views for Common Analytics Queries
-- ============================================

-- Pattern performance view with latest metrics
CREATE OR REPLACE VIEW v_pattern_performance AS
SELECT 
  sp.id,
  sp.pattern_name,
  sp.pattern_type,
  sp.success_rate,
  sp.average_peak_multiplier,
  sp.occurrence_count,
  sp.confidence_score,
  COUNT(tpm.id) as recent_matches,
  COUNT(CASE WHEN tpm.actual_outcome IN ('success', 'moon') THEN 1 END) as recent_successes,
  CASE 
    WHEN COUNT(tpm.id) > 0 
    THEN (COUNT(CASE WHEN tpm.actual_outcome IN ('success', 'moon') THEN 1 END)::REAL / COUNT(tpm.id)::REAL) * 100 
    ELSE 0 
  END as recent_win_rate
FROM success_patterns sp
LEFT JOIN token_pattern_matches tpm ON sp.id = tpm.pattern_id
  AND tpm.matched_at > EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days')
WHERE sp.is_active = 1
GROUP BY sp.id, sp.pattern_name, sp.pattern_type, sp.success_rate, 
  sp.average_peak_multiplier, sp.occurrence_count, sp.confidence_score;

-- Hourly performance view
CREATE OR REPLACE VIEW v_hourly_performance AS
SELECT 
  EXTRACT(HOUR FROM TO_TIMESTAMP(to2.discovered_at)) as hour,
  COUNT(*) as total_tokens,
  COUNT(CASE WHEN to2.outcome_type IN ('moon', 'pump') THEN 1 END) as successful_tokens,
  CASE 
    WHEN COUNT(*) > 0 
    THEN (COUNT(CASE WHEN to2.outcome_type IN ('moon', 'pump') THEN 1 END)::REAL / COUNT(*)::REAL) * 100 
    ELSE 0 
  END as win_rate,
  AVG(to2.price_change_24h) as avg_return
FROM token_outcomes_v2 to2
WHERE to2.outcome_type IS NOT NULL
  AND to2.discovered_at > EXTRACT(EPOCH FROM NOW() - INTERVAL '30 days')
GROUP BY hour
ORDER BY hour;

-- Daily performance view
CREATE OR REPLACE VIEW v_daily_performance AS
SELECT 
  EXTRACT(DOW FROM TO_TIMESTAMP(to2.discovered_at)) as day_of_week,
  COUNT(*) as total_tokens,
  COUNT(CASE WHEN to2.outcome_type IN ('moon', 'pump') THEN 1 END) as successful_tokens,
  CASE 
    WHEN COUNT(*) > 0 
    THEN (COUNT(CASE WHEN to2.outcome_type IN ('moon', 'pump') THEN 1 END)::REAL / COUNT(*)::REAL) * 100 
    ELSE 0 
  END as win_rate,
  AVG(to2.price_change_24h) as avg_return
FROM token_outcomes_v2 to2
WHERE to2.outcome_type IS NOT NULL
  AND to2.discovered_at > EXTRACT(EPOCH FROM NOW() - INTERVAL '30 days')
GROUP BY day_of_week
ORDER BY day_of_week;

-- ============================================
-- Functions for Analytics
-- ============================================

-- Function to refresh pattern performance cache
CREATE OR REPLACE FUNCTION refresh_pattern_performance_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM analytics_cache WHERE cache_type = 'pattern_perf' AND expires_at < NOW();
  
  INSERT INTO analytics_cache (cache_key, cache_type, cache_data, sample_size, expires_at)
  SELECT 
    'pattern_perf_' || sp.id,
    'pattern_perf',
    jsonb_build_object(
      'pattern_name', sp.pattern_name,
      'pattern_type', sp.pattern_type,
      'win_rate', vpp.recent_win_rate,
      'total_matches', vpp.recent_matches,
      'confidence', sp.confidence_score
    ),
    vpp.recent_matches,
    NOW() + INTERVAL '1 hour'
  FROM success_patterns sp
  JOIN v_pattern_performance vpp ON sp.id = vpp.id
  ON CONFLICT (cache_key) 
  DO UPDATE SET 
    cache_data = EXCLUDED.cache_data,
    sample_size = EXCLUDED.sample_size,
    computed_at = NOW(),
    expires_at = EXCLUDED.expires_at;
END;
$$ LANGUAGE plpgsql;

-- Function to create daily performance snapshot
CREATE OR REPLACE FUNCTION create_daily_performance_snapshot()
RETURNS void AS $$
DECLARE
  v_date DATE := CURRENT_DATE - INTERVAL '1 day';
  v_total_tokens INTEGER;
  v_successful_tokens INTEGER;
  v_win_rate REAL;
BEGIN
  -- Calculate metrics for yesterday
  SELECT 
    COUNT(*),
    COUNT(CASE WHEN outcome_type IN ('moon', 'pump') THEN 1 END),
    CASE 
      WHEN COUNT(*) > 0 
      THEN (COUNT(CASE WHEN outcome_type IN ('moon', 'pump') THEN 1 END)::REAL / COUNT(*)::REAL) * 100 
      ELSE 0 
    END
  INTO v_total_tokens, v_successful_tokens, v_win_rate
  FROM token_outcomes_v2
  WHERE TO_TIMESTAMP(discovered_at)::DATE = v_date
    AND outcome_type IS NOT NULL;

  -- Insert snapshot
  INSERT INTO performance_snapshots (
    snapshot_date,
    snapshot_type,
    total_tokens_analyzed,
    overall_win_rate,
    tokens_with_outcomes,
    successful_outcomes,
    failed_outcomes
  ) VALUES (
    v_date,
    'daily',
    v_total_tokens,
    v_win_rate,
    v_total_tokens,
    v_successful_tokens,
    v_total_tokens - v_successful_tokens
  )
  ON CONFLICT (snapshot_date) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Triggers
-- ============================================

-- Auto-invalidate cache when pattern is updated
CREATE OR REPLACE FUNCTION invalidate_pattern_cache()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM analytics_cache 
  WHERE cache_key = 'pattern_perf_' || NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invalidate_pattern_cache
AFTER UPDATE ON success_patterns
FOR EACH ROW
EXECUTE FUNCTION invalidate_pattern_cache();

-- Log analytics job execution
COMMENT ON TABLE analytics_jobs_log IS 'Tracks execution of analytics computation jobs';
COMMENT ON TABLE analytics_cache IS 'Pre-computed analytics metrics for performance';
COMMENT ON TABLE performance_snapshots IS 'Daily/weekly/monthly performance summaries';
