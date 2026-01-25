#!/bin/bash
# ============================================
# Production Deployment Script
# Deploy to production server with zero-downtime
# ============================================

set -e # Exit on error

echo "🚀 Starting production deployment..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.tar.gz"

# Pre-flight checks
echo -e "${BLUE}🔍 Running pre-flight checks...${NC}"

# Check if running as correct user
if [ "$USER" != "deploy" ] && [ "$USER" != "root" ]; then
    echo -e "${YELLOW}⚠️  Warning: Not running as 'deploy' user${NC}"
fi

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo -e "${RED}❌ .env.production not found${NC}"
    exit 1
fi

# Check Docker
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Pre-flight checks passed${NC}"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup current deployment
echo -e "${BLUE}💾 Creating backup...${NC}"
if [ -d "./apps/bot/dist" ] || [ -d "./apps/web/dist" ]; then
    tar -czf "$BACKUP_FILE" \
        ./apps/bot/dist \
        ./apps/web/dist \
        ./docker-compose.yml \
        ./ecosystem.config.js \
        .env.production 2>/dev/null || true
    echo -e "${GREEN}✓ Backup created: $BACKUP_FILE${NC}"
else
    echo -e "${YELLOW}⚠️  No previous deployment to backup${NC}"
fi

# Pull latest code (if using git)
if [ -d ".git" ]; then
    echo -e "${BLUE}📥 Pulling latest code...${NC}"
    git pull origin main
    echo -e "${GREEN}✓ Code updated${NC}"
fi

# Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
npm ci --production
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Build application
echo -e "${BLUE}🔨 Building application...${NC}"
npm run build
echo -e "${GREEN}✓ Build complete${NC}"

# Database migration
echo -e "${BLUE}🗄️  Running database migrations...${NC}"
npm run db:migrate || echo -e "${YELLOW}⚠️  No migrations to run${NC}"

# Build Docker images
echo -e "${BLUE}🐳 Building Docker images...${NC}"
docker-compose build --no-cache

# Tag images with timestamp
docker tag solana-memecoin-bot:latest solana-memecoin-bot:$TIMESTAMP
docker tag solana-memecoin-web:latest solana-memecoin-web:$TIMESTAMP

# Zero-downtime deployment
echo -e "${BLUE}🔄 Performing zero-downtime deployment...${NC}"

# Start new containers
docker-compose up -d --no-deps --scale bot=2 bot
docker-compose up -d --no-deps --scale web=2 web

# Wait for new containers to be healthy
echo -e "${YELLOW}⏳ Waiting for new containers to be healthy...${NC}"
sleep 15

# Health check new containers
NEW_BOT_HEALTHY=false
NEW_WEB_HEALTHY=false

for i in {1..30}; do
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        NEW_BOT_HEALTHY=true
        break
    fi
    sleep 2
done

for i in {1..30}; do
    if curl -f http://localhost:80/health > /dev/null 2>&1; then
        NEW_WEB_HEALTHY=true
        break
    fi
    sleep 2
done

if [ "$NEW_BOT_HEALTHY" = false ] || [ "$NEW_WEB_HEALTHY" = false ]; then
    echo -e "${RED}❌ New containers failed health check${NC}"
    echo -e "${YELLOW}🔄 Rolling back...${NC}"
    docker-compose down
    docker-compose up -d
    exit 1
fi

# Scale down old containers
docker-compose up -d --no-deps --scale bot=1 bot
docker-compose up -d --no-deps --scale web=1 web

echo -e "${GREEN}✓ Zero-downtime deployment complete${NC}"

# Clean up old Docker images
echo -e "${BLUE}🧹 Cleaning up old images...${NC}"
docker image prune -f

# Verify deployment
echo -e "${BLUE}✅ Verifying deployment...${NC}"

# Check all services
echo "Checking services..."
docker-compose ps

# Final health checks
echo ""
echo "Final health checks:"
curl -f http://localhost:3000/health && echo -e "${GREEN}✓ Bot API${NC}" || echo -e "${RED}❌ Bot API${NC}"
curl -f http://localhost:80/health && echo -e "${GREEN}✓ Web Dashboard${NC}" || echo -e "${RED}❌ Web Dashboard${NC}"

# Show logs
echo ""
echo -e "${BLUE}📋 Recent logs:${NC}"
docker-compose logs --tail=30

echo ""
echo -e "${GREEN}🎉 Production deployment complete!${NC}"
echo ""
echo "Deployment info:"
echo "  - Timestamp: $TIMESTAMP"
echo "  - Backup: $BACKUP_FILE"
echo "  - Services running: $(docker-compose ps --services | wc -l)"
echo ""
echo "Monitor with:"
echo "  - docker-compose logs -f"
echo "  - docker-compose ps"
echo ""
