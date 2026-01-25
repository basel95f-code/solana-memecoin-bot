# 🚀 Production Deployment Guide

Complete guide for deploying the Solana Memecoin Bot to production with 24/7 reliability.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Docker Deployment](#docker-deployment)
4. [PM2 Deployment](#pm2-deployment)
5. [Monitoring Setup](#monitoring-setup)
6. [Backup & Restore](#backup--restore)
7. [CI/CD Pipeline](#cicd-pipeline)
8. [Troubleshooting](#troubleshooting)
9. [Security Best Practices](#security-best-practices)

---

## Prerequisites

### System Requirements

- **OS**: Ubuntu 20.04+ or any Linux distribution
- **CPU**: 2+ cores recommended
- **RAM**: 2GB minimum, 4GB recommended
- **Storage**: 20GB minimum
- **Node.js**: 20.x LTS
- **Docker**: 24.0+ (if using Docker)
- **Docker Compose**: 2.20+ (if using Docker)

### Required Services

1. **Telegram Bot Token** - Get from @BotFather
2. **Helius API Key** - For reliable Solana RPC (required for production)
3. **Supabase Project** - For PostgreSQL database
4. **Redis** - For caching (included in Docker setup)

### Optional Services

- Discord webhook (for alerts)
- Sentry (for error tracking)
- Email service (SendGrid/Resend)
- FlareSolverr (for Cloudflare bypass)

---

## Quick Start

### 1. Clone Repository

```bash
git clone https://github.com/youruser/solana-memecoin-bot.git
cd solana-memecoin-bot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

```bash
cp .env.production.example .env.production
# Edit .env.production with your values
nano .env.production
```

**Critical values to set:**
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `HELIUS_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REDIS_URL`

### 4. Build Application

```bash
npm run build
```

### 5. Deploy

**Option A: Docker (Recommended)**
```bash
./scripts/deploy/deploy-local.sh
```

**Option B: PM2**
```bash
pm2 start ecosystem.config.js --env production
```

---

## Docker Deployment

### Architecture

```
┌─────────────────┐
│  Web Dashboard  │ :80
│   (Nginx)       │
└────────┬────────┘
         │
┌────────▼────────┐
│   Bot Service   │ :3000
│   (Node.js)     │
└────┬───────┬────┘
     │       │
┌────▼──┐ ┌─▼────┐
│ Redis │ │ PG   │
│ :6379 │ │ :5432│
└───────┘ └──────┘
```

### Services

1. **bot** - Main application (apps/bot)
2. **web** - Dashboard (apps/web)
3. **redis** - Cache & queue
4. **postgres** - Database (optional if using Supabase cloud)

### Deployment Steps

#### 1. Build Images

```bash
docker-compose build
```

#### 2. Deploy

```bash
# Local testing
./scripts/deploy/deploy-local.sh

# Production deployment
./scripts/deploy/deploy-production.sh
```

#### 3. Verify

```bash
# Check service status
docker-compose ps

# View logs
docker-compose logs -f

# Health checks
curl http://localhost:3000/health  # Bot API
curl http://localhost:80/health    # Web Dashboard
```

### Docker Commands Cheat Sheet

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Restart services
docker-compose restart

# View logs
docker-compose logs -f [service]

# Execute command in container
docker exec -it memecoin-bot sh

# Scale services
docker-compose up -d --scale bot=2

# Clean up
docker system prune -a
```

---

## PM2 Deployment

PM2 provides process management without Docker containerization.

### Installation

```bash
npm install -g pm2
```

### Start Services

```bash
# Start all services
pm2 start ecosystem.config.js --env production

# Start specific service
pm2 start ecosystem.config.js --only memecoin-bot
```

### Monitoring

```bash
# Dashboard
pm2 monit

# List processes
pm2 list

# Logs
pm2 logs

# Specific service logs
pm2 logs memecoin-bot
```

### Management

```bash
# Restart
pm2 restart memecoin-bot

# Stop
pm2 stop memecoin-bot

# Delete
pm2 delete memecoin-bot

# Reload (zero-downtime)
pm2 reload memecoin-bot

# Show process info
pm2 show memecoin-bot
```

### Auto-Start on System Reboot

```bash
# Generate startup script
pm2 startup

# Save current process list
pm2 save
```

### Log Management

PM2 automatically rotates logs. Configure in `ecosystem.config.js`:

```javascript
{
  max_size: '100M',  // Rotate at 100MB
  max_files: 10,     // Keep 10 files
  compress: true     // Compress rotated logs
}
```

---

## Monitoring Setup

### Built-in Performance Monitor

The bot includes a performance monitoring system in `apps/bot/src/performance/monitor.ts`.

**Features:**
- Response time tracking (avg, p50, p95, p99)
- Cache hit rate monitoring
- Memory usage tracking
- Success/failure rate monitoring
- Slow operation detection

**Access metrics:**
```bash
# Via API
curl http://localhost:3000/api/metrics

# Via logs
grep "Performance Metrics" logs/pm2-combined.log
```

### Health Check Endpoints

**Bot API:**
```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": 1234567890,
  "uptime": 3600,
  "memory": {
    "used": 512,
    "limit": 1024
  },
  "services": {
    "database": "connected",
    "redis": "connected",
    "telegram": "connected"
  }
}
```

### Alerts

Configure alerts in `.env.production`:

```env
# Memory threshold (%)
MEMORY_ALERT_THRESHOLD=80

# CPU threshold (%)
CPU_ALERT_THRESHOLD=80

# Error rate threshold (errors/min)
ERROR_RATE_THRESHOLD=10

# Alert destinations
ALERT_TELEGRAM=true
ALERT_DISCORD=true
ALERT_EMAIL=true
```

### External Monitoring

**Recommended tools:**

1. **Uptime Monitoring**: UptimeRobot, Pingdom
2. **Error Tracking**: Sentry (already integrated)
3. **Log Management**: Logtail, Papertrail
4. **APM**: New Relic, Datadog

**Setup Sentry:**
```env
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project
```

---

## Backup & Restore

### Automated Backups

**Configure automatic backups:**

```env
BACKUP_ENABLED=true
BACKUP_SCHEDULE="0 3 * * *"  # 3 AM daily
BACKUP_RETENTION_DAYS=7
```

**Setup cron job:**
```bash
crontab -e

# Add:
0 3 * * * cd /path/to/bot && ./scripts/deploy/backup.sh
```

### Manual Backup

```bash
./scripts/deploy/backup.sh
```

**Creates backup of:**
- PostgreSQL database
- Redis data
- Application files
- Configuration
- Logs

**Backup location:**
```
backups/
  backup_20240126_030000.tar.gz
  backup_20240125_030000.tar.gz
  ...
```

### Restore

```bash
./scripts/deploy/restore.sh
```

**Interactive menu:**
1. Lists available backups
2. Select backup to restore
3. Confirms before restoring
4. Restores all components
5. Verifies services

### Offsite Backup (S3)

**Configure S3 backup:**

```env
BACKUP_S3_BUCKET=your-backup-bucket
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
```

**Manual S3 upload:**
```bash
aws s3 cp backups/ s3://your-bucket/backups/ --recursive
```

---

## CI/CD Pipeline

### GitHub Actions

Workflow file: `.github/workflows/deploy.yml`

**Triggers:**
- Push to `main` branch
- Manual workflow dispatch

**Jobs:**

1. **Test** - Run tests and linting
2. **Build** - Build application
3. **Docker** - Build and push Docker images
4. **Deploy** - Deploy to server
5. **Health Check** - Verify deployment

### Required Secrets

Configure in GitHub Settings → Secrets:

```
DOCKER_USERNAME
DOCKER_PASSWORD
SSH_PRIVATE_KEY
SERVER_HOST
SERVER_USER
DEPLOY_PATH
APP_URL
WEB_URL
VITE_API_URL
VITE_WS_URL
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SLACK_WEBHOOK (optional)
CODECOV_TOKEN (optional)
```

### Manual Deployment

```bash
# Trigger via GitHub Actions UI
# Or via gh CLI:
gh workflow run deploy.yml
```

---

## Troubleshooting

### Bot Not Starting

**Check logs:**
```bash
# Docker
docker-compose logs bot

# PM2
pm2 logs memecoin-bot
```

**Common issues:**

1. **Missing environment variables**
   ```bash
   # Verify .env.production exists and has all required values
   cat .env.production
   ```

2. **Database connection failed**
   ```bash
   # Test Supabase connection
   npm run db:test
   ```

3. **Port already in use**
   ```bash
   # Find process using port 3000
   lsof -i :3000
   # Kill process
   kill -9 <PID>
   ```

### High Memory Usage

**Check memory:**
```bash
# Docker
docker stats memecoin-bot

# PM2
pm2 show memecoin-bot
```

**Solutions:**

1. Increase memory limit in `ecosystem.config.js`:
   ```javascript
   max_memory_restart: '2G'
   ```

2. Check for memory leaks in performance monitor:
   ```bash
   curl http://localhost:3000/api/metrics
   ```

3. Restart service:
   ```bash
   docker-compose restart bot
   # or
   pm2 restart memecoin-bot
   ```

### Cache Issues

**Clear Redis cache:**
```bash
# Docker
docker exec memecoin-redis redis-cli FLUSHALL

# Direct
redis-cli FLUSHALL
```

### Database Migration Issues

**Run migrations manually:**
```bash
npm run db:migrate
```

**Rollback migration:**
```bash
npm run migrate:rollback
```

### Service Not Responding

**Health check failed:**

1. Check service status:
   ```bash
   docker-compose ps
   # or
   pm2 list
   ```

2. Restart service:
   ```bash
   docker-compose restart
   # or
   pm2 restart all
   ```

3. Check firewall:
   ```bash
   sudo ufw status
   sudo ufw allow 3000
   ```

### Rollback Deployment

```bash
./scripts/deploy/rollback.sh
```

---

## Security Best Practices

### 1. Environment Variables

- **Never commit `.env.production`** to git
- Use strong, unique passwords
- Rotate API keys regularly
- Use read-only keys where possible

### 2. Database Security

- **Use Supabase RLS** (Row Level Security)
- Restrict service role key usage
- Enable SSL connections
- Regular backups

### 3. API Security

- **Rate limiting** enabled by default
- CORS configured properly
- JWT authentication for admin endpoints
- Input validation on all endpoints

### 4. Server Security

```bash
# Update system
sudo apt update && sudo apt upgrade

# Configure firewall
sudo ufw enable
sudo ufw allow 22  # SSH
sudo ufw allow 80  # HTTP
sudo ufw allow 443 # HTTPS

# Install fail2ban
sudo apt install fail2ban

# Configure automatic updates
sudo apt install unattended-upgrades
```

### 5. Docker Security

- **Use non-root user** (already configured)
- Scan images for vulnerabilities:
  ```bash
  docker scan solana-memecoin-bot:latest
  ```
- Keep base images updated
- Use specific image tags, not `latest`

### 6. Secrets Management

**Use environment variables or secrets manager:**

- AWS Secrets Manager
- HashiCorp Vault
- Docker Secrets (Swarm mode)

### 7. SSL/TLS Setup

**Use Caddy or Nginx with Let's Encrypt:**

```bash
# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# Configure Caddyfile
sudo nano /etc/caddy/Caddyfile
```

**Caddyfile:**
```
yourdomain.com {
    reverse_proxy localhost:80
}

api.yourdomain.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl restart caddy
```

---

## Support

- **Issues**: [GitHub Issues](https://github.com/youruser/solana-memecoin-bot/issues)
- **Documentation**: [README.md](./README.md)
- **Performance Monitor**: `apps/bot/src/performance/monitor.ts`

---

## License

MIT License - see [LICENSE](./LICENSE)
