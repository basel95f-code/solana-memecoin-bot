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
  },
  {
    version: 5,
    description: 'Add portfolio tracking tables',
    sql: `
      -- ============================================
      -- Positions Table
      -- Tracks all trading positions (open and closed)
      -- ============================================
      CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_mint TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT,
        side TEXT NOT NULL CHECK(side IN ('long', 'short')),
        
        -- Entry details
        entry_price REAL NOT NULL,
        current_price REAL NOT NULL,
        quantity REAL NOT NULL,
        entry_value REAL NOT NULL,
        current_value REAL NOT NULL,
        
        -- PnL
        unrealized_pnl REAL DEFAULT 0,
        unrealized_pnl_percent REAL DEFAULT 0,
        
        -- Timestamps
        entry_time INTEGER NOT NULL,
        last_updated INTEGER NOT NULL,
        
        -- Status
        status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed'))
      );

      CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
      CREATE INDEX IF NOT EXISTS idx_positions_mint ON positions(token_mint);
      CREATE INDEX IF NOT EXISTS idx_positions_entry_time ON positions(entry_time);

      -- ============================================
      -- Trades Table
      -- Tracks all trade actions (open, close, partial close)
      -- ============================================
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_mint TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL CHECK(side IN ('long', 'short')),
        action TEXT NOT NULL CHECK(action IN ('open', 'close', 'partial_close')),
        
        -- Price details
        entry_price REAL NOT NULL,
        exit_price REAL,
        quantity REAL NOT NULL,
        
        -- Value
        entry_value REAL NOT NULL,
        exit_value REAL,
        
        -- PnL (for close/partial_close)
        realized_pnl REAL,
        realized_pnl_percent REAL,
        fees REAL DEFAULT 0,
        
        -- Metadata
        timestamp INTEGER NOT NULL,
        notes TEXT,
        position_id INTEGER,
        
        FOREIGN KEY(position_id) REFERENCES positions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_trades_mint ON trades(token_mint);
      CREATE INDEX IF NOT EXISTS idx_trades_action ON trades(action);
      CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
      CREATE INDEX IF NOT EXISTS idx_trades_position ON trades(position_id);

      -- ============================================
      -- Portfolio Snapshots Table
      -- Periodic snapshots of portfolio value for charts
      -- ============================================
      CREATE TABLE IF NOT EXISTS portfolio_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        total_value REAL NOT NULL,
        total_invested REAL NOT NULL,
        unrealized_pnl REAL NOT NULL,
        realized_pnl REAL NOT NULL,
        total_pnl REAL NOT NULL,
        open_positions INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON portfolio_snapshots(timestamp);
    `
  },
  {
    version: 6,
    description: 'Add token scanner tables',
    sql: `
      -- ============================================
      -- Scan Filters Table
      -- Custom filters for token scanning
      -- ============================================
      CREATE TABLE IF NOT EXISTS scan_filters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        enabled INTEGER DEFAULT 1,
        
        -- Risk filters
        min_risk_score INTEGER,
        max_risk_score INTEGER,
        
        -- Liquidity filters
        min_liquidity REAL,
        max_liquidity REAL,
        
        -- Holder filters
        min_holders INTEGER,
        max_holders INTEGER,
        max_top10_percent REAL,
        
        -- Contract filters
        require_mint_revoked INTEGER DEFAULT 0,
        require_freeze_revoked INTEGER DEFAULT 0,
        require_lp_burned INTEGER DEFAULT 0,
        min_lp_burned_percent REAL,
        
        -- Social filters
        require_socials INTEGER DEFAULT 0,
        
        -- Price/Volume filters
        min_price_change_1h REAL,
        max_price_change_1h REAL,
        min_volume_24h REAL,
        
        -- ML filters
        max_rug_probability REAL,
        min_ml_confidence REAL,
        
        -- Age filters
        min_age_hours REAL,
        max_age_hours REAL,
        
        -- Metadata
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scan_filters_enabled ON scan_filters(enabled);

      -- ============================================
      -- Scan Matches Table
      -- Tokens that matched scan filters
      -- ============================================
      CREATE TABLE IF NOT EXISTS scan_matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_mint TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT,
        filter_id INTEGER NOT NULL,
        filter_name TEXT NOT NULL,
        
        -- Token metrics at match time
        risk_score INTEGER,
        liquidity_usd REAL,
        holder_count INTEGER,
        rug_probability REAL,
        
        -- Metadata
        matched_at INTEGER NOT NULL,
        alerted INTEGER DEFAULT 0,
        
        FOREIGN KEY(filter_id) REFERENCES scan_filters(id) ON DELETE CASCADE,
        UNIQUE(token_mint, filter_id)
      );

      CREATE INDEX IF NOT EXISTS idx_scan_matches_mint ON scan_matches(token_mint);
      CREATE INDEX IF NOT EXISTS idx_scan_matches_filter ON scan_matches(filter_id);
      CREATE INDEX IF NOT EXISTS idx_scan_matches_time ON scan_matches(matched_at);
    `
  },
  {
    version: 7,
    description: 'Add learning orchestrator outcome tracking',
    sql: `
      -- ============================================
      -- Token Outcomes Table (Enhanced)
      -- Tracks what actually happened to tokens
      -- Used for continuous learning and improvement
      -- ============================================
      CREATE TABLE IF NOT EXISTS token_outcomes_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_mint TEXT NOT NULL UNIQUE,
        symbol TEXT NOT NULL,
        
        -- Initial state when discovered
        discovered_at INTEGER NOT NULL,
        initial_price REAL,
        initial_liquidity REAL,
        initial_risk_score INTEGER,
        initial_rug_prob REAL,
        
        -- Outcome classification
        outcome_type TEXT CHECK(outcome_type IN ('moon', 'rug', 'stable', 'decline', 'unknown')),
        price_change_24h REAL,
        price_change_7d REAL,
        final_price REAL,
        max_price REAL,
        min_price REAL,
        
        -- Trading results
        was_traded INTEGER DEFAULT 0,
        trade_profit REAL,
        trade_profit_percent REAL,
        
        -- Learning metadata
        checked_at INTEGER NOT NULL,
        confidence REAL DEFAULT 0.5,
        
        -- Use this for ML training
        used_for_training INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_outcomes_v2_mint ON token_outcomes_v2(token_mint);
      CREATE INDEX IF NOT EXISTS idx_outcomes_v2_type ON token_outcomes_v2(outcome_type);
      CREATE INDEX IF NOT EXISTS idx_outcomes_v2_discovered ON token_outcomes_v2(discovered_at);
      CREATE INDEX IF NOT EXISTS idx_outcomes_v2_traded ON token_outcomes_v2(was_traded);
    `
  },
  {
    version: 8,
    description: 'Add strategy automation tables',
    sql: `
      -- ============================================
      -- Automation Rules Table
      -- Defines IF/THEN automation strategies
      -- ============================================
      CREATE TABLE IF NOT EXISTS automation_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        enabled INTEGER DEFAULT 1,
        priority INTEGER DEFAULT 50,
        
        -- Rule logic (JSON)
        conditions TEXT NOT NULL,  -- Array of conditions
        actions TEXT NOT NULL,     -- Array of actions
        
        -- Statistics
        match_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        
        -- Metadata
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled ON automation_rules(enabled);
      CREATE INDEX IF NOT EXISTS idx_automation_rules_priority ON automation_rules(priority DESC);

      -- ============================================
      -- Automation Decisions Table
      -- Records all automation decisions
      -- ============================================
      CREATE TABLE IF NOT EXISTS automation_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_mint TEXT NOT NULL,
        symbol TEXT NOT NULL,
        category TEXT NOT NULL,  -- gem, watch, avoid, unknown
        confidence REAL DEFAULT 0,
        
        -- Decision details
        reasons TEXT,  -- JSON array of reason strings
        actions TEXT,  -- JSON array of actions taken
        rule_name TEXT,
        
        -- Metadata
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_automation_decisions_mint ON automation_decisions(token_mint);
      CREATE INDEX IF NOT EXISTS idx_automation_decisions_category ON automation_decisions(category);
      CREATE INDEX IF NOT EXISTS idx_automation_decisions_time ON automation_decisions(timestamp);
    `
  },
  {
    version: 9,
    description: 'Add risk management parameters table',
    sql: `
      -- ============================================
      -- Risk Parameters Table
      -- Stores advanced risk management settings
      -- ============================================
      CREATE TABLE IF NOT EXISTS risk_parameters (
        id INTEGER PRIMARY KEY DEFAULT 1,
        account_balance REAL NOT NULL,
        max_daily_loss REAL NOT NULL,
        max_position_size REAL NOT NULL,
        base_risk_percent REAL NOT NULL,
        max_risk_percent REAL NOT NULL,
        max_open_positions INTEGER NOT NULL,
        max_correlated_positions INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (id = 1)  -- Only one row allowed
      );

      -- Insert default values
      INSERT OR IGNORE INTO risk_parameters (
        id, account_balance, max_daily_loss, max_position_size,
        base_risk_percent, max_risk_percent, max_open_positions,
        max_correlated_positions, updated_at
      ) VALUES (1, 10000, 5, 10, 1, 2, 5, 2, strftime('%s', 'now'));
    `
  },
  {
    version: 10,
    description: 'Add group chat and user settings for multi-context support',
    sql: `
      -- ============================================
      -- Group Settings Table
      -- Stores configuration for each group chat
      -- ============================================
      CREATE TABLE IF NOT EXISTS group_settings (
        chat_id TEXT PRIMARY KEY,
        chat_type TEXT NOT NULL,
        chat_title TEXT,
        
        -- Alert Preferences (Opt-in)
        enable_token_alerts INTEGER DEFAULT 1,
        enable_smart_money_alerts INTEGER DEFAULT 1,
        enable_rug_warnings INTEGER DEFAULT 1,
        enable_signals INTEGER DEFAULT 1,
        enable_volume_spikes INTEGER DEFAULT 0,
        
        -- Quality Thresholds (Anti-spam)
        min_risk_score INTEGER DEFAULT 80,
        min_liquidity_usd REAL DEFAULT 50000,
        max_alerts_per_hour INTEGER DEFAULT 5,
        
        -- Features
        enable_group_watchlist INTEGER DEFAULT 1,
        enable_leaderboard INTEGER DEFAULT 0,
        enable_morning_briefing INTEGER DEFAULT 1,
        
        -- Admin
        admin_user_ids TEXT NOT NULL,  -- JSON array
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_group_settings_type ON group_settings(chat_type);

      -- ============================================
      -- User Settings Table
      -- Stores configuration for each user (DM preferences)
      -- ============================================
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        
        -- DM Alert Preferences
        enable_token_alerts INTEGER DEFAULT 1,
        enable_smart_money_alerts INTEGER DEFAULT 1,
        enable_rug_warnings INTEGER DEFAULT 1,
        enable_signals INTEGER DEFAULT 1,
        enable_volume_spikes INTEGER DEFAULT 1,
        enable_watchlist_alerts INTEGER DEFAULT 1,
        
        -- DM Quality Thresholds (More permissive)
        min_risk_score INTEGER DEFAULT 60,
        min_liquidity_usd REAL DEFAULT 10000,
        
        -- Group Participation
        participate_in_leaderboard INTEGER DEFAULT 0,
        
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_user_settings_username ON user_settings(username);

      -- ============================================
      -- Group Alert Throttle Table
      -- Tracks recent alerts sent to groups for deduplication
      -- ============================================
      CREATE TABLE IF NOT EXISTS group_alert_throttle (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        token_mint TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        sent_at INTEGER NOT NULL,
        UNIQUE(chat_id, token_mint, alert_type)
      );

      CREATE INDEX IF NOT EXISTS idx_alert_throttle_chat ON group_alert_throttle(chat_id);
      CREATE INDEX IF NOT EXISTS idx_alert_throttle_time ON group_alert_throttle(sent_at);
    `
  },
  {
    version: 11,
    description: 'Add group watchlist for shared token tracking',
    sql: `
      -- ============================================
      -- Group Watchlist Table
      -- Shared watchlist for group chats
      -- ============================================
      CREATE TABLE IF NOT EXISTS group_watchlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        token_mint TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT,
        
        -- Added by
        added_by_user_id INTEGER NOT NULL,
        added_by_username TEXT,
        added_at INTEGER NOT NULL,
        
        -- Usage tracking
        alert_count INTEGER DEFAULT 0,
        last_alerted_at INTEGER,
        
        -- Unique constraint: one token per group
        UNIQUE(chat_id, token_mint)
      );

      CREATE INDEX IF NOT EXISTS idx_group_watchlist_chat ON group_watchlist(chat_id);
      CREATE INDEX IF NOT EXISTS idx_group_watchlist_mint ON group_watchlist(token_mint);
      CREATE INDEX IF NOT EXISTS idx_group_watchlist_added_at ON group_watchlist(added_at);
      CREATE INDEX IF NOT EXISTS idx_group_watchlist_alert_count ON group_watchlist(alert_count DESC);
    `
  },
  {
    version: 12,
    description: 'Add leaderboard for tracking user token discoveries',
    sql: `
      -- ============================================
      -- Leaderboard Entries Table
      -- Tracks which users find the best token opportunities
      -- ============================================
      CREATE TABLE IF NOT EXISTS leaderboard_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        username TEXT,
        
        -- Token details
        token_mint TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT,
        
        -- Discovery details
        discovered_at INTEGER NOT NULL,
        initial_price REAL NOT NULL,
        
        -- Performance tracking
        peak_price REAL NOT NULL,
        current_price REAL NOT NULL,
        peak_multiplier REAL NOT NULL,
        
        -- Scoring
        score REAL DEFAULT 0,
        outcome TEXT DEFAULT 'pending' CHECK(outcome IN ('moon', 'profit', 'stable', 'loss', 'pending')),
        
        -- Tracking window
        tracked_until INTEGER NOT NULL,
        last_updated_at INTEGER NOT NULL,
        
        -- Unique constraint: one entry per user per token per group
        UNIQUE(chat_id, user_id, token_mint)
      );

      CREATE INDEX IF NOT EXISTS idx_leaderboard_chat ON leaderboard_entries(chat_id);
      CREATE INDEX IF NOT EXISTS idx_leaderboard_user ON leaderboard_entries(user_id);
      CREATE INDEX IF NOT EXISTS idx_leaderboard_discovered ON leaderboard_entries(discovered_at);
      CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard_entries(score DESC);
      CREATE INDEX IF NOT EXISTS idx_leaderboard_outcome ON leaderboard_entries(outcome);
      CREATE INDEX IF NOT EXISTS idx_leaderboard_tracked_until ON leaderboard_entries(tracked_until);
    `
  },
  {
    version: 13,
    description: 'Add topic configurations for Telegram forum groups',
    sql: `
      -- ============================================
      -- Topic Configurations Table
      -- Manages topic-aware bot behavior in Telegram forum groups
      -- ============================================
      CREATE TABLE IF NOT EXISTS topic_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        topic_id INTEGER NOT NULL,
        topic_name TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('command_only', 'normal', 'read_only')),
        allowed_commands TEXT, -- JSON array of allowed commands
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(chat_id, topic_id)
      );

      CREATE INDEX IF NOT EXISTS idx_topic_configs_chat ON topic_configs(chat_id);
      CREATE INDEX IF NOT EXISTS idx_topic_configs_topic ON topic_configs(chat_id, topic_id);
      CREATE INDEX IF NOT EXISTS idx_topic_configs_mode ON topic_configs(mode);
    `
  }
];
