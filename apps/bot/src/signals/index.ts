/**
 * Signal Service
 * Main orchestrator for trading signal generation and distribution
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { signalGenerator, SignalGenerator } from './signalGenerator';
import { signalTracker, SignalTracker } from './signalTracker';
import { webhookDispatcher, WebhookDispatcher } from './webhookDispatcher';
import { slackWebhookDispatcher, SlackWebhookDispatcher, SlackWebhookConfig } from './slackWebhook';
import type {
  TradingSignal,
  SignalGenerationInput,
  SignalConfig,
  PositionSizeConfig,
  KellyConfig,
  WebhookConfig,
  SignalPerformanceMetrics,
  SignalFilter,
  SignalOutcome,
  SignalType,
} from './types';
import type { CorrelationConfig } from './correlationAnalyzer';

export class SignalService extends EventEmitter {
  private generator: SignalGenerator;
  private tracker: SignalTracker;
  private dispatcher: WebhookDispatcher;
  private slackDispatcher: SlackWebhookDispatcher;
  private initialized: boolean = false;

  constructor() {
    super();
    this.generator = signalGenerator;
    this.tracker = signalTracker;
    this.dispatcher = webhookDispatcher;
    this.slackDispatcher = slackWebhookDispatcher;

    // Wire up events
    this.tracker.on('signalAdded', (signal: TradingSignal) => {
      this.emit('signalGenerated', signal);
    });

    this.tracker.on('signalAcknowledged', (signal: TradingSignal) => {
      this.emit('signalAcknowledged', signal);
    });

    this.tracker.on('signalExpired', (signal: TradingSignal) => {
      this.emit('signalExpired', signal);
    });

    this.tracker.on('outcomeRecorded', (outcome: SignalOutcome, signal: TradingSignal) => {
      // Sync outcome to generator for Kelly calculations
      this.generator.addOutcome(outcome);
      this.emit('outcomeRecorded', outcome, signal);
    });
  }

  /**
   * Initialize the signal service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Start the signal tracker
    this.tracker.start();

    this.initialized = true;
    logger.info('SignalService', 'Initialized successfully');
  }

  /**
   * Process token analysis and potentially generate a signal
   */
  async processAnalysis(input: SignalGenerationInput): Promise<TradingSignal | null> {
    try {
      // Sync active signals for correlation checking
      this.syncActiveSignals();

      // Generate signal if conditions are met
      const signal = this.generator.generateSignal(input);

      if (!signal) {
        return null;
      }

      // Add to tracker
      const added = this.tracker.addSignal(signal);
      if (!added) {
        logger.warn('SignalService', `Failed to track signal for ${input.symbol}`);
        return null;
      }

      // Dispatch to webhooks (async, don't block)
      this.dispatchSignalAsync(signal);

      return signal;

    } catch (error) {
      logger.error('SignalService', `Error processing analysis for ${input.symbol}`, error as Error);
      return null;
    }
  }

  /**
   * Dispatch signal to webhooks asynchronously (Discord and Slack)
   */
  private async dispatchSignalAsync(signal: TradingSignal): Promise<void> {
    try {
      // Dispatch to Discord webhooks
      const discordResults = await this.dispatcher.dispatchSignal(signal);
      const discordSuccessful = discordResults.filter(r => r.success).length;
      const discordFailed = discordResults.length - discordSuccessful;

      // Dispatch to Slack webhooks
      const slackResults = await this.slackDispatcher.dispatchSignal(signal);
      const slackSuccessful = slackResults.filter(r => r.success).length;
      const slackFailed = slackResults.length - slackSuccessful;

      const totalResults = discordResults.length + slackResults.length;
      const totalSuccessful = discordSuccessful + slackSuccessful;
      const totalFailed = discordFailed + slackFailed;

      if (totalResults > 0) {
        logger.debug(
          'SignalService',
          `Dispatched signal to ${totalSuccessful}/${totalResults} webhooks ` +
          `(Discord: ${discordSuccessful}/${discordResults.length}, Slack: ${slackSuccessful}/${slackResults.length})`
        );
      }

      if (totalFailed > 0) {
        logger.warn('SignalService', `${totalFailed} webhook(s) failed for signal ${signal.id}`);
      }

    } catch (error) {
      logger.error('SignalService', 'Error dispatching signal to webhooks', error as Error);
    }
  }

  // ============================================
  // Signal Management
  // ============================================

  /**
   * Get a signal by ID
   */
  getSignal(id: string): TradingSignal | undefined {
    return this.tracker.getSignal(id);
  }

  /**
   * Get active signals
   */
  getActiveSignals(): TradingSignal[] {
    return this.tracker.getActiveSignals();
  }

  /**
   * Get signals with filtering
   */
  getSignals(filter?: SignalFilter): TradingSignal[] {
    return this.tracker.getSignals(filter);
  }

  /**
   * Get signal history
   */
  getSignalHistory(limit?: number): TradingSignal[] {
    return this.tracker.getHistory(limit);
  }

  /**
   * Acknowledge a signal
   */
  acknowledgeSignal(signalId: string, acknowledgedBy?: string): boolean {
    return this.tracker.acknowledgeSignal(signalId, acknowledgedBy);
  }

  /**
   * Record signal outcome
   */
  recordOutcome(
    signalId: string,
    actualEntry: number,
    actualExit: number,
    notes?: string
  ): SignalOutcome | null {
    return this.tracker.recordOutcome(signalId, actualEntry, actualExit, notes);
  }

  /**
   * Get signal outcome
   */
  getOutcome(signalId: string): SignalOutcome | undefined {
    return this.tracker.getOutcome(signalId);
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): SignalPerformanceMetrics {
    return this.tracker.calculateMetrics();
  }

  // ============================================
  // Webhook Management
  // ============================================

  /**
   * Add a webhook
   */
  addWebhook(config: {
    id: string;
    url: string;
    name: string;
    enabled: boolean;
    events: SignalType[];
    minConfidence: number;
  }): WebhookConfig {
    return this.dispatcher.addWebhook(config.url, config.name, {
      enabled: config.enabled,
      events: config.events,
      minConfidence: config.minConfidence,
    });
  }

  /**
   * Dispatch signal to webhooks (public method)
   */
  async dispatchToWebhooks(signal: TradingSignal): Promise<void> {
    await this.dispatchSignalAsync(signal);
  }

  /**
   * Remove a webhook
   */
  removeWebhook(id: number): boolean {
    return this.dispatcher.removeWebhook(id);
  }

  /**
   * Get all webhooks
   */
  getWebhooks(): WebhookConfig[] {
    return this.dispatcher.getAllWebhooks();
  }

  /**
   * Get a webhook by ID
   */
  getWebhook(id: number): WebhookConfig | undefined {
    return this.dispatcher.getWebhook(id);
  }

  /**
   * Update a webhook
   */
  updateWebhook(id: number, updates: Partial<Omit<WebhookConfig, 'id' | 'createdAt'>>): boolean {
    return this.dispatcher.updateWebhook(id, updates);
  }

  // ============================================
  // Slack Webhook Management
  // ============================================

  /**
   * Add a Slack webhook
   */
  addSlackWebhook(config: {
    url: string;
    name: string;
    channel?: string;
    enabled?: boolean;
    events?: SignalType[];
    minConfidence?: number;
  }): SlackWebhookConfig {
    return this.slackDispatcher.addWebhook(config.url, config.name, {
      channel: config.channel,
      enabled: config.enabled ?? true,
      events: config.events ?? ['BUY', 'SELL', 'TAKE_PROFIT', 'STOP_LOSS'],
      minConfidence: config.minConfidence ?? 60,
    });
  }

  /**
   * Remove a Slack webhook
   */
  removeSlackWebhook(id: number): boolean {
    return this.slackDispatcher.removeWebhook(id);
  }

  /**
   * Get all Slack webhooks
   */
  getSlackWebhooks(): SlackWebhookConfig[] {
    return this.slackDispatcher.getAllWebhooks();
  }

  /**
   * Get a Slack webhook by ID
   */
  getSlackWebhook(id: number): SlackWebhookConfig | undefined {
    return this.slackDispatcher.getWebhook(id);
  }

  /**
   * Update a Slack webhook
   */
  updateSlackWebhook(
    id: number,
    updates: Partial<Omit<SlackWebhookConfig, 'id' | 'createdAt'>>
  ): boolean {
    return this.slackDispatcher.updateWebhook(id, updates);
  }

  // ============================================
  // Configuration
  // ============================================

  /**
   * Update signal configuration
   */
  updateSignalConfig(config: Partial<SignalConfig>): void {
    this.generator.updateConfig(config);
  }

  /**
   * Update position sizing configuration
   */
  updatePositionConfig(config: Partial<PositionSizeConfig>): void {
    this.generator.updatePositionConfig(config);
  }

  /**
   * Get current signal configuration
   */
  getSignalConfig(): SignalConfig {
    return this.generator.getConfig();
  }

  // ============================================
  // Kelly Criterion
  // ============================================

  /**
   * Update Kelly criterion configuration
   */
  updateKellyConfig(config: Partial<KellyConfig>): void {
    this.generator.updateKellyConfig(config);
    logger.info('SignalService', `Kelly config updated: enabled=${config.enabled ?? this.generator.getKellyConfig().enabled}`);
  }

  /**
   * Get Kelly criterion configuration
   */
  getKellyConfig(): KellyConfig {
    return this.generator.getKellyConfig();
  }

  /**
   * Get Kelly criterion description for display
   */
  getKellyDescription(): string {
    return this.generator.getKellyDescription();
  }

  /**
   * Get Kelly criterion metrics
   */
  getKellyMetrics(): {
    enabled: boolean;
    tradeCount: number;
    winRate: number;
    winLossRatio: number;
    suggestedPosition: number;
    fallbackReason?: string;
  } {
    return this.generator.getKellyMetrics();
  }

  // ============================================
  // Correlation Analysis
  // ============================================

  /**
   * Update correlation configuration
   */
  updateCorrelationConfig(config: Partial<CorrelationConfig>): void {
    this.generator.updateCorrelationConfig(config);
    logger.info('SignalService', `Correlation config updated: enabled=${config.enabled ?? this.generator.getCorrelationConfig().enabled}`);
  }

  /**
   * Get correlation configuration
   */
  getCorrelationConfig(): CorrelationConfig {
    return this.generator.getCorrelationConfig();
  }

  /**
   * Get correlation summary for active signals
   */
  getCorrelationSummary(): {
    totalSignals: number;
    correlationPairs: number;
    highCorrelationPairs: Array<{
      signalA: string;
      signalB: string;
      correlation: number;
    }>;
    diversificationScore: number;
  } {
    return this.generator.getCorrelationSummary();
  }

  /**
   * Sync active signals from tracker to generator
   * Called to keep correlation analyzer up-to-date
   */
  private syncActiveSignals(): void {
    const activeSignals = this.tracker.getActiveSignals();
    this.generator.updateActiveSignals(activeSignals);
  }

  // ============================================
  // Persistence
  // ============================================

  /**
   * Load state from database
   */
  loadState(
    signals: TradingSignal[],
    outcomes: SignalOutcome[],
    webhooks: WebhookConfig[]
  ): void {
    this.tracker.loadSignals(signals, outcomes);
    this.dispatcher.loadWebhooks(webhooks);

    // Sync outcomes to generator for Kelly calculations
    this.generator.updateHistoricalOutcomes(outcomes);
  }

  /**
   * Get state for persistence
   */
  getState(): {
    signals: TradingSignal[];
    outcomes: SignalOutcome[];
    webhooks: WebhookConfig[];
  } {
    return {
      signals: this.tracker.getHistory(1000), // All signals
      outcomes: this.tracker.getAllOutcomes(),
      webhooks: this.dispatcher.getAllWebhooks(),
    };
  }

  // ============================================
  // Lifecycle
  // ============================================

  /**
   * Stop the signal service
   */
  stop(): void {
    this.tracker.stop();
    this.initialized = false;
    logger.info('SignalService', 'Stopped');
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Export singleton instance
export const signalService = new SignalService();

// Re-export types and components
export { signalGenerator } from './signalGenerator';
export { signalTracker } from './signalTracker';
export { webhookDispatcher } from './webhookDispatcher';
export { slackWebhookDispatcher, SlackWebhookDispatcher } from './slackWebhook';
export type { SlackWebhookConfig } from './slackWebhook';
export { signalPriceMonitor } from './priceMonitor';
export { kellyCriterion, KellyCriterion } from './kellyCriterion';
export { correlationAnalyzer, CorrelationAnalyzer } from './correlationAnalyzer';
export type { CorrelationConfig, CorrelationResult } from './correlationAnalyzer';
export * from './types';
