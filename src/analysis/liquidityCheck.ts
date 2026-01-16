import { solanaService } from '../services/solana';
import type { LiquidityAnalysis, PoolInfo} from '../types';
import { KNOWN_LP_LOCKERS, SOL_MINT, USDC_MINT, USDT_MINT } from '../types';
import { withRetry } from '../utils/retry';
import axios from 'axios';

// Known burn addresses
const BURN_ADDRESSES = [
  '1111111111111111111111111111111111111111111',
  '11111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
];

// Extended list of LP lockers and vaults
const LP_LOCKERS = [
  ...KNOWN_LP_LOCKERS,
  // Lock protocols
  'TLoCKic2gGJm7VhZKumih4Lc35fUhYqVMgA4j389Buk', // Team Finance
  'FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X', // FluxBeam
  '2wT8Yq49kHgDzXuPxZSaeLaH1qbmGXtEyPy64bL7aD3c', // UNCX Network
  'strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m', // StreamFlow
  'strm3EWwgSkCJ8gTpiGXz6UhM2HxWuCqzGWuFGqfFgX', // StreamFlow v2
  'LoCKbwf8GJAx3ckBPM2QRnSALH8Qf3NPwbVBj95RRMr', // Raydium Lock v2

  // Vault programs
  '8bvPnYE5Pvz2Z9dE6RAqWr1rzLknTndZ9hwvRE6kPDXP', // Meteora Vault
  'HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny', // Kamino Finance
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter (vault operations)

  // Orca whirlpools
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool

  // LP lock PDAs (common prefixes)
  'Lock', // Generic locker prefix
  'lock', // Generic locker prefix
];

// Cache for SOL price to avoid repeated API calls
let cachedSolPrice: { price: number; timestamp: number } | null = null;
const SOL_PRICE_CACHE_TTL = 60000; // 1 minute

export async function analyzeLiquidity(pool: PoolInfo): Promise<LiquidityAnalysis> {
  // Connection available if needed for on-chain lookups
  const _connection = solanaService.getConnection();

  let totalLiquidityUsd = 0;
  let lpBurned = false;
  let lpBurnedPercent = 0;
  let lpLocked = false;
  let lpLockedPercent = 0;
  let lpLockerAddress: string | undefined;

  try {
    // Get SOL price for USD calculation
    const solPrice = await getSolPrice();

    // Calculate liquidity value
    totalLiquidityUsd = await calculateLiquidityUsd(pool, solPrice);

    // Check LP token distribution
    if (pool.lpMint) {
      const lpAnalysis = await analyzeLpTokens(pool.lpMint);
      lpBurned = lpAnalysis.burnedPercent > 90;
      lpBurnedPercent = lpAnalysis.burnedPercent;
      lpLocked = lpAnalysis.lockedPercent > 50;
      lpLockedPercent = lpAnalysis.lockedPercent;
      lpLockerAddress = lpAnalysis.lockerAddress;
    }
  } catch (error) {
    console.error('Error analyzing liquidity:', error);
  }

  return {
    totalLiquidityUsd,
    lpBurned,
    lpBurnedPercent,
    lpLocked,
    lpLockedPercent,
    lpLockerAddress,
  };
}

async function getSolPrice(): Promise<number> {
  // Check cache first
  if (cachedSolPrice && Date.now() - cachedSolPrice.timestamp < SOL_PRICE_CACHE_TTL) {
    return cachedSolPrice.price;
  }

  try {
    // Try Jupiter price API with retry
    const price = await withRetry(
      async () => {
        const response = await axios.get(
          'https://price.jup.ag/v6/price?ids=SOL',
          { timeout: 5000 }
        );
        const solPrice = response.data.data?.SOL?.price;
        if (!solPrice || solPrice <= 0) {
          throw new Error('Invalid SOL price from Jupiter');
        }
        return solPrice;
      },
      { maxRetries: 2, initialDelayMs: 500 }
    );

    cachedSolPrice = { price, timestamp: Date.now() };
    return price;
  } catch {
    // Try Coingecko as fallback
    try {
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
        { timeout: 5000 }
      );
      const price = response.data?.solana?.usd;
      if (price && price > 0) {
        cachedSolPrice = { price, timestamp: Date.now() };
        return price;
      }
    } catch {
      // Both APIs failed
    }

    // Return cached price if available, otherwise log warning
    if (cachedSolPrice) {
      console.warn(`Using stale SOL price: $${cachedSolPrice.price}`);
      return cachedSolPrice.price;
    }

    console.warn('Could not fetch SOL price, using fallback of $200');
    return 200; // More reasonable fallback
  }
}

async function calculateLiquidityUsd(pool: PoolInfo, solPrice: number): Promise<number> {
  try {
    // For Raydium pools, calculate from reserves
    if (pool.baseReserve && pool.quoteReserve) {
      // If quote is SOL
      if (pool.quoteMint === SOL_MINT) {
        return pool.quoteReserve * solPrice * 2; // *2 for both sides
      }
      // If quote is USDC/USDT
      if (pool.quoteMint === USDC_MINT || pool.quoteMint === USDT_MINT) {
        return pool.quoteReserve * 2;
      }
    }

    // Fallback: try to get from DexScreener
    const dexScreenerLiquidity = await getDexScreenerLiquidity(pool.tokenMint);
    if (dexScreenerLiquidity > 0) {
      return dexScreenerLiquidity;
    }

    return 0;
  } catch {
    return 0;
  }
}

async function getDexScreenerLiquidity(tokenMint: string): Promise<number> {
  try {
    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`,
      { timeout: 5000 }
    );

    const pairs = response.data.pairs || [];
    if (pairs.length > 0) {
      // Get the highest liquidity pair
      const maxLiquidity = Math.max(...pairs.map((p: any) => p.liquidity?.usd || 0));
      return maxLiquidity;
    }
    return 0;
  } catch {
    return 0;
  }
}

async function analyzeLpTokens(lpMint: string): Promise<{
  burnedPercent: number;
  lockedPercent: number;
  lockerAddress?: string;
}> {
  try {
    // Get LP token supply
    const mintInfo = await solanaService.getMintInfo(lpMint);
    if (!mintInfo) {
      return { burnedPercent: 0, lockedPercent: 0 };
    }

    // Convert raw supply to normalized (decimals-adjusted) value
    const decimals = mintInfo.decimals;
    const totalSupplyNormalized = Number(mintInfo.supply) / Math.pow(10, decimals);

    if (totalSupplyNormalized === 0) {
      return { burnedPercent: 100, lockedPercent: 0 };
    }

    // Get all LP token holders
    // Note: holder.balance from getTokenHolders is already normalized (uiAmount)
    const holders = await solanaService.getTokenHolders(lpMint, 50);

    let burnedAmount = 0;
    let lockedAmount = 0;
    let lockerAddress: string | undefined;

    for (const holder of holders) {
      // Check if burned (sent to burn addresses)
      if (BURN_ADDRESSES.includes(holder.address)) {
        burnedAmount += holder.balance;
        continue;
      }

      // Check if locked in known lockers
      const isLocked = LP_LOCKERS.some(
        (locker) => holder.address === locker || holder.address.startsWith(locker.slice(0, 8))
      );

      if (isLocked) {
        lockedAmount += holder.balance;
        lockerAddress = holder.address;
      }
    }

    // Both burnedAmount and totalSupplyNormalized are now in the same units
    return {
      burnedPercent: Math.min(100, (burnedAmount / totalSupplyNormalized) * 100),
      lockedPercent: Math.min(100, (lockedAmount / totalSupplyNormalized) * 100),
      lockerAddress,
    };
  } catch (error) {
    console.error('Error analyzing LP tokens:', error);
    return { burnedPercent: 0, lockedPercent: 0 };
  }
}

export async function getPoolLiquidity(tokenMint: string): Promise<number> {
  return getDexScreenerLiquidity(tokenMint);
}
