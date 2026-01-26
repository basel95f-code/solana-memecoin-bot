/**
 * Alert filtering logic - determines whether a token analysis should trigger an alert
 */

import { storageService } from '../services/storage';
import type { TokenAnalysis} from '../types';
import { DEFAULT_CATEGORY_PRIORITIES } from '../types';

/**
 * Determine if a token analysis should trigger an alert based on user settings
 */
export function shouldAlert(analysis: TokenAnalysis, chatId: string): boolean {
  // Get user's filter settings
  const settings = storageService.getUserSettings(chatId);
  const filters = settings.filters;

  // Check if alerts are enabled
  if (!filters.alertsEnabled) {
    return false;
  }

  // Check if currently in quiet hours
  if (storageService.isQuietHours(chatId)) {
    return false;
  }

  // Check if new_token category is enabled
  if (filters.alertCategories && !filters.alertCategories.new_token) {
    return false;
  }

  // Check priority level for new_token alerts
  const alertPriority = DEFAULT_CATEGORY_PRIORITIES.new_token;
  if (!storageService.shouldAlertForPriority(chatId, alertPriority)) {
    return false;
  }

  // Check if token is blacklisted
  if (storageService.isTokenBlacklisted(chatId, analysis.token.mint)) {
    return false;
  }

  // Check liquidity threshold
  if (analysis.liquidity.totalLiquidityUsd < filters.minLiquidity) {
    return false;
  }

  // Check holder concentration
  if (analysis.holders.top10HoldersPercent > filters.maxTop10Percent) {
    return false;
  }

  // Check holder count
  if (analysis.holders.totalHolders < filters.minHolders) {
    return false;
  }

  // Check risk score
  if (analysis.risk.score < filters.minRiskScore) {
    return false;
  }

  // Check token age (if available)
  if (filters.minTokenAge > 0) {
    const tokenAge = analysis.pool.createdAt
      ? (Date.now() - new Date(analysis.pool.createdAt).getTime()) / 1000
      : 0;
    if (tokenAge > 0 && tokenAge < filters.minTokenAge) {
      return false;
    }
  }

  // Check requirement filters
  if (filters.requireMintRevoked && !analysis.contract.mintAuthorityRevoked) {
    return false;
  }

  if (filters.requireFreezeRevoked && !analysis.contract.freezeAuthorityRevoked) {
    return false;
  }

  if (filters.requireLPBurned && !analysis.liquidity.lpBurned) {
    return false;
  }

  if (filters.requireSocials) {
    const hasSocials = analysis.social.hasTwitter ||
                      analysis.social.hasTelegram ||
                      analysis.social.hasWebsite;
    if (!hasSocials) {
      return false;
    }
  }

  // Smart money filters
  if (filters.requireSmartMoney && !analysis.smartMoney) {
    // Require smart money data but none available
    return false;
  }

  if (analysis.smartMoney) {
    // Check minimum smart money buys
    if (filters.minSmartBuys !== undefined && analysis.smartMoney.smartBuys24h < filters.minSmartBuys) {
      return false;
    }

    // Check minimum smart money flow (net buys - sells)
    if (filters.minSmartFlow !== undefined && analysis.smartMoney.netSmartMoney < filters.minSmartFlow) {
      return false;
    }

    // If requireSmartMoney is true, ensure it's actually bullish
    if (filters.requireSmartMoney && !analysis.smartMoney.isSmartMoneyBullish) {
      return false;
    }
  }

  return true;
}

/**
 * Check if an advanced alert should be sent based on user settings
 */
export function shouldSendAdvancedAlert(
  alertType: string,
  tokenMint: string,
  chatId: string
): boolean {
  const settings = storageService.getUserSettings(chatId);
  const categories = settings.filters.alertCategories;

  // Check if alerts are enabled
  if (!settings.filters.alertsEnabled) {
    return false;
  }

  // Check if in quiet hours
  if (storageService.isQuietHours(chatId)) {
    return false;
  }

  // Check if token is blacklisted
  if (storageService.isTokenBlacklisted(chatId, tokenMint)) {
    return false;
  }

  if (categories) {
    // Map alert types to categories
    const categoryMap: Record<string, keyof typeof categories> = {
      'volume_spike': 'volume_spike',
      'whale_movement': 'whale_movement',
      'liquidity_drain': 'liquidity_drain',
      'authority_change': 'authority_change',
    };

    const category = categoryMap[alertType];
    if (category && !categories[category]) {
      return false;
    }

    // Check priority level
    if (category) {
      const alertPriority = DEFAULT_CATEGORY_PRIORITIES[category as keyof typeof DEFAULT_CATEGORY_PRIORITIES];
      if (!storageService.shouldAlertForPriority(chatId, alertPriority)) {
        return false;
      }
    }
  }

  return true;
}
