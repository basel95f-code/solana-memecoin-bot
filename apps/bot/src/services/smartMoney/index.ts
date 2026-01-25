/**
 * Smart Money Intelligence System
 * Phase 34 & 35: Complete smart money tracking ecosystem
 */

// Phase 34: Core intelligence
export { WalletProfiler, WalletCategory } from './WalletProfiler';
export type { WalletProfile } from './WalletProfiler';

export { CopyTradingSignals } from './CopyTradingSignals';
export type { CopySignal, SignalConfig } from './CopyTradingSignals';

export { PatternDetector } from './PatternDetector';
export type { EntryPattern, PatternMatch, PatternCondition } from './PatternDetector';

// Phase 35: Clusters, flow, and leaderboard
export { WalletClusters } from './WalletClusters';
export type { WalletCluster, CoordinationEvent, WalletRelationship } from './WalletClusters';

export { TokenFlowAnalyzer } from './TokenFlowAnalyzer';
export type { TokenFlow, WalletAccumulation, FlowAlert } from './TokenFlowAnalyzer';

export { PerformanceLeaderboard } from './PerformanceLeaderboard';
export type { LeaderboardEntry, CategoryLeaderboard, HistoricalRanking } from './PerformanceLeaderboard';
