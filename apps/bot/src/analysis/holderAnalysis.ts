import { solanaService } from '../services/solana';
import type { HolderAnalysis, HolderInfo, TokenInfo} from '../types';
import { TOKEN_PROGRAM_ID } from '../types';
import type { ParsedAccountData } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';

const WHALE_THRESHOLD_PERCENT = 5;
const CONCENTRATED_THRESHOLD = 50; // Top 10 holders > 50% is concentrated

// Known addresses that should be excluded from whale detection
const EXCLUDED_ADDRESSES = [
  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium Authority
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  '1111111111111111111111111111111111111111111', // Burn address
  '11111111111111111111111111111111', // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program
  'Lock7kBijGCQLEFAmXcengzXKA88iDNQPriQ7TbgeyG', // Raydium LP Locker
  'TLoCKic2gGJm7VhZKumih4Lc35fUhYqVMgA4j389Buk', // Team Finance Locker
  'FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X', // FluxBeam Locker
];

export async function analyzeHolders(token: TokenInfo): Promise<HolderAnalysis> {
  let totalHolders = 0;
  let top10HoldersPercent = 0;
  let top20HoldersPercent = 0;
  let largestHolderPercent = 0;
  let whaleAddresses: string[] = [];
  let devWalletPercent = 0;
  let isConcentrated = false;
  let topHolders: HolderInfo[] = [];

  try {
    // Get top holders
    const holders = await solanaService.getTokenHolders(token.mint, 50);

    // Filter out excluded addresses (like LP pools, burn addresses, lockers)
    const filteredHolders = holders.filter(
      (h) => !isExcludedAddress(h.address)
    );

    totalHolders = filteredHolders.length;

    if (totalHolders === 0 || token.supply === 0) {
      return {
        totalHolders: 0,
        top10HoldersPercent: 0,
        top20HoldersPercent: 0,
        largestHolderPercent: 0,
        whaleAddresses: [],
        devWalletPercent: 0,
        isConcentrated: true,
        topHolders: [],
      };
    }

    // Calculate percentages
    const totalSupply = token.supply;

    // Build topHolders with percentage info (top 10)
    topHolders = filteredHolders.slice(0, 10).map(h => ({
      address: h.address,
      balance: h.balance,
      percentage: (h.balance / totalSupply) * 100,
    }));

    // Top 10 holders
    const top10 = filteredHolders.slice(0, 10);
    const top10Total = top10.reduce((sum, h) => sum + h.balance, 0);
    top10HoldersPercent = (top10Total / totalSupply) * 100;

    // Top 20 holders
    const top20 = filteredHolders.slice(0, 20);
    const top20Total = top20.reduce((sum, h) => sum + h.balance, 0);
    top20HoldersPercent = (top20Total / totalSupply) * 100;

    // Largest holder
    if (filteredHolders.length > 0) {
      largestHolderPercent = (filteredHolders[0].balance / totalSupply) * 100;
    }

    // Detect whales (holders with > WHALE_THRESHOLD_PERCENT)
    whaleAddresses = filteredHolders
      .filter((h) => (h.balance / totalSupply) * 100 >= WHALE_THRESHOLD_PERCENT)
      .map((h) => h.address);

    // First holder is often the dev wallet
    if (filteredHolders.length > 0) {
      devWalletPercent = (filteredHolders[0].balance / totalSupply) * 100;
    }

    // Check if concentrated
    isConcentrated = top10HoldersPercent > CONCENTRATED_THRESHOLD;

    // Try to get more accurate holder count from chain
    const accurateCount = await getAccurateHolderCount(token.mint);
    if (accurateCount > totalHolders) {
      totalHolders = accurateCount;
    }
  } catch (error) {
    console.error(`Error analyzing holders for ${token.mint}:`, error);
  }

  return {
    totalHolders,
    top10HoldersPercent,
    top20HoldersPercent,
    largestHolderPercent,
    whaleAddresses,
    devWalletPercent,
    isConcentrated,
    topHolders,
  };
}

/**
 * Get accurate holder count by querying all token accounts for the mint.
 * This properly counts token accounts with non-zero balances.
 */
async function getAccurateHolderCount(mintAddress: string): Promise<number> {
  try {
    const connection = solanaService.getConnection();
    const mintPubkey = new PublicKey(mintAddress);

    // Query all token accounts for this mint using getProgramAccounts
    // This is more accurate than the previous signature-based approach
    const accounts = await connection.getParsedProgramAccounts(
      new PublicKey(TOKEN_PROGRAM_ID),
      {
        filters: [
          { dataSize: 165 }, // Token account size
          { memcmp: { offset: 0, bytes: mintPubkey.toBase58() } },
        ],
      }
    );

    // Count accounts with non-zero balance
    let holderCount = 0;
    for (const account of accounts) {
      const parsed = (account.account.data as ParsedAccountData).parsed;
      const balance = parsed?.info?.tokenAmount?.uiAmount || 0;
      if (balance > 0) {
        holderCount++;
      }
    }

    return holderCount;
  } catch (error) {
    console.error(`Error getting accurate holder count for ${mintAddress}:`, error);
    return 0;
  }
}

/**
 * Check if an address is a known LP pool, locker, or should be excluded
 */
function isExcludedAddress(address: string): boolean {
  // Check exact matches
  if (EXCLUDED_ADDRESSES.includes(address)) {
    return true;
  }

  // Check if it's a known LP/AMM pattern (Raydium pools often start with these)
  const lpPatterns = ['5Q544', 'HWHv', '7YttL', 'CAMMCzo'];
  for (const pattern of lpPatterns) {
    if (address.startsWith(pattern)) {
      return true;
    }
  }

  return false;
}

export function assessHolderRisk(analysis: HolderAnalysis): {
  score: number;
  issues: string[];
} {
  const issues: string[] = [];
  let score = 100;

  // Penalize for concentration
  if (analysis.top10HoldersPercent > 80) {
    score -= 30;
    issues.push('Top 10 holders own >80% of supply');
  } else if (analysis.top10HoldersPercent > 60) {
    score -= 20;
    issues.push('Top 10 holders own >60% of supply');
  } else if (analysis.top10HoldersPercent > 50) {
    score -= 10;
    issues.push('Top 10 holders own >50% of supply');
  }

  // Penalize for single large holder
  if (analysis.largestHolderPercent > 20) {
    score -= 25;
    issues.push(`Largest holder owns ${analysis.largestHolderPercent.toFixed(1)}% of supply`);
  } else if (analysis.largestHolderPercent > 10) {
    score -= 15;
    issues.push(`Largest holder owns ${analysis.largestHolderPercent.toFixed(1)}% of supply`);
  }

  // Penalize for whales
  if (analysis.whaleAddresses.length > 5) {
    score -= 20;
    issues.push(`${analysis.whaleAddresses.length} whale wallets detected`);
  } else if (analysis.whaleAddresses.length > 2) {
    score -= 10;
    issues.push(`${analysis.whaleAddresses.length} whale wallets detected`);
  }

  // Penalize for low holder count
  if (analysis.totalHolders < 10) {
    score -= 20;
    issues.push('Very few holders (<10)');
  } else if (analysis.totalHolders < 50) {
    score -= 10;
    issues.push('Low holder count (<50)');
  }

  return { score: Math.max(0, score), issues };
}
