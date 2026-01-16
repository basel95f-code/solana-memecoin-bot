/**
 * API Server for Dashboard
 * Serves live data from the bot to the web dashboard
 */

import http from 'http';
import path from 'path';
import fs from 'fs';
import { storageService } from '../services/storage';
import { database } from '../database';
import { dexScreenerService } from '../services/dexscreener';
import { solanaService } from '../services/solana';
import { walletMonitorService } from '../services/walletMonitor';
import { config } from '../config';
import { logger } from '../utils/logger';

// Track startup time for uptime calculation
const startupTime = Date.now();

const PORT = 3001;
const DASHBOARD_DIR = path.join(process.cwd(), 'dashboard');

// In-memory store for recent discoveries and alerts
interface RecentDiscovery {
  mint: string;
  symbol: string;
  name: string;
  source: string;
  riskScore: number;
  riskLevel: string;
  timestamp: number;
}

interface RecentAlert {
  type: string;
  title: string;
  description: string;
  emoji: string;
  timestamp: number;
}

class ApiServer {
  private server: http.Server | null = null;
  private recentDiscoveries: RecentDiscovery[] = [];
  private recentAlerts: RecentAlert[] = [];
  private maxItems = 50;

  /**
   * Add a new discovery
   */
  addDiscovery(discovery: RecentDiscovery): void {
    this.recentDiscoveries.unshift(discovery);
    if (this.recentDiscoveries.length > this.maxItems) {
      this.recentDiscoveries.pop();
    }
  }

  /**
   * Add a new alert
   */
  addAlert(alert: RecentAlert): void {
    this.recentAlerts.unshift(alert);
    if (this.recentAlerts.length > this.maxItems) {
      this.recentAlerts.pop();
    }
  }

  /**
   * Start the API server
   */
  start(): void {
    this.server = http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://localhost:${PORT}`);

      try {
        // API Routes
        if (url.pathname === '/api/health' || url.pathname === '/health') {
          await this.handleHealth(req, res);
        } else if (url.pathname === '/api/portfolio') {
          await this.handlePortfolio(req, res);
        } else if (url.pathname === '/api/watchlist') {
          await this.handleWatchlist(req, res);
        } else if (url.pathname === '/api/alerts') {
          this.handleAlerts(req, res);
        } else if (url.pathname === '/api/discoveries') {
          this.handleDiscoveries(req, res);
        } else if (url.pathname === '/api/stats') {
          this.handleStats(req, res);
        } else if (url.pathname.startsWith('/api/')) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        } else {
          // Serve static files from dashboard
          this.serveStatic(url.pathname, res);
        }
      } catch (error) {
        logger.error('API', 'Request failed', error as Error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });

    this.server.listen(PORT, () => {
      logger.info('API', `Dashboard server running at http://localhost:${PORT}`);
    });
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /**
   * Portfolio endpoint - returns portfolio value and positions
   */
  private async handlePortfolio(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const chatId = config.telegramChatId;
    const settings = storageService.getUserSettings(chatId);
    const watchlist = settings.watchlist;

    let totalValue = 0;
    let totalCost = 0;
    const positions: any[] = [];

    // Calculate portfolio value from watchlist
    for (const token of watchlist) {
      if (token.lastPrice && token.addedPrice) {
        const value = token.lastPrice; // Assuming 1 unit for simplicity
        const cost = token.addedPrice;
        totalValue += value;
        totalCost += cost;

        positions.push({
          mint: token.mint,
          symbol: token.symbol,
          name: token.name,
          price: token.lastPrice,
          priceChange: token.priceChangePercent,
          addedAt: token.addedAt,
        });
      }
    }

    const change = totalValue - totalCost;
    const changePercent = totalCost > 0 ? ((change / totalCost) * 100).toFixed(1) : '0';

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      totalValue: totalValue.toFixed(2),
      change: change.toFixed(2),
      changePercent,
      positions,
      tokenCount: watchlist.length,
    }));
  }

  /**
   * Watchlist endpoint - returns watched tokens with prices
   */
  private async handleWatchlist(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const chatId = config.telegramChatId;
    const watchlist = storageService.getWatchlist(chatId);

    const tokens = watchlist.map(token => ({
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      price: token.lastPrice,
      priceChange: token.priceChangePercent,
      addedAt: token.addedAt,
      addedPrice: token.addedPrice,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tokens }));
  }

  /**
   * Alerts endpoint - returns recent alerts
   */
  private handleAlerts(req: http.IncomingMessage, res: http.ServerResponse): void {
    const alerts = this.recentAlerts.map(alert => ({
      ...alert,
      timeAgo: this.formatTimeAgo(alert.timestamp),
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ alerts }));
  }

  /**
   * Discoveries endpoint - returns recent token discoveries
   */
  private handleDiscoveries(req: http.IncomingMessage, res: http.ServerResponse): void {
    const discoveries = this.recentDiscoveries.map(d => ({
      ...d,
      timeAgo: this.formatTimeAgo(d.timestamp),
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ discoveries }));
  }

  /**
   * Stats endpoint - returns bot statistics
   */
  private handleStats(req: http.IncomingMessage, res: http.ServerResponse): void {
    const dbStats = database.getStats();
    const chatId = config.telegramChatId;
    const watchlist = storageService.getWatchlist(chatId);

    // Count winners (positive price change)
    const winners = watchlist.filter(t => t.priceChangePercent > 0).length;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      tokenCount: watchlist.length,
      winners,
      alertsToday: dbStats.alertsToday,
      totalAnalyses: dbStats.totalAnalyses,
      totalAlerts: dbStats.totalAlerts,
    }));
  }

  /**
   * Health check endpoint - returns system health status
   * Used for monitoring and alerting
   */
  private async handleHealth(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const checks: Record<string, { status: 'healthy' | 'degraded' | 'unhealthy'; message?: string; latencyMs?: number }> = {};
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // Check Solana RPC connection
    try {
      const start = Date.now();
      const slot = await solanaService.getConnection().getSlot();
      const latency = Date.now() - start;
      checks.solana_rpc = {
        status: latency < 5000 ? 'healthy' : 'degraded',
        message: `Current slot: ${slot}`,
        latencyMs: latency,
      };
      if (latency >= 5000) overallStatus = 'degraded';
    } catch (error) {
      checks.solana_rpc = {
        status: 'unhealthy',
        message: (error as Error).message,
      };
      overallStatus = 'unhealthy';
    }

    // Check Database
    try {
      const start = Date.now();
      const dbStats = database.getStats();
      const latency = Date.now() - start;
      checks.database = {
        status: 'healthy',
        message: `${dbStats.totalAnalyses} analyses stored`,
        latencyMs: latency,
      };
    } catch (error) {
      checks.database = {
        status: 'unhealthy',
        message: (error as Error).message,
      };
      overallStatus = 'unhealthy';
    }

    // Check Wallet Monitor
    try {
      const walletStats = walletMonitorService.getStats();
      checks.wallet_monitor = {
        status: walletMonitorService.isActive() ? 'healthy' : 'degraded',
        message: `${walletStats.trackedWallets} wallets tracked, mode: ${walletStats.mode}`,
      };
      if (!walletMonitorService.isActive() && overallStatus === 'healthy') {
        overallStatus = 'degraded';
      }
    } catch (error) {
      checks.wallet_monitor = {
        status: 'degraded',
        message: (error as Error).message,
      };
      if (overallStatus === 'healthy') overallStatus = 'degraded';
    }

    // Calculate uptime
    const uptimeMs = Date.now() - startupTime;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    const uptimeMinutes = Math.floor(uptimeSeconds / 60);
    const uptimeHours = Math.floor(uptimeMinutes / 60);
    const uptimeDays = Math.floor(uptimeHours / 24);

    let uptimeString: string;
    if (uptimeDays > 0) {
      uptimeString = `${uptimeDays}d ${uptimeHours % 24}h ${uptimeMinutes % 60}m`;
    } else if (uptimeHours > 0) {
      uptimeString = `${uptimeHours}h ${uptimeMinutes % 60}m`;
    } else {
      uptimeString = `${uptimeMinutes}m ${uptimeSeconds % 60}s`;
    }

    // Memory usage
    const memUsage = process.memoryUsage();
    const memoryMB = Math.round(memUsage.heapUsed / 1024 / 1024);

    const healthResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: uptimeString,
      uptimeMs,
      memory: {
        heapUsedMB: memoryMB,
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        rssMB: Math.round(memUsage.rss / 1024 / 1024),
      },
      checks,
      version: '1.0.0', // Could be read from package.json
    };

    const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(healthResponse, null, 2));
  }

  /**
   * Serve static files from dashboard directory
   */
  private serveStatic(pathname: string, res: http.ServerResponse): void {
    let filePath = path.join(DASHBOARD_DIR, pathname === '/' ? 'index.html' : pathname);

    // Security: prevent directory traversal
    if (!filePath.startsWith(DASHBOARD_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const extname = path.extname(filePath);
    const contentTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    };

    const contentType = contentTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404);
          res.end('Not found');
        } else {
          res.writeHead(500);
          res.end('Server error');
        }
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  }

  /**
   * Format timestamp as "Xm ago" or "Xh ago"
   */
  private formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  }
}

export const apiServer = new ApiServer();
