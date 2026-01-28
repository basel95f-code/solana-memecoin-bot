/**
 * Common Top Traders Analysis
 * Finds wallets appearing as top holders in multiple tokens
 * Detects coordinated trading groups / pump groups
 */

import { logger } from '../utils/logger';
import { analyzeHolders } from './holderAnalysis';
import type { HolderInfo } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface CommonTrader {
  wallet: string;
  tokensInCommon: number;
  percentageInToken1: number;
  percentageInToken2: number;
  rankInToken1: number;
  rankInToken2: number;
  totalInvested: number; // USD (estimated)
  isWhale: boolean; // >5% in either token
}

export interface CommonTradersAnalysis {
  token1: string;
  token2: string;
  commonTraders: CommonTrader[];
  overlapPercent: number; // % of top holders in common
  totalCommonHoldings: number; // Combined % they control
  isPumpGroup: boolean; // High overlap suggests coordination
  warnings: string[];
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

/**
 * Find common top traders between two tokens
 */
export async function findCommonTraders(
  token1: string,
  token2: string,
  topN: number = 50
): Promise<CommonTradersAnalysis> {
  logger.info('CommonTraders', `Analyzing overlap between ${token1.slice(0, 8)} and ${token2.slice(0, 8)}`);

  try {
    // Step 1: Get holders for both tokens
    // Create minimal TokenInfo objects for analyzeHolders
    const tokenInfo1 = { mint: token1, supply: 0 } as any;
    const tokenInfo2 = { mint: token2, supply: 0 } as any;
    
    const [holders1, holders2] = await Promise.all([
      analyzeHolders(tokenInfo1),
      analyzeHolders(tokenInfo2),
    ]);

    if (!holders1?.topHolders || !holders2?.topHolders) {
      throw new Error('Failed to fetch holder data for one or both tokens');
    }

    // Step 2: Find common wallets
    const topHolders1 = holders1.topHolders.slice(0, topN);
    const topHolders2 = holders2.topHolders.slice(0, topN);

    const commonTraders = findOverlap(topHolders1, topHolders2);

    // Step 3: Calculate statistics
    const overlapPercent = (commonTraders.length / topN) * 100;
    const totalCommonHoldings =
      commonTraders.reduce((sum, t) => sum + t.percentageInToken1, 0) +
      commonTraders.reduce((sum, t) => sum + t.percentageInToken2, 0);

    // Step 4: Assess if it's a pump group
    const isPumpGroup = overlapPercent > 20 && commonTraders.length >= 5;

    // Step 5: Generate warnings
    const warnings: string[] = [];

    if (isPumpGroup) {
      warnings.push(`🚨 High overlap detected (${overlapPercent.toFixed(1)}%) - possible coordinated group`);
    } else if (overlapPercent > 10) {
      warnings.push(`⚠️ Moderate overlap (${overlapPercent.toFixed(1)}%) - some common traders`);
    } else if (overlapPercent < 5) {
      warnings.push(`✅ Low overlap (${overlapPercent.toFixed(1)}%) - mostly independent holders`);
    }

    const whales = commonTraders.filter(t => t.isWhale);
    if (whales.length > 0) {
      warnings.push(`⚠️ ${whales.length} whale(s) hold large positions in both tokens`);
    }

    logger.info('CommonTraders', `Found ${commonTraders.length} common traders (${overlapPercent.toFixed(1)}% overlap)`);

    return {
      token1,
      token2,
      commonTraders,
      overlapPercent,
      totalCommonHoldings,
      isPumpGroup,
      warnings,
    };
  } catch (error) {
    logger.error('CommonTraders', `Failed to analyze common traders:`, error as Error);
    throw error;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Find wallets that appear in both holder lists
 */
function findOverlap(holders1: HolderInfo[], holders2: HolderInfo[]): CommonTrader[] {
  const commonTraders: CommonTrader[] = [];

  // Create lookup map for holders2
  const holders2Map = new Map<string, HolderInfo>();
  holders2.forEach((h, index) => {
    holders2Map.set(h.address, h);
  });

  // Find wallets in both lists
  holders1.forEach((h1, index1) => {
    const h2 = holders2Map.get(h1.address);

    if (h2) {
      const isWhale = h1.percentage > 5 || h2.percentage > 5;
      const estimatedInvested = 0; // Would need token prices

      commonTraders.push({
        wallet: h1.address,
        tokensInCommon: 2,
        percentageInToken1: h1.percentage,
        percentageInToken2: h2.percentage,
        rankInToken1: index1 + 1,
        rankInToken2: holders2.findIndex(h => h.address === h2.address) + 1,
        totalInvested: estimatedInvested,
        isWhale,
      });
    }
  });

  // Sort by combined percentage (highest influence first)
  commonTraders.sort((a, b) => {
    const aTotal = a.percentageInToken1 + a.percentageInToken2;
    const bTotal = b.percentageInToken1 + b.percentageInToken2;
    return bTotal - aTotal;
  });

  return commonTraders;
}

// ============================================================================
// MULTI-TOKEN ANALYSIS
// ============================================================================

/**
 * Find wallets common across multiple tokens (pump group detection)
 */
export async function findPumpGroup(
  tokens: string[]
): Promise<{
  groupWallets: string[];
  tokensInCommon: Record<string, number>; // wallet -> token count
  avgOverlap: number;
  isPumpGroup: boolean;
}> {
  if (tokens.length < 2) {
    throw new Error('Need at least 2 tokens to analyze');
  }

  try {
    // Get holders for all tokens
    // Create minimal TokenInfo objects
    const tokenInfos = tokens.map(mint => ({ mint, supply: 0 } as any));
    
    const allHolders = await Promise.all(
      tokenInfos.map(tokenInfo => analyzeHolders(tokenInfo))
    );

    // Count how many tokens each wallet appears in
    const walletCounts = new Map<string, number>();

    allHolders.forEach(holderData => {
      if (!holderData?.topHolders) return;

      const top50 = holderData.topHolders.slice(0, 50);
      top50.forEach(holder => {
        walletCounts.set(holder.address, (walletCounts.get(holder.address) || 0) + 1);
      });
    });

    // Find wallets in 50%+ of tokens
    const threshold = Math.ceil(tokens.length * 0.5);
    const groupWallets = Array.from(walletCounts.entries())
      .filter(([_, count]) => count >= threshold)
      .map(([wallet, _]) => wallet);

    // Calculate average overlap
    const avgOverlap = groupWallets.length > 0
      ? (groupWallets.length / 50) * 100
      : 0;

    const isPumpGroup = groupWallets.length >= 5 && avgOverlap > 15;

    const tokensInCommon: Record<string, number> = {};
    walletCounts.forEach((count, wallet) => {
      if (count >= 2) {
        tokensInCommon[wallet] = count;
      }
    });

    return {
      groupWallets,
      tokensInCommon,
      avgOverlap,
      isPumpGroup,
    };
  } catch (error) {
    logger.error('CommonTraders', 'Failed to analyze pump group:', error as Error);
    throw error;
  }
}
