/**
 * Wallet Cluster Detection
 * Identifies coordinated wallet groups by analyzing funding patterns
 */

import { PublicKey } from '@solana/web3.js';
import { solanaService } from '../services/solana';
import { logger } from '../utils/logger';
import type { HolderInfo } from '../types';

export interface WalletCluster {
  clusterId: string;
  wallets: string[];
  totalPercent: number;
  commonFunder?: string;
  funderLabel?: string;
  walletCount: number;
  avgWalletAge?: number; // Average age in hours
  isSuspicious: boolean;
  suspicionReasons: string[];
}

export interface ClusterAnalysis {
  clusters: WalletCluster[];
  totalClusteredPercent: number;
  suspiciousClusters: number;
  riskScore: number; // 0-100, higher = more suspicious
}

// Known legitimate funders (exchanges, etc.)
const KNOWN_FUNDERS: Record<string, string> = {
  'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5': 'Binance Hot Wallet',
  '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S': 'Binance Deposit',
  'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS': 'Coinbase',
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM': 'FTX (Legacy)',
  '4BXqgxCBCgvWKyVBz3Q5L3VB8f9YvQxWLZLz5VXbZTfH': 'OKX',
};

/**
 * Detect wallet clusters among top holders
 */
export async function detectWalletClusters(
  topHolders: HolderInfo[],
  tokenMint: string
): Promise<ClusterAnalysis> {
  const clusters: WalletCluster[] = [];
  const walletFunders = new Map<string, string>();
  const funderToWallets = new Map<string, string[]>();

  // Analyze funding patterns for top 20 holders
  const holdersToAnalyze = topHolders.slice(0, 20);

  logger.debug('WalletCluster', `Analyzing ${holdersToAnalyze.length} holders for ${tokenMint.slice(0, 8)}...`);

  for (const holder of holdersToAnalyze) {
    try {
      const funder = await findWalletFunder(holder.address);
      if (funder) {
        walletFunders.set(holder.address, funder);

        if (!funderToWallets.has(funder)) {
          funderToWallets.set(funder, []);
        }
        funderToWallets.get(funder)!.push(holder.address);
      }
    } catch (error) {
      logger.silentError('WalletCluster', `Failed to analyze ${holder.address.slice(0, 8)}...`, error as Error);
    }
  }

  // Build clusters from funders with multiple wallets
  let clusterIndex = 0;
  for (const [funder, wallets] of funderToWallets.entries()) {
    if (wallets.length >= 2) {
      const clusterHolders = topHolders.filter(h => wallets.includes(h.address));
      const totalPercent = clusterHolders.reduce((sum, h) => sum + h.percentage, 0);

      const isKnownFunder = KNOWN_FUNDERS[funder] !== undefined;
      const suspicionReasons: string[] = [];

      // Check for suspicious patterns
      if (!isKnownFunder && wallets.length >= 3) {
        suspicionReasons.push(`${wallets.length} wallets from same unknown source`);
      }

      if (totalPercent > 20) {
        suspicionReasons.push(`Cluster controls ${totalPercent.toFixed(1)}% of supply`);
      }

      // Check if wallets were created recently (within similar timeframe)
      // This would require additional RPC calls - simplified for now

      clusters.push({
        clusterId: `cluster_${clusterIndex++}`,
        wallets,
        totalPercent,
        commonFunder: funder,
        funderLabel: KNOWN_FUNDERS[funder],
        walletCount: wallets.length,
        isSuspicious: suspicionReasons.length > 0 && !isKnownFunder,
        suspicionReasons,
      });
    }
  }

  // Calculate overall risk score
  const totalClusteredPercent = clusters.reduce((sum, c) => sum + c.totalPercent, 0);
  const suspiciousClusters = clusters.filter(c => c.isSuspicious).length;

  let riskScore = 0;

  // Risk from clustered holdings
  if (totalClusteredPercent > 50) {
    riskScore += 40;
  } else if (totalClusteredPercent > 30) {
    riskScore += 25;
  } else if (totalClusteredPercent > 15) {
    riskScore += 10;
  }

  // Risk from suspicious clusters
  riskScore += suspiciousClusters * 15;

  // Cap at 100
  riskScore = Math.min(100, riskScore);

  logger.debug('WalletCluster', `Found ${clusters.length} clusters, ${suspiciousClusters} suspicious, risk=${riskScore}`);

  return {
    clusters,
    totalClusteredPercent,
    suspiciousClusters,
    riskScore,
  };
}

/**
 * Find the original funder of a wallet by tracing SOL transfers
 */
async function findWalletFunder(walletAddress: string): Promise<string | null> {
  try {
    const connection = solanaService.getConnection();
    const pubkey = new PublicKey(walletAddress);

    // Get recent signatures (look for the first incoming SOL transfer)
    const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 30 });

    if (signatures.length === 0) return null;

    // Start from oldest to find the first funder
    const oldestSignatures = signatures.slice(-10).reverse();

    for (const sig of oldestSignatures) {
      try {
        const tx = await connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx?.meta) continue;

        const accountKeys = tx.transaction.message.accountKeys;
        const preBalances = tx.meta.preBalances;
        const postBalances = tx.meta.postBalances;

        // Find the account that sent SOL (balance decreased)
        for (let i = 0; i < accountKeys.length; i++) {
          const account = accountKeys[i] as any;
          const pubkeyStr = account.pubkey ? account.pubkey.toBase58() : account.toBase58();

          // Skip the target wallet itself
          if (pubkeyStr === walletAddress) continue;

          // Check if this account's balance decreased (sent SOL)
          const preBal = preBalances[i] ?? 0;
          const postBal = postBalances[i] ?? 0;

          if (preBal > postBal && preBal - postBal > 1000000) { // At least 0.001 SOL
            return pubkeyStr;
          }
        }
      } catch {
        // Transaction parsing failed, continue to next
        continue;
      }
    }

    return null;
  } catch (error) {
    logger.silentError('WalletCluster', `Failed to find funder for ${walletAddress.slice(0, 8)}...`, error as Error);
    return null;
  }
}

/**
 * Quick check if holder distribution looks suspicious
 */
export function quickClusterCheck(topHolders: HolderInfo[]): {
  isSuspicious: boolean;
  reason?: string;
} {
  // Check for suspiciously similar holdings (possible coordinated distribution)
  const top10 = topHolders.slice(0, 10);

  if (top10.length < 5) {
    return { isSuspicious: false };
  }

  // Check if multiple wallets hold very similar percentages
  const percentages = top10.map(h => h.percentage);
  const similarities: number[] = [];

  for (let i = 0; i < percentages.length - 1; i++) {
    for (let j = i + 1; j < percentages.length; j++) {
      const diff = Math.abs(percentages[i] - percentages[j]);
      if (diff < 0.5 && percentages[i] > 1) { // Within 0.5% and meaningful holdings
        similarities.push(diff);
      }
    }
  }

  // If more than 3 pairs have very similar holdings, suspicious
  if (similarities.length >= 3) {
    return {
      isSuspicious: true,
      reason: `${similarities.length} wallet pairs with suspiciously similar holdings`,
    };
  }

  return { isSuspicious: false };
}
