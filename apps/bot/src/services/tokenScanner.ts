/**
 * Token Scanner Service
 * Scans new tokens with custom filters to find gems
 */

import { database } from '../database';
import { analyzeToken } from '../analysis/tokenAnalyzer';
import { dexScreenerService } from './dexscreener';
import { rugPredictor } from '../ml/rugPredictor';
import { telegramService } from './telegram';
import { logger } from '../utils/logger';

export interface ScanFilter {
  id?: number;
  name: string;
  description: string;
  enabled: boolean;
  
  // Risk filters
  minRiskScore?: number;
  maxRiskScore?: number;
  
  // Liquidity filters
  minLiquidity?: number;
  maxLiquidity?: number;
  
  // Holder filters
  minHolders?: number;
  maxHolders?: number;
  maxTop10Percent?: number;
  
  // Contract filters
  requireMintRevoked?: boolean;
  requireFreezeRevoked?: boolean;
  requireLpBurned?: boolean;
  minLpBurnedPercent?: number;
  
  // Social filters
  requireSocials?: boolean;
  
  // Price/Volume filters
  minPriceChange1h?: number;
  maxPriceChange1h?: number;
  minVolume24h?: number;
  
  // ML filters
  maxRugProbability?: number;
  minMlConfidence?: number;
  
  // Age filters
  minAgeHours?: number;
  maxAgeHours?: number;
  
  // Created
  createdAt?: number;
}

export interface ScanMatch {
  id?: number;
  tokenMint: string;
  symbol: string;
  name: string;
  filterId: number;
  filterName: string;
  riskScore: number;
  liquidityUsd: number;
  holderCount: number;
  rugProbability?: number;
  matchedAt: number;
  alerted: boolean;
}

export interface ScanStats {
  totalScanned: number;
  totalMatches: number;
  activeFilters: number;
  lastScanTime: number;
  matchesByFilter: Record<string, number>;
}

class TokenScanner {
  private scanningActive: boolean = false;
  private scanInterval: NodeJS.Timeout | null = null;
  private readonly SCAN_INTERVAL_MS = 60000; // 1 minute

  /**
   * Start the scanner
   */
  start(): void {
    if (this.scanningActive) {
      logger.warn('TokenScanner', 'Scanner already running');
      return;
    }

    this.scanningActive = true;
    
    // Start scan interval
    this.scanInterval = setInterval(() => {
      this.scanRecentTokens().catch(error => {
        logger.error('TokenScanner', 'Scan failed', error as Error);
      });
    }, this.SCAN_INTERVAL_MS);

    logger.info('TokenScanner', 'Scanner started');
  }

  /**
   * Stop the scanner
   */
  stop(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }

    this.scanningActive = false;
    logger.info('TokenScanner', 'Scanner stopped');
  }

  /**
   * Scan recent tokens from database
   */
  private async scanRecentTokens(): Promise<void> {
    const filters = this.getActiveFilters();
    if (filters.length === 0) {
      return;
    }

    // Get recently analyzed tokens (last 5 minutes)
    const recentTokens = database.all<any>(
      `SELECT * FROM token_analysis 
       WHERE analyzed_at > ? 
       ORDER BY analyzed_at DESC 
       LIMIT 50`,
      [Date.now() - 5 * 60 * 1000]
    );

    if (recentTokens.length === 0) {
      return;
    }

    logger.debug('TokenScanner', `Scanning ${recentTokens.length} recent tokens against ${filters.length} filters`);

    for (const token of recentTokens) {
      for (const filter of filters) {
        const matches = await this.checkFilter(token, filter);
        
        if (matches) {
          // Record match
          this.recordMatch({
            tokenMint: token.mint,
            symbol: token.symbol,
            name: token.name,
            filterId: filter.id!,
            filterName: filter.name,
            riskScore: token.risk_score,
            liquidityUsd: token.liquidity_usd,
            holderCount: token.total_holders,
            rugProbability: token.ml_rug_probability,
            matchedAt: Date.now(),
            alerted: false,
          });

          // Send alert
          await this.sendMatchAlert(token, filter);
        }
      }
    }
  }

  /**
   * Check if a token matches a filter
   */
  private async checkFilter(token: any, filter: ScanFilter): Promise<boolean> {
    // Risk score filters
    if (filter.minRiskScore !== undefined && token.risk_score < filter.minRiskScore) {
      return false;
    }
    if (filter.maxRiskScore !== undefined && token.risk_score > filter.maxRiskScore) {
      return false;
    }

    // Liquidity filters
    if (filter.minLiquidity !== undefined && token.liquidity_usd < filter.minLiquidity) {
      return false;
    }
    if (filter.maxLiquidity !== undefined && token.liquidity_usd > filter.maxLiquidity) {
      return false;
    }

    // Holder filters
    if (filter.minHolders !== undefined && token.total_holders < filter.minHolders) {
      return false;
    }
    if (filter.maxHolders !== undefined && token.total_holders > filter.maxHolders) {
      return false;
    }
    if (filter.maxTop10Percent !== undefined && token.top10_percent > filter.maxTop10Percent) {
      return false;
    }

    // Contract filters
    if (filter.requireMintRevoked && !token.mint_revoked) {
      return false;
    }
    if (filter.requireFreezeRevoked && !token.freeze_revoked) {
      return false;
    }
    if (filter.minLpBurnedPercent !== undefined && token.lp_burned_percent < filter.minLpBurnedPercent) {
      return false;
    }

    // Social filters
    if (filter.requireSocials && !token.has_twitter && !token.has_telegram && !token.has_website) {
      return false;
    }

    // ML filters
    if (filter.maxRugProbability !== undefined && token.ml_rug_probability > filter.maxRugProbability) {
      return false;
    }
    if (filter.minMlConfidence !== undefined && token.ml_confidence < filter.minMlConfidence) {
      return false;
    }

    // Price/Volume filters (requires live data)
    if (filter.minPriceChange1h !== undefined || filter.maxPriceChange1h !== undefined || filter.minVolume24h !== undefined) {
      try {
        const pairData = await dexScreenerService.getTokenData(token.mint);
        if (pairData) {
          if (filter.minPriceChange1h !== undefined && (pairData.priceChange?.h1 || 0) < filter.minPriceChange1h) {
            return false;
          }
          if (filter.maxPriceChange1h !== undefined && (pairData.priceChange?.h1 || 0) > filter.maxPriceChange1h) {
            return false;
          }
          if (filter.minVolume24h !== undefined && (pairData.volume?.h24 || 0) < filter.minVolume24h) {
            return false;
          }
        }
      } catch (error) {
        // If we can't get price data, skip these filters
      }
    }

    // Age filters
    if (filter.minAgeHours !== undefined || filter.maxAgeHours !== undefined) {
      const ageHours = (Date.now() - token.analyzed_at) / (1000 * 60 * 60);
      if (filter.minAgeHours !== undefined && ageHours < filter.minAgeHours) {
        return false;
      }
      if (filter.maxAgeHours !== undefined && ageHours > filter.maxAgeHours) {
        return false;
      }
    }

    // All filters passed!
    return true;
  }

  /**
   * Send match alert via Telegram
   */
  private async sendMatchAlert(token: any, filter: ScanFilter): Promise<void> {
    const message = 
      `🎯 <b>Filter Match: ${filter.name}</b>\n\n` +
      `Token: <b>${token.symbol}</b>\n` +
      `Risk Score: <b>${token.risk_score}/100</b>\n` +
      `Liquidity: $${token.liquidity_usd.toLocaleString()}\n` +
      `Holders: ${token.total_holders}\n` +
      `${token.ml_rug_probability ? `Rug Risk: ${(token.ml_rug_probability * 100).toFixed(0)}%\n` : ''}` +
      `\nMint: <code>${token.mint}</code>`;

    try {
      await telegramService.sendMessage(message);
      
      // Mark as alerted
      database.run(
        'UPDATE scan_matches SET alerted = 1 WHERE token_mint = ? AND filter_id = ?',
        [token.mint, filter.id]
      );
    } catch (error) {
      logger.error('TokenScanner', 'Failed to send match alert', error as Error);
    }
  }

  /**
   * Add a new filter
   */
  addFilter(filter: ScanFilter): number {
    const result = database.run(
      `INSERT INTO scan_filters (
        name, description, enabled,
        min_risk_score, max_risk_score,
        min_liquidity, max_liquidity,
        min_holders, max_holders, max_top10_percent,
        require_mint_revoked, require_freeze_revoked, require_lp_burned, min_lp_burned_percent,
        require_socials,
        min_price_change_1h, max_price_change_1h, min_volume_24h,
        max_rug_probability, min_ml_confidence,
        min_age_hours, max_age_hours,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        filter.name,
        filter.description,
        filter.enabled ? 1 : 0,
        filter.minRiskScore,
        filter.maxRiskScore,
        filter.minLiquidity,
        filter.maxLiquidity,
        filter.minHolders,
        filter.maxHolders,
        filter.maxTop10Percent,
        filter.requireMintRevoked ? 1 : 0,
        filter.requireFreezeRevoked ? 1 : 0,
        filter.requireLpBurned ? 1 : 0,
        filter.minLpBurnedPercent,
        filter.requireSocials ? 1 : 0,
        filter.minPriceChange1h,
        filter.maxPriceChange1h,
        filter.minVolume24h,
        filter.maxRugProbability,
        filter.minMlConfidence,
        filter.minAgeHours,
        filter.maxAgeHours,
        Date.now(),
      ]
    );

    logger.info('TokenScanner', `Added filter: ${filter.name}`);
    return result.lastID;
  }

  /**
   * Update a filter
   */
  updateFilter(id: number, updates: Partial<ScanFilter>): void {
    const setClauses: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      setClauses.push(`${snakeKey} = ?`);
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }

    if (setClauses.length === 0) return;

    values.push(id);
    database.run(
      `UPDATE scan_filters SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );

    logger.info('TokenScanner', `Updated filter ${id}`);
  }

  /**
   * Delete a filter
   */
  deleteFilter(id: number): void {
    database.run('DELETE FROM scan_filters WHERE id = ?', [id]);
    logger.info('TokenScanner', `Deleted filter ${id}`);
  }

  /**
   * Get all filters
   */
  getAllFilters(): ScanFilter[] {
    const rows = database.all<any>('SELECT * FROM scan_filters ORDER BY name');
    return rows.map(row => this.mapFilter(row));
  }

  /**
   * Get active filters only
   */
  getActiveFilters(): ScanFilter[] {
    const rows = database.all<any>('SELECT * FROM scan_filters WHERE enabled = 1');
    return rows.map(row => this.mapFilter(row));
  }

  /**
   * Record a match
   */
  private recordMatch(match: ScanMatch): void {
    database.run(
      `INSERT OR IGNORE INTO scan_matches (
        token_mint, symbol, name, filter_id, filter_name,
        risk_score, liquidity_usd, holder_count, rug_probability,
        matched_at, alerted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        match.tokenMint,
        match.symbol,
        match.name,
        match.filterId,
        match.filterName,
        match.riskScore,
        match.liquidityUsd,
        match.holderCount,
        match.rugProbability,
        match.matchedAt,
        match.alerted ? 1 : 0,
      ]
    );
  }

  /**
   * Get recent matches
   */
  getRecentMatches(limit: number = 50): ScanMatch[] {
    const rows = database.all<any>(
      'SELECT * FROM scan_matches ORDER BY matched_at DESC LIMIT ?',
      [limit]
    );

    return rows.map(row => this.mapMatch(row));
  }

  /**
   * Get scanner stats
   */
  getStats(): ScanStats {
    const totalScanned = database.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM token_analysis'
    )?.count || 0;

    const totalMatches = database.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM scan_matches'
    )?.count || 0;

    const activeFilters = database.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM scan_filters WHERE enabled = 1'
    )?.count || 0;

    const lastScanTime = database.get<{ max_time: number }>(
      'SELECT MAX(matched_at) as max_time FROM scan_matches'
    )?.max_time || 0;

    // Matches by filter
    const filterMatches = database.all<{ filter_name: string; count: number }>(
      'SELECT filter_name, COUNT(*) as count FROM scan_matches GROUP BY filter_name'
    );

    const matchesByFilter: Record<string, number> = {};
    for (const row of filterMatches) {
      matchesByFilter[row.filter_name] = row.count;
    }

    return {
      totalScanned,
      totalMatches,
      activeFilters,
      lastScanTime,
      matchesByFilter,
    };
  }

  /**
   * Create preset filters
   */
  createPresetFilters(): void {
    // Gem Finder
    this.addFilter({
      name: 'Gem Finder',
      description: 'Safe tokens with growth potential',
      enabled: true,
      minRiskScore: 60,
      minLiquidity: 50000,
      minHolders: 100,
      maxTop10Percent: 40,
      requireMintRevoked: true,
      requireFreezeRevoked: true,
      minLpBurnedPercent: 50,
      requireSocials: true,
      maxRugProbability: 0.3,
      maxAgeHours: 24, // New tokens only
    });

    // Safe Haven
    this.addFilter({
      name: 'Safe Haven',
      description: 'Maximum safety, low risk',
      enabled: false,
      minRiskScore: 80,
      minLiquidity: 100000,
      minHolders: 200,
      maxTop10Percent: 30,
      requireMintRevoked: true,
      requireFreezeRevoked: true,
      minLpBurnedPercent: 90,
      requireSocials: true,
      maxRugProbability: 0.15,
    });

    // Moonshot
    this.addFilter({
      name: 'Moonshot',
      description: 'High risk, high reward',
      enabled: false,
      minRiskScore: 40,
      minLiquidity: 10000,
      minPriceChange1h: 20, // At least 20% up in 1h
      minVolume24h: 50000,
      maxAgeHours: 6, // Very new
    });

    logger.info('TokenScanner', 'Created preset filters');
  }

  /**
   * Map database row to ScanFilter
   */
  private mapFilter(row: any): ScanFilter {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      enabled: row.enabled === 1,
      minRiskScore: row.min_risk_score,
      maxRiskScore: row.max_risk_score,
      minLiquidity: row.min_liquidity,
      maxLiquidity: row.max_liquidity,
      minHolders: row.min_holders,
      maxHolders: row.max_holders,
      maxTop10Percent: row.max_top10_percent,
      requireMintRevoked: row.require_mint_revoked === 1,
      requireFreezeRevoked: row.require_freeze_revoked === 1,
      requireLpBurned: row.require_lp_burned === 1,
      minLpBurnedPercent: row.min_lp_burned_percent,
      requireSocials: row.require_socials === 1,
      minPriceChange1h: row.min_price_change_1h,
      maxPriceChange1h: row.max_price_change_1h,
      minVolume24h: row.min_volume_24h,
      maxRugProbability: row.max_rug_probability,
      minMlConfidence: row.min_ml_confidence,
      minAgeHours: row.min_age_hours,
      maxAgeHours: row.max_age_hours,
      createdAt: row.created_at,
    };
  }

  /**
   * Map database row to ScanMatch
   */
  private mapMatch(row: any): ScanMatch {
    return {
      id: row.id,
      tokenMint: row.token_mint,
      symbol: row.symbol,
      name: row.name,
      filterId: row.filter_id,
      filterName: row.filter_name,
      riskScore: row.risk_score,
      liquidityUsd: row.liquidity_usd,
      holderCount: row.holder_count,
      rugProbability: row.rug_probability,
      matchedAt: row.matched_at,
      alerted: row.alerted === 1,
    };
  }
}

// Export singleton
export const tokenScanner = new TokenScanner();
