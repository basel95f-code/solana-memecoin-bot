# Supabase Migration Guide

This guide covers migrating from SQLite to Supabase (PostgreSQL) for production deployment.

## Why Migrate to Supabase?

- ✅ **Cloud-hosted PostgreSQL** - No local database files
- ✅ **Real-time capabilities** - WebSocket subscriptions for live updates
- ✅ **Scalability** - Handle millions of records
- ✅ **Automatic backups** - Built-in backup and restore
- ✅ **Row Level Security** - Fine-grained access control
- ✅ **REST API** - Auto-generated API for dashboard/analytics
- ✅ **Dashboard UI** - Visual database explorer

## Prerequisites

1. **Supabase Account**
   - Sign up at https://supabase.com
   - Create a new project
   - Note your project URL and API keys

2. **Environment Variables**
   ```bash
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key-here
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
   DATABASE_TYPE=supabase
   ```

3. **Dependencies**
   - Already installed: `@supabase/supabase-js` ✅

## Migration Steps

### Step 1: Set Up Supabase Project

1. **Create Project**
   ```bash
   # Install Supabase CLI (optional but recommended)
   npm install -g supabase
   
   # Link to your Supabase project
   supabase link --project-ref your-project-ref
   ```

2. **Run Migrations**
   ```bash
   # Apply schema migrations
   supabase db push
   
   # Or manually run migrations from Supabase Dashboard:
   # - Go to SQL Editor
   # - Copy contents of supabase/migrations/*.sql
   # - Execute each migration in order
   ```

### Step 2: Test Connection

```bash
# Test Supabase connection
npm run db:test
```

Or manually in Node.js:
```typescript
import { testConnection } from './apps/bot/src/database/supabase';

await testConnection();
```

### Step 3: Backup SQLite Data

**IMPORTANT: Always backup before migrating!**

```bash
# Create backup
cp data/bot.db data/bot.db.backup-$(date +%s)

# Verify backup exists
ls -lh data/bot.db.backup-*
```

### Step 4: Run Migration Script

```bash
# Migrate all data from SQLite to Supabase
npm run migrate:data

# This will:
# - Create automatic SQLite backup
# - Export all tables from SQLite
# - Transform data for PostgreSQL
# - Import to Supabase in batches
# - Verify data integrity
# - Generate migration report
```

### Step 5: Verify Migration

```bash
# Check migration report
cat data/migration-report-*.json

# Verify record counts in Supabase Dashboard
# Navigate to: Table Editor -> select table -> check row count
```

### Step 6: Switch to Supabase

Update `.env`:
```bash
DATABASE_TYPE=supabase
```

Restart the bot:
```bash
npm run dev:bot
```

### Step 7: Monitor

Watch logs for any errors:
```bash
# Check bot logs
tail -f logs/bot.log

# Check Supabase logs in dashboard
# Navigate to: Logs -> select log type
```

## Rollback Plan

If something goes wrong:

### Option 1: Restore SQLite
```bash
# Rollback to SQLite backup
npm run migrate:rollback data/bot.db.backup-[timestamp]

# Update .env
DATABASE_TYPE=sqlite

# Restart bot
npm run dev:bot
```

### Option 2: Clear Supabase and Re-migrate
```sql
-- In Supabase SQL Editor, truncate all tables:
TRUNCATE TABLE token_analysis CASCADE;
TRUNCATE TABLE alert_history CASCADE;
-- ... (repeat for all tables)

-- Then re-run migration
npm run migrate:data
```

## Migration Scripts

### Package.json Scripts
Add these to `apps/bot/package.json`:

```json
{
  "scripts": {
    "migrate:data": "ts-node scripts/migrate-to-supabase.ts migrate",
    "migrate:rollback": "ts-node scripts/migrate-to-supabase.ts rollback",
    "db:test": "ts-node -e \"import('./src/database/supabase').then(m => m.testConnection())\""
  }
}
```

## Performance Tuning

### Indexes
All critical indexes are created in migrations. Monitor slow queries:
```sql
-- In Supabase SQL Editor
SELECT * FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;
```

### Connection Pooling
Configured in `apps/bot/src/database/supabase.ts`:
- Pool size: 10 connections
- Auto-managed by Supabase

### Batch Operations
Migration script uses batches of 100 rows for optimal performance.

## Troubleshooting

### Connection Errors

**Problem:** `Failed to connect to Supabase`

**Solutions:**
1. Check SUPABASE_URL and keys in .env
2. Verify project is not paused (free tier)
3. Check network/firewall settings
4. Verify Service Role Key (not Anon Key) is used

### Migration Timeouts

**Problem:** Large tables timeout during migration

**Solutions:**
1. Increase batch size in `scripts/migrate-to-supabase.ts`
2. Migrate tables individually:
   ```typescript
   await migration.migrateTable('token_analysis');
   ```
3. Use Supabase CLI for large datasets:
   ```bash
   supabase db dump > backup.sql
   supabase db push --file backup.sql
   ```

### Data Type Mismatches

**Problem:** Column type errors during import

**Solutions:**
1. Check `COLUMN_MAPPINGS` in migration script
2. Manually transform data before import
3. Update Supabase schema to match SQLite types

### RLS Policy Errors

**Problem:** `new row violates row-level security policy`

**Solutions:**
1. Use SERVICE_ROLE_KEY (not ANON_KEY)
2. Verify RLS policies in `supabase/migrations/`
3. Temporarily disable RLS during migration (not recommended)

## Monitoring & Maintenance

### Daily Tasks
```sql
-- Clean up old snapshots (run daily)
SELECT cleanup_old_snapshots(30);

-- Clean up old price history
SELECT cleanup_old_price_history(30);

-- Clean up old pool discoveries
SELECT cleanup_old_pool_discoveries(7);
```

### Weekly Tasks
- Review slow query logs
- Check database size
- Verify backup status

### Monthly Tasks
- Review and optimize indexes
- Analyze query patterns
- Update RLS policies if needed

## Schema Changes

When adding new tables or columns:

1. **Create Migration**
   ```bash
   supabase migration new add_new_feature
   ```

2. **Write SQL**
   ```sql
   -- supabase/migrations/[timestamp]_add_new_feature.sql
   CREATE TABLE new_feature (
     id BIGSERIAL PRIMARY KEY,
     ...
   );
   ```

3. **Apply Migration**
   ```bash
   supabase db push
   ```

4. **Update TypeScript**
   - Update interfaces in `src/database/supabase-db.ts`
   - Add methods for new tables

## Cost Considerations

### Free Tier Limits
- 500 MB database size
- 2 GB bandwidth/month
- Paused after 1 week of inactivity

### Optimization Tips
1. **Clean up old data regularly**
2. **Use selective syncing** (only recent data)
3. **Archive historical data** to cold storage
4. **Monitor usage** in Supabase Dashboard

## Support

- **Supabase Docs:** https://supabase.com/docs
- **Discord:** https://discord.supabase.com
- **GitHub Issues:** File issues in the bot repository

## Next Steps

After successful migration:

1. ✅ **Enable Real-time** for live dashboard updates
2. ✅ **Set up webhooks** for database events
3. ✅ **Create database views** for analytics
4. ✅ **Add composite indexes** for complex queries
5. ✅ **Set up scheduled cleanups** via Supabase Functions

---

**Migration Checklist:**
- [ ] Supabase project created
- [ ] Environment variables set
- [ ] Migrations applied
- [ ] Connection tested
- [ ] SQLite backed up
- [ ] Data migrated
- [ ] Migration verified
- [ ] Bot restarted with Supabase
- [ ] Monitoring enabled
- [ ] Old SQLite backup stored safely
