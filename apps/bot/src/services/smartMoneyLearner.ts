/**
 * Smart Money Learner Service
 * Tracks wallets with consistent profits, learns their patterns, and generates alerts
 */

import { database as databaseService } from '../database';
import { solanaService } from './solana';
import { dexScreenerService } from './dexscreener';
import { logger } from '../utils/logger';
import type { Database as SqlJsDatabase } from 'sql.js';

// ============================================
// Types
// ============================================

export interface SmartMoneyWallet {
  id?: number;
  wallet_address: string;
  
  // Performance metrics
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  
  // Financial metrics
  total_profit_sol: number;
  average_profit_percent: number;
  largest_win_percent: number;
  largest_loss_percent: number;
  
  // Trading style
  average_hold_time_hours: number;
  average_entry_liquidity: number;
  preferred_risk_range?: string;
  
  // Pattern data
  trading_style?: string;
  common_entry_patterns?: string;
  common_exit_patterns?: string;
  
  // Tracking metadata
  first_tracked_at: number;
  last_trade_at?: number;
  last_updated_at: number;
  
  // Reputation
  reputation_score: number;
  is_verified: boolean;
  is_suspicious: boolean;
}

export interface SmartMoneyTrade {
  id?: number;
  wallet_address: string;
  token_mint: string;
  token_symbol?: string;
  
  // Trade details
  entry_price: number;
  entry_time: number;
  entry_liquidity?: number;
  entry_risk_score?: number;
  
  exit_price?: number;
  exit_time?: number;
  exit_reason?: string;
  
  // Performance
  profit_percent?: number;
  hold_time_hours?: number;
  
  // Status
  status: 'open' | 'closed';
  
  created_at: number;
}

export interface SmartMoneyAlert {
  wallet_address: string;
  token_mint: string;
  token_symbol?: string;
  alert_type: 'entry' | 'exit' | 'large_buy' | 'large_sell';
  amount_sol?: number;
  price?: number;
  wallet_reputation?: number;
  wallet_win_rate?: number;
  alerted_at: number;
  chat_id?: string;
}

export interface WalletStats {
  wallet: SmartMoneyWallet;
  recentTrades: SmartMoneyTrade[];
  patterns: {
    entryPatterns: Pattern[];
    exitPatterns: Pattern[];
  };
}

export interface Pattern {
  type: string;
  frequency: number;
  avgOutcome: number;
  description: string;
}

export interface Prediction {
  nextMoveType: 'buy' | 'sell' | 'hold';
  confidence: number;
  reasoning: string[];
  expectedHoldTime?: number;
}

export type TradingStyle = 'scalper' | 'swing' | 'holder';

// ============================================
// Smart Money Learner Service
// ============================================

export class SmartMoneyLearner {
  private db: SqlJsDatabase | null = null;

  constructor() {}

  /**
   * Initialize the service with database instance
   */
  initialize(): void {
    this.db = databaseService.getDb();
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    logger.info('SmartMoneyLearner', 'Service initialized');
  }

  // ============================================
  // Wallet Tracking
  // ============================================

  /**
   * Track a new wallet
   */
  async trackWallet(address: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const now = Math.floor(Date.now() / 1000);
      
      this.db.run(`
        INSERT OR IGNORE INTO smart_money_wallets (
          wallet_address, first_tracked_at, last_updated_at
        ) VALUES (?, ?, ?)
      `, [address, now, now]);

      logger.info('SmartMoneyLearner', `Tracking wallet: ${address.slice(0, 8)}...`);
    } catch (error) {
      logger.error('SmartMoneyLearner', 'Failed to track wallet', error as Error);
      throw error;
    }
  }

  /**
   * Untrack a wallet
   */
  async untrackWallet(address: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.run('DELETE FROM smart_money_wallets WHERE wallet_address = ?', [address]);
      logger.info('SmartMoneyLearner', `Untracked wallet: ${address.slice(0, 8)}...`);
    } catch (error) {
      logger.error('SmartMoneyLearner', 'Failed to untrack wallet', error as Error);
      throw error;
    }
  }

  /**
   * Check if a wallet is tracked
   */
  async isTracked(address: string): Promise<boolean> {
    if (!this.db) return false;

    try {
      const result = this.db.exec(
        'SELECT COUNT(*) as count FROM smart_money_wallets WHERE wallet_address = ?',
        [address]
      );

      return result.length > 0 && result[0].values.length > 0 && (result[0].values[0][0] as number) > 0;
    } catch (error) {
      logger.silentError('SmartMoneyLearner', 'Failed to check if wallet is tracked', error as Error);
      return false;
    }
  }

  /**
   * Get top performing wallets
   */
  async getTopWallets(limit = 10): Promise<SmartMoneyWallet[]> {
    if (!this.db) return [];

    try {
      const result = this.db.exec(`
        SELECT * FROM smart_money_wallets
        WHERE total_trades >= 5
        ORDER BY reputation_score DESC, win_rate DESC
        LIMIT ?
      `, [limit]);

      if (result.length === 0) return [];

      return this.parseWalletRows(result[0]);
    } catch (error) {
      logger.error('SmartMoneyLearner', 'Failed to get top wallets', error as Error);
      return [];
    }
  }

  /**
   * Get all tracked wallets
   */
  async getAllTrackedWallets(): Promise<SmartMoneyWallet[]> {
    if (!this.db) return [];

    try {
      const result = this.db.exec('SELECT * FROM smart_money_wallets ORDER BY reputation_score DESC');

      if (result.length === 0) return [];

      return this.parseWalletRows(result[0]);
    } catch (error) {
      logger.error('SmartMoneyLearner', 'Failed to get all tracked wallets', error as Error);
      return [];
    }
  }

  /**
   * Get wallet by address
   */
  async getWallet(address: string): Promise<SmartMoneyWallet | null> {
    if (!this.db) return null;

    try {
      const result = this.db.exec(
        'SELECT * FROM smart_money_wallets WHERE wallet_address = ?',
        [address]
      );

      if (result.length === 0 || result[0].values.length === 0) return null;

      const wallets = this.parseWalletRows(result[0]);
      return wallets[0] || null;
    } catch (error) {
      logger.error('SmartMoneyLearner', 'Failed to get wallet', error as Error);
      return null;
    }
  }

  // ============================================
  // Trade Recording
  // ============================================

  /**
   * Record a new trade entry
   */
  async recordTrade(
    walletAddress: string,
    tokenMint: string,
    entry: {
      tokenSymbol?: string;
      entryPrice: number;
      entryLiquidity?: number;
      entryRiskScore?: number;
    }
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      // Ensure wallet is tracked
      const isTracked = await this.isTracked(walletAddress);
      if (!isTracked) {
        await this.trackWallet(walletAddress);
      }

      const now = Math.floor(Date.now() / 1000);

      // Insert trade
      this.db.run(`
        INSERT INTO smart_money_trades (
          wallet_address, token_mint, token_symbol, entry_price,
          entry_time, entry_liquidity, entry_risk_score, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)
      `, [
        walletAddress,
        tokenMint,
        entry.tokenSymbol ?? null,
        entry.entryPrice,
        now,
        entry.entryLiquidity ?? null,
        entry.entryRiskScore ?? null,
        now
      ]);

      // Update wallet's last_trade_at
      this.db.run(`
        UPDATE smart_money_wallets
        SET last_trade_at = ?, last_updated_at = ?
        WHERE wallet_address = ?
      `, [now, now, walletAddress]);

      logger.debug('SmartMoneyLearner', `Recorded entry for ${walletAddress.slice(0, 8)}... - ${entry.tokenSymbol || tokenMint.slice(0, 8)}`);
    } catch (error) {
      logger.error('SmartMoneyLearner', 'Failed to record trade', error as Error);
      throw error;
    }
  }

  /**
   * Close a trade
   */
  async closeTrade(
    walletAddress: string,
    tokenMint: string,
    exit: {
      exitPrice: number;
      exitReason: string;
    }
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const now = Math.floor(Date.now() / 1000);

      // Find open trade
      const tradeResult = this.db.exec(`
        SELECT * FROM smart_money_trades
        WHERE wallet_address = ? AND token_mint = ? AND status = 'open'
        ORDER BY entry_time DESC
        LIMIT 1
      `, [walletAddress, tokenMint]);

      if (tradeResult.length === 0 || tradeResult[0].values.length === 0) {
        logger.debug('SmartMoneyLearner', `No open trade found for ${walletAddress.slice(0, 8)}... - ${tokenMint.slice(0, 8)}`);
        return;
      }

      const trade = this.parseTradeRow(tradeResult[0].columns, tradeResult[0].values[0]);

      // Calculate profit and hold time
      const profitPercent = ((exit.exitPrice - trade.entry_price) / trade.entry_price) * 100;
      const holdTimeHours = (now - trade.entry_time) / 3600;

      // Update trade
      this.db.run(`
        UPDATE smart_money_trades
        SET exit_price = ?, exit_time = ?, exit_reason = ?,
            profit_percent = ?, hold_time_hours = ?, status = 'closed'
        WHERE id = ?
      `, [exit.exitPrice, now, exit.exitReason, profitPercent, holdTimeHours, trade.id]);

      // Update wallet metrics
      await this.updateWalletMetrics(walletAddress);

      logger.debug('SmartMoneyLearner', `Closed trade for ${walletAddress.slice(0, 8)}... - ${trade.token_symbol || tokenMint.slice(0, 8)} (${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(1)}%)`);
    } catch (error) {
      logger.error('SmartMoneyLearner', 'Failed to close trade', error as Error);
      throw error;
    }
  }

  /**
   * Update status of open trades (check if they've exited)
   */
  async updateTradeStatus(): Promise<void> {
    if (!this.db) return;

    try {
      // Get all open trades
      const result = this.db.exec(`
        SELECT * FROM smart_money_trades
        WHERE status = 'open'
      `);

      if (result.length === 0 || result[0].values.length === 0) return;

      const openTrades = result[0].values.map(row => this.parseTradeRow(result[0].columns, row));

      logger.debug('SmartMoneyLearner', `Checking ${openTrades.length} open trades`);

      // For each open trade, check if wallet still holds the token
      for (const trade of openTrades) {
        try {
          // Check wallet's token balance
          const balance = await this.getWalletTokenBalance(trade.wallet_address, trade.token_mint);

          // If balance is zero or very low, assume they exited
          if (balance < 0.01) {
            // Get current price to record exit
            const tokenData = await dexScreenerService.getTokenData(trade.token_mint);
            const exitPrice = tokenData?.priceUsd || trade.entry_price;

            await this.closeTrade(trade.wallet_address, trade.token_mint, {
              exitPrice,
              exitReason: 'auto_detected'
            });
          }
        } catch (error) {
          logger.silentError('SmartMoneyLearner', `Failed to check trade status for ${trade.token_mint}`, error as Error);
        }
      }
    } catch (error) {
      logger.error('SmartMoneyLearner', 'Failed to update trade status', error as Error);
    }
  }

  /**
   * Get wallet's token balance
   */
  private async getWalletTokenBalance(walletAddress: string, tokenMint: string): Promise<number> {
    try {
      const connection = solanaService.getConnection();
      const walletPubkey = new (await import('@solana/web3.js')).PublicKey(walletAddress);
      const mintPubkey = new (await import('@solana/web3.js')).PublicKey(tokenMint);

      // Get token accounts
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPubkey, {
        mint: mintPubkey,
      });

      if (tokenAccounts.value.length === 0) return 0;

      // Sum up all balances
      const totalBalance = tokenAccounts.value.reduce((sum, account) => {
        const amount = account.account.data.parsed.info.tokenAmount.uiAmount;
        return sum + (amount || 0);
      }, 0);

      return totalBalance;
    } catch (error) {
      logger.silentError('SmartMoneyLearner', 'Failed to get wallet token balance', error as Error);
      return 0;
    }
  }

  // ============================================
  // Wallet Metrics & Analytics
  // ============================================

  /**
   * Update wallet metrics based on closed trades
   */
  private async updateWalletMetrics(walletAddress: string): Promise<void> {
    if (!this.db) return;

    try {
      // Get all closed trades for this wallet
      const result = this.db.exec(`
        SELECT * FROM smart_money_trades
        WHERE wallet_address = ? AND status = 'closed'
      `, [walletAddress]);

      if (result.length === 0 || result[0].values.length === 0) {
        logger.debug('SmartMoneyLearner', `No closed trades for ${walletAddress.slice(0, 8)}...`);
        return;
      }

      const closedTrades = result[0].values.map(row => this.parseTradeRow(result[0].columns, row));

      // Calculate metrics
      const totalTrades = closedTrades.length;
      const winningTrades = closedTrades.filter(t => (t.profit_percent || 0) > 0).length;
      const losingTrades = closedTrades.filter(t => (t.profit_percent || 0) <= 0).length;
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

      // Calculate financial metrics
      const profits = closedTrades.filter(t => (t.profit_percent || 0) > 0).map(t => t.profit_percent || 0);
      const losses = closedTrades.filter(t => (t.profit_percent || 0) < 0).map(t => t.profit_percent || 0);

      const avgProfitPercent = profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
      const largestWinPercent = profits.length > 0 ? Math.max(...profits) : 0;
      const largestLossPercent = losses.length > 0 ? Math.min(...losses) : 0;

      // Estimate total profit in SOL (simplified - assumes 1 SOL entry per trade)
      const totalProfitSol = closedTrades.reduce((sum, t) => {
        const profitSol = ((t.profit_percent || 0) / 100);
        return sum + profitSol;
      }, 0);

      // Calculate trading style metrics
      const holdTimes = closedTrades.map(t => t.hold_time_hours || 0);
      const avgHoldTimeHours = holdTimes.length > 0 ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0;

      const entryLiquidities = closedTrades.filter(t => t.entry_liquidity).map(t => t.entry_liquidity!);
      const avgEntryLiquidity = entryLiquidities.length > 0 ? entryLiquidities.reduce((a, b) => a + b, 0) / entryLiquidities.length : 0;

      // Determine preferred risk range
      const riskScores = closedTrades.filter(t => t.entry_risk_score).map(t => t.entry_risk_score!);
      let preferredRiskRange = 'unknown';
      if (riskScores.length > 0) {
        const avgRiskScore = riskScores.reduce((a, b) => a + b, 0) / riskScores.length;
        if (avgRiskScore < 40) preferredRiskRange = 'high';
        else if (avgRiskScore < 70) preferredRiskRange = 'medium';
        else preferredRiskRange = 'low';
      }

      // Classify trading style
      const tradingStyle = this.classifyTradingStyle(avgHoldTimeHours);

      // Calculate reputation
      const reputationScore = this.calculateReputation({
        total_trades: totalTrades,
        winning_trades: winningTrades,
        losing_trades: losingTrades,
        win_rate: winRate,
        total_profit_sol: totalProfitSol,
        is_verified: false,
        is_suspicious: false,
      } as any);

      // Update wallet record
      const now = Math.floor(Date.now() / 1000);
      this.db.run(`
        UPDATE smart_money_wallets SET
          total_trades = ?,
          winning_trades = ?,
          losing_trades = ?,
          win_rate = ?,
          total_profit_sol = ?,
          average_profit_percent = ?,
          largest_win_percent = ?,
          largest_loss_percent = ?,
          average_hold_time_hours = ?,
          average_entry_liquidity = ?,
          preferred_risk_range = ?,
          trading_style = ?,
          reputation_score = ?,
          last_updated_at = ?
        WHERE wallet_address = ?
      `, [
        totalTrades,
        winningTrades,
        losingTrades,
        winRate,
        totalProfitSol,
        avgProfitPercent,
        largestWinPercent,
        largestLossPercent,
        avgHoldTimeHours,
        avgEntryLiquidity,
        preferredRiskRange,
        tradingStyle,
        reputationScore,
        now,
        walletAddress
      ]);

      // Update patterns
      await this.updateWalletPatterns(walletAddress);

      logger.debug('SmartMoneyLearner', `Updated metrics for ${walletAddress.slice(0, 8)}...`);
    } catch (error) {
      logger.error('SmartMoneyLearner', 'Failed to update wallet metrics', error as Error);
    }
  }

  // ============================================
  // Pattern Detection
  // ============================================

  /**
   * Classify trading style based on average hold time
   */
  private classifyTradingStyle(avgHoldTime: number): TradingStyle {
    if (avgHoldTime < 2) return 'scalper'; // < 2 hours
    if (avgHoldTime < 48) return 'swing'; // < 2 days
    return 'holder'; // 2+ days
  }

  /**
   * Analyze trading style for a wallet
   */
  async analyzeTradingStyle(walletAddress: string): Promise<TradingStyle> {
    const wallet = await this.getWallet(walletAddress);
    if (!wallet || !wallet.trading_style) return 'swing';
    return wallet.trading_style as TradingStyle;
  }

  /**
   * Detect entry patterns for a wallet
   */
  async detectEntryPatterns(walletAddress: string): Promise<Pattern[]> {
    if (!this.db) return [];

    try {
      // Get all trades for this wallet
      const result = this.db.exec(`
        SELECT * FROM smart_money_trades
        WHERE wallet_address = ?
        ORDER BY entry_time DESC
      `, [walletAddress]);

      if (result.length === 0 || result[0].values.length === 0) return [];

      const trades = result[0].values.map(row => this.parseTradeRow(result[0].columns, row));

      const patterns: Pattern[] = [];

      // Pattern 1: Early entry (within first hour of token launch)
      const earlyEntries = trades.filter(t => {
        // Consider it early if entry_time is close to token creation (simplified)
        return true; // TODO: Need token creation time to determine this
      });

      if (earlyEntries.length > trades.length * 0.3) {
        const avgOutcome = this.calculateAvgOutcome(earlyEntries);
        patterns.push({
          type: 'early_entry',
          frequency: earlyEntries.length / trades.length,
          avgOutcome,
          description: 'Buys within first hour of token launch'
        });
      }

      // Pattern 2: High liquidity entry
      const highLiqEntries = trades.filter(t => (t.entry_liquidity || 0) > 50000);
      if (highLiqEntries.length > trades.length * 0.3) {
        const avgOutcome = this.calculateAvgOutcome(highLiqEntries);
        patterns.push({
          type: 'high_liquidity',
          frequency: highLiqEntries.length / trades.length,
          avgOutcome,
          description: 'Prefers tokens with $50k+ liquidity'
        });
      }

      // Pattern 3: Low risk entry
      const lowRiskEntries = trades.filter(t => (t.entry_risk_score || 0) > 70);
      if (lowRiskEntries.length > trades.length * 0.3) {
        const avgOutcome = this.calculateAvgOutcome(lowRiskEntries);
        patterns.push({
          type: 'low_risk',
          frequency: lowRiskEntries.length / trades.length,
          avgOutcome,
          description: 'Targets low-risk tokens (70+ score)'
        });
      }

      return patterns;
    } catch (error) {
      logger.error('SmartMoneyLearner', 'Failed to detect entry patterns', error as Error);
      return [];
    }
  }

  /**
   * Detect exit patterns for a wallet
   */
  async detectExitPatterns(walletAddress: string): Promise<Pattern[]> {
    if (!this.db) return [];

    try {
      // Get all closed trades
      const result = this.db.exec(`
        SELECT * FROM smart_money_trades
        WHERE wallet_address = ? AND status = 'closed'
        ORDER BY exit_time DESC
      `, [walletAddress]);

      if (result.length === 0 || result[0].values.length === 0) return [];

      const trades = result[0].values.map(row => this.parseTradeRow(result[0].columns, row));

      const patterns: Pattern[] = [];

      // Pattern 1: Take profit at 2x
      const twoXExits = trades.filter(t => (t.profit_percent || 0) >= 90 && (t.profit_percent || 0) <= 110);
      if (twoXExits.length > trades.length * 0.2) {
        patterns.push({
          type: 'take_profit_2x',
          frequency: twoXExits.length / trades.length,
          avgOutcome: 100,
          description: 'Takes profit around 2x (100%)'
        });
      }

      // Pattern 2: Take profit at 5x
      const fiveXExits = trades.filter(t => (t.profit_percent || 0) >= 400 && (t.profit_percent || 0) <= 600);
      if (fiveXExits.length > trades.length * 0.2) {
        patterns.push({
          type: 'take_profit_5x',
          frequency: fiveXExits.length / trades.length,
          avgOutcome: 500,
          description: 'Takes profit around 5x (500%)'
        });
      }

      // Pattern 3: Stop loss at -20%
      const stopLossExits = trades.filter(t => (t.profit_percent || 0) >= -25 && (t.profit_percent || 0) <= -15);
      if (stopLossExits.length > trades.length * 0.2) {
        patterns.push({
          type: 'stop_loss_20',
          frequency: stopLossExits.length / trades.length,
          avgOutcome: -20,
          description: 'Stop loss around -20%'
        });
      }

      // Pattern 4: Quick scalp (exit within 2 hours)
      const quickExits = trades.filter(t => (t.hold_time_hours || 0) < 2);
      if (quickExits.length > trades.length * 0.3) {
        const avgOutcome = this.calculateAvgOutcome(quickExits);
        patterns.push({
          type: 'quick_scalp',
          frequency: quickExits.length / trades.length,
          avgOutcome,
          description: 'Quick scalps (< 2 hours)'
        });
      }

      return patterns;
    } catch (error) {
      logger.error('SmartMoneyLearner', 'Failed to detect exit patterns', error as Error);
      return [];
    }
  }

  /**
   * Update wallet patterns in database
   */
  private async updateWalletPatterns(walletAddress: string): Promise<void> {
    if (!this.db) return;

    try {
      const entryPatterns = await this.detectEntryPatterns(walletAddress);
      const exitPatterns = await this.detectExitPatterns(walletAddress);

      this.db.run(`
        UPDATE smart_money_wallets
        SET common_entry_patterns = ?, common_exit_patterns = ?
        WHERE wallet_address = ?
      `, [
        JSON.stringify(entryPatterns),
        JSON.stringify(exitPatterns),
        walletAddress
      ]);
    } catch (error) {
      logger.silentError('SmartMoneyLearner', 'Failed to update wallet patterns', error as Error);
    }
  }

  /**
   * Calculate average outcome for a set of trades
   */
  private calculateAvgOutcome(trades: SmartMoneyTrade[]): number {
    if (trades.length === 0) return 0;
    const total = trades.reduce((sum, t) => sum + (t.profit_percent || 0), 0);
    return total / trades.length;
  }

  /**
   * Calculate reputation score for a wallet
   */
  calculateReputation(wallet: Partial<SmartMoneyWallet>): number {
    let score = 50; // Start at neutral

    // Win rate (max +30)
    const winRate = wallet.win_rate || 0;
    score += (winRate / 100 - 0.5) * 60;

    // Total profit (max +10)
    const totalProfit = wallet.total_profit_sol || 0;
    if (totalProfit > 100) score += 10;
    else score += totalProfit / 10;

    // Consistency (max +10)
    const totalTrades = wallet.total_trades || 0;
    if (totalTrades > 50) score += 10;
    else score += totalTrades / 5;

    // Penalty for low sample size
    if (totalTrades < 10) score -= 20;

    // Bonus for verified
    if (wallet.is_verified) score += 10;

    // Penalty for suspicious
    if (wallet.is_suspicious) score -= 50;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // ============================================
  // Alerts
  // ============================================

  /**
   * Check for new moves by tracked wallets
   */
  async checkForNewMoves(): Promise<SmartMoneyAlert[]> {
    // This will be called by the monitor job
    // For now, returns empty array
    // TODO: Monitor wallet transactions for new activity
    return [];
  }

  /**
   * Determine if we should alert on this wallet/token/action
   */
  async shouldAlert(walletAddress: string, tokenMint: string, action: 'entry' | 'exit'): Promise<boolean> {
    if (!this.db) return false;

    try {
      const wallet = await this.getWallet(walletAddress);
      if (!wallet) return false;

      // Only alert for wallets with good reputation
      if (wallet.reputation_score < 60) return false;
      if (wallet.total_trades < 5) return false;
      if (wallet.win_rate < 55) return false;

      // Check if we've alerted recently for this wallet/token combo
      const recentAlerts = this.db.exec(`
        SELECT COUNT(*) as count FROM smart_money_alerts
        WHERE wallet_address = ? AND token_mint = ?
          AND alerted_at > ?
      `, [walletAddress, tokenMint, Math.floor(Date.now() / 1000) - 3600]);

      const hasRecentAlert = recentAlerts.length > 0 && 
                            recentAlerts[0].values.length > 0 && 
                            (recentAlerts[0].values[0][0] as number) > 0;

      return !hasRecentAlert;
    } catch (error) {
      logger.silentError('SmartMoneyLearner', 'Failed to check shouldAlert', error as Error);
      return false;
    }
  }

  /**
   * Save an alert to the database
   */
  async saveAlert(alert: SmartMoneyAlert): Promise<void> {
    if (!this.db) return;

    try {
      this.db.run(`
        INSERT INTO smart_money_alerts (
          wallet_address, token_mint, token_symbol, alert_type,
          amount_sol, price, wallet_reputation, wallet_win_rate,
          alerted_at, chat_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        alert.wallet_address,
        alert.token_mint,
        alert.token_symbol ?? null,
        alert.alert_type,
        alert.amount_sol ?? null,
        alert.price ?? null,
        alert.wallet_reputation ?? null,
        alert.wallet_win_rate ?? null,
        alert.alerted_at,
        alert.chat_id ?? null
      ]);
    } catch (error) {
      logger.silentError('SmartMoneyLearner', 'Failed to save alert', error as Error);
    }
  }

  // ============================================
  // Analytics
  // ============================================

  /**
   * Get wallet statistics
   */
  async getWalletStats(address: string): Promise<WalletStats | null> {
    if (!this.db) return null;

    try {
      const wallet = await this.getWallet(address);
      if (!wallet) return null;

      const recentTrades = await this.getWalletTrades(address, 10);
      const entryPatterns = await this.detectEntryPatterns(address);
      const exitPatterns = await this.detectExitPatterns(address);

      return {
        wallet,
        recentTrades,
        patterns: {
          entryPatterns,
          exitPatterns
        }
      };
    } catch (error) {
      logger.error('SmartMoneyLearner', 'Failed to get wallet stats', error as Error);
      return null;
    }
  }

  /**
   * Get trades for a specific wallet
   */
  async getWalletTrades(address: string, limit = 10): Promise<SmartMoneyTrade[]> {
    if (!this.db) return [];

    try {
      const result = this.db.exec(`
        SELECT * FROM smart_money_trades
        WHERE wallet_address = ?
        ORDER BY entry_time DESC
        LIMIT ?
      `, [address, limit]);

      if (result.length === 0 || result[0].values.length === 0) return [];

      return result[0].values.map(row => this.parseTradeRow(result[0].columns, row));
    } catch (error) {
      logger.error('SmartMoneyLearner', 'Failed to get wallet trades', error as Error);
      return [];
    }
  }

  /**
   * Predict next move (placeholder)
   */
  async predictNextMove(address: string): Promise<Prediction | null> {
    // TODO: Implement pattern-based prediction
    // Analyze recent activity, patterns, and market conditions
    return null;
  }

  /**
   * Get smart money activity for a specific token
   */
  async getTokenSmartMoneyActivity(tokenMint: string): Promise<{
    holders: string[];
    recentBuys: SmartMoneyTrade[];
    recentSells: SmartMoneyTrade[];
  }> {
    if (!this.db) return { holders: [], recentBuys: [], recentSells: [] };

    try {
      // Get smart money wallets that have traded this token
      const result = this.db.exec(`
        SELECT DISTINCT wallet_address FROM smart_money_trades
        WHERE token_mint = ?
      `, [tokenMint]);

      const holders = result.length > 0 ? result[0].values.map(row => row[0] as string) : [];

      // Get recent buys (last 24 hours)
      const buysResult = this.db.exec(`
        SELECT * FROM smart_money_trades
        WHERE token_mint = ? AND entry_time > ?
        ORDER BY entry_time DESC
        LIMIT 10
      `, [tokenMint, Math.floor(Date.now() / 1000) - 86400]);

      const recentBuys = buysResult.length > 0 && buysResult[0].values.length > 0
        ? buysResult[0].values.map(row => this.parseTradeRow(buysResult[0].columns, row))
        : [];

      // Get recent sells (last 24 hours)
      const sellsResult = this.db.exec(`
        SELECT * FROM smart_money_trades
        WHERE token_mint = ? AND exit_time > ? AND status = 'closed'
        ORDER BY exit_time DESC
        LIMIT 10
      `, [tokenMint, Math.floor(Date.now() / 1000) - 86400]);

      const recentSells = sellsResult.length > 0 && sellsResult[0].values.length > 0
        ? sellsResult[0].values.map(row => this.parseTradeRow(sellsResult[0].columns, row))
        : [];

      return { holders, recentBuys, recentSells };
    } catch (error) {
      logger.error('SmartMoneyLearner', 'Failed to get token smart money activity', error as Error);
      return { holders: [], recentBuys: [], recentSells: [] };
    }
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Parse wallet rows from SQL result
   */
  private parseWalletRows(result: { columns: string[]; values: any[][] }): SmartMoneyWallet[] {
    return result.values.map(row => {
      const wallet: any = {};
      result.columns.forEach((col, i) => {
        wallet[col] = row[i];
      });

      return {
        id: wallet.id,
        wallet_address: wallet.wallet_address,
        total_trades: wallet.total_trades || 0,
        winning_trades: wallet.winning_trades || 0,
        losing_trades: wallet.losing_trades || 0,
        win_rate: wallet.win_rate || 0,
        total_profit_sol: wallet.total_profit_sol || 0,
        average_profit_percent: wallet.average_profit_percent || 0,
        largest_win_percent: wallet.largest_win_percent || 0,
        largest_loss_percent: wallet.largest_loss_percent || 0,
        average_hold_time_hours: wallet.average_hold_time_hours || 0,
        average_entry_liquidity: wallet.average_entry_liquidity || 0,
        preferred_risk_range: wallet.preferred_risk_range,
        trading_style: wallet.trading_style,
        common_entry_patterns: wallet.common_entry_patterns,
        common_exit_patterns: wallet.common_exit_patterns,
        first_tracked_at: wallet.first_tracked_at,
        last_trade_at: wallet.last_trade_at,
        last_updated_at: wallet.last_updated_at,
        reputation_score: wallet.reputation_score || 50,
        is_verified: wallet.is_verified === 1,
        is_suspicious: wallet.is_suspicious === 1,
      };
    });
  }

  /**
   * Parse trade row from SQL result
   */
  private parseTradeRow(columns: string[], row: any[]): SmartMoneyTrade {
    const trade: any = {};
    columns.forEach((col, i) => {
      trade[col] = row[i];
    });

    return {
      id: trade.id,
      wallet_address: trade.wallet_address,
      token_mint: trade.token_mint,
      token_symbol: trade.token_symbol,
      entry_price: trade.entry_price,
      entry_time: trade.entry_time,
      entry_liquidity: trade.entry_liquidity,
      entry_risk_score: trade.entry_risk_score,
      exit_price: trade.exit_price,
      exit_time: trade.exit_time,
      exit_reason: trade.exit_reason,
      profit_percent: trade.profit_percent,
      hold_time_hours: trade.hold_time_hours,
      status: trade.status as 'open' | 'closed',
      created_at: trade.created_at,
    };
  }

  /**
   * Get statistics summary
   */
  async getStats(): Promise<{
    totalWallets: number;
    totalTrades: number;
    openTrades: number;
    avgWinRate: number;
    topPerformers: number;
  }> {
    if (!this.db) return {
      totalWallets: 0,
      totalTrades: 0,
      openTrades: 0,
      avgWinRate: 0,
      topPerformers: 0
    };

    try {
      const walletsResult = this.db.exec('SELECT COUNT(*) FROM smart_money_wallets');
      const tradesResult = this.db.exec('SELECT COUNT(*) FROM smart_money_trades');
      const openTradesResult = this.db.exec('SELECT COUNT(*) FROM smart_money_trades WHERE status = "open"');
      const avgWinRateResult = this.db.exec('SELECT AVG(win_rate) FROM smart_money_wallets WHERE total_trades >= 5');
      const topPerformersResult = this.db.exec('SELECT COUNT(*) FROM smart_money_wallets WHERE reputation_score >= 70');

      return {
        totalWallets: walletsResult.length > 0 ? (walletsResult[0].values[0][0] as number) : 0,
        totalTrades: tradesResult.length > 0 ? (tradesResult[0].values[0][0] as number) : 0,
        openTrades: openTradesResult.length > 0 ? (openTradesResult[0].values[0][0] as number) : 0,
        avgWinRate: avgWinRateResult.length > 0 && avgWinRateResult[0].values[0][0] 
          ? (avgWinRateResult[0].values[0][0] as number) 
          : 0,
        topPerformers: topPerformersResult.length > 0 ? (topPerformersResult[0].values[0][0] as number) : 0,
      };
    } catch (error) {
      logger.error('SmartMoneyLearner', 'Failed to get stats', error as Error);
      return {
        totalWallets: 0,
        totalTrades: 0,
        openTrades: 0,
        avgWinRate: 0,
        topPerformers: 0
      };
    }
  }
}

// Singleton instance
export const smartMoneyLearner = new SmartMoneyLearner();
