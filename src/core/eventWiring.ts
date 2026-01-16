/**
 * Event wiring - connects monitors and services via event listeners
 */

import { config } from '../config';
import { telegramService } from '../services/telegram';
import { storageService } from '../services/storage';
import { advancedMonitor, AdvancedAlert } from '../services/advancedMonitor';
import { walletMonitorService } from '../services/walletMonitor';
import { raydiumMonitor } from '../monitors/raydium';
import { pumpFunMonitor } from '../monitors/pumpfun';
import { jupiterMonitor } from '../monitors/jupiter';
import { apiServer } from '../api/server';
import { formatAdvancedAlert } from '../telegram/commands/advanced';
import { PoolInfo, WalletActivityAlert } from '../types';
import { logger } from '../utils/logger';
import { queueProcessor } from './queueProcessor';
import { shouldSendAdvancedAlert } from './alertFilter';

/**
 * Set up all event listeners for monitors and services
 */
export function setupEventListeners(): void {
  setupMonitorListeners();
  setupAdvancedMonitorListeners();
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
    queueProcessor.queueAnalysis(pool);
  });

  // Pump.fun new pool events
  pumpFunMonitor.on('newPool', (pool: PoolInfo) => {
    queueProcessor.queueAnalysis(pool);
  });

  // Jupiter new token events
  jupiterMonitor.on('newPool', (pool: PoolInfo) => {
    queueProcessor.queueAnalysis(pool);
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
