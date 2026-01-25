# Database Initialization & Health Improvements

## ✅ Implemented Features

### 1. Auto-Migration System (`apps/bot/src/database/migrator.ts`)
- **Automatic Schema Migrations**: Detects current version and runs all pending migrations automatically on startup
- **Retry Logic**: Up to 3 attempts per migration with exponential backoff (1s, 2s, 3s)
- **Migration Tracking**: Records all migrations in `schema_migrations` table with timestamps and execution times
- **Failure Handling**: Records failed migrations with error messages for debugging
- **Schema Validation**: Verifies critical tables exist after migrations
- **Migration History**: Track successful and failed migrations over time
- **Progress Logging**: Clear logs for each migration step

**Key Methods:**
- `runMigrations()` - Execute all pending migrations
- `getCurrentVersion()` - Get current schema version
- `validateSchema()` - Verify database integrity
- `getStats()` - Migration statistics

### 2. Database Health Monitoring (`apps/bot/src/database/health.ts`)
- **Comprehensive Health Checks**: Connection, schema, integrity, and performance checks
- **Connection Testing**: Measures database response time
- **Table Verification**: Ensures all critical tables exist
- **Integrity Checks**: Runs SQLite integrity check (PRAGMA integrity_check)
- **Performance Metrics**: Tracks record counts and database size
- **Periodic Health Checks**: Runs automatically every 5 minutes
- **Health Status API**: Exposes health data via `/health` endpoint
- **Size Warnings**: Alerts when database exceeds 500MB

**Key Methods:**
- `healthCheck()` - Run full health check
- `startPeriodicHealthChecks()` - Start automatic health monitoring
- `isHealthy()` - Quick status check
- `getLastHealthCheck()` - Get last health check result

### 3. Database Backup System (`apps/bot/src/database/backup.ts`)
- **Automated Backups**: Daily backups by default (configurable interval)
- **Compression**: Automatic gzip compression for backups >1MB
- **Backup Rotation**: Keeps last 7 backups, auto-deletes older ones
- **Backup on Shutdown**: Creates final backup before database closes
- **Restore Capability**: Can restore from any backup file
- **Backup Statistics**: Track backup count, size, and dates

**Backup Naming:** `bot-db-YYYY-MM-DD_HH-MM-SS.db[.gz]`

**Key Methods:**
- `createBackup()` - Create immediate backup
- `startAutomaticBackups()` - Schedule automatic backups
- `restoreBackup()` - Restore from backup file
- `listBackups()` - Get all available backups
- `cleanupOldBackups()` - Remove old backups

### 4. Enhanced Database Service (`apps/bot/src/database/index.ts`)
**Improvements:**
- **Retry Logic on Initialization**: Up to 3 attempts with exponential backoff
- **Graceful Shutdown**: Flushes pending writes, creates final backup
- **Auto-Migration Integration**: Runs migrations automatically on startup
- **Health Check Integration**: Periodic health monitoring
- **Backup Integration**: Automatic daily backups
- **Connection Pooling**: Better handling of concurrent operations (sql.js is single-threaded, but retry logic handles locks)

**New Methods:**
- `healthCheck()` - Run database health check
- `createBackup()` - Create manual backup
- `getMigrationInfo()` - Get migration statistics
- `getBackupInfo()` - Get backup statistics

### 5. Graceful Shutdown (`apps/bot/src/index.ts`)
**Enhanced shutdown process:**
1. Stop all monitors and services
2. Stop periodic health checks
3. Stop automatic backups
4. Flush pending database writes
5. Create final backup
6. Close database connections
7. Clean exit

**Signal Handling:**
- `SIGINT` (Ctrl+C) - Graceful shutdown
- `SIGTERM` (kill) - Graceful shutdown

### 6. Enhanced Health API (`apps/bot/src/api/server.ts`)
**`/health` and `/api/health` endpoints now include:**
- Database connection status and latency
- Schema version and migration status
- Backup count and total size
- Table count and record count
- Comprehensive error messages

**Response format:**
```json
{
  "status": "healthy",
  "timestamp": 1234567890,
  "uptime": 3600,
  "checks": {
    "solana_rpc": { "status": "healthy", "latencyMs": 123 },
    "database": { "status": "healthy", "message": "Schema v12 | 15 tables | 1,234 records" },
    "database_migrations": { "status": "healthy", "message": "v12 (0 pending)" },
    "database_backups": { "status": "healthy", "message": "7 backups | 45.23 MB" }
  }
}
```

## 📁 Files Created
1. `apps/bot/src/database/migrator.ts` - Migration system
2. `apps/bot/src/database/health.ts` - Health monitoring
3. `apps/bot/src/database/backup.ts` - Backup system

## 📝 Files Modified
1. `apps/bot/src/database/index.ts` - Enhanced initialization and shutdown
2. `apps/bot/src/index.ts` - Improved graceful shutdown
3. `apps/bot/src/api/server.ts` - Enhanced health endpoint

## 🔍 Migration Process
1. **On Startup**: Database checks for `schema_migrations` table
2. **Version Check**: Reads current schema version from database
3. **Pending Detection**: Compares with MIGRATIONS array (v1-v12)
4. **Auto-Execute**: Runs each pending migration sequentially
5. **Failure Handling**: Retries up to 3 times with backoff
6. **Recording**: Logs success/failure in `schema_migrations` table
7. **Health Check**: Verifies database integrity after migrations

## 🏥 Health Monitoring
- **Automatic**: Health check runs every 5 minutes
- **Manual**: Call `/health` or `/api/health` endpoint
- **Startup**: Initial health check after initialization
- **Checks**:
  - ✅ Database connection (latency test)
  - ✅ Critical tables exist
  - ✅ Schema integrity (PRAGMA integrity_check)
  - ✅ Performance metrics (record counts, DB size)
  - ✅ Migration status
  - ✅ Backup status

## 💾 Backup Strategy
- **Daily Backups**: Automatic backup every 24 hours
- **Compression**: Gzip compression for files >1MB
- **Retention**: Keep last 7 backups
- **Location**: `data/backups/` directory
- **Shutdown Backup**: Creates backup before closing database
- **Size Monitoring**: Tracks total backup size

## 🛠️ Usage Examples

### Trigger Manual Backup
```bash
# Via Telegram (if command exists)
/backup

# Or programmatically
await database.createBackup();
```

### Check Database Health
```bash
# Via API
curl http://localhost:3001/health

# Or programmatically
const health = await database.healthCheck();
console.log(health);
```

### View Migration Status
```typescript
const info = database.getMigrationInfo();
console.log(`Schema v${info.currentVersion}`);
console.log(`${info.pendingMigrations} pending migrations`);
```

### View Backup Status
```typescript
const info = database.getBackupInfo();
console.log(`${info.totalBackups} backups`);
console.log(`Total size: ${(info.totalSizeBytes / 1024 / 1024).toFixed(2)} MB`);
```

## 🔧 Configuration
All features are enabled by default with sensible defaults:
- **Health checks**: Every 5 minutes
- **Backups**: Every 24 hours
- **Backup retention**: 7 backups
- **Migration retries**: 3 attempts
- **Retry backoff**: 1s, 2s, 3s

## 🚀 Benefits
1. **Zero-downtime migrations**: Automatic schema updates
2. **Reliability**: Retry logic handles transient failures
3. **Observability**: Health checks expose database status
4. **Data safety**: Automatic backups + graceful shutdown
5. **Debugging**: Migration history tracks all schema changes
6. **Performance monitoring**: Track database growth over time

## 📊 Monitoring
**Check health via API:**
```bash
curl http://localhost:3001/health | jq
```

**Expected healthy response:**
- `status: "healthy"`
- All checks show green
- Low latency (<1000ms)
- No pending migrations
- Recent backups exist

## 🔴 Troubleshooting

### Database Won't Start
- Check logs for migration failures
- Verify `data/backups/` directory permissions
- Try restoring from last backup

### Failed Migration
- Migration failures are recorded in `schema_migrations`
- Check error message for details
- May need manual intervention if schema is corrupted

### Health Check Failures
- Check connection latency
- Verify table integrity with SQLite browser
- Run manual integrity check: `PRAGMA integrity_check`

### Large Database Size
- Health checks warn when >500MB
- Run cleanup: `database.cleanup(30)` (keep last 30 days)
- Check old snapshots and outcomes

## 🎯 Next Steps (Future Improvements)
- [ ] Add database performance profiling
- [ ] Add query performance monitoring
- [ ] Add automatic vacuum/optimization
- [ ] Add replication support
- [ ] Add point-in-time recovery
- [ ] Add migration rollback support
- [ ] Add database metrics to dashboard

---

**Status**: ✅ All features implemented and ready for testing
