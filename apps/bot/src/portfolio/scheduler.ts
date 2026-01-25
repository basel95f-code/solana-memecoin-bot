/**
 * Portfolio Scheduler
 * Handles periodic tasks like daily snapshots and performance calculations
 */

import { getSupabaseClient } from '../database/supabase';
import { performanceAnalytics } from './performanceAnalytics';
import { logger } from '../utils/logger';

export class PortfolioScheduler {
  private supabase = getSupabaseClient();
  private dailySnapshotInterval: NodeJS.Timeout | null = null;
  private performanceInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  
  /**
   * Start scheduler
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('PortfolioScheduler', 'Already running');
      return;
    }
    
    this.isRunning = true;
    
    // Daily snapshot at midnight (check every hour)
    this.dailySnapshotInterval = setInterval(() => {
      this.checkDailySnapshot().catch(err =>
        logger.error('PortfolioScheduler', 'Daily snapshot check failed', err)
      );
    }, 60 * 60 * 1000); // Every hour
    
    // Performance calculation (every 6 hours)
    this.performanceInterval = setInterval(() => {
      this.calculatePerformance().catch(err =>
        logger.error('PortfolioScheduler', 'Performance calculation failed', err)
      );
    }, 6 * 60 * 60 * 1000); // Every 6 hours
    
    // Run initial tasks
    this.checkDailySnapshot().catch(err =>
      logger.error('PortfolioScheduler', 'Initial snapshot failed', err)
    );
    
    this.calculatePerformance().catch(err =>
      logger.error('PortfolioScheduler', 'Initial performance calc failed', err)
    );
    
    logger.info('PortfolioScheduler', 'Started');
  }
  
  /**
   * Stop scheduler
   */
  stop(): void {
    if (this.dailySnapshotInterval) {
      clearInterval(this.dailySnapshotInterval);
      this.dailySnapshotInterval = null;
    }
    
    if (this.performanceInterval) {
      clearInterval(this.performanceInterval);
      this.performanceInterval = null;
    }
    
    this.isRunning = false;
    logger.info('PortfolioScheduler', 'Stopped');
  }
  
  /**
   * Check if daily snapshot needs to be created
   */
  private async checkDailySnapshot(userId: string = 'default'): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Check if snapshot already exists for today
      const { data: existing } = await this.supabase
        .from('portfolio_snapshots')
        .select('id')
        .eq('user_id', userId)
        .eq('snapshot_date', today)
        .single();
      
      if (existing) {
        logger.debug('PortfolioScheduler', 'Daily snapshot already exists');
        return;
      }
      
      // Create snapshot
      await this.createSnapshot(userId);
      
      logger.info('PortfolioScheduler', `Created daily snapshot for ${today}`);
      
    } catch (error) {
      logger.error('PortfolioScheduler', 'Failed to check daily snapshot', error as Error);
    }
  }
  
  /**
   * Create portfolio snapshot
   */
  async createSnapshot(userId: string = 'default'): Promise<void> {
    await this.supabase.rpc('create_portfolio_snapshot', {
      p_user_id: userId,
    });
  }
  
  /**
   * Calculate performance metrics
   */
  private async calculatePerformance(userId: string = 'default'): Promise<void> {
    try {
      // Calculate for all periods
      await performanceAnalytics.calculatePerformance(userId, 'daily');
      await performanceAnalytics.calculatePerformance(userId, 'weekly');
      await performanceAnalytics.calculatePerformance(userId, 'monthly');
      await performanceAnalytics.calculatePerformance(userId, 'all_time');
      
      logger.info('PortfolioScheduler', 'Performance metrics calculated');
      
    } catch (error) {
      logger.error('PortfolioScheduler', 'Failed to calculate performance', error as Error);
    }
  }
  
  /**
   * Manual snapshot trigger (for testing)
   */
  async triggerSnapshot(userId: string = 'default'): Promise<void> {
    await this.createSnapshot(userId);
    logger.info('PortfolioScheduler', 'Manual snapshot created');
  }
  
  /**
   * Manual performance calculation trigger (for testing)
   */
  async triggerPerformanceCalc(userId: string = 'default'): Promise<void> {
    await this.calculatePerformance(userId);
    logger.info('PortfolioScheduler', 'Manual performance calculation complete');
  }
}

export const portfolioScheduler = new PortfolioScheduler();
