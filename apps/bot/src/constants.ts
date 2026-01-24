/**
 * Centralized configuration constants
 * All hardcoded values extracted for easy tuning and maintenance
 */

// ============================================
// Queue & Processing Settings
// ============================================
export const QUEUE = {
  MAX_SIZE: 500,
  WARNING_THRESHOLD: 400,
  OVERFLOW_EVICTION_COUNT: 50,
  PROCESS_DELAY_MS: 200, // Reduced from 1000ms - delay between batches
  EMPTY_QUEUE_CHECK_MS: 100,
  RATE_LIMIT_WAIT_MS: 5000,
  CONCURRENCY: 5, // Process up to 5 tokens in parallel
  LOCK_TIMEOUT_MS: 1000, // Max wait for queue lock
} as const;

// ============================================
// Cache Settings
// ============================================
export const CACHE = {
  TOKEN_MAX_AGE_MS: 24 * 60 * 60 * 1000, // 24 hours
  TOKEN_MAX_SIZE: 10000,
  EVICTION_BATCH_SIZE: 100,
  DEXSCREENER_TTL_MS: 60000, // 60 seconds
  SOL_PRICE_TTL_MS: 60000, // 60 seconds
} as const;

// ============================================
// Price & Liquidity Settings
// ============================================
export const PRICE = {
  SOL_FALLBACK_USD: 150, // Conservative fallback (was $200)
  MIN_LIQUIDITY_ALERT: 1000, // $1000 minimum for alert
  VERY_LOW_LIQUIDITY: 100, // Critical warning threshold
} as const;

// ============================================
// Holder Analysis Thresholds
// ============================================
export const HOLDERS = {
  WHALE_THRESHOLD_PERCENT: 5,
  CONCENTRATED_THRESHOLD: 50, // Top 10 > 50% is concentrated
  CRITICAL_SINGLE_HOLDER_PERCENT: 30,
  DANGEROUS_SINGLE_HOLDER_PERCENT: 50,
} as const;

// ============================================
// Risk Scoring Thresholds
// ============================================
export const RISK_THRESHOLDS = {
  LIQUIDITY: {
    EXCELLENT: 50000,
    GOOD: 20000,
    MODERATE: 10000,
    LOW: 5000,
    VERY_LOW: 1000,
  },
  TOP_10_PERCENT: {
    SAFE: 30,
    MODERATE: 50,
    HIGH: 70,
    VERY_HIGH: 85,
    EXTREME: 95,
  },
  LARGEST_HOLDER: {
    SAFE: 10,
    WARNING: 20,
  },
  HOLDER_COUNT: {
    VERY_LOW: 10,
    LOW: 50,
  },
  WHALE_COUNT: {
    WARNING: 2,
    DANGER: 5,
  },
} as const;

// ============================================
// LP Analysis Thresholds
// ============================================
export const LP = {
  BURNED_THRESHOLD_PERCENT: 90, // >90% considered burned
  LOCKED_THRESHOLD_PERCENT: 50, // >50% considered locked
  LOCK_DURATION_SCORES: {
    YEAR: 365 * 24 * 60 * 60, // 365 days in seconds
    HALF_YEAR: 180 * 24 * 60 * 60,
    QUARTER: 90 * 24 * 60 * 60,
    MONTH: 30 * 24 * 60 * 60,
    WEEK: 7 * 24 * 60 * 60,
    DAY: 24 * 60 * 60,
  },
} as const;

// ============================================
// Token Age Thresholds (for risk scoring)
// ============================================
export const TOKEN_AGE = {
  SAFE_HOURS: 24,
  MODERATE_HOURS: 6,
  NEW_HOURS: 1,
  VERY_NEW_MINUTES: 10,
} as const;

// ============================================
// Advanced Monitor Settings
// ============================================
export const ADVANCED_MONITOR = {
  VOLUME_SPIKE_MULTIPLIER: 5, // 5x normal volume triggers alert
  LIQUIDITY_DRAIN_PERCENT: 30, // 30% removal triggers alert
  WHALE_MOVEMENT_PERCENT: 3, // 3% supply moved triggers alert
  CRITICAL_VOLUME_MULTIPLIER: 10, // 10x for critical severity
  ALERT_COOLDOWN_MS: 30 * 60 * 1000, // 30 minutes
  POLL_INTERVAL_MS: 120000, // 2 minutes
  HISTORY_MAX_AGE_MS: 24 * 60 * 60 * 1000, // 24 hours
} as const;

// ============================================
// Monitor Polling Settings
// ============================================
export const MONITORS = {
  PUMPFUN: {
    DEFAULT_POLL_INTERVAL_MS: 10000, // 10 seconds
    CLEANUP_INTERVAL_MS: 300000, // 5 minutes
    SEEN_TOKENS_MAX: 5000,
    SEEN_TOKENS_MAX_AGE_MS: 24 * 60 * 60 * 1000, // 24 hours
  },
  JUPITER: {
    DEFAULT_POLL_INTERVAL_MS: 30000, // 30 seconds
    RECOVERY_INTERVAL_MS: 120000, // 2 minutes
    CIRCUIT_BREAKER_THRESHOLD: 5,
    CIRCUIT_BREAKER_RESET_MS: 300000, // 5 minutes
  },
  RAYDIUM: {
    MIN_POOL_DATA_SIZE: 300, // Minimum bytes for valid pool data
  },
} as const;

// ============================================
// Retry & Resilience Settings
// ============================================
export const RETRY = {
  MAX_RETRIES: 3,
  INITIAL_DELAY_MS: 1000,
  MAX_DELAY_MS: 30000,
  BACKOFF_MULTIPLIER: 2,
} as const;

export const CIRCUIT_BREAKER = {
  DEFAULT_THRESHOLD: 5,
  DEFAULT_RESET_MS: 60000,
} as const;

export const RATE_LIMITER = {
  DEFAULT_MAX_TOKENS: 10,
  DEFAULT_REFILL_RATE: 1,
  DEFAULT_REFILL_INTERVAL_MS: 1000,
} as const;

// ============================================
// Analysis Timeout Settings
// ============================================
export const TIMEOUTS = {
  FULL_ANALYSIS_MS: 30000, // 30 seconds overall
  TOKEN_INFO_MS: 10000, // 10 seconds
  LIQUIDITY_MS: 15000,
  HOLDERS_MS: 15000,
  CONTRACT_MS: 15000,
  SOCIAL_MS: 10000,
  RUGCHECK_MS: 10000,
  HTTP_REQUEST_MS: 5000, // Default HTTP timeout
  WHOIS_LOOKUP_MS: 10000,
} as const;

// ============================================
// Contract Analysis Settings
// ============================================
export const CONTRACT = {
  TOKEN_ACCOUNT_SIZE: 165, // Standard SPL token account size
  TOKEN_2022_MIN_SIZE: 200, // Minimum size for Token-2022 with extensions
  HONEYPOT_SAMPLE_COUNT: 30, // Number of transactions to sample
  HONEYPOT_SIGNATURE_LIMIT: 100, // Max signatures to fetch
} as const;

// ============================================
// Social Verification Settings
// ============================================
export const SOCIAL = {
  LOW_TWITTER_FOLLOWERS: 1000,
  LOW_TELEGRAM_MEMBERS: 500,
  WEBSITE_MIN_AGE_DAYS: 30,
} as const;

// ============================================
// Sentiment Analysis Settings
// ============================================
export const SENTIMENT = {
  CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes
  STALE_CACHE_TTL_MS: 30 * 60 * 1000, // 30 minutes for rate limit fallback
  MAX_TWEETS: 100,
  MIN_TWEETS_FOR_CONFIDENCE: 10,
  HIGH_CONFIDENCE_TWEETS: 50,
  VERY_POSITIVE_THRESHOLD: 0.5,
  POSITIVE_THRESHOLD: 0.2,
  NEGATIVE_THRESHOLD: -0.2,
  VERY_NEGATIVE_THRESHOLD: -0.5,
  TWITTER_RATE_LIMIT: 450, // requests per 15-minute window
  TWITTER_RATE_LIMIT_BUFFER: 10, // reserve some capacity
} as const;

// ============================================
// Risk Scoring Penalties
// ============================================
export const RISK_PENALTIES = {
  // Holder concentration
  TOP_10_OVER_80: -30,
  TOP_10_OVER_60: -20,
  TOP_10_OVER_50: -10,

  // Single holder
  SINGLE_OVER_20: -25,
  SINGLE_OVER_10: -15,

  // Whales
  WHALES_OVER_5: -20,
  WHALES_OVER_2: -10,

  // Holder count
  HOLDERS_UNDER_10: -20,
  HOLDERS_UNDER_50: -10,

  // Social
  NO_SOCIALS: -30,
  MISSING_TWITTER: -15,
  MISSING_TELEGRAM: -10,
  MISSING_WEBSITE: -10,
  LOW_FOLLOWERS: -10,
} as const;

// ============================================
// Known Addresses & Programs
// ============================================
export const PROGRAMS = {
  TOKEN_PROGRAM: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  TOKEN_2022_PROGRAM: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  RAYDIUM_AMM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  PUMPFUN: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  ASSOCIATED_TOKEN: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
} as const;

export const MINTS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
} as const;

export const EXCLUDED_ADDRESSES = [
  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium Authority
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  '1111111111111111111111111111111111111111111', // Burn address
  '11111111111111111111111111111111', // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program
  'Lock7kBijGCQLEFAmXcengzXKA88iDNQPriQ7TbgeyG', // Raydium LP Locker
  'TLoCKic2gGJm7VhZKumih4Lc35fUhYqVMgA4j389Buk', // Team Finance Locker
  'FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X', // FluxBeam Locker
] as const;

export const LP_PATTERNS = ['5Q544', 'HWHv', '7YttL', 'CAMMCzo'] as const;

export const LP_LOCKERS = [
  'Lock7kBijGCQLEFAmXcengzXKA88iDNQPriQ7TbgeyG', // Raydium LP Locker
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program (burn address)
  '1111111111111111111111111111111111111111111', // System Program (burn)
  'TLoCKic2gGJm7VhZKumih4Lc35fUhYqVMgA4j389Buk', // Team Finance Locker
  'FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X', // FluxBeam Locker
] as const;

// ============================================
// DEX Programs for Honeypot Detection
// ============================================
export const DEX_PROGRAMS = {
  RAYDIUM_AMM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  RAYDIUM_CPMM: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
  ORCA_WHIRLPOOL: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  ORCA_V1: '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP',
  JUPITER_V6: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  PHOENIX: 'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY',
  PUMPFUN: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
} as const;

// ============================================
// Cleanup & Maintenance Intervals
// ============================================
export const CLEANUP = {
  MAIN_LOOP_INTERVAL_MS: 60000, // 1 minute
  ALERT_HISTORY_MAX_AGE_MS: 24 * 60 * 60 * 1000, // 24 hours
} as const;

// ============================================
// Wallet Monitor Settings
// ============================================
export const WALLET_MONITOR = {
  FALLBACK_POLL_INTERVAL_MS: 30000, // 30 seconds fallback polling
  MAX_SIGNATURES_PER_WALLET: 20,
  TX_CACHE_TTL_MS: 300000, // 5 minutes
  ALERT_COOLDOWN_MS: 10000, // 10 seconds between alerts for same wallet
  WS_RECONNECT_DELAY_MS: 5000, // 5 seconds before reconnect attempt
  WS_MAX_RECONNECT_ATTEMPTS: 5,
  SIGNATURE_PROCESS_DELAY_MS: 100, // Small delay to let transaction finalize
  METADATA_CACHE_TTL_MS: 300000, // 5 minutes
} as const;

// ============================================
// API Server Settings
// ============================================
export const API = {
  PORT: 3001,
  MAX_RECENT_ITEMS: 50, // Max recent discoveries/alerts to keep
  HEALTH_CHECK_TIMEOUT_MS: 5000, // RPC health check timeout
} as const;

// ============================================
// Outcome Tracker Settings
// ============================================
export const OUTCOME_TRACKER = {
  POLL_INTERVAL_MS: 30 * 60 * 1000, // 30 minutes
  MAX_TRACKING_DURATION_MS: 48 * 60 * 60 * 1000, // 48 hours
  DATA_RETENTION_DAYS: 30, // Keep outcome data for 30 days
  RUG_THRESHOLD_PERCENT: -90, // Price drop > 90% = rug
  PUMP_THRESHOLD_PERCENT: 100, // Price increase > 100% = pump
  DECLINE_THRESHOLD_PERCENT: -50, // Price drop > 50% = decline
} as const;

// ============================================
// Telegram Settings
// ============================================
export const TELEGRAM = {
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  RETRY_BACKOFF_MULTIPLIER: 2,
  MAX_MESSAGE_LENGTH: 4096,
} as const;

// ============================================
// Trading Signal Settings
// ============================================
export const SIGNALS = {
  // Confidence thresholds
  MIN_BUY_CONFIDENCE: 60,
  MIN_SELL_CONFIDENCE: 50,

  // Risk thresholds
  MAX_RUG_PROBABILITY: 0.30,
  MIN_RISK_SCORE: 40,

  // Confidence calculation weights
  WEIGHTS: {
    RUG_PROBABILITY: 0.30, // ML rug predictor
    RISK_SCORE: 0.15, // Risk score
    SMART_MONEY: 0.25, // GMGN activity
    MOMENTUM: 0.20, // Volume/price momentum
    HOLDERS: 0.10, // Holder distribution
  },

  // Timing
  EXPIRY_SECONDS: 3600, // 1 hour
  TOKEN_COOLDOWN_SECONDS: 1800, // 30 minutes between signals for same token
  MAX_ACTIVE_SIGNALS: 20,

  // Position sizing defaults
  DEFAULT_POSITION_PERCENT: 5,
  MAX_POSITION_PERCENT: 10,
  MIN_POSITION_PERCENT: 1,
  DEFAULT_POSITION_SOL: 0.1,
  MAX_POSITION_SOL: 1,
  MIN_POSITION_SOL: 0.05,

  // Webhook settings
  WEBHOOK_TIMEOUT_MS: 10000,
  WEBHOOK_MAX_RETRIES: 3,
  WEBHOOK_RETRY_DELAY_MS: 1000,
  WEBHOOK_BACKOFF_MULTIPLIER: 2,

  // Discord embed colors (decimal)
  COLORS: {
    BUY: 0x00FF00, // Green
    SELL: 0xFF0000, // Red
    TAKE_PROFIT: 0x00BFFF, // Deep sky blue
    STOP_LOSS: 0xFF6347, // Tomato
    INFO: 0x7289DA, // Discord blurple
  },
} as const;

// ============================================
// ML Training Settings
// ============================================
export const ML_TRAINING = {
  // Auto-training triggers
  MIN_SAMPLES_FOR_TRAINING: 100,
  MIN_NEW_SAMPLES_FOR_RETRAIN: 20,
  MIN_HOURS_BETWEEN_TRAINING: 24,

  // Training hyperparameters
  EPOCHS: 50,
  BATCH_SIZE: 32,
  LEARNING_RATE: 0.001,

  // Data split
  TRAIN_SPLIT: 0.70,
  VALIDATION_SPLIT: 0.15,
  TEST_SPLIT: 0.15,

  // Feature normalization
  MAX_LIQUIDITY_USD: 1000000, // $1M for normalization
  MAX_HOLDER_COUNT: 10000,
  MAX_TOKEN_AGE_HOURS: 168, // 1 week

  // Model versioning
  MODEL_DIR: 'models',
  MAX_MODELS_TO_KEEP: 5,

  // A/B testing
  AB_TEST_TRAFFIC_SPLIT: 0.1, // 10% traffic to challenger model

  // Labeling
  AUTO_LABEL_RUG_THRESHOLD: -90, // Price drop > 90%
  AUTO_LABEL_PUMP_THRESHOLD: 100, // Price increase > 100%
  MANUAL_LABEL_QUEUE_MAX: 100,

  // Training metrics thresholds
  MIN_ACCURACY_FOR_PROMOTION: 0.70,
  MIN_F1_FOR_PROMOTION: 0.65,
} as const;
