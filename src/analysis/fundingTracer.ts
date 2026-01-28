/**
 * Funding Tracer - Wallet Funding Source Analysis
 * Traces where a wallet got its initial SOL from
 */

import { PublicKey } from '@solana/web3.js';
import { solanaService } from '../services/solana';
import { logger } from '../utils/logger';
import { supabase } from '../database/supabase';

// ============================================================================
// TYPES
// ============================================================================

export interface FundingTrace {
  walletAddress: string;
  initialFunder: string;
  funderType: 'cex' | 'unknown' | 'dev_wallet' | 'faucet';
  funderLabel?: string; // "Binance", "Known Rugger", etc.
  fundingAmount: number; // SOL amount
  fundingTimestamp: Date | null;
  walletAge: number; // Hours since creation
  isFreshWallet: boolean; // < 24h old
  riskScore: number; // 0-100
  warnings: string[];
}

// Known legitimate funders (exchanges, faucets, etc.)
const KNOWN_CEX_FUNDERS: Record<string, string> = {
  'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5': 'Binance Hot Wallet',
  '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S': 'Binance Deposit',
  'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS': 'Coinbase',
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM': 'FTX (Legacy)',
  '4BXqgxCBCgvWKyVBz3Q5L3VB8f9YvQxWLZLz5VXbZTfH': 'OKX',
  'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE': 'Kraken',
  'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2': 'Gate.io',
  'H8UekPGwePSmQ3ttuYGPU1szyFfjZR4N53rymSFwpLPm': 'Huobi',
  '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9': 'Crypto.com',
  'EhWxBHdmQ3yDmpmv8Se6zJs5cYbLjMU3vGb5t3yYvkHb': 'Bybit',
};

const KNOWN_FAUCETS: Record<string, string> = {
  'B7fT8RgdLjSfSxZq9PJcqVYYnqVHqJqQjvq6nJVpN1UL': 'Solana Faucet',
  'FaucetKJN7ch3X3AVKaYQCQZLp5C1BjTJ3qQvFqJqfwA': 'QuickNode Faucet',
};

// ============================================================================
// MAIN TRACING FUNCTION
// ============================================================================

/**
 * Trace wallet funding source and assess risk
 */
export async function traceFunding(walletAddress: string): Promise<FundingTrace> {
  logger.info('FundingTracer', `Tracing funding for ${walletAddress.slice(0, 8)}...`);

  try {
    // Step 1: Find initial funder
    const { funder, amount, timestamp } = await findInitialFunder(walletAddress);

    if (!funder) {
      return {
        walletAddress,
        initialFunder: 'Unknown',
        funderType: 'unknown',
        fundingAmount: 0,
        fundingTimestamp: null,
        walletAge: 0,
        isFreshWallet: false,
        riskScore: 50,
        warnings: ['Unable to trace funding source'],
      };
    }

    // Step 2: Classify funder
    const { funderType, funderLabel } = await classifyFunder(funder);

    // Step 3: Calculate wallet age
    const walletAge = timestamp ? calculateWalletAge(timestamp) : 0;
    const isFreshWallet = walletAge < 24;

    // Step 4: Check if funder is known dev/scammer
    const devCheck = await checkKnownDevWallet(funder);

    // Step 5: Check if funder funded other suspicious wallets
    const otherWalletCount = await countFunderWallets(funder);

    // Step 6: Assess risk
    const { riskScore, warnings } = assessFundingRisk(
      funderType,
      walletAge,
      isFreshWallet,
      devCheck,
      otherWalletCount
    );

    logger.info('FundingTracer', `Traced ${walletAddress.slice(0, 8)}: ${funderType} (risk=${riskScore})`);

    return {
      walletAddress,
      initialFunder: funder,
      funderType,
      funderLabel: funderLabel || devCheck?.label,
      fundingAmount: amount,
      fundingTimestamp: timestamp,
      walletAge,
      isFreshWallet,
      riskScore,
      warnings,
    };
  } catch (error) {
    logger.error('FundingTracer', `Failed to trace ${walletAddress}:`, error as Error);
    throw error;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Find the initial funder of a wallet
 */
async function findInitialFunder(
  walletAddress: string
): Promise<{ funder: string | null; amount: number; timestamp: Date | null }> {
  try {
    const connection = solanaService.getConnection();
    const pubkey = new PublicKey(walletAddress);

    // Get all signatures (up to 1000 for thorough search)
    const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 1000 });

    if (signatures.length === 0) {
      return { funder: null, amount: 0, timestamp: null };
    }

    // Start from oldest transaction
    const oldestSignatures = signatures.slice(-20).reverse();

    for (const sig of oldestSignatures) {
      try {
        const tx = await connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx?.meta || !sig.blockTime) continue;

        const accountKeys = tx.transaction.message.accountKeys;
        const preBalances = tx.meta.preBalances;
        const postBalances = tx.meta.postBalances;

        // Find the account that sent SOL
        for (let i = 0; i < accountKeys.length; i++) {
          const account = accountKeys[i] as any;
          const pubkeyStr = account.pubkey ? account.pubkey.toBase58() : account.toBase58();

          if (pubkeyStr === walletAddress) continue;

          const preBal = preBalances[i] ?? 0;
          const postBal = postBalances[i] ?? 0;
          const sent = preBal - postBal;

          // Found a SOL sender (at least 0.001 SOL)
          if (sent > 1000000) {
            const amountSol = sent / 1e9;
            const timestamp = new Date(sig.blockTime * 1000);
            return { funder: pubkeyStr, amount: amountSol, timestamp };
          }
        }
      } catch {
        continue;
      }
    }

    return { funder: null, amount: 0, timestamp: null };
  } catch (error) {
    logger.silentError('FundingTracer', 'Failed to find initial funder', error as Error);
    return { funder: null, amount: 0, timestamp: null };
  }
}

/**
 * Classify funder type
 */
async function classifyFunder(
  funder: string
): Promise<{ funderType: 'cex' | 'unknown' | 'dev_wallet' | 'faucet'; funderLabel?: string }> {
  // Check if known CEX
  if (KNOWN_CEX_FUNDERS[funder]) {
    return { funderType: 'cex', funderLabel: KNOWN_CEX_FUNDERS[funder] };
  }

  // Check if known faucet
  if (KNOWN_FAUCETS[funder]) {
    return { funderType: 'faucet', funderLabel: KNOWN_FAUCETS[funder] };
  }

  // Check if known dev/scammer wallet (from database)
  const devCheck = await checkKnownDevWallet(funder);
  if (devCheck) {
    return { funderType: 'dev_wallet', funderLabel: devCheck.label };
  }

  return { funderType: 'unknown' };
}

/**
 * Check if wallet is in known dev/scammer database
 */
async function checkKnownDevWallet(
  walletAddress: string
): Promise<{ label: string; classification: string } | null> {
  try {
    if (!supabase) return null;

    const { data, error } = await supabase
      .from('known_dev_wallets')
      .select('classification, reputation_score, evidence_notes')
      .eq('wallet_address', walletAddress)
      .eq('is_flagged', true)
      .single();

    if (error || !data) return null;

    let label = '';
    switch (data.classification) {
      case 'known_scammer':
        label = `Known Scammer (rep: ${data.reputation_score}/100)`;
        break;
      case 'known_dev':
        label = `Known Dev (rep: ${data.reputation_score}/100)`;
        break;
      case 'insider':
        label = 'Suspected Insider';
        break;
      case 'suspected':
        label = 'Suspected Scammer';
        break;
      default:
        label = 'Flagged Wallet';
    }

    return { label, classification: data.classification };
  } catch {
    return null;
  }
}

/**
 * Count how many other wallets this funder has funded
 */
async function countFunderWallets(funder: string): Promise<number> {
  try {
    if (!supabase) return 0;

    const { count, error } = await supabase
      .from('funding_traces')
      .select('*', { count: 'exact', head: true })
      .eq('initial_funder', funder);

    if (error) return 0;

    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Calculate wallet age in hours
 */
function calculateWalletAge(fundingTimestamp: Date): number {
  const ageMs = Date.now() - fundingTimestamp.getTime();
  return ageMs / (1000 * 3600); // hours
}

/**
 * Assess funding risk
 */
function assessFundingRisk(
  funderType: 'cex' | 'unknown' | 'dev_wallet' | 'faucet',
  walletAge: number,
  isFreshWallet: boolean,
  devCheck: { label: string; classification: string } | null,
  otherWalletCount: number
): { riskScore: number; warnings: string[] } {
  const warnings: string[] = [];
  let riskScore = 0;

  // Risk Factor 1: Funder type
  switch (funderType) {
    case 'cex':
      riskScore = 0; // Legitimate
      break;
    case 'faucet':
      riskScore = 10; // Low risk
      warnings.push('Funded from faucet (common for test wallets)');
      break;
    case 'unknown':
      riskScore = 40; // Medium risk
      warnings.push('Funded from unknown wallet');
      break;
    case 'dev_wallet':
      riskScore = 90; // High risk
      warnings.push(`Funded from ${devCheck?.label || 'flagged wallet'}`);
      break;
  }

  // Risk Factor 2: Fresh wallet
  if (isFreshWallet) {
    riskScore += 20;
    warnings.push(`Fresh wallet (${walletAge.toFixed(1)}h old)`);
  } else if (walletAge < 72) {
    riskScore += 10;
    warnings.push(`New wallet (${walletAge.toFixed(1)}h old)`);
  }

  // Risk Factor 3: Funder funded many wallets
  if (otherWalletCount > 20) {
    riskScore += 20;
    warnings.push(`Funder also funded ${otherWalletCount} other wallets`);
  } else if (otherWalletCount > 10) {
    riskScore += 10;
    warnings.push(`Funder also funded ${otherWalletCount} other wallets`);
  }

  // Risk Factor 4: Known scammer
  if (devCheck && devCheck.classification === 'known_scammer') {
    riskScore = 95; // Override to max
    warnings.unshift('🚨 CRITICAL: Funded from known scammer wallet');
  }

  // Cap at 100
  riskScore = Math.min(100, riskScore);

  // Add success message for low risk
  if (riskScore < 20) {
    warnings.push('✅ Wallet appears legitimate');
  }

  return { riskScore, warnings };
}

// ============================================================================
// BATCH TRACING
// ============================================================================

/**
 * Trace funding for multiple wallets
 */
export async function traceFundingBatch(wallets: string[]): Promise<FundingTrace[]> {
  const results = await Promise.all(
    wallets.map(async (wallet) => {
      try {
        return await traceFunding(wallet);
      } catch (error) {
        logger.silentError('FundingTracer', `Failed to trace ${wallet.slice(0, 8)}`, error as Error);
        return null;
      }
    })
  );

  return results.filter((r): r is FundingTrace => r !== null);
}

// ============================================================================
// STORAGE
// ============================================================================

/**
 * Store funding trace in database
 */
export async function storeFundingTrace(trace: FundingTrace): Promise<void> {
  try {
    if (!supabase) return;

    const { error } = await supabase.from('funding_traces').upsert(
      {
        wallet_address: trace.walletAddress,
        initial_funder: trace.initialFunder,
        funder_type: trace.funderType,
        funder_label: trace.funderLabel,
        funding_amount: trace.fundingAmount,
        funding_timestamp: trace.fundingTimestamp,
        wallet_age_hours: trace.walletAge,
        is_fresh_wallet: trace.isFreshWallet,
        risk_score: trace.riskScore,
        warnings: trace.warnings,
        traced_at: new Date(),
      },
      { onConflict: 'wallet_address' }
    );

    if (error) {
      logger.error('FundingTracer', 'Failed to store funding trace:', error);
    }
  } catch (error) {
    logger.silentError('FundingTracer', 'Database error storing trace', error as Error);
  }
}
