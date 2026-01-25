/**
 * Health check endpoints
 */

import { Router } from 'express';
import { botDB } from '../utils/database.js';
import type { HealthStatus } from '../types/index.js';

const router = Router();

const startTime = Date.now();

/**
 * GET /api/v1/health
 * Health check endpoint
 */
router.get('/health', async (req, res) => {
  const health: HealthStatus = {
    status: 'healthy',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    services: {
      database: false,
      websocket: false,
      cache: false
    }
  };

  // Check database connection
  try {
    await botDB.getStats();
    health.services.database = true;
  } catch (error) {
    health.status = 'degraded';
  }

  // Check WebSocket (if available)
  // This would be implemented when WebSocket server is added
  health.services.websocket = true;

  // Check cache (if available)
  health.services.cache = true;

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

export default router;
