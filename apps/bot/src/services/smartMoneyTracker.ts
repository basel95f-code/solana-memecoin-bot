/**
 * Smart Money Tracker
 * Tracks wallet performance metrics to identify profitable traders
 */

import { EventEmitter } from 'events';
import type { Connection } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import { solanaService } from './solana';
import { dexScreenerService } from './dexscreener';
import { logger } from '../utils/logger';
import { storageService } from './storage';
import { walletProfiler } from './walletProfiler';

export interface WalletTrade {
  walletAddress: string;
  tokenMint: string;
  tokenSymbol?: string;
  entryPrice: number;
  entryAmount: number;
  entrySolValue: number;
  entryTimestamp: number;
  exitPrice?: number;
  exitAmount?: number;
  exitSolValue?: number;
  exitTimestamp?: number;
  profitLoss?: number;
  profitLossPercent?: number;
  isWin?: boolean;
  holdDuration?: number; // in hours
  status: 'open' | 'closed';
}

export interface SmartMoneyMetrics {
  walletAddress: string;
  label?: string;
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgProfitPercent: number;
  avgLossPercent: number;
  totalRoi: number;
  totalPnl: number; // in SOL
  bestTrade: {
    tokenSymbol: string;
    tokenMint: string;
    profit: number;
    profitPercent: number;
  } | null;
  worstTrade: {
    tokenSymbol: string;
    tokenMint: string;
    loss: number;
    lossPercent: number;
  } | null;
  last30DaysPnl: number;
  last7DaysPnl: number;
  avgHoldDuration: number; // in hours
  currentStreak: number; // positive = win streak, negative = loss streak
  maxWinStreak: number;
  maxLossStreak: number;
  profitFactor: number; // avg win / avg loss
  sharpeRatio?: number;
  rank?: number;
  lastUpdated: number;
}

export interface SmartMoneyAlert {
  walletAddress: string;
  walletLabel: string;
  action: 'buy' | 'sell';
  tokenMint: string;
  tokenSymbol: string;
  amount: number;
  solValue: number;
  priceUsd?: number;
  metrics: {
    winRate: number;
    totalRoi: number;
    last30DaysPnl: number;
  };
  timestamp: number;
}

export class SmartMoneyTracker extends EventEmitter {
  private connection: Connection;
  private trades: Map<string, WalletTrade[]> = new Map(); // walletAddress -> trades
  private metrics: Map<string, SmartMoneyMetrics> = new Map(); // walletAddress -> metrics
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor() {
    super();
    this.connection = solanaService.getConnection();
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    logger.info('SmartMoneyTracker', 'Smart money tracking started');

    // Load existing trades from storage
    await this.loadTradesFromStorage();

    // Update open positions every 5 minutes
    this.updateInterval = setInterval(() => {
      this.updateOpenPositions().catch(error => {
        logger.error('SmartMoneyTracker', 'Failed to update positions', error as Error);
      });
    }, 5 * 60 * 1000);

    // Initial update
    await this.updateOpenPositions();
  }

  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.isRunning = false;
    logger.info('SmartMoneyTracker', 'Smart money tracking stopped');
  }

  /**
   * Record a wallet's buy transaction
   */
  async recordBuy(
    walletAddress: string,
    tokenMint: string,
    tokenSymbol: string | undefined,
    amount: number,
    solValue: number,
    priceUsd?: number
  ): Promise<void> {
    // Get current price for entry
    let entryPrice = priceUsd || 0;
    if (!entryPrice) {
      const tokenData = await dexScreenerService.getTokenData(tokenMint);
      entryPrice = tokenData?.priceUsd || 0;
    }

    const trade: WalletTrade = {
      walletAddress,
      tokenMint,
      tokenSymbol,
      entryPrice,
      entryAmount: amount,
      entrySolValue: solValue,
      entryTimestamp: Date.now(),
      status: 'open',
    };

    // Add to trades map
    if (!this.trades.has(walletAddress)) {
      this.trades.set(walletAddress, []);
    }
    this.trades.get(walletAddress)!.push(trade);

    // Save to storage
    await this.saveTradeToStorage(trade);

    // Recalculate metrics
    await this.calculateMetrics(walletAddress);

    // Emit buy alert
    await this.emitSmartMoneyAlert(walletAddress, 'buy', trade);

    logger.debug('SmartMoneyTracker', `Recorded buy for ${walletAddress.slice(0, 8)}... - ${tokenSymbol || tokenMint.slice(0, 8)}`);
  }

  /**
   * Record a wallet's sell transaction
   */
  async recordSell(
    walletAddress: string,
    tokenMint: string,
    amount: number,
    solValue: number,
    priceUsd?: number
  ): Promise<void> {
    // Find the corresponding open trade
    const walletTrades = this.trades.get(walletAddress) || [];
    const openTrade = walletTrades.find(
      t => t.tokenMint === tokenMint && t.status === 'open'
    );

    if (!openTrade) {
      logger.debug('SmartMoneyTracker', `No open trade found for ${walletAddress.slice(0, 8)}... - ${tokenMint.slice(0, 8)}`);
      return;
    }

    // Get current price for exit
    let exitPrice = priceUsd || 0;
    if (!exitPrice) {
      const tokenData = await dexScreenerService.getTokenData(tokenMint);
      exitPrice = tokenData?.priceUsd || 0;
    }

    // Close the trade
    openTrade.exitPrice = exitPrice;
    openTrade.exitAmount = amount;
    openTrade.exitSolValue = solValue;
    openTrade.exitTimestamp = Date.now();
    openTrade.status = 'closed';

    // Calculate P&L
    const profitLoss = solValue - openTrade.entrySolValue;
    const profitLossPercent = ((exitPrice - openTrade.entryPrice) / openTrade.entryPrice) * 100;
    
    openTrade.profitLoss = profitLoss;
    openTrade.profitLossPercent = profitLossPercent;
    openTrade.isWin = profitLoss > 0;
    openTrade.holdDuration = (openTrade.exitTimestamp - openTrade.entryTimestamp) / (1000 * 60 * 60); // hours

    // Update storage
    await this.saveTradeToStorage(openTrade);

    // Recalculate metrics
    await this.calculateMetrics(walletAddress);

    // Emit sell alert
    await this.emitSmartMoneyAlert(walletAddress, 'sell', openTrade);

    logger.debug('SmartMoneyTracker', `Recorded sell for ${walletAddress.slice(0, 8)}... - ${openTrade.tokenSymbol || tokenMint.slice(0, 8)} (${profitLossPercent > 0 ? '+' : ''}${profitLossPercent.toFixed(1)}%)`);
  }

  /**
   * Calculate performance metrics for a wallet
   */
  async calculateMetrics(walletAddress: string): Promise<SmartMoneyMetrics> {
    const trades = this.trades.get(walletAddress) || [];
    const closedTrades = trades.filter(t => t.status === 'closed');

    const metrics: SmartMoneyMetrics = {
      walletAddress,
      label: this.getWalletLabel(walletAddress),
      totalTrades: trades.length,
      closedTrades: closedTrades.length,
      openTrades: trades.filter(t => t.status === 'open').length,
      wins: 0,
      losses: 0,
      winRate: 0,
      avgProfitPercent: 0,
      avgLossPercent: 0,
      totalRoi: 0,
      totalPnl: 0,
      bestTrade: null,
      worstTrade: null,
      last30DaysPnl: 0,
      last7DaysPnl: 0,
      avgHoldDuration: 0,
      currentStreak: 0,
      maxWinStreak: 0,
      maxLossStreak: 0,
      profitFactor: 0,
      lastUpdated: Date.now(),
    };

    if (closedTrades.length === 0) {
      this.metrics.set(walletAddress, metrics);
      return metrics;
    }

    // Calculate basic stats
    let totalWinPercent = 0;
    let totalLossPercent = 0;
    let totalPnl = 0;
    let totalHoldDuration = 0;
    let currentStreak = 0;
    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let tempWinStreak = 0;
    let tempLossStreak = 0;

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    for (const trade of closedTrades) {
      const pnl = trade.profitLoss || 0;
      const pnlPercent = trade.profitLossPercent || 0;
      const isWin = trade.isWin || false;

      totalPnl += pnl;

      if (isWin) {
        metrics.wins++;
        totalWinPercent += pnlPercent;
        tempWinStreak++;
        tempLossStreak = 0;
        if (tempWinStreak > maxWinStreak) maxWinStreak = tempWinStreak;
      } else {
        metrics.losses++;
        totalLossPercent += Math.abs(pnlPercent);
        tempLossStreak++;
        tempWinStreak = 0;
        if (tempLossStreak > maxLossStreak) maxLossStreak = tempLossStreak;
      }

      // Track best/worst trades
      if (!metrics.bestTrade || pnl > (metrics.bestTrade.profit || 0)) {
        metrics.bestTrade = {
          tokenSymbol: trade.tokenSymbol || 'Unknown',
          tokenMint: trade.tokenMint,
          profit: pnl,
          profitPercent: pnlPercent,
        };
      }

      if (!metrics.worstTrade || pnl < (metrics.worstTrade.loss || 0)) {
        metrics.worstTrade = {
          tokenSymbol: trade.tokenSymbol || 'Unknown',
          tokenMint: trade.tokenMint,
          loss: pnl,
          lossPercent: pnlPercent,
        };
      }

      // Last 30 days P&L
      if (trade.exitTimestamp && trade.exitTimestamp >= thirtyDaysAgo) {
        metrics.last30DaysPnl += pnl;
      }

      // Last 7 days P&L
      if (trade.exitTimestamp && trade.exitTimestamp >= sevenDaysAgo) {
        metrics.last7DaysPnl += pnl;
      }

      // Hold duration
      if (trade.holdDuration) {
        totalHoldDuration += trade.holdDuration;
      }
    }

    // Calculate averages
    metrics.winRate = closedTrades.length > 0 ? (metrics.wins / closedTrades.length) * 100 : 0;
    metrics.avgProfitPercent = metrics.wins > 0 ? totalWinPercent / metrics.wins : 0;
    metrics.avgLossPercent = metrics.losses > 0 ? totalLossPercent / metrics.losses : 0;
    metrics.totalPnl = totalPnl;
    metrics.avgHoldDuration = closedTrades.length > 0 ? totalHoldDuration / closedTrades.length : 0;
    metrics.maxWinStreak = maxWinStreak;
    metrics.maxLossStreak = maxLossStreak;

    // Calculate current streak (last trade determines)
    const lastTrade = closedTrades[closedTrades.length - 1];
    if (lastTrade?.isWin) {
      currentStreak = tempWinStreak;
    } else {
      currentStreak = -tempLossStreak;
    }
    metrics.currentStreak = currentStreak;

    // Calculate total ROI (total PnL / total invested)
    const totalInvested = closedTrades.reduce((sum, t) => sum + t.entrySolValue, 0);
    metrics.totalRoi = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

    // Profit factor (avg win / avg loss)
    metrics.profitFactor = metrics.avgLossPercent > 0 ? metrics.avgProfitPercent / metrics.avgLossPercent : 0;

    // Store metrics
    this.metrics.set(walletAddress, metrics);

    // Auto-generate profile if enough data (3+ closed trades)
    if (metrics.closedTrades >= 3) {
      try {
        await walletProfiler.generateProfile(walletAddress);
      } catch (error) {
        logger.silentError('SmartMoneyTracker', 'Failed to generate wallet profile', error as Error);
      }
    }

    return metrics;
  }

  /**
   * Get metrics for a specific wallet
   */
  getMetrics(walletAddress: string): SmartMoneyMetrics | null {
    return this.metrics.get(walletAddress) || null;
  }

  /**
   * Get leaderboard of top performing wallets
   */
  getLeaderboard(limit: number = 10): SmartMoneyMetrics[] {
    const allMetrics = Array.from(this.metrics.values());

    // Filter: must have at least 5 closed trades
    const qualified = allMetrics.filter(m => m.closedTrades >= 5);

    // Sort by total ROI descending
    qualified.sort((a, b) => b.totalRoi - a.totalRoi);

    // Assign ranks
    qualified.forEach((m, i) => {
      m.rank = i + 1;
    });

    return qualified.slice(0, limit);
  }

  /**
   * Get metrics for all tracked wallets
   */
  getAllMetrics(): SmartMoneyMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Update unrealized P&L for open positions
   */
  private async updateOpenPositions(): Promise<void> {
    for (const [walletAddress, trades] of this.trades.entries()) {
      const openTrades = trades.filter(t => t.status === 'open');

      for (const trade of openTrades) {
        try {
          // Get current price
          const tokenData = await dexScreenerService.getTokenData(trade.tokenMint);
          const currentPrice = tokenData?.priceUsd || 0;

          if (currentPrice > 0 && trade.entryPrice > 0) {
            // Calculate unrealized P&L
            const unrealizedPnlPercent = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
            const unrealizedPnl = (trade.entrySolValue * unrealizedPnlPercent) / 100;

            // Store as temporary fields (don't persist)
            (trade as any).unrealizedPnl = unrealizedPnl;
            (trade as any).unrealizedPnlPercent = unrealizedPnlPercent;
            (trade as any).currentPrice = currentPrice;
          }
        } catch (error) {
          logger.silentError('SmartMoneyTracker', `Failed to update position for ${trade.tokenMint}`, error as Error);
        }
      }
    }

    logger.debug('SmartMoneyTracker', 'Updated open positions');
  }

  /**
   * Emit smart money alert
   */
  private async emitSmartMoneyAlert(walletAddress: string, action: 'buy' | 'sell', trade: WalletTrade): Promise<void> {
    const metrics = this.metrics.get(walletAddress);
    if (!metrics) return;

    // Only emit alerts for wallets with good track record
    if (metrics.closedTrades < 5 || metrics.winRate < 50) {
      return;
    }

    const alert: SmartMoneyAlert = {
      walletAddress,
      walletLabel: metrics.label || `Wallet ${walletAddress.slice(0, 8)}...`,
      action,
      tokenMint: trade.tokenMint,
      tokenSymbol: trade.tokenSymbol || 'Unknown',
      amount: action === 'buy' ? trade.entryAmount : (trade.exitAmount || 0),
      solValue: action === 'buy' ? trade.entrySolValue : (trade.exitSolValue || 0),
      priceUsd: action === 'buy' ? trade.entryPrice : trade.exitPrice,
      metrics: {
        winRate: metrics.winRate,
        totalRoi: metrics.totalRoi,
        last30DaysPnl: metrics.last30DaysPnl,
      },
      timestamp: Date.now(),
    };

    this.emit('smartMoneyAlert', alert);
  }

  /**
   * Get wallet label from storage
   */
  private getWalletLabel(walletAddress: string): string | undefined {
    // Check all chat IDs for this wallet
    const chatIds = storageService.getAllTrackedWalletChatIds();
    for (const chatId of chatIds) {
      const wallets = storageService.getTrackedWallets(chatId);
      const found = wallets.find(w => w.address === walletAddress);
      if (found) return found.label;
    }
    return undefined;
  }

  /**
   * Load trades from storage
   */
  private async loadTradesFromStorage(): Promise<void> {
    // Load from storage (to be implemented with actual storage)
    // For now, trades are kept in memory only
    logger.debug('SmartMoneyTracker', 'Loaded trades from storage');
  }

  /**
   * Save trade to storage
   */
  private async saveTradeToStorage(trade: WalletTrade): Promise<void> {
    // Save to storage (to be implemented with actual storage)
    // For now, trades are kept in memory only
  }

  /**
   * Check if a wallet qualifies as "smart money"
   */
  isSmartMoney(walletAddress: string): boolean {
    const metrics = this.metrics.get(walletAddress);
    if (!metrics) return false;

    // Criteria:
    // - At least 10 closed trades
    // - Win rate >= 65%
    // - Total ROI >= 100%
    // - Profit factor >= 2

    return (
      metrics.closedTrades >= 10 &&
      metrics.winRate >= 65 &&
      metrics.totalRoi >= 100 &&
      metrics.profitFactor >= 2
    );
  }

  /**
   * Suggest wallets to track based on performance
   */
  async suggestWalletsToTrack(): Promise<SmartMoneyMetrics[]> {
    const allMetrics = Array.from(this.metrics.values());

    // Filter high performers that aren't tracked yet
    const suggestions = allMetrics.filter(m => 
      this.isSmartMoney(m.walletAddress) &&
      !this.isWalletTrackedByAnyone(m.walletAddress)
    );

    // Sort by ROI
    suggestions.sort((a, b) => b.totalRoi - a.totalRoi);

    return suggestions.slice(0, 5);
  }

  /**
   * Check if a wallet is tracked by any user
   */
  private isWalletTrackedByAnyone(walletAddress: string): boolean {
    const chatIds = storageService.getAllTrackedWalletChatIds();
    for (const chatId of chatIds) {
      if (storageService.isWalletTracked(chatId, walletAddress)) {
        return true;
      }
    }
    return false;
  }
}

// Singleton instance
export const smartMoneyTracker = new SmartMoneyTracker();
