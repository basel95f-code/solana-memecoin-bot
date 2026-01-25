/**
 * Performance Analytics
 * Advanced performance metrics including win rate, Sharpe ratio, max drawdown, etc.
 */

import { getSupabaseClient } from '../database/supabase';
import { logger } from '../utils/logger';

export interface PerformanceMetrics {
  // Period
  period: 'daily' | 'weekly' | 'monthly' | 'all_time';
  periodStart: Date;
  periodEnd: Date;
  
  // P&L
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  roiPercent: number;
  
  // Trade metrics
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  
  // Win/Loss analysis
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  
  // Risk metrics
  sharpeRatio: number | null;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  
  // Streaks
  currentStreak: number;
  bestStreak: number;
  worstStreak: number;
  
  // Holding times
  avgHoldingTimeHours: number;
  medianHoldingTimeHours: number;
}

export interface TradeAnalysis {
  symbol: string;
  entryPrice: number;
  exitPrice: number;
  amount: number;
  realizedPnl: number;
  realizedPnlPercent: number;
  holdingPeriodHours: number;
  isWinner: boolean;
  timestamp: Date;
}

export interface DrawdownPeriod {
  startDate: Date;
  endDate: Date;
  peakValue: number;
  troughValue: number;
  drawdownAmount: number;
  drawdownPercent: number;
  recoveryDate: Date | null;
  durationDays: number;
}

export class PerformanceAnalytics {
  private supabase = getSupabaseClient();
  
  /**
   * Calculate performance metrics for a time period
   */
  async calculatePerformance(
    userId: string = 'default',
    period: 'daily' | 'weekly' | 'monthly' | 'all_time' = 'all_time'
  ): Promise<PerformanceMetrics> {
    const { periodStart, periodEnd } = this.getPeriodDates(period);
    
    // Get all trades in period
    const { data: trades } = await this.supabase
      .from('portfolio_trades')
      .select('*')
      .eq('user_id', userId)
      .in('action', ['sell', 'partial_sell'])
      .gte('timestamp', periodStart.toISOString())
      .lte('timestamp', periodEnd.toISOString())
      .order('timestamp', { ascending: true });
    
    if (!trades || trades.length === 0) {
      return this.getEmptyMetrics(period, periodStart, periodEnd);
    }
    
    // Calculate basic metrics
    const realizedPnl = trades.reduce((sum, t) => sum + (parseFloat(t.realized_pnl) || 0), 0);
    
    // Get unrealized P&L from current positions
    const { data: positions } = await this.supabase
      .from('portfolio_positions')
      .select('unrealized_pnl, entry_value')
      .eq('user_id', userId)
      .eq('status', 'open');
    
    const unrealizedPnl = (positions || []).reduce((sum, p) => sum + parseFloat(p.unrealized_pnl), 0);
    const totalInvested = (positions || []).reduce((sum, p) => sum + parseFloat(p.entry_value), 0);
    
    const totalPnl = realizedPnl + unrealizedPnl;
    const roiPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
    
    // Win/Loss analysis
    const winningTrades = trades.filter(t => parseFloat(t.realized_pnl) > 0);
    const losingTrades = trades.filter(t => parseFloat(t.realized_pnl) < 0);
    
    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
    
    const totalWins = winningTrades.reduce((sum, t) => sum + parseFloat(t.realized_pnl), 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + parseFloat(t.realized_pnl), 0));
    
    const avgWin = winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;
    
    const largestWin = winningTrades.length > 0
      ? Math.max(...winningTrades.map(t => parseFloat(t.realized_pnl)))
      : 0;
    
    const largestLoss = losingTrades.length > 0
      ? Math.min(...losingTrades.map(t => parseFloat(t.realized_pnl)))
      : 0;
    
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? 999 : 0);
    
    // Streak analysis
    const { currentStreak, bestStreak, worstStreak } = this.calculateStreaks(trades);
    
    // Holding time analysis
    const { avgHoldingTimeHours, medianHoldingTimeHours } = this.calculateHoldingTimes(trades);
    
    // Risk metrics
    const sharpeRatio = await this.calculateSharpeRatio(userId, periodStart, periodEnd);
    const { maxDrawdown, maxDrawdownPercent } = await this.calculateMaxDrawdown(userId, periodStart, periodEnd);
    
    // Save metrics to database
    await this.savePerformanceMetrics({
      userId,
      period,
      periodStart,
      periodEnd,
      realizedPnl,
      unrealizedPnl,
      totalPnl,
      roiPercent,
      totalTrades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      profitFactor,
      sharpeRatio,
      maxDrawdown,
      maxDrawdownPercent,
      currentStreak,
      bestStreak,
      worstStreak,
      avgHoldingTimeHours,
      medianHoldingTimeHours,
    });
    
    return {
      period,
      periodStart,
      periodEnd,
      realizedPnl,
      unrealizedPnl,
      totalPnl,
      roiPercent,
      totalTrades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      profitFactor,
      sharpeRatio,
      maxDrawdown,
      maxDrawdownPercent,
      currentStreak,
      bestStreak,
      worstStreak,
      avgHoldingTimeHours,
      medianHoldingTimeHours,
    };
  }
  
  /**
   * Get best and worst trades
   */
  async getBestWorstTrades(
    userId: string = 'default',
    limit: number = 10
  ): Promise<{ best: TradeAnalysis[]; worst: TradeAnalysis[] }> {
    // Get all closed trades
    const { data: trades } = await this.supabase
      .from('portfolio_trades')
      .select('*')
      .eq('user_id', userId)
      .in('action', ['sell', 'partial_sell'])
      .order('realized_pnl', { ascending: false });
    
    if (!trades || trades.length === 0) {
      return { best: [], worst: [] };
    }
    
    const best = trades.slice(0, limit).map(t => this.mapTradeAnalysis(t));
    const worst = trades.slice(-limit).reverse().map(t => this.mapTradeAnalysis(t));
    
    return { best, worst };
  }
  
  /**
   * Calculate Sharpe ratio (risk-adjusted returns)
   * Sharpe = (Mean Return - Risk-Free Rate) / Standard Deviation of Returns
   */
  private async calculateSharpeRatio(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number | null> {
    // Get daily snapshots for the period
    const { data: snapshots } = await this.supabase
      .from('portfolio_snapshots')
      .select('total_value, snapshot_date, daily_change_percent')
      .eq('user_id', userId)
      .gte('snapshot_date', startDate.toISOString().split('T')[0])
      .lte('snapshot_date', endDate.toISOString().split('T')[0])
      .order('snapshot_date', { ascending: true });
    
    if (!snapshots || snapshots.length < 2) {
      return null;
    }
    
    // Calculate daily returns
    const dailyReturns = snapshots
      .filter(s => s.daily_change_percent !== null)
      .map(s => parseFloat(s.daily_change_percent) / 100);
    
    if (dailyReturns.length < 2) {
      return null;
    }
    
    // Calculate mean return
    const meanReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
    
    // Calculate standard deviation
    const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / dailyReturns.length;
    const stdDev = Math.sqrt(variance);
    
    if (stdDev === 0) return null;
    
    // Risk-free rate (assume 0% for crypto)
    const riskFreeRate = 0;
    
    // Sharpe ratio (annualized)
    const sharpeRatio = ((meanReturn - riskFreeRate) / stdDev) * Math.sqrt(365);
    
    return sharpeRatio;
  }
  
  /**
   * Calculate maximum drawdown
   * Max Drawdown = (Trough Value - Peak Value) / Peak Value
   */
  private async calculateMaxDrawdown(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{ maxDrawdown: number; maxDrawdownPercent: number }> {
    // Get daily snapshots
    const { data: snapshots } = await this.supabase
      .from('portfolio_snapshots')
      .select('total_value, snapshot_date')
      .eq('user_id', userId)
      .gte('snapshot_date', startDate.toISOString().split('T')[0])
      .lte('snapshot_date', endDate.toISOString().split('T')[0])
      .order('snapshot_date', { ascending: true });
    
    if (!snapshots || snapshots.length < 2) {
      return { maxDrawdown: 0, maxDrawdownPercent: 0 };
    }
    
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    let peak = parseFloat(snapshots[0].total_value);
    
    for (const snapshot of snapshots) {
      const value = parseFloat(snapshot.total_value);
      
      if (value > peak) {
        peak = value;
      }
      
      const drawdown = peak - value;
      const drawdownPercent = peak > 0 ? (drawdown / peak) * 100 : 0;
      
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownPercent = drawdownPercent;
      }
    }
    
    return { maxDrawdown, maxDrawdownPercent };
  }
  
  /**
   * Calculate winning/losing streaks
   */
  private calculateStreaks(trades: any[]): {
    currentStreak: number;
    bestStreak: number;
    worstStreak: number;
  } {
    if (trades.length === 0) {
      return { currentStreak: 0, bestStreak: 0, worstStreak: 0 };
    }
    
    let currentStreak = 0;
    let bestStreak = 0;
    let worstStreak = 0;
    let tempStreak = 0;
    let lastWasWin = false;
    
    for (const trade of trades) {
      const isWin = parseFloat(trade.realized_pnl) > 0;
      
      if (tempStreak === 0) {
        // Start new streak
        tempStreak = isWin ? 1 : -1;
        lastWasWin = isWin;
      } else if ((isWin && lastWasWin) || (!isWin && !lastWasWin)) {
        // Continue streak
        tempStreak += isWin ? 1 : -1;
      } else {
        // Streak broken
        if (tempStreak > bestStreak) bestStreak = tempStreak;
        if (tempStreak < worstStreak) worstStreak = tempStreak;
        
        tempStreak = isWin ? 1 : -1;
        lastWasWin = isWin;
      }
    }
    
    // Final streak
    currentStreak = tempStreak;
    if (tempStreak > bestStreak) bestStreak = tempStreak;
    if (tempStreak < worstStreak) worstStreak = tempStreak;
    
    return { currentStreak, bestStreak, worstStreak };
  }
  
  /**
   * Calculate holding time statistics
   */
  private calculateHoldingTimes(trades: any[]): {
    avgHoldingTimeHours: number;
    medianHoldingTimeHours: number;
  } {
    if (trades.length === 0) {
      return { avgHoldingTimeHours: 0, medianHoldingTimeHours: 0 };
    }
    
    const holdingTimes: number[] = [];
    
    for (const trade of trades) {
      if (trade.holding_period_days !== null) {
        holdingTimes.push(trade.holding_period_days * 24);
      }
    }
    
    if (holdingTimes.length === 0) {
      return { avgHoldingTimeHours: 0, medianHoldingTimeHours: 0 };
    }
    
    const avgHoldingTimeHours = holdingTimes.reduce((sum, t) => sum + t, 0) / holdingTimes.length;
    
    const sorted = holdingTimes.sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianHoldingTimeHours = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
    
    return { avgHoldingTimeHours, medianHoldingTimeHours };
  }
  
  /**
   * Save performance metrics to database
   */
  private async savePerformanceMetrics(metrics: any): Promise<void> {
    try {
      await this.supabase
        .from('portfolio_performance')
        .upsert({
          user_id: metrics.userId,
          period: metrics.period,
          period_start: metrics.periodStart.toISOString(),
          period_end: metrics.periodEnd.toISOString(),
          realized_pnl: metrics.realizedPnl,
          unrealized_pnl: metrics.unrealizedPnl,
          total_pnl: metrics.totalPnl,
          roi_percent: metrics.roiPercent,
          total_trades: metrics.totalTrades,
          winning_trades: metrics.winningTrades,
          losing_trades: metrics.losingTrades,
          win_rate: metrics.winRate,
          avg_win: metrics.avgWin,
          avg_loss: metrics.avgLoss,
          largest_win: metrics.largestWin,
          largest_loss: metrics.largestLoss,
          profit_factor: metrics.profitFactor,
          sharpe_ratio: metrics.sharpeRatio,
          max_drawdown: metrics.maxDrawdown,
          max_drawdown_percent: metrics.maxDrawdownPercent,
          current_streak: metrics.currentStreak,
          best_streak: metrics.bestStreak,
          worst_streak: metrics.worstStreak,
          avg_holding_time_hours: metrics.avgHoldingTimeHours,
          median_holding_time_hours: metrics.medianHoldingTimeHours,
        }, {
          onConflict: 'user_id,period,period_start',
        });
      
      logger.debug('PerformanceAnalytics', `Saved ${metrics.period} performance metrics`);
    } catch (error) {
      logger.error('PerformanceAnalytics', 'Failed to save metrics', error as Error);
    }
  }
  
  /**
   * Get period date range
   */
  private getPeriodDates(period: 'daily' | 'weekly' | 'monthly' | 'all_time'): {
    periodStart: Date;
    periodEnd: Date;
  } {
    const now = new Date();
    let periodStart: Date;
    
    switch (period) {
      case 'daily':
        periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'weekly':
        periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'monthly':
        periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'all_time':
      default:
        periodStart = new Date(0); // Unix epoch
        break;
    }
    
    return { periodStart, periodEnd: now };
  }
  
  /**
   * Get empty metrics
   */
  private getEmptyMetrics(
    period: 'daily' | 'weekly' | 'monthly' | 'all_time',
    periodStart: Date,
    periodEnd: Date
  ): PerformanceMetrics {
    return {
      period,
      periodStart,
      periodEnd,
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalPnl: 0,
      roiPercent: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      profitFactor: 0,
      sharpeRatio: null,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      currentStreak: 0,
      bestStreak: 0,
      worstStreak: 0,
      avgHoldingTimeHours: 0,
      medianHoldingTimeHours: 0,
    };
  }
  
  /**
   * Map trade to analysis
   */
  private mapTradeAnalysis(trade: any): TradeAnalysis {
    return {
      symbol: trade.symbol,
      entryPrice: parseFloat(trade.price),
      exitPrice: parseFloat(trade.price),
      amount: parseFloat(trade.amount),
      realizedPnl: parseFloat(trade.realized_pnl),
      realizedPnlPercent: parseFloat(trade.realized_pnl_percent),
      holdingPeriodHours: (trade.holding_period_days || 0) * 24,
      isWinner: parseFloat(trade.realized_pnl) > 0,
      timestamp: new Date(trade.timestamp),
    };
  }
}

export const performanceAnalytics = new PerformanceAnalytics();
