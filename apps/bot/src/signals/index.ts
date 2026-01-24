/**
 * Signal Service
 * Main orchestrator for trading signal generation and distribution
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { signalGenerator, SignalGenerator } from './signalGenerator';
import { signalTracker, SignalTracker } from './signalTracker';
import { webhookDispatcher, WebhookDispatcher } from './webhookDispatcher';
import type {
  TradingSignal,
  SignalGenerationInput,
  SignalConfig,
  PositionSizeConfig,
  WebhookConfig,
  SignalPerformanceMetrics,
  SignalFilter,
  SignalOutcome,
  SignalType,
} from './types';

export class SignalService extends EventEmitter {
  private generator: SignalGenerator;
  private tracker: SignalTracker;
  private dispatcher: WebhookDispatcher;
  private initialized: boolean = false;

  constructor() {
    super();
    this.generator = signalGenerator;
    this.tracker = signalTracker;
    this.dispatcher = webhookDispatcher;

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
   * Dispatch signal to webhooks asynchronously
   */
  private async dispatchSignalAsync(signal: TradingSignal): Promise<void> {
    try {
      const results = await this.dispatcher.dispatchSignal(signal);
      const successful = results.filter(r => r.success).length;
      const failed = results.length - successful;

      if (results.length > 0) {
        logger.debug('SignalService', `Dispatched signal to ${successful}/${results.length} webhooks`);
      }

      if (failed > 0) {
        logger.warn('SignalService', `${failed} webhook(s) failed for signal ${signal.id}`);
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
export * from './types';
