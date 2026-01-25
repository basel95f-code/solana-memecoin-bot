/**
 * Token Flow Analyzer
 * Tracks token accumulation, distribution, and smart money flow
 * Identifies accumulation/distribution phases and whale movements
 */

import { logger } from '../../utils/logger';

export interface TokenFlow {
  tokenMint: string;
  tokenSymbol: string;
  
  // Current state
  phase: 'accumulation' | 'distribution' | 'neutral';
  
  // Smart money activity
  smartMoneyBuying: number;        // Net buying by smart money (SOL)
  smartMoneySelling: number;       // Net selling by smart money (SOL)
  smartMoneyNetFlow: number;       // Net flow (positive = accumulation)
  
  // Wallet counts
  uniqueBuyers: number;
  uniqueSellers: number;
  smartMoneyBuyers: number;        // Count of smart wallets buying
  smartMoneySellers: number;       // Count of smart wallets selling
  
  // Volume
  buyVolume24h: number;
  sellVolume24h: number;
  netVolume24h: number;
  
  // Timing
  accumulationStarted?: number;
  distributionStarted?: number;
  lastUpdate: number;
  
  // Strength
  accumulationStrength: number;    // 0-1, how strong the accumulation
  distributionStrength: number;    // 0-1, how strong the distribution
  
  // Notable wallets
  topAccumulators: WalletAccumulation[];
  topDistributors: WalletAccumulation[];
}

export interface WalletAccumulation {
  walletAddress: string;
  isSmartMoney: boolean;
  netFlow: number;                 // In SOL
  buyCount: number;
  sellCount: number;
  avgPositionSize: number;
  firstActivity: number;
  lastActivity: number;
}

export interface FlowAlert {
  type: 'accumulation_started' | 'distribution_started' | 'whale_accumulation' | 'smart_money_exit';
  tokenMint: string;
  tokenSymbol: string;
  strength: number;
  details: string;
  timestamp: number;
}

export class TokenFlowAnalyzer {
  private flows: Map<string, TokenFlow> = new Map();
  private walletActivity: Map<string, Map<string, WalletAccumulation>> = new Map(); // tokenMint -> walletAddress -> accumulation
  private alerts: FlowAlert[] = [];

  /**
   * Track a buy transaction
   */
  trackBuy(
    walletAddress: string,
    tokenMint: string,
    tokenSymbol: string,
    solValue: number,
    isSmartMoney: boolean
  ): void {
    this.updateWalletActivity(walletAddress, tokenMint, tokenSymbol, solValue, isSmartMoney);
    this.updateTokenFlow(tokenMint, tokenSymbol);
  }

  /**
   * Track a sell transaction
   */
  trackSell(
    walletAddress: string,
    tokenMint: string,
    tokenSymbol: string,
    solValue: number,
    isSmartMoney: boolean
  ): void {
    this.updateWalletActivity(walletAddress, tokenMint, tokenSymbol, -solValue, isSmartMoney);
    this.updateTokenFlow(tokenMint, tokenSymbol);
  }

  /**
   * Update wallet activity
   */
  private updateWalletActivity(
    walletAddress: string,
    tokenMint: string,
    tokenSymbol: string,
    flowAmount: number,
    isSmartMoney: boolean
  ): void {
    if (!this.walletActivity.has(tokenMint)) {
      this.walletActivity.set(tokenMint, new Map());
    }

    const tokenActivity = this.walletActivity.get(tokenMint)!;

    if (!tokenActivity.has(walletAddress)) {
      tokenActivity.set(walletAddress, {
        walletAddress,
        isSmartMoney,
        netFlow: 0,
        buyCount: 0,
        sellCount: 0,
        avgPositionSize: 0,
        firstActivity: Date.now(),
        lastActivity: Date.now(),
      });
    }

    const activity = tokenActivity.get(walletAddress)!;
    activity.netFlow += flowAmount;
    
    if (flowAmount > 0) {
      activity.buyCount++;
    } else {
      activity.sellCount++;
    }

    activity.avgPositionSize = Math.abs(activity.netFlow) / (activity.buyCount + activity.sellCount);
    activity.lastActivity = Date.now();
  }

  /**
   * Update token flow analysis
   */
  private updateTokenFlow(tokenMint: string, tokenSymbol: string): void {
    const tokenActivity = this.walletActivity.get(tokenMint);
    if (!tokenActivity) return;

    const wallets = Array.from(tokenActivity.values());

    // Calculate smart money flow
    const smartMoneyWallets = wallets.filter(w => w.isSmartMoney);
    const smartMoneyBuying = smartMoneyWallets
      .filter(w => w.netFlow > 0)
      .reduce((sum, w) => sum + w.netFlow, 0);
    const smartMoneySelling = Math.abs(
      smartMoneyWallets
        .filter(w => w.netFlow < 0)
        .reduce((sum, w) => sum + w.netFlow, 0)
    );
    const smartMoneyNetFlow = smartMoneyBuying - smartMoneySelling;

    // Count buyers/sellers
    const uniqueBuyers = wallets.filter(w => w.buyCount > 0).length;
    const uniqueSellers = wallets.filter(w => w.sellCount > 0).length;
    const smartMoneyBuyers = smartMoneyWallets.filter(w => w.netFlow > 0).length;
    const smartMoneySellers = smartMoneyWallets.filter(w => w.netFlow < 0).length;

    // Calculate volumes (24h window)
    const now = Date.now();
    const recentWallets = wallets.filter(w => now - w.lastActivity < 24 * 60 * 60 * 1000);
    const buyVolume24h = recentWallets.reduce((sum, w) => sum + Math.max(0, w.netFlow), 0);
    const sellVolume24h = recentWallets.reduce((sum, w) => sum + Math.abs(Math.min(0, w.netFlow)), 0);
    const netVolume24h = buyVolume24h - sellVolume24h;

    // Determine phase
    const phase = this.determinePhase(smartMoneyNetFlow, netVolume24h);

    // Calculate strengths
    const accumulationStrength = this.calculateAccumulationStrength(
      smartMoneyBuyers,
      smartMoneySellers,
      smartMoneyNetFlow,
      buyVolume24h
    );

    const distributionStrength = this.calculateDistributionStrength(
      smartMoneyBuyers,
      smartMoneySellers,
      smartMoneyNetFlow,
      sellVolume24h
    );

    // Get top accumulators/distributors
    const topAccumulators = wallets
      .filter(w => w.netFlow > 0)
      .sort((a, b) => b.netFlow - a.netFlow)
      .slice(0, 5);

    const topDistributors = wallets
      .filter(w => w.netFlow < 0)
      .sort((a, b) => a.netFlow - b.netFlow)
      .slice(0, 5);

    // Get existing flow or create new
    let flow = this.flows.get(tokenMint);
    const previousPhase = flow?.phase;

    if (!flow) {
      flow = {
        tokenMint,
        tokenSymbol,
        phase,
        smartMoneyBuying,
        smartMoneySelling,
        smartMoneyNetFlow,
        uniqueBuyers,
        uniqueSellers,
        smartMoneyBuyers,
        smartMoneySellers,
        buyVolume24h,
        sellVolume24h,
        netVolume24h,
        lastUpdate: now,
        accumulationStrength,
        distributionStrength,
        topAccumulators,
        topDistributors,
      };
      this.flows.set(tokenMint, flow);
    } else {
      // Update existing
      Object.assign(flow, {
        phase,
        smartMoneyBuying,
        smartMoneySelling,
        smartMoneyNetFlow,
        uniqueBuyers,
        uniqueSellers,
        smartMoneyBuyers,
        smartMoneySellers,
        buyVolume24h,
        sellVolume24h,
        netVolume24h,
        lastUpdate: now,
        accumulationStrength,
        distributionStrength,
        topAccumulators,
        topDistributors,
      });
    }

    // Check for phase change
    if (previousPhase && previousPhase !== phase) {
      this.handlePhaseChange(flow, previousPhase, phase);
    }

    // Check for whale accumulation
    this.checkWhaleAccumulation(flow);
  }

  /**
   * Determine accumulation/distribution phase
   */
  private determinePhase(
    smartMoneyNetFlow: number,
    netVolume24h: number
  ): 'accumulation' | 'distribution' | 'neutral' {
    // Strong accumulation: smart money net positive + overall net positive
    if (smartMoneyNetFlow > 5 && netVolume24h > 0) {
      return 'accumulation';
    }

    // Strong distribution: smart money net negative + overall net negative
    if (smartMoneyNetFlow < -5 && netVolume24h < 0) {
      return 'distribution';
    }

    return 'neutral';
  }

  /**
   * Calculate accumulation strength
   */
  private calculateAccumulationStrength(
    smartMoneyBuyers: number,
    smartMoneySellers: number,
    smartMoneyNetFlow: number,
    buyVolume24h: number
  ): number {
    if (smartMoneyBuyers === 0) return 0;

    // Factors: buyer/seller ratio, net flow, volume
    const buyerRatio = smartMoneyBuyers / (smartMoneyBuyers + smartMoneySellers + 1);
    const flowScore = Math.min(1, Math.max(0, smartMoneyNetFlow / 50));
    const volumeScore = Math.min(1, buyVolume24h / 100);

    return (buyerRatio * 0.4 + flowScore * 0.4 + volumeScore * 0.2);
  }

  /**
   * Calculate distribution strength
   */
  private calculateDistributionStrength(
    smartMoneyBuyers: number,
    smartMoneySellers: number,
    smartMoneyNetFlow: number,
    sellVolume24h: number
  ): number {
    if (smartMoneySellers === 0) return 0;

    const sellerRatio = smartMoneySellers / (smartMoneyBuyers + smartMoneySellers + 1);
    const flowScore = Math.min(1, Math.max(0, Math.abs(smartMoneyNetFlow) / 50));
    const volumeScore = Math.min(1, sellVolume24h / 100);

    return (sellerRatio * 0.4 + flowScore * 0.4 + volumeScore * 0.2);
  }

  /**
   * Handle phase change
   */
  private handlePhaseChange(
    flow: TokenFlow,
    oldPhase: string,
    newPhase: string
  ): void {
    if (newPhase === 'accumulation') {
      flow.accumulationStarted = Date.now();
      
      this.createAlert({
        type: 'accumulation_started',
        tokenMint: flow.tokenMint,
        tokenSymbol: flow.tokenSymbol,
        strength: flow.accumulationStrength,
        details: `${flow.smartMoneyBuyers} smart wallets accumulating`,
        timestamp: Date.now(),
      });

    } else if (newPhase === 'distribution') {
      flow.distributionStarted = Date.now();

      this.createAlert({
        type: 'distribution_started',
        tokenMint: flow.tokenMint,
        tokenSymbol: flow.tokenSymbol,
        strength: flow.distributionStrength,
        details: `${flow.smartMoneySellers} smart wallets distributing`,
        timestamp: Date.now(),
      });
    }

    logger.info('TokenFlowAnalyzer', `${flow.tokenSymbol} phase changed: ${oldPhase} -> ${newPhase}`);
  }

  /**
   * Check for whale accumulation
   */
  private checkWhaleAccumulation(flow: TokenFlow): void {
    const whaleAccumulators = flow.topAccumulators.filter(a => a.netFlow > 50);

    if (whaleAccumulators.length > 0) {
      this.createAlert({
        type: 'whale_accumulation',
        tokenMint: flow.tokenMint,
        tokenSymbol: flow.tokenSymbol,
        strength: 1.0,
        details: `${whaleAccumulators.length} whales accumulating (${whaleAccumulators[0].netFlow.toFixed(1)} SOL)`,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Create alert
   */
  private createAlert(alert: FlowAlert): void {
    this.alerts.push(alert);
    logger.info('TokenFlowAnalyzer', `Alert: ${alert.type} for ${alert.tokenSymbol}`);
  }

  /**
   * Get token flow
   */
  getTokenFlow(tokenMint: string): TokenFlow | undefined {
    return this.flows.get(tokenMint);
  }

  /**
   * Get accumulation tokens
   */
  getAccumulationTokens(): TokenFlow[] {
    return Array.from(this.flows.values())
      .filter(f => f.phase === 'accumulation')
      .sort((a, b) => b.accumulationStrength - a.accumulationStrength);
  }

  /**
   * Get distribution tokens
   */
  getDistributionTokens(): TokenFlow[] {
    return Array.from(this.flows.values())
      .filter(f => f.phase === 'distribution')
      .sort((a, b) => b.distributionStrength - a.distributionStrength);
  }

  /**
   * Get recent alerts
   */
  getAlerts(limit: number = 20): FlowAlert[] {
    return this.alerts.slice(-limit);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalTokensTracked: this.flows.size,
      accumulationPhase: Array.from(this.flows.values()).filter(f => f.phase === 'accumulation').length,
      distributionPhase: Array.from(this.flows.values()).filter(f => f.phase === 'distribution').length,
      neutralPhase: Array.from(this.flows.values()).filter(f => f.phase === 'neutral').length,
      totalAlerts: this.alerts.length,
    };
  }
}
