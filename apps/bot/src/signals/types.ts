/**
 * Trading Signal Types and Interfaces
 * Automated BUY/SELL signal generation system
 */

// ============================================
// Signal Types
// ============================================

export type SignalType = 'BUY' | 'SELL' | 'TAKE_PROFIT' | 'STOP_LOSS';

export type SignalStatus = 'active' | 'acknowledged' | 'expired' | 'executed';

// ============================================
// Trading Signal
// ============================================

export interface TradingSignal {
  id: string;
  mint: string;
  symbol: string;
  name?: string;
  type: SignalType;
  confidence: number; // 0-100

  // Position sizing
  suggestedPositionSize: number; // Percentage of portfolio OR fixed SOL
  positionSizeType: 'percentage' | 'fixed_sol';

  // ML metrics
  rugProbability: number; // 0-1
  riskScore: number; // 0-100
  smartMoneyScore: number; // 0-1
  momentumScore: number; // 0-1
  holderScore: number; // 0-1

  // Price targets
  entryPrice: number;
  targetPrice?: number;
  stopLossPrice?: number;

  // Supporting data
  reasons: string[];
  warnings: string[];

  // Timestamps
  generatedAt: number; // Unix timestamp
  expiresAt: number; // Unix timestamp

  // Status tracking
  status: SignalStatus;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
}

// ============================================
// Signal Outcome
// ============================================

export interface SignalOutcome {
  signalId: string;
  mint: string;
  symbol: string;
  signalType: SignalType;

  // Predicted values
  predictedConfidence: number;
  predictedEntry: number;
  predictedTarget?: number;
  predictedStopLoss?: number;

  // Actual results
  actualEntry?: number;
  actualExit?: number;
  profitLossPercent?: number;
  profitLossSol?: number;

  // Outcome classification
  wasAccurate?: boolean; // Did the signal work?
  hitTarget?: boolean;
  hitStopLoss?: boolean;

  // Timestamps
  signalGeneratedAt: number;
  entryRecordedAt?: number;
  exitRecordedAt?: number;

  // Notes
  notes?: string;
}

// ============================================
// Signal Configuration
// ============================================

export interface SignalConfig {
  // Confidence thresholds
  minBuyConfidence: number; // Default: 60
  minSellConfidence: number; // Default: 50

  // Risk thresholds
  maxRugProbability: number; // Default: 0.30
  minRiskScore: number; // Default: 40

  // Weight configuration for confidence calculation
  weights: {
    rugProbability: number; // Default: 0.30
    riskScore: number; // Default: 0.15
    smartMoney: number; // Default: 0.25
    momentum: number; // Default: 0.20
    holders: number; // Default: 0.10
  };

  // Signal expiration (seconds)
  signalExpirySeconds: number; // Default: 3600 (1 hour)

  // Cooldown between signals for same token (seconds)
  tokenCooldownSeconds: number; // Default: 1800 (30 minutes)

  // Maximum active signals
  maxActiveSignals: number; // Default: 20

  // Auto-acknowledge expired signals
  autoExpireSignals: boolean; // Default: true
}

// ============================================
// Position Size Configuration
// ============================================

export interface PositionSizeConfig {
  type: 'percentage' | 'fixed_sol';

  // For percentage-based sizing
  defaultPercentage: number; // Default: 5% of portfolio
  maxPercentage: number; // Default: 10%
  minPercentage: number; // Default: 1%

  // For fixed SOL sizing
  defaultSol: number; // Default: 0.1 SOL
  maxSol: number; // Default: 1 SOL
  minSol: number; // Default: 0.05 SOL

  // Risk-adjusted sizing
  adjustByConfidence: boolean; // Scale position by confidence
  adjustByRisk: boolean; // Scale position by risk score
}

// ============================================
// Webhook Configuration (Discord)
// ============================================

export interface WebhookConfig {
  id: number;
  url: string; // Discord webhook URL
  name: string; // Display name
  enabled: boolean;

  // Filter settings
  events: SignalType[]; // Which signal types to send
  minConfidence: number; // Minimum confidence to trigger

  // Timestamps
  createdAt: number;
  updatedAt?: number;
  lastTriggeredAt?: number;

  // Stats
  totalSent: number;
  failureCount: number;
}

// ============================================
// Discord Embed Types
// ============================================

export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color?: number; // Decimal color value
  fields?: DiscordEmbedField[];
  thumbnail?: { url: string };
  footer?: { text: string; icon_url?: string };
  timestamp?: string; // ISO8601
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordWebhookPayload {
  content?: string;
  embeds?: DiscordEmbed[];
  username?: string;
  avatar_url?: string;
}

// ============================================
// Signal Performance Metrics
// ============================================

export interface SignalPerformanceMetrics {
  // Overall stats
  totalSignals: number;
  activeSignals: number;
  acknowledgedSignals: number;
  expiredSignals: number;

  // Outcome stats
  signalsWithOutcome: number;
  accurateSignals: number;
  winRate: number; // Percentage

  // Profit/Loss stats
  totalProfitLoss: number; // SOL
  averageReturn: number; // Percentage
  bestReturn: number; // Percentage
  worstReturn: number; // Percentage

  // By signal type
  buySignals: {
    total: number;
    accurate: number;
    winRate: number;
    avgReturn: number;
  };
  sellSignals: {
    total: number;
    accurate: number;
    winRate: number;
    avgReturn: number;
  };

  // Time-based metrics
  signalsLast24h: number;
  signalsLast7d: number;
  avgSignalAge: number; // Seconds

  // Calculation timestamp
  calculatedAt: number;
}

// ============================================
// Signal Generation Input
// ============================================

export interface SignalGenerationInput {
  mint: string;
  symbol: string;
  name?: string;

  // From ML prediction
  rugProbability: number;

  // From risk analysis
  riskScore: number;

  // From GMGN/smart money data
  smartMoneyNetBuys?: number;
  smartMoneyHolding?: number;
  isSmartMoneyBullish?: boolean;

  // From price/volume data
  priceUsd: number;
  priceChange1h?: number;
  priceChange24h?: number;
  volume1h?: number;
  volume24h?: number;

  // From holder analysis
  holderCount?: number;
  top10Percent?: number;

  // From contract analysis
  mintRevoked: boolean;
  freezeRevoked: boolean;
  lpBurnedPercent?: number;

  // Liquidity
  liquidityUsd: number;
}

// ============================================
// Signal Filter
// ============================================

export interface SignalFilter {
  types?: SignalType[];
  status?: SignalStatus[];
  minConfidence?: number;
  maxConfidence?: number;
  mint?: string;
  symbol?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

// ============================================
// Webhook Dispatch Result
// ============================================

export interface WebhookDispatchResult {
  webhookId: number;
  success: boolean;
  statusCode?: number;
  error?: string;
  retryCount: number;
  dispatchedAt: number;
}

// ============================================
// Default Configurations
// ============================================

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  minBuyConfidence: 60,
  minSellConfidence: 50,
  maxRugProbability: 0.30,
  minRiskScore: 40,
  weights: {
    rugProbability: 0.30,
    riskScore: 0.15,
    smartMoney: 0.25,
    momentum: 0.20,
    holders: 0.10,
  },
  signalExpirySeconds: 3600, // 1 hour
  tokenCooldownSeconds: 1800, // 30 minutes
  maxActiveSignals: 20,
  autoExpireSignals: true,
};

export const DEFAULT_POSITION_SIZE_CONFIG: PositionSizeConfig = {
  type: 'percentage',
  defaultPercentage: 5,
  maxPercentage: 10,
  minPercentage: 1,
  defaultSol: 0.1,
  maxSol: 1,
  minSol: 0.05,
  adjustByConfidence: true,
  adjustByRisk: true,
};
