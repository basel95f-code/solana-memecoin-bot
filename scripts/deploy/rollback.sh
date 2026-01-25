#!/bin/bash
# ============================================
# Rollback Script
# Rollback to previous deployment version
# ============================================

set -e

echo "🔄 Starting rollback process..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

BACKUP_DIR="./backups"

# Check if backups exist
if [ ! -d "$BACKUP_DIR" ] || [ -z "$(ls -A $BACKUP_DIR)" ]; then
    echo -e "${RED}❌ No backups found in $BACKUP_DIR${NC}"
    exit 1
fi

# List available backups
echo -e "${BLUE}📋 Available backups:${NC}"
ls -lht "$BACKUP_DIR"/*.tar.gz | head -5

# Get the latest backup
LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/*.tar.gz | head -1)

echo ""
echo -e "${YELLOW}Latest backup: $LATEST_BACKUP${NC}"
read -p "Rollback to this version? (y/N) " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Rollback cancelled"
    exit 0
fi

# Stop current containers
echo -e "${BLUE}🛑 Stopping current containers...${NC}"
docker-compose down

# Extract backup
echo -e "${BLUE}📦 Extracting backup...${NC}"
tar -xzf "$LATEST_BACKUP" -C .

# Rebuild Docker images
echo -e "${BLUE}🐳 Rebuilding Docker images...${NC}"
docker-compose build

# Start containers
echo -e "${BLUE}🚀 Starting containers...${NC}"
docker-compose up -d

# Wait for services
echo -e "${YELLOW}⏳ Waiting for services...${NC}"
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

if [ "$BOT_HEALTHY" = true ] && [ "$WEB_HEALTHY" = true ]; then
    echo -e "${GREEN}✅ Rollback successful!${NC}"
    echo ""
    echo "Services are healthy:"
    echo -e "  ${GREEN}✓ Bot API${NC}"
    echo -e "  ${GREEN}✓ Web Dashboard${NC}"
else
    echo -e "${RED}❌ Rollback failed - services not healthy${NC}"
    [ "$BOT_HEALTHY" = false ] && echo -e "  ${RED}✗ Bot API${NC}"
    [ "$WEB_HEALTHY" = false ] && echo -e "  ${RED}✗ Web Dashboard${NC}"
    exit 1
fi

# Show logs
echo ""
echo -e "${BLUE}📋 Recent logs:${NC}"
docker-compose logs --tail=30

echo ""
echo -e "${GREEN}🎉 Rollback complete!${NC}"
