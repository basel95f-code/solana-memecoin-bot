/**
 * Health Check Endpoint
 * Provides health status for monitoring and load balancers
 */

import { performanceMonitor } from '../performance/monitor';

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  timestamp: number;
  uptime: number;
  version: string;
  memory: {
    used: number;
    limit: number;
    percentage: number;
  };
  performance: {
    avgResponseTime: number;
    cacheHitRate: number;
    successRate: number;
  };
  services: {
    database: 'connected' | 'disconnected' | 'unknown';
    redis: 'connected' | 'disconnected' | 'unknown';
    telegram: 'connected' | 'disconnected' | 'unknown';
  };
}

/**
 * Get health status
 */
export async function getHealthStatus(): Promise<HealthStatus> {
  const metrics = performanceMonitor.getMetrics();
  const memory = process.memoryUsage();
  const memoryLimitMB = 1024; // Default 1GB limit

  // Determine overall status
  let status: 'ok' | 'degraded' | 'error' = 'ok';
  
  if (metrics.memoryUsagePercent > 90 || metrics.successRate < 50) {
    status = 'error';
  } else if (metrics.memoryUsagePercent > 80 || metrics.successRate < 80) {
    status = 'degraded';
  }

  return {
    status,
    timestamp: Date.now(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    memory: {
      used: Math.round(memory.heapUsed / 1024 / 1024),
      limit: memoryLimitMB,
      percentage: Math.round((memory.heapUsed / 1024 / 1024 / memoryLimitMB) * 100),
    },
    performance: {
      avgResponseTime: metrics.avgResponseTime,
      cacheHitRate: metrics.cacheHitRate,
      successRate: metrics.successRate,
    },
    services: {
      database: 'connected', // TODO: Add actual DB health check
      redis: 'connected', // TODO: Add actual Redis health check
      telegram: 'connected', // TODO: Add actual Telegram health check
    },
  };
}

/**
 * Simple health check for load balancers
 */
export function isHealthy(): boolean {
  const metrics = performanceMonitor.getMetrics();
  
  // Consider unhealthy if:
  // - Memory usage > 95%
  // - Success rate < 30%
  
  return metrics.memoryUsagePercent < 95 && metrics.successRate > 30;
}
