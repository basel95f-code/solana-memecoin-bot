/**
 * Shared Types for Solana Memecoin Bot
 * These types are used by both the bot and the dashboard
 */

// ============================================
// Token Types
// ============================================

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
  source: 'raydium' | 'pumpfun' | 'pumpswap' | 'jupiter';
  createdAt: Date;
}

// ============================================
// Analysis Types
// ============================================

export interface LiquidityAnalysis {
  totalLiquidityUsd: number;
  lpBurned: boolean;
  lpBurnedPercent: number;
  lpLocked: boolean;
  lpLockedPercent: number;
  lpLockerAddress?: string;
  lpLockDuration?: number;
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
  topHolders: HolderInfo[];
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
  sentimentScore: number;
  positivePercent: number;
  negativePercent: number;
  neutralPercent: number;
  confidence: number;
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

export interface SmartMoneyActivity {
  mint: string;
  symbol: string;
  smartBuys24h: number;
  smartSells24h: number;
  netSmartMoney: number;
  smartMoneyHolding: number;
  isSmartMoneyBullish: boolean;
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

// ============================================
// Alert Types
// ============================================

export type AlertCategory =
  | 'new_token'
  | 'volume_spike'
  | 'whale_movement'
  | 'liquidity_drain'
  | 'authority_change'
  | 'price_alert'
  | 'smart_money'
  | 'wallet_activity';

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

export type AlertPriority = 'critical' | 'high' | 'normal' | 'low';

export interface AlertPrioritySettings {
  minPriority: AlertPriority;
  soundEnabled: boolean;
}

export const DEFAULT_PRIORITY_SETTINGS: AlertPrioritySettings = {
  minPriority: 'low',
  soundEnabled: true,
};

export const PRIORITY_ORDER: AlertPriority[] = ['low', 'normal', 'high', 'critical'];

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
// Filter Types
// ============================================

export type RiskProfile = 'sniper' | 'early' | 'balanced' | 'conservative' | 'graduation' | 'whale' | 'degen' | 'cto';
export type McapProfile = 'micro' | 'small' | 'mid' | 'large' | 'mega';
export type StrategyProfile = 'trending' | 'momentum' | 'fresh' | 'revival' | 'runner';
export type FilterProfile = RiskProfile | McapProfile | StrategyProfile | 'custom';

export interface FilterSettings {
  profile: FilterProfile;
  minLiquidity: number;
  maxLiquidity?: number;
  maxTop10Percent: number;
  maxSingleHolderPercent?: number;
  minHolders: number;
  minRiskScore: number;
  minOpportunityScore?: number;
  minTokenAge: number;
  maxTokenAge?: number;
  minMcap?: number;
  maxMcap?: number;
  requireMintRevoked: boolean;
  requireFreezeRevoked: boolean;
  requireLPBurned: boolean;
  lpBurnedMinPercent?: number;
  requireSocials: boolean;
  minBondingCurve?: number;
  maxBondingCurve?: number;
  volumeSpikeMultiplier?: number;
  minPriceChange1h?: number;
  maxPriceChange1h?: number;
  minVolume24h?: number;
  fastMode?: boolean;
  alertsEnabled: boolean;
  alertCategories: AlertCategories;
  alertPriority: AlertPrioritySettings;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  timezone: string;
  walletAlertMinSol?: number;
}

// ============================================
// Watchlist Types
// ============================================

export interface WatchedToken {
  mint: string;
  symbol: string;
  name: string;
  addedAt: number;
  addedPrice: number;
  lastPrice: number;
  lastChecked: number;
  lastAlertedAt?: number;
  priceChangePercent: number;
}

export type BlacklistType = 'token' | 'creator';

export interface BlacklistEntry {
  address: string;
  type: BlacklistType;
  label?: string;
  addedAt: number;
  reason?: string;
}

// ============================================
// Wallet Types
// ============================================

export interface TrackedWallet {
  address: string;
  label: string;
  addedAt: number;
  lastChecked: number;
  lastSignature?: string;
  lastAlertedAt?: number;
}

export interface WalletTransaction {
  signature: string;
  timestamp: number;
  type: 'buy' | 'sell' | 'transfer';
  tokenMint: string;
  tokenSymbol?: string;
  tokenName?: string;
  amount: number;
  solAmount?: number;
  priceUsd?: number;
}

export interface WalletActivityAlert {
  wallet: TrackedWallet;
  transaction: WalletTransaction;
  chatId: string;
}

// ============================================
// User Settings
// ============================================

export interface UserSettings {
  chatId: string;
  filters: FilterSettings;
  watchlist: WatchedToken[];
  blacklist: BlacklistEntry[];
  trackedWallets: TrackedWallet[];
  muteUntil?: number;
  createdAt: number;
  updatedAt: number;
}

// ============================================
// Backtest Types
// ============================================

export interface EntryConditions {
  minRiskScore?: number;
  maxRiskScore?: number;
  minLiquidity?: number;
  maxLiquidity?: number;
  minHolders?: number;
  maxHolders?: number;
  maxTop10Percent?: number;
  maxSingleHolderPercent?: number;
  requireMintRevoked?: boolean;
  requireFreezeRevoked?: boolean;
  requireLPBurned?: boolean;
  lpBurnedMinPercent?: number;
  minTokenAge?: number;
  maxTokenAge?: number;
  requireSocials?: boolean;
  requireTwitter?: boolean;
  requireTelegram?: boolean;
  minSmartBuys?: number;
}

export interface TakeProfitLevel {
  percent: number;
  sellPercent: number;
}

export interface ExitConditions {
  takeProfitLevels: TakeProfitLevel[];
  stopLossPercent: number;
  trailingStopPercent?: number;
  trailingStopActivation?: number;
  maxHoldTimeHours?: number;
  exitOnRugSignal?: boolean;
}

export type PositionSizingMethod = 'fixed' | 'percent_of_capital' | 'risk_based';

export interface PositionSizing {
  method: PositionSizingMethod;
  fixedAmount?: number;
  percentOfCapital?: number;
  riskPercent?: number;
  maxPositionSize?: number;
  maxConcurrentPositions?: number;
}

export interface BacktestStrategy {
  id?: number;
  name: string;
  description: string;
  entry: EntryConditions;
  exit: ExitConditions;
  sizing: PositionSizing;
  createdAt?: number;
  updatedAt?: number;
  isPreset?: boolean;
}

export type TradeOutcome = 'win' | 'loss' | 'breakeven' | 'stopped_out' | 'time_exit' | 'rug_exit';

export interface BacktestTrade {
  id?: number;
  runId: number;
  tokenMint: string;
  tokenSymbol: string;
  tokenName?: string;
  entryPrice: number;
  entryTime: number;
  positionSize: number;
  exitPrice: number;
  exitTime: number;
  exitReason: TradeOutcome;
  profitLoss: number;
  profitLossPercent: number;
  holdTimeSeconds: number;
  peakPrice: number;
  peakMultiplier: number;
  entryRiskScore?: number;
  entryLiquidity?: number;
  entryHolders?: number;
}

export interface EquityPoint {
  timestamp: number;
  equity: number;
  drawdown: number;
}

export interface BacktestResults {
  id?: number;
  strategyId: number;
  strategyName: string;
  startDate: number;
  endDate: number;
  daysAnalyzed: number;
  initialCapital: number;
  finalCapital: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalProfitLoss: number;
  totalReturn: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  maxDrawdown: number;
  maxDrawdownDuration: number;
  sharpeRatio: number;
  sortinoRatio: number;
  profitFactor: number;
  averageHoldTime: number;
  longestWinningStreak: number;
  longestLosingStreak: number;
  equityCurve: EquityPoint[];
  executedAt: number;
  executionTimeMs: number;
}

export interface BacktestConfig {
  strategy: BacktestStrategy;
  startDate?: Date;
  endDate?: Date;
  days?: number;
  initialCapital: number;
  includeTradeDetails?: boolean;
  verbose?: boolean;
}

export interface TokenWithOutcome {
  mint: string;
  symbol: string;
  name?: string;
  initialPrice: number;
  initialLiquidity: number;
  initialRiskScore: number;
  initialHolders: number;
  initialTop10Percent?: number;
  peakPrice: number;
  peakLiquidity?: number;
  finalPrice: number;
  finalLiquidity?: number;
  outcome: string;
  peakMultiplier: number;
  timeToPeak?: number;
  discoveredAt: number;
  peakAt?: number;
  outcomeRecordedAt?: number;
  mintRevoked?: boolean;
  freezeRevoked?: boolean;
  lpBurned?: boolean;
  lpBurnedPercent?: number;
  hasTwitter?: boolean;
  hasTelegram?: boolean;
  hasWebsite?: boolean;
  smartBuys?: number;
}

// ============================================
// DexScreener Types
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
// Trending Types
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
// Config Types
// ============================================

export interface MonitorConfig {
  enabled: boolean;
  pollInterval?: number;
}

export interface WatchlistConfig {
  enabled: boolean;
  maxTokensPerUser: number;
  checkInterval: number;
  priceAlertThreshold: number;
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

export interface ExtendedBotConfig extends BotConfig {
  watchlist: WatchlistConfig;
  rateLimit: RateLimitConfig;
  discovery: DiscoveryConfig;
  storage: StorageConfig;
  walletMonitor: WalletMonitorConfig;
}

// ============================================
// Dashboard API Types
// ============================================

export interface BotStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: string;
  uptimeMs: number;
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
  };
  checks: Record<string, {
    status: 'healthy' | 'degraded' | 'unhealthy';
    message?: string;
    latencyMs?: number;
  }>;
  version: string;
  timestamp: string;
}

export interface DiscoveryFeedItem {
  mint: string;
  symbol: string;
  name: string;
  source: string;
  riskScore: number;
  riskLevel: string;
  liquidity: number;
  holders: number;
  priceUsd?: number;
  timestamp: number;
  timeAgo: string;
}

export interface AlertHistoryItem {
  id: number;
  type: string;
  title: string;
  description: string;
  tokenMint?: string;
  tokenSymbol?: string;
  priority: AlertPriority;
  timestamp: number;
  timeAgo: string;
}

export interface PortfolioSummary {
  totalValue: number;
  change24h: number;
  changePercent24h: number;
  tokenCount: number;
  winnerCount: number;
  loserCount: number;
}

export interface DashboardStats {
  tokenCount: number;
  alertsToday: number;
  totalAnalyses: number;
  totalAlerts: number;
  discoveriesToday: number;
  activeWallets: number;
}

// ============================================
// Supabase Sync Types
// ============================================

export interface SyncMetadata {
  id: number;
  tableName: string;
  lastSyncedAt: number;
  lastSyncedId?: number;
  syncStatus: 'idle' | 'syncing' | 'error';
  errorMessage?: string;
}

export interface SyncConfig {
  enabled: boolean;
  batchSize: number;
  intervalMs: number;
  tables: {
    tokenAnalysis: boolean;
    alertHistory: boolean;
    poolDiscovery: boolean;
    backtestRuns: boolean;
    tokenSnapshots: boolean;
    botStatus: boolean;
  };
}

// ============================================
// Constants
// ============================================

export const KNOWN_LP_LOCKERS = [
  'Lock7kBijGCQLEFAmXcengzXKA88iDNQPriQ7TbgeyG',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  '1111111111111111111111111111111111111111111',
];

export const RAYDIUM_AMM_PROGRAM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
export const PUMPFUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMPSWAP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
