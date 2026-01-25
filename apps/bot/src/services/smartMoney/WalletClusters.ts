/**
 * Wallet Clusters
 * Detects coordinated wallets and social networks
 * Identifies teams, copycats, and influencer networks
 */

import { logger } from '../../utils/logger';

export interface WalletCluster {
  id: string;
  name: string;
  type: 'team' | 'copycat_network' | 'influencer_network' | 'whale_group';
  wallets: string[];
  
  // Coordination metrics
  coordinationScore: number;      // 0-1, how often they trade together
  avgTimeDelta: number;           // Average time between coordinated trades (ms)
  
  // Performance
  clusterWinRate: number;
  clusterAvgReturn: number;
  
  // Activity
  coordinatedTrades: number;
  lastActivity: number;
  
  // Influence
  leaderWallet?: string;          // Most influential wallet in cluster
  followerCount: number;
}

export interface CoordinationEvent {
  tokenMint: string;
  wallets: string[];
  action: 'buy' | 'sell';
  timeWindow: number;             // ms between first and last action
  avgPositionSize: number;
  coordinationScore: number;
  timestamp: number;
}

export interface WalletRelationship {
  wallet1: string;
  wallet2: string;
  relationshipType: 'copies' | 'coordinates_with' | 'follows' | 'same_team';
  strength: number;               // 0-1, how strong the relationship
  evidence: string[];             // Why we think they're related
}

export class WalletClusters {
  private clusters: Map<string, WalletCluster> = new Map();
  private relationships: WalletRelationship[] = [];
  private coordinationHistory: CoordinationEvent[] = [];

  /**
   * Analyze trades to detect clusters
   */
  analyzeTrades(trades: any[]): void {
    // Group trades by token and time window
    const grouped = this.groupTradesByToken(trades);

    for (const [tokenMint, tokenTrades] of grouped.entries()) {
      // Look for coordinated activity
      const coordinated = this.findCoordinatedActivity(tokenTrades);

      if (coordinated) {
        this.coordinationHistory.push(coordinated);
        this.updateClusters(coordinated);
      }
    }

    // Detect relationships
    this.detectRelationships();

    logger.info('WalletClusters', `Analyzed ${trades.length} trades, found ${this.clusters.size} clusters`);
  }

  /**
   * Group trades by token
   */
  private groupTradesByToken(trades: any[]): Map<string, any[]> {
    const grouped = new Map<string, any[]>();

    for (const trade of trades) {
      if (!grouped.has(trade.tokenMint)) {
        grouped.set(trade.tokenMint, []);
      }
      grouped.get(trade.tokenMint)!.push(trade);
    }

    return grouped;
  }

  /**
   * Find coordinated activity in a set of trades
   */
  private findCoordinatedActivity(trades: any[]): CoordinationEvent | null {
    if (trades.length < 3) return null; // Need at least 3 wallets

    // Sort by timestamp
    trades.sort((a, b) => a.entryTimestamp - b.entryTimestamp);

    const firstTrade = trades[0];
    const lastTrade = trades[trades.length - 1];
    const timeWindow = lastTrade.entryTimestamp - firstTrade.entryTimestamp;

    // Coordinated if within 5 minutes
    if (timeWindow > 5 * 60 * 1000) return null;

    const wallets = trades.map(t => t.walletAddress);
    const avgPositionSize = trades.reduce((sum, t) => sum + (t.entrySolValue || 0), 0) / trades.length;

    // Calculate coordination score
    const coordinationScore = Math.max(0, 1 - (timeWindow / (5 * 60 * 1000)));

    return {
      tokenMint: firstTrade.tokenMint,
      wallets,
      action: 'buy',
      timeWindow,
      avgPositionSize,
      coordinationScore,
      timestamp: firstTrade.entryTimestamp,
    };
  }

  /**
   * Update clusters based on coordination event
   */
  private updateClusters(event: CoordinationEvent): void {
    // Check if any existing cluster contains these wallets
    let targetCluster: WalletCluster | null = null;

    for (const cluster of this.clusters.values()) {
      const overlap = event.wallets.filter(w => cluster.wallets.includes(w));
      if (overlap.length >= 2) {
        targetCluster = cluster;
        break;
      }
    }

    if (targetCluster) {
      // Add new wallets to existing cluster
      for (const wallet of event.wallets) {
        if (!targetCluster.wallets.includes(wallet)) {
          targetCluster.wallets.push(wallet);
        }
      }

      // Update metrics
      targetCluster.coordinatedTrades++;
      targetCluster.lastActivity = event.timestamp;
      targetCluster.coordinationScore = (targetCluster.coordinationScore + event.coordinationScore) / 2;

    } else {
      // Create new cluster
      const cluster: WalletCluster = {
        id: `cluster-${Date.now()}`,
        name: `Cluster ${this.clusters.size + 1}`,
        type: this.determineClusterType(event),
        wallets: event.wallets,
        coordinationScore: event.coordinationScore,
        avgTimeDelta: event.timeWindow / event.wallets.length,
        clusterWinRate: 0, // Will be calculated later
        clusterAvgReturn: 0,
        coordinatedTrades: 1,
        lastActivity: event.timestamp,
        followerCount: event.wallets.length - 1,
      };

      this.clusters.set(cluster.id, cluster);
      logger.info('WalletClusters', `Created new cluster: ${cluster.name} with ${cluster.wallets.length} wallets`);
    }
  }

  /**
   * Determine cluster type
   */
  private determineClusterType(event: CoordinationEvent): WalletCluster['type'] {
    // Simple heuristics
    if (event.avgPositionSize > 50) {
      return 'whale_group';
    }

    if (event.coordinationScore > 0.8) {
      return 'team';
    }

    return 'copycat_network';
  }

  /**
   * Detect relationships between wallets
   */
  private detectRelationships(): void {
    // Look for wallets that frequently trade together
    const walletPairs = new Map<string, { count: number; events: CoordinationEvent[] }>();

    for (const event of this.coordinationHistory) {
      // Create pairs
      for (let i = 0; i < event.wallets.length; i++) {
        for (let j = i + 1; j < event.wallets.length; j++) {
          const pair = [event.wallets[i], event.wallets[j]].sort().join(':');

          if (!walletPairs.has(pair)) {
            walletPairs.set(pair, { count: 0, events: [] });
          }

          const pairData = walletPairs.get(pair)!;
          pairData.count++;
          pairData.events.push(event);
        }
      }
    }

    // Create relationships for pairs with multiple coordinations
    for (const [pair, data] of walletPairs.entries()) {
      if (data.count >= 3) { // At least 3 coordinated events
        const [wallet1, wallet2] = pair.split(':');

        // Determine relationship type
        const avgTimeDelta = data.events.reduce((sum, e) => sum + e.timeWindow, 0) / data.events.length;
        const relationshipType = avgTimeDelta < 60 * 1000 ? 'same_team' : 'coordinates_with';

        const relationship: WalletRelationship = {
          wallet1,
          wallet2,
          relationshipType,
          strength: Math.min(1, data.count / 10), // Strength based on frequency
          evidence: [
            `${data.count} coordinated trades`,
            `Avg ${Math.floor(avgTimeDelta / 1000)}s apart`,
          ],
        };

        this.relationships.push(relationship);
      }
    }

    logger.info('WalletClusters', `Detected ${this.relationships.length} wallet relationships`);
  }

  /**
   * Get cluster for wallet
   */
  getClusterForWallet(walletAddress: string): WalletCluster | null {
    for (const cluster of this.clusters.values()) {
      if (cluster.wallets.includes(walletAddress)) {
        return cluster;
      }
    }
    return null;
  }

  /**
   * Get relationships for wallet
   */
  getRelationshipsForWallet(walletAddress: string): WalletRelationship[] {
    return this.relationships.filter(
      r => r.wallet1 === walletAddress || r.wallet2 === walletAddress
    );
  }

  /**
   * Get all clusters
   */
  getAllClusters(): WalletCluster[] {
    return Array.from(this.clusters.values());
  }

  /**
   * Get clusters by type
   */
  getClustersByType(type: WalletCluster['type']): WalletCluster[] {
    return Array.from(this.clusters.values()).filter(c => c.type === type);
  }

  /**
   * Get coordination history
   */
  getCoordinationHistory(limit: number = 50): CoordinationEvent[] {
    return this.coordinationHistory.slice(-limit);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalClusters: this.clusters.size,
      totalRelationships: this.relationships.length,
      totalCoordinationEvents: this.coordinationHistory.length,
      clustersByType: {
        team: this.getClustersByType('team').length,
        copycat_network: this.getClustersByType('copycat_network').length,
        influencer_network: this.getClustersByType('influencer_network').length,
        whale_group: this.getClustersByType('whale_group').length,
      },
    };
  }
}
