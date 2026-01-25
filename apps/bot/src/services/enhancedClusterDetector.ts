/**
 * Enhanced Cluster Detector
 * Detects Sybil attacks, coordinated pumps, and suspicious wallet groups
 */

import { EventEmitter } from 'events';
import { whaleActivityTracker } from './whaleActivityTracker';
import type { WhaleActivityEvent } from './whaleActivityTracker';
import { logger } from '../utils/logger';

export type ClusterSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface WalletCluster {
  id: string;
  wallets: string[];
  tokenMint: string;
  tokenSymbol?: string;
  
  // Detection patterns
  temporalSync: boolean; // Buy/sell within 60s
  amountSync: boolean; // Similar amounts (<5% variance)
  crossTokenActivity: string[]; // Other tokens with same cluster
  
  // Severity
  severity: ClusterSeverity;
  suspicionScore: number; // 0-100
  
  // Details
  avgAmount: number;
  totalValue: number;
  timeWindow: number; // ms between first and last transaction
  action: 'buy' | 'sell' | 'mixed';
  
  // Recommendations
  recommendation: 'avoid' | 'caution' | 'monitor';
  warnings: string[];
  
  timestamp: number;
}

export interface FundingChain {
  wallet: string;
  fundingSource?: string;
  depth: number; // How many levels traced
  chain: string[]; // Full funding chain
  isExchange: boolean;
  exchangeName?: string;
}

export interface SybilAttack {
  tokenMint: string;
  tokenSymbol?: string;
  clusters: WalletCluster[];
  totalWallets: number;
  totalValue: number;
  confidence: number; // 0-100
  attackType: 'pump' | 'dump' | 'wash_trading';
  timestamp: number;
}

// Known exchanges for funding source validation
const KNOWN_EXCHANGES: Record<string, string> = {
  'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5': 'Binance',
  '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S': 'Binance',
  'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS': 'Coinbase',
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM': 'FTX',
  '4BXqgxCBCgvWKyVBz3Q5L3VB8f9YvQxWLZLz5VXbZTfH': 'OKX',
};

export class EnhancedClusterDetector extends EventEmitter {
  private detectedClusters: Map<string, WalletCluster[]> = new Map(); // tokenMint -> clusters
  private fundingChains: Map<string, FundingChain> = new Map(); // walletAddress -> chain
  private crossTokenClusters: Map<string, Set<string>> = new Map(); // clusterFingerprint -> tokenMints

  private readonly TEMPORAL_WINDOW = 60 * 1000; // 60 seconds
  private readonly AMOUNT_VARIANCE_THRESHOLD = 0.05; // 5%
  private readonly MIN_CLUSTER_SIZE = 3;

  constructor() {
    super();
  }

  /**
   * Analyze token for wallet clusters
   */
  async analyzeToken(tokenMint: string, tokenSymbol?: string): Promise<WalletCluster[]> {
    // Get all wallet activity for this token
    const timelines = whaleActivityTracker.getTokenActivity(tokenMint);
    
    if (timelines.length < this.MIN_CLUSTER_SIZE) {
      return [];
    }

    const clusters: WalletCluster[] = [];
    const allEvents: WhaleActivityEvent[] = [];

    // Collect all events from all wallets
    for (const timeline of timelines) {
      allEvents.push(...timeline.events);
    }

    // Sort by timestamp
    allEvents.sort((a, b) => a.timestamp - b.timestamp);

    // Detect temporal clusters (transactions within 60s)
    const temporalClusters = this.detectTemporalClusters(allEvents, tokenMint, tokenSymbol);
    clusters.push(...temporalClusters);

    // Detect amount clusters (similar transaction amounts)
    const amountClusters = this.detectAmountClusters(allEvents, tokenMint, tokenSymbol);
    clusters.push(...amountClusters);

    // Store detected clusters
    this.detectedClusters.set(tokenMint, clusters);

    // Check for cross-token activity
    this.analyzeCrossTokenActivity(clusters);

    // Emit alerts for high-severity clusters
    for (const cluster of clusters) {
      if (cluster.severity === 'high' || cluster.severity === 'critical') {
        this.emit('clusterDetected', cluster);
      }
    }

    // Check for coordinated Sybil attack
    if (clusters.length >= 2) {
      const sybilAttack = this.detectSybilAttack(tokenMint, tokenSymbol, clusters);
      if (sybilAttack && sybilAttack.confidence >= 70) {
        this.emit('sybilAttack', sybilAttack);
      }
    }

    return clusters;
  }

  /**
   * Detect temporal clusters (wallets transacting within narrow time window)
   */
  private detectTemporalClusters(
    events: WhaleActivityEvent[],
    tokenMint: string,
    tokenSymbol?: string
  ): WalletCluster[] {
    const clusters: WalletCluster[] = [];
    const processed = new Set<number>();

    for (let i = 0; i < events.length; i++) {
      if (processed.has(i)) continue;

      const anchor = events[i];
      const group: WhaleActivityEvent[] = [anchor];
      processed.add(i);

      // Find all events within TEMPORAL_WINDOW
      for (let j = i + 1; j < events.length; j++) {
        if (processed.has(j)) continue;

        const candidate = events[j];
        const timeDiff = candidate.timestamp - anchor.timestamp;

        if (timeDiff <= this.TEMPORAL_WINDOW) {
          group.push(candidate);
          processed.add(j);
        } else {
          break; // Events are sorted, no need to check further
        }
      }

      // Only create cluster if we have MIN_CLUSTER_SIZE wallets
      const uniqueWallets = new Set(group.map(e => e.walletAddress));
      
      if (uniqueWallets.size >= this.MIN_CLUSTER_SIZE) {
        const cluster = this.createCluster(
          Array.from(uniqueWallets),
          tokenMint,
          tokenSymbol,
          group,
          true, // temporalSync
          false // amountSync (check separately)
        );
        
        clusters.push(cluster);
      }
    }

    return clusters;
  }

  /**
   * Detect amount clusters (similar transaction amounts)
   */
  private detectAmountClusters(
    events: WhaleActivityEvent[],
    tokenMint: string,
    tokenSymbol?: string
  ): WalletCluster[] {
    const clusters: WalletCluster[] = [];
    
    // Group events by similar amounts (within 5% variance)
    const amountGroups: Map<number, WhaleActivityEvent[]> = new Map();

    for (const event of events) {
      let foundGroup = false;

      // Try to find existing group with similar amount
      for (const [avgAmount, group] of amountGroups.entries()) {
        const variance = Math.abs(event.solValue - avgAmount) / avgAmount;
        
        if (variance <= this.AMOUNT_VARIANCE_THRESHOLD) {
          group.push(event);
          // Update average
          const newAvg = group.reduce((sum, e) => sum + e.solValue, 0) / group.length;
          amountGroups.delete(avgAmount);
          amountGroups.set(newAvg, group);
          foundGroup = true;
          break;
        }
      }

      if (!foundGroup) {
        amountGroups.set(event.solValue, [event]);
      }
    }

    // Convert groups to clusters
    for (const group of amountGroups.values()) {
      const uniqueWallets = new Set(group.map(e => e.walletAddress));
      
      if (uniqueWallets.size >= this.MIN_CLUSTER_SIZE) {
        const cluster = this.createCluster(
          Array.from(uniqueWallets),
          tokenMint,
          tokenSymbol,
          group,
          false, // temporalSync (check separately)
          true // amountSync
        );
        
        clusters.push(cluster);
      }
    }

    return clusters;
  }

  /**
   * Create cluster object from wallet group and events
   */
  private createCluster(
    wallets: string[],
    tokenMint: string,
    tokenSymbol: string | undefined,
    events: WhaleActivityEvent[],
    temporalSync: boolean,
    amountSync: boolean
  ): WalletCluster {
    // Calculate metrics
    const totalValue = events.reduce((sum, e) => sum + e.solValue, 0);
    const avgAmount = totalValue / events.length;
    
    const timestamps = events.map(e => e.timestamp);
    const timeWindow = Math.max(...timestamps) - Math.min(...timestamps);
    
    const actions = new Set(events.map(e => e.action));
    const action = actions.size === 1 ? events[0].action : 'mixed';

    // Calculate suspicion score
    let suspicionScore = 0;
    const warnings: string[] = [];

    // Temporal sync adds suspicion
    if (temporalSync) {
      suspicionScore += 30;
      warnings.push(`${wallets.length} wallets transacting within ${(timeWindow / 1000).toFixed(0)}s`);
    }

    // Amount sync adds suspicion
    if (amountSync) {
      suspicionScore += 30;
      warnings.push('Suspiciously similar transaction amounts');
    }

    // Both temporal AND amount sync = very suspicious
    if (temporalSync && amountSync) {
      suspicionScore += 20;
      warnings.push('Coordinated timing AND amounts - highly suspicious!');
    }

    // Many wallets = more suspicious
    if (wallets.length >= 5) {
      suspicionScore += 20;
      warnings.push(`${wallets.length} coordinated wallets`);
    }

    // Determine severity
    let severity: ClusterSeverity;
    if (suspicionScore >= 80) severity = 'critical';
    else if (suspicionScore >= 60) severity = 'high';
    else if (suspicionScore >= 40) severity = 'medium';
    else severity = 'low';

    // Recommendation
    let recommendation: 'avoid' | 'caution' | 'monitor';
    if (severity === 'critical') recommendation = 'avoid';
    else if (severity === 'high') recommendation = 'avoid';
    else if (severity === 'medium') recommendation = 'caution';
    else recommendation = 'monitor';

    const cluster: WalletCluster = {
      id: this.generateClusterId(wallets),
      wallets,
      tokenMint,
      tokenSymbol,
      temporalSync,
      amountSync,
      crossTokenActivity: [],
      severity,
      suspicionScore,
      avgAmount,
      totalValue,
      timeWindow,
      action,
      recommendation,
      warnings,
      timestamp: Date.now(),
    };

    return cluster;
  }

  /**
   * Generate unique cluster ID based on wallet addresses
   */
  private generateClusterId(wallets: string[]): string {
    const sorted = [...wallets].sort();
    const fingerprint = sorted.join('|');
    return fingerprint.substring(0, 32); // First 32 chars as ID
  }

  /**
   * Analyze cross-token activity (same wallet groups across multiple tokens)
   */
  private analyzeCrossTokenActivity(clusters: WalletCluster[]): void {
    for (const cluster of clusters) {
      const fingerprint = this.generateClusterId(cluster.wallets);
      
      if (!this.crossTokenClusters.has(fingerprint)) {
        this.crossTokenClusters.set(fingerprint, new Set());
      }
      
      this.crossTokenClusters.get(fingerprint)!.add(cluster.tokenMint);
      
      // Update cross-token activity for this cluster
      const tokens = Array.from(this.crossTokenClusters.get(fingerprint)!);
      cluster.crossTokenActivity = tokens.filter(t => t !== cluster.tokenMint);
      
      // Boost suspicion if same group operates across multiple tokens
      if (cluster.crossTokenActivity.length > 0) {
        cluster.suspicionScore = Math.min(100, cluster.suspicionScore + (cluster.crossTokenActivity.length * 10));
        cluster.warnings.push(`Same wallet group found on ${cluster.crossTokenActivity.length + 1} tokens`);
        
        // Upgrade severity if needed
        if (cluster.suspicionScore >= 80 && cluster.severity !== 'critical') {
          cluster.severity = 'critical';
          cluster.recommendation = 'avoid';
        }
      }
    }
  }

  /**
   * Detect coordinated Sybil attack
   */
  private detectSybilAttack(
    tokenMint: string,
    tokenSymbol: string | undefined,
    clusters: WalletCluster[]
  ): SybilAttack | null {
    // Filter high-severity clusters
    const suspiciousClusters = clusters.filter(c => c.severity === 'high' || c.severity === 'critical');
    
    if (suspiciousClusters.length < 2) {
      return null; // Need at least 2 suspicious clusters for Sybil attack
    }

    const allWallets = new Set<string>();
    let totalValue = 0;
    
    for (const cluster of suspiciousClusters) {
      cluster.wallets.forEach(w => allWallets.add(w));
      totalValue += cluster.totalValue;
    }

    // Determine attack type
    const actions = suspiciousClusters.map(c => c.action);
    let attackType: 'pump' | 'dump' | 'wash_trading';
    
    if (actions.every(a => a === 'buy')) attackType = 'pump';
    else if (actions.every(a => a === 'sell')) attackType = 'dump';
    else attackType = 'wash_trading';

    // Calculate confidence
    let confidence = 0;
    
    // More clusters = higher confidence
    confidence += Math.min(40, suspiciousClusters.length * 10);
    
    // High suspicion scores = higher confidence
    const avgSuspicion = suspiciousClusters.reduce((sum, c) => sum + c.suspicionScore, 0) / suspiciousClusters.length;
    confidence += avgSuspicion * 0.4;
    
    // Cross-token activity = higher confidence
    const crossTokenCount = suspiciousClusters.filter(c => c.crossTokenActivity.length > 0).length;
    if (crossTokenCount > 0) {
      confidence += 20;
    }

    const sybilAttack: SybilAttack = {
      tokenMint,
      tokenSymbol,
      clusters: suspiciousClusters,
      totalWallets: allWallets.size,
      totalValue,
      confidence: Math.min(100, confidence),
      attackType,
      timestamp: Date.now(),
    };

    return sybilAttack;
  }

  /**
   * Get detected clusters for a token
   */
  getClusters(tokenMint: string): WalletCluster[] {
    return this.detectedClusters.get(tokenMint) || [];
  }

  /**
   * Get all detected clusters
   */
  getAllClusters(): WalletCluster[] {
    const all: WalletCluster[] = [];
    for (const clusters of this.detectedClusters.values()) {
      all.push(...clusters);
    }
    return all;
  }

  /**
   * Get critical clusters across all tokens
   */
  getCriticalClusters(): WalletCluster[] {
    return this.getAllClusters().filter(c => c.severity === 'critical');
  }

  /**
   * Check if a token has suspicious cluster activity
   */
  isTokenSuspicious(tokenMint: string): { suspicious: boolean; severity?: ClusterSeverity; reason?: string } {
    const clusters = this.getClusters(tokenMint);
    
    if (clusters.length === 0) {
      return { suspicious: false };
    }

    // Find highest severity
    const critical = clusters.find(c => c.severity === 'critical');
    if (critical) {
      return {
        suspicious: true,
        severity: 'critical',
        reason: `Critical cluster detected: ${critical.warnings[0]}`,
      };
    }

    const high = clusters.find(c => c.severity === 'high');
    if (high) {
      return {
        suspicious: true,
        severity: 'high',
        reason: `High-risk cluster detected: ${high.warnings[0]}`,
      };
    }

    return { suspicious: false };
  }

  /**
   * Cleanup old clusters
   */
  cleanup(): void {
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    const now = Date.now();

    for (const [tokenMint, clusters] of this.detectedClusters.entries()) {
      const filtered = clusters.filter(c => now - c.timestamp < maxAge);
      
      if (filtered.length === 0) {
        this.detectedClusters.delete(tokenMint);
      } else {
        this.detectedClusters.set(tokenMint, filtered);
      }
    }

    logger.debug('EnhancedClusterDetector', 'Cleaned up old clusters');
  }
}

// Singleton instance
export const enhancedClusterDetector = new EnhancedClusterDetector();
