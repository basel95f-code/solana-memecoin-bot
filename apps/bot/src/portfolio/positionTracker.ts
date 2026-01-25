/**
 * Position Tracker
 * Tracks token positions with multiple entries, partial exits, and cost basis calculation
 */

import { getSupabaseClient } from '../database/supabase';
import { logger } from '../utils/logger';

export type CostBasisMethod = 'FIFO' | 'LIFO' | 'AVERAGE';
export type PositionSide = 'long' | 'short';
export type PositionStatus = 'open' | 'closed';

export interface Position {
  id?: number;
  userId: string;
  tokenMint: string;
  symbol: string;
  name?: string;
  side: PositionSide;
  status: PositionStatus;
  
  // Entry
  entryPrice: number;
  entryAmount: number;
  entryValue: number;
  entryTimestamp: Date;
  
  // Current
  currentPrice: number;
  currentAmount: number;
  currentValue: number;
  
  // Accumulated
  totalBought: number;
  totalSold: number;
  avgEntryPrice: number;
  
  // P&L
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  realizedPnl: number;
  
  // Settings
  costBasisMethod: CostBasisMethod;
  notes?: string;
  tags?: Record<string, any>;
  
  lastUpdated: Date;
  createdAt: Date;
}

export interface AddEntryParams {
  userId?: string;
  tokenMint: string;
  symbol: string;
  name?: string;
  price: number;
  amount: number;
  timestamp?: Date;
  side?: PositionSide;
  costBasisMethod?: CostBasisMethod;
  notes?: string;
}

export interface PartialExitParams {
  positionId: number;
  exitPrice: number;
  exitAmount: number;
  timestamp?: Date;
  notes?: string;
}

export interface UpdatePriceParams {
  positionId: number;
  newPrice: number;
}

export class PositionTracker {
  private supabase = getSupabaseClient();
  
  /**
   * Add a new entry (buy) to a position
   * If position exists, averages down/up
   */
  async addEntry(params: AddEntryParams): Promise<Position> {
    const userId = params.userId || 'default';
    const timestamp = params.timestamp || new Date();
    const value = params.price * params.amount;
    const side = params.side || 'long';
    const costBasisMethod = params.costBasisMethod || 'FIFO';
    
    // Check if position already exists
    const { data: existingPosition } = await this.supabase
      .from('portfolio_positions')
      .select('*')
      .eq('user_id', userId)
      .eq('token_mint', params.tokenMint)
      .eq('status', 'open')
      .single();
    
    if (existingPosition) {
      // Average down/up - update existing position
      const newTotalBought = existingPosition.total_bought + params.amount;
      const newAvgPrice = (
        (existingPosition.avg_entry_price * existingPosition.total_bought) +
        (params.price * params.amount)
      ) / newTotalBought;
      
      const newCurrentAmount = existingPosition.current_amount + params.amount;
      const newEntryValue = existingPosition.entry_value + value;
      const newCurrentValue = newCurrentAmount * existingPosition.current_price;
      
      const { unrealizedPnl, unrealizedPnlPercent } = this.calculateUnrealizedPnL(
        existingPosition.current_price,
        newAvgPrice,
        newCurrentAmount
      );
      
      const { data: updated, error } = await this.supabase
        .from('portfolio_positions')
        .update({
          current_amount: newCurrentAmount,
          entry_value: newEntryValue,
          current_value: newCurrentValue,
          total_bought: newTotalBought,
          avg_entry_price: newAvgPrice,
          unrealized_pnl: unrealizedPnl,
          unrealized_pnl_percent: unrealizedPnlPercent,
          last_updated: new Date().toISOString(),
        })
        .eq('id', existingPosition.id)
        .select()
        .single();
      
      if (error) throw error;
      
      // Create trade record
      await this.recordTrade({
        userId,
        positionId: existingPosition.id,
        tokenMint: params.tokenMint,
        symbol: params.symbol,
        name: params.name,
        side,
        action: 'buy',
        price: params.price,
        amount: params.amount,
        value,
        timestamp,
        notes: params.notes,
        source: 'manual',
      });
      
      // Create tax lot for FIFO/LIFO tracking
      await this.createTaxLot({
        userId,
        positionId: existingPosition.id,
        tokenMint: params.tokenMint,
        symbol: params.symbol,
        purchaseDate: timestamp,
        purchasePrice: params.price,
        purchaseAmount: params.amount,
        purchaseValue: value,
      });
      
      logger.info('PositionTracker', `Added to position: ${params.symbol} (+${params.amount} @ $${params.price})`);
      
      return this.mapPosition(updated);
    } else {
      // Create new position
      const { data: newPosition, error } = await this.supabase
        .from('portfolio_positions')
        .insert({
          user_id: userId,
          token_mint: params.tokenMint,
          symbol: params.symbol,
          name: params.name,
          side,
          status: 'open',
          entry_price: params.price,
          entry_amount: params.amount,
          entry_value: value,
          entry_timestamp: timestamp.toISOString(),
          current_price: params.price,
          current_amount: params.amount,
          current_value: value,
          total_bought: params.amount,
          total_sold: 0,
          avg_entry_price: params.price,
          unrealized_pnl: 0,
          unrealized_pnl_percent: 0,
          realized_pnl: 0,
          cost_basis_method: costBasisMethod,
          notes: params.notes,
        })
        .select()
        .single();
      
      if (error) throw error;
      
      // Create trade record
      await this.recordTrade({
        userId,
        positionId: newPosition.id,
        tokenMint: params.tokenMint,
        symbol: params.symbol,
        name: params.name,
        side,
        action: 'buy',
        price: params.price,
        amount: params.amount,
        value,
        timestamp,
        notes: params.notes,
        source: 'manual',
      });
      
      // Create tax lot
      await this.createTaxLot({
        userId,
        positionId: newPosition.id,
        tokenMint: params.tokenMint,
        symbol: params.symbol,
        purchaseDate: timestamp,
        purchasePrice: params.price,
        purchaseAmount: params.amount,
        purchaseValue: value,
      });
      
      logger.info('PositionTracker', `Opened position: ${params.symbol} (${params.amount} @ $${params.price})`);
      
      return this.mapPosition(newPosition);
    }
  }
  
  /**
   * Partial or full exit from a position
   */
  async partialExit(params: PartialExitParams): Promise<Position> {
    const timestamp = params.timestamp || new Date();
    
    const { data: position, error: fetchError } = await this.supabase
      .from('portfolio_positions')
      .select('*')
      .eq('id', params.positionId)
      .single();
    
    if (fetchError || !position) {
      throw new Error(`Position ${params.positionId} not found`);
    }
    
    if (params.exitAmount > position.current_amount) {
      throw new Error(`Cannot sell ${params.exitAmount}, only ${position.current_amount} available`);
    }
    
    const isFullExit = params.exitAmount === position.current_amount;
    const exitValue = params.exitPrice * params.exitAmount;
    
    // Calculate cost basis using selected method
    const { costBasis, realizedPnl } = await this.calculateRealizedPnL(
      params.positionId,
      position.cost_basis_method as CostBasisMethod,
      params.exitAmount,
      params.exitPrice
    );
    
    const realizedPnlPercent = costBasis > 0 ? ((realizedPnl / costBasis) * 100) : 0;
    
    // Calculate holding period
    const holdingPeriodDays = Math.floor(
      (timestamp.getTime() - new Date(position.entry_timestamp).getTime()) / (1000 * 60 * 60 * 24)
    );
    
    const isShortTerm = holdingPeriodDays < 365;
    
    if (isFullExit) {
      // Close position
      const { data: updated, error } = await this.supabase
        .from('portfolio_positions')
        .update({
          status: 'closed',
          current_amount: 0,
          current_value: 0,
          total_sold: position.total_sold + params.exitAmount,
          realized_pnl: position.realized_pnl + realizedPnl,
          unrealized_pnl: 0,
          unrealized_pnl_percent: 0,
          last_updated: new Date().toISOString(),
        })
        .eq('id', params.positionId)
        .select()
        .single();
      
      if (error) throw error;
      
      logger.info('PositionTracker', `Closed position: ${position.symbol} (${params.exitAmount} @ $${params.exitPrice})`);
      
      // Record trade
      await this.recordTrade({
        userId: position.user_id,
        positionId: position.id,
        tokenMint: position.token_mint,
        symbol: position.symbol,
        name: position.name,
        side: position.side,
        action: 'sell',
        price: params.exitPrice,
        amount: params.exitAmount,
        value: exitValue,
        costBasis,
        realizedPnl,
        realizedPnlPercent,
        holdingPeriodDays,
        isShortTerm,
        timestamp,
        notes: params.notes,
        source: 'manual',
      });
      
      return this.mapPosition(updated);
    } else {
      // Partial exit
      const newCurrentAmount = position.current_amount - params.exitAmount;
      const newCurrentValue = newCurrentAmount * position.current_price;
      const newEntryValue = position.entry_value * (newCurrentAmount / position.current_amount);
      
      const { unrealizedPnl, unrealizedPnlPercent } = this.calculateUnrealizedPnL(
        position.current_price,
        position.avg_entry_price,
        newCurrentAmount
      );
      
      const { data: updated, error } = await this.supabase
        .from('portfolio_positions')
        .update({
          current_amount: newCurrentAmount,
          current_value: newCurrentValue,
          entry_value: newEntryValue,
          total_sold: position.total_sold + params.exitAmount,
          realized_pnl: position.realized_pnl + realizedPnl,
          unrealized_pnl: unrealizedPnl,
          unrealized_pnl_percent: unrealizedPnlPercent,
          last_updated: new Date().toISOString(),
        })
        .eq('id', params.positionId)
        .select()
        .single();
      
      if (error) throw error;
      
      logger.info('PositionTracker', `Partial exit: ${position.symbol} (-${params.exitAmount} @ $${params.exitPrice})`);
      
      // Record trade
      await this.recordTrade({
        userId: position.user_id,
        positionId: position.id,
        tokenMint: position.token_mint,
        symbol: position.symbol,
        name: position.name,
        side: position.side,
        action: 'partial_sell',
        price: params.exitPrice,
        amount: params.exitAmount,
        value: exitValue,
        costBasis,
        realizedPnl,
        realizedPnlPercent,
        holdingPeriodDays,
        isShortTerm,
        timestamp,
        notes: params.notes,
        source: 'manual',
      });
      
      return this.mapPosition(updated);
    }
  }
  
  /**
   * Update position price (from real-time monitors)
   */
  async updatePrice(params: UpdatePriceParams): Promise<void> {
    await this.supabase.rpc('update_position_price', {
      p_position_id: params.positionId,
      p_new_price: params.newPrice,
    });
  }
  
  /**
   * Get all open positions for a user
   */
  async getOpenPositions(userId: string = 'default'): Promise<Position[]> {
    const { data, error } = await this.supabase
      .from('portfolio_positions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'open')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return (data || []).map(row => this.mapPosition(row));
  }
  
  /**
   * Get position by ID
   */
  async getPosition(positionId: number): Promise<Position | null> {
    const { data, error } = await this.supabase
      .from('portfolio_positions')
      .select('*')
      .eq('id', positionId)
      .single();
    
    if (error || !data) return null;
    
    return this.mapPosition(data);
  }
  
  /**
   * Get position by token
   */
  async getPositionByToken(tokenMint: string, userId: string = 'default'): Promise<Position | null> {
    const { data, error } = await this.supabase
      .from('portfolio_positions')
      .select('*')
      .eq('user_id', userId)
      .eq('token_mint', tokenMint)
      .eq('status', 'open')
      .single();
    
    if (error || !data) return null;
    
    return this.mapPosition(data);
  }
  
  /**
   * Calculate unrealized P&L
   */
  private calculateUnrealizedPnL(
    currentPrice: number,
    avgEntryPrice: number,
    currentAmount: number
  ): { unrealizedPnl: number; unrealizedPnlPercent: number } {
    const unrealizedPnl = (currentPrice - avgEntryPrice) * currentAmount;
    const unrealizedPnlPercent = avgEntryPrice > 0
      ? ((currentPrice - avgEntryPrice) / avgEntryPrice) * 100
      : 0;
    
    return { unrealizedPnl, unrealizedPnlPercent };
  }
  
  /**
   * Calculate realized P&L using cost basis method
   */
  private async calculateRealizedPnL(
    positionId: number,
    method: CostBasisMethod,
    sellAmount: number,
    sellPrice: number
  ): Promise<{ costBasis: number; realizedPnl: number }> {
    const sellValue = sellAmount * sellPrice;
    
    // Get tax lots for this position
    const { data: lots } = await this.supabase
      .from('portfolio_tax_lots')
      .select('*')
      .eq('position_id', positionId)
      .eq('status', 'open')
      .order('purchase_date', { ascending: method === 'FIFO' });
    
    if (!lots || lots.length === 0) {
      // No lots available, use average entry price from position
      const { data: position } = await this.supabase
        .from('portfolio_positions')
        .select('avg_entry_price')
        .eq('id', positionId)
        .single();
      
      const costBasis = sellAmount * (position?.avg_entry_price || 0);
      return {
        costBasis,
        realizedPnl: sellValue - costBasis,
      };
    }
    
    // Process lots based on method
    let remainingToSell = sellAmount;
    let totalCostBasis = 0;
    
    for (const lot of lots) {
      if (remainingToSell <= 0) break;
      
      const amountFromLot = Math.min(remainingToSell, lot.remaining_amount);
      const costFromLot = amountFromLot * lot.purchase_price;
      
      totalCostBasis += costFromLot;
      remainingToSell -= amountFromLot;
      
      // Update lot
      const newRemaining = lot.remaining_amount - amountFromLot;
      
      if (newRemaining === 0) {
        // Lot fully consumed
        await this.supabase
          .from('portfolio_tax_lots')
          .update({
            status: 'closed',
            sale_date: new Date().toISOString(),
            sale_price: sellPrice,
            sale_amount: amountFromLot,
            sale_value: amountFromLot * sellPrice,
            realized_gain_loss: (amountFromLot * sellPrice) - costFromLot,
          })
          .eq('id', lot.id);
      } else {
        // Partial consumption
        await this.supabase
          .from('portfolio_tax_lots')
          .update({
            status: 'partial',
            remaining_amount: newRemaining,
          })
          .eq('id', lot.id);
      }
    }
    
    return {
      costBasis: totalCostBasis,
      realizedPnl: sellValue - totalCostBasis,
    };
  }
  
  /**
   * Record a trade
   */
  private async recordTrade(params: any): Promise<void> {
    await this.supabase
      .from('portfolio_trades')
      .insert({
        user_id: params.userId,
        position_id: params.positionId,
        token_mint: params.tokenMint,
        symbol: params.symbol,
        name: params.name,
        side: params.side,
        action: params.action,
        price: params.price,
        amount: params.amount,
        value: params.value,
        cost_basis: params.costBasis,
        realized_pnl: params.realizedPnl,
        realized_pnl_percent: params.realizedPnlPercent,
        holding_period_days: params.holdingPeriodDays,
        is_short_term: params.isShortTerm,
        timestamp: params.timestamp.toISOString(),
        notes: params.notes,
        source: params.source,
      });
  }
  
  /**
   * Create tax lot
   */
  private async createTaxLot(params: any): Promise<void> {
    await this.supabase
      .from('portfolio_tax_lots')
      .insert({
        user_id: params.userId,
        position_id: params.positionId,
        token_mint: params.tokenMint,
        symbol: params.symbol,
        purchase_date: params.purchaseDate.toISOString(),
        purchase_price: params.purchasePrice,
        purchase_amount: params.purchaseAmount,
        purchase_value: params.purchaseValue,
        remaining_amount: params.purchaseAmount,
        cost_basis: params.purchaseValue,
        status: 'open',
      });
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

export const positionTracker = new PositionTracker();
