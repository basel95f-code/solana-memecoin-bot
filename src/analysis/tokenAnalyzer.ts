import { solanaService } from '../services/solana';
import { rugCheckService } from '../services/rugcheck';
import { tokenCache } from '../services/cache';
import { analyzeLiquidity } from './liquidityCheck';
import { analyzeHolders } from './holderAnalysis';
import { analyzeContract } from './contractCheck';
import { analyzeSocials } from './socialCheck';
import { classifyRisk } from '../risk/classifier';
import { TokenAnalysis, PoolInfo, TokenInfo, LiquidityAnalysis, HolderAnalysis, ContractAnalysis, SocialAnalysis, RugCheckResult } from '../types';
import { config } from '../config';

// Track in-flight analysis requests to prevent duplicates
const pendingAnalysis = new Map<string, Promise<TokenAnalysis | null>>();

// Analysis timeout (30 seconds)
const ANALYSIS_TIMEOUT = 30000;

/**
 * Wrap a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

export async function analyzeToken(
  tokenMint: string,
  pool: PoolInfo
): Promise<TokenAnalysis | null> {
  // Check if analysis is already in progress for this token (deduplication)
  const existing = pendingAnalysis.get(tokenMint);
  if (existing) {
    console.log(`Analysis already in progress for ${tokenMint}, waiting...`);
    return existing;
  }

  // Create the analysis promise
  const analysisPromise = performAnalysis(tokenMint, pool);

  // Store in pending map
  pendingAnalysis.set(tokenMint, analysisPromise);

  try {
    const result = await analysisPromise;
    return result;
  } finally {
    // Clean up pending map
    pendingAnalysis.delete(tokenMint);
  }
}

async function performAnalysis(
  tokenMint: string,
  pool: PoolInfo
): Promise<TokenAnalysis | null> {
  try {
    // Check if already analyzed recently
    if (tokenCache.has(tokenMint)) {
      const cached = tokenCache.get(tokenMint);
      if (cached?.lastAnalysis) {
        console.log(`Using cached analysis for ${tokenMint}`);
        return cached.lastAnalysis;
      }
    }

    console.log(`Analyzing token: ${tokenMint}`);

    // Get token info with timeout
    const tokenInfo = await withTimeout(
      solanaService.getTokenInfo(tokenMint),
      10000,
      null
    );

    if (!tokenInfo) {
      console.error(`Failed to get token info for ${tokenMint}`);
      return null;
    }

    // Run all analyses in parallel with individual timeouts
    const [liquidity, holders, contract, social, rugcheck] = await Promise.all([
      withTimeout(analyzeLiquidity(pool), 15000, getDefaultLiquidity()),
      withTimeout(analyzeHolders(tokenInfo), 15000, getDefaultHolders()),
      withTimeout(analyzeContract(tokenMint), 15000, getDefaultContract()),
      withTimeout(analyzeSocials(tokenInfo.metadata), 10000, getDefaultSocial()),
      withTimeout(rugCheckService.getTokenReport(tokenMint), 10000, null),
    ]);

    // Classify risk based on all analyses
    const risk = classifyRisk({
      liquidity,
      holders,
      contract,
      social,
      rugcheck: rugcheck || undefined,
    });

    const analysis: TokenAnalysis = {
      token: tokenInfo,
      pool,
      liquidity,
      holders,
      contract,
      social,
      rugcheck: rugcheck || undefined,
      risk,
      analyzedAt: new Date(),
    };

    // Cache the analysis
    tokenCache.add(tokenMint);
    tokenCache.updateAnalysis(tokenMint, analysis);

    console.log(
      `Analysis complete for ${tokenInfo.symbol}: Risk ${risk.level} (${risk.score}/100)`
    );

    return analysis;
  } catch (error) {
    console.error(`Error analyzing token ${tokenMint}:`, error);
    return null;
  }
}

export function shouldAlert(analysis: TokenAnalysis): boolean {
  // Check if we've already sent an alert for this token
  if (tokenCache.wasAlertSent(analysis.token.mint)) {
    return false;
  }

  // Check minimum liquidity threshold
  if (analysis.liquidity.totalLiquidityUsd < config.minLiquidityUsd) {
    console.log(
      `Skipping alert for ${analysis.token.symbol}: Liquidity $${analysis.liquidity.totalLiquidityUsd} < $${config.minLiquidityUsd}`
    );
    return false;
  }

  // Check minimum risk score (filter out extreme risk if configured)
  if (analysis.risk.score < config.minRiskScore) {
    console.log(
      `Skipping alert for ${analysis.token.symbol}: Risk score ${analysis.risk.score} < ${config.minRiskScore}`
    );
    return false;
  }

  return true;
}

export async function quickAnalysis(tokenMint: string): Promise<{
  safe: boolean;
  reason?: string;
} | null> {
  try {
    // Quick checks without full analysis
    const contract = await analyzeContract(tokenMint);

    if (contract.isHoneypot) {
      return { safe: false, reason: 'Honeypot detected' };
    }

    if (!contract.mintAuthorityRevoked) {
      return { safe: false, reason: 'Mint authority not revoked' };
    }

    if (!contract.freezeAuthorityRevoked) {
      return { safe: false, reason: 'Freeze authority not revoked' };
    }

    return { safe: true };
  } catch (error) {
    console.error(`Quick analysis failed for ${tokenMint}:`, error);
    return null;
  }
}

export function formatAnalysisSummary(analysis: TokenAnalysis): string {
  const { token, liquidity, holders, contract, risk } = analysis;

  const lines = [
    `${token.name} ($${token.symbol})`,
    `Risk: ${risk.level} (${risk.score}/100)`,
    `Liquidity: $${liquidity.totalLiquidityUsd.toLocaleString()}`,
    `LP Burned: ${liquidity.lpBurned ? 'Yes' : 'No'}`,
    `Holders: ${holders.totalHolders}`,
    `Top 10: ${holders.top10HoldersPercent.toFixed(1)}%`,
    `Mint Revoked: ${contract.mintAuthorityRevoked ? 'Yes' : 'No'}`,
    `Freeze Revoked: ${contract.freezeAuthorityRevoked ? 'Yes' : 'No'}`,
  ];

  return lines.join('\n');
}

// Default fallback values when analysis times out
function getDefaultLiquidity(): LiquidityAnalysis {
  return {
    totalLiquidityUsd: 0,
    lpBurned: false,
    lpBurnedPercent: 0,
    lpLocked: false,
    lpLockedPercent: 0,
  };
}

function getDefaultHolders(): HolderAnalysis {
  return {
    totalHolders: 0,
    top10HoldersPercent: 100,
    top20HoldersPercent: 100,
    largestHolderPercent: 100,
    whaleAddresses: [],
    devWalletPercent: 0,
    isConcentrated: true,
    topHolders: [],
  };
}

function getDefaultContract(): ContractAnalysis {
  return {
    mintAuthorityRevoked: false,
    freezeAuthorityRevoked: false,
    mintAuthority: null,
    freezeAuthority: null,
    isHoneypot: false,
    hasTransferFee: false,
  };
}

function getDefaultSocial(): SocialAnalysis {
  return {
    hasTwitter: false,
    hasTelegram: false,
    hasWebsite: false,
  };
}
