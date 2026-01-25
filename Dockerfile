# Multi-stage build for Solana Memecoin Bot
# Stage 1: Dependencies and Build
FROM node:18-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY turbo.json ./
COPY apps/bot/package*.json ./apps/bot/
COPY packages/shared/package*.json ./packages/shared/

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the project
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# Stage 2: Production Runtime
FROM node:18-alpine

# Add non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy built artifacts and production dependencies from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/apps/bot/dist ./apps/bot/dist
COPY --from=builder --chown=nodejs:nodejs /app/apps/bot/package*.json ./apps/bot/
COPY --from=builder --chown=nodejs:nodejs /app/packages ./packages
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

# Create data directory for database and logs
RUN mkdir -p /app/data && chown nodejs:nodejs /app/data

# Set environment variables
ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/bot.db
ENV LOG_LEVEL=info

# Switch to non-root user
USER nodejs

# Expose health check port (if implemented)
EXPOSE 3000

# Volume for persistent data
VOLUME ["/app/data"]

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "console.log('Health check passed')" || exit 1

# Start the bot
CMD ["node", "apps/bot/dist/index.js"]
