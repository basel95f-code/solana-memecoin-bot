/**
 * Dev Activity Service
 * 
 * Analyzes dev wallet activity to generate devActivityScore
 * for signal generation. Wraps devWalletTracker and provides
 * the specific data format needed by SignalGenerator.
 */

import { logger } from '../utils/logger';
import { toError } from '../utils/errors';
import { cacheManager, CacheKey, CacheTTL } from '../cache';
import { findDevWallet } from '../analysis/devWallet';
import type { TokenInfo } from '../types';

export interface DevActivityData {
  devBuyCount?: number; // Number of dev buy transactions (last 24h)
  devSellCount?: number; // Number of dev sell transactions (last 24h)
  devNetPosition?: number; // Net position change (positive = accumulating)
  devActivityScore: number; // -1 to 1 (negative = selling, positive = buying)
  walletAddresses: string[]; // Tracked dev wallet addresses
}

export class DevActivityService {
  /**
   * Get dev activity data for a token
   */
  async getDevActivity(mint: string, tokenInfo?: TokenInfo): Promise<DevActivityData | null> {
    // Check cache first
    const cached = await cacheManager.get<DevActivityData>(CacheKey.devActivity(mint));
    if (cached) {
      return cached;
    }

    try {
      // Try to identify dev wallet(s)
      let devWallets: string[] = [];
      
      // findDevWallet expects a mint address string
      const devWallet = await findDevWallet(mint);
      if (devWallet) {
        devWallets.push(devWallet);
      }

      if (devWallets.length === 0) {
        logger.debug('DevActivity', `No dev wallets identified for ${mint}`);
        // Return neutral score when no dev wallet tracking
        return {
          devActivityScore: 0,
          walletAddresses: [],
        };
      }

      // In a full implementation, we would:
      // 1. Track all transactions from dev wallets
      // 2. Count buys vs sells in last 24h
      // 3. Calculate net position change
      // 
      // For now, return neutral with wallet addresses
      const activityData: DevActivityData = {
        devActivityScore: 0, // Neutral (no activity data yet)
        walletAddresses: devWallets,
      };

      // Cache for 10 minutes
      await cacheManager.set(CacheKey.devActivity(mint), activityData, CacheTTL.MEDIUM);

      logger.debug('DevActivity', `Dev activity for ${mint}: score=0 (neutral), wallets=${devWallets.length}`);

      return activityData;
    } catch (error) {
      logger.error('DevActivity', `Failed to get dev activity for ${mint}`, toError(error));
      return null;
    }
  }

  /**
   * Track dev wallet transactions (called by wallet monitor)
   */
  async trackDevTransaction(mint: string, walletAddress: string, type: 'buy' | 'sell', amount: number): Promise<void> {
    logger.debug('DevActivity', `Dev ${type} detected for ${mint}: ${walletAddress} - ${amount} tokens`);
    
    // In a full implementation, this would:
    // 1. Store the transaction in a database or in-memory structure
    // 2. Update the running counts (devBuyCount, devSellCount)
    // 3. Recalculate devActivityScore
    // 4. Invalidate cache
    
    // For now, just log it
  }
}

// Export singleton
export const devActivityService = new DevActivityService();

// Add to cache key enum
declare module '../cache' {
  interface CacheKeyExtension {
    devActivity(mint: string): string;
  }
}

// Extend CacheKey
Object.assign(CacheKey, {
  devActivity: (mint: string) => `dev:activity:${mint}`,
});
