/**
 * Twitter Reuse Detector
 * 
 * Detects when the same Twitter account is used for multiple tokens.
 * Common scam pattern: rugger creates new token, reuses same Twitter/social accounts.
 * 
 * Red flags:
 * - Twitter account previously linked to rugged token
 * - Very new Twitter account (<7 days)
 * - Account linked to 3+ tokens
 */

import { EventEmitter } from 'events';
import { getSupabaseClient } from '../database/supabase';
import { logger } from '../utils/logger';

export interface TwitterTokenLink {
  tokenMint: string;
  twitterHandle: string;
  accountCreatedAt?: Date;
  accountAgeDays?: number;
  wasRugged: boolean;
  rugDate?: Date;
}

export interface TwitterReuseResult {
  isReused: boolean;
  twitterHandle: string;
  previousTokens: TwitterTokenLink[];
  ruggedCount: number;
  totalTokens: number;
  riskScore: number; // 0-100
  warnings: string[];
  suspicionLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface TwitterReuseAlert {
  type: 'twitter_reuse' | 'twitter_rugged_history' | 'fresh_twitter';
  severity: 'warning' | 'critical';
  tokenMint: string;
  symbol: string;
  twitterHandle: string;
  message: string;
  details: {
    previousTokens?: number;
    ruggedCount?: number;
    accountAgeDays?: number;
  };
  timestamp: Date;
}

// Thresholds
const FRESH_TWITTER_THRESHOLD = 7; // Days
const REUSE_THRESHOLD = 2; // Alert if Twitter used for 2+ tokens
const CRITICAL_RUG_COUNT = 1; // Alert if any previous token was rugged

export class TwitterReuseDetectorService extends EventEmitter {
  private isRunning = false;
  private alertHistory: Map<string, number> = new Map(); // token:type -> timestamp
  private readonly ALERT_COOLDOWN = 3600000; // 1 hour

  constructor() {
    super();
  }

  /**
   * Start detector
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    
    logger.info('TwitterReuseDetector', 'Starting Twitter reuse detector...');
    this.isRunning = true;
    logger.info('TwitterReuseDetector', 'Started');
  }

  /**
   * Stop detector
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    logger.info('TwitterReuseDetector', 'Stopping Twitter reuse detector...');
    this.isRunning = false;
    logger.info('TwitterReuseDetector', 'Stopped');
  }

  /**
   * Check if a Twitter handle has been used for other tokens
   */
  async checkTwitterReuse(
    tokenMint: string,
    symbol: string,
    twitterHandle: string,
    twitterAccountCreatedAt?: Date
  ): Promise<TwitterReuseResult> {
    const warnings: string[] = [];
    let riskScore = 0;

    // Normalize Twitter handle (remove @, lowercase)
    const normalizedHandle = this.normalizeTwitterHandle(twitterHandle);

    if (!normalizedHandle) {
      return this.getDefaultResult(twitterHandle);
    }

    // Save this token-Twitter link to database
    await this.saveTwitterTokenLink(tokenMint, normalizedHandle, twitterAccountCreatedAt);

    // Get previous tokens using this Twitter handle
    const previousTokens = await this.getPreviousTokensForTwitter(normalizedHandle, tokenMint);

    const ruggedCount = previousTokens.filter(t => t.wasRugged).length;
    const totalTokens = previousTokens.length + 1; // +1 for current token

    // Calculate account age
    let accountAgeDays: number | undefined;
    if (twitterAccountCreatedAt) {
      const ageMs = Date.now() - twitterAccountCreatedAt.getTime();
      accountAgeDays = ageMs / (1000 * 60 * 60 * 24);
    }

    // Risk assessment

    // Fresh Twitter account (<7 days)
    if (accountAgeDays !== undefined && accountAgeDays < FRESH_TWITTER_THRESHOLD) {
      riskScore += 30;
      warnings.push(`Twitter account is only ${accountAgeDays.toFixed(0)} days old`);
    }

    // Twitter reused for multiple tokens
    if (previousTokens.length >= REUSE_THRESHOLD) {
      riskScore += 25;
      warnings.push(`Twitter account used for ${totalTokens} tokens`);
    }

    // Previous rugged tokens
    if (ruggedCount > 0) {
      riskScore += 40;
      warnings.push(`Twitter linked to ${ruggedCount} rugged token(s)`);
    }

    riskScore = Math.min(100, riskScore);

    const suspicionLevel: 'low' | 'medium' | 'high' | 'critical' =
      riskScore >= 70 ? 'critical' :
      riskScore >= 50 ? 'high' :
      riskScore >= 30 ? 'medium' : 'low';

    const result: TwitterReuseResult = {
      isReused: previousTokens.length > 0,
      twitterHandle: normalizedHandle,
      previousTokens,
      ruggedCount,
      totalTokens,
      riskScore,
      warnings,
      suspicionLevel,
    };

    // Send alerts if suspicious
    if (suspicionLevel === 'critical' || suspicionLevel === 'high') {
      await this.sendAlerts(tokenMint, symbol, result, accountAgeDays);
    }

    return result;
  }

  /**
   * Mark a token as rugged (updates database)
   */
  async markTokenAsRugged(tokenMint: string): Promise<void> {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        logger.debug('TwitterReuseDetector', 'Supabase not configured');
        return;
      }

      const { error } = await supabase
        .from('twitter_token_history')
        .update({
          was_rugged: true,
          rug_date: new Date().toISOString(),
        })
        .eq('token_mint', tokenMint);

      if (error) {
        logger.error('TwitterReuseDetector', `Failed to mark token as rugged: ${error.message}`);
      } else {
        logger.info('TwitterReuseDetector', `Marked ${tokenMint.slice(0, 8)} as rugged in database`);
      }
    } catch (error) {
      logger.silentError('TwitterReuseDetector', 'Failed to mark token as rugged', error as Error);
    }
  }

  /**
   * Save Twitter-token link to database
   */
  private async saveTwitterTokenLink(
    tokenMint: string,
    twitterHandle: string,
    accountCreatedAt?: Date
  ): Promise<void> {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        logger.debug('TwitterReuseDetector', 'Supabase not configured, skipping database save');
        return;
      }

      let accountAgeDays: number | undefined;
      if (accountCreatedAt) {
        const ageMs = Date.now() - accountCreatedAt.getTime();
        accountAgeDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
      }

      const data = {
        token_mint: tokenMint,
        twitter_handle: twitterHandle,
        account_created_at: accountCreatedAt?.toISOString() || null,
        account_age_days: accountAgeDays || null,
        was_rugged: false,
        observed_at: new Date().toISOString(),
      };

      // Upsert (update if exists, insert if not)
      const { error } = await supabase
        .from('twitter_token_history')
        .upsert(data, {
          onConflict: 'token_mint,twitter_handle',
        });

      if (error) {
        logger.error('TwitterReuseDetector', `Failed to save Twitter link: ${error.message}`);
      } else {
        logger.info('TwitterReuseDetector', `Saved Twitter link: ${twitterHandle} → ${tokenMint.slice(0, 8)}`);
      }
    } catch (error) {
      logger.silentError('TwitterReuseDetector', 'Failed to save Twitter link', error as Error);
    }
  }

  /**
   * Get previous tokens that used this Twitter handle
   */
  private async getPreviousTokensForTwitter(
    twitterHandle: string,
    excludeTokenMint: string
  ): Promise<TwitterTokenLink[]> {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        return [];
      }

      const { data, error } = await supabase
        .from('twitter_token_history')
        .select('*')
        .eq('twitter_handle', twitterHandle)
        .neq('token_mint', excludeTokenMint)
        .order('observed_at', { ascending: false });

      if (error) {
        logger.error('TwitterReuseDetector', `Failed to get previous tokens: ${error.message}`);
        return [];
      }

      return (data || []).map(row => ({
        tokenMint: row.token_mint,
        twitterHandle: row.twitter_handle,
        accountCreatedAt: row.account_created_at ? new Date(row.account_created_at) : undefined,
        accountAgeDays: row.account_age_days || undefined,
        wasRugged: row.was_rugged || false,
        rugDate: row.rug_date ? new Date(row.rug_date) : undefined,
      }));
    } catch (error) {
      logger.silentError('TwitterReuseDetector', 'Failed to get previous tokens', error as Error);
      return [];
    }
  }

  /**
   * Normalize Twitter handle
   */
  private normalizeTwitterHandle(handle: string): string {
    if (!handle) return '';
    
    // Remove @ prefix, whitespace, convert to lowercase
    return handle.trim().replace(/^@/, '').toLowerCase();
  }

  /**
   * Send alerts for suspicious Twitter reuse
   */
  private async sendAlerts(
    tokenMint: string,
    symbol: string,
    result: TwitterReuseResult,
    accountAgeDays?: number
  ): Promise<void> {
    // Alert for rugged history
    if (result.ruggedCount > 0) {
      const alert: TwitterReuseAlert = {
        type: 'twitter_rugged_history',
        severity: 'critical',
        tokenMint,
        symbol,
        twitterHandle: result.twitterHandle,
        message: `Twitter @${result.twitterHandle} linked to ${result.ruggedCount} rugged token(s)`,
        details: {
          previousTokens: result.previousTokens.length,
          ruggedCount: result.ruggedCount,
        },
        timestamp: new Date(),
      };

      if (this.shouldSendAlert(tokenMint, 'twitter_rugged_history')) {
        this.emit('alert', alert);
        this.markAlertSent(tokenMint, 'twitter_rugged_history');
        logger.warn('TwitterReuseDetector', `RUGGED HISTORY: ${symbol} - ${alert.message}`);
      }
    }

    // Alert for Twitter reuse
    if (result.previousTokens.length >= REUSE_THRESHOLD) {
      const alert: TwitterReuseAlert = {
        type: 'twitter_reuse',
        severity: 'warning',
        tokenMint,
        symbol,
        twitterHandle: result.twitterHandle,
        message: `Twitter @${result.twitterHandle} used for ${result.totalTokens} tokens`,
        details: {
          previousTokens: result.previousTokens.length,
          ruggedCount: result.ruggedCount,
        },
        timestamp: new Date(),
      };

      if (this.shouldSendAlert(tokenMint, 'twitter_reuse')) {
        this.emit('alert', alert);
        this.markAlertSent(tokenMint, 'twitter_reuse');
        logger.warn('TwitterReuseDetector', `TWITTER REUSE: ${symbol} - ${alert.message}`);
      }
    }

    // Alert for fresh Twitter
    if (accountAgeDays !== undefined && accountAgeDays < FRESH_TWITTER_THRESHOLD) {
      const alert: TwitterReuseAlert = {
        type: 'fresh_twitter',
        severity: 'warning',
        tokenMint,
        symbol,
        twitterHandle: result.twitterHandle,
        message: `Twitter account is only ${accountAgeDays.toFixed(0)} days old`,
        details: {
          accountAgeDays: Math.floor(accountAgeDays),
        },
        timestamp: new Date(),
      };

      if (this.shouldSendAlert(tokenMint, 'fresh_twitter')) {
        this.emit('alert', alert);
        this.markAlertSent(tokenMint, 'fresh_twitter');
        logger.warn('TwitterReuseDetector', `FRESH TWITTER: ${symbol} - ${alert.message}`);
      }
    }
  }

  /**
   * Check if alert should be sent (cooldown check)
   */
  private shouldSendAlert(tokenMint: string, alertType: string): boolean {
    const key = `${tokenMint}:${alertType}`;
    const lastAlert = this.alertHistory.get(key);
    
    if (!lastAlert) return true;
    
    const timeSince = Date.now() - lastAlert;
    return timeSince > this.ALERT_COOLDOWN;
  }

  /**
   * Mark alert as sent
   */
  private markAlertSent(tokenMint: string, alertType: string): void {
    const key = `${tokenMint}:${alertType}`;
    this.alertHistory.set(key, Date.now());
  }

  /**
   * Get default result
   */
  private getDefaultResult(twitterHandle: string): TwitterReuseResult {
    return {
      isReused: false,
      twitterHandle,
      previousTokens: [],
      ruggedCount: 0,
      totalTokens: 1,
      riskScore: 0,
      warnings: [],
      suspicionLevel: 'low',
    };
  }

  /**
   * Get stats
   */
  getStats(): {
    alertHistory: number;
  } {
    return {
      alertHistory: this.alertHistory.size,
    };
  }
}

// Singleton export
export const twitterReuseDetector = new TwitterReuseDetectorService();
