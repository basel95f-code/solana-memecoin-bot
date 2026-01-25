/**
 * API Server
 * Simple HTTP server for health checks and metrics
 */

import http from 'http';
import { getHealthStatus, isHealthy } from './health';
import { performanceMonitor } from '../performance/monitor';
import { logger } from '../utils/logger';

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    // Health check endpoint (simple)
    if (req.url === '/health') {
      const healthy = isHealthy();
      res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'text/plain' });
      res.end(healthy ? 'healthy' : 'unhealthy');
      return;
    }

    // Health check endpoint (detailed)
    if (req.url === '/health/detailed') {
      const health = await getHealthStatus();
      res.writeHead(health.status === 'ok' ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
      return;
    }

    // Metrics endpoint
    if (req.url === '/metrics' || req.url === '/api/metrics') {
      const metrics = performanceMonitor.getMetrics();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(metrics, null, 2));
      return;
    }

    // Stats endpoint
    if (req.url === '/api/v1/stats') {
      const stats = {
        uptime: process.uptime(),
        timestamp: Date.now(),
        performance: performanceMonitor.getMetrics(),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats, null, 2));
      return;
    }

    // 404 for other routes
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  } catch (error) {
    logger.error('api-server', 'Error handling request', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('api-server', 'SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('api-server', 'Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('api-server', 'SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('api-server', 'Server closed');
    process.exit(0);
  });
});

// Start server
function startApiServer() {
  server.listen(PORT, () => {
    logger.info('api-server', `API server listening on port ${PORT}`);
    logger.info('api-server', `Health check: http://localhost:${PORT}/health`);
    logger.info('api-server', `Metrics: http://localhost:${PORT}/metrics`);
  });
}

// Export as apiServer object for consistency
export const apiServer = {
  start: startApiServer,
  server,
};

// Also export startApiServer for backward compatibility
export { startApiServer };
