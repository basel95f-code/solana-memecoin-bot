/**
 * Backtesting System - Type Definitions
 * Phase 32: Test patterns and filters on historical data
 */

// ============================================
// Core Backtesting Types
// ============================================

export interface HistoricalToken {
  mint: string;
  symbol: string;
  name: string;
  launchTimestamp: number;
  initialPrice: number;
  initialLiquidity: number;
  initialMarketCap: number;
  initialHolderCount: number;
  
  // Historical snapshots
  priceHistory: PriceSnapshot[];
  volumeHistory: VolumeSnapshot[];
  holderHistory: HolderSnapshot[];
  
  // Outcome
  outcome: TokenOutcome;
}

export interface PriceSnapshot {
  timestamp: number;
  price: number;
  marketCap: number;
  priceChange1h: number;
  priceChange24h: number;
}

export interface VolumeSnapshot {
  timestamp: number;
  volume24h: number;
  trades24h: number;
}

export interface HolderSnapshot {
  timestamp: number;
  holderCount: number;
  top10Percent: number;
  whaleCount: number;
}

export interface TokenOutcome {
  wasRug: boolean;
  maxMultiplier: number; // Best price increase
  timeToMax: number; // ms to reach max
  finalMultiplier: number; // Price after 24h
  totalVolume: number;
  rugTimestamp?: number;
}

// ============================================
// Backtest Configuration
// ============================================

export interface BacktestConfig {
  startDate: number;
  endDate: number;
  filterConfig: FilterConfig;
  entryConditions: EntryCondition[];
  exitConditions: ExitCondition[];
}

export interface FilterConfig {
  minLiquidity: number;
  maxTopHolderPercent: number;
  minHolders: number;
  requireMintRevoked: boolean;
  requireFreezeRevoked: boolean;
  minRiskScore: number;
  maxRugProbability: number;
}

export interface EntryCondition {
  type: 'liquidity' | 'volume_spike' | 'holder_growth' | 'risk_score' | 'ml_prediction';
  operator: '>' | '<' | '>=' | '<=' | '==';
  value: number;
}

export interface ExitCondition {
  type: 'take_profit' | 'stop_loss' | 'time_based';
  value: number; // Multiplier for TP/SL, ms for time-based
}

// ============================================
// Backtest Results
// ============================================

export interface BacktestRun {
  id: string;
  config: BacktestConfig;
  startedAt: number;
  completedAt?: number;
  status: 'running' | 'completed' | 'failed';
  metrics?: BacktestMetrics;
  trades: BacktestTrade[];
}

export interface BacktestTrade {
  tokenMint: string;
  entryTimestamp: number;
  exitTimestamp?: number;
  entryPrice: number;
  exitPrice?: number;
  multiplier?: number;
  outcome: 'win' | 'loss' | 'open';
  exitReason?: 'take_profit' | 'stop_loss' | 'rug' | 'time_limit';
}

export interface BacktestMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgReturn: number;
  maxReturn: number;
  maxLoss: number;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  avgWinSize: number;
  avgLossSize: number;
  avgHoldTime: number;
  hitRugs: number;
  missedMoons: number;
}

// ============================================
// Pattern Matching
// ============================================

export interface Pattern {
  id: string;
  name: string;
  description: string;
  conditions: PatternCondition[];
  confidence: number; // 0-1, based on historical performance
}

export interface PatternCondition {
  field: string; // e.g., 'liquidity', 'holderCount', 'priceChange1h'
  operator: '>' | '<' | '>=' | '<=' | '==' | 'between';
  value: number | [number, number];
}

export interface PatternMatch {
  pattern: Pattern;
  token: HistoricalToken;
  matchedAt: number;
  outcome: TokenOutcome;
}

export interface PatternPerformance {
  patternId: string;
  totalMatches: number;
  moonCount: number; // 2x+
  rugCount: number;
  avgReturn: number;
  winRate: number;
  confidence: number;
}

// ============================================
// Optimization
// ============================================

export interface OptimizationTarget {
  metric: 'win_rate' | 'avg_return' | 'sharpe_ratio' | 'profit_factor';
  weight: number;
}

export interface OptimizationResult {
  bestConfig: FilterConfig;
  metrics: BacktestMetrics;
  testedConfigs: number;
  improvementPercent: number;
}

// ============================================
// Data Import
// ============================================

export interface DataSource {
  type: 'birdeye' | 'dexscreener' | 'local_csv';
  config: Record<string, any>;
}

export interface ImportProgress {
  totalTokens: number;
  imported: number;
  failed: number;
  currentToken?: string;
}
