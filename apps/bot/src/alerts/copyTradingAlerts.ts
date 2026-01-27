/**
 * Copy Trading Alert Handler
 * Generates and sends alerts when tracked wallets trade
 */

import { EventEmitter } from 'events';
import { walletTracker } from '../services/walletTracker';
import { walletTransactionMonitor, type WalletActivity } from '../monitors/walletTransactions';
import { getSupabaseClient } from '../database/supabase';

const supabase = getSupabaseClient();
import { logger } from '../utils/logger';

// ============================================
// Types
// ============================================

export interface CopyTradingAlert {
  wallet_address: string;
  wallet_label: string | null;
  transaction_id: number | null;
  token_mint: string;
  token_symbol: string | null;
  action: 'buy' | 'sell' | 'large_buy' | 'large_sell';
  amount: number;
  price_usd: number | null;
  value_sol: number | null;
  value_usd: number | null;
  wallet_score: number;
  wallet_win_rate: number;
  wallet_reputation: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  channels_sent: string[];
}

export interface AlertConfig {
  minWalletScore?: number;
  minWinRate?: number;
  minValueUsd?: number;
  largeTradeThreshold?: number; // USD value for "large" trades
  enableTelegram?: boolean;
  enableDiscord?: boolean;
  enableEmail?: boolean;
  telegramChatId?: string;
}

// ============================================
// Copy Trading Alert Handler
// ============================================

export class CopyTradingAlertHandler extends EventEmitter {
  private config: AlertConfig;
  private alertQueue: CopyTradingAlert[] = [];
  private isProcessing = false;

  constructor(config: AlertConfig = {}) {
    super();

    this.config = {
      minWalletScore: config.minWalletScore ?? 60,
      minWinRate: config.minWinRate ?? 55,
      minValueUsd: config.minValueUsd ?? 100,
      largeTradeThreshold: config.largeTradeThreshold ?? 5000,
      enableTelegram: config.enableTelegram ?? true,
      enableDiscord: config.enableDiscord ?? false,
      enableEmail: config.enableEmail ?? false,
      telegramChatId: config.telegramChatId,
    };
  }

  /**
   * Initialize alert handler
   */
  async initialize(): Promise<void> {
    // Listen to wallet activity events from monitor
    walletTransactionMonitor.on('wallet_activity', async (activity: WalletActivity) => {
      await this.handleWalletActivity(activity);
    });

    logger.info('CopyTradingAlertHandler', 'Initialized copy trading alert handler');
  }

  /**
   * Handle wallet activity event
   */
  private async handleWalletActivity(activity: WalletActivity): Promise<void> {
    try {
      // Get wallet info
      const wallet = await walletTracker.getTrackedWallet(activity.wallet);
      if (!wallet || !wallet.is_active) {
        logger.debug('CopyTradingAlertHandler', `Wallet not tracked or inactive: ${activity.wallet}`);
        return;
      }

      // Check if we should alert
      if (!this.shouldAlert(activity, wallet)) {
        logger.debug('CopyTradingAlertHandler', `Alert criteria not met for ${activity.wallet}`);
        return;
      }

      // Determine action type (buy/sell/large_buy/large_sell)
      const isLargeTrade = (activity.valueUsd || 0) >= (this.config.largeTradeThreshold || 5000);
      let alertAction: 'buy' | 'sell' | 'large_buy' | 'large_sell' = activity.action === 'buy' ? 'buy' : 'sell';
      
      if (isLargeTrade) {
        alertAction = activity.action === 'buy' ? 'large_buy' : 'large_sell';
      }

      // Determine priority
      const priority = this.calculatePriority(activity, wallet, isLargeTrade);

      // Create alert
      const alert: CopyTradingAlert = {
        wallet_address: activity.wallet,
        wallet_label: wallet.label,
        transaction_id: null, // Will be filled after saving to DB
        token_mint: activity.tokenMint,
        token_symbol: activity.tokenSymbol || null,
        action: alertAction,
        amount: activity.amount,
        price_usd: activity.priceUsd || null,
        value_sol: activity.valueSol || null,
        value_usd: activity.valueUsd || null,
        wallet_score: wallet.score,
        wallet_win_rate: wallet.win_rate,
        wallet_reputation: Math.round(wallet.score), // Use score as reputation
        priority,
        channels_sent: [],
      };

      // Save alert to database
      await this.saveAlert(alert);

      // Send alert
      await this.sendAlert(alert);

      logger.info(
        'CopyTradingAlertHandler',
        `Alert sent: ${wallet.label || activity.wallet.slice(0, 8)} ${alertAction} ${activity.tokenSymbol || activity.tokenMint.slice(0, 8)}`
      );
    } catch (error) {
      logger.error('CopyTradingAlertHandler', 'Failed to handle wallet activity', error as Error);
    }
  }

  /**
   * Check if we should alert for this activity
   */
  private shouldAlert(activity: WalletActivity, wallet: any): boolean {
    // Must be buy or sell
    if (activity.action !== 'buy' && activity.action !== 'sell') {
      return false;
    }

    // Check wallet score
    if (wallet.score < (this.config.minWalletScore || 60)) {
      return false;
    }

    // Check win rate (must have at least 5 trades)
    if (wallet.total_trades >= 5 && wallet.win_rate < (this.config.minWinRate || 55)) {
      return false;
    }

    // Check trade value
    if ((activity.valueUsd || 0) < (this.config.minValueUsd || 100)) {
      return false;
    }

    return true;
  }

  /**
   * Calculate alert priority
   */
  private calculatePriority(
    activity: WalletActivity,
    wallet: any,
    isLargeTrade: boolean
  ): 'low' | 'medium' | 'high' | 'critical' {
    // Critical: Large trade from high-reputation wallet
    if (isLargeTrade && wallet.score >= 80 && wallet.win_rate >= 70) {
      return 'critical';
    }

    // High: Large trade or high-reputation wallet
    if (isLargeTrade || (wallet.score >= 75 && wallet.win_rate >= 65)) {
      return 'high';
    }

    // Medium: Good wallet with decent value
    if (wallet.score >= 65 && wallet.win_rate >= 55) {
      return 'medium';
    }

    // Low: Everything else that passes filter
    return 'low';
  }

  /**
   * Save alert to database
   */
  private async saveAlert(alert: CopyTradingAlert): Promise<void> {
    try {
      const { error } = await supabase.from('copy_trading_alerts').insert({
        wallet_address: alert.wallet_address,
        wallet_label: alert.wallet_label,
        transaction_id: alert.transaction_id,
        token_mint: alert.token_mint,
        token_symbol: alert.token_symbol,
        action: alert.action,
        amount: alert.amount,
        price_usd: alert.price_usd,
        value_sol: alert.value_sol,
        value_usd: alert.value_usd,
        wallet_score: alert.wallet_score,
        wallet_win_rate: alert.wallet_win_rate,
        wallet_reputation: alert.wallet_reputation,
        priority: alert.priority,
        channels_sent: alert.channels_sent,
      });

      if (error) throw error;
    } catch (error) {
      logger.error('CopyTradingAlertHandler', 'Failed to save alert', error as Error);
    }
  }

  /**
   * Send alert to configured channels
   */
  private async sendAlert(alert: CopyTradingAlert): Promise<void> {
    // Emit event for other systems to handle
    this.emit('copy_trading_alert', alert);

    // Format message
    const message = this.formatAlertMessage(alert);

    // Send to configured channels
    const channels: string[] = [];

    if (this.config.enableTelegram) {
      // Telegram alert will be handled by the main alert system
      this.emit('send_telegram', { message, priority: alert.priority });
      channels.push('telegram');
    }

    if (this.config.enableDiscord) {
      this.emit('send_discord', { message, priority: alert.priority });
      channels.push('discord');
    }

    if (this.config.enableEmail && alert.priority === 'critical') {
      this.emit('send_email', { message, priority: alert.priority, subject: 'Critical Copy Trading Alert' });
      channels.push('email');
    }

    alert.channels_sent = channels;
  }

  /**
   * Format alert message
   */
  private formatAlertMessage(alert: CopyTradingAlert): string {
    const priorityEmoji = {
      low: 'ℹ️',
      medium: '⚠️',
      high: '🚨',
      critical: '🔥',
    };

    const actionEmoji = {
      buy: '🟢',
      sell: '🔴',
      large_buy: '💚',
      large_sell: '❤️',
    };

    const emoji = priorityEmoji[alert.priority];
    const actionIcon = actionEmoji[alert.action];

    let message = `${emoji} *Copy Trading Alert*\n\n`;
    message += `${actionIcon} *${alert.action.toUpperCase().replace('_', ' ')}*\n\n`;

    // Wallet info
    message += `👤 *Wallet:* ${alert.wallet_label || `${alert.wallet_address.slice(0, 4)}...${alert.wallet_address.slice(-4)}`}\n`;
    message += `🎯 Score: ${alert.wallet_score.toFixed(0)}/100 | `;
    message += `Win Rate: ${alert.wallet_win_rate.toFixed(0)}%\n\n`;

    // Token info
    message += `🪙 *Token:* ${alert.token_symbol || `${alert.token_mint.slice(0, 8)}...`}\n`;
    message += `📊 Amount: ${alert.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}\n`;

    if (alert.price_usd) {
      message += `💵 Price: $${alert.price_usd.toFixed(6)}\n`;
    }

    if (alert.value_usd) {
      message += `💰 Value: $${alert.value_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}\n`;
    }

    if (alert.value_sol) {
      message += `◎ ${alert.value_sol.toFixed(3)} SOL\n`;
    }

    message += `\n`;

    // Links
    message += `🔗 [View Wallet](https://solscan.io/account/${alert.wallet_address})\n`;
    message += `🔗 [View Token](https://solscan.io/token/${alert.token_mint})\n`;
    message += `📊 [DexScreener](https://dexscreener.com/solana/${alert.token_mint})`;

    // Add priority-specific notes
    if (alert.priority === 'critical') {
      message += `\n\n⚡ *HIGH-PRIORITY ALERT* ⚡\n`;
      message += `This is a large trade from a top performer!`;
    } else if (alert.priority === 'high') {
      message += `\n\n🎯 Wallet has strong track record`;
    }

    return message;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AlertConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('CopyTradingAlertHandler', 'Configuration updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): AlertConfig {
    return { ...this.config };
  }

  /**
   * Get recent alerts
   */
  async getRecentAlerts(limit = 20): Promise<CopyTradingAlert[]> {
    try {
      const { data, error } = await supabase
        .from('copy_trading_alerts')
        .select('*')
        .order('alerted_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return data || [];
    } catch (error) {
      logger.error('CopyTradingAlertHandler', 'Failed to get recent alerts', error as Error);
      return [];
    }
  }

  /**
   * Get alerts for a specific wallet
   */
  async getWalletAlerts(walletAddress: string, limit = 10): Promise<CopyTradingAlert[]> {
    try {
      const { data, error } = await supabase
        .from('copy_trading_alerts')
        .select('*')
        .eq('wallet_address', walletAddress)
        .order('alerted_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return data || [];
    } catch (error) {
      logger.error('CopyTradingAlertHandler', 'Failed to get wallet alerts', error as Error);
      return [];
    }
  }
}

// Singleton instance
export const copyTradingAlertHandler = new CopyTradingAlertHandler();
