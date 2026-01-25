#!/bin/bash
# ============================================
# Backup Script
# Backup database, config, and application data
# ============================================

set -e

echo "💾 Starting backup process..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="backup_$TIMESTAMP"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

# Create backup directory
mkdir -p "$BACKUP_PATH"

echo -e "${BLUE}📁 Backup location: $BACKUP_PATH${NC}"

# Backup PostgreSQL database
if docker ps | grep -q memecoin-postgres; then
    echo -e "${BLUE}🗄️  Backing up PostgreSQL database...${NC}"
    docker exec memecoin-postgres pg_dump -U postgres memecoin_bot > "$BACKUP_PATH/database.sql"
    echo -e "${GREEN}✓ Database backed up${NC}"
else
    echo -e "${YELLOW}⚠️  PostgreSQL container not running - skipping database backup${NC}"
fi

# Backup Redis data
if docker ps | grep -q memecoin-redis; then
    echo -e "${BLUE}💾 Backing up Redis data...${NC}"
    docker exec memecoin-redis redis-cli SAVE > /dev/null
    docker cp memecoin-redis:/data/dump.rdb "$BACKUP_PATH/redis.rdb"
    echo -e "${GREEN}✓ Redis backed up${NC}"
else
    echo -e "${YELLOW}⚠️  Redis container not running - skipping Redis backup${NC}"
fi

# Backup application files
echo -e "${BLUE}📦 Backing up application files...${NC}"
cp -r apps/bot/dist "$BACKUP_PATH/bot-dist" 2>/dev/null || true
cp -r apps/web/dist "$BACKUP_PATH/web-dist" 2>/dev/null || true

# Backup configuration
echo -e "${BLUE}⚙️  Backing up configuration...${NC}"
cp .env.production "$BACKUP_PATH/.env.production" 2>/dev/null || true
cp docker-compose.yml "$BACKUP_PATH/docker-compose.yml"
cp ecosystem.config.js "$BACKUP_PATH/ecosystem.config.js"

# Backup logs
echo -e "${BLUE}📋 Backing up logs...${NC}"
mkdir -p "$BACKUP_PATH/logs"
cp -r logs/* "$BACKUP_PATH/logs/" 2>/dev/null || true

# Backup custom data
echo -e "${BLUE}💼 Backing up custom data...${NC}"
cp -r data "$BACKUP_PATH/" 2>/dev/null || true

# Create compressed archive
echo -e "${BLUE}🗜️  Compressing backup...${NC}"
cd "$BACKUP_DIR"
tar -czf "$BACKUP_NAME.tar.gz" "$BACKUP_NAME"
rm -rf "$BACKUP_NAME"
cd - > /dev/null

# Calculate size
BACKUP_SIZE=$(du -sh "$BACKUP_DIR/$BACKUP_NAME.tar.gz" | cut -f1)

echo -e "${GREEN}✅ Backup complete!${NC}"
echo ""
echo "Backup info:"
echo "  - File: $BACKUP_NAME.tar.gz"
echo "  - Size: $BACKUP_SIZE"
echo "  - Location: $BACKUP_DIR/"
echo ""

# Clean up old backups (keep last 7)
echo -e "${BLUE}🧹 Cleaning up old backups (keeping last 7)...${NC}"
cd "$BACKUP_DIR"
ls -t backup_*.tar.gz | tail -n +8 | xargs rm -f 2>/dev/null || true
cd - > /dev/null

# List remaining backups
echo ""
echo -e "${BLUE}📁 Current backups:${NC}"
ls -lht "$BACKUP_DIR"/backup_*.tar.gz 2>/dev/null || echo "No backups found"

echo ""
echo -e "${GREEN}✨ Backup process complete!${NC}"
