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
import { config } from '../config';
import { logger } from '../utils/logger';

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
        if (url.pathname === '/api/portfolio') {
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
