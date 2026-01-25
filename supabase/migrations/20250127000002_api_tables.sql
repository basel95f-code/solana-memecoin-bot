-- ============================================
-- API Key Management Tables
-- For REST API authentication and usage tracking
-- ============================================

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE, -- Hashed API key
  name TEXT NOT NULL, -- Friendly name for the key
  user_id TEXT, -- Optional user ID
  rate_limit INTEGER NOT NULL DEFAULT 60, -- Requests per minute
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

-- API Usage tracking table
CREATE TABLE IF NOT EXISTS api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL, -- Minute-level timestamp
  request_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(key_id, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_api_usage_key ON api_usage(key_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_timestamp ON api_usage(timestamp);

-- Alert Rules table
CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL, -- API key ID or user ID
  name TEXT NOT NULL,
  conditions JSONB NOT NULL, -- Alert conditions
  webhook_url TEXT, -- Optional webhook URL
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_user ON alert_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_active ON alert_rules(is_active);

-- Function to increment API usage
CREATE OR REPLACE FUNCTION increment_api_usage(
  p_key_id UUID,
  p_timestamp TIMESTAMPTZ
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO api_usage (key_id, timestamp, request_count)
  VALUES (p_key_id, p_timestamp, 1)
  ON CONFLICT (key_id, timestamp)
  DO UPDATE SET request_count = api_usage.request_count + 1;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old API usage records (keep last 7 days)
CREATE OR REPLACE FUNCTION cleanup_api_usage()
RETURNS VOID AS $$
BEGIN
  DELETE FROM api_usage
  WHERE timestamp < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Optional: Schedule cleanup (requires pg_cron extension)
-- SELECT cron.schedule('cleanup-api-usage', '0 2 * * *', 'SELECT cleanup_api_usage()');

COMMENT ON TABLE api_keys IS 'API keys for REST API authentication';
COMMENT ON TABLE api_usage IS 'API usage tracking for rate limiting';
COMMENT ON TABLE alert_rules IS 'User-defined alert rules';
