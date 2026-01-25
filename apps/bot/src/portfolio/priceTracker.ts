/**
 * Price Tracker
 * Auto-updates position prices from monitors and handles price alerts
 */

import { getSupabaseClient } from '../database/supabase';
import { positionTracker } from './positionTracker';
import { logger } from '../utils/logger';
import { dexScreenerService } from '../services/dexscreener';

export interface PriceAlert {
  id: number;
  positionId: number;
  tokenMint: string;
  symbol: string;
  alertType: 'target' | 'stop_loss' | 'trailing_stop';
  triggerPrice: number;
  trailingPercent?: number;
  highestPrice?: number;
  isActive: boolean;
}

export class PriceTracker {
  private supabase = getSupabaseClient();
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  
  /**
   * Start auto-updating prices
   */
  start(intervalMs: number = 60000): void {
    if (this.isRunning) {
      logger.warn('PriceTracker', 'Already running');
      return;
    }
    
    this.isRunning = true;
    
    // Initial update
    this.updateAllPrices().catch(err => 
      logger.error('PriceTracker', 'Initial update failed', err)
    );
    
    // Set interval
    this.updateInterval = setInterval(() => {
      this.updateAllPrices().catch(err =>
        logger.error('PriceTracker', 'Price update failed', err)
      );
    }, intervalMs);
    
    logger.info('PriceTracker', `Started (interval: ${intervalMs}ms)`);
  }
  
  /**
   * Stop auto-updating
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    this.isRunning = false;
    logger.info('PriceTracker', 'Stopped');
  }
  
  /**
   * Update all position prices
   */
  async updateAllPrices(userId: string = 'default'): Promise<void> {
    try {
      const positions = await positionTracker.getOpenPositions(userId);
      
      if (positions.length === 0) {
        return;
      }
      
      logger.debug('PriceTracker', `Updating prices for ${positions.length} positions`);
      
      const updatePromises = positions.map(async (position) => {
        try {
          // Get current price from DexScreener
          const tokenData = await dexScreenerService.getTokenData(position.tokenMint);
          
          if (!tokenData || !tokenData.priceUsd) {
            logger.debug('PriceTracker', `No price data for ${position.symbol}`);
            return;
          }
          
          const newPrice = parseFloat(tokenData.priceUsd);
          
          if (newPrice === 0 || isNaN(newPrice)) {
            return;
          }
          
          // Update position price
          await positionTracker.updatePrice({
            positionId: position.id!,
            newPrice,
          });
          
          // Check price alerts
          await this.checkPriceAlerts(position.id!, newPrice);
          
        } catch (error) {
          logger.silentError('PriceTracker', `Failed to update ${position.symbol}`, error as Error);
        }
      });
      
      await Promise.all(updatePromises);
      
      logger.debug('PriceTracker', 'Price update complete');
      
    } catch (error) {
      logger.error('PriceTracker', 'Failed to update prices', error as Error);
    }
  }
  
  /**
   * Create price alert
   */
  async createAlert(params: {
    positionId: number;
    tokenMint: string;
    symbol: string;
    alertType: 'target' | 'stop_loss' | 'trailing_stop';
    triggerPrice: number;
    trailingPercent?: number;
    userId?: string;
  }): Promise<PriceAlert> {
    const { data, error } = await this.supabase
      .from('portfolio_price_alerts')
      .insert({
        user_id: params.userId || 'default',
        position_id: params.positionId,
        token_mint: params.tokenMint,
        symbol: params.symbol,
        alert_type: params.alertType,
        trigger_price: params.triggerPrice,
        trailing_percent: params.trailingPercent,
        is_active: true,
      })
      .select()
      .single();
    
    if (error) throw error;
    
    logger.info('PriceTracker', `Created ${params.alertType} alert for ${params.symbol} at $${params.triggerPrice}`);
    
    return this.mapAlert(data);
  }
  
  /**
   * Check price alerts for a position
   */
  private async checkPriceAlerts(positionId: number, currentPrice: number): Promise<void> {
    // Get active alerts
    const { data: alerts } = await this.supabase
      .from('portfolio_price_alerts')
      .select('*')
      .eq('position_id', positionId)
      .eq('is_active', true);
    
    if (!alerts || alerts.length === 0) {
      return;
    }
    
    for (const alert of alerts) {
      let triggered = false;
      
      switch (alert.alert_type) {
        case 'target':
          // Target price reached (upside)
          if (currentPrice >= parseFloat(alert.trigger_price)) {
            triggered = true;
          }
          break;
        
        case 'stop_loss':
          // Stop loss hit (downside)
          if (currentPrice <= parseFloat(alert.trigger_price)) {
            triggered = true;
          }
          break;
        
        case 'trailing_stop':
          // Trailing stop logic
          const highestPrice = parseFloat(alert.highest_price) || currentPrice;
          const trailingPercent = parseFloat(alert.trailing_percent) || 10;
          
          // Update highest price if new high
          if (currentPrice > highestPrice) {
            await this.supabase
              .from('portfolio_price_alerts')
              .update({ highest_price: currentPrice })
              .eq('id', alert.id);
          }
          
          // Check if price dropped below trailing threshold
          const maxPrice = Math.max(currentPrice, highestPrice);
          const dropPercent = ((maxPrice - currentPrice) / maxPrice) * 100;
          
          if (dropPercent >= trailingPercent) {
            triggered = true;
          }
          break;
      }
      
      if (triggered) {
        await this.triggerAlert(alert, currentPrice);
      }
    }
  }
  
  /**
   * Trigger a price alert
   */
  private async triggerAlert(alert: any, triggeredPrice: number): Promise<void> {
    // Mark alert as triggered
    await this.supabase
      .from('portfolio_price_alerts')
      .update({
        is_active: false,
        triggered_at: new Date().toISOString(),
        triggered_price: triggeredPrice,
      })
      .eq('id', alert.id);
    
    logger.info('PriceTracker', `Alert triggered: ${alert.symbol} ${alert.alert_type} at $${triggeredPrice}`);
    
    // TODO: Send notification via Telegram or other channels
    // This would integrate with your notification system
  }
  
  /**
   * Get active alerts for a position
   */
  async getAlerts(positionId: number): Promise<PriceAlert[]> {
    const { data } = await this.supabase
      .from('portfolio_price_alerts')
      .select('*')
      .eq('position_id', positionId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    
    return (data || []).map(this.mapAlert);
  }
  
  /**
   * Cancel alert
   */
  async cancelAlert(alertId: number): Promise<void> {
    await this.supabase
      .from('portfolio_price_alerts')
      .update({ is_active: false })
      .eq('id', alertId);
    
    logger.info('PriceTracker', `Cancelled alert ${alertId}`);
  }
  
  /**
   * Map database row to PriceAlert
   */
  private mapAlert(row: any): PriceAlert {
    return {
      id: row.id,
      positionId: row.position_id,
      tokenMint: row.token_mint,
      symbol: row.symbol,
      alertType: row.alert_type,
      triggerPrice: parseFloat(row.trigger_price),
      trailingPercent: row.trailing_percent ? parseFloat(row.trailing_percent) : undefined,
      highestPrice: row.highest_price ? parseFloat(row.highest_price) : undefined,
      isActive: row.is_active,
    };
  }
}

export const priceTracker = new PriceTracker();
