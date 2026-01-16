import { dexScreenerService } from './dexscreener';
import { gmgnService } from './gmgn';
import type { TrendingToken, SmartMoneyActivity } from '../types';

interface AggregatedTokenData {
  mint: string;
  symbol: string;
  name: string;
  // Price data (prefer DexScreener for accuracy)
  priceUsd: number;
  priceChange1h: number;
  priceChange24h: number;
  // Volume data
  volume1h: number;
  volume24h: number;
  // Liquidity
  liquidity: number;
  marketCap?: number;
  // Transaction data
  txns24h: {
    buys: number;
    sells: number;
  };
  buySellRatio: number;
  // Smart money data from GMGN
  smartMoney?: SmartMoneyActivity;
  // Token age
  createdAt?: number;
  ageMinutes?: number;
  // Safety signals
  isVerified?: boolean;
  isRenounced?: boolean;
  isHoneypot?: boolean;
  // Holder data
  holderCount?: number;
  // Sources
  sources: ('dexscreener' | 'gmgn')[];
  // Pair info
  pairAddress?: string;
  dexId?: string;
}

interface DiscoveryResult {
  token: AggregatedTokenData;
  score: number; // Discovery score based on various factors
  signals: string[]; // Human-readable signals
}

class DataAggregator {
  /**
   * Get comprehensive token data from all sources
   */
  async getTokenData(tokenAddress: string): Promise<AggregatedTokenData | null> {
    // Fetch from both sources in parallel
    const [dexData, gmgnData] = await Promise.all([
      dexScreenerService.getTokenData(tokenAddress).catch(() => null),
      gmgnService.getTokenInfo(tokenAddress).catch(() => null),
    ]);

    if (!dexData && !gmgnData) return null;

    const sources: ('dexscreener' | 'gmgn')[] = [];
    if (dexData) sources.push('dexscreener');
    if (gmgnData) sources.push('gmgn');

    const now = Date.now();
    const createdAt = dexData?.pairCreatedAt || (gmgnData?.open_timestamp ? gmgnData.open_timestamp * 1000 : undefined);
    const ageMinutes = createdAt ? Math.floor((now - createdAt) / 60000) : undefined;

    // Calculate buy/sell ratio
    const buys = dexData?.txns?.h24?.buys || gmgnData?.buys || 0;
    const sells = dexData?.txns?.h24?.sells || gmgnData?.sells || 0;
    const buySellRatio = sells > 0 ? buys / sells : buys > 0 ? 10 : 1;

    // Extract smart money activity if available from GMGN
    const smartMoney = gmgnData ? gmgnService.extractSmartMoneyActivity(gmgnData) : undefined;

    return {
      mint: tokenAddress,
      symbol: dexData?.baseToken?.symbol || gmgnData?.symbol || 'UNKNOWN',
      name: dexData?.baseToken?.name || gmgnData?.name || 'Unknown',
      // Prefer DexScreener for price (more accurate)
      priceUsd: parseFloat(dexData?.priceUsd || '0') || gmgnData?.price || 0,
      priceChange1h: dexData?.priceChange?.h1 || gmgnData?.price_change_1h || 0,
      priceChange24h: dexData?.priceChange?.h24 || gmgnData?.price_change_24h || 0,
      volume1h: dexData?.volume?.h1 || 0,
      volume24h: dexData?.volume?.h24 || gmgnData?.volume_24h || 0,
      liquidity: dexData?.liquidity?.usd || gmgnData?.liquidity || 0,
      marketCap: dexData?.marketCap || gmgnData?.market_cap,
      txns24h: {
        buys,
        sells,
      },
      buySellRatio,
      smartMoney,
      createdAt,
      ageMinutes,
      isVerified: gmgnData?.is_verified,
      isRenounced: gmgnData?.is_renounced,
      isHoneypot: gmgnData?.is_honeypot,
      holderCount: gmgnData?.holder_count,
      sources,
      pairAddress: dexData?.pairAddress || gmgnData?.pool_address,
      dexId: dexData?.dexId || gmgnData?.dex,
    };
  }

  /**
   * Discover trending tokens combining DexScreener and GMGN data
   */
  async discoverTrending(limit: number = 20): Promise<DiscoveryResult[]> {
    // Fetch from both sources in parallel
    const [dexTrending, gmgnTrending] = await Promise.all([
      dexScreenerService.getTrendingTokens(limit).catch(() => []),
      gmgnService.getTrendingUnified(limit).catch(() => []),
    ]);

    // Merge and deduplicate by mint address
    const tokenMap = new Map<string, TrendingToken & { sources: string[] }>();

    for (const token of dexTrending) {
      tokenMap.set(token.mint, { ...token, sources: ['dexscreener'] });
    }

    for (const token of gmgnTrending) {
      if (tokenMap.has(token.mint)) {
        // Merge data - token appears in both sources (good signal)
        const existing = tokenMap.get(token.mint)!;
        existing.sources.push('gmgn');
      } else {
        tokenMap.set(token.mint, { ...token, sources: ['gmgn'] });
      }
    }

    // Convert to discovery results with scoring
    const results: DiscoveryResult[] = [];

    for (const [mint] of tokenMap) {
      const aggregated = await this.getTokenData(mint);
      if (!aggregated) continue;

      const { score, signals } = this.calculateDiscoveryScore(aggregated);

      results.push({
        token: aggregated,
        score,
        signals,
      });
    }

    // Sort by score and return top results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Discover new tokens (recently created)
   */
  async discoverNew(maxAgeMinutes: number = 60, limit: number = 20): Promise<DiscoveryResult[]> {
    const [dexNew, gmgnNewRaw] = await Promise.all([
      dexScreenerService.getNewTokens(Math.ceil(maxAgeMinutes / 60), limit).catch(() => []),
      gmgnService.getNewTokens('1h', limit).catch(() => []),
    ]);

    // Convert GMGN tokens to TrendingToken format
    const gmgnNew = gmgnNewRaw.map(t => gmgnService.toTrendingToken(t));

    const tokenMap = new Map<string, TrendingToken>();

    // Merge results
    for (const token of [...dexNew, ...gmgnNew]) {
      if (!tokenMap.has(token.mint)) {
        tokenMap.set(token.mint, token);
      }
    }

    const results: DiscoveryResult[] = [];

    for (const [mint] of tokenMap) {
      const aggregated = await this.getTokenData(mint);
      if (!aggregated) continue;

      // Filter by age
      if (aggregated.ageMinutes && aggregated.ageMinutes > maxAgeMinutes) continue;

      const { score, signals } = this.calculateDiscoveryScore(aggregated);
      results.push({ token: aggregated, score, signals });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Discover smart money picks
   */
  async discoverSmartMoney(limit: number = 15): Promise<DiscoveryResult[]> {
    const smartMoneyTokens = await gmgnService.getSmartMoneyPicks(limit * 2).catch(() => []);

    const results: DiscoveryResult[] = [];

    for (const token of smartMoneyTokens) {
      const aggregated = await this.getTokenData(token.mint);
      if (!aggregated) continue;

      // Add smart money data
      aggregated.smartMoney = token.smartMoney;

      const { score, signals } = this.calculateDiscoveryScore(aggregated);

      // Boost score for smart money picks
      const boostedScore = score + (token.smartMoney.netSmartMoney * 5);

      results.push({
        token: aggregated,
        score: boostedScore,
        signals: [...signals, `Smart money net: +${token.smartMoney.netSmartMoney} buys`],
      });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Get top volume movers
   */
  async discoverVolumeLeaders(limit: number = 15): Promise<DiscoveryResult[]> {
    const [dexVolume, gmgnVolume] = await Promise.all([
      dexScreenerService.getVolumeLeaders(limit).catch(() => []),
      gmgnService.getHighVolume('24h', limit).catch(() => []),
    ]);

    const tokenMap = new Map<string, TrendingToken>();

    for (const token of [...dexVolume]) {
      tokenMap.set(token.mint, token);
    }

    for (const gmgnToken of gmgnVolume) {
      const converted = gmgnService.toTrendingToken(gmgnToken);
      if (!tokenMap.has(converted.mint)) {
        tokenMap.set(converted.mint, converted);
      }
    }

    const results: DiscoveryResult[] = [];

    for (const [mint] of tokenMap) {
      const aggregated = await this.getTokenData(mint);
      if (!aggregated) continue;

      const { score, signals } = this.calculateDiscoveryScore(aggregated);
      results.push({ token: aggregated, score, signals });
    }

    return results
      .sort((a, b) => (b.token.volume24h || 0) - (a.token.volume24h || 0))
      .slice(0, limit);
  }

  /**
   * Calculate a discovery score based on various factors
   */
  private calculateDiscoveryScore(token: AggregatedTokenData): { score: number; signals: string[] } {
    let score = 50; // Base score
    const signals: string[] = [];

    // Liquidity score (0-20 points)
    if (token.liquidity >= 50000) {
      score += 20;
      signals.push('High liquidity');
    } else if (token.liquidity >= 10000) {
      score += 15;
      signals.push('Good liquidity');
    } else if (token.liquidity >= 2000) {
      score += 10;
    } else if (token.liquidity < 1000) {
      score -= 10;
      signals.push('Low liquidity warning');
    }

    // Buy/sell pressure (0-15 points)
    if (token.buySellRatio >= 2) {
      score += 15;
      signals.push('Strong buy pressure');
    } else if (token.buySellRatio >= 1.5) {
      score += 10;
      signals.push('Buy pressure');
    } else if (token.buySellRatio < 0.7) {
      score -= 10;
      signals.push('Sell pressure warning');
    }

    // Smart money activity (0-20 points)
    if (token.smartMoney) {
      if (token.smartMoney.isSmartMoneyBullish) {
        score += 20;
        signals.push('Smart money accumulating');
      }
      if (token.smartMoney.netSmartMoney >= 5) {
        score += 10;
        signals.push(`${token.smartMoney.netSmartMoney} net smart buys`);
      }
    }

    // Safety signals (0-15 points)
    if (token.isRenounced) {
      score += 10;
      signals.push('Contract renounced');
    }
    if (token.isVerified) {
      score += 5;
      signals.push('Verified');
    }
    if (token.isHoneypot) {
      score -= 50;
      signals.push('HONEYPOT DETECTED');
    }

    // Holder count (0-10 points)
    if (token.holderCount) {
      if (token.holderCount >= 500) {
        score += 10;
        signals.push('Many holders');
      } else if (token.holderCount >= 100) {
        score += 5;
      } else if (token.holderCount < 20) {
        score -= 5;
        signals.push('Few holders');
      }
    }

    // Token age (newness can be good or bad)
    if (token.ageMinutes !== undefined) {
      if (token.ageMinutes < 5) {
        signals.push('Just launched');
      } else if (token.ageMinutes < 30) {
        score += 5;
        signals.push('New token');
      } else if (token.ageMinutes < 120) {
        score += 3;
      }
    }

    // Volume activity
    if (token.volume24h > 100000) {
      score += 10;
      signals.push('High volume');
    } else if (token.volume24h > 10000) {
      score += 5;
    }

    // Price momentum
    if (token.priceChange1h > 20) {
      score += 5;
      signals.push('Pumping');
    } else if (token.priceChange1h < -30) {
      score -= 5;
      signals.push('Dumping');
    }

    // Multi-source bonus
    if (token.sources.length > 1) {
      score += 5;
      signals.push('Multi-source verified');
    }

    return { score: Math.max(0, Math.min(100, score)), signals };
  }

  /**
   * Health check for all data sources
   */
  async healthCheck(): Promise<{ dexscreener: boolean; gmgn: boolean }> {
    const [dexOk, gmgnOk] = await Promise.all([
      dexScreenerService.getTokenPairs('So11111111111111111111111111111111111111112')
        .then(pairs => pairs.length > 0)
        .catch(() => false),
      gmgnService.healthCheck().catch(() => false),
    ]);

    return { dexscreener: dexOk, gmgn: gmgnOk };
  }
}

export const dataAggregator = new DataAggregator();
