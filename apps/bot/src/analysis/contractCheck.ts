import { PublicKey } from '@solana/web3.js';
import { solanaService } from '../services/solana';
import type { ContractAnalysis } from '../types';
import { logger } from '../utils/logger';
import { PROGRAMS, CONTRACT } from '../constants';
import { cacheManager, CacheKey, CacheTTL } from '../cache';

export async function analyzeContract(mintAddress: string): Promise<ContractAnalysis> {
  // Check cache first (5 min TTL)
  const cacheKey = CacheKey.contractData(mintAddress);
  const cached = await cacheManager.get<ContractAnalysis>(cacheKey);
  if (cached) {
    return cached;
  }

  let mintAuthorityRevoked = false;
  let freezeAuthorityRevoked = false;
  let mintAuthority: string | null = null;
  let freezeAuthority: string | null = null;
  let isHoneypot = false;
  let honeypotReason: string | undefined;
  let hasTransferFee = false;
  let transferFeePercent: number | undefined;

  try {
    const mintInfo = await solanaService.getMintInfo(mintAddress);

    if (mintInfo) {
      // Check mint authority
      mintAuthority = mintInfo.mintAuthority?.toBase58() || null;
      mintAuthorityRevoked = mintInfo.mintAuthority === null;

      // Check freeze authority
      freezeAuthority = mintInfo.freezeAuthority?.toBase58() || null;
      freezeAuthorityRevoked = mintInfo.freezeAuthority === null;

      // Check for Token-2022 transfer fees
      const feeInfo = await checkTransferFee(mintAddress);
      hasTransferFee = feeInfo.hasFee;
      transferFeePercent = feeInfo.feePercent;

      // Check for honeypot characteristics
      const honeypotCheck = await detectHoneypot(mintAddress);
      isHoneypot = honeypotCheck.isHoneypot;
      honeypotReason = honeypotCheck.reason;
    }
  } catch (error) {
    console.error(`Error analyzing contract for ${mintAddress}:`, error);
  }

  const result = {
    mintAuthorityRevoked,
    freezeAuthorityRevoked,
    mintAuthority,
    freezeAuthority,
    isHoneypot,
    honeypotReason,
    hasTransferFee,
    transferFeePercent,
  };

  // Cache the result
  await cacheManager.set(cacheKey, result, CacheTTL.TOKEN_ANALYSIS);

  return result;
}

/**
 * Check for Token-2022 transfer fees using proper extension parsing
 *
 * Token-2022 Extension Layout:
 * - Base mint account: 82 bytes (standard Mint structure)
 * - Account type discriminator: 1 byte (should be 1 for Mint)
 * - Extensions start at byte 83
 *
 * Each extension:
 * - Type (u16): 2 bytes
 * - Length (u16): 2 bytes
 * - Data: variable
 *
 * TransferFeeConfig extension type = 1
 * TransferFeeConfig layout:
 * - transferFeeConfigAuthority (32 bytes)
 * - withdrawWithheldAuthority (32 bytes)
 * - withheldAmount (u64, 8 bytes)
 * - olderTransferFee:
 *   - epoch (u64, 8 bytes)
 *   - maximumFee (u64, 8 bytes)
 *   - transferFeeBasisPoints (u16, 2 bytes)
 * - newerTransferFee:
 *   - epoch (u64, 8 bytes)
 *   - maximumFee (u64, 8 bytes)
 *   - transferFeeBasisPoints (u16, 2 bytes)
 */
async function checkTransferFee(mintAddress: string): Promise<{
  hasFee: boolean;
  feePercent?: number;
  maxFee?: number;
}> {
  try {
    const connection = solanaService.getConnection();
    const mintPubkey = new PublicKey(mintAddress);

    const accountInfo = await connection.getAccountInfo(mintPubkey);
    if (!accountInfo) {
      return { hasFee: false };
    }

    // Check if it's a Token-2022 token
    if (accountInfo.owner.toBase58() !== PROGRAMS.TOKEN_2022_PROGRAM) {
      return { hasFee: false };
    }

    const data = accountInfo.data;

    // Token-2022 mint base size is 82 bytes + 1 byte account type
    // Extensions start at byte 83
    if (data.length <= CONTRACT.TOKEN_ACCOUNT_SIZE) {
      return { hasFee: false };
    }

    // Parse extensions
    let offset = 83; // Start after base mint + account type

    while (offset + 4 <= data.length) {
      // Read extension type (u16 little-endian)
      const extensionType = data.readUInt16LE(offset);
      offset += 2;

      // Read extension length (u16 little-endian)
      const extensionLength = data.readUInt16LE(offset);
      offset += 2;

      // Check if this is TransferFeeConfig (type = 1)
      if (extensionType === 1) {
        // TransferFeeConfig found!
        // Skip to the fee data:
        // - transferFeeConfigAuthority: 32 bytes
        // - withdrawWithheldAuthority: 32 bytes
        // - withheldAmount: 8 bytes
        // - olderTransferFee.epoch: 8 bytes
        // - olderTransferFee.maximumFee: 8 bytes
        // - olderTransferFee.transferFeeBasisPoints: 2 bytes (offset 88 from start of extension)

        if (extensionLength >= 90) {
          const feeDataOffset = offset + 32 + 32 + 8; // Skip to olderTransferFee
          const _olderEpoch = data.readBigUInt64LE(feeDataOffset); // Epoch info for debugging
          const olderMaxFee = data.readBigUInt64LE(feeDataOffset + 8);
          const olderBasisPoints = data.readUInt16LE(feeDataOffset + 16);

          // Also check newer fee (might be different)
          const newerBasisPoints = data.readUInt16LE(feeDataOffset + 18 + 8 + 8);

          // Use the higher of the two fee rates
          const basisPoints = Math.max(olderBasisPoints, newerBasisPoints);

          if (basisPoints > 0) {
            const feePercent = basisPoints / 100; // Basis points to percent
            const maxFee = Number(olderMaxFee);

            logger.debug('contractCheck', `Token-2022 transfer fee: ${feePercent}% (${basisPoints} bps)`);

            return {
              hasFee: true,
              feePercent,
              maxFee: maxFee > 0 ? maxFee : undefined,
            };
          }
        }

        return { hasFee: false };
      }

      // Move to next extension
      offset += extensionLength;
    }

    return { hasFee: false };
  } catch (error) {
    logger.silentError('contractCheck', 'Transfer fee check failed', error as Error);
    return { hasFee: false };
  }
}

// Known DEX program IDs for identifying swap transactions
const DEX_PROGRAMS = [
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CPMM
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // Orca v1
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
  'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY', // Phoenix
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun
];

// Error patterns that indicate honeypot behavior
const HONEYPOT_ERROR_PATTERNS = [
  'insufficient funds',
  'transfer not allowed',
  'account frozen',
  'cannot sell',
  'sell disabled',
  'trading paused',
  'blacklisted',
  'not whitelisted',
  'max transaction',
  'sell limit',
];

async function detectHoneypot(mintAddress: string): Promise<{
  isHoneypot: boolean;
  reason?: string;
  confidence: 'low' | 'medium' | 'high';
}> {
  try {
    const connection = solanaService.getConnection();
    const mintPubkey = new PublicKey(mintAddress);

    // Get more transactions for better analysis
    const signatures = await connection.getSignaturesForAddress(mintPubkey, {
      limit: 100,
    });

    if (signatures.length === 0) {
      return { isHoneypot: false, confidence: 'low' };
    }

    // Analyze transactions in batches
    let totalSwaps = 0;
    let failedSwaps = 0;
    let successfulSells = 0;
    let successfulBuys = 0;
    let honeypotPatternFound = false;
    let honeypotReason = '';

    // Sample transactions for analysis (check every 2nd to cover more time)
    const sampled = signatures.filter((_, i) => i % 2 === 0).slice(0, 30);

    for (const sig of sampled) {
      try {
        const tx = await connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx) continue;

        const logMessages = tx.meta?.logMessages || [];
        const logText = logMessages.join(' ').toLowerCase();

        // Check if this involves a DEX program
        const involvesDex = tx.transaction.message.accountKeys.some((key) =>
          DEX_PROGRAMS.includes(key.pubkey.toBase58())
        );

        if (!involvesDex) continue;

        totalSwaps++;

        // Check for honeypot error patterns
        for (const pattern of HONEYPOT_ERROR_PATTERNS) {
          if (logText.includes(pattern)) {
            honeypotPatternFound = true;
            honeypotReason = `Transaction blocked: "${pattern}"`;
            break;
          }
        }

        if (tx.meta?.err) {
          failedSwaps++;

          // Analyze the error type
          const errorStr = JSON.stringify(tx.meta.err).toLowerCase();
          if (
            errorStr.includes('instructionerror') ||
            errorStr.includes('custom')
          ) {
            // Could be a honeypot custom program error
            if (failedSwaps > 3) {
              honeypotPatternFound = true;
              honeypotReason = 'Multiple custom program errors on swap attempts';
            }
          }
        } else {
          // Successful swap - try to determine if buy or sell
          // This is heuristic: if token balance increased, it's a buy
          const preBalances = tx.meta?.preTokenBalances || [];
          const postBalances = tx.meta?.postTokenBalances || [];

          // Find balance changes for this token
          const preAmount = preBalances.find(
            (b) => b.mint === mintAddress
          )?.uiTokenAmount?.uiAmount || 0;
          const postAmount = postBalances.find(
            (b) => b.mint === mintAddress
          )?.uiTokenAmount?.uiAmount || 0;

          if (postAmount > preAmount) {
            successfulBuys++;
          } else if (postAmount < preAmount) {
            successfulSells++;
          }
        }
      } catch {
        // Skip individual transaction errors
      }
    }

    // Analyze the results
    if (honeypotPatternFound) {
      return {
        isHoneypot: true,
        reason: honeypotReason,
        confidence: 'high',
      };
    }

    // If there are swaps but no successful sells, suspicious
    if (totalSwaps > 5 && successfulSells === 0 && successfulBuys > 0) {
      return {
        isHoneypot: true,
        reason: `No successful sells found (${successfulBuys} buys, 0 sells in ${totalSwaps} swaps)`,
        confidence: 'medium',
      };
    }

    // High failure rate is suspicious
    if (totalSwaps > 5 && failedSwaps / totalSwaps > 0.5) {
      return {
        isHoneypot: true,
        reason: `High swap failure rate: ${failedSwaps}/${totalSwaps} (${Math.round(failedSwaps / totalSwaps * 100)}%)`,
        confidence: 'medium',
      };
    }

    // Very skewed buy/sell ratio can indicate honeypot
    if (successfulBuys > 10 && successfulSells === 0) {
      return {
        isHoneypot: true,
        reason: `Suspicious buy/sell ratio: ${successfulBuys} buys, 0 sells`,
        confidence: 'low',
      };
    }

    return { isHoneypot: false, confidence: 'high' };
  } catch (error) {
    console.error(`Error detecting honeypot for ${mintAddress}:`, error);
    return { isHoneypot: false, confidence: 'low' };
  }
}

export function assessContractRisk(analysis: ContractAnalysis): {
  score: number;
  issues: string[];
} {
  const issues: string[] = [];
  let score = 100;

  // Mint authority not revoked is a major red flag
  if (!analysis.mintAuthorityRevoked) {
    score -= 30;
    issues.push('Mint authority not revoked - unlimited tokens can be minted');
  }

  // Freeze authority not revoked
  if (!analysis.freezeAuthorityRevoked) {
    score -= 25;
    issues.push('Freeze authority not revoked - your tokens can be frozen');
  }

  // Honeypot detected
  if (analysis.isHoneypot) {
    score -= 40;
    issues.push(`Honeypot detected: ${analysis.honeypotReason}`);
  }

  // High transfer fees
  if (analysis.hasTransferFee) {
    if (analysis.transferFeePercent && analysis.transferFeePercent > 5) {
      score -= 20;
      issues.push(`High transfer fee: ${analysis.transferFeePercent}%`);
    } else {
      score -= 10;
      issues.push('Token has transfer fees');
    }
  }

  return { score: Math.max(0, score), issues };
}
