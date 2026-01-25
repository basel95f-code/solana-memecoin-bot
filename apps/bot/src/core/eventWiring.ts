/**
 * Event wiring - connects monitors and services via event listeners
 */

import { config } from '../config';
import { telegramService } from '../services/telegram';
import type { AdvancedAlert } from '../services/advancedMonitor';
import { advancedMonitor } from '../services/advancedMonitor';
import { walletMonitorService } from '../services/walletMonitor';
import { liquidityMonitor } from '../services/liquidityMonitor';
import type { LiquidityAlert } from '../services/liquidityMonitor';
import { devWalletTracker } from '../services/devWalletTracker';
import type { DevBehaviorAlert } from '../services/devWalletTracker';
import { bundledWalletDetector } from '../services/bundledWalletDetector';
import type { BundleAlert } from '../services/bundledWalletDetector';
import { topHolderTracker } from '../services/topHolderTracker';
import type { HolderChangeAlert } from '../services/topHolderTracker';
import { raydiumMonitor } from '../monitors/raydium';
import { pumpFunMonitor } from '../monitors/pumpfun';
import { jupiterMonitor } from '../monitors/jupiter';
import { apiServer } from '../api/server';
import { formatAdvancedAlert } from '../telegram/commands/advanced';
import { formatLiquidityAlert, formatDevBehaviorAlert, formatBundleAlert, formatHolderChangeAlert } from '../telegram/formatters';
import type { PoolInfo, WalletActivityAlert } from '../types';
import { logger } from '../utils/logger';
import { queueProcessor } from './queueProcessor';
import { shouldSendAdvancedAlert } from './alertFilter';

/**
 * Set up all event listeners for monitors and services
 */
export function setupEventListeners(): void {
  setupMonitorListeners();
  setupAdvancedMonitorListeners();
  setupLiquidityMonitorListeners();
  setupDevWalletTrackerListeners();
  setupBundledWalletDetectorListeners();
  setupTopHolderTrackerListeners();
}

/**
 * Set up wallet monitor event listeners
 */
export function setupWalletMonitorListeners(): void {
  walletMonitorService.on('walletActivity', async (alert: WalletActivityAlert) => {
    try {
      // Enrich the transaction with token metadata
      await walletMonitorService.enrichTransaction(alert.transaction);

      // Send alert via Telegram
      await telegramService.sendWalletActivityAlert(alert);

      // Add to dashboard alerts
      const typeEmoji = alert.transaction.type === 'buy' ? '🟢' : alert.transaction.type === 'sell' ? '🔴' : '↔️';
      apiServer.addAlert({
        type: 'wallet_activity',
        title: `${alert.wallet.label} ${alert.transaction.type.toUpperCase()}`,
        description: `${alert.transaction.tokenSymbol || 'Token'} - ${alert.transaction.amount?.toLocaleString() || 'N/A'}`,
        emoji: typeEmoji,
        timestamp: Date.now(),
      });

      console.log(`👛 Wallet alert: ${alert.wallet.label} ${alert.transaction.type} ${alert.transaction.tokenSymbol || alert.transaction.tokenMint.slice(0, 8)}`);
    } catch (error) {
      logger.silentError('WalletMonitor', 'Error handling wallet activity alert', error as Error);
    }
  });
}

/**
 * Set up pool monitor event listeners
 */
function setupMonitorListeners(): void {
  // Raydium new pool events
  raydiumMonitor.on('newPool', (pool: PoolInfo) => {
    void queueProcessor.queueAnalysis(pool);
  });

  // Pump.fun new pool events
  pumpFunMonitor.on('newPool', (pool: PoolInfo) => {
    void queueProcessor.queueAnalysis(pool);
  });

  // Jupiter new token events
  jupiterMonitor.on('newPool', (pool: PoolInfo) => {
    void queueProcessor.queueAnalysis(pool);
  });
}

/**
 * Set up advanced monitor event listeners (volume spikes, whale movements, etc.)
 */
function setupAdvancedMonitorListeners(): void {
  advancedMonitor.on('alert', async (alert: AdvancedAlert) => {
    try {
      // Check if this alert should be sent
      if (!shouldSendAdvancedAlert(alert.type, alert.tokenMint, config.telegramChatId)) {
        logger.debug('Alerts', `Skipping ${alert.type} alert - filtered`);
        return;
      }

      const message = formatAdvancedAlert(alert);
      await telegramService.sendMessage(message, config.telegramChatId);

      // Add to dashboard alerts
      const emojiMap: Record<string, string> = {
        volume_spike: '📊',
        whale_movement: '🐋',
        liquidity_drain: '💧',
        authority_change: '🔐',
      };
      apiServer.addAlert({
        type: alert.type,
        title: `${alert.type.replace('_', ' ').toUpperCase()}`,
        description: `${alert.symbol} - ${alert.details}`,
        emoji: emojiMap[alert.type] || '🔔',
        timestamp: Date.now(),
      });

      console.log(`📢 Advanced alert: ${alert.type} for ${alert.symbol}`);
    } catch (error) {
      console.error('Error sending advanced alert:', error);
    }
  });
}


/**
 * Set up liquidity monitor event listeners
 */
function setupLiquidityMonitorListeners(): void {
  liquidityMonitor.on('alert', async (alert: LiquidityAlert) => {
    try {
      // Format and send Telegram alert
      const message = formatLiquidityAlert(alert);
      await telegramService.sendMessage(message, config.telegramChatId);

      // Add to dashboard
      const emojiMap = {
        drain: alert.severity === 'critical' ? '??' : '??',
        unlock: '??',
        burn_change: '??',
        locker_expiry: '?',
      };

      apiServer.addAlert({
        type: 'liquidity_' + alert.type,
        title: alert.type.toUpperCase().replace('_', ' '),
        description: \\ - \\,
        emoji: emojiMap[alert.type] || '??',
        timestamp: Date.now(),
      });

      logger.info('LiquidityMonitor', \Alert sent: \ for \\);
    } catch (error) {
      logger.error('LiquidityMonitor', 'Error sending liquidity alert', error as Error);
    }
  });
}



/**
 * Set up dev wallet tracker event listeners
 */
function setupDevWalletTrackerListeners(): void {
  devWalletTracker.on('alert', async (alert: DevBehaviorAlert) => {
    try {
      // Format and send Telegram alert
      const message = formatDevBehaviorAlert(alert);
      await telegramService.sendMessage(message, config.telegramChatId);

      // Add to dashboard
      const emojiMap = {
        first_sell: '??',
        large_dump: '??',
        rapid_selling: '?',
        complete_exit: '??',
      };

      apiServer.addAlert({
        type: 'dev_' + alert.type,
        title: alert.type.toUpperCase().replace('_', ' '),
        description: \\ - \\,
        emoji: emojiMap[alert.type] || '??',
        timestamp: Date.now(),
      });

      logger.info('DevWalletTracker', \Alert sent: \ for \\);
    } catch (error) {
      logger.error('DevWalletTracker', 'Error sending dev behavior alert', error as Error);
    }
  });
}



/**
 * Set up bundled wallet detector event listeners
 */
function setupBundledWalletDetectorListeners(): void {
  bundledWalletDetector.on('alert', async (alert: BundleAlert) => {
    try {
      // Format and send Telegram alert
      const message = formatBundleAlert(alert);
      await telegramService.sendMessage(message, config.telegramChatId);

      // Add to dashboard
      apiServer.addAlert({
        type: 'bundled_wallets',
        title: 'BUNDLED WALLETS',
        description: \\ - \\,
        emoji: alert.severity === 'critical' ? '??' : '??',
        timestamp: Date.now(),
      });

      logger.warn('BundledWalletDetector', \Alert sent: \ - \\);
    } catch (error) {
      logger.error('BundledWalletDetector', 'Error sending bundle alert', error as Error);
    }
  });
}



/**
 * Set up top holder tracker event listeners
 */
function setupTopHolderTrackerListeners(): void {
  topHolderTracker.on('alert', async (alert: HolderChangeAlert) => {
    try {
      // Format and send Telegram alert
      const message = formatHolderChangeAlert(alert);
      await telegramService.sendMessage(message, config.telegramChatId);

      // Add to dashboard
      const emojiMap = {
        whale_accumulation: '????',
        whale_dump: '????',
        new_whale: '??',
        whale_exit: '??',
        rank_change: '??',
      };

      apiServer.addAlert({
        type: 'holder_' + alert.type,
        title: alert.type.toUpperCase().replace('_', ' '),
        description: \\ - \\,
        emoji: emojiMap[alert.type] || '??',
        timestamp: Date.now(),
      });

      logger.info('TopHolderTracker', \Alert sent: \ for \\);
    } catch (error) {
      logger.error('TopHolderTracker', 'Error sending holder change alert', error as Error);
    }
  });
}

