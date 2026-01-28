-- Migration: Scam Detection Tables
-- Created: 2026-01-28
-- Description: Tables for storing bundle detection and other scam detection results

-- =============================================================================
-- 1. BUNDLE_FLAGS - Store detected wallet bundle clusters
-- =============================================================================
CREATE TABLE IF NOT EXISTS bundle_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_mint TEXT NOT NULL,
  cluster_id TEXT NOT NULL,
  
  -- Cluster details
  wallets TEXT[] NOT NULL, -- Array of wallet addresses
  common_funder TEXT NOT NULL,
  funder_label TEXT, -- e.g., "Binance", "Unknown"
  wallet_count INTEGER NOT NULL,
  
  -- Holdings
  total_holdings DECIMAL,
  total_percentage DECIMAL NOT NULL,
  
  -- Timing patterns
  creation_time_span INTEGER, -- Seconds between oldest/newest wallet
  avg_wallet_age DECIMAL, -- Average age in hours
  wallets_created_within_1h INTEGER DEFAULT 0,
  
  -- Purchase patterns
  has_coordinated_buys BOOLEAN DEFAULT FALSE,
  coordinated_buy_count INTEGER DEFAULT 0,
  fastest_coordinated_buy_seconds INTEGER, -- Fastest coordinated buy timespan
  
  -- Risk assessment
  risk_score INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  is_suspicious BOOLEAN DEFAULT FALSE,
  suspicion_reasons TEXT[],
  
  -- Metadata
  detected_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_cluster_per_token UNIQUE(token_mint, cluster_id)
);

-- Indexes for bundle_flags
CREATE INDEX idx_bundle_flags_token_mint ON bundle_flags(token_mint);
CREATE INDEX idx_bundle_flags_risk_score ON bundle_flags(risk_score DESC);
CREATE INDEX idx_bundle_flags_suspicious ON bundle_flags(is_suspicious) WHERE is_suspicious = TRUE;
CREATE INDEX idx_bundle_flags_detected_at ON bundle_flags(detected_at DESC);
CREATE INDEX idx_bundle_flags_funder ON bundle_flags(common_funder);
CREATE INDEX idx_bundle_flags_wallet_count ON bundle_flags(wallet_count DESC);

-- Comments
COMMENT ON TABLE bundle_flags IS 'Stores detected wallet bundle clusters (sybil attacks)';
COMMENT ON COLUMN bundle_flags.wallets IS 'Array of wallet addresses in the bundle';
COMMENT ON COLUMN bundle_flags.creation_time_span IS 'Seconds between oldest and newest wallet creation';
COMMENT ON COLUMN bundle_flags.risk_score IS 'Calculated risk score from 0-100';
COMMENT ON COLUMN bundle_flags.suspicion_reasons IS 'Array of reasons why this cluster is flagged';


-- =============================================================================
-- 2. FUNDING_TRACES - Store wallet funding source traces
-- =============================================================================
CREATE TABLE IF NOT EXISTS funding_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE NOT NULL,
  
  -- Funding details
  initial_funder TEXT NOT NULL,
  funder_type TEXT CHECK (funder_type IN ('cex', 'unknown', 'dev_wallet', 'faucet')),
  funder_label TEXT, -- e.g., "Binance", "Known Rugger"
  funding_amount DECIMAL, -- SOL amount
  funding_timestamp TIMESTAMP,
  
  -- Wallet info
  wallet_age_hours DECIMAL,
  is_fresh_wallet BOOLEAN DEFAULT FALSE, -- < 24h old
  
  -- Risk assessment
  risk_score INTEGER CHECK (risk_score >= 0 AND risk_score <= 100),
  warnings TEXT[],
  
  -- Metadata
  traced_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for funding_traces
CREATE INDEX idx_funding_traces_wallet ON funding_traces(wallet_address);
CREATE INDEX idx_funding_traces_funder ON funding_traces(initial_funder);
CREATE INDEX idx_funding_traces_funder_type ON funding_traces(funder_type);
CREATE INDEX idx_funding_traces_fresh ON funding_traces(is_fresh_wallet) WHERE is_fresh_wallet = TRUE;
CREATE INDEX idx_funding_traces_risk ON funding_traces(risk_score DESC);

-- Comments
COMMENT ON TABLE funding_traces IS 'Stores wallet funding source traces for scam detection';
COMMENT ON COLUMN funding_traces.funder_type IS 'Type of funder: cex (exchange), unknown, dev_wallet, or faucet';
COMMENT ON COLUMN funding_traces.is_fresh_wallet IS 'TRUE if wallet is less than 24 hours old';


-- =============================================================================
-- 3. KNOWN_DEV_WALLETS - Registry of known dev/scammer wallets
-- =============================================================================
CREATE TABLE IF NOT EXISTS known_dev_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE NOT NULL,
  
  -- Classification
  classification TEXT NOT NULL CHECK (classification IN ('known_dev', 'known_scammer', 'insider', 'suspected')),
  reputation_score INTEGER CHECK (reputation_score >= 0 AND reputation_score <= 100),
  
  -- Activity
  associated_tokens TEXT[], -- List of token mints
  rugged_token_count INTEGER DEFAULT 0,
  successful_token_count INTEGER DEFAULT 0,
  
  -- Evidence
  evidence_notes TEXT,
  source TEXT, -- Where this classification came from
  
  -- Status
  is_flagged BOOLEAN DEFAULT TRUE,
  flagged_at TIMESTAMP DEFAULT NOW(),
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for known_dev_wallets
CREATE INDEX idx_known_dev_wallets_wallet ON known_dev_wallets(wallet_address);
CREATE INDEX idx_known_dev_wallets_classification ON known_dev_wallets(classification);
CREATE INDEX idx_known_dev_wallets_flagged ON known_dev_wallets(is_flagged) WHERE is_flagged = TRUE;
CREATE INDEX idx_known_dev_wallets_reputation ON known_dev_wallets(reputation_score);

-- Comments
COMMENT ON TABLE known_dev_wallets IS 'Registry of known developer and scammer wallets';
COMMENT ON COLUMN known_dev_wallets.classification IS 'Type: known_dev, known_scammer, insider, or suspected';
COMMENT ON COLUMN known_dev_wallets.reputation_score IS 'Reputation score 0-100 (0 = confirmed scammer)';


-- =============================================================================
-- 4. TWITTER_TOKEN_HISTORY - Track Twitter accounts linked to tokens
-- =============================================================================
CREATE TABLE IF NOT EXISTS twitter_token_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_mint TEXT NOT NULL,
  twitter_handle TEXT NOT NULL,
  
  -- Account info
  account_created_at TIMESTAMP,
  account_age_days INTEGER,
  
  -- Status
  was_rugged BOOLEAN DEFAULT FALSE,
  rug_date TIMESTAMP,
  
  -- Metadata
  observed_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_token_twitter UNIQUE(token_mint, twitter_handle)
);

-- Indexes for twitter_token_history
CREATE INDEX idx_twitter_history_handle ON twitter_token_history(twitter_handle);
CREATE INDEX idx_twitter_history_token ON twitter_token_history(token_mint);
CREATE INDEX idx_twitter_history_rugged ON twitter_token_history(was_rugged) WHERE was_rugged = TRUE;
CREATE INDEX idx_twitter_history_observed ON twitter_token_history(observed_at DESC);

-- Comments
COMMENT ON TABLE twitter_token_history IS 'Tracks Twitter accounts linked to tokens for reuse detection';
COMMENT ON COLUMN twitter_token_history.was_rugged IS 'TRUE if this token was rugged/scammed';


-- =============================================================================
-- 5. TOKEN_IMAGES - Store token image hashes for duplicate detection
-- =============================================================================
CREATE TABLE IF NOT EXISTS token_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_mint TEXT UNIQUE NOT NULL,
  
  -- Image data
  image_url TEXT NOT NULL,
  image_hash TEXT NOT NULL, -- Perceptual hash (pHash or dHash)
  hash_algorithm TEXT DEFAULT 'dhash', -- 'dhash', 'phash', 'blockhash'
  
  -- Token status
  was_rugged BOOLEAN DEFAULT FALSE,
  rug_date TIMESTAMP,
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for token_images
CREATE INDEX idx_token_images_mint ON token_images(token_mint);
CREATE INDEX idx_token_images_hash ON token_images(image_hash);
CREATE INDEX idx_token_images_rugged ON token_images(was_rugged) WHERE was_rugged = TRUE;

-- Comments
COMMENT ON TABLE token_images IS 'Stores token image perceptual hashes for duplicate/stolen logo detection';
COMMENT ON COLUMN token_images.image_hash IS 'Perceptual hash of the token logo for similarity matching';


-- =============================================================================
-- Update Triggers for updated_at timestamps
-- =============================================================================

-- Trigger function for updating updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
CREATE TRIGGER trigger_known_dev_wallets_updated_at
    BEFORE UPDATE ON known_dev_wallets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_token_images_updated_at
    BEFORE UPDATE ON token_images
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- =============================================================================
-- Helpful Views
-- =============================================================================

-- View: High-risk bundle clusters
CREATE OR REPLACE VIEW v_high_risk_bundles AS
SELECT 
    token_mint,
    cluster_id,
    wallet_count,
    total_percentage,
    risk_score,
    has_coordinated_buys,
    detected_at
FROM bundle_flags
WHERE is_suspicious = TRUE AND risk_score >= 75
ORDER BY detected_at DESC;

COMMENT ON VIEW v_high_risk_bundles IS 'All high-risk (75+) suspicious bundle clusters';


-- View: Fresh suspicious wallets
CREATE OR REPLACE VIEW v_fresh_suspicious_wallets AS
SELECT 
    wallet_address,
    initial_funder,
    funder_type,
    wallet_age_hours,
    risk_score,
    warnings,
    traced_at
FROM funding_traces
WHERE is_fresh_wallet = TRUE AND risk_score >= 60
ORDER BY traced_at DESC;

COMMENT ON VIEW v_fresh_suspicious_wallets IS 'Fresh wallets (<24h) with elevated risk scores';


-- View: Known scammer wallet activity
CREATE OR REPLACE VIEW v_scammer_activity AS
SELECT 
    wallet_address,
    classification,
    reputation_score,
    rugged_token_count,
    array_length(associated_tokens, 1) as total_tokens,
    flagged_at
FROM known_dev_wallets
WHERE classification IN ('known_scammer', 'suspected') AND is_flagged = TRUE
ORDER BY rugged_token_count DESC;

COMMENT ON VIEW v_scammer_activity IS 'Activity summary for known and suspected scammers';


-- =============================================================================
-- Migration Complete
-- =============================================================================

-- Log migration
DO $$
BEGIN
    RAISE NOTICE 'Scam detection tables migration completed successfully';
END $$;
