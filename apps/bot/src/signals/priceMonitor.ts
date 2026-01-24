/**
 * Signal Price Monitor
 * Monitors price for active signals and triggers TP/SL alerts
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { database } from '../database';
import { dexScreenerService } from '../services/dexscreener';
import { signalService } from './index';
import { telegramService } from '../services/telegram';
import type { TradingSignal, SignalType } from './types';

// ============================================
// Types
// ============================================

export interface PriceUpdate {
  mint: string;
  symbol: string;
  currentPrice: number;
  priceChange: number; // Percentage from entry
  signalId: string;
  signalType: SignalType;
  targetHit: boolean;
  stopLossHit: boolean;
}

export interface MonitorConfig {
  checkIntervalMs: number; // How often to check prices (default: 30s)
  batchSize: number; // Max signals to check per batch
  priceStaleMs: number; // Consider price stale after this time
}

const DEFAULT_CONFIG: MonitorConfig = {
  checkIntervalMs: 30000, // 30 seconds
  batchSize: 10,
  priceStaleMs: 60000, // 1 minute
};

// ============================================
// Signal Price Monitor
// ============================================

export class SignalPriceMonitor extends EventEmitter {
  private config: MonitorConfig;
  private checkInterval: NodeJS.Timeout | null = null;
  private isChecking: boolean = false;
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();

  constructor(config: Partial<MonitorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start monitoring prices for active signals
   */
  start(): void {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      this.checkPrices().catch(err => {
        logger.silentError('PriceMonitor', 'Price check failed', err as Error);
      });
    }, this.config.checkIntervalMs);

    logger.info('PriceMonitor', `Started (interval: ${this.config.checkIntervalMs}ms)`);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logger.info('PriceMonitor', 'Stopped');
  }

  /**
   * Check prices for all active signals
   */
  private async checkPrices(): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      // Get active signals
      const activeSignals = signalService.getActiveSignals();

      if (activeSignals.length === 0) {
        return;
      }

      logger.debug('PriceMonitor', `Checking ${activeSignals.length} active signals`);

      // Process in batches to avoid rate limiting
      for (let i = 0; i < activeSignals.length; i += this.config.batchSize) {
        const batch = activeSignals.slice(i, i + this.config.batchSize);
        await Promise.all(batch.map(signal => this.checkSignalPrice(signal)));

        // Small delay between batches
        if (i + this.config.batchSize < activeSignals.length) {
          await this.sleep(1000);
        }
      }

    } catch (error) {
      logger.silentError('PriceMonitor', 'Price check failed', error as Error);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Check price for a single signal
   */
  private async checkSignalPrice(signal: TradingSignal): Promise<void> {
    try {
      // Get current price
      const currentPrice = await this.getPrice(signal.mint);

      if (!currentPrice || currentPrice <= 0) {
        return;
      }

      // Calculate price change from entry
      const priceChange = ((currentPrice - signal.entryPrice) / signal.entryPrice) * 100;

      // Check if target hit (for BUY signals)
      const targetHit = signal.type === 'BUY' &&
                        signal.targetPrice &&
                        currentPrice >= signal.targetPrice;

      // Check if stop loss hit (for BUY signals)
      const stopLossHit = signal.type === 'BUY' &&
                          signal.stopLossPrice &&
                          currentPrice <= signal.stopLossPrice;

      // For SELL signals, logic is reversed
      const sellTargetHit = signal.type === 'SELL' &&
                            signal.targetPrice &&
                            currentPrice <= signal.targetPrice;

      const sellStopLossHit = signal.type === 'SELL' &&
                              signal.stopLossPrice &&
                              currentPrice >= signal.stopLossPrice;

      const update: PriceUpdate = {
        mint: signal.mint,
        symbol: signal.symbol,
        currentPrice,
        priceChange,
        signalId: signal.id,
        signalType: signal.type,
        targetHit: !!(targetHit || sellTargetHit),
        stopLossHit: !!(stopLossHit || sellStopLossHit),
      };

      // Emit price update event
      this.emit('priceUpdate', update);

      // Handle target hit
      if (update.targetHit) {
        await this.handleTargetHit(signal, currentPrice, priceChange);
      }

      // Handle stop loss hit
      if (update.stopLossHit) {
        await this.handleStopLossHit(signal, currentPrice, priceChange);
      }

      // Check for significant price movement alerts (>20% or <-15%)
      if (!update.targetHit && !update.stopLossHit) {
        await this.checkSignificantMovement(signal, currentPrice, priceChange);
      }

    } catch (error) {
      logger.debug('PriceMonitor', `Failed to check price for ${signal.symbol}: ${(error as Error).message}`);
    }
  }

  /**
   * Get price for a token (with caching)
   */
  private async getPrice(mint: string): Promise<number | null> {
    // Check cache first
    const cached = this.priceCache.get(mint);
    if (cached && (Date.now() - cached.timestamp) < this.config.priceStaleMs) {
      return cached.price;
    }

    try {
      const pairData = await dexScreenerService.getTokenData(mint);
      if (pairData && pairData.priceUsd) {
        const price = parseFloat(pairData.priceUsd);
        this.priceCache.set(mint, { price, timestamp: Date.now() });
        return price;
      }
    } catch (error) {
      logger.debug('PriceMonitor', `Failed to get price for ${mint}`);
    }

    return null;
  }

  /**
   * Handle when a signal's target price is hit
   */
  private async handleTargetHit(
    signal: TradingSignal,
    currentPrice: number,
    priceChange: number
  ): Promise<void> {
    logger.info('PriceMonitor', `TARGET HIT: ${signal.symbol} at $${currentPrice} (+${priceChange.toFixed(2)}%)`);

    // Send Telegram notification
    await telegramService.sendMessage(
      `🎯 <b>TARGET HIT!</b>\n\n` +
      `Token: <b>${signal.symbol}</b>\n` +
      `Signal: ${signal.type}\n` +
      `Entry: <code>$${signal.entryPrice.toFixed(8)}</code>\n` +
      `Target: <code>$${signal.targetPrice?.toFixed(8)}</code>\n` +
      `Current: <code>$${currentPrice.toFixed(8)}</code>\n` +
      `Gain: <b>+${priceChange.toFixed(2)}%</b> 🚀\n\n` +
      `<i>Consider taking profits!</i>`
    );

    // Update signal status
    database.updateSignalStatus(signal.id, 'executed');

    this.emit('targetHit', signal, currentPrice, priceChange);
  }

  /**
   * Handle when a signal's stop loss is hit
   */
  private async handleStopLossHit(
    signal: TradingSignal,
    currentPrice: number,
    priceChange: number
  ): Promise<void> {
    logger.info('PriceMonitor', `STOP LOSS HIT: ${signal.symbol} at $${currentPrice} (${priceChange.toFixed(2)}%)`);

    // Send Telegram notification
    await telegramService.sendMessage(
      `🛑 <b>STOP LOSS HIT!</b>\n\n` +
      `Token: <b>${signal.symbol}</b>\n` +
      `Signal: ${signal.type}\n` +
      `Entry: <code>$${signal.entryPrice.toFixed(8)}</code>\n` +
      `Stop Loss: <code>$${signal.stopLossPrice?.toFixed(8)}</code>\n` +
      `Current: <code>$${currentPrice.toFixed(8)}</code>\n` +
      `Loss: <b>${priceChange.toFixed(2)}%</b> 📉\n\n` +
      `<i>Consider exiting position to limit losses.</i>`
    );

    // Update signal status
    database.updateSignalStatus(signal.id, 'executed');

    this.emit('stopLossHit', signal, currentPrice, priceChange);
  }

  /**
   * Check for significant price movements that warrant an update
   */
  private async checkSignificantMovement(
    signal: TradingSignal,
    currentPrice: number,
    priceChange: number
  ): Promise<void> {
    // Get last notification time for this signal
    const lastNotified = this.getLastNotificationTime(signal.id);
    const minNotificationInterval = 15 * 60 * 1000; // 15 minutes

    if (lastNotified && (Date.now() - lastNotified) < minNotificationInterval) {
      return; // Don't spam notifications
    }

    // Alert on significant gains (+20%)
    if (priceChange >= 20) {
      await telegramService.sendMessage(
        `📈 <b>Price Update</b>\n\n` +
        `Token: <b>${signal.symbol}</b>\n` +
        `Signal: ${signal.type} @ $${signal.entryPrice.toFixed(8)}\n` +
        `Current: <code>$${currentPrice.toFixed(8)}</code>\n` +
        `Change: <b>+${priceChange.toFixed(2)}%</b> 🔥\n\n` +
        `Target: $${signal.targetPrice?.toFixed(8) || 'N/A'}`
      );
      this.setLastNotificationTime(signal.id);
    }

    // Alert on significant losses (-15%)
    if (priceChange <= -15) {
      await telegramService.sendMessage(
        `📉 <b>Price Warning</b>\n\n` +
        `Token: <b>${signal.symbol}</b>\n` +
        `Signal: ${signal.type} @ $${signal.entryPrice.toFixed(8)}\n` +
        `Current: <code>$${currentPrice.toFixed(8)}</code>\n` +
        `Change: <b>${priceChange.toFixed(2)}%</b> ⚠️\n\n` +
        `Stop Loss: $${signal.stopLossPrice?.toFixed(8) || 'N/A'}`
      );
      this.setLastNotificationTime(signal.id);
    }
  }

  // Simple in-memory notification tracking
  private notificationTimes: Map<string, number> = new Map();

  private getLastNotificationTime(signalId: string): number | undefined {
    return this.notificationTimes.get(signalId);
  }

  private setLastNotificationTime(signalId: string): void {
    this.notificationTimes.set(signalId, Date.now());

    // Clean up old entries
    if (this.notificationTimes.size > 1000) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
      for (const [id, time] of this.notificationTimes.entries()) {
        if (time < cutoff) {
          this.notificationTimes.delete(id);
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Force a price check (for manual trigger)
   */
  async forceCheck(): Promise<void> {
    await this.checkPrices();
  }

  /**
   * Get monitoring stats
   */
  getStats(): {
    isRunning: boolean;
    activeSignalsCount: number;
    cachedPricesCount: number;
  } {
    return {
      isRunning: this.checkInterval !== null,
      activeSignalsCount: signalService.getActiveSignals().length,
      cachedPricesCount: this.priceCache.size,
    };
  }
}

// Export singleton
export const signalPriceMonitor = new SignalPriceMonitor();
