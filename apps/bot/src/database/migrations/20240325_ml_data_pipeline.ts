/**
 * Migration: ML Data Pipeline Tables
 * Adds comprehensive tables for the self-learning ML system
 */

export const ML_DATA_PIPELINE_MIGRATION = {
  version: 17,
  description: 'Add ML data pipeline tables for self-learning system',
  sql: `
    -- ============================================
    -- ML Training Data Table
    -- Comprehensive feature storage for ML training
    -- ============================================
    CREATE TABLE IF NOT EXISTS ml_training_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT NOT NULL,
      symbol TEXT NOT NULL,
      
      -- Features (stored as JSON for flexibility)
      features_json TEXT,
      feature_version TEXT DEFAULT 'v2',
      
      -- Raw metrics at snapshot time
      price_usd REAL,
      liquidity_usd REAL,
      risk_score INTEGER,
      holder_count INTEGER,
      
      -- Price outcomes (filled by outcome tracker)
      price_change_1h REAL,
      price_change_6h REAL,
      price_change_24h REAL,
      
      -- Labels
      outcome TEXT, -- 'rug', 'pump', 'moon', 'stable', 'decline'
      whale_action TEXT, -- 'DUMP', 'ACCUMULATION', 'DISTRIBUTION', 'HOLDING', 'NONE'
      sentiment_score REAL,
      
      -- Metadata
      has_outcome INTEGER DEFAULT 0,
      label_source TEXT, -- 'auto', 'manual', 'semi-auto'
      label_confidence REAL,
      
      -- Timestamps
      created_at INTEGER NOT NULL,
      labeled_at INTEGER,
      
      UNIQUE(mint, feature_version, created_at)
    );
    
    CREATE INDEX IF NOT EXISTS idx_ml_training_mint ON ml_training_data(mint);
    CREATE INDEX IF NOT EXISTS idx_ml_training_outcome ON ml_training_data(outcome);
    CREATE INDEX IF NOT EXISTS idx_ml_training_has_outcome ON ml_training_data(has_outcome);
    CREATE INDEX IF NOT EXISTS idx_ml_training_created ON ml_training_data(created_at);
    
    -- ============================================
    -- ML Predictions Table
    -- Tracks predictions and their outcomes for accuracy measurement
    -- ============================================
    CREATE TABLE IF NOT EXISTS ml_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT NOT NULL,
      symbol TEXT,
      
      -- Prediction
      model_version TEXT NOT NULL,
      predicted_outcome TEXT NOT NULL,
      predicted_confidence REAL NOT NULL,
      rug_probability REAL,
      
      -- Actual outcome (filled later)
      actual_outcome TEXT,
      actual_price_change_24h REAL,
      
      -- Accuracy tracking
      was_correct INTEGER,
      confidence_calibration REAL,
      
      -- Timestamps
      predicted_at INTEGER NOT NULL,
      outcome_recorded_at INTEGER,
      
      UNIQUE(mint, model_version, predicted_at)
    );
    
    CREATE INDEX IF NOT EXISTS idx_ml_predictions_mint ON ml_predictions(mint);
    CREATE INDEX IF NOT EXISTS idx_ml_predictions_model ON ml_predictions(model_version);
    CREATE INDEX IF NOT EXISTS idx_ml_predictions_correct ON ml_predictions(was_correct);
    
    -- ============================================
    -- ML Data Quality Metrics Table
    -- Stores quality reports over time
    -- ============================================
    CREATE TABLE IF NOT EXISTS ml_data_quality_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      
      total_samples INTEGER NOT NULL,
      valid_samples INTEGER NOT NULL,
      quality_score REAL NOT NULL,
      
      -- Missing data
      total_missing_percent REAL,
      missing_by_feature TEXT, -- JSON
      
      -- Outliers
      total_outlier_percent REAL,
      outliers_by_feature TEXT, -- JSON
      
      -- Class balance
      class_counts TEXT, -- JSON
      imbalance_ratio REAL,
      is_imbalanced INTEGER,
      
      -- Issues
      issues TEXT, -- JSON array
      recommendations TEXT -- JSON array
    );
    
    CREATE INDEX IF NOT EXISTS idx_quality_metrics_time ON ml_data_quality_metrics(timestamp);
    
    -- ============================================
    -- ML Training Jobs Table
    -- Tracks training job history
    -- ============================================
    CREATE TABLE IF NOT EXISTS ml_training_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL, -- 'pending', 'running', 'completed', 'failed'
      trigger_type TEXT NOT NULL, -- 'manual', 'scheduled', 'auto', 'degradation'
      
      -- Model info
      model_version TEXT,
      samples_used INTEGER,
      
      -- Metrics
      accuracy REAL,
      precision_score REAL,
      recall_score REAL,
      f1_score REAL,
      auc_score REAL,
      train_loss REAL,
      validation_loss REAL,
      
      -- Deployment
      deployed INTEGER DEFAULT 0,
      
      -- Timing
      started_at INTEGER,
      completed_at INTEGER,
      duration_ms INTEGER,
      
      -- Error
      error_message TEXT
    );
    
    CREATE INDEX IF NOT EXISTS idx_training_jobs_status ON ml_training_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_training_jobs_time ON ml_training_jobs(started_at);
    
    -- ============================================
    -- ML Model Comparisons Table (A/B testing)
    -- ============================================
    CREATE TABLE IF NOT EXISTS ml_model_comparisons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      production_version TEXT,
      challenger_version TEXT NOT NULL,
      
      -- Metrics
      production_accuracy REAL,
      challenger_accuracy REAL,
      production_f1 REAL,
      challenger_f1 REAL,
      
      -- Deltas
      accuracy_delta REAL,
      f1_delta REAL,
      
      -- Statistical significance
      p_value REAL,
      chi_square REAL,
      is_significant INTEGER,
      
      -- Result
      winner TEXT, -- 'production', 'challenger', 'tie'
      confidence REAL,
      
      compared_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_model_comparisons_time ON ml_model_comparisons(compared_at);
    
    -- ============================================
    -- Feature Distribution Baselines Table
    -- For drift detection
    -- ============================================
    CREATE TABLE IF NOT EXISTS feature_distribution_baselines (
      feature_name TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      mean REAL NOT NULL,
      std REAL NOT NULL,
      percentiles TEXT, -- JSON array [p5, p25, p50, p75, p95]
      histogram TEXT -- JSON array of {bin, count}
    );
    
    -- ============================================
    -- Drift Reports Table
    -- ============================================
    CREATE TABLE IF NOT EXISTS ml_drift_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      comparison_period_days INTEGER,
      
      overall_drift_score REAL,
      drifted_feature_count INTEGER,
      retraining_recommended INTEGER,
      urgency TEXT, -- 'none', 'low', 'medium', 'high', 'critical'
      
      -- Details
      feature_drift TEXT, -- JSON array of per-feature drift
      suggested_actions TEXT -- JSON array
    );
    
    CREATE INDEX IF NOT EXISTS idx_drift_reports_time ON ml_drift_reports(timestamp);
    CREATE INDEX IF NOT EXISTS idx_drift_reports_urgency ON ml_drift_reports(urgency);
  `,
};

export default ML_DATA_PIPELINE_MIGRATION;
