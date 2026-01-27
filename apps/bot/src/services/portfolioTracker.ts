/**
 * Portfolio Tracker Service
 * Tracks open positions, trades, and calculates PnL
 */

import { database } from '../database';
import { dexScreenerService } from './dexscreener';
import { logger } from '../utils/logger';

export interface Position {
  id?: number;
  tokenMint: string;
  symbol: string;
  name: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  entryValue: number; // SOL or USD
  currentValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  entryTime: number;
  lastUpdated: number;
  status: 'open' | 'closed';
}

export interface Trade {
  id?: number;
  tokenMint: string;
  symbol: string;
  side: 'long' | 'short';
  action: 'open' | 'close' | 'partial_close';
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  entryValue: number;
  exitValue?: number;
  realizedPnl?: number;
  realizedPnlPercent?: number;
  fees?: number;
  timestamp: number;
  notes?: string;
}

export interface PortfolioSummary {
  totalPositions: number;
  openPositions: number;
  totalValue: number; // Current portfolio value
  totalInvested: number; // Total entry value
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  realizedPnl: number; // All-time realized PnL
  totalPnl: number; // Realized + Unrealized
  bestPosition: Position | null;
  worstPosition: Position | null;
  positions: Position[];
}

export interface PnLReport {
  period: 'today' | '7d' | '30d' | 'all';
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  tradesCount: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number; // Total wins / Total losses
}

class PortfolioTracker {
  /**
   * Open a new position
   */
  openPosition(params: {
    tokenMint: string;
    symbol: string;
    name: string;
    side: 'long' | 'short';
    entryPrice: number;
    quantity: number;
    entryValue: number;
    notes?: string;
  }): number {
    const now = Date.now();

    // Insert position
    const result = database.run(
      `INSERT INTO positions (
        token_mint, symbol, name, side, entry_price, current_price,
        quantity, entry_value, current_value, unrealized_pnl, unrealized_pnl_percent,
        entry_time, last_updated, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.tokenMint,
        params.symbol,
        params.name,
        params.side,
        params.entryPrice,
        params.entryPrice, // Current = Entry initially
        params.quantity,
        params.entryValue,
        params.entryValue, // Current = Entry initially
        0, // No PnL yet
        0,
        now,
        now,
        'open',
      ]
    );

    const positionId = result.lastInsertRowid;

    // Record trade
    database.run(
      `INSERT INTO trades (
        token_mint, symbol, side, action, entry_price, quantity,
        entry_value, timestamp, notes, position_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.tokenMint,
        params.symbol,
        params.side,
        'open',
        params.entryPrice,
        params.quantity,
        params.entryValue,
        now,
        params.notes || null,
        positionId,
      ]
    );

    logger.info('PortfolioTracker', `Opened position: ${params.symbol} at $${params.entryPrice}`);

    return positionId;
  }

  /**
   * Close a position
   */
  closePosition(params: {
    positionId: number;
    exitPrice: number;
    quantity?: number; // Optional for partial close
    fees?: number;
    notes?: string;
  }): void {
    const position = this.getPositionById(params.positionId);
    if (!position) {
      throw new Error(`Position ${params.positionId} not found`);
    }

    const closeQuantity = params.quantity || position.quantity;
    const isPartialClose = closeQuantity < position.quantity;
    const now = Date.now();

    const exitValue = closeQuantity * params.exitPrice;
    const entryValuePortion = (closeQuantity / position.quantity) * position.entryValue;
    const realizedPnl = (exitValue - entryValuePortion) - (params.fees || 0);
    const realizedPnlPercent = (realizedPnl / entryValuePortion) * 100;

    if (isPartialClose) {
      // Update position with remaining quantity
      const remainingQuantity = position.quantity - closeQuantity;
      const remainingEntryValue = position.entryValue - entryValuePortion;

      database.run(
        `UPDATE positions SET
          quantity = ?,
          entry_value = ?,
          last_updated = ?
        WHERE id = ?`,
        [remainingQuantity, remainingEntryValue, now, params.positionId]
      );

      logger.info('PortfolioTracker', `Partial close: ${position.symbol} (${closeQuantity}/${position.quantity})`);
    } else {
      // Close entire position
      database.run(
        `UPDATE positions SET
          status = 'closed',
          last_updated = ?
        WHERE id = ?`,
        [now, params.positionId]
      );

      logger.info('PortfolioTracker', `Closed position: ${position.symbol} at $${params.exitPrice}`);
    }

    // Record trade
    database.run(
      `INSERT INTO trades (
        token_mint, symbol, side, action, entry_price, exit_price,
        quantity, entry_value, exit_value, realized_pnl, realized_pnl_percent,
        fees, timestamp, notes, position_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        position.tokenMint,
        position.symbol,
        position.side,
        isPartialClose ? 'partial_close' : 'close',
        position.entryPrice,
        params.exitPrice,
        closeQuantity,
        entryValuePortion,
        exitValue,
        realizedPnl,
        realizedPnlPercent,
        params.fees || 0,
        now,
        params.notes || null,
        params.positionId,
      ]
    );
  }

  /**
   * Update all position prices
   */
  async updatePrices(): Promise<void> {
    const openPositions = this.getOpenPositions();

    for (const position of openPositions) {
      try {
        const tokenData = await dexScreenerService.getTokenData(position.tokenMint);
        if (!tokenData) continue;

        const currentPrice = parseFloat(tokenData.priceUsd || '0');
        if (currentPrice === 0) continue;

        const currentValue = position.quantity * currentPrice;
        const unrealizedPnl = currentValue - position.entryValue;
        const unrealizedPnlPercent = (unrealizedPnl / position.entryValue) * 100;

        database.run(
          `UPDATE positions SET
            current_price = ?,
            current_value = ?,
            unrealized_pnl = ?,
            unrealized_pnl_percent = ?,
            last_updated = ?
          WHERE id = ?`,
          [
            currentPrice,
            currentValue,
            unrealizedPnl,
            unrealizedPnlPercent,
            Date.now(),
            position.id,
          ]
        );
      } catch (error) {
        logger.silentError('PortfolioTracker', `Failed to update price for ${position.symbol}`, error as Error);
      }
    }

    logger.debug('PortfolioTracker', `Updated ${openPositions.length} position prices`);
  }

  /**
   * Get position by ID
   */
  getPositionById(id: number): Position | null {
    const row = database.get<any>(
      'SELECT * FROM positions WHERE id = ?',
      [id]
    );

    if (!row) return null;

    return this.mapPosition(row);
  }

  /**
   * Get all open positions
   */
  getOpenPositions(): Position[] {
    const rows = database.all<any>(
      'SELECT * FROM positions WHERE status = ? ORDER BY entry_time DESC',
      ['open']
    );

    return rows.map(row => this.mapPosition(row));
  }

  /**
   * Get portfolio summary
   */
  async getPortfolioSummary(): Promise<PortfolioSummary> {
    // Update prices first
    await this.updatePrices();

    const openPositions = this.getOpenPositions();
    const totalPositions = database.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM positions'
    )?.count || 0;

    const totalValue = openPositions.reduce((sum, p) => sum + p.currentValue, 0);
    const totalInvested = openPositions.reduce((sum, p) => sum + p.entryValue, 0);
    const unrealizedPnl = openPositions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    const unrealizedPnlPercent = totalInvested > 0 ? (unrealizedPnl / totalInvested) * 100 : 0;

    // Get realized PnL from closed trades
    const realizedRow = database.get<{ total: number }>(
      'SELECT SUM(realized_pnl) as total FROM trades WHERE action IN (?, ?)',
      ['close', 'partial_close']
    );
    const realizedPnl = realizedRow?.total || 0;

    const totalPnl = realizedPnl + unrealizedPnl;

    // Find best/worst positions
    let bestPosition: Position | null = null;
    let worstPosition: Position | null = null;

    for (const position of openPositions) {
      if (!bestPosition || position.unrealizedPnl > bestPosition.unrealizedPnl) {
        bestPosition = position;
      }
      if (!worstPosition || position.unrealizedPnl < worstPosition.unrealizedPnl) {
        worstPosition = position;
      }
    }

    return {
      totalPositions,
      openPositions: openPositions.length,
      totalValue,
      totalInvested,
      unrealizedPnl,
      unrealizedPnlPercent,
      realizedPnl,
      totalPnl,
      bestPosition,
      worstPosition,
      positions: openPositions,
    };
  }

  /**
   * Get PnL report for a period
   */
  getPnLReport(period: 'today' | '7d' | '30d' | 'all' = 'all'): PnLReport {
    const now = Date.now();
    let startTime = 0;

    switch (period) {
      case 'today':
        startTime = now - 24 * 60 * 60 * 1000;
        break;
      case '7d':
        startTime = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case '30d':
        startTime = now - 30 * 24 * 60 * 60 * 1000;
        break;
    }

    const trades = database.all<any>(
      `SELECT * FROM trades 
       WHERE action IN (?, ?) 
       AND timestamp >= ?
       ORDER BY timestamp DESC`,
      ['close', 'partial_close', startTime]
    );

    const realizedPnl = trades.reduce((sum, t) => sum + (t.realized_pnl || 0), 0);
    
    // Unrealized PnL from current positions
    const openPositions = this.getOpenPositions();
    const unrealizedPnl = openPositions.reduce((sum, p) => sum + p.unrealizedPnl, 0);

    const totalPnl = realizedPnl + unrealizedPnl;

    const winningTrades = trades.filter(t => (t.realized_pnl || 0) > 0);
    const losingTrades = trades.filter(t => (t.realized_pnl || 0) < 0);

    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;

    const totalWins = winningTrades.reduce((sum, t) => sum + (t.realized_pnl || 0), 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + (t.realized_pnl || 0), 0));

    const avgWin = winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;

    const largestWin = winningTrades.length > 0
      ? Math.max(...winningTrades.map(t => t.realized_pnl || 0))
      : 0;
    const largestLoss = losingTrades.length > 0
      ? Math.min(...losingTrades.map(t => t.realized_pnl || 0))
      : 0;

    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;

    return {
      period,
      realizedPnl,
      unrealizedPnl,
      totalPnl,
      tradesCount: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      profitFactor,
    };
  }

  /**
   * Get trade history
   */
  getTradeHistory(limit: number = 50): Trade[] {
    const rows = database.all<any>(
      'SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?',
      [limit]
    );

    return rows.map(row => this.mapTrade(row));
  }

  /**
   * Map database row to Position
   */
  private mapPosition(row: any): Position {
    return {
      id: row.id,
      tokenMint: row.token_mint,
      symbol: row.symbol,
      name: row.name,
      side: row.side,
      entryPrice: row.entry_price,
      currentPrice: row.current_price,
      quantity: row.quantity,
      entryValue: row.entry_value,
      currentValue: row.current_value,
      unrealizedPnl: row.unrealized_pnl,
      unrealizedPnlPercent: row.unrealized_pnl_percent,
      entryTime: row.entry_time,
      lastUpdated: row.last_updated,
      status: row.status,
    };
  }

  /**
   * Map database row to Trade
   */
  private mapTrade(row: any): Trade {
    return {
      id: row.id,
      tokenMint: row.token_mint,
      symbol: row.symbol,
      side: row.side,
      action: row.action,
      entryPrice: row.entry_price,
      exitPrice: row.exit_price,
      quantity: row.quantity,
      entryValue: row.entry_value,
      exitValue: row.exit_value,
      realizedPnl: row.realized_pnl,
      realizedPnlPercent: row.realized_pnl_percent,
      fees: row.fees,
      timestamp: row.timestamp,
      notes: row.notes,
    };
  }

  /**
   * Format portfolio summary for display
   */
  formatSummary(summary: PortfolioSummary): string {
    let output = `📊 Portfolio Summary\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    output += `💼 Total Positions: ${summary.totalPositions} (${summary.openPositions} open)\n`;
    output += `💰 Portfolio Value: $${summary.totalValue.toFixed(2)}\n`;
    output += `💵 Total Invested: $${summary.totalInvested.toFixed(2)}\n\n`;

    const pnlSymbol = summary.totalPnl >= 0 ? '📈' : '📉';
    const pnlColor = summary.totalPnl >= 0 ? '+' : '';
    output += `${pnlSymbol} Total PnL: ${pnlColor}$${summary.totalPnl.toFixed(2)} (${summary.unrealizedPnlPercent >= 0 ? '+' : ''}${summary.unrealizedPnlPercent.toFixed(2)}%)\n`;
    output += `  ├ Realized: $${summary.realizedPnl.toFixed(2)}\n`;
    output += `  └ Unrealized: $${summary.unrealizedPnl.toFixed(2)}\n\n`;

    if (summary.bestPosition) {
      output += `🏆 Best: ${summary.bestPosition.symbol} (+$${summary.bestPosition.unrealizedPnl.toFixed(2)})\n`;
    }
    if (summary.worstPosition) {
      output += `📉 Worst: ${summary.worstPosition.symbol} ($${summary.worstPosition.unrealizedPnl.toFixed(2)})\n`;
    }

    return output;
  }

  /**
   * Format PnL report for display
   */
  formatPnLReport(report: PnLReport): string {
    let output = `📊 PnL Report (${report.period})\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    const totalSymbol = report.totalPnl >= 0 ? '📈' : '📉';
    output += `${totalSymbol} Total PnL: $${report.totalPnl.toFixed(2)}\n`;
    output += `  ├ Realized: $${report.realizedPnl.toFixed(2)}\n`;
    output += `  └ Unrealized: $${report.unrealizedPnl.toFixed(2)}\n\n`;

    output += `📝 Trades: ${report.tradesCount}\n`;
    output += `  ├ Wins: ${report.winningTrades} (${report.winRate.toFixed(1)}%)\n`;
    output += `  └ Losses: ${report.losingTrades}\n\n`;

    output += `💰 Performance:\n`;
    output += `  ├ Avg Win: $${report.avgWin.toFixed(2)}\n`;
    output += `  ├ Avg Loss: $${Math.abs(report.avgLoss).toFixed(2)}\n`;
    output += `  ├ Best Trade: $${report.largestWin.toFixed(2)}\n`;
    output += `  ├ Worst Trade: $${report.largestLoss.toFixed(2)}\n`;
    output += `  └ Profit Factor: ${report.profitFactor.toFixed(2)}\n`;

    return output;
  }
}

// Export singleton
export const portfolioTracker = new PortfolioTracker();
