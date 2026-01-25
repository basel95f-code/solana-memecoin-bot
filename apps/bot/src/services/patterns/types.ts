/**
 * Pattern Detection System - Type Definitions
 * Identifies pump & dump schemes, rug pulls, and honeypots
 */

// ============================================
// Core Pattern Types
// ============================================

export enum PatternType {
  PUMP_AND_DUMP = 'pump_and_dump',
  RUG_PULL = 'rug_pull',
  HONEYPOT = 'honeypot',
  NORMAL = 'normal',
}

export enum ConfidenceLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

// ============================================
// Pattern Detection Result
// ============================================

export interface PatternDetectionResult {
  detected: boolean;
  patternType: PatternType;
  dangerScore: number; // 0-100
  confidence: ConfidenceLevel;
  
  // Pattern-specific indicators
  indicators: PatternIndicator[];
  
  // Raw scores for transparency
  scores: {
    priceAnomalyScore: number;
    volumeAnomalyScore: number;
    liquidityRiskScore: number;
    holderConcentrationScore: number;
    tradingPatternScore: number;
  };
  
  // Recommendations
  recommendation: 'avoid' | 'caution' | 'monitor' | 'safe';
  warnings: string[];
  
  // Metadata
  detectedAt: number;
  tokenMint: string;
  tokenSymbol?: string;
}

export interface PatternIndicator {
  name: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  value: number | string;
  weight: number; // 0-1, importance of this indicator
}

// ============================================
// Token Data for Pattern Analysis
// ============================================

export interface TokenAnalysisData {
  // Basic info
  mint: string;
  symbol?: string;
  name?: string;
  
  // Price data
  currentPrice: number;
  priceChange5m?: number;
  priceChange1h?: number;
  priceChange24h?: number;
  
  // Volume data
  volume5m?: number;
  volume1h?: number;
  volume24h?: number;
  volumeChangeRate?: number;
  
  // Liquidity
  liquidityUsd: number;
  liquidityChange1h?: number;
  lpBurnedPercent: number;
  lpLockedPercent: number;
  
  // Holders
  holderCount: number;
  top10Percent: number;
  top20Percent?: number;
  largestHolderPercent?: number;
  whaleCount?: number;
  
  // Trading activity
  buys5m?: number;
  sells5m?: number;
  buys1h?: number;
  sells1h?: number;
  buyPressure?: number; // buys / (buys + sells)
  
  // Contract security
  mintRevoked: boolean;
  freezeRevoked: boolean;
  transferFeeBps?: number;
  
  // Social
  hasTwitter?: boolean;
  hasTelegram?: boolean;
  hasWebsite?: boolean;
  
  // Age
  createdAt?: number;
  poolCreatedAt?: number;
  
  // Historical (if available)
  snapshots?: TokenSnapshot[];
}

export interface TokenSnapshot {
  timestamp: number;
  price: number;
  volume: number;
  liquidity: number;
  holderCount?: number;
}

// ============================================
// Pattern Scoring Configuration
// ============================================

export interface PatternScoringConfig {
  // Weight factors for different indicators (0-1)
  weights: {
    priceAnomaly: number;
    volumeAnomaly: number;
    liquidityRisk: number;
    holderConcentration: number;
    tradingPattern: number;
  };
  
  // Thresholds for classification
  thresholds: {
    dangerScoreCritical: number; // > this = critical danger
    dangerScoreHigh: number; // > this = high danger
    dangerScoreMedium: number; // > this = medium danger
    
    confidenceHigh: number; // > this = high confidence
    confidenceMedium: number; // > this = medium confidence
  };
}

// ============================================
// Pattern History Tracking
// ============================================

export interface PatternHistoryRecord {
  id: number;
  tokenMint: string;
  tokenSymbol?: string;
  patternType: PatternType;
  dangerScore: number;
  confidence: ConfidenceLevel;
  
  // Outcome tracking
  actualOutcome?: 'rug' | 'pump' | 'stable' | 'unknown';
  wasAccurate?: boolean;
  
  // Timing
  detectedAt: number;
  outcomeRecordedAt?: number;
  
  // Learning
  accuracyScore?: number; // 0-1
}

// ============================================
// Pattern Detector Interface
// ============================================

export interface IPatternDetector {
  name: string;
  patternType: PatternType;
  
  /**
   * Analyze token data and detect pattern
   */
  analyze(data: TokenAnalysisData): PatternDetectionResult;
  
  /**
   * Get detector configuration
   */
  getConfig(): PatternScoringConfig;
  
  /**
   * Update detector configuration
   */
  updateConfig(config: Partial<PatternScoringConfig>): void;
}

// ============================================
// Pattern Statistics
// ============================================

export interface PatternStats {
  totalDetections: number;
  byType: Record<PatternType, number>;
  byConfidence: Record<ConfidenceLevel, number>;
  
  accuracy: {
    overall: number;
    byType: Record<PatternType, number>;
  };
  
  avgDangerScore: number;
  criticalDetections: number;
}
