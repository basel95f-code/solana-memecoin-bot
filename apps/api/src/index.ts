/**
 * Main API server
 * REST + WebSocket server for Solana Memecoin Bot
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';

import { logger } from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authenticateAPIKey } from './middleware/auth.js';
import { RealtimeWebSocketServer } from './websocket/server.js';
import { swaggerSpec } from './docs/swagger.js';
import { apiKeyDB } from './auth/database.js';

// Import routes
import healthRouter from './routes/health.js';
import tokensRouter from './routes/tokens.js';
import patternsRouter from './routes/patterns.js';
import smartMoneyRouter from './routes/smartMoney.js';
import alertsRouter from './routes/alerts.js';
import statsRouter from './routes/stats.js';
import adminRouter from './routes/admin.js';

const app = express();
const PORT = parseInt(process.env.API_PORT || '3001');
const API_VERSION = 'v1';

// Create HTTP server
const server = createServer(app);

// Initialize WebSocket server
export const wsServer = new RealtimeWebSocketServer(server);

// Middleware
app.use(helmet()); // Security headers
app.use(compression()); // Response compression
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Global rate limiting (for unauthenticated endpoints)
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', globalLimiter);

// API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Solana Memecoin Bot API Docs'
}));

// Health check (no auth required)
app.use(`/api/${API_VERSION}`, healthRouter);

// Protected routes (require authentication)
app.use(`/api/${API_VERSION}`, authenticateAPIKey, tokensRouter);
app.use(`/api/${API_VERSION}`, authenticateAPIKey, patternsRouter);
app.use(`/api/${API_VERSION}`, authenticateAPIKey, smartMoneyRouter);
app.use(`/api/${API_VERSION}`, authenticateAPIKey, alertsRouter);
app.use(`/api/${API_VERSION}`, authenticateAPIKey, statsRouter);

// Admin routes (require admin key)
app.use(`/api/${API_VERSION}`, adminRouter);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Solana Memecoin Bot API',
    version: '1.0.0',
    docs: '/api-docs',
    health: `/api/${API_VERSION}/health`,
    websocket: '/ws'
  });
});

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    wsServer.close();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    wsServer.close();
    process.exit(0);
  });
});

// Start server
async function start() {
  try {
    // Initialize API key database
    await apiKeyDB.initialize();

    // Start HTTP server
    server.listen(PORT, () => {
      logger.info(`API server running on port ${PORT}`);
      logger.info(`Documentation available at http://localhost:${PORT}/api-docs`);
      logger.info(`WebSocket server running on ws://localhost:${PORT}/ws`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
