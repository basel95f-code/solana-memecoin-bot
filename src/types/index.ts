import { PublicKey } from '@solana/web3.js';

export interface TokenInfo {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: number;
  metadata?: TokenMetadata;
}

export interface TokenMetadata {
  name: string;
  symbol: string;
  uri?: string;
  image?: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}

export interface PoolInfo {
  address: string;
  tokenMint: string;
  baseMint: string;
  quoteMint: string;
  baseReserve: number;
  quoteReserve: number;
  lpMint: string;
  source: 'raydium' | 'pumpfun' | 'jupiter';
  createdAt: Date;
}

export interface LiquidityAnalysis {
  totalLiquidityUsd: number;
  lpBurned: boolean;
  lpBurnedPercent: number;
  lpLocked: boolean;
  lpLockedPercent: number;
  lpLockerAddress?: string;
  lpLockDuration?: number; // Lock duration in seconds (if known)
}

export interface HolderInfo {
  address: string;
  balance: number;
  percentage: number;
}

export interface HolderAnalysis {
  totalHolders: number;
  top10HoldersPercent: number;
  top20HoldersPercent: number;
  largestHolderPercent: number;
  whaleAddresses: string[];
  devWalletPercent: number;
  isConcentrated: boolean;
  topHolders: HolderInfo[]; // Top holder details for analysis
}

export interface ContractAnalysis {
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  isHoneypot: boolean;
  honeypotReason?: string;
  hasTransferFee: boolean;
  transferFeePercent?: number;
}

export interface SocialAnalysis {
  hasTwitter: boolean;
  twitterUrl?: string;
  twitterFollowers?: number;
  hasTelegram: boolean;
  telegramUrl?: string;
  telegramMembers?: number;
  hasWebsite: boolean;
  websiteUrl?: string;
  websiteAge?: number;
}

export interface SentimentAnalysis {
  hasSentimentData: boolean;
  tweetCount: number;
  sentimentScore: number; // -1 (very negative) to 1 (very positive)
  positivePercent: number;
  negativePercent: number;
  neutralPercent: number;
  confidence: number; // 0 to 1
  topPositiveTerms: string[];
  topNegativeTerms: string[];
  analyzedAt: Date;
}

export interface RugCheckResult {
  score: number;
  risks: RugCheckRisk[];
  verified: boolean;
}

export interface RugCheckRisk {
  name: string;
  description: string;
  level: 'info' | 'warning' | 'danger';
  score: number;
}

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | 'EXTREME';

export interface RiskClassification {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
}

export interface RiskFactor {
  name: string;
  impact: number;
  description: string;
  passed: boolean;
}

export interface TokenAnalysis {
  token: TokenInfo;
  pool: PoolInfo;
  liquidity: LiquidityAnalysis;
  holders: HolderAnalysis;
  contract: ContractAnalysis;
  social: SocialAnalysis;
  sentiment?: SentimentAnalysis;
  rugcheck?: RugCheckResult;
  risk: RiskClassification;
  analyzedAt: Date;
}

export interface TelegramAlert {
  token: TokenInfo;
  analysis: TokenAnalysis;
  formatted: string;
}

export interface MonitorConfig {
  enabled: boolean;
  pollInterval?: number;
}

export interface BotConfig {
  solanaRpcUrl: string;
  solanaWsUrl: string;
  telegramBotToken: string;
  telegramChatId: string;
  rugcheckApiKey?: string;
  minLiquidityUsd: number;
  minRiskScore: number;
  monitors: {
    raydium: MonitorConfig;
    pumpfun: MonitorConfig;
    jupiter: MonitorConfig;
  };
  maxRequestsPerMinute: number;
}

export interface CachedToken {
  mint: string;
  firstSeen: Date;
  lastAnalysis?: TokenAnalysis;
  alertSent: boolean;
}

export const KNOWN_LP_LOCKERS = [
  'Lock7kBijGCQLEFAmXcengzXKA88iDNQPriQ7TbgeyG', // Raydium LP Locker
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program (burn address)
  '1111111111111111111111111111111111111111111', // System Program (burn)
];

export const RAYDIUM_AMM_PROGRAM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
export const PUMPFUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// ============================================
// Filter Profiles & User Settings
// ============================================

export type FilterProfile = 'conservative' | 'balanced' | 'aggressive' | 'degen' | 'custom';

export interface FilterSettings {
  profile: FilterProfile;
  minLiquidity: number;
  maxTop10Percent: number;
  minHolders: number;
  minRiskScore: number;
  minTokenAge: number; // seconds
  requireMintRevoked: boolean;
  requireFreezeRevoked: boolean;
  requireLPBurned: boolean;
  requireSocials: boolean;
  alertsEnabled: boolean;
  quietHoursStart?: number; // 0-23
  quietHoursEnd?: number; // 0-23
  timezone: string;
}

export interface WatchedToken {
  mint: string;
  symbol: string;
  name: string;
  addedAt: number; // timestamp
  addedPrice: number;
  lastPrice: number;
  lastChecked: number; // timestamp
  lastAlertedAt?: number; // timestamp
  priceChangePercent: number;
}

export interface UserSettings {
  chatId: string;
  filters: FilterSettings;
  watchlist: WatchedToken[];
  muteUntil?: number; // timestamp
  createdAt: number;
  updatedAt: number;
}

// ============================================
// DexScreener API Types
// ============================================

export interface DexScreenerToken {
  address: string;
  name: string;
  symbol: string;
}

export interface DexScreenerTxns {
  buys: number;
  sells: number;
}

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: DexScreenerToken;
  quoteToken: DexScreenerToken;
  priceNative: string;
  priceUsd: string | null;
  txns: {
    m5: DexScreenerTxns;
    h1: DexScreenerTxns;
    h6: DexScreenerTxns;
    h24: DexScreenerTxns;
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

export interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[] | null;
}

// ============================================
// Trending & Discovery Types
// ============================================

export interface TrendingToken {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number;
  priceChange1h: number;
  priceChange24h: number;
  volume1h: number;
  volume24h: number;
  liquidity: number;
  marketCap?: number;
  txns24h: {
    buys: number;
    sells: number;
  };
  pairAddress: string;
  dexId: string;
  createdAt?: number;
}

// ============================================
// Extended Bot Config
// ============================================

export interface WatchlistConfig {
  enabled: boolean;
  maxTokensPerUser: number;
  checkInterval: number; // ms
  priceAlertThreshold: number; // percent
}

export interface RateLimitConfig {
  tokenCooldownMinutes: number;
  maxAlertsPerHour: number;
}

export interface DiscoveryConfig {
  enabled: boolean;
  cacheMinutes: number;
  newTokenHours: number;
}

export interface StorageConfig {
  dataDir: string;
}

export interface ExtendedBotConfig extends BotConfig {
  watchlist: WatchlistConfig;
  rateLimit: RateLimitConfig;
  discovery: DiscoveryConfig;
  storage: StorageConfig;
}

// ============================================
// Filter Profile Presets
// ============================================

export const FILTER_PRESETS: Record<Exclude<FilterProfile, 'custom'>, Omit<FilterSettings, 'profile' | 'alertsEnabled' | 'quietHoursStart' | 'quietHoursEnd' | 'timezone'>> = {
  conservative: {
    minLiquidity: 10000,
    maxTop10Percent: 25,
    minHolders: 100,
    minRiskScore: 75,
    minTokenAge: 3600, // 1 hour
    requireMintRevoked: true,
    requireFreezeRevoked: true,
    requireLPBurned: true,
    requireSocials: true,
  },
  balanced: {
    minLiquidity: 2000,
    maxTop10Percent: 40,
    minHolders: 25,
    minRiskScore: 50,
    minTokenAge: 600, // 10 minutes
    requireMintRevoked: true,
    requireFreezeRevoked: false,
    requireLPBurned: false,
    requireSocials: false,
  },
  aggressive: {
    minLiquidity: 500,
    maxTop10Percent: 60,
    minHolders: 10,
    minRiskScore: 30,
    minTokenAge: 120, // 2 minutes
    requireMintRevoked: false,
    requireFreezeRevoked: false,
    requireLPBurned: false,
    requireSocials: false,
  },
  degen: {
    minLiquidity: 100,
    maxTop10Percent: 90,
    minHolders: 3,
    minRiskScore: 0,
    minTokenAge: 0,
    requireMintRevoked: false,
    requireFreezeRevoked: false,
    requireLPBurned: false,
    requireSocials: false,
  },
};
