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
import { signalService } from '../signals';
import { trainingPipeline } from '../ml/trainingPipeline';
import { manualLabelingService } from '../ml/manualLabeling';
import { featureEngineering } from '../ml/featureEngineering';
import { rugPredictor } from '../ml/rugPredictor';
import type { TradingSignal } from '../signals/types';

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
        // Signal API endpoints
        } else if (url.pathname === '/api/signals') {
          if (req.method === 'GET') {
            this.handleGetSignals(req, res, url);
          }
        } else if (url.pathname === '/api/signals/history') {
          this.handleGetSignalHistory(req, res, url);
        } else if (url.pathname === '/api/signals/performance') {
          this.handleGetSignalPerformance(req, res);
        } else if (url.pathname.match(/^\/api\/signals\/[^/]+\/outcome$/)) {
          if (req.method === 'POST') {
            await this.handleRecordSignalOutcome(req, res, url);
          }
        // Webhook API endpoints
        } else if (url.pathname === '/api/webhooks') {
          if (req.method === 'GET') {
            this.handleGetWebhooks(req, res);
          } else if (req.method === 'POST') {
            await this.handleAddWebhook(req, res);
          }
        } else if (url.pathname.match(/^\/api\/webhooks\/\d+$/)) {
          if (req.method === 'DELETE') {
            await this.handleDeleteWebhook(req, res, url);
          }
        // ML API endpoints
        } else if (url.pathname === '/api/ml/status') {
          this.handleGetMLStatus(req, res);
        } else if (url.pathname === '/api/ml/metrics') {
          this.handleGetMLMetrics(req, res);
        } else if (url.pathname === '/api/ml/pending') {
          this.handleGetPendingLabels(req, res, url);
        } else if (url.pathname === '/api/ml/label') {
          if (req.method === 'POST') {
            await this.handleAddLabel(req, res);
          }
        } else if (url.pathname === '/api/ml/train') {
          if (req.method === 'POST') {
            await this.handleTriggerTraining(req, res);
          }
        } else if (url.pathname === '/api/ml/history') {
          this.handleGetTrainingHistory(req, res, url);
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

    // Check Database with comprehensive health check
    try {
      const healthResult = await database.healthCheck();
      const migrationInfo = database.getMigrationInfo();
      const backupInfo = database.getBackupInfo();
      
      checks.database = {
        status: healthResult.healthy ? 'healthy' : 'unhealthy',
        message: healthResult.healthy
          ? `Schema v${healthResult.details.schemaVersion} | ${healthResult.details.tableCount} tables | ${healthResult.details.recordCount.toLocaleString()} records`
          : `Health check failed: ${healthResult.details.errors.join(', ')}`,
        latencyMs: healthResult.details.connectionTime,
      };
      
      // Add migration status
      checks.database_migrations = {
        status: migrationInfo.pendingMigrations === 0 ? 'healthy' : 'degraded',
        message: `v${migrationInfo.currentVersion} (${migrationInfo.pendingMigrations} pending)`,
      };
      
      // Add backup status
      checks.database_backups = {
        status: backupInfo.totalBackups > 0 ? 'healthy' : 'degraded',
        message: `${backupInfo.totalBackups} backups | ${(backupInfo.totalSizeBytes / 1024 / 1024).toFixed(2)} MB`,
      };
      
      if (!healthResult.healthy) {
        overallStatus = 'unhealthy';
      }
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

  // ═══════════════════════════════════════════
  // SIGNAL API HANDLERS
  // ═══════════════════════════════════════════

  /**
   * Get active signals
   */
  private handleGetSignals(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
    const status = url.searchParams.get('status') || 'active';
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    const signals = database.getSignals({ status, limit });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ signals }));
  }

  /**
   * Get signal history
   */
  private handleGetSignalHistory(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    const signals = database.getSignals({ limit });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ signals }));
  }

  /**
   * Get signal performance metrics
   */
  private handleGetSignalPerformance(req: http.IncomingMessage, res: http.ServerResponse): void {
    const stats = database.getSignalStats();

    // Calculate win rate from available stats
    const winRate = stats.executedSignals > 0
      ? (stats.accurateSignals / stats.executedSignals) * 100
      : 0;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      totalSignals: stats.totalSignals,
      activeSignals: stats.activeSignals,
      executedSignals: stats.executedSignals,
      accurateSignals: stats.accurateSignals,
      avgProfitLoss: stats.avgProfitLoss,
      winRate,
    }));
  }

  /**
   * Record signal outcome
   */
  private async handleRecordSignalOutcome(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    if (!this.verifyApiKey(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    try {
      const pathParts = url.pathname.split('/');
      const signalId = pathParts[pathParts.length - 2];

      const body = await this.parseBody(req);
      const { entryPrice, exitPrice } = body;

      if (!entryPrice || !exitPrice) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'entryPrice and exitPrice are required' }));
        return;
      }

      const signal = database.getSignalById(signalId);
      if (!signal) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Signal not found' }));
        return;
      }

      const profitLossPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
      const wasAccurate = signal.type === 'BUY' ? profitLossPercent > 0 : profitLossPercent < 0;
      const now = Math.floor(Date.now() / 1000);

      database.recordSignalOutcome({
        id: signalId,
        actualEntry: entryPrice,
        actualExit: exitPrice,
        profitLossPercent,
        wasAccurate,
        entryRecordedAt: now,
        exitRecordedAt: now,
      });
      signalService.recordOutcome(signalId, entryPrice, exitPrice);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        profitLossPercent,
        wasAccurate,
      }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
  }

  // ═══════════════════════════════════════════
  // WEBHOOK API HANDLERS
  // ═══════════════════════════════════════════

  /**
   * Get webhooks
   */
  private handleGetWebhooks(req: http.IncomingMessage, res: http.ServerResponse): void {
    const webhooks = database.getWebhooks();

    // Don't expose full URL, just a masked version
    const maskedWebhooks = webhooks.map(w => ({
      id: w.id,
      name: w.name,
      enabled: w.enabled,
      events: w.events,
      minConfidence: w.min_confidence,
      urlMasked: w.url.slice(0, 40) + '...',
      successCount: w.success_count,
      failureCount: w.failure_count,
      lastTriggeredAt: w.last_triggered_at,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ webhooks: maskedWebhooks }));
  }

  /**
   * Add webhook
   */
  private async handleAddWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.verifyApiKey(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    try {
      const body = await this.parseBody(req);
      const { url, name, events, minConfidence } = body;

      if (!url) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'url is required' }));
        return;
      }

      // Validate Discord webhook URL
      if (!url.startsWith('https://discord.com/api/webhooks/') &&
          !url.startsWith('https://discordapp.com/api/webhooks/')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid Discord webhook URL' }));
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const webhookId = database.saveWebhook({
        url,
        name: name || 'Discord Webhook',
        enabled: true,
        events: events || ['BUY', 'SELL', 'TAKE_PROFIT', 'STOP_LOSS'],
        minConfidence: minConfidence || 60,
        createdAt: now,
      });

      // Register with signal service
      signalService.addWebhook({
        id: webhookId.toString(),
        url,
        name: name || 'Discord Webhook',
        enabled: true,
        events: events || ['BUY', 'SELL', 'TAKE_PROFIT', 'STOP_LOSS'],
        minConfidence: minConfidence || 60,
      });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Webhook added' }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
  }

  /**
   * Delete webhook
   */
  private async handleDeleteWebhook(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    if (!this.verifyApiKey(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const webhookId = parseInt(url.pathname.split('/').pop() || '0', 10);

    if (!webhookId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid webhook ID' }));
      return;
    }

    database.deleteWebhook(webhookId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Webhook deleted' }));
  }

  // ═══════════════════════════════════════════
  // ML API HANDLERS
  // ═══════════════════════════════════════════

  /**
   * Get ML status
   */
  private handleGetMLStatus(req: http.IncomingMessage, res: http.ServerResponse): void {
    const status = trainingPipeline.getStatus();
    const sampleCounts = database.getMLSampleCount();
    const activeVersion = database.getActiveModelVersion();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      isTraining: status.isTraining,
      lastTrainingAt: status.lastTrainingAt,
      totalSamples: status.totalSamples,
      newSamplesSinceLastTrain: status.newSamplesSinceLastTrain,
      nextTrainingEligible: status.nextTrainingEligible,
      sampleCounts,
      activeVersion,
      modelLoaded: rugPredictor.isModelLoaded(),
    }));
  }

  /**
   * Get ML metrics
   */
  private handleGetMLMetrics(req: http.IncomingMessage, res: http.ServerResponse): void {
    const latestRun = database.getLatestTrainingRun();

    if (!latestRun) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ metrics: null, message: 'No training runs yet' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      metrics: {
        modelVersion: latestRun.model_version,
        accuracy: latestRun.accuracy,
        precision: latestRun.precision_score,
        recall: latestRun.recall_score,
        f1Score: latestRun.f1_score,
        auc: latestRun.auc_score,
        samplesUsed: latestRun.samples_used,
        epochs: latestRun.epochs,
        trainingDurationMs: latestRun.training_duration_ms,
        trainedAt: latestRun.trained_at,
        confusionMatrix: latestRun.confusion_matrix,
      },
    }));
  }

  /**
   * Get pending labels
   */
  private handleGetPendingLabels(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    const pending = manualLabelingService.getPendingTokens(limit);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ pending }));
  }

  /**
   * Add manual label
   */
  private async handleAddLabel(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.verifyApiKey(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    try {
      const body = await this.parseBody(req);
      const { mint, label, labeledBy } = body;

      if (!mint || !label) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'mint and label are required' }));
        return;
      }

      const validLabels = ['rug', 'pump', 'stable', 'decline'];
      if (!validLabels.includes(label)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Invalid label. Valid options: ${validLabels.join(', ')}` }));
        return;
      }

      // Get features for the token
      const analysis = database.getAnalysisByMint(mint);
      let features: Record<string, number>;

      if (analysis) {
        const enhancedFeatures = featureEngineering.extractFeaturesBasic({
          liquidityUsd: analysis.liquidity_usd,
          riskScore: analysis.risk_score,
          holderCount: analysis.holder_count,
          top10Percent: analysis.top_10_percent,
          mintRevoked: analysis.mint_revoked,
          freezeRevoked: analysis.freeze_revoked,
          lpBurnedPercent: analysis.lp_burned_percent,
          hasSocials: analysis.has_twitter || analysis.has_telegram || analysis.has_website,
          tokenAgeHours: 24,
        });
        features = featureEngineering.featuresToRecord(enhancedFeatures);
      } else {
        const enhancedFeatures = featureEngineering.extractFeaturesBasic({
          liquidityUsd: 0,
          riskScore: 50,
          holderCount: 100,
          top10Percent: 50,
          mintRevoked: false,
          freezeRevoked: false,
          lpBurnedPercent: 0,
          hasSocials: false,
          tokenAgeHours: 24,
        });
        features = featureEngineering.featuresToRecord(enhancedFeatures);
      }

      const success = manualLabelingService.labelToken(mint, label, labeledBy || 'api', features);

      if (success) {
        trainingPipeline.recordNewSample();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Label added' }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to add label' }));
      }
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
  }

  /**
   * Trigger model training
   */
  private async handleTriggerTraining(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.verifyApiKey(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const status = trainingPipeline.getStatus();

    if (status.isTraining) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Training already in progress' }));
      return;
    }

    const sampleCounts = database.getMLSampleCount();
    if (sampleCounts.labeled < 50) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Insufficient samples',
        required: 50,
        current: sampleCounts.labeled,
      }));
      return;
    }

    // Start training asynchronously
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: 'Training started',
      samplesUsed: sampleCounts.labeled,
    }));

    // Run training in background
    trainingPipeline.train().catch(err => {
      logger.error('API', 'Training failed', err);
    });
  }

  /**
   * Get training history
   */
  private handleGetTrainingHistory(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    const runs = database.getTrainingRuns(limit);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ runs }));
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
