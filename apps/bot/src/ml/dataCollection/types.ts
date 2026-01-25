/**
 * ML Data Collection Types
 * Type definitions for the self-learning data pipeline
 */

// ============================================
// Feature Types (28 Total)
// ============================================

export interface MLFeatureVector {
  // === Core Features (9) ===
  liquidityUsd: number;
  riskScore: number;
  holderCount: number;
  top10Percent: number;
  mintRevoked: number; // Binary: 0/1
  freezeRevoked: number; // Binary: 0/1
  lpBurnedPercent: number;
  hasSocials: number; // Binary: 0/1
  tokenAgeHours: number;

  // === Momentum Features (6) ===
  priceChange5m: number;
  priceChange1h: number;
  priceChange24h: number;
  volumeChange1h: number;
  volumeChange24h: number;
  buyPressure1h: number; // 0-1 ratio

  // === Smart Money Features (3) ===
  smartMoneyNetBuys: number;
  smartMoneyHolding: number;
  isSmartMoneyBullish: number; // Binary: 0/1

  // === Trend Features (4) ===
  priceVelocity: number;
  volumeAcceleration: number;
  liquidityTrend: number;
  holderTrend: number;

  // === Pattern Features (3) ===
  hasVolumeSpike: number; // Binary: 0/1
  isPumping: number; // Binary: 0/1
  isDumping: number; // Binary: 0/1

  // === Sentiment Features (3) ===
  sentimentScore: number; // -1 to 1
  sentimentConfidence: number; // 0 to 1
  hasSentimentData: number; // Binary: 0/1
}

// ============================================
// Snapshot Types
// ============================================

export interface TokenSnapshot {
  id?: number;
  mint: string;
  symbol: string;
  name?: string;

  // Price/Market Data
  priceUsd: number;
  priceSol?: number;
  marketCap?: number;
  fdv?: number;

  // Volume Data
  volume5m: number;
  volume1h: number;
  volume24h: number;

  // Liquidity Data
  liquidityUsd: number;
  lpBurnedPercent: number;
  lpLockedPercent: number;

  // Holder Data
  holderCount: number;
  top10Percent: number;
  top20Percent?: number;
  largestHolderPercent?: number;

  // Contract Data
  mintRevoked: boolean;
  freezeRevoked: boolean;
  isHoneypot: boolean;

  // Social Data
  hasTwitter: boolean;
  hasTelegram: boolean;
  hasWebsite: boolean;
  twitterFollowers?: number;
  telegramMembers?: number;

  // Momentum Data
  priceChange5m: number;
  priceChange1h: number;
  priceChange24h: number;
  buys5m: number;
  sells5m: number;
  buys1h: number;
  sells1h: number;

  // Smart Money Data
  smartMoneyNetBuys?: number;
  smartMoneyHolding?: number;
  isSmartMoneyBullish?: boolean;

  // Sentiment Data
  sentimentScore?: number;
  sentimentConfidence?: number;

  // Risk Assessment
  riskScore: number;
  rugProbability?: number;

  // ML Features (computed)
  features?: MLFeatureVector;
  normalizedFeatures?: number[];

  // Metadata
  source: string;
  poolAddress?: string;
  createdAt: Date;
  recordedAt: number; // Unix timestamp
}

// ============================================
// Outcome Types
// ============================================

export type OutcomeLabel = 'rug' | 'pump' | 'moon' | 'stable' | 'decline' | 'sideways' | 'unknown';
export type PriceLabel = 'UP' | 'DOWN' | 'SIDEWAYS';
export type WhaleLabel = 'DUMP' | 'ACCUMULATION' | 'DISTRIBUTION' | 'HOLDING' | 'NONE';
export type SentimentLabel = 'POSITIVE_CORRELATION' | 'NEGATIVE_CORRELATION' | 'NO_CORRELATION';

export interface OutcomeTracking {
  mint: string;
  symbol: string;

  // Initial State
  initialPrice: number;
  initialLiquidity: number;
  initialRiskScore: number;
  initialHolders: number;
  initialTop10Percent?: number;
  initialSentiment?: number;
  discoveredAt: number;

  // Prediction State (what the model predicted)
  predictedOutcome?: OutcomeLabel;
  predictedConfidence?: number;
  predictedRugProb?: number;
  predictionModelVersion?: string;

  // Price Tracking
  checkpoints: OutcomeCheckpoint[];
  peakPrice: number;
  peakAt?: number;
  troughPrice: number;
  troughAt?: number;

  // Final Outcome
  actualOutcome?: OutcomeLabel;
  actualOutcomeConfidence?: number;
  priceChange1h?: number;
  priceChange6h?: number;
  priceChange24h?: number;
  finalPrice?: number;
  finalLiquidity?: number;
  finalHolders?: number;

  // Whale Activity
  whaleLabel?: WhaleLabel;
  largeSellDetected?: boolean;
  largeBuyDetected?: boolean;
  whaleActionAt?: number;

  // Sentiment Correlation
  sentimentLabel?: SentimentLabel;
  sentimentPriceCorrelation?: number;

  // Metadata
  outcomeRecordedAt?: number;
  usedForTraining?: boolean;
}

export interface OutcomeCheckpoint {
  timestamp: number;
  priceUsd: number;
  liquidityUsd?: number;
  holderCount?: number;
  volume1h?: number;
  checkpointType: '1h' | '6h' | '24h' | 'peak' | 'trough' | 'manual';
}

// ============================================
// Training Data Types
// ============================================

export interface TrainingDataPoint {
  id?: number;
  mint: string;
  symbol: string;

  // Features
  features: MLFeatureVector;
  normalizedFeatures: number[];
  featureVersion: string;

  // Labels
  priceLabel1h?: PriceLabel;
  priceLabel6h?: PriceLabel;
  priceLabel24h?: PriceLabel;
  outcomeLabel?: OutcomeLabel;
  whaleLabel?: WhaleLabel;
  sentimentLabel?: SentimentLabel;

  // Label Metadata
  labelSource: 'auto' | 'manual' | 'semi-auto';
  labelConfidence: number;
  labeledBy?: string;

  // Timestamps
  discoveredAt: number;
  labeledAt: number;
  createdAt: number;
}

// ============================================
// Quality Metrics Types
// ============================================

export interface FeatureQualityMetrics {
  featureName: string;
  missingCount: number;
  missingPercent: number;
  outlierCount: number;
  outlierPercent: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  median: number;
  skewness: number;
  kurtosis: number;
}

export interface DataQualityReport {
  timestamp: number;
  totalSamples: number;
  validSamples: number;
  validPercent: number;

  // Missing Data
  missingDataByFeature: Record<string, number>;
  totalMissingPercent: number;

  // Outliers
  outliersByFeature: Record<string, number>;
  totalOutlierPercent: number;

  // Class Balance
  classCounts: Record<string, number>;
  classRatios: Record<string, number>;
  isImbalanced: boolean;
  imbalanceRatio: number;

  // Feature Quality
  featureMetrics: FeatureQualityMetrics[];
  lowQualityFeatures: string[];

  // Overall Score
  qualityScore: number; // 0-100
  issues: string[];
  recommendations: string[];
}

// ============================================
// Distribution Drift Types
// ============================================

export interface DistributionSnapshot {
  featureName: string;
  timestamp: number;
  mean: number;
  std: number;
  percentiles: number[]; // p5, p25, p50, p75, p95
  histogram: { bin: number; count: number }[];
}

export interface DriftReport {
  timestamp: number;
  comparisonPeriodDays: number;

  // Per-Feature Drift
  featureDrift: {
    featureName: string;
    driftScore: number; // 0-1, higher = more drift
    driftType: 'gradual' | 'sudden' | 'seasonal' | 'none';
    significance: 'low' | 'medium' | 'high' | 'critical';
    currentMean: number;
    baselineMean: number;
    currentStd: number;
    baselineStd: number;
    pValue?: number;
  }[];

  // Overall Drift
  overallDriftScore: number;
  driftedFeatureCount: number;
  retrainingRecommended: boolean;
  urgency: 'none' | 'low' | 'medium' | 'high' | 'critical';

  // Actions
  suggestedActions: string[];
}

// ============================================
// Sampling Strategy Types
// ============================================

export type SamplingTier = 'high' | 'medium' | 'low' | 'minimal';

export interface SamplingConfig {
  tier: SamplingTier;
  intervalSeconds: number;
  maxSnapshotsPerToken: number;
  priority: number;
}

export interface TokenSamplingState {
  mint: string;
  symbol: string;
  tier: SamplingTier;
  currentConfig: SamplingConfig;

  // Tracking
  lastSnapshotAt?: number;
  snapshotCount: number;
  hasPrediction: boolean;
  hasInterestingEvent: boolean;

  // Evaluation
  liquidityUsd: number;
  lastEventAt?: number;
  eventType?: string;

  // Expiry
  addedAt: number;
  expiresAt?: number;
  isActive: boolean;
}

// ============================================
// Job Status Types
// ============================================

export interface MLJobStatus {
  jobName: string;
  isRunning: boolean;
  lastRunAt?: number;
  lastRunDurationMs?: number;
  lastRunResult?: 'success' | 'failure' | 'partial';
  lastError?: string;
  nextRunAt?: number;

  // Stats
  runsTotal: number;
  runsSuccess: number;
  runsFailed: number;
  itemsProcessed: number;
  itemsFailed: number;

  // Health
  healthStatus: 'healthy' | 'degraded' | 'unhealthy';
  consecutiveFailures: number;
}

export interface MLSystemStatus {
  timestamp: number;

  // Jobs
  jobs: Record<string, MLJobStatus>;

  // Data
  totalTrainingSamples: number;
  newSamplesLast24h: number;
  pendingOutcomes: number;
  activelyTrackedTokens: number;

  // Quality
  dataQualityScore: number;
  driftScore: number;

  // Models
  activeModelVersion?: string;
  challengerModelVersion?: string;
  lastTrainingAt?: number;

  // Health
  overallHealth: 'healthy' | 'degraded' | 'critical';
  alerts: string[];
}
