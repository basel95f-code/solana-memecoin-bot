/**
 * Dev Wallet Behavior Tracker
 * 
 * Monitors dev/deployer wallets for suspicious activity:
 * - First sell alerts
 * - Large dumps (>5% of holdings)
 * - Rapid selling patterns
 * - Complete exit (sold all)
 * 
 * Critical for early rug detection.
 */

import { EventEmitter } from 'events';
import { solanaService } from './solana';
import { dexScreenerService } from './dexscreener';
import { findDevWallet, analyzeDevSellHistory } from '../analysis/devWallet';
import type { HolderInfo } from '../types';
import { logger } from '../utils/logger';
import { getSupabaseClient } from '../database/supabase';

export interface DevWalletInfo {
  tokenMint: string;
  symbol: string;
  devAddress: string;
  initialHoldingPercent: number;
  currentHoldingPercent: number;
  firstSellDetected: boolean;
  totalSoldPercent: number;
  lastCheckTimestamp: number;
}

export interface DevBehaviorAlert {
  type: 'first_sell' | 'large_dump' | 'rapid_selling' | 'complete_exit';
  severity: 'warning' | 'critical';
  tokenMint: string;
  symbol: string;
  devAddress: string;
  message: string;
  details: {
    soldPercent?: number;
    currentHolding?: number;
    soldInLast24h?: number;
    sellCount?: number;
  };
  timestamp: Date;
}

// Thresholds
const LARGE_DUMP_THRESHOLD = 5; // Alert if >5% of holdings sold
const RAPID_SELL_THRESHOLD = 3; // Alert if 3+ sells in 24h
const CHECK_INTERVAL = 120000; // Check every 2 minutes
const CLEANUP_INTERVAL = 3600000; // Cleanup every hour

export class DevWalletTrackerService extends EventEmitter {
  private isRunning = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  private trackedDevs: Map<string, DevWalletInfo> = new Map(); // tokenMint -> DevWalletInfo
  private alertHistory: Map<string, number> = new Map(); // token:type -> timestamp
  private readonly ALERT_COOLDOWN = 1800000; // 30 minutes between same alert

  constructor() {
    super();
  }

  /**
   * Start monitoring
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    logger.info('DevWalletTracker', 'Starting dev wallet tracker...');
    this.isRunning = true;

    // Start monitoring loop
    this.checkInterval = setInterval(() => {
      this.checkAllDevs().catch((error) => {
        logger.error('DevWalletTracker', 'Error in monitoring loop', error as Error);
      });
    }, CHECK_INTERVAL);

    // Start cleanup loop
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL);

    logger.info('DevWalletTracker', `Started - monitoring ${this.trackedDevs.size} dev wallets`);
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('DevWalletTracker', 'Stopping dev wallet tracker...');

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.isRunning = false;
    logger.info('DevWalletTracker', 'Stopped');
  }

  /**
   * Add token dev wallet to tracking
   */
  async addToken(tokenMint: string, symbol: string, topHolders: HolderInfo[]): Promise<void> {
    try {
      // Find dev wallet
      const devAddress = await findDevWallet(tokenMint);
      
      if (!devAddress) {
        logger.debug('DevWalletTracker', `Could not identify dev for ${symbol}`);
        return;
      }

      // Check if dev is in top holders
      const devHolder = topHolders.find(h => h.address === devAddress);
      const initialHolding = devHolder?.percentage || 0;

      if (initialHolding < 1) {
        // Dev holds <1%, not worth tracking
        return;
      }

      const info: DevWalletInfo = {
        tokenMint,
        symbol,
        devAddress,
        initialHoldingPercent: initialHolding,
        currentHoldingPercent: initialHolding,
        firstSellDetected: false,
        totalSoldPercent: 0,
        lastCheckTimestamp: Date.now(),
      };

      this.trackedDevs.set(tokenMint, info);
      logger.info('DevWalletTracker', `Tracking dev for ${symbol}: ${devAddress.slice(0, 8)}... (${initialHolding.toFixed(1)}%)`);
      
      // Save to database
      await this.saveDevWalletToDatabase(devAddress, tokenMint, 'suspected', `Initial dev wallet for ${symbol}`);
    } catch (error) {
      logger.error('DevWalletTracker', `Failed to add ${symbol}`, error as Error);
    }
  }

  /**
   * Remove token from tracking
   */
  removeToken(tokenMint: string): void {
    this.trackedDevs.delete(tokenMint);
  }

  /**
   * Get tracked dev info
   */
  getDevInfo(tokenMint: string): DevWalletInfo | undefined {
    return this.trackedDevs.get(tokenMint);
  }

  /**
   * Check all tracked devs
   */
  private async checkAllDevs(): Promise<void> {
    const tokens = Array.from(this.trackedDevs.keys());
    
    for (const tokenMint of tokens) {
      try {
        await this.checkDevBehavior(tokenMint);
      } catch (error) {
        logger.silentError('DevWalletTracker', `Error checking ${tokenMint}`, error as Error);
      }
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  /**
   * Check dev behavior for a single token
   */
  private async checkDevBehavior(tokenMint: string): Promise<void> {
    const info = this.trackedDevs.get(tokenMint);
    if (!info) return;

    // Get sell history from dev wallet
    const sellHistory = await analyzeDevSellHistory(info.devAddress, tokenMint);
    
    if (!sellHistory) {
      logger.debug('DevWalletTracker', `No sell history for ${info.symbol}`);
      return;
    }

    const oldInfo = { ...info };
    
    // Update current holding
    // sellHistory.percentSold is the total % of original supply sold
    info.currentHoldingPercent = Math.max(0, info.initialHoldingPercent - sellHistory.percentSold);
    info.totalSoldPercent = sellHistory.percentSold;
    info.lastCheckTimestamp = Date.now();

    // Check for first sell
    if (!info.firstSellDetected && sellHistory.sellCount > 0) {
      info.firstSellDetected = true;
      
      const alert: DevBehaviorAlert = {
        type: 'first_sell',
        severity: 'warning',
        tokenMint,
        symbol: info.symbol,
        devAddress: info.devAddress,
        message: `Dev made first sell (${sellHistory.percentSold.toFixed(1)}% of supply)`,
        details: {
          soldPercent: sellHistory.percentSold,
          currentHolding: info.currentHoldingPercent,
        },
        timestamp: new Date(),
      };

      if (this.shouldSendAlert(tokenMint, 'first_sell')) {
        this.emit('alert', alert);
        this.markAlertSent(tokenMint, 'first_sell');
        logger.warn('DevWalletTracker', `FIRST SELL: ${info.symbol} dev sold ${sellHistory.percentSold.toFixed(1)}%`);
      }
    }

    // Check for large dump (>5% sold since last check)
    const newlySoldPercent = sellHistory.percentSold - oldInfo.totalSoldPercent;
    
    if (newlySoldPercent >= LARGE_DUMP_THRESHOLD) {
      const alert: DevBehaviorAlert = {
        type: 'large_dump',
        severity: newlySoldPercent >= 10 ? 'critical' : 'warning',
        tokenMint,
        symbol: info.symbol,
        devAddress: info.devAddress,
        message: `Dev dumped ${newlySoldPercent.toFixed(1)}% of supply`,
        details: {
          soldPercent: newlySoldPercent,
          currentHolding: info.currentHoldingPercent,
        },
        timestamp: new Date(),
      };

      if (this.shouldSendAlert(tokenMint, 'large_dump')) {
        this.emit('alert', alert);
        this.markAlertSent(tokenMint, 'large_dump');
        logger.warn('DevWalletTracker', `LARGE DUMP: ${info.symbol} dev dumped ${newlySoldPercent.toFixed(1)}%`);
      }
    }

    // Check for rapid selling (3+ sells in 24h)
    if (sellHistory.sellCount >= RAPID_SELL_THRESHOLD && sellHistory.lastSoldAt) {
      const hoursSinceLastSell = (Date.now() - sellHistory.lastSoldAt.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceLastSell < 24) {
        const alert: DevBehaviorAlert = {
          type: 'rapid_selling',
          severity: 'warning',
          tokenMint,
          symbol: info.symbol,
          devAddress: info.devAddress,
          message: `Dev made ${sellHistory.sellCount} sells in <24h`,
          details: {
            sellCount: sellHistory.sellCount,
            soldInLast24h: sellHistory.percentSold,
          },
          timestamp: new Date(),
        };

        if (this.shouldSendAlert(tokenMint, 'rapid_selling')) {
          this.emit('alert', alert);
          this.markAlertSent(tokenMint, 'rapid_selling');
          logger.warn('DevWalletTracker', `RAPID SELLING: ${info.symbol} dev ${sellHistory.sellCount} sells`);
        }
      }
    }

    // Check for complete exit (sold >90%)
    if (info.currentHoldingPercent < (info.initialHoldingPercent * 0.1) && info.currentHoldingPercent > 0) {
      const alert: DevBehaviorAlert = {
        type: 'complete_exit',
        severity: 'critical',
        tokenMint,
        symbol: info.symbol,
        devAddress: info.devAddress,
        message: `Dev sold >90% of holdings (${info.totalSoldPercent.toFixed(1)}% total)`,
        details: {
          soldPercent: info.totalSoldPercent,
          currentHolding: info.currentHoldingPercent,
        },
        timestamp: new Date(),
      };

      if (this.shouldSendAlert(tokenMint, 'complete_exit')) {
        this.emit('alert', alert);
        this.markAlertSent(tokenMint, 'complete_exit');
        logger.error('DevWalletTracker', `COMPLETE EXIT: ${info.symbol} dev exited`);
        
        // Flag as potential scammer
        await this.saveDevWalletToDatabase(
          info.devAddress,
          tokenMint,
          'known_scammer',
          `Complete exit: sold ${info.totalSoldPercent.toFixed(1)}% of holdings for ${info.symbol}`
        );
      }
    }

    // Update stored info
    this.trackedDevs.set(tokenMint, info);
  }

  /**
   * Check if alert should be sent (cooldown check)
   */
  private shouldSendAlert(tokenMint: string, alertType: string): boolean {
    const key = `${tokenMint}:${alertType}`;
    const lastAlert = this.alertHistory.get(key);
    
    if (!lastAlert) return true;
    
    const timeSince = Date.now() - lastAlert;
    return timeSince > this.ALERT_COOLDOWN;
  }

  /**
   * Mark alert as sent
   */
  private markAlertSent(tokenMint: string, alertType: string): void {
    const key = `${tokenMint}:${alertType}`;
    this.alertHistory.set(key, Date.now());
  }

  /**
   * Cleanup old data
   */
  private cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    // Remove old tracked devs (no activity in 24h)
    for (const [mint, info] of this.trackedDevs.entries()) {
      if (now - info.lastCheckTimestamp > maxAge) {
        this.trackedDevs.delete(mint);
      }
    }

    // Clean old alert history
    for (const [key, timestamp] of this.alertHistory.entries()) {
      if (now - timestamp > maxAge) {
        this.alertHistory.delete(key);
      }
    }

    logger.debug('DevWalletTracker', `Cleanup: ${this.trackedDevs.size} tracked devs`);
  }

  /**
   * Save or update dev wallet in Supabase database
   */
  private async saveDevWalletToDatabase(
    walletAddress: string,
    tokenMint: string,
    classification: 'known_dev' | 'known_scammer' | 'insider' | 'suspected',
    evidenceNote: string
  ): Promise<void> {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        logger.debug('DevWalletTracker', 'Supabase not configured, skipping database save');
        return;
      }

      // Check if wallet already exists
      const { data: existing, error: fetchError } = await supabase
        .from('known_dev_wallets')
        .select('*')
        .eq('wallet_address', walletAddress)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = no rows found
        logger.error('DevWalletTracker', `Error fetching dev wallet: ${fetchError.message}`);
        return;
      }

      if (existing) {
        // Update existing record
        const associatedTokens = existing.associated_tokens || [];
        if (!associatedTokens.includes(tokenMint)) {
          associatedTokens.push(tokenMint);
        }

        // Increment rugged count if classification changed to known_scammer
        const ruggedCount = classification === 'known_scammer' && existing.classification !== 'known_scammer'
          ? (existing.rugged_token_count || 0) + 1
          : existing.rugged_token_count || 0;

        // Update reputation score (decrease if scammerClassifier, increase if successful)
        let reputationScore = existing.reputation_score || 50;
        if (classification === 'known_scammer') {
          reputationScore = Math.max(0, reputationScore - 20);
        }

        const { error: updateError } = await supabase
          .from('known_dev_wallets')
          .update({
            classification,
            associated_tokens: associatedTokens,
            rugged_token_count: ruggedCount,
            reputation_score: reputationScore,
            evidence_notes: `${existing.evidence_notes || ''}\n${new Date().toISOString()}: ${evidenceNote}`.trim(),
            updated_at: new Date().toISOString(),
          })
          .eq('wallet_address', walletAddress);

        if (updateError) {
          logger.error('DevWalletTracker', `Error updating dev wallet: ${updateError.message}`);
        } else {
          logger.info('DevWalletTracker', `Updated dev wallet ${walletAddress.slice(0, 8)} in database`);
        }
      } else {
        // Insert new record
        const { error: insertError } = await supabase
          .from('known_dev_wallets')
          .insert({
            wallet_address: walletAddress,
            classification,
            reputation_score: classification === 'known_scammer' ? 0 : 50,
            associated_tokens: [tokenMint],
            rugged_token_count: classification === 'known_scammer' ? 1 : 0,
            successful_token_count: 0,
            evidence_notes: `${new Date().toISOString()}: ${evidenceNote}`,
            source: 'devWalletTracker',
            is_flagged: true,
            flagged_at: new Date().toISOString(),
          });

        if (insertError) {
          logger.error('DevWalletTracker', `Error inserting dev wallet: ${insertError.message}`);
        } else {
          logger.info('DevWalletTracker', `Saved new dev wallet ${walletAddress.slice(0, 8)} to database`);
        }
      }
    } catch (error) {
      logger.silentError('DevWalletTracker', 'Failed to save dev wallet to database', error as Error);
    }
  }

  /**
   * Get stats
   */
  getStats(): {
    trackedDevs: number;
    alertHistory: number;
  } {
    return {
      trackedDevs: this.trackedDevs.size,
      alertHistory: this.alertHistory.size,
    };
  }
}

// Singleton export
export const devWalletTracker = new DevWalletTrackerService();
