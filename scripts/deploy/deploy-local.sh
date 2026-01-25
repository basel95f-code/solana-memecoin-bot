#!/bin/bash
# ============================================
# Local Deployment Script
# Test deployment on local machine
# ============================================

set -e # Exit on error

echo "🚀 Starting local deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo -e "${RED}❌ .env.production not found${NC}"
    echo "Copy .env.production.example to .env.production and fill in your values"
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Docker is running${NC}"

# Build images
echo -e "${YELLOW}📦 Building Docker images...${NC}"
docker-compose build --no-cache

# Stop existing containers
echo -e "${YELLOW}🛑 Stopping existing containers...${NC}"
docker-compose down

# Start containers
echo -e "${YELLOW}🚀 Starting containers...${NC}"
docker-compose up -d

# Wait for services to be healthy
echo -e "${YELLOW}⏳ Waiting for services to be healthy...${NC}"
sleep 10

# Check health
echo -e "${YELLOW}🏥 Checking service health...${NC}"

# Check Redis
if docker exec memecoin-redis redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Redis is healthy${NC}"
else
    echo -e "${RED}❌ Redis health check failed${NC}"
fi

# Check PostgreSQL
if docker exec memecoin-postgres pg_isready -U postgres > /dev/null 2>&1; then
    echo -e "${GREEN}✓ PostgreSQL is healthy${NC}"
else
    echo -e "${RED}❌ PostgreSQL health check failed${NC}"
fi

# Check Bot
if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Bot is healthy${NC}"
else
    echo -e "${RED}❌ Bot health check failed${NC}"
fi

# Check Web
if curl -f http://localhost:80/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Web dashboard is healthy${NC}"
else
    echo -e "${RED}❌ Web dashboard health check failed${NC}"
fi

# Show logs
echo -e "${YELLOW}📋 Container logs:${NC}"
docker-compose logs --tail=20

echo ""
echo -e "${GREEN}✅ Local deployment complete!${NC}"
echo ""
echo "Access points:"
echo "  - Web Dashboard: http://localhost:80"
echo "  - Bot API: http://localhost:3000"
echo "  - PostgreSQL: localhost:5432"
echo "  - Redis: localhost:6379"
echo ""
echo "Useful commands:"
echo "  - View logs: docker-compose logs -f"
echo "  - Stop: docker-compose down"
echo "  - Restart: docker-compose restart"
echo "  - Shell into bot: docker exec -it memecoin-bot sh"
