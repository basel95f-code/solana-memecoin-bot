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
  source: 'raydium' | 'pumpfun' | 'pumpswap' | 'jupiter' | 'meteora' | 'orca';
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
  whaleCount: number;
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

// ============================================
// Multi-Platform Sentiment Types
// ============================================

export type SentimentPlatform = 'twitter' | 'telegram' | 'discord';

export interface PlatformSentimentData {
  platform: SentimentPlatform;
  messageCount: number;
  sentimentScore: number; // -1 (very negative) to 1 (very positive)
  positivePercent: number;
  negativePercent: number;
  neutralPercent: number;
  confidence: number; // 0 to 1
  topPositiveTerms: string[];
  topNegativeTerms: string[];
  analyzedAt: Date;
}

export interface MultiPlatformSentimentAnalysis extends SentimentAnalysis {
  platforms: PlatformSentimentData[];
  telegramMessageCount?: number;
  discordMessageCount?: number;
  totalMessageCount: number;
  platformsAnalyzed: SentimentPlatform[];
}

export interface MonitoredChannel {
  id: string;
  name: string;
  platform: 'telegram' | 'discord';
  addedAt: number;
}

export interface SentimentChannelConfig {
  telegramChannels: MonitoredChannel[];
  discordChannels: MonitoredChannel[];
  enabled: boolean;
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
  smartMoney?: SmartMoneyActivity;
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
    meteora?: MonitorConfig;
    orca?: MonitorConfig;
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
export const PUMPSWAP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'; // PumpSwap DEX (graduation destination)
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// ============================================
// Alert Categories
// ============================================

export type AlertCategory =
  | 'new_token'       // New token discovered
  | 'volume_spike'    // Volume spike detection
  | 'whale_movement'  // Whale buy/sell alerts
  | 'liquidity_drain' // Liquidity removal alerts
  | 'authority_change'// Mint/freeze authority changes
  | 'price_alert'     // Watchlist price alerts
  | 'smart_money'     // Smart money activity
  | 'wallet_activity';// Tracked wallet activity

export interface AlertCategories {
  new_token: boolean;
  volume_spike: boolean;
  whale_movement: boolean;
  liquidity_drain: boolean;
  authority_change: boolean;
  price_alert: boolean;
  smart_money: boolean;
  wallet_activity: boolean;
}

export const DEFAULT_ALERT_CATEGORIES: AlertCategories = {
  new_token: true,
  volume_spike: true,
  whale_movement: true,
  liquidity_drain: true,
  authority_change: true,
  price_alert: true,
  smart_money: true,
  wallet_activity: true,
};

// ============================================
// Alert Priority Levels
// ============================================

export type AlertPriority = 'critical' | 'high' | 'normal' | 'low';

export interface AlertPrioritySettings {
  minPriority: AlertPriority;  // Only show alerts at or above this level
  soundEnabled: boolean;       // Play sound for critical alerts (Telegram notification)
}

export const DEFAULT_PRIORITY_SETTINGS: AlertPrioritySettings = {
  minPriority: 'low',          // Show all alerts by default
  soundEnabled: true,
};

// Priority level order (higher index = higher priority)
export const PRIORITY_ORDER: AlertPriority[] = ['low', 'normal', 'high', 'critical'];

// Default priority for each alert category
export const DEFAULT_CATEGORY_PRIORITIES: Record<AlertCategory, AlertPriority> = {
  new_token: 'normal',
  volume_spike: 'normal',
  whale_movement: 'high',
  liquidity_drain: 'critical',
  authority_change: 'critical',
  price_alert: 'normal',
  smart_money: 'high',
  wallet_activity: 'high',
};

// ============================================
// Filter Profiles & User Settings
// ============================================

// Risk-based profiles
export type RiskProfile = 'sniper' | 'early' | 'balanced' | 'conservative' | 'graduation' | 'whale' | 'degen' | 'cto';
// Market cap profiles
export type McapProfile = 'micro' | 'small' | 'mid' | 'large' | 'mega';
// Strategy profiles
export type StrategyProfile = 'trending' | 'momentum' | 'fresh' | 'revival' | 'runner';
// All profiles
export type FilterProfile = RiskProfile | McapProfile | StrategyProfile | 'custom';

export interface FilterSettings {
  profile: FilterProfile;
  // Liquidity filters
  minLiquidity: number;
  maxLiquidity?: number;
  // Holder filters
  maxTop10Percent: number;
  maxSingleHolderPercent?: number;
  minHolders: number;
  // Risk/Score filters
  minRiskScore: number;
  minOpportunityScore?: number;
  // Token age filters (seconds)
  minTokenAge: number;
  maxTokenAge?: number;
  // Market cap filters
  minMcap?: number;
  maxMcap?: number;
  // Safety requirements
  requireMintRevoked: boolean;
  requireFreezeRevoked: boolean;
  requireLPBurned: boolean;
  lpBurnedMinPercent?: number;
  requireSocials: boolean;
  // Pump.fun specific
  minBondingCurve?: number;
  maxBondingCurve?: number;
  // Volume/momentum filters
  volumeSpikeMultiplier?: number;
  minPriceChange1h?: number;
  maxPriceChange1h?: number;
  minVolume24h?: number;
  // Smart money filters
  minSmartBuys?: number;           // Minimum smart money buys in 24h
  minSmartFlow?: number;            // Minimum net smart money flow (buys - sells)
  requireSmartMoney?: boolean;      // Only alert if smart money is active
  // Mode settings
  fastMode?: boolean;
  alertsEnabled: boolean;
  alertCategories: AlertCategories;
  alertPriority: AlertPrioritySettings;
  quietHoursStart?: number; // 0-23
  quietHoursEnd?: number; // 0-23
  timezone: string;
  // Wallet tracking settings
  walletAlertMinSol?: number;  // Minimum SOL value to alert (default: 0)
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

export type BlacklistType = 'token' | 'creator';

export interface BlacklistEntry {
  address: string;      // Token mint or creator wallet address
  type: BlacklistType;  // 'token' or 'creator'
  label?: string;       // Optional label (symbol, name, or note)
  addedAt: number;      // timestamp
  reason?: string;      // Optional reason for blacklisting
}

// ============================================
// Wallet Tracking Types
// ============================================

export interface TrackedWallet {
  address: string;           // Wallet public key
  label: string;             // User-defined label (e.g., "Whale #1", "Influencer X")
  addedAt: number;           // Timestamp
  lastChecked: number;       // Last poll timestamp
  lastSignature?: string;    // Last processed tx signature (for pagination)
  lastAlertedAt?: number;    // Cooldown tracking
}

export interface WalletTransaction {
  signature: string;
  timestamp: number;
  type: 'buy' | 'sell' | 'transfer';
  tokenMint: string;
  tokenSymbol?: string;
  tokenName?: string;
  amount: number;            // Token amount
  solAmount?: number;        // SOL value if swap
  priceUsd?: number;         // USD value if available
}

export interface WalletActivityAlert {
  wallet: TrackedWallet;
  transaction: WalletTransaction;
  chatId: string;
}

// ============================================
// Preset Types
// ============================================

export interface FilterPresetSettings {
  name: string;
  filters: FilterSettings;
  createdAt: number;
  description?: string;
}

export interface SharedPreset {
  name: string;
  filters: Omit<FilterSettings, 'alertsEnabled' | 'alertCategories' | 'alertPriority' | 'quietHoursStart' | 'quietHoursEnd' | 'timezone'>;
  description?: string;
  version: number; // For future compatibility
}

export interface UserSettings {
  chatId: string;
  filters: FilterSettings;
  watchlist: WatchedToken[];
  blacklist: BlacklistEntry[];
  trackedWallets: TrackedWallet[];
  presets: FilterPresetSettings[]; // User-saved presets
  sentimentChannels?: SentimentChannelConfig;
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

export interface WalletMonitorConfig {
  enabled: boolean;
  pollIntervalMs: number;
  maxWalletsPerUser: number;
}

export interface TelegramMtprotoConfig {
  apiId: number;
  apiHash: string;
  sessionString: string;
  enabled: boolean;
}

export interface DiscordBotConfig {
  token: string;
  enabled: boolean;
}

export interface SentimentConfig {
  enabled: boolean;
  twitterEnabled: boolean;
  telegramEnabled: boolean;
  discordEnabled: boolean;
  defaultTelegramChannels: string[];
  defaultDiscordChannels: string[];
}

export interface ExtendedBotConfig extends BotConfig {
  watchlist: WatchlistConfig;
  rateLimit: RateLimitConfig;
  discovery: DiscoveryConfig;
  storage: StorageConfig;
  walletMonitor: WalletMonitorConfig;
  telegramMtproto: TelegramMtprotoConfig;
  discordBot: DiscordBotConfig;
  sentiment: SentimentConfig;
  ADMIN_CHAT_ID?: string;
  ADMIN_USER_IDS?: string[];
}

// ============================================
// Filter Profile Presets
// ============================================

// ============================================
// GMGN.ai API Types
// ============================================

export interface GMGNToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
  price: number;
  price_change_percent?: number;
  price_change_1h?: number;
  price_change_6h?: number;
  price_change_24h?: number;
  volume_24h?: number;
  swaps?: number;
  buys?: number;
  sells?: number;
  liquidity?: number;
  market_cap?: number;
  fdv?: number;
  holder_count?: number;
  // Smart money metrics
  smart_buy_24h?: number;
  smart_sell_24h?: number;
  smart_net_buy_24h?: number;
  smart_money_holding?: number;
  // Safety metrics
  is_honeypot?: boolean;
  is_verified?: boolean;
  is_renounced?: boolean;
  open_timestamp?: number;
  // Additional metadata
  pool_address?: string;
  dex?: string;
}

export interface GMGNResponse {
  code: number;
  msg: string;
  data: {
    rank: GMGNToken[];
  };
}

export interface GMGNTokenInfoResponse {
  code: number;
  msg: string;
  data: {
    token: GMGNToken;
    pools?: any[];
    holders?: any[];
  };
}

export interface SmartMoneyActivity {
  mint: string;
  symbol: string;
  smartBuys24h: number;
  smartSells24h: number;
  netSmartMoney: number;
  smartMoneyHolding: number;
  isSmartMoneyBullish: boolean;
}

// Base filter settings type for presets (excludes user-specific fields)
type FilterPreset = Omit<FilterSettings, 'profile' | 'alertsEnabled' | 'alertCategories' | 'alertPriority' | 'quietHoursStart' | 'quietHoursEnd' | 'timezone'>;

// ============================================
// Backtest Types (re-exported from backtest module)
// ============================================

export type {
  EntryConditions,
  ExitConditions,
  TakeProfitLevel,
  PositionSizing,
  PositionSizingMethod,
  BacktestStrategy,
  BacktestTrade,
  BacktestResults,
  BacktestConfig,
  TokenWithOutcome,
  TradeOutcome,
  EquityPoint,
} from '../backtest/types';

// ============================================
// Filter Profile Presets
// ============================================

export const FILTER_PRESETS: Record<Exclude<FilterProfile, 'custom'>, FilterPreset> = {
  // ==========================================
  // RISK-BASED PROFILES
  // ==========================================

  // 🎯 SNIPER: Catch tokens at birth, maximum risk
  sniper: {
    minLiquidity: 100,
    maxTop10Percent: 80,
    minHolders: 3,
    minRiskScore: 0,
    minTokenAge: 0,
    maxTokenAge: 60, // Max 1 minute old
    minSmartBuys: 1,            // At least 1 smart money buy for validation
    requireMintRevoked: false,
    requireFreezeRevoked: false,
    requireLPBurned: false,
    requireSocials: false,
    fastMode: true,
  },

  // ⚡ EARLY: Early entry with basic safety
  early: {
    minLiquidity: 500,
    maxTop10Percent: 60,
    minHolders: 10,
    minRiskScore: 20,
    minTokenAge: 0,
    maxTokenAge: 600, // Max 10 minutes old
    minSmartBuys: 1,            // Want at least 1 smart money buy
    requireMintRevoked: true,
    requireFreezeRevoked: false,
    requireLPBurned: false,
    requireSocials: false,
  },

  // ⚖️ BALANCED: Default moderate risk
  balanced: {
    minLiquidity: 2000,
    maxTop10Percent: 40,
    maxSingleHolderPercent: 10,
    minHolders: 25,
    minRiskScore: 50,
    minTokenAge: 600, // 10 minutes
    requireMintRevoked: true,
    requireFreezeRevoked: false,
    requireLPBurned: false,
    requireSocials: false,
  },

  // 🛡️ CONSERVATIVE: Safe, established tokens
  conservative: {
    minLiquidity: 10000,
    maxTop10Percent: 25,
    maxSingleHolderPercent: 5,
    minHolders: 100,
    minRiskScore: 70,
    minTokenAge: 3600, // 1 hour
    minSmartBuys: 2,            // Want some smart money validation
    minSmartFlow: 1,            // Positive smart money flow
    requireMintRevoked: true,
    requireFreezeRevoked: true,
    requireLPBurned: true,
    lpBurnedMinPercent: 50,
    requireSocials: true,
  },

  // 🎓 GRADUATION: Track Pump.fun graduation
  graduation: {
    minLiquidity: 5000,
    maxTop10Percent: 50,
    minHolders: 50,
    minRiskScore: 40,
    minTokenAge: 0,
    minBondingCurve: 70,
    maxBondingCurve: 95,
    minSmartBuys: 2,            // Want smart money interest at graduation
    minSmartFlow: 1,            // Positive smart flow
    requireMintRevoked: false,
    requireFreezeRevoked: false,
    requireLPBurned: false,
    requireSocials: false,
  },

  // 🐋 WHALE: Only alert on whale activity
  whale: {
    minLiquidity: 5000,
    maxTop10Percent: 100, // No limit - we're tracking whales
    minHolders: 20,
    minRiskScore: 30,
    minTokenAge: 0,
    minVolume24h: 50000,
    minSmartBuys: 3,           // At least 3 smart money buys
    minSmartFlow: 2,            // Net positive smart money flow
    requireSmartMoney: true,    // Must have smart money activity
    requireMintRevoked: false,
    requireFreezeRevoked: false,
    requireLPBurned: false,
    requireSocials: false,
  },

  // 🎰 DEGEN: Alert on everything
  degen: {
    minLiquidity: 50,
    maxTop10Percent: 100,
    minHolders: 1,
    minRiskScore: 0,
    minTokenAge: 0,
    requireMintRevoked: false,
    requireFreezeRevoked: false,
    requireLPBurned: false,
    requireSocials: false,
  },

  // 🔍 CTO: Community takeover plays
  cto: {
    minLiquidity: 1000,
    maxTop10Percent: 50,
    minHolders: 30,
    minRiskScore: 30,
    minTokenAge: 86400, // 24 hours minimum
    maxTokenAge: 604800, // 7 days maximum
    minMcap: 10000,
    maxMcap: 250000,
    requireMintRevoked: true, // Dev abandoned = mint revoked
    requireFreezeRevoked: true,
    requireLPBurned: false,
    requireSocials: false,
  },

  // ==========================================
  // MARKET CAP PROFILES
  // ==========================================

  // 💎 MICRO: High risk/high reward gems
  micro: {
    minLiquidity: 100,
    maxTop10Percent: 70,
    minHolders: 5,
    minRiskScore: 0,
    minTokenAge: 0,
    minMcap: 1000,
    maxMcap: 50000,
    requireMintRevoked: false,
    requireFreezeRevoked: false,
    requireLPBurned: false,
    requireSocials: false,
  },

  // 🥉 SMALL: Small cap plays
  small: {
    minLiquidity: 1000,
    maxTop10Percent: 50,
    minHolders: 30,
    minRiskScore: 30,
    minTokenAge: 300,
    minMcap: 50000,
    maxMcap: 500000,
    requireMintRevoked: true,
    requireFreezeRevoked: false,
    requireLPBurned: false,
    requireSocials: false,
  },

  // 🥈 MID: More established tokens
  mid: {
    minLiquidity: 10000,
    maxTop10Percent: 35,
    minHolders: 100,
    minRiskScore: 50,
    minTokenAge: 1800,
    minMcap: 500000,
    maxMcap: 5000000,
    requireMintRevoked: true,
    requireFreezeRevoked: true,
    requireLPBurned: false,
    requireSocials: false,
  },

  // 🥇 LARGE: Safer plays
  large: {
    minLiquidity: 50000,
    maxTop10Percent: 25,
    minHolders: 500,
    minRiskScore: 60,
    minTokenAge: 3600,
    minMcap: 5000000,
    maxMcap: 50000000,
    requireMintRevoked: true,
    requireFreezeRevoked: true,
    requireLPBurned: true,
    requireSocials: true,
  },

  // 👑 MEGA: Blue chip memecoins only
  mega: {
    minLiquidity: 100000,
    maxTop10Percent: 20,
    minHolders: 1000,
    minRiskScore: 70,
    minTokenAge: 86400,
    minMcap: 50000000,
    requireMintRevoked: true,
    requireFreezeRevoked: true,
    requireLPBurned: true,
    requireSocials: true,
  },

  // ==========================================
  // STRATEGY PROFILES
  // ==========================================

  // 🔥 TRENDING: Volume spike detection
  trending: {
    minLiquidity: 2000,
    maxTop10Percent: 50,
    minHolders: 20,
    minRiskScore: 30,
    minTokenAge: 0,
    volumeSpikeMultiplier: 3, // 3x volume spike
    minSmartBuys: 2,            // Smart money confirmation
    minSmartFlow: 1,            // Positive flow
    requireMintRevoked: false,
    requireFreezeRevoked: false,
    requireLPBurned: false,
    requireSocials: false,
  },

  // 📈 MOMENTUM: Price up with volume
  momentum: {
    minLiquidity: 2000,
    maxTop10Percent: 50,
    minHolders: 30,
    minRiskScore: 30,
    minTokenAge: 300,
    minPriceChange1h: 50, // Up 50%+ in 1h
    volumeSpikeMultiplier: 2,
    requireMintRevoked: false,
    requireFreezeRevoked: false,
    requireLPBurned: false,
    requireSocials: false,
  },

  // 🆕 FRESH: Catch at birth
  fresh: {
    minLiquidity: 100,
    maxTop10Percent: 80,
    minHolders: 3,
    minRiskScore: 0,
    minTokenAge: 0,
    maxTokenAge: 300, // Max 5 minutes old
    minSmartBuys: 1,            // At least 1 smart money buy
    requireMintRevoked: false,
    requireFreezeRevoked: false,
    requireLPBurned: false,
    requireSocials: false,
    fastMode: true,
  },

  // 💀 REVIVAL: Down 80%+ from ATH, volume comeback
  revival: {
    minLiquidity: 1000,
    maxTop10Percent: 60,
    minHolders: 20,
    minRiskScore: 20,
    minTokenAge: 3600,
    maxPriceChange1h: -80, // Down 80% from recent high
    volumeSpikeMultiplier: 2,
    requireMintRevoked: true,
    requireFreezeRevoked: false,
    requireLPBurned: false,
    requireSocials: false,
  },

  // 🏃 RUNNER: Already pumping, ride momentum
  runner: {
    minLiquidity: 5000,
    maxTop10Percent: 40,
    minHolders: 50,
    minRiskScore: 40,
    minTokenAge: 600,
    minPriceChange1h: 100, // Up 100%+ today
    minVolume24h: 100000,
    requireMintRevoked: true,
    requireFreezeRevoked: false,
    requireLPBurned: false,
    requireSocials: false,
  },
};
