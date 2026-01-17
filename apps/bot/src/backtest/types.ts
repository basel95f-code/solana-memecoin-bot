/**
 * Backtesting Framework Types
 * Types for backtesting trading strategies against historical token data
 */

// ============================================
// Entry Conditions
// ============================================

export interface EntryConditions {
  // Risk score thresholds
  minRiskScore?: number;
  maxRiskScore?: number;

  // Liquidity requirements
  minLiquidity?: number;
  maxLiquidity?: number;

  // Holder limits
  minHolders?: number;
  maxHolders?: number;
  maxTop10Percent?: number;
  maxSingleHolderPercent?: number;

  // Contract requirements
  requireMintRevoked?: boolean;
  requireFreezeRevoked?: boolean;
  requireLPBurned?: boolean;
  lpBurnedMinPercent?: number;

  // Token age (seconds)
  minTokenAge?: number;
  maxTokenAge?: number;

  // Social requirements
  requireSocials?: boolean;
  requireTwitter?: boolean;
  requireTelegram?: boolean;

  // Smart money requirements
  minSmartBuys?: number;
}

// ============================================
// Exit Conditions
// ============================================

export interface TakeProfitLevel {
  percent: number;      // e.g., 100 = 100% gain (2x)
  sellPercent: number;  // Percent of position to sell at this level
}

export interface ExitConditions {
  // Take profit levels (can have multiple)
  takeProfitLevels: TakeProfitLevel[];

  // Stop loss
  stopLossPercent: number; // e.g., -20 = sell if down 20%

  // Trailing stop (optional)
  trailingStopPercent?: number; // e.g., 15 = trail 15% below peak
  trailingStopActivation?: number; // Only activate after this % gain

  // Time-based exits
  maxHoldTimeHours?: number; // Force exit after X hours

  // Rug protection
  exitOnRugSignal?: boolean; // Exit if outcome = 'rug'
}

// ============================================
// Position Sizing
// ============================================

export type PositionSizingMethod = 'fixed' | 'percent_of_capital' | 'risk_based';

export interface PositionSizing {
  method: PositionSizingMethod;

  // For 'fixed' method
  fixedAmount?: number; // Fixed USD amount per trade

  // For 'percent_of_capital' method
  percentOfCapital?: number; // e.g., 5 = 5% of current capital

  // For 'risk_based' method
  riskPercent?: number; // % of capital to risk per trade

  // Limits
  maxPositionSize?: number; // Max USD per position
  maxConcurrentPositions?: number; // Max number of open positions
}

// ============================================
// Strategy Definition
// ============================================

export interface BacktestStrategy {
  id?: number;
  name: string;
  description: string;

  entry: EntryConditions;
  exit: ExitConditions;
  sizing: PositionSizing;

  // Metadata
  createdAt?: number;
  updatedAt?: number;
  isPreset?: boolean;
}

// ============================================
// Trade Record
// ============================================

export type TradeOutcome = 'win' | 'loss' | 'breakeven' | 'stopped_out' | 'time_exit' | 'rug_exit';

export interface BacktestTrade {
  id?: number;
  runId: number;

  // Token info
  tokenMint: string;
  tokenSymbol: string;
  tokenName?: string;

  // Entry details
  entryPrice: number;
  entryTime: number; // Unix timestamp
  positionSize: number; // USD value

  // Exit details
  exitPrice: number;
  exitTime: number;
  exitReason: TradeOutcome;

  // Results
  profitLoss: number; // USD
  profitLossPercent: number;
  holdTimeSeconds: number;

  // Peak tracking
  peakPrice: number;
  peakMultiplier: number;

  // Token metrics at entry
  entryRiskScore?: number;
  entryLiquidity?: number;
  entryHolders?: number;
}

// ============================================
// Backtest Run Results
// ============================================

export interface EquityPoint {
  timestamp: number;
  equity: number;
  drawdown: number;
}

export interface BacktestResults {
  id?: number;
  strategyId: number;
  strategyName: string;

  // Time range
  startDate: number; // Unix timestamp
  endDate: number;
  daysAnalyzed: number;

  // Capital
  initialCapital: number;
  finalCapital: number;

  // Trade statistics
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number; // Percentage

  // Profit/Loss
  totalProfitLoss: number;
  totalReturn: number; // Percentage
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;

  // Risk metrics
  maxDrawdown: number; // Percentage
  maxDrawdownDuration: number; // Seconds
  sharpeRatio: number;
  sortinoRatio: number;
  profitFactor: number; // Gross profit / Gross loss

  // Time metrics
  averageHoldTime: number; // Seconds
  longestWinningStreak: number;
  longestLosingStreak: number;

  // Equity curve
  equityCurve: EquityPoint[];

  // Execution metadata
  executedAt: number;
  executionTimeMs: number;
}

// ============================================
// Backtest Run Configuration
// ============================================

export interface BacktestConfig {
  strategy: BacktestStrategy;

  // Time range
  startDate?: Date;
  endDate?: Date;
  days?: number; // Alternative: last N days

  // Capital
  initialCapital: number; // Default: 10000

  // Execution options
  includeTradeDetails?: boolean; // Store individual trades
  verbose?: boolean; // Log progress
}

// ============================================
// Token with Outcome (for backtesting)
// ============================================

export interface TokenWithOutcome {
  mint: string;
  symbol: string;
  name?: string;

  // Initial state at discovery
  initialPrice: number;
  initialLiquidity: number;
  initialRiskScore: number;
  initialHolders: number;
  initialTop10Percent?: number;

  // Peak values
  peakPrice: number;
  peakLiquidity?: number;

  // Final values
  finalPrice: number;
  finalLiquidity?: number;

  // Outcome
  outcome: string; // 'rug', 'pump', 'stable', 'slow_decline', 'unknown'
  peakMultiplier: number;
  timeToPeak?: number; // Seconds

  // Timestamps
  discoveredAt: number;
  peakAt?: number;
  outcomeRecordedAt?: number;

  // Token analysis data (for entry condition checks)
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
// Database Row Types
// ============================================

export interface BacktestStrategyRow {
  id: number;
  name: string;
  description: string;
  entry_conditions: string; // JSON
  exit_conditions: string; // JSON
  position_sizing: string; // JSON
  is_preset: number;
  created_at: number;
  updated_at: number;
}

export interface BacktestRunRow {
  id: number;
  strategy_id: number;
  strategy_name: string;
  start_date: number;
  end_date: number;
  days_analyzed: number;
  initial_capital: number;
  final_capital: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_profit_loss: number;
  total_return: number;
  average_win: number;
  average_loss: number;
  largest_win: number;
  largest_loss: number;
  max_drawdown: number;
  max_drawdown_duration: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  profit_factor: number;
  average_hold_time: number;
  longest_winning_streak: number;
  longest_losing_streak: number;
  equity_curve: string; // JSON
  executed_at: number;
  execution_time_ms: number;
}

export interface BacktestTradeRow {
  id: number;
  run_id: number;
  token_mint: string;
  token_symbol: string;
  token_name: string | null;
  entry_price: number;
  entry_time: number;
  position_size: number;
  exit_price: number;
  exit_time: number;
  exit_reason: string;
  profit_loss: number;
  profit_loss_percent: number;
  hold_time_seconds: number;
  peak_price: number;
  peak_multiplier: number;
  entry_risk_score: number | null;
  entry_liquidity: number | null;
  entry_holders: number | null;
}
