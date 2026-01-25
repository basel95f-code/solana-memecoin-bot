/**
 * Copy Trading Signals
 * Real-time alerts when top-performing wallets buy/sell
 * Confidence-based signal generation
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import type { WalletProfile } from './WalletProfiler';

export interface CopySignal {
  id: string;
  walletAddress: string;
  walletProfile: WalletProfile;
  action: 'buy' | 'sell';
  tokenMint: string;
  tokenSymbol: string;
  
  // Trade details
  amount: number;
  solValue: number;
  priceUsd?: number;
  
  // Signal metadata
  confidence: number;              // 0-1, how reliable is this signal
  priority: 'low' | 'normal' | 'high' | 'critical';
  reasoning: string[];             // Why this is a strong signal
  
  // Recommendations
  recommendedPositionSize: number; // In SOL
  riskLevel: 'low' | 'medium' | 'high';
  
  // Timing
  timestamp: number;
  entrySpeed: 'instant' | 'fast' | 'normal'; // How quickly to act
}

export interface SignalConfig {
  minWalletConfidence: number;     // Min 0.6 = top 40% of wallets
  minWinRate: number;               // Min 0.55 = 55% win rate
  minEarlyEntryWinRate: number;    // Min 0.6 for early entries
  onlyTopSnipers: boolean;          // Only signal from snipers
  minPositionSize: number;          // Min SOL to trigger signal
  maxPositionSize: number;          // Max SOL (avoid whale manipulation)
}

export class CopyTradingSignals extends EventEmitter {
  private config: SignalConfig;
  private recentSignals: Map<string, CopySignal> = new Map(); // tokenMint -> signal
  private signalHistory: CopySignal[] = [];

  private readonly DEFAULT_CONFIG: SignalConfig = {
    minWalletConfidence: 0.6,
    minWinRate: 0.55,
    minEarlyEntryWinRate: 0.6,
    onlyTopSnipers: false,
    minPositionSize: 1,
    maxPositionSize: 100,
  };

  constructor(config: Partial<SignalConfig> = {}) {
    super();
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate signal from wallet trade
   */
  generateSignal(
    walletProfile: WalletProfile,
    action: 'buy' | 'sell',
    tokenMint: string,
    tokenSymbol: string,
    amount: number,
    solValue: number,
    priceUsd?: number
  ): CopySignal | null {
    // Check if wallet meets minimum criteria
    if (!this.meetsMinimumCriteria(walletProfile, solValue)) {
      logger.debug('CopyTradingSignals', `Wallet ${walletProfile.walletAddress.slice(0, 8)}... does not meet criteria`);
      return null;
    }

    // Calculate signal confidence
    const confidence = this.calculateSignalConfidence(walletProfile, action, solValue);

    // Determine priority
    const priority = this.determinePriority(walletProfile, confidence);

    // Generate reasoning
    const reasoning = this.generateReasoning(walletProfile, action, confidence);

    // Calculate recommended position size
    const recommendedPositionSize = this.calculatePositionSize(
      walletProfile,
      solValue,
      confidence
    );

    // Determine risk level
    const riskLevel = this.determineRiskLevel(walletProfile, confidence);

    // Determine entry speed
    const entrySpeed = this.determineEntrySpeed(walletProfile, priority);

    const signal: CopySignal = {
      id: `${walletProfile.walletAddress}-${tokenMint}-${Date.now()}`,
      walletAddress: walletProfile.walletAddress,
      walletProfile,
      action,
      tokenMint,
      tokenSymbol,
      amount,
      solValue,
      priceUsd,
      confidence,
      priority,
      reasoning,
      recommendedPositionSize,
      riskLevel,
      timestamp: Date.now(),
      entrySpeed,
    };

    // Store signal
    this.recentSignals.set(tokenMint, signal);
    this.signalHistory.push(signal);

    // Emit signal event
    this.emit('copy_signal', signal);
    this.emit(action, signal);

    logger.info('CopyTradingSignals', `Generated ${priority} ${action} signal for ${tokenSymbol} (confidence: ${(confidence * 100).toFixed(1)}%)`);

    return signal;
  }

  /**
   * Check if wallet meets minimum criteria
   */
  private meetsMinimumCriteria(
    profile: WalletProfile,
    solValue: number
  ): boolean {
    // Wallet confidence
    if (profile.confidenceScore < this.config.minWalletConfidence) {
      return false;
    }

    // Overall win rate
    const winRate = profile.earlyEntryWinRate || 0;
    if (winRate < this.config.minWinRate) {
      return false;
    }

    // Early entry win rate (if sniper)
    if (profile.category === 'sniper' && profile.earlyEntryWinRate < this.config.minEarlyEntryWinRate) {
      return false;
    }

    // Position size
    if (solValue < this.config.minPositionSize || solValue > this.config.maxPositionSize) {
      return false;
    }

    // Only snipers (if configured)
    if (this.config.onlyTopSnipers && profile.category !== 'sniper') {
      return false;
    }

    return true;
  }

  /**
   * Calculate signal confidence
   */
  private calculateSignalConfidence(
    profile: WalletProfile,
    action: 'buy' | 'sell',
    solValue: number
  ): number {
    let confidence = profile.confidenceScore; // Base confidence from wallet

    // Boost for category
    if (profile.category === 'sniper') {
      confidence *= 1.2; // Snipers get 20% boost
    }

    // Boost for early entry success
    if (action === 'buy' && profile.earlyEntryWinRate > 0.7) {
      confidence *= 1.15; // High early entry win rate
    }

    // Boost for position size (aligned with their usual)
    const sizeRatio = solValue / profile.avgPositionSize;
    if (sizeRatio >= 0.5 && sizeRatio <= 2.0) {
      confidence *= 1.1; // Normal position size for them
    } else if (sizeRatio > 2.0) {
      confidence *= 1.2; // Larger than usual = high conviction
    }

    // Boost for new token success
    if (profile.newTokenSuccessRate > 0.6) {
      confidence *= 1.1; // Good at finding new gems
    }

    return Math.min(1.0, confidence);
  }

  /**
   * Determine signal priority
   */
  private determinePriority(
    profile: WalletProfile,
    confidence: number
  ): 'low' | 'normal' | 'high' | 'critical' {
    // Critical: Top snipers with ultra-high confidence
    if (profile.category === 'sniper' && confidence >= 0.85) {
      return 'critical';
    }

    // High: High confidence or top performers
    if (confidence >= 0.75 || profile.earlyEntryWinRate >= 0.75) {
      return 'high';
    }

    // Normal: Above average
    if (confidence >= 0.65) {
      return 'normal';
    }

    // Low: Meets criteria but not exceptional
    return 'low';
  }

  /**
   * Generate reasoning
   */
  private generateReasoning(
    profile: WalletProfile,
    action: 'buy' | 'sell',
    confidence: number
  ): string[] {
    const reasons: string[] = [];

    // Category
    if (profile.category === 'sniper') {
      reasons.push(`⚡ Top Sniper (enters within ${Math.floor(profile.avgTimeToEntry / 60000)}min)`);
    }

    // Win rate
    if (profile.earlyEntryWinRate >= 0.7) {
      reasons.push(`🎯 ${(profile.earlyEntryWinRate * 100).toFixed(0)}% win rate on early entries`);
    }

    // New token performance
    if (profile.newTokenSuccessRate >= 0.6) {
      reasons.push(`💎 ${(profile.newTokenSuccessRate * 100).toFixed(0)}% success on new tokens`);
    }

    // Fast discovery
    if (profile.avgDiscoveryRank <= 10) {
      reasons.push(`🥇 Usually among first 10 buyers`);
    }

    // Confidence
    if (confidence >= 0.8) {
      reasons.push(`✅ Ultra-high confidence signal`);
    }

    // Large position
    if (profile.avgPositionSize > 50) {
      reasons.push(`🐋 Whale-sized position`);
    }

    return reasons;
  }

  /**
   * Calculate recommended position size
   */
  private calculatePositionSize(
    profile: WalletProfile,
    theirPositionSize: number,
    confidence: number
  ): number {
    // Base size: scale their position down
    let recommendedSize = theirPositionSize * 0.1; // 10% of their size

    // Adjust for confidence
    recommendedSize *= confidence;

    // Cap at reasonable limits
    recommendedSize = Math.max(0.5, Math.min(10, recommendedSize));

    return Math.round(recommendedSize * 10) / 10; // Round to 1 decimal
  }

  /**
   * Determine risk level
   */
  private determineRiskLevel(
    profile: WalletProfile,
    confidence: number
  ): 'low' | 'medium' | 'high' {
    if (confidence >= 0.8 && profile.earlyEntryWinRate >= 0.7) {
      return 'low';
    }

    if (confidence >= 0.65) {
      return 'medium';
    }

    return 'high';
  }

  /**
   * Determine entry speed
   */
  private determineEntrySpeed(
    profile: WalletProfile,
    priority: string
  ): 'instant' | 'fast' | 'normal' {
    if (priority === 'critical') {
      return 'instant'; // Act immediately
    }

    if (priority === 'high' && profile.category === 'sniper') {
      return 'fast'; // Act within seconds
    }

    return 'normal';
  }

  /**
   * Get recent signal for token
   */
  getRecentSignal(tokenMint: string): CopySignal | undefined {
    return this.recentSignals.get(tokenMint);
  }

  /**
   * Get signal history
   */
  getHistory(limit: number = 50): CopySignal[] {
    return this.signalHistory.slice(-limit);
  }

  /**
   * Get signals by priority
   */
  getByPriority(priority: 'low' | 'normal' | 'high' | 'critical'): CopySignal[] {
    return this.signalHistory.filter(s => s.priority === priority);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SignalConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('CopyTradingSignals', 'Configuration updated:', this.config);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalSignals: this.signalHistory.length,
      byPriority: {
        critical: this.signalHistory.filter(s => s.priority === 'critical').length,
        high: this.signalHistory.filter(s => s.priority === 'high').length,
        normal: this.signalHistory.filter(s => s.priority === 'normal').length,
        low: this.signalHistory.filter(s => s.priority === 'low').length,
      },
      avgConfidence: this.signalHistory.length > 0
        ? this.signalHistory.reduce((sum, s) => sum + s.confidence, 0) / this.signalHistory.length
        : 0,
    };
  }
}
