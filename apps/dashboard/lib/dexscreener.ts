/**
 * DexScreener API Client
 * Fetches trending tokens, charts, and market data
 */

const DEXSCREENER_API = 'https://api.dexscreener.com';

export interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: { label: string; url: string }[];
    socials?: { type: string; url: string }[];
  };
}

export interface TokenProfile {
  url: string;
  chainId: string;
  tokenAddress: string;
  icon?: string;
  header?: string;
  description?: string;
  links?: { type: string; label: string; url: string }[];
}

export interface BoostedToken {
  url: string;
  chainId: string;
  tokenAddress: string;
  amount: number;
  totalAmount: number;
  icon?: string;
  name?: string;
  symbol?: string;
}

// Get token pairs by address
export async function getTokenPairs(tokenAddress: string): Promise<DexPair[]> {
  try {
    const res = await fetch(`${DEXSCREENER_API}/latest/dex/tokens/${tokenAddress}`);
    const data = await res.json();
    return data.pairs || [];
  } catch (error) {
    console.error('Failed to fetch token pairs:', error);
    return [];
  }
}

// Get pair by address
export async function getPair(pairAddress: string): Promise<DexPair | null> {
  try {
    const res = await fetch(`${DEXSCREENER_API}/latest/dex/pairs/solana/${pairAddress}`);
    const data = await res.json();
    return data.pair || null;
  } catch (error) {
    console.error('Failed to fetch pair:', error);
    return null;
  }
}

// Search tokens
export async function searchTokens(query: string): Promise<DexPair[]> {
  try {
    const res = await fetch(`${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    // Filter for Solana pairs only
    return (data.pairs || []).filter((p: DexPair) => p.chainId === 'solana');
  } catch (error) {
    console.error('Failed to search tokens:', error);
    return [];
  }
}

// Get latest token profiles (trending/promoted)
export async function getTokenProfiles(): Promise<TokenProfile[]> {
  try {
    const res = await fetch(`${DEXSCREENER_API}/token-profiles/latest/v1`);
    const data = await res.json();
    // Filter for Solana
    return (data || []).filter((t: TokenProfile) => t.chainId === 'solana');
  } catch (error) {
    console.error('Failed to fetch token profiles:', error);
    return [];
  }
}

// Get boosted tokens (paid promotion = often trending)
export async function getBoostedTokens(): Promise<BoostedToken[]> {
  try {
    const res = await fetch(`${DEXSCREENER_API}/token-boosts/latest/v1`);
    const data = await res.json();
    // Filter for Solana
    return (data || []).filter((t: BoostedToken) => t.chainId === 'solana');
  } catch (error) {
    console.error('Failed to fetch boosted tokens:', error);
    return [];
  }
}

// Get top Solana pairs by volume
export async function getTopSolanaPairs(): Promise<DexPair[]> {
  try {
    // Search for popular Solana tokens to get active pairs
    const res = await fetch(`${DEXSCREENER_API}/latest/dex/search?q=SOL`);
    const data = await res.json();
    const solanaPairs = (data.pairs || [])
      .filter((p: DexPair) => p.chainId === 'solana')
      .sort((a: DexPair, b: DexPair) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
      .slice(0, 50);
    return solanaPairs;
  } catch (error) {
    console.error('Failed to fetch top pairs:', error);
    return [];
  }
}

// Get new pairs on Solana
export async function getNewPairs(): Promise<DexPair[]> {
  try {
    const res = await fetch(`${DEXSCREENER_API}/latest/dex/pairs/solana`);
    const data = await res.json();
    return (data.pairs || []).slice(0, 30);
  } catch (error) {
    console.error('Failed to fetch new pairs:', error);
    return [];
  }
}

// Generate DexScreener chart embed URL
export function getChartEmbedUrl(pairAddress: string): string {
  return `https://dexscreener.com/solana/${pairAddress}?embed=1&theme=dark&trades=0&info=0`;
}

// Generate DexScreener page URL
export function getDexScreenerUrl(pairAddress: string): string {
  return `https://dexscreener.com/solana/${pairAddress}`;
}

// Format large numbers
export function formatVolume(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

// Format price with appropriate decimals
export function formatPrice(price: string | number): string {
  const p = typeof price === 'string' ? parseFloat(price) : price;
  if (p < 0.00001) return `$${p.toExponential(2)}`;
  if (p < 0.01) return `$${p.toFixed(6)}`;
  if (p < 1) return `$${p.toFixed(4)}`;
  if (p < 1000) return `$${p.toFixed(2)}`;
  return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// Format percentage change
export function formatChange(change: number): string {
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}
