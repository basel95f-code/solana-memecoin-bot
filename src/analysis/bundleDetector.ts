/**
 * Bundle Detection - Enhanced Sybil Attack Detection
 * Detects coordinated wallet clusters by analyzing:
 * - Common funding sources
 * - Wallet creation time clustering
 * - Coordinated purchase patterns
 * - Synchronized trading behavior
 */

import { PublicKey } from '@solana/web3.js';
import { solanaService } from '../services/solana';
import { logger } from '../utils/logger';
import type { HolderInfo } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface CoordinatedBuy {
  wallets: string[];
  timeSpan: number; // Seconds between first/last buy
  totalAmount: number; // Total tokens bought
  averageTimeDelta: number; // Average seconds between buys
  timestamps: Date[];
}

export interface BundleCluster {
  clusterId: string;
  wallets: string[];
  commonFunder: string;
  funderLabel?: string;
  
  // Holdings
  totalHoldings: number; // Total tokens
  totalPercentage: number; // % of supply
  
  // Timing patterns
  creationTimeSpan: number; // Seconds between oldest/newest wallet
  avgWalletAge: number; // Average age in hours
  walletsCreatedWithin1Hour: number;
  
  // Purchase patterns
  coordinatedBuys: CoordinatedBuy[];
  hasSynchronizedPurchases: boolean;
  
  // Risk assessment
  riskScore: number; // 0-100
  isSuspicious: boolean;
  suspicionReasons: string[];
}

export interface BundleAnalysis {
  tokenMint: string;
  clusters: BundleCluster[];
  totalClusteredPercent: number;
  suspiciousClusters: number;
  overallRiskScore: number;
  warnings: string[];
}

// Known legitimate funders (exchanges, etc.)
const KNOWN_FUNDERS: Record<string, string> = {
  'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5': 'Binance Hot Wallet',
  '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S': 'Binance Deposit',
  'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS': 'Coinbase',
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM': 'FTX (Legacy)',
  '4BXqgxCBCgvWKyVBz3Q5L3VB8f9YvQxWLZLz5VXbZTfH': 'OKX',
  'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE': 'Kraken',
  'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2': 'Gate.io',
};

// ============================================================================
// MAIN DETECTION FUNCTION
// ============================================================================

/**
 * Detect bundle attacks (coordinated wallet clusters)
 */
export async function detectBundles(
  tokenMint: string,
  topHolders: HolderInfo[]
): Promise<BundleAnalysis> {
  logger.info('BundleDetector', `Analyzing ${topHolders.length} holders for bundle attacks on ${tokenMint.slice(0, 8)}...`);

  const clusters: BundleCluster[] = [];
  const warnings: string[] = [];

  // Step 1: Group wallets by common funder
  const funderGroups = await groupWalletsByFunder(topHolders, tokenMint);

  // Step 2: Analyze each group for bundle characteristics
  let clusterIndex = 0;
  for (const [funder, walletGroup] of Array.from(funderGroups.entries())) {
    if (walletGroup.wallets.length < 2) continue; // Need at least 2 wallets

    const cluster = await analyzeBundleCluster(
      `cluster_${clusterIndex++}`,
      funder,
      walletGroup,
      tokenMint
    );

    if (cluster) {
      clusters.push(cluster);
    }
  }

  // Step 3: Calculate overall risk
  const totalClusteredPercent = clusters.reduce((sum, c) => sum + c.totalPercentage, 0);
  const suspiciousClusters = clusters.filter(c => c.isSuspicious);

  // Generate warnings
  if (suspiciousClusters.length > 0) {
    warnings.push(`⚠️ ${suspiciousClusters.length} suspicious bundle cluster(s) detected`);
  }

  if (totalClusteredPercent > 40) {
    warnings.push(`⚠️ ${totalClusteredPercent.toFixed(1)}% of supply controlled by clusters`);
  }

  // Calculate overall risk score
  let overallRiskScore = calculateOverallRiskScore(clusters, totalClusteredPercent);

  logger.info('BundleDetector', `Found ${clusters.length} clusters (${suspiciousClusters.length} suspicious), risk=${overallRiskScore}`);

  return {
    tokenMint,
    clusters,
    totalClusteredPercent,
    suspiciousClusters: suspiciousClusters.length,
    overallRiskScore,
    warnings,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

interface WalletGroup {
  wallets: string[];
  holders: HolderInfo[];
  totalPercentage: number;
}

/**
 * Group wallets by their common funder
 */
async function groupWalletsByFunder(
  topHolders: HolderInfo[],
  tokenMint: string
): Promise<Map<string, WalletGroup>> {
  const funderGroups = new Map<string, WalletGroup>();

  // Analyze top 50 holders (or all if less)
  const holdersToAnalyze = topHolders.slice(0, 50);

  for (const holder of holdersToAnalyze) {
    try {
      const funder = await findWalletFunder(holder.address);
      
      if (funder) {
        if (!funderGroups.has(funder)) {
          funderGroups.set(funder, {
            wallets: [],
            holders: [],
            totalPercentage: 0,
          });
        }

        const group = funderGroups.get(funder)!;
        group.wallets.push(holder.address);
        group.holders.push(holder);
        group.totalPercentage += holder.percentage;
      }
    } catch (error) {
      logger.silentError('BundleDetector', `Failed to trace funder for ${holder.address.slice(0, 8)}`, error as Error);
    }
  }

  return funderGroups;
}

/**
 * Analyze a potential bundle cluster
 */
async function analyzeBundleCluster(
  clusterId: string,
  funder: string,
  group: WalletGroup,
  tokenMint: string
): Promise<BundleCluster | null> {
  const { wallets, holders, totalPercentage } = group;

  // Calculate total holdings
  const totalHoldings = holders.reduce((sum, h) => sum + (h.balance || 0), 0);

  // Get wallet creation times
  const walletAges = await Promise.all(
    wallets.map(w => getWalletAge(w))
  );

  const validAges = walletAges.filter(age => age !== null) as number[];
  const avgWalletAge = validAges.length > 0
    ? validAges.reduce((sum, age) => sum + age, 0) / validAges.length
    : 0;

  // Calculate creation time span
  const creationTimestamps = await Promise.all(
    wallets.map(w => getWalletCreationTime(w))
  );
  const validTimestamps = creationTimestamps.filter(t => t !== null) as Date[];
  
  let creationTimeSpan = 0;
  let walletsCreatedWithin1Hour = 0;

  if (validTimestamps.length >= 2) {
    const timestamps = validTimestamps.map(t => t.getTime()).sort((a, b) => a - b);
    creationTimeSpan = (timestamps[timestamps.length - 1] - timestamps[0]) / 1000; // seconds

    // Count wallets created within 1 hour
    const oneHourMs = 3600 * 1000;
    for (let i = 0; i < timestamps.length - 1; i++) {
      for (let j = i + 1; j < timestamps.length; j++) {
        if (timestamps[j] - timestamps[i] <= oneHourMs) {
          walletsCreatedWithin1Hour++;
          break;
        }
      }
    }
  }

  // Detect coordinated purchases
  const coordinatedBuys = await detectCoordinatedPurchases(wallets, tokenMint);

  // Risk assessment
  const { riskScore, isSuspicious, suspicionReasons } = assessBundleRisk(
    funder,
    group,
    creationTimeSpan,
    walletsCreatedWithin1Hour,
    coordinatedBuys,
    avgWalletAge
  );

  return {
    clusterId,
    wallets,
    commonFunder: funder,
    funderLabel: KNOWN_FUNDERS[funder],
    totalHoldings,
    totalPercentage,
    creationTimeSpan,
    avgWalletAge,
    walletsCreatedWithin1Hour,
    coordinatedBuys,
    hasSynchronizedPurchases: coordinatedBuys.length > 0,
    riskScore,
    isSuspicious,
    suspicionReasons,
  };
}

/**
 * Find the original funder of a wallet
 */
async function findWalletFunder(walletAddress: string): Promise<string | null> {
  try {
    const connection = solanaService.getConnection();
    const pubkey = new PublicKey(walletAddress);

    const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 50 });
    if (signatures.length === 0) return null;

    // Start from oldest transactions
    const oldestSignatures = signatures.slice(-15).reverse();

    for (const sig of oldestSignatures) {
      try {
        const tx = await connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx?.meta) continue;

        const accountKeys = tx.transaction.message.accountKeys;
        const preBalances = tx.meta.preBalances;
        const postBalances = tx.meta.postBalances;

        // Find account that sent SOL
        for (let i = 0; i < accountKeys.length; i++) {
          const account = accountKeys[i] as any;
          const pubkeyStr = account.pubkey ? account.pubkey.toBase58() : account.toBase58();

          if (pubkeyStr === walletAddress) continue;

          const preBal = preBalances[i] ?? 0;
          const postBal = postBalances[i] ?? 0;

          // Sent at least 0.001 SOL
          if (preBal > postBal && preBal - postBal > 1000000) {
            return pubkeyStr;
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Get wallet age in hours
 */
async function getWalletAge(walletAddress: string): Promise<number | null> {
  const creationTime = await getWalletCreationTime(walletAddress);
  if (!creationTime) return null;

  const ageMs = Date.now() - creationTime.getTime();
  return ageMs / (1000 * 3600); // hours
}

/**
 * Get wallet creation timestamp
 */
async function getWalletCreationTime(walletAddress: string): Promise<Date | null> {
  try {
    const connection = solanaService.getConnection();
    const pubkey = new PublicKey(walletAddress);

    const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 50 });
    if (signatures.length === 0) return null;

    // Oldest transaction = creation time
    const oldestSig = signatures[signatures.length - 1];
    if (oldestSig.blockTime) {
      return new Date(oldestSig.blockTime * 1000);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Detect coordinated token purchases
 */
async function detectCoordinatedPurchases(
  wallets: string[],
  tokenMint: string
): Promise<CoordinatedBuy[]> {
  const coordinatedBuys: CoordinatedBuy[] = [];

  try {
    // Get purchase timestamps for each wallet
    const purchases = await Promise.all(
      wallets.map(w => getTokenPurchaseTime(w, tokenMint))
    );

    const validPurchases = purchases
      .map((time, i) => ({ wallet: wallets[i], time }))
      .filter(p => p.time !== null) as { wallet: string; time: Date }[];

    if (validPurchases.length < 2) return [];

    // Sort by timestamp
    validPurchases.sort((a, b) => a.time.getTime() - b.time.getTime());

    // Find clusters of purchases within 60 seconds
    let currentCluster: { wallet: string; time: Date }[] = [validPurchases[0]];

    for (let i = 1; i < validPurchases.length; i++) {
      const prev = validPurchases[i - 1];
      const curr = validPurchases[i];
      const deltaSeconds = (curr.time.getTime() - prev.time.getTime()) / 1000;

      if (deltaSeconds <= 60) {
        // Within 60 seconds - add to current cluster
        currentCluster.push(curr);
      } else {
        // New cluster
        if (currentCluster.length >= 2) {
          coordinatedBuys.push(buildCoordinatedBuy(currentCluster));
        }
        currentCluster = [curr];
      }
    }

    // Check final cluster
    if (currentCluster.length >= 2) {
      coordinatedBuys.push(buildCoordinatedBuy(currentCluster));
    }

  } catch (error) {
    logger.silentError('BundleDetector', 'Failed to detect coordinated purchases', error as Error);
  }

  return coordinatedBuys;
}

/**
 * Build CoordinatedBuy from purchase cluster
 */
function buildCoordinatedBuy(cluster: { wallet: string; time: Date }[]): CoordinatedBuy {
  const timestamps = cluster.map(c => c.time);
  const timeMs = timestamps.map(t => t.getTime()).sort((a, b) => a - b);

  const timeSpan = (timeMs[timeMs.length - 1] - timeMs[0]) / 1000;
  const totalDeltas = timeMs.slice(1).reduce((sum, t, i) => sum + (t - timeMs[i]), 0);
  const averageTimeDelta = totalDeltas / (timeMs.length - 1) / 1000;

  return {
    wallets: cluster.map(c => c.wallet),
    timeSpan,
    totalAmount: 0, // Would need additional RPC calls
    averageTimeDelta,
    timestamps,
  };
}

/**
 * Get token purchase timestamp for a wallet
 */
async function getTokenPurchaseTime(
  walletAddress: string,
  tokenMint: string
): Promise<Date | null> {
  try {
    const connection = solanaService.getConnection();
    const pubkey = new PublicKey(walletAddress);

    const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 100 });

    // Look for first transaction involving this token
    for (const sig of signatures.reverse()) {
      try {
        const tx = await connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx?.meta || !tx.blockTime) continue;

        // Check if transaction involves the token mint
        const accountKeys = tx.transaction.message.accountKeys;
        const involvedMints = accountKeys
          .map((key: any) => (key.pubkey ? key.pubkey.toBase58() : key.toBase58()))
          .filter((addr: string) => addr === tokenMint);

        if (involvedMints.length > 0) {
          return new Date(tx.blockTime * 1000);
        }
      } catch {
        continue;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Assess bundle risk based on detected patterns
 */
function assessBundleRisk(
  funder: string,
  group: WalletGroup,
  creationTimeSpan: number,
  walletsCreatedWithin1Hour: number,
  coordinatedBuys: CoordinatedBuy[],
  avgWalletAge: number
): {
  riskScore: number;
  isSuspicious: boolean;
  suspicionReasons: string[];
} {
  const suspicionReasons: string[] = [];
  let riskScore = 0;

  const isKnownFunder = KNOWN_FUNDERS[funder] !== undefined;
  const walletCount = group.wallets.length;
  const totalPercentage = group.totalPercentage;

  // Risk Factor 1: Multiple wallets from unknown source
  if (!isKnownFunder && walletCount >= 3) {
    riskScore += 20;
    suspicionReasons.push(`${walletCount} wallets from same unknown source`);
  }

  if (!isKnownFunder && walletCount >= 5) {
    riskScore += 15;
    suspicionReasons.push(`Large wallet cluster (${walletCount} wallets)`);
  }

  // Risk Factor 2: Controls significant supply
  if (totalPercentage > 25) {
    riskScore += 25;
    suspicionReasons.push(`Cluster controls ${totalPercentage.toFixed(1)}% of supply`);
  } else if (totalPercentage > 15) {
    riskScore += 15;
    suspicionReasons.push(`Cluster controls ${totalPercentage.toFixed(1)}% of supply`);
  }

  // Risk Factor 3: Wallets created close together
  if (creationTimeSpan > 0 && creationTimeSpan < 3600) { // < 1 hour
    riskScore += 20;
    const minutes = Math.floor(creationTimeSpan / 60);
    suspicionReasons.push(`Wallets created within ${minutes} minutes`);
  } else if (creationTimeSpan > 0 && creationTimeSpan < 7200) { // < 2 hours
    riskScore += 10;
    suspicionReasons.push(`Wallets created within 2 hours`);
  }

  // Risk Factor 4: Coordinated purchases
  if (coordinatedBuys.length > 0) {
    const fastestBuy = coordinatedBuys.reduce((min, buy) => 
      buy.timeSpan < min ? buy.timeSpan : min, 
      Infinity
    );

    riskScore += 25;
    suspicionReasons.push(
      `${coordinatedBuys.length} coordinated buy event(s) (fastest: ${Math.floor(fastestBuy)}s)`
    );
  }

  // Risk Factor 5: Fresh wallets
  if (avgWalletAge > 0 && avgWalletAge < 24) { // < 1 day old
    riskScore += 15;
    suspicionReasons.push(`Fresh wallets (avg age: ${avgWalletAge.toFixed(1)}h)`);
  }

  // Cap at 100
  riskScore = Math.min(100, riskScore);

  const isSuspicious = riskScore >= 60 && !isKnownFunder;

  return { riskScore, isSuspicious, suspicionReasons };
}

/**
 * Calculate overall risk score for all clusters
 */
function calculateOverallRiskScore(
  clusters: BundleCluster[],
  totalClusteredPercent: number
): number {
  if (clusters.length === 0) return 0;

  // Base risk from clustered holdings
  let overallRisk = 0;

  if (totalClusteredPercent > 60) {
    overallRisk += 40;
  } else if (totalClusteredPercent > 40) {
    overallRisk += 25;
  } else if (totalClusteredPercent > 20) {
    overallRisk += 10;
  }

  // Add risk from suspicious clusters
  const suspiciousClusters = clusters.filter(c => c.isSuspicious);
  overallRisk += suspiciousClusters.length * 15;

  // Boost if multiple high-risk clusters
  const highRiskClusters = clusters.filter(c => c.riskScore >= 80);
  if (highRiskClusters.length >= 2) {
    overallRisk += 20;
  }

  return Math.min(100, overallRisk);
}

// ============================================================================
// EXPORTS
// ============================================================================

export { findWalletFunder, getWalletAge, getWalletCreationTime };
