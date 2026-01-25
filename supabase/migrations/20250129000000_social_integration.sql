-- Social Media Integration Tables
-- Timestamp: 2025-01-29

-- ============================================
-- Twitter Mentions
-- ============================================
CREATE TABLE IF NOT EXISTS twitter_mentions (
  id BIGSERIAL PRIMARY KEY,
  tweet_id TEXT NOT NULL UNIQUE,
  token_mint TEXT,
  symbol TEXT,
  author_id TEXT NOT NULL,
  author_username TEXT NOT NULL,
  author_followers INTEGER DEFAULT 0,
  text TEXT NOT NULL,
  mentions_count INTEGER DEFAULT 1,
  retweet_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  sentiment_score NUMERIC DEFAULT 0,
  sentiment_label TEXT CHECK(sentiment_label IN ('positive', 'negative', 'neutral')),
  hashtags TEXT[],
  cashtags TEXT[],
  is_influencer BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_twitter_mentions_mint ON twitter_mentions(token_mint);
CREATE INDEX idx_twitter_mentions_symbol ON twitter_mentions(symbol);
CREATE INDEX idx_twitter_mentions_author ON twitter_mentions(author_id);
CREATE INDEX idx_twitter_mentions_created_at ON twitter_mentions(created_at DESC);
CREATE INDEX idx_twitter_mentions_sentiment ON twitter_mentions(sentiment_score);
CREATE INDEX idx_twitter_mentions_influencer ON twitter_mentions(is_influencer);

-- ============================================
-- Influencers
-- ============================================
CREATE TABLE IF NOT EXISTS influencers (
  id BIGSERIAL PRIMARY KEY,
  twitter_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  display_name TEXT,
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  tweet_count INTEGER DEFAULT 0,
  verified BOOLEAN DEFAULT FALSE,
  is_tracked BOOLEAN DEFAULT FALSE,
  added_by TEXT,
  total_mentions INTEGER DEFAULT 0,
  total_calls INTEGER DEFAULT 0,
  successful_calls INTEGER DEFAULT 0,
  failed_calls INTEGER DEFAULT 0,
  avg_return_percent NUMERIC DEFAULT 0,
  success_rate NUMERIC DEFAULT 0,
  last_tweet_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_influencers_twitter_id ON influencers(twitter_id);
CREATE INDEX idx_influencers_username ON influencers(username);
CREATE INDEX idx_influencers_tracked ON influencers(is_tracked);
CREATE INDEX idx_influencers_success_rate ON influencers(success_rate DESC);
CREATE INDEX idx_influencers_followers ON influencers(followers_count DESC);

-- ============================================
-- Influencer Calls (Track their token mentions/predictions)
-- ============================================
CREATE TABLE IF NOT EXISTS influencer_calls (
  id BIGSERIAL PRIMARY KEY,
  influencer_id BIGINT REFERENCES influencers(id) ON DELETE CASCADE,
  twitter_id TEXT NOT NULL,
  tweet_id TEXT NOT NULL UNIQUE,
  token_mint TEXT NOT NULL,
  symbol TEXT,
  call_type TEXT CHECK(call_type IN ('buy', 'sell', 'hold', 'moon', 'warning')) DEFAULT 'buy',
  initial_price NUMERIC,
  current_price NUMERIC,
  max_price NUMERIC,
  price_change_percent NUMERIC DEFAULT 0,
  max_gain_percent NUMERIC DEFAULT 0,
  outcome TEXT CHECK(outcome IN ('success', 'fail', 'pending', NULL)),
  outcome_determined_at TIMESTAMPTZ,
  sentiment_score NUMERIC DEFAULT 0,
  tweet_text TEXT,
  called_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_influencer_calls_influencer ON influencer_calls(influencer_id);
CREATE INDEX idx_influencer_calls_twitter_id ON influencer_calls(twitter_id);
CREATE INDEX idx_influencer_calls_mint ON influencer_calls(token_mint);
CREATE INDEX idx_influencer_calls_outcome ON influencer_calls(outcome);
CREATE INDEX idx_influencer_calls_called_at ON influencer_calls(called_at DESC);

-- ============================================
-- Sentiment Scores (Aggregated by token)
-- ============================================
CREATE TABLE IF NOT EXISTS sentiment_scores (
  id BIGSERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL,
  symbol TEXT,
  timeframe TEXT CHECK(timeframe IN ('1h', '4h', '24h', '7d')) DEFAULT '24h',
  positive_count INTEGER DEFAULT 0,
  negative_count INTEGER DEFAULT 0,
  neutral_count INTEGER DEFAULT 0,
  total_mentions INTEGER DEFAULT 0,
  avg_sentiment_score NUMERIC DEFAULT 0,
  sentiment_trend TEXT CHECK(sentiment_trend IN ('bullish', 'bearish', 'neutral')) DEFAULT 'neutral',
  influencer_mentions INTEGER DEFAULT 0,
  volume_spike BOOLEAN DEFAULT FALSE,
  calculated_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(token_mint, timeframe, calculated_at)
);

CREATE INDEX idx_sentiment_scores_mint ON sentiment_scores(token_mint);
CREATE INDEX idx_sentiment_scores_timeframe ON sentiment_scores(timeframe);
CREATE INDEX idx_sentiment_scores_calculated_at ON sentiment_scores(calculated_at DESC);
CREATE INDEX idx_sentiment_scores_trend ON sentiment_scores(sentiment_trend);

-- ============================================
-- Discord Alerts (Alert delivery log)
-- ============================================
CREATE TABLE IF NOT EXISTS discord_alerts (
  id BIGSERIAL PRIMARY KEY,
  channel_id TEXT NOT NULL,
  guild_id TEXT,
  message_id TEXT,
  alert_type TEXT NOT NULL,
  token_mint TEXT,
  symbol TEXT,
  title TEXT,
  description TEXT,
  severity TEXT CHECK(severity IN ('info', 'warning', 'critical')) DEFAULT 'info',
  sent_successfully BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_discord_alerts_channel ON discord_alerts(channel_id);
CREATE INDEX idx_discord_alerts_type ON discord_alerts(alert_type);
CREATE INDEX idx_discord_alerts_mint ON discord_alerts(token_mint);
CREATE INDEX idx_discord_alerts_sent_at ON discord_alerts(sent_at DESC);
CREATE INDEX idx_discord_alerts_success ON discord_alerts(sent_successfully);

-- ============================================
-- Discord Watchlist (Per guild/user)
-- ============================================
CREATE TABLE IF NOT EXISTS discord_watchlist (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT,
  user_id TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  symbol TEXT,
  name TEXT,
  added_price NUMERIC,
  alert_threshold_percent NUMERIC DEFAULT 10,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, token_mint)
);

CREATE INDEX idx_discord_watchlist_user ON discord_watchlist(user_id);
CREATE INDEX idx_discord_watchlist_guild ON discord_watchlist(guild_id);
CREATE INDEX idx_discord_watchlist_mint ON discord_watchlist(token_mint);

-- ============================================
-- Social Stats Cache (For quick lookups)
-- ============================================
CREATE TABLE IF NOT EXISTS social_stats_cache (
  id BIGSERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL UNIQUE,
  symbol TEXT,
  total_mentions_24h INTEGER DEFAULT 0,
  total_mentions_7d INTEGER DEFAULT 0,
  sentiment_score_24h NUMERIC DEFAULT 0,
  sentiment_trend TEXT,
  influencer_mentions_24h INTEGER DEFAULT 0,
  trending_score NUMERIC DEFAULT 0,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_social_stats_mint ON social_stats_cache(token_mint);
CREATE INDEX idx_social_stats_trending ON social_stats_cache(trending_score DESC);
CREATE INDEX idx_social_stats_updated ON social_stats_cache(last_updated_at DESC);

-- ============================================
-- Helper Functions
-- ============================================

-- Function to update influencer stats
CREATE OR REPLACE FUNCTION update_influencer_stats(influencer_id_param BIGINT)
RETURNS VOID AS $$
BEGIN
  UPDATE influencers SET
    total_calls = (
      SELECT COUNT(*) FROM influencer_calls WHERE influencer_id = influencer_id_param
    ),
    successful_calls = (
      SELECT COUNT(*) FROM influencer_calls 
      WHERE influencer_id = influencer_id_param AND outcome = 'success'
    ),
    failed_calls = (
      SELECT COUNT(*) FROM influencer_calls 
      WHERE influencer_id = influencer_id_param AND outcome = 'fail'
    ),
    avg_return_percent = (
      SELECT COALESCE(AVG(price_change_percent), 0) 
      FROM influencer_calls 
      WHERE influencer_id = influencer_id_param AND outcome IS NOT NULL
    ),
    success_rate = (
      SELECT CASE 
        WHEN COUNT(*) FILTER (WHERE outcome IS NOT NULL) = 0 THEN 0
        ELSE (COUNT(*) FILTER (WHERE outcome = 'success')::NUMERIC / 
              COUNT(*) FILTER (WHERE outcome IS NOT NULL)) * 100
      END
      FROM influencer_calls 
      WHERE influencer_id = influencer_id_param
    ),
    last_updated_at = NOW()
  WHERE id = influencer_id_param;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update influencer stats when calls change
CREATE OR REPLACE FUNCTION trigger_update_influencer_stats()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM update_influencer_stats(NEW.influencer_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_update_influencer_stats ON influencer_calls;
CREATE TRIGGER auto_update_influencer_stats
  AFTER INSERT OR UPDATE ON influencer_calls
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_influencer_stats();

-- Function to calculate sentiment aggregates
CREATE OR REPLACE FUNCTION calculate_sentiment_scores(
  token_mint_param TEXT,
  timeframe_param TEXT DEFAULT '24h'
)
RETURNS TABLE (
  positive INTEGER,
  negative INTEGER,
  neutral INTEGER,
  total INTEGER,
  avg_score NUMERIC,
  trend TEXT
) AS $$
DECLARE
  hours_back INTEGER;
BEGIN
  -- Convert timeframe to hours
  hours_back := CASE timeframe_param
    WHEN '1h' THEN 1
    WHEN '4h' THEN 4
    WHEN '24h' THEN 24
    WHEN '7d' THEN 168
    ELSE 24
  END;

  RETURN QUERY
  SELECT 
    COUNT(*) FILTER (WHERE sentiment_label = 'positive')::INTEGER,
    COUNT(*) FILTER (WHERE sentiment_label = 'negative')::INTEGER,
    COUNT(*) FILTER (WHERE sentiment_label = 'neutral')::INTEGER,
    COUNT(*)::INTEGER,
    COALESCE(AVG(sentiment_score), 0),
    CASE 
      WHEN AVG(sentiment_score) > 0.2 THEN 'bullish'
      WHEN AVG(sentiment_score) < -0.2 THEN 'bearish'
      ELSE 'neutral'
    END
  FROM twitter_mentions
  WHERE token_mint = token_mint_param
    AND created_at >= NOW() - (hours_back || ' hours')::INTERVAL;
END;
$$ LANGUAGE plpgsql;
