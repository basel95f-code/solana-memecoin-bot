/**
 * Advanced Risk Management System
 * Intelligent position sizing, stop-loss calculation, correlation checks
 */

import { database } from '../database';
import { portfolioTracker } from './portfolioTracker';
import { logger } from '../utils/logger';

export interface RiskParameters {
  // Account settings
  accountBalance: number;
  maxDailyLoss: number; // Percentage (e.g., 5 = 5%)
  maxPositionSize: number; // Percentage (e.g., 10 = 10% of account)
  
  // Risk per trade
  baseRiskPercent: number; // Default risk per trade (e.g., 1-2%)
  maxRiskPercent: number; // Absolute maximum (e.g., 3%)
  
  // Position limits
  maxOpenPositions: number;
  maxCorrelatedPositions: number; // Max positions in correlated assets
}

export interface PositionSizingResult {
  recommendedSize: number; // USD value
  recommendedQuantity: number;
  riskAmount: number; // USD at risk
  stopLossPrice: number;
  takeProfitPrice?: number;
  
  // Risk metrics
  riskPercent: number; // % of account
  confidenceAdjustment: number; // How much ML confidence affected size
  correlationPenalty: number; // Reduction due to correlation
  
  // Warnings
  warnings: string[];
  approved: boolean;
  reason?: string;
}

export interface DailyRiskStats {
  dailyLoss: number;
  dailyLossPercent: number;
  tradesCount: number;
  limitReached: boolean;
  remainingRisk: number;
}

class AdvancedRiskManager {
  private params: RiskParameters = {
    accountBalance: 10000,
    maxDailyLoss: 5,
    maxPositionSize: 10,
    baseRiskPercent: 1,
    maxRiskPercent: 2,
    maxOpenPositions: 5,
    maxCorrelatedPositions: 2,
  };

  /**
   * Calculate position size with all risk factors
   */
  async calculatePositionSize(params: {
    symbol: string;
    entryPrice: number;
    stopLossPrice: number;
    mlConfidence?: number; // 0-1
    riskScore?: number; // 0-100
    correlationSymbols?: string[]; // Symbols to check correlation with
  }): Promise<PositionSizingResult> {
    const result: PositionSizingResult = {
      recommendedSize: 0,
      recommendedQuantity: 0,
      riskAmount: 0,
      stopLossPrice: params.stopLossPrice,
      riskPercent: 0,
      confidenceAdjustment: 1,
      correlationPenalty: 0,
      warnings: [],
      approved: false,
    };

    try {
      // Check daily loss limit
      const dailyStats = this.getDailyRiskStats();
      if (dailyStats.limitReached) {
        result.approved = false;
        result.reason = `Daily loss limit reached (${dailyStats.dailyLossPercent.toFixed(1)}% / ${this.params.maxDailyLoss}%)`;
        return result;
      }

      // Check open position limit
      const openPositions = portfolioTracker.getOpenPositions();
      if (openPositions.length >= this.params.maxOpenPositions) {
        result.approved = false;
        result.reason = `Maximum open positions reached (${openPositions.length}/${this.params.maxOpenPositions})`;
        return result;
      }

      // Base risk calculation
      let riskPercent = this.params.baseRiskPercent;

      // Adjust based on ML confidence
      if (params.mlConfidence !== undefined) {
        // Higher confidence = larger position
        // Confidence 0.5 = 1x, 0.7 = 1.2x, 0.9 = 1.5x
        result.confidenceAdjustment = 0.5 + (params.mlConfidence * 1.0);
        riskPercent *= result.confidenceAdjustment;
        
        if (params.mlConfidence > 0.8) {
          result.warnings.push(`High ML confidence (${(params.mlConfidence * 100).toFixed(0)}%) - increased position size`);
        } else if (params.mlConfidence < 0.6) {
          result.warnings.push(`Low ML confidence (${(params.mlConfidence * 100).toFixed(0)}%) - reduced position size`);
        }
      }

      // Adjust based on risk score
      if (params.riskScore !== undefined) {
        // Higher risk score = larger position
        // Risk 50 = 0.8x, Risk 70 = 1.0x, Risk 90 = 1.2x
        const riskMultiplier = 0.4 + (params.riskScore / 100) * 0.8;
        riskPercent *= riskMultiplier;
      }

      // Cap at max risk
      riskPercent = Math.min(riskPercent, this.params.maxRiskPercent);

      // Check correlation penalty
      if (params.correlationSymbols && params.correlationSymbols.length > 0) {
        const correlationCheck = this.checkCorrelation(params.symbol, params.correlationSymbols, openPositions);
        result.correlationPenalty = correlationCheck.penalty;
        
        if (correlationCheck.count >= this.params.maxCorrelatedPositions) {
          result.approved = false;
          result.reason = `Too many correlated positions (${correlationCheck.count}/${this.params.maxCorrelatedPositions})`;
          return result;
        }
        
        if (correlationCheck.penalty > 0) {
          riskPercent *= (1 - correlationCheck.penalty);
          result.warnings.push(`Correlated assets detected - reduced position by ${(correlationCheck.penalty * 100).toFixed(0)}%`);
        }
      }

      // Calculate position size
      const riskAmount = this.params.accountBalance * (riskPercent / 100);
      const priceDistance = Math.abs(params.entryPrice - params.stopLossPrice);
      const stopLossPercent = priceDistance / params.entryPrice;
      
      const positionSize = riskAmount / stopLossPercent;
      const quantity = positionSize / params.entryPrice;

      // Check against max position size
      const maxPositionValue = this.params.accountBalance * (this.params.maxPositionSize / 100);
      if (positionSize > maxPositionValue) {
        result.warnings.push(`Position capped at ${this.params.maxPositionSize}% of account`);
      }

      result.recommendedSize = Math.min(positionSize, maxPositionValue);
      result.recommendedQuantity = result.recommendedSize / params.entryPrice;
      result.riskAmount = riskAmount;
      result.riskPercent = riskPercent;
      result.approved = true;

      // Calculate take profit (2:1 risk/reward)
      const profitDistance = priceDistance * 2;
      result.takeProfitPrice = params.entryPrice > params.stopLossPrice
        ? params.entryPrice + profitDistance
        : params.entryPrice - profitDistance;

    } catch (error) {
      logger.error('AdvancedRiskManager', 'Position sizing failed', error as Error);
      result.approved = false;
      result.reason = `Calculation error: ${(error as Error).message}`;
    }

    return result;
  }

  /**
   * Auto-calculate stop loss based on token metrics
   */
  calculateStopLoss(params: {
    entryPrice: number;
    riskScore: number;
    volatility?: number; // If available from historical data
  }): number {
    // Base stop loss: 10-30% based on risk score
    // Lower risk score = wider stop (more volatile)
    // Higher risk score = tighter stop (more stable)
    const baseStopPercent = 30 - (params.riskScore / 100) * 20; // 10-30%

    // Adjust for volatility if available
    let stopPercent = baseStopPercent;
    if (params.volatility) {
      stopPercent = Math.max(baseStopPercent, params.volatility * 1.5);
    }

    return params.entryPrice * (1 - stopPercent / 100);
  }

  /**
   * Check correlation with existing positions
   */
  private checkCorrelation(
    symbol: string,
    correlationSymbols: string[],
    openPositions: any[]
  ): { count: number; penalty: number } {
    let correlatedCount = 0;

    for (const position of openPositions) {
      if (correlationSymbols.includes(position.symbol)) {
        correlatedCount++;
      }
    }

    // Penalty increases with each correlated position
    // 1 correlated = 10% reduction, 2 = 30%, 3 = 50%
    const penalty = correlatedCount > 0
      ? Math.min(correlatedCount * 0.2, 0.5)
      : 0;

    return { count: correlatedCount, penalty };
  }

  /**
   * Get daily risk statistics
   */
  getDailyRiskStats(): DailyRiskStats {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTimestamp = todayStart.getTime();

    // Get today's closed trades
    const trades = database.all<any>(
      `SELECT * FROM trades 
       WHERE action IN ('close', 'partial_close')
       AND timestamp >= ?`,
      [todayTimestamp]
    );

    const totalPnL = trades.reduce((sum, t) => sum + (t.realized_pnl || 0), 0);
    const dailyLoss = totalPnL < 0 ? Math.abs(totalPnL) : 0;
    const dailyLossPercent = (dailyLoss / this.params.accountBalance) * 100;

    const limitReached = dailyLossPercent >= this.params.maxDailyLoss;
    const remainingRisk = limitReached
      ? 0
      : (this.params.maxDailyLoss - dailyLossPercent) * this.params.accountBalance / 100;

    return {
      dailyLoss,
      dailyLossPercent,
      tradesCount: trades.length,
      limitReached,
      remainingRisk,
    };
  }

  /**
   * Update risk parameters
   */
  updateParameters(params: Partial<RiskParameters>): void {
    this.params = { ...this.params, ...params };
    
    // Save to database
    database.run(
      `INSERT OR REPLACE INTO risk_parameters (
        id, account_balance, max_daily_loss, max_position_size,
        base_risk_percent, max_risk_percent, max_open_positions,
        max_correlated_positions, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.params.accountBalance,
        this.params.maxDailyLoss,
        this.params.maxPositionSize,
        this.params.baseRiskPercent,
        this.params.maxRiskPercent,
        this.params.maxOpenPositions,
        this.params.maxCorrelatedPositions,
        Date.now(),
      ]
    );

    logger.info('AdvancedRiskManager', 'Risk parameters updated');
  }

  /**
   * Load risk parameters from database
   */
  loadParameters(): void {
    const row = database.get<any>(
      'SELECT * FROM risk_parameters WHERE id = 1'
    );

    if (row) {
      this.params = {
        accountBalance: row.account_balance,
        maxDailyLoss: row.max_daily_loss,
        maxPositionSize: row.max_position_size,
        baseRiskPercent: row.base_risk_percent,
        maxRiskPercent: row.max_risk_percent,
        maxOpenPositions: row.max_open_positions,
        maxCorrelatedPositions: row.max_correlated_positions,
      };
    }
  }

  /**
   * Get current parameters
   */
  getParameters(): RiskParameters {
    return { ...this.params };
  }

  /**
   * Format position sizing result for display
   */
  formatResult(result: PositionSizingResult): string {
    let output = `⚖️ Position Sizing Analysis\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (!result.approved) {
      output += `🚫 <b>NOT APPROVED</b>\n`;
      output += `Reason: ${result.reason}\n`;
      return output;
    }

    output += `✅ <b>APPROVED</b>\n\n`;
    output += `💰 Recommended Size: $${result.recommendedSize.toFixed(2)}\n`;
    output += `📦 Quantity: ${result.recommendedQuantity.toFixed(2)}\n`;
    output += `🎯 Risk Amount: $${result.riskAmount.toFixed(2)} (${result.riskPercent.toFixed(2)}%)\n\n`;

    output += `🛑 Stop Loss: $${result.stopLossPrice.toFixed(6)}\n`;
    if (result.takeProfitPrice) {
      output += `🎯 Take Profit: $${result.takeProfitPrice.toFixed(6)}\n`;
    }
    output += `\n`;

    if (result.confidenceAdjustment !== 1) {
      output += `🤖 ML Adjustment: ${(result.confidenceAdjustment * 100).toFixed(0)}%\n`;
    }

    if (result.correlationPenalty > 0) {
      output += `🔗 Correlation Penalty: -${(result.correlationPenalty * 100).toFixed(0)}%\n`;
    }

    if (result.warnings.length > 0) {
      output += `\n⚠️ Warnings:\n`;
      for (const warning of result.warnings) {
        output += `• ${warning}\n`;
      }
    }

    return output;
  }
}

// Export singleton
export const advancedRiskManager = new AdvancedRiskManager();
