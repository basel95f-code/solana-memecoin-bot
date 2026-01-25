# 🚀 Deployment Guide - Solana Memecoin Bot

Complete deployment guide for production deployment using Docker or PM2.

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Variables](#environment-variables)
3. [Docker Deployment](#docker-deployment)
4. [PM2 Deployment](#pm2-deployment)
5. [Configuration](#configuration)
6. [Monitoring](#monitoring)
7. [Troubleshooting](#troubleshooting)
8. [Security Best Practices](#security-best-practices)

---

## 📦 Prerequisites

### System Requirements

- **Node.js**: v18.x or higher
- **npm**: v10.x or higher
- **RAM**: Minimum 512MB, Recommended 1GB+
- **Storage**: 1GB+ for logs and database
- **OS**: Linux (Ubuntu/Debian recommended), macOS, or Windows

### Required for Docker Deployment

- Docker Engine 20.10+
- Docker Compose v2.0+

### Required for PM2 Deployment

- PM2 installed globally: `npm install -g pm2`
- Git (for source control)

---

## 🔐 Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token from @BotFather | `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz` |

### Optional Variables (with defaults)

| Variable | Description | Default |
|----------|-------------|---------|
| `SOLANA_RPC_URL` | Solana RPC endpoint | `https://api.mainnet-beta.solana.com` |
| `DATABASE_PATH` | SQLite database file path | `./data/bot.db` |
| `LOG_LEVEL` | Logging level | `info` |
| `DEXSCREENER_API_KEY` | DexScreener API key (optional) | - |
| `GMGN_API_KEY` | GMGN API key (optional) | - |
| `RUGCHECK_API_KEY` | RugCheck API key (optional) | - |

### Additional Configuration Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_CHAT_ID` | Default Telegram chat ID for alerts | - |
| `SOLANA_WS_URL` | Solana WebSocket endpoint | Auto-derived from RPC |
| `MIN_LIQUIDITY_USD` | Minimum liquidity threshold | `1000` |
| `MIN_RISK_SCORE` | Minimum risk score threshold | `0` |
| `RAYDIUM_ENABLED` | Enable Raydium monitoring | `true` |
| `PUMPFUN_ENABLED` | Enable Pump.fun monitoring | `true` |
| `JUPITER_ENABLED` | Enable Jupiter monitoring | `true` |
| `WATCHLIST_ENABLED` | Enable watchlist feature | `true` |
| `DISCOVERY_ENABLED` | Enable token discovery | `true` |
| `WALLET_MONITOR_ENABLED` | Enable wallet monitoring | `true` |

### Setting Up Environment Variables

1. **Copy the example file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` and add your values:**
   ```bash
   nano .env  # or use your preferred editor
   ```

3. **Minimum viable `.env`:**
   ```env
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   ```

4. **Production-ready `.env`:**
   ```env
   # Required
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   TELEGRAM_CHAT_ID=your_chat_id_here
   
   # Optional but recommended
   SOLANA_RPC_URL=https://your-premium-rpc.com
   RUGCHECK_API_KEY=your_rugcheck_key
   DEXSCREENER_API_KEY=your_dexscreener_key
   
   # Configuration
   LOG_LEVEL=info
   MIN_LIQUIDITY_USD=5000
   NODE_ENV=production
   ```

---

## 🐳 Docker Deployment

### Quick Start

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd solana-memecoin-bot
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   nano .env  # Add your configuration
   ```

3. **Build and run:**
   ```bash
   docker-compose up -d
   ```

4. **Check logs:**
   ```bash
   docker-compose logs -f bot
   ```

### Docker Commands

```bash
# Build the image
docker-compose build

# Start the bot
docker-compose up -d

# Stop the bot
docker-compose down

# View logs
docker-compose logs -f bot

# Restart the bot
docker-compose restart bot

# View bot status
docker-compose ps

# Execute commands in container
docker-compose exec bot sh

# Remove everything (including volumes)
docker-compose down -v
```

### Production Docker Deployment

1. **Use production environment file:**
   ```bash
   cp .env.production .env
   ```

2. **Update docker-compose.yml for production:**
   ```yaml
   services:
     bot:
       restart: always  # Change from unless-stopped
       logging:
         driver: "json-file"
         options:
           max-size: "50m"
           max-file: "5"
   ```

3. **Deploy with optimizations:**
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

### Docker Volume Management

```bash
# Backup database
docker-compose exec bot cp /app/data/bot.db /app/data/bot.db.backup

# Copy database out of container
docker cp solana-memecoin-bot:/app/data/bot.db ./backup/

# Restore database
docker cp ./backup/bot.db solana-memecoin-bot:/app/data/

# Inspect volume
docker volume inspect solana-memecoin-bot_bot-data
```

---

## 🔄 PM2 Deployment

### Initial Setup

1. **Install PM2 globally:**
   ```bash
   npm install -g pm2
   ```

2. **Clone and build:**
   ```bash
   git clone <repository-url>
   cd solana-memecoin-bot
   npm install
   npm run build
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   nano .env  # Add your configuration
   ```

4. **Create logs directory:**
   ```bash
   mkdir -p logs
   ```

### Starting with PM2

```bash
# Start in production mode
pm2 start ecosystem.config.js --env production

# Or start in development mode
pm2 start ecosystem.config.js

# Start and save configuration
pm2 start ecosystem.config.js --env production
pm2 save
```

### PM2 Commands

```bash
# View status
pm2 status
pm2 list

# View logs
pm2 logs solana-memecoin-bot
pm2 logs solana-memecoin-bot --lines 100

# Monitor
pm2 monit

# Restart
pm2 restart solana-memecoin-bot

# Stop
pm2 stop solana-memecoin-bot

# Delete from PM2
pm2 delete solana-memecoin-bot

# Reload (zero-downtime restart)
pm2 reload solana-memecoin-bot

# View detailed info
pm2 show solana-memecoin-bot

# Flush logs
pm2 flush
```

### PM2 Log Rotation

Install PM2 log rotation module:

```bash
pm2 install pm2-logrotate

# Configure rotation
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'  # Daily at midnight
```

### PM2 Startup Script

Configure PM2 to start on system boot:

```bash
# Generate startup script
pm2 startup

# Save current process list
pm2 save

# To disable startup
pm2 unstartup
```

### PM2 with systemd (Linux)

```bash
# Generate systemd service
pm2 startup systemd

# Enable and start
sudo systemctl enable pm2-<username>
sudo systemctl start pm2-<username>

# Check status
sudo systemctl status pm2-<username>
```

---

## ⚙️ Configuration

### Log Levels

- **debug**: Detailed debugging information
- **info**: General informational messages (default)
- **warn**: Warning messages
- **error**: Error messages only

Set in `.env`:
```env
LOG_LEVEL=info
```

### Database Path

- Default: `./data/bot.db`
- Docker: `/app/data/bot.db` (mounted volume)

Ensure the directory exists and is writable:
```bash
mkdir -p data
chmod 755 data
```

### Resource Limits

**Docker** (in `docker-compose.yml`):
```yaml
deploy:
  resources:
    limits:
      cpus: '1.0'
      memory: 1G
```

**PM2** (in `ecosystem.config.js`):
```javascript
max_memory_restart: '1G'
```

---

## 📊 Monitoring

### Docker Monitoring

```bash
# Container stats
docker stats solana-memecoin-bot

# Health check
docker inspect --format='{{json .State.Health}}' solana-memecoin-bot

# Resource usage
docker-compose top
```

### PM2 Monitoring

```bash
# Real-time monitoring
pm2 monit

# Process metrics
pm2 describe solana-memecoin-bot

# Plus (advanced monitoring - requires account)
pm2 plus
```

### Log Monitoring

```bash
# Docker
docker-compose logs -f --tail=100 bot

# PM2
pm2 logs solana-memecoin-bot --lines 100

# System logs (if using systemd)
journalctl -u pm2-<username> -f
```

### Health Checks

Check if the bot is running:

```bash
# Docker
docker-compose ps

# PM2
pm2 status

# Process check
ps aux | grep "solana-memecoin-bot"
```

---

## 🔧 Troubleshooting

### Common Issues

#### 1. **Bot won't start**

**Symptoms:** Process exits immediately

**Solutions:**
```bash
# Check environment variables
cat .env

# Verify required variables are set
grep TELEGRAM_BOT_TOKEN .env

# Check logs for error messages
docker-compose logs bot  # Docker
pm2 logs solana-memecoin-bot --err  # PM2
```

#### 2. **Missing environment variable error**

**Error:** `❌ Missing required environment variable: TELEGRAM_BOT_TOKEN`

**Solution:**
```bash
# Ensure .env file exists
ls -la .env

# Add missing variable
echo "TELEGRAM_BOT_TOKEN=your_token_here" >> .env

# Restart
docker-compose restart bot  # Docker
pm2 restart solana-memecoin-bot  # PM2
```

#### 3. **Database locked/permission errors**

**Solution:**
```bash
# Docker - ensure proper permissions
docker-compose exec bot chown -R nodejs:nodejs /app/data

# PM2 - check file permissions
ls -la data/
chmod 644 data/bot.db
```

#### 4. **High memory usage**

**Solution:**
```bash
# Docker - increase memory limit
# Edit docker-compose.yml:
memory: 2G

# PM2 - restart on high memory
# Edit ecosystem.config.js:
max_memory_restart: '2G'
```

#### 5. **Bot not receiving updates**

**Solutions:**
```bash
# Check bot token
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getMe

# Check webhook (disable if set)
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/deleteWebhook

# Restart bot
docker-compose restart bot  # Docker
pm2 restart solana-memecoin-bot  # PM2
```

### Debug Mode

Enable debug logging:

```env
LOG_LEVEL=debug
```

Then restart the bot and check logs.

### Getting Help

1. Check logs first: `docker-compose logs` or `pm2 logs`
2. Verify environment variables: `cat .env`
3. Check bot status: `docker-compose ps` or `pm2 status`
4. Review error messages in logs
5. Ensure all required variables are set

---

## 🔒 Security Best Practices

### 1. **Environment Variables**

- ✅ Never commit `.env` to git
- ✅ Use `.env.example` as template
- ✅ Rotate API keys periodically
- ✅ Use environment-specific files (`.env.production`)

### 2. **File Permissions**

```bash
# Secure .env file
chmod 600 .env

# Secure database
chmod 644 data/bot.db

# Secure logs directory
chmod 755 logs/
```

### 3. **Docker Security**

- ✅ Run as non-root user (already configured)
- ✅ Use specific image versions (not `latest`)
- ✅ Scan images for vulnerabilities: `docker scan`
- ✅ Limit resource usage (configured in docker-compose.yml)

### 4. **Network Security**

- ✅ Use HTTPS for RPC endpoints
- ✅ Don't expose unnecessary ports
- ✅ Use VPN for remote deployments
- ✅ Enable firewall rules

### 5. **Backup Strategy**

```bash
# Backup database daily
docker-compose exec bot cp /app/data/bot.db /app/data/bot.db.$(date +%Y%m%d)

# Backup environment
cp .env .env.backup

# Automated backup script
#!/bin/bash
BACKUP_DIR="./backups/$(date +%Y%m%d)"
mkdir -p $BACKUP_DIR
docker cp solana-memecoin-bot:/app/data/bot.db $BACKUP_DIR/
```

### 6. **Updates and Patches**

```bash
# Pull latest changes
git pull origin main

# Rebuild
docker-compose build  # Docker
npm run build         # PM2

# Restart
docker-compose up -d  # Docker
pm2 restart solana-memecoin-bot  # PM2
```

---

## 📞 Support

For issues and questions:
- Check logs: `docker-compose logs` or `pm2 logs`
- Review this guide
- Check `README.md` for project documentation

---

## 📝 Quick Reference

### Docker Commands Cheat Sheet
```bash
docker-compose up -d              # Start
docker-compose down               # Stop
docker-compose restart bot        # Restart
docker-compose logs -f bot        # Logs
docker-compose ps                 # Status
```

### PM2 Commands Cheat Sheet
```bash
pm2 start ecosystem.config.js --env production  # Start
pm2 stop solana-memecoin-bot     # Stop
pm2 restart solana-memecoin-bot  # Restart
pm2 logs solana-memecoin-bot     # Logs
pm2 status                        # Status
```

---

**Last Updated:** January 2025
