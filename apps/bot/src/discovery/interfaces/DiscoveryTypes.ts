/**
 * Multi-Source Token Discovery - Type Definitions
 * Phase 31: Unified token discovery from multiple sources
 */

// ============================================
// Core Discovery Types
// ============================================

export interface DiscoveredToken {
  mint: string;
  symbol: string;
  name: string;
  source: string;
  timestamp: number;
  initialPrice?: number;
  initialLiquidity?: number;
  initialMarketCap?: number;
  metadata?: Record<string, any>;
}

export interface SourceMetrics {
  totalTokensFound: number;
  successfulTokensFound: number;
  rugCount: number;
  averageLatencyMs: number;
  averageGain: number;
  credibilityScore: number;
  lastSeen: number;
}

export interface DiscoveryConfirmation {
  tokenMint: string;
  sourceId: string;
  confirmedAt: number;
  latencyFromFirstMs: number;
}

export interface DiscoveryRecord {
  mint: string;
  symbol: string;
  name: string;
  firstSourceId: string;
  discoveredAt: number;
  initialLiquidity?: number;
  initialMarketCap?: number;
  status: 'pending_analysis' | 'analyzed' | 'traded' | 'ignored';
  maxMultiplier24h?: number;
  wasRug: boolean;
  confirmations: DiscoveryConfirmation[];
}

// ============================================
// Source Configuration
// ============================================

export interface SourceConfig {
  id: string;
  name: string;
  type: SourceType;
  enabled: boolean;
  baseWeight: number;
  rateLimitConfig: RateLimitConfig;
  config: BirdeyeConfig | DextoolsConfig | CoinGeckoConfig | SocialConfig | OnChainConfig;
}

export enum SourceType {
  BIRDEYE = 'birdeye',
  DEXTOOLS = 'dextools',
  COINGECKO = 'coingecko',
  OPENBOOK = 'openbook',
  ORCA = 'orca',
  SOCIAL = 'social',
}

export interface BirdeyeConfig {
  apiKey: string;
  baseUrl: string;
  pollIntervalMs: number;
}

export interface DextoolsConfig {
  apiKey: string;
  baseUrl: string;
  pollIntervalMs: number;
  minLiquidity?: number;
}

export interface CoinGeckoConfig {
  apiKey?: string;
  baseUrl: string;
  pollIntervalMs: number;
}

export interface SocialConfig {
  platforms: ('twitter' | 'telegram')[];
  keywords: string[];
  pollIntervalMs: number;
}

export interface OnChainConfig {
  rpcUrl: string;
  programId: string;
  pollIntervalMs?: number;
}

export interface RateLimitConfig {
  maxPerMinute: number;
  maxPerHour: number;
  burstSize: number;
}

// ============================================
// Aggregator Types
// ============================================

export interface AggregatorConfig extends Record<string, unknown> {
  dedupWindowMs: number; // How long to cache seen tokens
  minConfirmations: number; // Min sources before considering "confirmed"
  confirmationWeightThreshold: number; // Min total weight from sources
}

export interface DeduplicationResult {
  isDuplicate: boolean;
  originalDiscovery?: DiscoveryRecord;
  isConfirmation: boolean;
}

// ============================================
// Scoring Types
// ============================================

export interface SourceScore {
  sourceId: string;
  credibilityScore: number;
  successRate: number;
  averageLatency: number;
  recentPerformance: number; // Last 7 days
  weight: number; // Final weight (base * credibility)
}

export interface TokenScore {
  mint: string;
  totalWeight: number; // Sum of weights from all sources that found it
  confirmationCount: number;
  firstDiscoveryLatency: number;
  credibilityScore: number; // Weighted average
}

// ============================================
// Event Types
// ============================================

export interface DiscoveryEvent {
  type: 'discovered' | 'confirmed' | 'analyzed';
  token: DiscoveredToken;
  record?: DiscoveryRecord;
  score?: TokenScore;
  timestamp: number;
}

// ============================================
// Statistics
// ============================================

export interface DiscoveryStats {
  totalDiscovered: number;
  uniqueTokens: number;
  duplicatesFiltered: number;
  avgConfirmations: number;
  bySource: Record<string, SourceStats>;
}

export interface SourceStats {
  sourceId: string;
  tokensFound: number;
  avgLatency: number;
  credibilityScore: number;
  isHealthy: boolean;
  lastSeen?: number;
}
