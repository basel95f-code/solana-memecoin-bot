/**
 * Advanced Risk Manager
 * Risk-adjusted position sizing and stop-loss recommendations
 * Portfolio-level risk management
 */

import { logger } from '../../utils/logger';

export interface RiskAssessment {
  tokenMint: string;
  tokenSymbol: string;
  
  // Individual token risk
  tokenRiskLevel: 'very_low' | 'low' | 'medium' | 'high' | 'very_high';
  riskScore: number;              // 0-100
  
  // Position sizing
  recommendedPositionSize: number; // In SOL
  maxPositionSize: number;         // Max allowed
  minPositionSize: number;         // Min viable
  
  // Risk management
  stopLossPercent: number;         // -% from entry
  takeProfitPercent: number;       // +% from entry
  maxHoldTime: number;             // Hours
  
  // Portfolio impact
  portfolioRiskImpact: number;     // 0-1
  correlationRisk: number;         // 0-1
  
  // Confidence
  assessmentConfidence: number;    // 0-1
  
  reasoning: string[];
  timestamp: number;
}

export interface PortfolioRisk {
  totalExposure: number;           // Total SOL at risk
  diversificationScore: number;    // 0-1 (1 = well diversified)
  correlationScore: number;        // 0-1 (0 = uncorrelated)
  maxDrawdownEstimate: number;     // Estimated max loss %
  sharpeRatio: number;             // Risk-adjusted return
  currentRiskLevel: 'conservative' | 'moderate' | 'aggressive' | 'extreme';
}

export interface RiskConfig {
  accountBalance: number;
  maxPortfolioRisk: number;        // Max % of portfolio at risk
  maxSinglePositionPercent: number; // Max % in one position
  basePositionSize: number;        // Base size in SOL
  riskPerTrade: number;            // % of portfolio to risk per trade
  maxOpenPositions: number;
}

export class AdvancedRiskManager {
  private config: RiskConfig;
  private assessmentHistory: RiskAssessment[] = [];
  private readonly MAX_HISTORY = 500;

  private readonly DEFAULT_CONFIG: RiskConfig = {
    accountBalance: 100, // SOL
    maxPortfolioRisk: 0.20, // 20%
    maxSinglePositionPercent: 0.05, // 5%
    basePositionSize: 2, // SOL
    riskPerTrade: 0.02, // 2%
    maxOpenPositions: 10,
  };

  constructor(config: Partial<RiskConfig> = {}) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  /**
   * Assess risk and recommend position sizing
   */
  async assessRisk(
    tokenMint: string,
    tokenSymbol: string,
    riskScore: number,
    mlRugProbability: number,
    confidence: number,
    currentPortfolio?: any
  ): Promise<RiskAssessment> {
    logger.debug('AdvancedRiskManager', `Assessing risk for ${tokenSymbol}`);

    // Determine risk level
    const tokenRiskLevel = this.determineRiskLevel(riskScore, mlRugProbability);

    // Calculate position size
    const { recommendedPositionSize, maxPositionSize, minPositionSize } =
      this.calculatePositionSize(riskScore, mlRugProbability, confidence);

    // Calculate stop-loss and take-profit
    const { stopLossPercent, takeProfitPercent } = this.calculateExitLevels(tokenRiskLevel);

    // Calculate max hold time
    const maxHoldTime = this.calculateMaxHoldTime(tokenRiskLevel);

    // Portfolio impact
    const portfolioRiskImpact = recommendedPositionSize / this.config.accountBalance;
    const correlationRisk = currentPortfolio ? this.estimateCorrelationRisk(currentPortfolio) : 0;

    // Assessment confidence
    const assessmentConfidence = this.calculateAssessmentConfidence(
      riskScore,
      mlRugProbability,
      confidence
    );

    // Generate reasoning
    const reasoning = this.generateReasoning(
      tokenRiskLevel,
      riskScore,
      mlRugProbability,
      recommendedPositionSize
    );

    const assessment: RiskAssessment = {
      tokenMint,
      tokenSymbol,
      tokenRiskLevel,
      riskScore,
      recommendedPositionSize,
      maxPositionSize,
      minPositionSize,
      stopLossPercent,
      takeProfitPercent,
      maxHoldTime,
      portfolioRiskImpact,
      correlationRisk,
      assessmentConfidence,
      reasoning,
      timestamp: Date.now(),
    };

    // Store history
    this.assessmentHistory.push(assessment);
    if (this.assessmentHistory.length > this.MAX_HISTORY) {
      this.assessmentHistory.shift();
    }

    logger.info('AdvancedRiskManager', `${tokenSymbol}: ${tokenRiskLevel} risk, ${recommendedPositionSize} SOL recommended, ${stopLossPercent}% SL`);

    return assessment;
  }

  /**
   * Determine risk level
   */
  private determineRiskLevel(
    riskScore: number,
    mlRugProbability: number
  ): RiskAssessment['tokenRiskLevel'] {
    // Very high risk
    if (mlRugProbability > 0.7 || riskScore < 30) {
      return 'very_high';
    }

    // High risk
    if (mlRugProbability > 0.5 || riskScore < 50) {
      return 'high';
    }

    // Medium risk
    if (mlRugProbability > 0.3 || riskScore < 65) {
      return 'medium';
    }

    // Low risk
    if (mlRugProbability > 0.15 || riskScore < 80) {
      return 'low';
    }

    // Very low risk
    return 'very_low';
  }

  /**
   * Calculate position size
   */
  private calculatePositionSize(
    riskScore: number,
    mlRugProbability: number,
    confidence: number
  ): {
    recommendedPositionSize: number;
    maxPositionSize: number;
    minPositionSize: number;
  } {
    // Start with base size
    let size = this.config.basePositionSize;

    // Adjust for risk score (higher score = larger position)
    const riskMultiplier = riskScore / 100;
    size *= (0.5 + riskMultiplier * 0.5); // 0.5x to 1.0x

    // Adjust for ML prediction (lower rug prob = larger position)
    const mlMultiplier = 1 - mlRugProbability;
    size *= (0.5 + mlMultiplier * 0.5); // 0.5x to 1.0x

    // Adjust for confidence
    size *= confidence;

    // Apply portfolio limits
    const maxFromPortfolio = this.config.accountBalance * this.config.maxSinglePositionPercent;
    size = Math.min(size, maxFromPortfolio);

    // Calculate min/max
    const minPositionSize = Math.max(0.5, size * 0.5);
    const maxPositionSize = Math.min(size * 1.5, maxFromPortfolio);
    const recommendedPositionSize = Math.max(minPositionSize, Math.min(maxPositionSize, size));

    return {
      recommendedPositionSize: Math.round(recommendedPositionSize * 10) / 10,
      maxPositionSize: Math.round(maxPositionSize * 10) / 10,
      minPositionSize: Math.round(minPositionSize * 10) / 10,
    };
  }

  /**
   * Calculate exit levels (stop-loss & take-profit)
   */
  private calculateExitLevels(riskLevel: RiskAssessment['tokenRiskLevel']): {
    stopLossPercent: number;
    takeProfitPercent: number;
  } {
    // Tighter stops for riskier tokens
    switch (riskLevel) {
      case 'very_high':
        return { stopLossPercent: -5, takeProfitPercent: 15 };
      case 'high':
        return { stopLossPercent: -10, takeProfitPercent: 30 };
      case 'medium':
        return { stopLossPercent: -15, takeProfitPercent: 50 };
      case 'low':
        return { stopLossPercent: -20, takeProfitPercent: 75 };
      case 'very_low':
        return { stopLossPercent: -25, takeProfitPercent: 100 };
    }
  }

  /**
   * Calculate max hold time
   */
  private calculateMaxHoldTime(riskLevel: RiskAssessment['tokenRiskLevel']): number {
    // Hours
    switch (riskLevel) {
      case 'very_high':
        return 2; // 2 hours
      case 'high':
        return 6; // 6 hours
      case 'medium':
        return 24; // 1 day
      case 'low':
        return 72; // 3 days
      case 'very_low':
        return 168; // 1 week
    }
  }

  /**
   * Estimate correlation risk
   */
  private estimateCorrelationRisk(portfolio: any): number {
    // Simplified correlation estimation
    // In real implementation, would calculate actual correlation
    return 0.3; // Placeholder
  }

  /**
   * Calculate assessment confidence
   */
  private calculateAssessmentConfidence(
    riskScore: number,
    mlRugProbability: number,
    predictionConfidence: number
  ): number {
    // Confidence based on:
    // 1. Clear risk score (50-70 = uncertain, >80 or <30 = clear)
    // 2. Clear ML prediction
    // 3. ML prediction confidence

    const riskClarity = riskScore > 80 || riskScore < 30 ? 1.0 : 0.6;
    const mlClarity = mlRugProbability > 0.7 || mlRugProbability < 0.2 ? 1.0 : 0.6;

    return (riskClarity * 0.3 + mlClarity * 0.3 + predictionConfidence * 0.4);
  }

  /**
   * Generate reasoning
   */
  private generateReasoning(
    riskLevel: string,
    riskScore: number,
    mlRugProbability: number,
    positionSize: number
  ): string[] {
    const reasoning: string[] = [];

    // Risk level
    reasoning.push(`Risk level: ${riskLevel.toUpperCase().replace('_', ' ')}`);

    // Risk score
    if (riskScore >= 80) {
      reasoning.push('✅ Very high risk score');
    } else if (riskScore >= 65) {
      reasoning.push('✅ Good risk score');
    } else if (riskScore < 50) {
      reasoning.push('⚠️ Low risk score');
    }

    // ML prediction
    if (mlRugProbability < 0.2) {
      reasoning.push('🛡️ Very low rug probability');
    } else if (mlRugProbability > 0.5) {
      reasoning.push('⚠️ High rug probability detected');
    }

    // Position size
    if (positionSize < 1) {
      reasoning.push('Small position recommended due to risk');
    } else if (positionSize > 5) {
      reasoning.push('Larger position justified by low risk');
    }

    return reasoning;
  }

  /**
   * Calculate portfolio risk
   */
  calculatePortfolioRisk(positions: any[]): PortfolioRisk {
    const totalExposure = positions.reduce((sum, p) => sum + (p.size || 0), 0);
    const exposurePercent = totalExposure / this.config.accountBalance;

    // Diversification score (more positions = better)
    const diversificationScore = Math.min(1, positions.length / 10);

    // Correlation (placeholder)
    const correlationScore = 0.7;

    // Estimated max drawdown
    const maxDrawdownEstimate = exposurePercent * 0.5; // Assume 50% worst case

    // Sharpe ratio (placeholder)
    const sharpeRatio = 1.5;

    // Current risk level
    let currentRiskLevel: PortfolioRisk['currentRiskLevel'];
    if (exposurePercent > 0.3) currentRiskLevel = 'extreme';
    else if (exposurePercent > 0.2) currentRiskLevel = 'aggressive';
    else if (exposurePercent > 0.1) currentRiskLevel = 'moderate';
    else currentRiskLevel = 'conservative';

    return {
      totalExposure,
      diversificationScore,
      correlationScore,
      maxDrawdownEstimate,
      sharpeRatio,
      currentRiskLevel,
    };
  }

  /**
   * Get assessment history
   */
  getHistory(limit: number = 50): RiskAssessment[] {
    return this.assessmentHistory.slice(-limit);
  }

  /**
   * Get statistics
   */
  getStats() {
    const assessments = this.assessmentHistory;
    if (assessments.length === 0) return null;

    return {
      totalAssessments: assessments.length,
      avgPositionSize: assessments.reduce((sum, a) => sum + a.recommendedPositionSize, 0) / assessments.length,
      avgStopLoss: assessments.reduce((sum, a) => sum + Math.abs(a.stopLossPercent), 0) / assessments.length,
      riskLevels: {
        very_low: assessments.filter(a => a.tokenRiskLevel === 'very_low').length,
        low: assessments.filter(a => a.tokenRiskLevel === 'low').length,
        medium: assessments.filter(a => a.tokenRiskLevel === 'medium').length,
        high: assessments.filter(a => a.tokenRiskLevel === 'high').length,
        very_high: assessments.filter(a => a.tokenRiskLevel === 'very_high').length,
      },
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RiskConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('AdvancedRiskManager', 'Configuration updated');
  }
}
