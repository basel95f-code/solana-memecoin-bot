/**
 * Dev Wallet Analysis
 * Identifies and analyzes the token deployer/dev wallet
 */

import { PublicKey } from '@solana/web3.js';
import { solanaService } from '../services/solana';
import { logger } from '../utils/logger';
import type { HolderInfo } from '../types';

export interface DevWalletAnalysis {
  isDevIdentified: boolean;
  devAddress?: string;
  devHoldingPercent: number;
  devSolBalance: number;
  hasPreminedTokens: boolean;
  preminedPercent: number;
  sellHistory: {
    totalSold: number;
    sellCount: number;
    lastSoldAt?: Date;
    percentSold: number;
  };
  walletAge?: number; // Age in days
  isActiveTrader: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'unknown';
  riskReasons: string[];
}

/**
 * Analyze the developer wallet for a token
 */
export async function analyzeDevWallet(
  tokenMint: string,
  topHolders: HolderInfo[]
): Promise<DevWalletAnalysis> {
  const result: DevWalletAnalysis = {
    isDevIdentified: false,
    devHoldingPercent: 0,
    devSolBalance: 0,
    hasPreminedTokens: false,
    preminedPercent: 0,
    sellHistory: {
      totalSold: 0,
      sellCount: 0,
      percentSold: 0,
    },
    isActiveTrader: false,
    riskLevel: 'unknown',
    riskReasons: [],
  };

  try {
    const connection = solanaService.getConnection();
    const _mintPubkey = new PublicKey(tokenMint); // Validated for format

    // Find the wallet that received the first token mint
    const devAddress = await findDevWallet(tokenMint);

    if (!devAddress) {
      result.riskReasons.push('Could not identify dev wallet');
      return result;
    }

    result.isDevIdentified = true;
    result.devAddress = devAddress;

    // Check if dev is in top holders
    const devInTopHolders = topHolders.find(h => h.address === devAddress);

    if (devInTopHolders) {
      result.devHoldingPercent = devInTopHolders.percentage;
      result.hasPreminedTokens = devInTopHolders.percentage > 5;
      result.preminedPercent = devInTopHolders.percentage;
    }

    // Get dev's current SOL balance
    try {
      const devPubkey = new PublicKey(devAddress);
      const balance = await connection.getBalance(devPubkey);
      result.devSolBalance = balance / 1e9; // Convert lamports to SOL
    } catch {
      // Balance check failed
    }

    // Analyze dev's sell history
    const sellHistory = await analyzeDevSellHistory(tokenMint, devAddress);
    result.sellHistory = sellHistory;

    // Check if dev is active trader (multiple recent transactions)
    result.isActiveTrader = await checkIfActiveTrader(devAddress);

    // Calculate risk level
    const riskResult = calculateDevRisk(result);
    result.riskLevel = riskResult.level;
    result.riskReasons = riskResult.reasons;

    logger.debug('DevWallet', `Dev ${devAddress.slice(0, 8)}...: ${result.devHoldingPercent.toFixed(1)}% holdings, risk=${result.riskLevel}`);
  } catch (error) {
    logger.error('DevWallet', 'Analysis failed', error as Error);
    result.riskReasons.push('Analysis failed');
  }

  return result;
}

/**
 * Find the original dev wallet by tracing the first token mint
 */
export async function findDevWallet(tokenMint: string): Promise<string | null> {
  try {
    const connection = solanaService.getConnection();
    const mintPubkey = new PublicKey(tokenMint);

    // Get signatures for the mint account
    const signatures = await connection.getSignaturesForAddress(mintPubkey, { limit: 50 });

    if (signatures.length === 0) return null;

    // Get the oldest transaction (likely the mint creation)
    const oldestSig = signatures[signatures.length - 1];
    const tx = await connection.getParsedTransaction(oldestSig.signature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx?.meta?.postTokenBalances) return null;

    // Find the first account that received tokens
    for (const balance of tx.meta.postTokenBalances) {
      if (
        balance.mint === tokenMint &&
        balance.uiTokenAmount &&
        balance.uiTokenAmount.uiAmount &&
        balance.uiTokenAmount.uiAmount > 0
      ) {
        return balance.owner || null;
      }
    }

    // Fallback: use the transaction signer
    const accountKeys = tx.transaction.message.accountKeys;
    if (accountKeys.length > 0) {
      const firstAccount = accountKeys[0] as any;
      const address = firstAccount.pubkey ? firstAccount.pubkey.toBase58() : firstAccount.toBase58();
      return address;
    }

    return null;
  } catch (error) {
    logger.silentError('DevWallet', 'Failed to find dev wallet', error as Error);
    return null;
  }
}

/**
 * Analyze the dev's sell history for this token
 */
export async function analyzeDevSellHistory(
  tokenMint: string,
  devAddress: string
): Promise<{
  totalSold: number;
  sellCount: number;
  lastSoldAt?: Date;
  percentSold: number;
}> {
  const result = {
    totalSold: 0,
    sellCount: 0,
    lastSoldAt: undefined as Date | undefined,
    percentSold: 0,
  };

  try {
    const connection = solanaService.getConnection();
    const devPubkey = new PublicKey(devAddress);

    // Get recent signatures for the dev wallet
    const signatures = await connection.getSignaturesForAddress(devPubkey, { limit: 100 });

    let totalReceived = 0;

    for (const sig of signatures.slice(0, 30)) { // Check last 30 transactions
      try {
        const tx = await connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx?.meta) continue;

        const preBalances = tx.meta.preTokenBalances || [];
        const postBalances = tx.meta.postTokenBalances || [];

        // Find token balance changes for this token
        const preBalance = preBalances.find(
          b => b.mint === tokenMint && b.owner === devAddress
        );
        const postBalance = postBalances.find(
          b => b.mint === tokenMint && b.owner === devAddress
        );

        const preBal = preBalance?.uiTokenAmount?.uiAmount || 0;
        const postBal = postBalance?.uiTokenAmount?.uiAmount || 0;

        if (preBal > postBal) {
          // Dev sold tokens
          const soldAmount = preBal - postBal;
          result.totalSold += soldAmount;
          result.sellCount++;

          if (!result.lastSoldAt && sig.blockTime) {
            result.lastSoldAt = new Date(sig.blockTime * 1000);
          }
        } else if (postBal > preBal) {
          // Dev received tokens
          totalReceived += (postBal - preBal);
        }
      } catch {
        continue;
      }
    }

    // Calculate percent sold
    if (totalReceived > 0) {
      result.percentSold = (result.totalSold / totalReceived) * 100;
    }
  } catch (error) {
    logger.silentError('DevWallet', 'Failed to analyze sell history', error as Error);
  }

  return result;
}

/**
 * Check if the wallet is an active trader
 */
async function checkIfActiveTrader(address: string): Promise<boolean> {
  try {
    const connection = solanaService.getConnection();
    const pubkey = new PublicKey(address);

    // Get recent signatures
    const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 20 });

    if (signatures.length < 5) return false;

    // Check if there are transactions in the last 24 hours
    const oneDayAgo = Date.now() / 1000 - 86400;
    const recentTxCount = signatures.filter(
      s => s.blockTime && s.blockTime > oneDayAgo
    ).length;

    return recentTxCount >= 3;
  } catch {
    return false;
  }
}

/**
 * Calculate risk level based on dev wallet analysis
 */
function calculateDevRisk(analysis: DevWalletAnalysis): {
  level: 'low' | 'medium' | 'high' | 'unknown';
  reasons: string[];
} {
  const reasons: string[] = [];

  if (!analysis.isDevIdentified) {
    return { level: 'unknown', reasons: ['Dev wallet not identified'] };
  }

  // High risk factors
  if (analysis.devHoldingPercent > 20) {
    reasons.push(`Dev holds ${analysis.devHoldingPercent.toFixed(1)}% of supply`);
  }

  if (analysis.sellHistory.percentSold > 50) {
    reasons.push(`Dev has sold ${analysis.sellHistory.percentSold.toFixed(0)}% of their tokens`);
  }

  if (analysis.sellHistory.sellCount > 5) {
    reasons.push(`Dev has made ${analysis.sellHistory.sellCount} sell transactions`);
  }

  // Medium risk factors
  if (analysis.devSolBalance < 0.5) {
    reasons.push('Dev has low SOL balance (may need to sell tokens)');
  }

  if (analysis.hasPreminedTokens && analysis.preminedPercent > 10) {
    reasons.push(`Large premine detected: ${analysis.preminedPercent.toFixed(1)}%`);
  }

  // Calculate final risk level
  let riskScore = 0;

  if (analysis.devHoldingPercent > 30) riskScore += 3;
  else if (analysis.devHoldingPercent > 20) riskScore += 2;
  else if (analysis.devHoldingPercent > 10) riskScore += 1;

  if (analysis.sellHistory.percentSold > 50) riskScore += 3;
  else if (analysis.sellHistory.percentSold > 25) riskScore += 2;
  else if (analysis.sellHistory.percentSold > 10) riskScore += 1;

  if (analysis.sellHistory.sellCount > 5) riskScore += 2;

  if (analysis.devSolBalance < 0.5) riskScore += 1;

  let level: 'low' | 'medium' | 'high';
  if (riskScore >= 5) {
    level = 'high';
  } else if (riskScore >= 2) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { level, reasons };
}

/**
 * Quick dev wallet check without deep analysis
 */
export async function quickDevCheck(
  tokenMint: string,
  topHolders: HolderInfo[]
): Promise<{
  devHoldingPercent: number;
  isHighRisk: boolean;
  reason?: string;
}> {
  // Simple check: largest holder is often the dev
  if (topHolders.length === 0) {
    return { devHoldingPercent: 0, isHighRisk: false };
  }

  const largestHolder = topHolders[0];

  // If largest holder has > 30%, consider high risk
  if (largestHolder.percentage > 30) {
    return {
      devHoldingPercent: largestHolder.percentage,
      isHighRisk: true,
      reason: `Largest holder (likely dev) owns ${largestHolder.percentage.toFixed(1)}%`,
    };
  }

  return {
    devHoldingPercent: largestHolder.percentage,
    isHighRisk: false,
  };
}
