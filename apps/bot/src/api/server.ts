/**
 * API Server for Dashboard
 * Serves live data from the bot to the web dashboard
 */

import http from 'http';
import path from 'path';
import fs from 'fs';
import { storageService } from '../services/storage';
import { database } from '../database';
import { solanaService } from '../services/solana';
import { walletMonitorService } from '../services/walletMonitor';
import { supabaseSyncService } from '../services/supabaseSync';
import { config } from '../config';
import { logger } from '../utils/logger';

// Dashboard API key for secure communication
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY;

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
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

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
          if (req.method === 'GET') {
            await this.handleWatchlist(req, res);
          } else if (req.method === 'POST') {
            await this.handleAddToWatchlist(req, res);
          } else if (req.method === 'DELETE') {
            await this.handleRemoveFromWatchlist(req, res, url);
          }
        } else if (url.pathname === '/api/alerts') {
          this.handleAlerts(req, res);
        } else if (url.pathname === '/api/discoveries') {
          this.handleDiscoveries(req, res);
        } else if (url.pathname === '/api/stats') {
          this.handleStats(req, res);
        } else if (url.pathname === '/api/settings') {
          if (req.method === 'GET') {
            this.handleGetSettings(req, res);
          } else if (req.method === 'POST') {
            await this.handleUpdateSettings(req, res);
          }
        } else if (url.pathname === '/api/backtest/strategies') {
          this.handleBacktestStrategies(req, res);
        } else if (url.pathname === '/api/backtest/runs') {
          this.handleBacktestRuns(req, res, url);
        } else if (url.pathname === '/api/backtest/run') {
          if (req.method === 'POST') {
            await this.handleTriggerBacktest(req, res);
          }
        } else if (url.pathname.startsWith('/api/backtest/run/')) {
          const runId = parseInt(url.pathname.split('/').pop() || '0', 10);
          this.handleBacktestRunDetail(req, res, runId);
        } else if (url.pathname === '/api/token/analysis') {
          await this.handleTokenAnalysis(req, res, url);
        } else if (url.pathname === '/api/sync/status') {
          this.handleSyncStatus(req, res);
        } else if (url.pathname === '/api/command') {
          if (req.method === 'POST') {
            await this.handleCommand(req, res);
          }
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
   * Verify API key for protected endpoints
   */
  private verifyApiKey(req: http.IncomingMessage): boolean {
    if (!DASHBOARD_API_KEY) return true; // No key configured = allow all
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    return apiKey === DASHBOARD_API_KEY;
  }

  /**
   * Parse JSON body from request
   */
  private async parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * Add token to watchlist
   */
  private async handleAddToWatchlist(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.verifyApiKey(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    try {
      const body = await this.parseBody(req);
      const { mint, symbol, name, price } = body;

      if (!mint) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'mint is required' }));
        return;
      }

      const chatId = config.telegramChatId;
      const now = Date.now();

      storageService.addToWatchlist(chatId, {
        mint,
        symbol: symbol || 'UNKNOWN',
        name: name || 'Unknown Token',
        addedAt: now,
        addedPrice: price || 0,
        lastPrice: price || 0,
        lastChecked: now,
        priceChangePercent: 0,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Token added to watchlist' }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
  }

  /**
   * Remove token from watchlist
   */
  private async handleRemoveFromWatchlist(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    if (!this.verifyApiKey(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const mint = url.searchParams.get('mint');
    if (!mint) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'mint query parameter is required' }));
      return;
    }

    const chatId = config.telegramChatId;
    storageService.removeFromWatchlist(chatId, mint);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Token removed from watchlist' }));
  }

  /**
   * Get user settings
   */
  private handleGetSettings(req: http.IncomingMessage, res: http.ServerResponse): void {
    const chatId = config.telegramChatId;
    const settings = storageService.getUserSettings(chatId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      filters: settings.filters,
      trackedWallets: settings.trackedWallets,
      blacklist: settings.blacklist,
    }));
  }

  /**
   * Update user settings
   */
  private async handleUpdateSettings(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.verifyApiKey(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    try {
      const body = await this.parseBody(req);
      const chatId = config.telegramChatId;

      if (body.filters) {
        const current = storageService.getUserSettings(chatId);
        storageService.updateUserSettings(chatId, {
          filters: { ...current.filters, ...body.filters },
        });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Settings updated' }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
  }

  /**
   * Get backtest strategies
   */
  private handleBacktestStrategies(req: http.IncomingMessage, res: http.ServerResponse): void {
    const strategies = database.getAllBacktestStrategies();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ strategies }));
  }

  /**
   * Get backtest runs
   */
  private handleBacktestRuns(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const runs = database.getRecentBacktestRuns(limit);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ runs }));
  }

  /**
   * Get backtest run detail
   */
  private handleBacktestRunDetail(req: http.IncomingMessage, res: http.ServerResponse, runId: number): void {
    const run = database.getBacktestRun(runId);
    if (!run) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Run not found' }));
      return;
    }

    const trades = database.getBacktestTrades(runId, 100);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ run, trades }));
  }

  /**
   * Trigger a backtest run
   */
  private async handleTriggerBacktest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.verifyApiKey(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    try {
      const body = await this.parseBody(req);
      const { strategyName, days, initialCapital } = body;

      if (!strategyName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'strategyName is required' }));
        return;
      }

      // Queue the backtest (would integrate with backtest engine)
      // For now, return a placeholder response
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: 'Backtest queued',
        strategyName,
        days: days || 7,
        initialCapital: initialCapital || 10000,
      }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
  }

  /**
   * Get token analysis by mint
   */
  private async handleTokenAnalysis(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const mint = url.searchParams.get('mint');
    if (!mint) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'mint query parameter is required' }));
      return;
    }

    // Get snapshots for this token
    const snapshots = database.getTokenSnapshots(mint, 50);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      mint,
      snapshots,
      snapshotCount: snapshots.length,
    }));
  }

  /**
   * Get Supabase sync status
   */
  private handleSyncStatus(req: http.IncomingMessage, res: http.ServerResponse): void {
    const syncStatus = supabaseSyncService.getSyncStatus();
    const statusArray: any[] = [];

    syncStatus.forEach((metadata, tableName) => {
      statusArray.push({
        tableName,
        lastSyncedAt: metadata.lastSyncedAt,
        syncStatus: metadata.syncStatus,
        errorMessage: metadata.errorMessage,
      });
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connected: supabaseSyncService.isConnected(),
      tables: statusArray,
    }));
  }

  /**
   * Handle dashboard commands
   */
  private async handleCommand(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.verifyApiKey(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    try {
      const body = await this.parseBody(req);
      const { command, params } = body;

      let result: any = { success: false };

      switch (command) {
        case 'setProfile':
          if (params?.profile) {
            const chatId = config.telegramChatId;
            storageService.setFilterProfile(chatId, params.profile);
            result = { success: true, message: `Profile set to ${params.profile}` };
          }
          break;

        case 'toggleAlerts':
          if (typeof params?.enabled === 'boolean') {
            const chatId = config.telegramChatId;
            storageService.setAlertsEnabled(chatId, params.enabled);
            result = { success: true, message: `Alerts ${params.enabled ? 'enabled' : 'disabled'}` };
          }
          break;

        case 'addWallet':
          if (params?.address && params?.label) {
            const chatId = config.telegramChatId;
            storageService.addTrackedWallet(chatId, {
              address: params.address,
              label: params.label,
              addedAt: Date.now(),
              lastChecked: Date.now(),
            });
            result = { success: true, message: 'Wallet added' };
          }
          break;

        case 'removeWallet':
          if (params?.address) {
            const chatId = config.telegramChatId;
            storageService.removeTrackedWallet(chatId, params.address);
            result = { success: true, message: 'Wallet removed' };
          }
          break;

        default:
          result = { success: false, error: 'Unknown command' };
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
  }

  /**
   * Serve static files from dashboard directory
   */
  private serveStatic(pathname: string, res: http.ServerResponse): void {
    const filePath = path.join(DASHBOARD_DIR, pathname === '/' ? 'index.html' : pathname);

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
