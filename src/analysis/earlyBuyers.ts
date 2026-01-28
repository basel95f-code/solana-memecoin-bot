/**
 * Early Buyers Analysis - Pump.fun Token Insiders
 * Identifies wallets that bought in the first transactions
 */

import { PublicKey, Connection } from '@solana/web3.js';
import { solanaService } from '../services/solana';
import { logger } from '../utils/logger';

// ============================================================================
// TYPES
// ============================================================================

export interface EarlyBuyer {
  wallet: string;
  buyRank: number; // 1st, 2nd, 3rd buyer
  buyAmount: number; // Tokens bought
  buyTimestamp: Date;
  buyPrice: number; // Price per token in USD
  currentHoldings: number; // Current token balance
  percentSold: number; // % of original buy that was sold
  profitLoss: number; // Current P&L in USD
  profitLossPercent: number; // P&L percentage
  isInsider: boolean; // Bought in first 5 transactions
  hasExited: boolean; // Sold 100%
}

export interface EarlyBuyersAnalysis {
  tokenMint: string;
  earlyBuyers: EarlyBuyer[];
  insiderCount: number; // Bought in first 5 txs
  exitedInsiders: number; // Insiders who sold 100%
  avgInsiderProfit: number; // Average profit % for insiders
  totalEarlyBuyVolume: number; // Total USD volume from early buyers
  warnings: string[];
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

/**
 * Get early buyers for a token
 */
export async function getEarlyBuyers(
  tokenMint: string,
  limit: number = 20
): Promise<EarlyBuyersAnalysis> {
  logger.info('EarlyBuyers', `Analyzing early buyers for ${tokenMint.slice(0, 8)}...`);

  try {
    // Step 1: Get first transactions
    const firstBuyers = await findFirstBuyers(tokenMint, limit);

    if (firstBuyers.length === 0) {
      return {
        tokenMint,
        earlyBuyers: [],
        insiderCount: 0,
        exitedInsiders: 0,
        avgInsiderProfit: 0,
        totalEarlyBuyVolume: 0,
        warnings: ['Unable to fetch early transaction data'],
      };
    }

    // Step 2: Get current holdings for each early buyer
    const earlyBuyers = await Promise.all(
      firstBuyers.map(async (buyer, index) => {
        const currentHoldings = await getCurrentHoldings(buyer.wallet, tokenMint);
        const percentSold = buyer.buyAmount > 0
          ? ((buyer.buyAmount - currentHoldings) / buyer.buyAmount) * 100
          : 0;

        // Calculate P&L (simplified - would need current price)
        const profitLoss = 0; // TODO: Calculate with current price
        const profitLossPercent = 0;

        return {
          wallet: buyer.wallet,
          buyRank: index + 1,
          buyAmount: buyer.buyAmount,
          buyTimestamp: buyer.buyTimestamp,
          buyPrice: buyer.buyPrice,
          currentHoldings,
          percentSold,
          profitLoss,
          profitLossPercent,
          isInsider: index < 5, // First 5 buyers are insiders
          hasExited: percentSold >= 99,
        };
      })
    );

    // Step 3: Calculate statistics
    const insiderCount = earlyBuyers.filter(b => b.isInsider).length;
    const exitedInsiders = earlyBuyers.filter(b => b.isInsider && b.hasExited).length;
    const totalEarlyBuyVolume = earlyBuyers.reduce((sum, b) => sum + (b.buyAmount * b.buyPrice), 0);

    // Calculate average insider profit
    const insiders = earlyBuyers.filter(b => b.isInsider);
    const avgInsiderProfit = insiders.length > 0
      ? insiders.reduce((sum, b) => sum + b.profitLossPercent, 0) / insiders.length
      : 0;

    // Generate warnings
    const warnings: string[] = [];

    if (exitedInsiders > 0) {
      warnings.push(`⚠️ ${exitedInsiders}/${insiderCount} early insiders already exited`);
    }

    if (exitedInsiders >= 3) {
      warnings.push('🚨 Multiple insiders dumped - high risk');
    }

    const holdingInsiders = insiders.filter(b => !b.hasExited).length;
    if (holdingInsiders === insiderCount && insiderCount >= 3) {
      warnings.push('✅ All early insiders still holding');
    }

    logger.info('EarlyBuyers', `Found ${earlyBuyers.length} early buyers, ${insiderCount} insiders, ${exitedInsiders} exited`);

    return {
      tokenMint,
      earlyBuyers,
      insiderCount,
      exitedInsiders,
      avgInsiderProfit,
      totalEarlyBuyVolume,
      warnings,
    };
  } catch (error) {
    logger.error('EarlyBuyers', `Failed to analyze early buyers:`, error as Error);
    throw error;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

interface FirstBuyer {
  wallet: string;
  buyAmount: number;
  buyTimestamp: Date;
  buyPrice: number;
  txSignature: string;
}

/**
 * Find the first buyers of a token
 */
async function findFirstBuyers(tokenMint: string, limit: number): Promise<FirstBuyer[]> {
  try {
    const connection = solanaService.getConnection();
    const mintPubkey = new PublicKey(tokenMint);

    // Get signatures for the token mint account
    const signatures = await connection.getSignaturesForAddress(mintPubkey, {
      limit: Math.min(limit * 5, 200), // Get extra to filter for buys
    });

    if (signatures.length === 0) return [];

    const firstBuyers: FirstBuyer[] = [];
    const seenWallets = new Set<string>();

    // Process from oldest to newest
    const oldestFirst = signatures.reverse();

    for (const sig of oldestFirst) {
      if (firstBuyers.length >= limit) break;

      try {
        const tx = await connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx?.meta || !sig.blockTime) continue;

        // Look for token transfers (buys)
        const tokenTransfers = tx.meta.preTokenBalances && tx.meta.postTokenBalances
          ? findTokenBuys(tx.meta.preTokenBalances, tx.meta.postTokenBalances, tokenMint)
          : [];

        for (const transfer of tokenTransfers) {
          if (seenWallets.has(transfer.wallet)) continue;
          if (firstBuyers.length >= limit) break;

          seenWallets.add(transfer.wallet);

          firstBuyers.push({
            wallet: transfer.wallet,
            buyAmount: transfer.amount,
            buyTimestamp: new Date(sig.blockTime * 1000),
            buyPrice: transfer.price,
            txSignature: sig.signature,
          });
        }
      } catch {
        continue;
      }
    }

    return firstBuyers;
  } catch (error) {
    logger.silentError('EarlyBuyers', 'Failed to find first buyers', error as Error);
    return [];
  }
}

/**
 * Find token buys in a transaction
 */
function findTokenBuys(
  preBalances: any[],
  postBalances: any[],
  tokenMint: string
): Array<{ wallet: string; amount: number; price: number }> {
  const buys: Array<{ wallet: string; amount: number; price: number }> = [];

  // Match pre and post balances by account index
  for (let i = 0; i < preBalances.length; i++) {
    const pre = preBalances[i];
    const post = postBalances.find((p: any) => p.accountIndex === pre.accountIndex);

    if (!post) continue;

    // Check if this is our token
    if (pre.mint !== tokenMint && post.mint !== tokenMint) continue;

    const preAmount = parseFloat(pre.uiTokenAmount?.uiAmountString || '0');
    const postAmount = parseFloat(post.uiTokenAmount?.uiAmountString || '0');

    // Token balance increased = buy
    if (postAmount > preAmount) {
      const amount = postAmount - preAmount;
      const wallet = post.owner || '';

      if (wallet && amount > 0) {
        buys.push({
          wallet,
          amount,
          price: 0.0001, // Placeholder - would need DEX data
        });
      }
    }
  }

  return buys;
}

/**
 * Get current token holdings for a wallet
 */
async function getCurrentHoldings(wallet: string, tokenMint: string): Promise<number> {
  try {
    const connection = solanaService.getConnection();
    const walletPubkey = new PublicKey(wallet);
    const mintPubkey = new PublicKey(tokenMint);

    // Get token accounts for this wallet
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPubkey, {
      mint: mintPubkey,
    });

    if (tokenAccounts.value.length === 0) return 0;

    // Sum up balances from all token accounts
    let totalBalance = 0;
    for (const accountInfo of tokenAccounts.value) {
      const balance = accountInfo.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0;
      totalBalance += balance;
    }

    return totalBalance;
  } catch {
    return 0;
  }
}

// ============================================================================
// QUICK CHECKS
// ============================================================================

/**
 * Quick check if early insiders have dumped
 */
export async function quickInsiderDumpCheck(tokenMint: string): Promise<{
  insidersDumped: boolean;
  exitedCount: number;
  totalInsiders: number;
}> {
  try {
    const analysis = await getEarlyBuyers(tokenMint, 10);
    const insiders = analysis.earlyBuyers.filter(b => b.isInsider);
    const exitedInsiders = insiders.filter(b => b.hasExited);

    return {
      insidersDumped: exitedInsiders.length > 0,
      exitedCount: exitedInsiders.length,
      totalInsiders: insiders.length,
    };
  } catch {
    return {
      insidersDumped: false,
      exitedCount: 0,
      totalInsiders: 0,
    };
  }
}
