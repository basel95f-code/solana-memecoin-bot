# Database Architecture

## Overview

The Solana Memecoin Bot supports two database backends:

1. **SQLite** (default) - Local file-based database for development
2. **Supabase** (recommended for production) - Cloud PostgreSQL with real-time features

## Database Selection

Set in `.env`:
```bash
DATABASE_TYPE=supabase  # or 'sqlite'
```

## SQLite (Development)

### Advantages
- ✅ Zero configuration
- ✅ No external dependencies
- ✅ Fast local development
- ✅ Portable (single file)

### Limitations
- ❌ Single-writer (not suitable for multiple instances)
- ❌ No remote access
- ❌ Manual backups required
- ❌ Limited scalability

### Configuration
```bash
DATABASE_TYPE=sqlite
DATABASE_PATH=data/bot.db
```

### Backup
```bash
# Manual backup
cp data/bot.db data/bot.db.backup

# Automatic backups (configured in code)
# - Daily backups to data/backups/
# - Keeps last 7 days
```

## Supabase (Production)

### Advantages
- ✅ Cloud-hosted PostgreSQL
- ✅ Automatic backups and point-in-time recovery
- ✅ Real-time WebSocket subscriptions
- ✅ Auto-generated REST API
- ✅ Row Level Security (RLS)
- ✅ Built-in dashboard and SQL editor
- ✅ Scales to millions of records
- ✅ Multi-instance support

### Setup

1. **Create Supabase Project**
   - Go to https://supabase.com
   - Create new project
   - Copy URL and keys

2. **Configure Environment**
   ```bash
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_ANON_KEY=eyJhbGc...
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
   DATABASE_TYPE=supabase
   ```

3. **Run Migrations**
   ```bash
   # From project root
   cd supabase
   npx supabase db push

   # Or manually via Supabase Dashboard SQL Editor
   ```

4. **Migrate Data** (if migrating from SQLite)
   ```bash
   npm run migrate:data
   ```

See [SUPABASE_MIGRATION.md](./SUPABASE_MIGRATION.md) for detailed migration guide.

## Schema

### Core Tables

#### token_analysis
Stores token analysis results and risk metrics.
```sql
- id: BIGSERIAL PRIMARY KEY
- mint: TEXT (token address)
- symbol: TEXT
- name: TEXT
- risk_score: INTEGER (0-100)
- risk_level: TEXT (LOW/MEDIUM/HIGH/CRITICAL)
- liquidity_usd: NUMERIC
- lp_burned_percent: NUMERIC
- lp_locked_percent: NUMERIC
- total_holders: INTEGER
- top10_percent: NUMERIC
- mint_revoked: BOOLEAN
- freeze_revoked: BOOLEAN
- is_honeypot: BOOLEAN
- has_twitter: BOOLEAN
- has_telegram: BOOLEAN
- has_website: BOOLEAN
- source: TEXT
- ml_rug_probability: NUMERIC
- ml_confidence: NUMERIC
- analyzed_at: TIMESTAMPTZ
```

#### alert_history
Tracks all alerts sent to prevent duplicates.
```sql
- id: BIGSERIAL PRIMARY KEY
- mint: TEXT
- symbol: TEXT
- chat_id: TEXT
- alert_type: TEXT
- risk_score: INTEGER
- risk_level: TEXT
- sent_at: TIMESTAMPTZ
```

#### pool_discovery
Logs newly discovered liquidity pools.
```sql
- id: BIGSERIAL PRIMARY KEY
- pool_address: TEXT UNIQUE
- token_mint: TEXT
- source: TEXT
- initial_liquidity_usd: NUMERIC
- discovered_at: TIMESTAMPTZ
```

#### token_outcomes
ML training data - tracks what happened to tokens.
```sql
- id: BIGSERIAL PRIMARY KEY
- mint: TEXT UNIQUE
- symbol: TEXT
- initial_price: NUMERIC
- peak_price: NUMERIC
- final_price: NUMERIC
- outcome: TEXT (rug/pump/stable/decline)
- outcome_confidence: NUMERIC
- peak_price_multiplier: NUMERIC
- discovered_at: TIMESTAMPTZ
- outcome_recorded_at: TIMESTAMPTZ
```

### Backtest Tables

#### backtest_strategies
Saved trading strategies for backtesting.
```sql
- id: BIGSERIAL PRIMARY KEY
- name: TEXT UNIQUE
- description: TEXT
- entry_conditions: JSONB
- exit_conditions: JSONB
- position_sizing: JSONB
- is_preset: BOOLEAN
```

#### backtest_runs
Results from backtest executions.
```sql
- id: BIGSERIAL PRIMARY KEY
- strategy_id: INTEGER
- strategy_name: TEXT
- start_date: TIMESTAMPTZ
- end_date: TIMESTAMPTZ
- total_trades: INTEGER
- win_rate: NUMERIC
- total_return: NUMERIC
- max_drawdown: NUMERIC
- sharpe_ratio: NUMERIC
```

#### backtest_trades
Individual trades from backtest runs.
```sql
- id: BIGSERIAL PRIMARY KEY
- run_id: INTEGER
- token_mint: TEXT
- entry_price: NUMERIC
- exit_price: NUMERIC
- profit_loss_percent: NUMERIC
- hold_time_seconds: INTEGER
```

### ML Tables

#### ml_training_samples
Feature vectors for ML model training.
```sql
- id: BIGSERIAL PRIMARY KEY
- mint: TEXT
- features: JSONB (25 normalized features)
- outcome: TEXT
- outcome_confidence: NUMERIC
- label_source: TEXT (auto/manual)
```

#### ml_model_versions
Tracks ML model training runs and metrics.
```sql
- id: BIGSERIAL PRIMARY KEY
- version: TEXT UNIQUE
- accuracy: NUMERIC
- precision_score: NUMERIC
- f1_score: NUMERIC
- is_active: BOOLEAN
- trained_at: TIMESTAMPTZ
```

#### prediction_performance
Tracks prediction accuracy over time.
```sql
- id: BIGSERIAL PRIMARY KEY
- model_version: TEXT
- token_mint: TEXT
- predicted_outcome: TEXT
- actual_outcome: TEXT
- was_correct: BOOLEAN
```

### Portfolio Tables

#### positions
Active and closed trading positions.
```sql
- id: BIGSERIAL PRIMARY KEY
- token_mint: TEXT
- side: TEXT (long/short)
- entry_price: NUMERIC
- current_price: NUMERIC
- unrealized_pnl: NUMERIC
- status: TEXT (open/closed)
```

#### trades
Trade execution history.
```sql
- id: BIGSERIAL PRIMARY KEY
- token_mint: TEXT
- action: TEXT (open/close/partial_close)
- entry_price: NUMERIC
- realized_pnl: NUMERIC
- timestamp: TIMESTAMPTZ
```

#### portfolio_snapshots
Periodic portfolio value snapshots for charts.
```sql
- id: BIGSERIAL PRIMARY KEY
- timestamp: TIMESTAMPTZ
- total_value: NUMERIC
- unrealized_pnl: NUMERIC
- realized_pnl: NUMERIC
```

### Smart Money Tables

#### smart_money_wallets
Wallets with consistent profitable trading patterns.
```sql
- id: BIGSERIAL PRIMARY KEY
- wallet_address: TEXT UNIQUE
- total_trades: INTEGER
- win_rate: NUMERIC
- total_profit_sol: NUMERIC
- reputation_score: INTEGER
```

#### smart_money_trades
Individual trades by smart money wallets.
```sql
- id: BIGSERIAL PRIMARY KEY
- wallet_address: TEXT
- token_mint: TEXT
- entry_price: NUMERIC
- profit_percent: NUMERIC
- status: TEXT (open/closed)
```

### Group Chat Tables

#### group_settings
Configuration for each Telegram group.
```sql
- id: BIGSERIAL PRIMARY KEY
- chat_id: TEXT UNIQUE
- enable_token_alerts: BOOLEAN
- min_risk_score: INTEGER
- max_alerts_per_hour: INTEGER
```

#### group_watchlist
Shared watchlist for group members.
```sql
- id: BIGSERIAL PRIMARY KEY
- chat_id: TEXT
- token_mint: TEXT
- added_by_user_id: BIGINT
- added_at: TIMESTAMPTZ
```

#### leaderboard_entries
Tracks user token discoveries for gamification.
```sql
- id: BIGSERIAL PRIMARY KEY
- chat_id: TEXT
- user_id: BIGINT
- token_mint: TEXT
- peak_multiplier: NUMERIC
- score: NUMERIC
```

## Indexes

All tables have appropriate indexes for performance:
- Primary keys (BIGSERIAL)
- Foreign keys
- Query columns (mint, chat_id, timestamps)
- Composite indexes for complex queries

Example:
```sql
CREATE INDEX idx_token_analysis_mint ON token_analysis(mint);
CREATE INDEX idx_token_analysis_analyzed_at ON token_analysis(analyzed_at DESC);
CREATE INDEX idx_alert_history_chat_mint ON alert_history(chat_id, mint);
```

## Row Level Security (RLS)

Supabase tables use RLS policies:

```sql
-- Allow all reads (public data)
CREATE POLICY "Allow read access" ON token_analysis FOR SELECT USING (true);

-- Service role can write (bot operations)
CREATE POLICY "Allow service write" ON token_analysis FOR ALL 
  USING (true) WITH CHECK (true);
```

## Helper Functions

PostgreSQL functions for common operations:

```sql
-- Increment snapshot count
SELECT increment_snapshot_count('token_mint');

-- Clean up old data
SELECT cleanup_old_snapshots(30);  -- days
SELECT cleanup_old_price_history(30);

-- Get leaderboard
SELECT * FROM get_chat_leaderboard('chat_id', 10);

-- Update smart money stats
SELECT update_smart_money_stats('wallet_address');
```

## Data Retention

### Automatic Cleanup
- **Snapshots:** 30 days
- **Price history:** 30 days
- **Pool discoveries:** 7 days
- **Bot status:** 24 hours

### Manual Cleanup
```sql
-- Supabase SQL Editor
SELECT cleanup_old_snapshots(30);
SELECT cleanup_old_price_history(30);
SELECT cleanup_old_pool_discoveries(7);
```

## Backup & Recovery

### Supabase (Automatic)
- Point-in-time recovery (PITR)
- Daily automatic backups
- 7-day retention on free tier
- Longer retention on paid tiers

### SQLite (Manual)
```bash
# Create backup
npm run db:backup

# Restore from backup
cp data/backups/bot.db.backup-[timestamp] data/bot.db
```

## Performance

### Connection Pooling
- Pool size: 10 connections
- Managed by Supabase client

### Query Optimization
- Use indexes for all queries
- Batch inserts (100 rows)
- Limit result sets
- Use `select()` projections

### Monitoring
```sql
-- Slow query log (Supabase Dashboard)
SELECT * FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;

-- Table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## Migrations

### Creating Migrations
```bash
# Using Supabase CLI
supabase migration new my_feature

# Edit migration file
# supabase/migrations/[timestamp]_my_feature.sql

# Apply migration
supabase db push
```

### Migration History
All migrations are in `supabase/migrations/`:
- `20240117000000_initial_schema.sql`
- `20250127000000_complete_schema.sql`
- `20250127000001_helper_functions.sql`

## API Access

### Supabase Auto-generated API
```typescript
// REST API example
const { data } = await supabase
  .from('token_analysis')
  .select('*')
  .eq('mint', tokenMint)
  .single();

// Real-time subscription
supabase
  .channel('pool_discoveries')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'pool_discovery'
  }, (payload) => {
    console.log('New pool discovered!', payload);
  })
  .subscribe();
```

## Best Practices

1. **Use transactions** for multi-table operations
2. **Batch inserts** instead of individual inserts
3. **Index frequently queried columns**
4. **Clean up old data** regularly
5. **Monitor slow queries**
6. **Use RLS policies** for security
7. **Version control migrations**
8. **Test migrations** on staging first
9. **Backup before major changes**
10. **Use service role key** for bot operations

## Troubleshooting

### Connection Issues
- Verify SUPABASE_URL and keys
- Check project is not paused
- Verify network connectivity

### Slow Queries
- Add indexes
- Limit result sets
- Use query profiling

### Migration Errors
- Check for schema conflicts
- Verify foreign key constraints
- Review RLS policies

### Data Inconsistencies
- Run integrity checks
- Compare SQLite vs Supabase counts
- Review migration logs

## Further Reading

- [Supabase Documentation](https://supabase.com/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Migration Guide](./SUPABASE_MIGRATION.md)
