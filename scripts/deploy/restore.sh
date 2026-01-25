#!/bin/bash
# ============================================
# Restore Script
# Restore from backup
# ============================================

set -e

echo "♻️  Starting restore process..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

BACKUP_DIR="./backups"
TEMP_DIR="./temp_restore"

# Check if backups exist
if [ ! -d "$BACKUP_DIR" ] || [ -z "$(ls -A $BACKUP_DIR)" ]; then
    echo -e "${RED}❌ No backups found in $BACKUP_DIR${NC}"
    exit 1
fi

# List available backups
echo -e "${BLUE}📋 Available backups:${NC}"
select BACKUP_FILE in "$BACKUP_DIR"/backup_*.tar.gz; do
    if [ -n "$BACKUP_FILE" ]; then
        break
    fi
done

echo ""
echo -e "${YELLOW}Selected backup: $BACKUP_FILE${NC}"
echo -e "${RED}⚠️  WARNING: This will overwrite current data!${NC}"
read -p "Continue with restore? (y/N) " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Restore cancelled"
    exit 0
fi

# Create temporary directory
mkdir -p "$TEMP_DIR"

# Extract backup
echo -e "${BLUE}📦 Extracting backup...${NC}"
tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"

BACKUP_NAME=$(basename "$BACKUP_FILE" .tar.gz)
RESTORE_PATH="$TEMP_DIR/$BACKUP_NAME"

# Stop containers
echo -e "${BLUE}🛑 Stopping containers...${NC}"
docker-compose down

# Restore PostgreSQL database
if [ -f "$RESTORE_PATH/database.sql" ]; then
    echo -e "${BLUE}🗄️  Restoring PostgreSQL database...${NC}"
    
    # Start only PostgreSQL
    docker-compose up -d postgres
    sleep 10
    
    # Drop and recreate database
    docker exec memecoin-postgres psql -U postgres -c "DROP DATABASE IF EXISTS memecoin_bot;"
    docker exec memecoin-postgres psql -U postgres -c "CREATE DATABASE memecoin_bot;"
    
    # Restore database
    cat "$RESTORE_PATH/database.sql" | docker exec -i memecoin-postgres psql -U postgres memecoin_bot
    
    echo -e "${GREEN}✓ Database restored${NC}"
else
    echo -e "${YELLOW}⚠️  No database backup found${NC}"
fi

# Restore Redis data
if [ -f "$RESTORE_PATH/redis.rdb" ]; then
    echo -e "${BLUE}💾 Restoring Redis data...${NC}"
    
    # Start only Redis
    docker-compose up -d redis
    sleep 5
    
    # Copy dump file
    docker cp "$RESTORE_PATH/redis.rdb" memecoin-redis:/data/dump.rdb
    
    # Restart Redis to load data
    docker-compose restart redis
    sleep 5
    
    echo -e "${GREEN}✓ Redis data restored${NC}"
else
    echo -e "${YELLOW}⚠️  No Redis backup found${NC}"
fi

# Restore application files
if [ -d "$RESTORE_PATH/bot-dist" ]; then
    echo -e "${BLUE}📦 Restoring bot application...${NC}"
    rm -rf apps/bot/dist
    cp -r "$RESTORE_PATH/bot-dist" apps/bot/dist
    echo -e "${GREEN}✓ Bot application restored${NC}"
fi

if [ -d "$RESTORE_PATH/web-dist" ]; then
    echo -e "${BLUE}🌐 Restoring web application...${NC}"
    rm -rf apps/web/dist
    cp -r "$RESTORE_PATH/web-dist" apps/web/dist
    echo -e "${GREEN}✓ Web application restored${NC}"
fi

# Restore configuration
if [ -f "$RESTORE_PATH/.env.production" ]; then
    echo -e "${BLUE}⚙️  Restoring configuration...${NC}"
    cp "$RESTORE_PATH/.env.production" .env.production
    echo -e "${GREEN}✓ Configuration restored${NC}"
fi

# Restore logs
if [ -d "$RESTORE_PATH/logs" ]; then
    echo -e "${BLUE}📋 Restoring logs...${NC}"
    rm -rf logs
    cp -r "$RESTORE_PATH/logs" logs
    echo -e "${GREEN}✓ Logs restored${NC}"
fi

# Restore custom data
if [ -d "$RESTORE_PATH/data" ]; then
    echo -e "${BLUE}💼 Restoring custom data...${NC}"
    rm -rf data
    cp -r "$RESTORE_PATH/data" data
    echo -e "${GREEN}✓ Custom data restored${NC}"
fi

# Rebuild and start all containers
echo -e "${BLUE}🐳 Rebuilding Docker images...${NC}"
docker-compose build

echo -e "${BLUE}🚀 Starting all containers...${NC}"
docker-compose up -d

# Wait for services
echo -e "${YELLOW}⏳ Waiting for services to start...${NC}"
sleep 15

# Health checks
echo -e "${BLUE}🏥 Running health checks...${NC}"

BOT_HEALTHY=false
WEB_HEALTHY=false

for i in {1..30}; do
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        BOT_HEALTHY=true
        break
    fi
    sleep 2
done

for i in {1..30}; do
    if curl -f http://localhost:80/health > /dev/null 2>&1; then
        WEB_HEALTHY=true
        break
    fi
    sleep 2
done

# Clean up temp directory
rm -rf "$TEMP_DIR"

if [ "$BOT_HEALTHY" = true ] && [ "$WEB_HEALTHY" = true ]; then
    echo -e "${GREEN}✅ Restore successful!${NC}"
    echo ""
    echo "Services are healthy:"
    echo -e "  ${GREEN}✓ Bot API${NC}"
    echo -e "  ${GREEN}✓ Web Dashboard${NC}"
else
    echo -e "${RED}❌ Restore completed but services not healthy${NC}"
    [ "$BOT_HEALTHY" = false ] && echo -e "  ${RED}✗ Bot API${NC}"
    [ "$WEB_HEALTHY" = false ] && echo -e "  ${RED}✗ Web Dashboard${NC}"
fi

# Show logs
echo ""
echo -e "${BLUE}📋 Recent logs:${NC}"
docker-compose logs --tail=30

echo ""
echo -e "${GREEN}🎉 Restore process complete!${NC}"
