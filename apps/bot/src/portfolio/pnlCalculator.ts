/**
 * P&L Calculator
 * Calculates portfolio P&L, ROI, and winners/losers breakdown
 */

import { getSupabaseClient } from '../database/supabase';
import type { Position } from './positionTracker';

export interface PnLSummary {
  // Total values
  totalValue: number;
  totalInvested: number;
  totalPnl: number;
  totalPnlPercent: number;
  
  // Breakdown
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  realizedPnl: number;
  
  // Position counts
  openPositions: number;
  totalPositions: number;
  
  // Winners/Losers
  winningPositions: number;
  losingPositions: number;
  breakEvenPositions: number;
  
  // Best/Worst
  bestPosition: Position | null;
  worstPosition: Position | null;
  
  // Updated
  lastUpdated: Date;
}

export interface PortfolioValue {
  totalValue: number;
  positions: Array<{
    symbol: string;
    value: number;
    percentage: number;
    pnl: number;
    pnlPercent: number;
  }>;
}

export interface ROIMetrics {
  roi: number;  // Overall ROI %
  roiDaily: number;
  roiWeekly: number;
  roiMonthly: number;
  roiYearly: number;
  
  // Comparison metrics
  totalInvested: number;
  totalValue: number;
  totalReturn: number;
  
  // Time-based
  firstTradeDate: Date | null;
  daysSinceFirstTrade: number;
}

export interface WinnersLosersBreakdown {
  winners: Position[];
  losers: Position[];
  breakEven: Position[];
  
  winnersCount: number;
  losersCount: number;
  breakEvenCount: number;
  
  totalWinAmount: number;
  totalLossAmount: number;
  
  avgWinPercent: number;
  avgLossPercent: number;
  
  largestWin: Position | null;
  largestLoss: Position | null;
}

export class PnLCalculator {
  private supabase = getSupabaseClient();
  
  /**
   * Get comprehensive P&L summary
   */
  async getPnLSummary(userId: string = 'default'): Promise<PnLSummary> {
    // Get all open positions
    const { data: positions } = await this.supabase
      .from('portfolio_positions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'open');
    
    if (!positions || positions.length === 0) {
      return this.getEmptySummary();
    }
    
    // Calculate totals
    const totalValue = positions.reduce((sum, p) => sum + parseFloat(p.current_value), 0);
    const totalInvested = positions.reduce((sum, p) => sum + parseFloat(p.entry_value), 0);
    const unrealizedPnl = positions.reduce((sum, p) => sum + parseFloat(p.unrealized_pnl), 0);
    
    // Get realized P&L from trades
    const { data: trades } = await this.supabase
      .from('portfolio_trades')
      .select('realized_pnl')
      .eq('user_id', userId)
      .in('action', ['sell', 'partial_sell']);
    
    const realizedPnl = (trades || []).reduce((sum, t) => sum + (parseFloat(t.realized_pnl) || 0), 0);
    
    const totalPnl = unrealizedPnl + realizedPnl;
    const totalPnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
    const unrealizedPnlPercent = totalInvested > 0 ? (unrealizedPnl / totalInvested) * 100 : 0;
    
    // Get total position count (including closed)
    const { count: totalCount } = await this.supabase
      .from('portfolio_positions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    
    // Winners/Losers
    const winningPositions = positions.filter(p => parseFloat(p.unrealized_pnl) > 0).length;
    const losingPositions = positions.filter(p => parseFloat(p.unrealized_pnl) < 0).length;
    const breakEvenPositions = positions.filter(p => parseFloat(p.unrealized_pnl) === 0).length;
    
    // Best/Worst positions
    let bestPosition: any = null;
    let worstPosition: any = null;
    
    for (const pos of positions) {
      const pnl = parseFloat(pos.unrealized_pnl);
      
      if (!bestPosition || pnl > parseFloat(bestPosition.unrealized_pnl)) {
        bestPosition = pos;
      }
      if (!worstPosition || pnl < parseFloat(worstPosition.unrealized_pnl)) {
        worstPosition = pos;
      }
    }
    
    return {
      totalValue,
      totalInvested,
      totalPnl,
      totalPnlPercent,
      unrealizedPnl,
      unrealizedPnlPercent,
      realizedPnl,
      openPositions: positions.length,
      totalPositions: totalCount || positions.length,
      winningPositions,
      losingPositions,
      breakEvenPositions,
      bestPosition: bestPosition ? this.mapPosition(bestPosition) : null,
      worstPosition: worstPosition ? this.mapPosition(worstPosition) : null,
      lastUpdated: new Date(),
    };
  }
  
  /**
   * Get portfolio value breakdown
   */
  async getPortfolioValue(userId: string = 'default'): Promise<PortfolioValue> {
    const { data: positions } = await this.supabase
      .from('portfolio_positions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'open')
      .order('current_value', { ascending: false });
    
    if (!positions || positions.length === 0) {
      return {
        totalValue: 0,
        positions: [],
      };
    }
    
    const totalValue = positions.reduce((sum, p) => sum + parseFloat(p.current_value), 0);
    
    const positionsData = positions.map(p => ({
      symbol: p.symbol,
      value: parseFloat(p.current_value),
      percentage: totalValue > 0 ? (parseFloat(p.current_value) / totalValue) * 100 : 0,
      pnl: parseFloat(p.unrealized_pnl),
      pnlPercent: parseFloat(p.unrealized_pnl_percent),
    }));
    
    return {
      totalValue,
      positions: positionsData,
    };
  }
  
  /**
   * Calculate ROI metrics
   */
  async getROIMetrics(userId: string = 'default'): Promise<ROIMetrics> {
    const summary = await this.getPnLSummary(userId);
    
    // Get first trade date
    const { data: firstTrade } = await this.supabase
      .from('portfolio_trades')
      .select('timestamp')
      .eq('user_id', userId)
      .order('timestamp', { ascending: true })
      .limit(1)
      .single();
    
    const firstTradeDate = firstTrade ? new Date(firstTrade.timestamp) : null;
    const daysSinceFirstTrade = firstTradeDate
      ? Math.max(1, Math.floor((Date.now() - firstTradeDate.getTime()) / (1000 * 60 * 60 * 24)))
      : 1;
    
    const roi = summary.totalPnlPercent;
    const roiDaily = roi / daysSinceFirstTrade;
    const roiWeekly = roiDaily * 7;
    const roiMonthly = roiDaily * 30;
    const roiYearly = roiDaily * 365;
    
    return {
      roi,
      roiDaily,
      roiWeekly,
      roiMonthly,
      roiYearly,
      totalInvested: summary.totalInvested,
      totalValue: summary.totalValue,
      totalReturn: summary.totalPnl,
      firstTradeDate,
      daysSinceFirstTrade,
    };
  }
  
  /**
   * Get winners/losers breakdown
   */
  async getWinnersLosers(userId: string = 'default'): Promise<WinnersLosersBreakdown> {
    const { data: positions } = await this.supabase
      .from('portfolio_positions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'open');
    
    if (!positions || positions.length === 0) {
      return this.getEmptyWinnersLosers();
    }
    
    const winners = positions
      .filter(p => parseFloat(p.unrealized_pnl) > 0.01)
      .map(p => this.mapPosition(p))
      .sort((a, b) => b.unrealizedPnl - a.unrealizedPnl);
    
    const losers = positions
      .filter(p => parseFloat(p.unrealized_pnl) < -0.01)
      .map(p => this.mapPosition(p))
      .sort((a, b) => a.unrealizedPnl - b.unrealizedPnl);
    
    const breakEven = positions
      .filter(p => Math.abs(parseFloat(p.unrealized_pnl)) <= 0.01)
      .map(p => this.mapPosition(p));
    
    const totalWinAmount = winners.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    const totalLossAmount = Math.abs(losers.reduce((sum, p) => sum + p.unrealizedPnl, 0));
    
    const avgWinPercent = winners.length > 0
      ? winners.reduce((sum, p) => sum + p.unrealizedPnlPercent, 0) / winners.length
      : 0;
    
    const avgLossPercent = losers.length > 0
      ? losers.reduce((sum, p) => sum + p.unrealizedPnlPercent, 0) / losers.length
      : 0;
    
    return {
      winners,
      losers,
      breakEven,
      winnersCount: winners.length,
      losersCount: losers.length,
      breakEvenCount: breakEven.length,
      totalWinAmount,
      totalLossAmount,
      avgWinPercent,
      avgLossPercent,
      largestWin: winners[0] || null,
      largestLoss: losers[0] || null,
    };
  }
  
  /**
   * Calculate individual position P&L
   */
  calculatePositionPnL(
    currentPrice: number,
    avgEntryPrice: number,
    currentAmount: number
  ): { pnl: number; pnlPercent: number; roi: number } {
    const currentValue = currentPrice * currentAmount;
    const entryValue = avgEntryPrice * currentAmount;
    const pnl = currentValue - entryValue;
    const pnlPercent = entryValue > 0 ? (pnl / entryValue) * 100 : 0;
    const roi = pnlPercent;
    
    return { pnl, pnlPercent, roi };
  }
  
  /**
   * Get empty summary
   */
  private getEmptySummary(): PnLSummary {
    return {
      totalValue: 0,
      totalInvested: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      unrealizedPnl: 0,
      unrealizedPnlPercent: 0,
      realizedPnl: 0,
      openPositions: 0,
      totalPositions: 0,
      winningPositions: 0,
      losingPositions: 0,
      breakEvenPositions: 0,
      bestPosition: null,
      worstPosition: null,
      lastUpdated: new Date(),
    };
  }
  
  /**
   * Get empty winners/losers
   */
  private getEmptyWinnersLosers(): WinnersLosersBreakdown {
    return {
      winners: [],
      losers: [],
      breakEven: [],
      winnersCount: 0,
      losersCount: 0,
      breakEvenCount: 0,
      totalWinAmount: 0,
      totalLossAmount: 0,
      avgWinPercent: 0,
      avgLossPercent: 0,
      largestWin: null,
      largestLoss: null,
    };
  }
  
  /**
   * Map database row to Position
   */
  private mapPosition(row: any): Position {
    return {
      id: row.id,
      userId: row.user_id,
      tokenMint: row.token_mint,
      symbol: row.symbol,
      name: row.name,
      side: row.side,
      status: row.status,
      entryPrice: parseFloat(row.entry_price),
      entryAmount: parseFloat(row.entry_amount),
      entryValue: parseFloat(row.entry_value),
      entryTimestamp: new Date(row.entry_timestamp),
      currentPrice: parseFloat(row.current_price),
      currentAmount: parseFloat(row.current_amount),
      currentValue: parseFloat(row.current_value),
      totalBought: parseFloat(row.total_bought),
      totalSold: parseFloat(row.total_sold),
      avgEntryPrice: parseFloat(row.avg_entry_price),
      unrealizedPnl: parseFloat(row.unrealized_pnl),
      unrealizedPnlPercent: parseFloat(row.unrealized_pnl_percent),
      realizedPnl: parseFloat(row.realized_pnl),
      costBasisMethod: row.cost_basis_method,
      notes: row.notes,
      tags: row.tags,
      lastUpdated: new Date(row.last_updated),
      createdAt: new Date(row.created_at),
    };
  }
}

export const pnlCalculator = new PnLCalculator();
