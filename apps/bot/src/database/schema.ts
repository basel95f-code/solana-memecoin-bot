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
  // Backtesting framework tables
  {
    version: 1,
    sql: `
      -- ============================================
      -- Backtest Strategies
      -- Stores strategy definitions for backtesting
      -- ============================================
      CREATE TABLE IF NOT EXISTS backtest_strategies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        entry_conditions TEXT NOT NULL, -- JSON
        exit_conditions TEXT NOT NULL, -- JSON
        position_sizing TEXT NOT NULL, -- JSON
        is_preset INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_backtest_strategies_name ON backtest_strategies(name);

      -- ============================================
      -- Backtest Runs
      -- Stores execution results for each backtest run
      -- ============================================
      CREATE TABLE IF NOT EXISTS backtest_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_id INTEGER NOT NULL,
        strategy_name TEXT NOT NULL,
        start_date INTEGER NOT NULL,
        end_date INTEGER NOT NULL,
        days_analyzed INTEGER NOT NULL,
        initial_capital REAL NOT NULL,
        final_capital REAL NOT NULL,
        total_trades INTEGER NOT NULL,
        winning_trades INTEGER NOT NULL,
        losing_trades INTEGER NOT NULL,
        win_rate REAL NOT NULL,
        total_profit_loss REAL NOT NULL,
        total_return REAL NOT NULL,
        average_win REAL,
        average_loss REAL,
        largest_win REAL,
        largest_loss REAL,
        max_drawdown REAL,
        max_drawdown_duration INTEGER,
        sharpe_ratio REAL,
        sortino_ratio REAL,
        profit_factor REAL,
        average_hold_time INTEGER,
        longest_winning_streak INTEGER,
        longest_losing_streak INTEGER,
        equity_curve TEXT, -- JSON array of equity points
        executed_at INTEGER DEFAULT (strftime('%s', 'now')),
        execution_time_ms INTEGER,
        FOREIGN KEY (strategy_id) REFERENCES backtest_strategies(id)
      );

      CREATE INDEX IF NOT EXISTS idx_backtest_runs_strategy ON backtest_runs(strategy_id);
      CREATE INDEX IF NOT EXISTS idx_backtest_runs_time ON backtest_runs(executed_at);

      -- ============================================
      -- Backtest Trades
      -- Individual trade records for each backtest run
      -- ============================================
      CREATE TABLE IF NOT EXISTS backtest_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL,
        token_mint TEXT NOT NULL,
        token_symbol TEXT,
        token_name TEXT,
        entry_price REAL NOT NULL,
        entry_time INTEGER NOT NULL,
        position_size REAL NOT NULL,
        exit_price REAL NOT NULL,
        exit_time INTEGER NOT NULL,
        exit_reason TEXT NOT NULL,
        profit_loss REAL NOT NULL,
        profit_loss_percent REAL NOT NULL,
        hold_time_seconds INTEGER NOT NULL,
        peak_price REAL,
        peak_multiplier REAL,
        entry_risk_score INTEGER,
        entry_liquidity REAL,
        entry_holders INTEGER,
        FOREIGN KEY (run_id) REFERENCES backtest_runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_backtest_trades_run ON backtest_trades(run_id);
      CREATE INDEX IF NOT EXISTS idx_backtest_trades_token ON backtest_trades(token_mint);
    `
  },
  // Token snapshots for enhanced backtesting data
  {
    version: 2,
    sql: `
      -- ============================================
      -- Token Snapshots
      -- Periodic price/volume/liquidity snapshots for backtesting
      -- ============================================
      CREATE TABLE IF NOT EXISTS token_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mint TEXT NOT NULL,
        symbol TEXT,

        -- Price data
        price_usd REAL,
        price_sol REAL,

        -- Volume data
        volume_5m REAL,
        volume_1h REAL,
        volume_24h REAL,

        -- Liquidity data
        liquidity_usd REAL,

        -- Market data
        market_cap REAL,
        holder_count INTEGER,

        -- Price changes
        price_change_5m REAL,
        price_change_1h REAL,
        price_change_24h REAL,

        -- Trade activity
        buys_5m INTEGER,
        sells_5m INTEGER,
        buys_1h INTEGER,
        sells_1h INTEGER,

        -- Timestamp
        recorded_at INTEGER NOT NULL,

        -- Composite unique constraint for deduplication
        UNIQUE(mint, recorded_at)
      );

      CREATE INDEX IF NOT EXISTS idx_token_snapshots_mint ON token_snapshots(mint);
      CREATE INDEX IF NOT EXISTS idx_token_snapshots_time ON token_snapshots(recorded_at);
      CREATE INDEX IF NOT EXISTS idx_token_snapshots_mint_time ON token_snapshots(mint, recorded_at);

      -- ============================================
      -- Watched Tokens for Snapshots
      -- Tokens being actively tracked for snapshots
      -- ============================================
      CREATE TABLE IF NOT EXISTS snapshot_watch_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mint TEXT NOT NULL UNIQUE,
        symbol TEXT,
        added_at INTEGER NOT NULL,
        last_snapshot_at INTEGER,
        snapshot_count INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        expires_at INTEGER -- Auto-remove after this time
      );

      CREATE INDEX IF NOT EXISTS idx_snapshot_watch_mint ON snapshot_watch_list(mint);
      CREATE INDEX IF NOT EXISTS idx_snapshot_watch_active ON snapshot_watch_list(is_active);
    `
  },
  // Trading Signals and ML Training tables
  {
    version: 3,
    sql: `
      -- ============================================
      -- Trading Signals
      -- Stores generated trading signals
      -- ============================================
      CREATE TABLE IF NOT EXISTS trading_signals (
        id TEXT PRIMARY KEY,
        mint TEXT NOT NULL,
        symbol TEXT,
        name TEXT,
        type TEXT NOT NULL,  -- BUY, SELL, TAKE_PROFIT, STOP_LOSS
        confidence INTEGER,
        suggested_position_size REAL,
        position_size_type TEXT,  -- 'percentage' or 'fixed_sol'
        rug_probability REAL,
        risk_score INTEGER,
        smart_money_score REAL,
        momentum_score REAL,
        holder_score REAL,
        entry_price REAL,
        target_price REAL,
        stop_loss_price REAL,
        reasons TEXT,  -- JSON array
        warnings TEXT, -- JSON array
        status TEXT DEFAULT 'active',  -- active, acknowledged, expired, executed
        generated_at INTEGER NOT NULL,
        expires_at INTEGER,
        acknowledged_at INTEGER,
        acknowledged_by TEXT,
        -- Outcome tracking
        actual_entry REAL,
        actual_exit REAL,
        profit_loss_percent REAL,
        was_accurate INTEGER,
        hit_target INTEGER,
        hit_stop_loss INTEGER,
        entry_recorded_at INTEGER,
        exit_recorded_at INTEGER,
        outcome_notes TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_trading_signals_mint ON trading_signals(mint);
      CREATE INDEX IF NOT EXISTS idx_trading_signals_type ON trading_signals(type);
      CREATE INDEX IF NOT EXISTS idx_trading_signals_status ON trading_signals(status);
      CREATE INDEX IF NOT EXISTS idx_trading_signals_time ON trading_signals(generated_at);

      -- ============================================
      -- Signal Webhooks (Discord)
      -- Stores webhook configurations
      -- ============================================
      CREATE TABLE IF NOT EXISTS signal_webhooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT UNIQUE NOT NULL,
        name TEXT,
        enabled INTEGER DEFAULT 1,
        events TEXT,  -- JSON array: ["BUY", "SELL"]
        min_confidence INTEGER DEFAULT 60,
        total_sent INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER,
        last_triggered_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_signal_webhooks_enabled ON signal_webhooks(enabled);

      -- ============================================
      -- ML Training Samples
      -- Enhanced feature storage for ML training
      -- ============================================
      CREATE TABLE IF NOT EXISTS ml_training_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mint TEXT NOT NULL,
        symbol TEXT,
        -- 25 features stored as JSON
        features TEXT NOT NULL,  -- JSON object with all 25 normalized features
        feature_version TEXT DEFAULT 'v2',  -- Track feature schema version
        -- Outcome
        outcome TEXT,  -- 'rug', 'pump', 'stable', 'decline'
        outcome_confidence REAL,
        -- Labeling metadata
        label_source TEXT,  -- 'auto' or 'manual'
        labeled_by TEXT,  -- Username if manual
        -- Timestamps
        discovered_at INTEGER,
        labeled_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(mint, feature_version)
      );

      CREATE INDEX IF NOT EXISTS idx_ml_samples_mint ON ml_training_samples(mint);
      CREATE INDEX IF NOT EXISTS idx_ml_samples_outcome ON ml_training_samples(outcome);
      CREATE INDEX IF NOT EXISTS idx_ml_samples_source ON ml_training_samples(label_source);
      CREATE INDEX IF NOT EXISTS idx_ml_samples_time ON ml_training_samples(labeled_at);

      -- ============================================
      -- ML Training Runs
      -- Tracks model training history
      -- ============================================
      CREATE TABLE IF NOT EXISTS ml_training_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_version TEXT NOT NULL UNIQUE,
        feature_version TEXT DEFAULT 'v2',
        samples_used INTEGER,
        train_samples INTEGER,
        validation_samples INTEGER,
        test_samples INTEGER,
        -- Metrics
        accuracy REAL,
        precision_score REAL,
        recall_score REAL,
        f1_score REAL,
        auc_score REAL,
        -- Training metadata
        training_loss REAL,
        validation_loss REAL,
        epochs INTEGER,
        training_duration_ms INTEGER,
        -- Status
        is_active INTEGER DEFAULT 0,  -- Currently deployed model
        is_challenger INTEGER DEFAULT 0,  -- A/B test challenger
        -- Feature importance (JSON)
        feature_importance TEXT,
        -- Confusion matrix (JSON)
        confusion_matrix TEXT,
        -- Timestamps
        trained_at INTEGER NOT NULL,
        activated_at INTEGER,
        deactivated_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_ml_runs_version ON ml_training_runs(model_version);
      CREATE INDEX IF NOT EXISTS idx_ml_runs_active ON ml_training_runs(is_active);
      CREATE INDEX IF NOT EXISTS idx_ml_runs_time ON ml_training_runs(trained_at);

      -- ============================================
      -- ML Pending Labels
      -- Queue of tokens awaiting manual labeling
      -- ============================================
      CREATE TABLE IF NOT EXISTS ml_pending_labels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mint TEXT NOT NULL UNIQUE,
        symbol TEXT,
        -- Token data at discovery
        initial_price REAL,
        initial_liquidity REAL,
        initial_risk_score INTEGER,
        -- Current data (for auto-suggest)
        current_price REAL,
        price_change_percent REAL,
        -- Suggested label based on price change
        suggested_label TEXT,
        suggest_confidence REAL,
        -- Status
        status TEXT DEFAULT 'pending',  -- pending, labeled, skipped
        -- Timestamps
        discovered_at INTEGER NOT NULL,
        last_updated_at INTEGER,
        labeled_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_ml_pending_mint ON ml_pending_labels(mint);
      CREATE INDEX IF NOT EXISTS idx_ml_pending_status ON ml_pending_labels(status);
      CREATE INDEX IF NOT EXISTS idx_ml_pending_time ON ml_pending_labels(discovered_at);
    `
  },
  {
    version: 4,
    description: 'Add feature importance analysis table',
    sql: `
      -- ============================================
      -- Feature Importance Analysis
      -- Stores feature importance rankings over time
      -- ============================================
      CREATE TABLE IF NOT EXISTS feature_importance_analysis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        total_features INTEGER NOT NULL,
        analyzed_samples INTEGER NOT NULL,
        improvement_estimate REAL,
        -- Feature importance scores (JSON array)
        importance_scores TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_feature_importance_time ON feature_importance_analysis(timestamp);
    `
  }
];
