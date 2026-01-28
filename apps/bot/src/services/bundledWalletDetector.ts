/**
 * Bundled Wallet Detector
 * 
 * Detects wallets created in the same transaction/block - a common Sybil attack pattern.
 * Also detects coordinated buying from new wallets.
 * 
 * Red flags:
 * - Multiple holders created in same block
 * - Wallets funded by same source at same time
 * - New wallets (< 24h old) holding significant amounts
 */

import { EventEmitter } from 'events';
import { solanaService } from './solana';
import type { HolderInfo } from '../types';
import { logger } from '../utils/logger';
import { getSupabaseClient } from '../database/supabase';

export interface BundledWallet {
  address: string;
  creationSlot: number;
  creationTimestamp: number;
  tokenPercent: number;
  fundingSource?: string;
}

export interface BundleDetectionResult {
  hasBundles: boolean;
  bundles: BundledWallet[][];
  totalBundledPercent: number;
  riskScore: number; // 0-100
  warnings: string[];
  suspicionLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface BundleAlert {
  type: 'same_block_creation' | 'coordinated_funding' | 'new_wallet_concentration';
  severity: 'warning' | 'critical';
  tokenMint: string;
  symbol: string;
  message: string;
  details: {
    bundleCount?: number;
    walletsInBundle?: number;
    totalPercent?: number;
    creationSlot?: number;
    fundingSource?: string;
  };
  timestamp: Date;
}

// Thresholds
const SAME_BLOCK_THRESHOLD = 5; // Slots within this range = same batch
const NEW_WALLET_AGE = 24 * 60 * 60 * 1000; // 24 hours
const SUSPICIOUS_BUNDLE_SIZE = 3; // 3+ wallets = suspicious
const CRITICAL_BUNDLE_PERCENT = 20; // >20% held by bundle = critical

export class BundledWalletDetectorService extends EventEmitter {
  private isRunning = false;
  private checkedTokens: Map<string, number> = new Map(); // tokenMint -> timestamp
  private alertHistory: Map<string, number> = new Map(); // token:type -> timestamp
  private readonly ALERT_COOLDOWN = 3600000; // 1 hour between same alert
  private readonly CHECK_CACHE_TTL = 3600000; // 1 hour

  constructor() {
    super();
  }

  /**
   * Start detector
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    
    logger.info('BundledWalletDetector', 'Starting bundled wallet detector...');
    this.isRunning = true;
    
    // No background polling needed - runs on-demand when tokens are analyzed
    logger.info('BundledWalletDetector', 'Started');
  }

  /**
   * Stop detector
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    logger.info('BundledWalletDetector', 'Stopping bundled wallet detector...');
    this.isRunning = false;
    logger.info('BundledWalletDetector', 'Stopped');
  }

  /**
   * Analyze token holders for bundled wallets
   */
  async analyzeToken(
    tokenMint: string,
    symbol: string,
    holders: HolderInfo[]
  ): Promise<BundleDetectionResult> {
    // Check cache
    const lastCheck = this.checkedTokens.get(tokenMint);
    if (lastCheck && Date.now() - lastCheck < this.CHECK_CACHE_TTL) {
      logger.debug('BundledWalletDetector', `Using cached result for ${symbol}`);
      return this.getDefaultResult();
    }

    const warnings: string[] = [];
    const bundledWallets: BundledWallet[] = [];

    // Analyze top 20 holders
    const holdersToCheck = holders.slice(0, 20);

    for (const holder of holdersToCheck) {
      try {
        const walletInfo = await this.getWalletCreationInfo(holder.address);
        
        if (walletInfo) {
          bundledWallets.push({
            address: holder.address,
            creationSlot: walletInfo.slot,
            creationTimestamp: walletInfo.timestamp,
            tokenPercent: holder.percentage,
            fundingSource: walletInfo.fundingSource,
          });
        }
      } catch (error) {
        logger.silentError('BundledWalletDetector', `Failed to check ${holder.address.slice(0, 8)}`, error as Error);
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Detect bundles (wallets created in same/nearby blocks)
    const bundles = this.findBundles(bundledWallets);
    
    // Calculate total percent in bundles
    const totalBundledPercent = bundles.reduce((sum, bundle) => 
      sum + bundle.reduce((bundleSum, w) => bundleSum + w.tokenPercent, 0), 0
    );

    // Calculate risk score
    let riskScore = 0;

    for (const bundle of bundles) {
      const bundlePercent = bundle.reduce((sum, w) => sum + w.tokenPercent, 0);
      
      if (bundle.length >= SUSPICIOUS_BUNDLE_SIZE) {
        riskScore += 20;
        warnings.push(`${bundle.length} wallets created in same block hold ${bundlePercent.toFixed(1)}%`);
      }

      // Check if all from same funding source
      const fundingSources = new Set(bundle.map(w => w.fundingSource).filter(Boolean));
      if (fundingSources.size === 1) {
        riskScore += 15;
        warnings.push(`Bundle funded by single source`);
      }

      // Check for new wallets holding significant amounts
      const now = Date.now();
      const newWallets = bundle.filter(w => now - w.creationTimestamp < NEW_WALLET_AGE);
      if (newWallets.length >= 3 && bundlePercent > 10) {
        riskScore += 25;
        warnings.push(`${newWallets.length} new wallets (<24h) hold ${bundlePercent.toFixed(1)}%`);
      }
    }

    riskScore = Math.min(100, riskScore);

    const suspicionLevel: 'low' | 'medium' | 'high' | 'critical' =
      riskScore >= 60 ? 'critical' :
      riskScore >= 40 ? 'high' :
      riskScore >= 20 ? 'medium' : 'low';

    const result: BundleDetectionResult = {
      hasBundles: bundles.length > 0,
      bundles,
      totalBundledPercent,
      riskScore,
      warnings,
      suspicionLevel,
    };

    // Cache result
    this.checkedTokens.set(tokenMint, Date.now());

    // Send alerts if suspicious
    if (suspicionLevel === 'critical' || suspicionLevel === 'high') {
      await this.sendAlerts(tokenMint, symbol, result);
    }

    // Save bundle detection results to Supabase
    if (result.hasBundles) {
      await this.saveBundlesToDatabase(tokenMint, result);
    }

    return result;
  }

  /**
   * Get wallet creation info
   */
  private async getWalletCreationInfo(walletAddress: string): Promise<{
    slot: number;
    timestamp: number;
    fundingSource?: string;
  } | null> {
    try {
      const connection = solanaService.getConnection();
      
      // Get wallet's first signature (creation transaction)
      const signatures = await connection.getSignaturesForAddress(
        new (await import('@solana/web3.js')).PublicKey(walletAddress),
        { limit: 1000 }, // Get all to find first one
        'confirmed'
      );

      if (signatures.length === 0) return null;

      // Get the oldest signature (first transaction)
      const firstSig = signatures[signatures.length - 1];
      
      // Get transaction details to find funding source
      let fundingSource: string | undefined;
      
      try {
        const tx = await connection.getParsedTransaction(firstSig.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (tx?.meta?.preBalances && tx?.meta?.postBalances) {
          // Find account that funded this wallet
          const walletIndex = tx.transaction.message.accountKeys.findIndex(
            k => k.pubkey.toBase58() === walletAddress
          );

          if (walletIndex >= 0) {
            const preBal = tx.meta.preBalances[walletIndex];
            const postBal = tx.meta.postBalances[walletIndex];

            // If wallet was funded (went from 0 to positive), find the funder
            if (preBal === 0 && postBal > 0) {
              // Find account that had balance decrease
              for (let i = 0; i < tx.meta.preBalances.length; i++) {
                if (i !== walletIndex && tx.meta.preBalances[i] > tx.meta.postBalances[i]) {
                  fundingSource = tx.transaction.message.accountKeys[i].pubkey.toBase58();
                  break;
                }
              }
            }
          }
        }
      } catch (error) {
        // Failed to get funding source - continue without it
      }

      return {
        slot: firstSig.slot,
        timestamp: (firstSig.blockTime || 0) * 1000,
        fundingSource,
      };
    } catch (error) {
      logger.silentError('BundledWalletDetector', `Failed to get creation info for ${walletAddress.slice(0, 8)}`, error as Error);
      return null;
    }
  }

  /**
   * Find bundles of wallets created in same/nearby blocks
   */
  private findBundles(wallets: BundledWallet[]): BundledWallet[][] {
    if (wallets.length < 2) return [];

    // Sort by creation slot
    const sorted = [...wallets].sort((a, b) => a.creationSlot - b.creationSlot);
    
    const bundles: BundledWallet[][] = [];
    let currentBundle: BundledWallet[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const slotDiff = sorted[i].creationSlot - sorted[i - 1].creationSlot;
      
      if (slotDiff <= SAME_BLOCK_THRESHOLD) {
        // Same bundle
        currentBundle.push(sorted[i]);
      } else {
        // New bundle
        if (currentBundle.length >= 2) {
          bundles.push(currentBundle);
        }
        currentBundle = [sorted[i]];
      }
    }

    // Add last bundle if it has multiple wallets
    if (currentBundle.length >= 2) {
      bundles.push(currentBundle);
    }

    return bundles;
  }

  /**
   * Send alerts for suspicious bundles
   */
  private async sendAlerts(
    tokenMint: string,
    symbol: string,
    result: BundleDetectionResult
  ): Promise<void> {
    for (const bundle of result.bundles) {
      if (bundle.length < SUSPICIOUS_BUNDLE_SIZE) continue;

      const bundlePercent = bundle.reduce((sum, w) => sum + w.tokenPercent, 0);
      const severity: 'warning' | 'critical' = bundlePercent >= CRITICAL_BUNDLE_PERCENT ? 'critical' : 'warning';

      const alert: BundleAlert = {
        type: 'same_block_creation',
        severity,
        tokenMint,
        symbol,
        message: `${bundle.length} wallets created in same block hold ${bundlePercent.toFixed(1)}%`,
        details: {
          bundleCount: result.bundles.length,
          walletsInBundle: bundle.length,
          totalPercent: bundlePercent,
          creationSlot: bundle[0].creationSlot,
          fundingSource: bundle[0].fundingSource,
        },
        timestamp: new Date(),
      };

      if (this.shouldSendAlert(tokenMint, 'same_block_creation')) {
        this.emit('alert', alert);
        this.markAlertSent(tokenMint, 'same_block_creation');
        logger.warn('BundledWalletDetector', `BUNDLED WALLETS: ${symbol} - ${alert.message}`);
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
  private getDefaultResult(): BundleDetectionResult {
    return {
      hasBundles: false,
      bundles: [],
      totalBundledPercent: 0,
      riskScore: 0,
      warnings: [],
      suspicionLevel: 'low',
    };
  }

  /**
   * Save bundle detection results to Supabase
   */
  private async saveBundlesToDatabase(
    tokenMint: string,
    result: BundleDetectionResult
  ): Promise<void> {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        logger.debug('BundledWalletDetector', 'Supabase not configured, skipping database save');
        return;
      }

      // Save each bundle cluster
      for (let i = 0; i < result.bundles.length; i++) {
        const bundle = result.bundles[i];
        const bundlePercent = bundle.reduce((sum, w) => sum + w.tokenPercent, 0);
        
        // Generate cluster ID (combination of token mint and bundle index)
        const clusterId = `${tokenMint.slice(0, 8)}_${bundle[0].creationSlot}_${i}`;
        
        // Find common funder (if all wallets have same funding source)
        const fundingSources = bundle.map(w => w.fundingSource).filter(Boolean);
        const uniqueFunders = [...new Set(fundingSources)];
        const commonFunder = uniqueFunders.length === 1 ? uniqueFunders[0]! : 'MULTIPLE';
        
        // Calculate timing patterns
        const creationTimes = bundle.map(w => w.creationTimestamp).sort((a, b) => a - b);
        const creationTimeSpan = (creationTimes[creationTimes.length - 1] - creationTimes[0]) / 1000; // seconds
        
        const now = Date.now();
        const walletAges = bundle.map(w => (now - w.creationTimestamp) / (1000 * 60 * 60)); // hours
        const avgWalletAge = walletAges.reduce((sum, age) => sum + age, 0) / walletAges.length;
        
        const walletsCreatedWithin1h = bundle.filter(w => now - w.creationTimestamp < 3600000).length;
        
        // Prepare data for insertion
        const bundleData = {
          token_mint: tokenMint,
          cluster_id: clusterId,
          wallets: bundle.map(w => w.address),
          common_funder: commonFunder,
          funder_label: null, // Could be enhanced with CEX detection later
          wallet_count: bundle.length,
          total_holdings: null, // Could be calculated if we have price data
          total_percentage: bundlePercent,
          creation_time_span: Math.floor(creationTimeSpan),
          avg_wallet_age: avgWalletAge,
          wallets_created_within_1h: walletsCreatedWithin1h,
          has_coordinated_buys: false, // Could be enhanced with buy detection
          coordinated_buy_count: 0,
          fastest_coordinated_buy_seconds: null,
          risk_score: result.riskScore,
          is_suspicious: result.suspicionLevel === 'high' || result.suspicionLevel === 'critical',
          suspicion_reasons: result.warnings,
          detected_at: new Date().toISOString(),
        };

        // Upsert bundle flag (update if exists, insert if not)
        const { error } = await supabase
          .from('bundle_flags')
          .upsert(bundleData, {
            onConflict: 'token_mint,cluster_id',
          });

        if (error) {
          logger.error('BundledWalletDetector', `Failed to save bundle to database: ${error.message}`);
        } else {
          logger.info('BundledWalletDetector', `Saved bundle ${clusterId} to database (${bundle.length} wallets, ${bundlePercent.toFixed(1)}%)`);
        }
      }
    } catch (error) {
      logger.silentError('BundledWalletDetector', 'Failed to save bundles to database', error as Error);
    }
  }

  /**
   * Get stats
   */
  getStats(): {
    checkedTokens: number;
    alertHistory: number;
  } {
    return {
      checkedTokens: this.checkedTokens.size,
      alertHistory: this.alertHistory.size,
    };
  }
}

// Singleton export
export const bundledWalletDetector = new BundledWalletDetectorService();
