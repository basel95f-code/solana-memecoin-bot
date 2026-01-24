/**
 * Signal Tracker
 * Tracks active signals, outcomes, and calculates performance metrics
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { SIGNALS } from '../constants';
import type {
  TradingSignal,
  SignalOutcome,
  SignalStatus,
  SignalPerformanceMetrics,
  SignalFilter,
  SignalType,
} from './types';

export class SignalTracker extends EventEmitter {
  private activeSignals: Map<string, TradingSignal> = new Map(); // id -> signal
  private outcomes: Map<string, SignalOutcome> = new Map(); // signalId -> outcome
  private signalsByMint: Map<string, Set<string>> = new Map(); // mint -> signalIds
  private expiryInterval: NodeJS.Timeout | null = null;
  private maxActiveSignals: number;

  constructor(maxActiveSignals: number = SIGNALS.MAX_ACTIVE_SIGNALS) {
    super();
    this.maxActiveSignals = maxActiveSignals;
  }

  /**
   * Start the signal tracker (auto-expire signals)
   */
  start(): void {
    if (this.expiryInterval) return;

    // Check for expired signals every minute
    this.expiryInterval = setInterval(() => {
      this.expireOldSignals();
    }, 60000);

    logger.info('SignalTracker', 'Started signal tracking');
  }

  /**
   * Stop the signal tracker
   */
  stop(): void {
    if (this.expiryInterval) {
      clearInterval(this.expiryInterval);
      this.expiryInterval = null;
    }
    logger.info('SignalTracker', 'Stopped signal tracking');
  }

  /**
   * Add a new signal to track
   */
  addSignal(signal: TradingSignal): boolean {
    // Check max active signals
    const activeCount = this.getActiveSignalCount();
    if (activeCount >= this.maxActiveSignals) {
      logger.warn('SignalTracker', `Max active signals (${this.maxActiveSignals}) reached, rejecting new signal`);
      return false;
    }

    // Add to maps
    this.activeSignals.set(signal.id, signal);

    // Track by mint
    if (!this.signalsByMint.has(signal.mint)) {
      this.signalsByMint.set(signal.mint, new Set());
    }
    this.signalsByMint.get(signal.mint)!.add(signal.id);

    // Create initial outcome record
    this.outcomes.set(signal.id, {
      signalId: signal.id,
      mint: signal.mint,
      symbol: signal.symbol,
      signalType: signal.type,
      predictedConfidence: signal.confidence,
      predictedEntry: signal.entryPrice,
      predictedTarget: signal.targetPrice,
      predictedStopLoss: signal.stopLossPrice,
      signalGeneratedAt: signal.generatedAt,
    });

    this.emit('signalAdded', signal);
    logger.debug('SignalTracker', `Added signal ${signal.id} for ${signal.symbol}`);

    return true;
  }

  /**
   * Get a signal by ID
   */
  getSignal(id: string): TradingSignal | undefined {
    return this.activeSignals.get(id);
  }

  /**
   * Get all signals for a token
   */
  getSignalsForMint(mint: string): TradingSignal[] {
    const signalIds = this.signalsByMint.get(mint);
    if (!signalIds) return [];

    return Array.from(signalIds)
      .map(id => this.activeSignals.get(id))
      .filter((s): s is TradingSignal => s !== undefined);
  }

  /**
   * Get all active signals
   */
  getActiveSignals(): TradingSignal[] {
    const now = Math.floor(Date.now() / 1000);
    return Array.from(this.activeSignals.values())
      .filter(s => s.status === 'active' && s.expiresAt > now);
  }

  /**
   * Get signals with filtering
   */
  getSignals(filter: SignalFilter = {}): TradingSignal[] {
    let signals = Array.from(this.activeSignals.values());

    if (filter.types && filter.types.length > 0) {
      signals = signals.filter(s => filter.types!.includes(s.type));
    }

    if (filter.status && filter.status.length > 0) {
      signals = signals.filter(s => filter.status!.includes(s.status));
    }

    if (filter.minConfidence !== undefined) {
      signals = signals.filter(s => s.confidence >= filter.minConfidence!);
    }

    if (filter.maxConfidence !== undefined) {
      signals = signals.filter(s => s.confidence <= filter.maxConfidence!);
    }

    if (filter.mint) {
      signals = signals.filter(s => s.mint === filter.mint);
    }

    if (filter.symbol) {
      signals = signals.filter(s =>
        s.symbol.toLowerCase().includes(filter.symbol!.toLowerCase())
      );
    }

    if (filter.startTime !== undefined) {
      signals = signals.filter(s => s.generatedAt >= filter.startTime!);
    }

    if (filter.endTime !== undefined) {
      signals = signals.filter(s => s.generatedAt <= filter.endTime!);
    }

    // Sort by generation time (newest first)
    signals.sort((a, b) => b.generatedAt - a.generatedAt);

    // Apply pagination
    if (filter.offset) {
      signals = signals.slice(filter.offset);
    }

    if (filter.limit) {
      signals = signals.slice(0, filter.limit);
    }

    return signals;
  }

  /**
   * Acknowledge a signal (mark as seen)
   */
  acknowledgeSignal(id: string, acknowledgedBy?: string): boolean {
    const signal = this.activeSignals.get(id);
    if (!signal) return false;

    signal.status = 'acknowledged';
    signal.acknowledgedAt = Math.floor(Date.now() / 1000);
    signal.acknowledgedBy = acknowledgedBy;

    this.emit('signalAcknowledged', signal);
    logger.debug('SignalTracker', `Acknowledged signal ${id}`);

    return true;
  }

  /**
   * Record the outcome of a signal
   */
  recordOutcome(
    signalId: string,
    actualEntry: number,
    actualExit: number,
    notes?: string
  ): SignalOutcome | null {
    const outcome = this.outcomes.get(signalId);
    const signal = this.activeSignals.get(signalId);

    if (!outcome || !signal) {
      logger.warn('SignalTracker', `Cannot record outcome: signal ${signalId} not found`);
      return null;
    }

    const now = Math.floor(Date.now() / 1000);

    // Calculate profit/loss
    const profitLossPercent = ((actualExit - actualEntry) / actualEntry) * 100;

    // Determine if signal was accurate
    let wasAccurate = false;
    let hitTarget = false;
    let hitStopLoss = false;

    if (signal.type === 'BUY') {
      // BUY is accurate if we made profit
      wasAccurate = profitLossPercent > 0;
      hitTarget = signal.targetPrice ? actualExit >= signal.targetPrice : false;
      hitStopLoss = signal.stopLossPrice ? actualExit <= signal.stopLossPrice : false;
    } else if (signal.type === 'SELL') {
      // SELL is accurate if price went down after signal
      wasAccurate = profitLossPercent < 0; // If sold, avoiding loss is good
    }

    // Update outcome
    outcome.actualEntry = actualEntry;
    outcome.actualExit = actualExit;
    outcome.profitLossPercent = profitLossPercent;
    outcome.wasAccurate = wasAccurate;
    outcome.hitTarget = hitTarget;
    outcome.hitStopLoss = hitStopLoss;
    outcome.entryRecordedAt = outcome.entryRecordedAt || now;
    outcome.exitRecordedAt = now;
    outcome.notes = notes;

    // Mark signal as executed
    signal.status = 'executed';

    this.emit('outcomeRecorded', outcome, signal);
    logger.info('SignalTracker', `Recorded outcome for ${signal.symbol}: ${profitLossPercent.toFixed(2)}%`);

    return outcome;
  }

  /**
   * Get outcome for a signal
   */
  getOutcome(signalId: string): SignalOutcome | undefined {
    return this.outcomes.get(signalId);
  }

  /**
   * Get all outcomes
   */
  getAllOutcomes(): SignalOutcome[] {
    return Array.from(this.outcomes.values());
  }

  /**
   * Get outcomes with recorded results
   */
  getCompletedOutcomes(): SignalOutcome[] {
    return Array.from(this.outcomes.values())
      .filter(o => o.actualExit !== undefined);
  }

  /**
   * Expire old signals
   */
  private expireOldSignals(): void {
    const now = Math.floor(Date.now() / 1000);
    let expiredCount = 0;

    for (const [id, signal] of this.activeSignals) {
      if (signal.status === 'active' && signal.expiresAt <= now) {
        signal.status = 'expired';
        expiredCount++;
        this.emit('signalExpired', signal);
      }
    }

    if (expiredCount > 0) {
      logger.debug('SignalTracker', `Expired ${expiredCount} signals`);
    }
  }

  /**
   * Get count of active signals
   */
  getActiveSignalCount(): number {
    const now = Math.floor(Date.now() / 1000);
    return Array.from(this.activeSignals.values())
      .filter(s => s.status === 'active' && s.expiresAt > now)
      .length;
  }

  /**
   * Calculate performance metrics
   */
  calculateMetrics(): SignalPerformanceMetrics {
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 86400;
    const sevenDaysAgo = now - 7 * 86400;

    const allSignals = Array.from(this.activeSignals.values());
    const completedOutcomes = this.getCompletedOutcomes();

    // Count by status
    const activeSignals = allSignals.filter(s => s.status === 'active' && s.expiresAt > now).length;
    const acknowledgedSignals = allSignals.filter(s => s.status === 'acknowledged').length;
    const expiredSignals = allSignals.filter(s => s.status === 'expired').length;

    // Outcome stats
    const signalsWithOutcome = completedOutcomes.length;
    const accurateSignals = completedOutcomes.filter(o => o.wasAccurate).length;
    const winRate = signalsWithOutcome > 0 ? (accurateSignals / signalsWithOutcome) * 100 : 0;

    // P/L stats
    const returns = completedOutcomes
      .filter(o => o.profitLossPercent !== undefined)
      .map(o => o.profitLossPercent!);

    const totalProfitLoss = returns.reduce((sum, r) => sum + r, 0);
    const averageReturn = returns.length > 0 ? totalProfitLoss / returns.length : 0;
    const bestReturn = returns.length > 0 ? Math.max(...returns) : 0;
    const worstReturn = returns.length > 0 ? Math.min(...returns) : 0;

    // By signal type
    const buyOutcomes = completedOutcomes.filter(o => o.signalType === 'BUY');
    const sellOutcomes = completedOutcomes.filter(o => o.signalType === 'SELL');

    const buyStats = this.calculateTypeStats(buyOutcomes);
    const sellStats = this.calculateTypeStats(sellOutcomes);

    // Time-based
    const signalsLast24h = allSignals.filter(s => s.generatedAt >= oneDayAgo).length;
    const signalsLast7d = allSignals.filter(s => s.generatedAt >= sevenDaysAgo).length;

    const ages = allSignals.map(s => now - s.generatedAt);
    const avgSignalAge = ages.length > 0 ? ages.reduce((sum, a) => sum + a, 0) / ages.length : 0;

    return {
      totalSignals: allSignals.length,
      activeSignals,
      acknowledgedSignals,
      expiredSignals,
      signalsWithOutcome,
      accurateSignals,
      winRate,
      totalProfitLoss,
      averageReturn,
      bestReturn,
      worstReturn,
      buySignals: buyStats,
      sellSignals: sellStats,
      signalsLast24h,
      signalsLast7d,
      avgSignalAge,
      calculatedAt: now,
    };
  }

  /**
   * Calculate stats for a specific signal type
   */
  private calculateTypeStats(outcomes: SignalOutcome[]): {
    total: number;
    accurate: number;
    winRate: number;
    avgReturn: number;
  } {
    const total = outcomes.length;
    const accurate = outcomes.filter(o => o.wasAccurate).length;
    const winRate = total > 0 ? (accurate / total) * 100 : 0;
    const returns = outcomes
      .filter(o => o.profitLossPercent !== undefined)
      .map(o => o.profitLossPercent!);
    const avgReturn = returns.length > 0
      ? returns.reduce((sum, r) => sum + r, 0) / returns.length
      : 0;

    return { total, accurate, winRate, avgReturn };
  }

  /**
   * Get signal history (all signals, sorted by time)
   */
  getHistory(limit: number = 50): TradingSignal[] {
    return Array.from(this.activeSignals.values())
      .sort((a, b) => b.generatedAt - a.generatedAt)
      .slice(0, limit);
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.activeSignals.clear();
    this.outcomes.clear();
    this.signalsByMint.clear();
  }

  /**
   * Load signals from database (for persistence)
   */
  loadSignals(signals: TradingSignal[], outcomes?: SignalOutcome[]): void {
    for (const signal of signals) {
      this.activeSignals.set(signal.id, signal);

      if (!this.signalsByMint.has(signal.mint)) {
        this.signalsByMint.set(signal.mint, new Set());
      }
      this.signalsByMint.get(signal.mint)!.add(signal.id);
    }

    if (outcomes) {
      for (const outcome of outcomes) {
        this.outcomes.set(outcome.signalId, outcome);
      }
    }

    logger.info('SignalTracker', `Loaded ${signals.length} signals and ${outcomes?.length || 0} outcomes`);
  }
}

// Export singleton instance
export const signalTracker = new SignalTracker();
