-- ML Advanced System Database Schema
-- Tables for predictions, training data, models, and performance tracking

-- ML Predictions table - stores all predictions made by models
CREATE TABLE IF NOT EXISTS ml_predictions (
  id SERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL,
  model_type TEXT NOT NULL, -- 'price_prediction', 'sentiment_correlation', 'whale_behavior', 'rug_prediction'
  model_version TEXT NOT NULL,
  timeframe TEXT, -- For price prediction: '1h', '6h', '24h'
  
  -- Prediction details
  predicted_direction TEXT, -- 'up', 'down', 'sideways', 'bullish', 'bearish', etc.
  confidence REAL NOT NULL,
  expected_change REAL, -- Expected % price change
  
  -- Structured prediction data (JSON)
  probabilities JSONB, -- Distribution of probabilities
  metadata JSONB, -- Model-specific metadata
  
  -- Outcome tracking
  actual_outcome TEXT,
  actual_change REAL,
  was_correct BOOLEAN,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  outcome_measured_at TIMESTAMP WITH TIME ZONE,
  
  -- Indexes
  INDEX idx_ml_predictions_token (token_mint),
  INDEX idx_ml_predictions_model (model_type, model_version),
  INDEX idx_ml_predictions_created (created_at DESC),
  INDEX idx_ml_predictions_outcome (was_correct, model_type)
);

-- ML Training Data table - historical token data with known outcomes
CREATE TABLE IF NOT EXISTS ml_training_data (
  id SERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL,
  
  -- Core features (9 original)
  liquidity_usd REAL,
  risk_score INTEGER,
  total_holders INTEGER,
  top10_percent REAL,
  mint_revoked BOOLEAN,
  freeze_revoked BOOLEAN,
  lp_burned_percent REAL,
  has_twitter BOOLEAN,
  has_telegram BOOLEAN,
  has_website BOOLEAN,
  token_age_hours REAL,
  
  -- Enhanced features (19 additional)
  price_change_5m REAL,
  price_change_1h REAL,
  price_change_6h REAL,
  price_change_24h REAL,
  volume_change_1h REAL,
  volume_change_24h REAL,
  buy_pressure_1h REAL,
  
  smart_money_net_buys INTEGER,
  smart_money_holding REAL,
  is_smart_money_bullish BOOLEAN,
  
  price_velocity REAL,
  volume_acceleration REAL,
  liquidity_trend REAL,
  holder_trend REAL,
  
  has_volume_spike BOOLEAN,
  is_pumping BOOLEAN,
  is_dumping BOOLEAN,
  
  sentiment_score REAL,
  sentiment_confidence REAL,
  has_sentiment_data BOOLEAN,
  
  -- All features as JSON (for flexibility)
  features_json JSONB,
  
  -- Outcomes
  outcome TEXT, -- 'rug', 'pump', 'dump', 'moon', 'dead'
  price_change_1h_outcome REAL,
  price_change_6h_outcome REAL,
  price_change_24h_outcome REAL,
  whale_action TEXT, -- 'accumulation', 'distribution', 'dump', 'holding'
  has_outcome BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  outcome_measured_at TIMESTAMP WITH TIME ZONE,
  
  -- Indexes
  INDEX idx_ml_training_token (token_mint),
  INDEX idx_ml_training_outcome (has_outcome, outcome),
  INDEX idx_ml_training_analyzed (analyzed_at DESC)
);

-- ML Models table - track model versions and performance
CREATE TABLE IF NOT EXISTS ml_models (
  id SERIAL PRIMARY KEY,
  model_type TEXT NOT NULL,
  version TEXT NOT NULL UNIQUE,
  
  -- Training info
  training_samples INTEGER,
  training_time_seconds REAL,
  
  -- Performance metrics
  accuracy REAL,
  precision_score REAL,
  recall REAL,
  f1_score REAL,
  loss REAL,
  mae REAL, -- Mean absolute error (for regression)
  
  -- Hyperparameters
  hyperparameters JSONB,
  
  -- Full metrics breakdown
  metrics JSONB,
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  is_production BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deployed_at TIMESTAMP WITH TIME ZONE,
  retired_at TIMESTAMP WITH TIME ZONE,
  
  -- Indexes
  INDEX idx_ml_models_type (model_type, is_active),
  INDEX idx_ml_models_version (version)
);

-- ML Performance Tracking table - track prediction accuracy over time
CREATE TABLE IF NOT EXISTS ml_performance_tracking (
  id SERIAL PRIMARY KEY,
  model_type TEXT NOT NULL,
  model_version TEXT NOT NULL,
  
  -- Time window
  period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Metrics
  total_predictions INTEGER NOT NULL,
  correct_predictions INTEGER,
  accuracy REAL,
  
  -- Breakdown by direction (for classification)
  predictions_by_class JSONB,
  accuracy_by_class JSONB,
  
  -- Regression metrics (for continuous predictions)
  mae REAL,
  rmse REAL,
  r_squared REAL,
  
  -- Metadata
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Indexes
  INDEX idx_ml_performance_model (model_type, model_version),
  INDEX idx_ml_performance_period (period_start, period_end),
  INDEX idx_ml_performance_accuracy (accuracy DESC)
);

-- Create view for model performance summary
CREATE OR REPLACE VIEW ml_model_performance_summary AS
SELECT 
  m.model_type,
  m.version,
  m.accuracy as training_accuracy,
  m.created_at as trained_at,
  COUNT(p.id) as total_predictions,
  COUNT(CASE WHEN p.was_correct = TRUE THEN 1 END) as correct_predictions,
  ROUND(
    COUNT(CASE WHEN p.was_correct = TRUE THEN 1 END)::NUMERIC / 
    NULLIF(COUNT(p.id), 0) * 100,
    2
  ) as live_accuracy_percent,
  AVG(p.confidence) as avg_confidence,
  MAX(p.created_at) as last_prediction_at
FROM ml_models m
LEFT JOIN ml_predictions p ON p.model_version = m.version
WHERE m.is_active = TRUE
GROUP BY m.model_type, m.version, m.accuracy, m.created_at
ORDER BY m.created_at DESC;

-- Create view for recent predictions summary
CREATE OR REPLACE VIEW ml_recent_predictions AS
SELECT 
  p.token_mint,
  p.model_type,
  p.predicted_direction,
  p.confidence,
  p.expected_change,
  p.actual_outcome,
  p.actual_change,
  p.was_correct,
  p.created_at,
  p.outcome_measured_at,
  EXTRACT(EPOCH FROM (p.outcome_measured_at - p.created_at)) / 3600 as hours_to_outcome
FROM ml_predictions p
WHERE p.created_at > NOW() - INTERVAL '7 days'
ORDER BY p.created_at DESC
LIMIT 1000;

-- Function to update prediction outcomes
CREATE OR REPLACE FUNCTION update_prediction_outcome(
  p_prediction_id INTEGER,
  p_actual_outcome TEXT,
  p_actual_change REAL
) RETURNS VOID AS $$
DECLARE
  v_predicted_direction TEXT;
  v_expected_change REAL;
  v_model_type TEXT;
  v_was_correct BOOLEAN;
BEGIN
  -- Get prediction details
  SELECT predicted_direction, expected_change, model_type
  INTO v_predicted_direction, v_expected_change, v_model_type
  FROM ml_predictions
  WHERE id = p_prediction_id;
  
  -- Determine if prediction was correct
  v_was_correct := FALSE;
  
  IF v_model_type = 'price_prediction' THEN
    -- Check if direction was correct
    IF (v_predicted_direction = 'up' AND p_actual_change > 10) OR
       (v_predicted_direction = 'down' AND p_actual_change < -10) OR
       (v_predicted_direction = 'sideways' AND p_actual_change BETWEEN -10 AND 10) THEN
      v_was_correct := TRUE;
    END IF;
  ELSIF v_model_type = 'rug_prediction' THEN
    -- Check if rug prediction was correct
    IF (p_actual_outcome = 'rug' AND v_predicted_direction = 'avoid') OR
       (p_actual_outcome != 'rug' AND v_predicted_direction IN ('safe', 'caution')) THEN
      v_was_correct := TRUE;
    END IF;
  ELSE
    -- For other models, check outcome match
    v_was_correct := (p_actual_outcome = v_predicted_direction);
  END IF;
  
  -- Update prediction
  UPDATE ml_predictions
  SET 
    actual_outcome = p_actual_outcome,
    actual_change = p_actual_change,
    was_correct = v_was_correct,
    outcome_measured_at = NOW()
  WHERE id = p_prediction_id;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate model accuracy for a time period
CREATE OR REPLACE FUNCTION calculate_model_accuracy(
  p_model_type TEXT,
  p_model_version TEXT,
  p_hours_back INTEGER DEFAULT 24
) RETURNS TABLE(
  total_predictions INTEGER,
  correct_predictions INTEGER,
  accuracy REAL,
  avg_confidence REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::INTEGER as total_predictions,
    COUNT(CASE WHEN was_correct = TRUE THEN 1 END)::INTEGER as correct_predictions,
    (COUNT(CASE WHEN was_correct = TRUE THEN 1 END)::REAL / NULLIF(COUNT(*), 0))::REAL as accuracy,
    AVG(confidence)::REAL as avg_confidence
  FROM ml_predictions
  WHERE 
    model_type = p_model_type
    AND model_version = p_model_version
    AND was_correct IS NOT NULL
    AND created_at > NOW() - INTERVAL '1 hour' * p_hours_back;
END;
$$ LANGUAGE plpgsql;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ml_training_features ON ml_training_data USING GIN (features_json);
CREATE INDEX IF NOT EXISTS idx_ml_predictions_probabilities ON ml_predictions USING GIN (probabilities);
CREATE INDEX IF NOT EXISTS idx_ml_predictions_metadata ON ml_predictions USING GIN (metadata);

-- Comments
COMMENT ON TABLE ml_predictions IS 'Stores all ML model predictions with outcomes for tracking';
COMMENT ON TABLE ml_training_data IS 'Historical token data with features and known outcomes for model training';
COMMENT ON TABLE ml_models IS 'ML model versions with training metrics and deployment status';
COMMENT ON TABLE ml_performance_tracking IS 'Tracks prediction accuracy over time periods';
COMMENT ON VIEW ml_model_performance_summary IS 'Summary of model performance comparing training vs live accuracy';
COMMENT ON VIEW ml_recent_predictions IS 'Recent predictions with outcomes for quick analysis';
