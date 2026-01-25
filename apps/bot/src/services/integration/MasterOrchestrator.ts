/**
 * Master Orchestrator
 * Integrates all systems into one automated pipeline
 * Discovery → Analysis → Smart Money → Sentiment → Risk → Alert → Decision
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';

export interface TokenDiscoveryEvent {
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  source: string;
  discoveredAt: number;
  initialData: {
    price?: number;
    liquidity?: number;
    marketCap?: number;
  };
}

export interface IntegratedAnalysis {
  token: TokenDiscoveryEvent;
  
  // Analysis results
  riskScore: number;              // 0-100
  mlPrediction: number;           // 0-1 (rug probability)
  sentimentScore: number;         // -1 to +1
  smartMoneyActivity: {
    isBuying: boolean;
    topWalletsCount: number;
    avgConfidence: number;
  };
  
  // Combined metrics
  overallScore: number;           // 0-100, weighted combination
  confidence: number;             // 0-1, how confident are we
  
  // Decision
  recommendation: 'STRONG_BUY' | 'BUY' | 'WATCH' | 'AVOID' | 'STRONG_AVOID';
  reasoning: string[];
  
  // Timing
  analysisTimeMs: number;
  latencyFromDiscovery: number;   // ms from discovery to decision
  
  timestamp: number;
}

export interface OrchestrationConfig {
  enableSmartMoney: boolean;
  enableSentiment: boolean;
  enableML: boolean;
  
  // Scoring weights
  weights: {
    riskScore: number;            // Default 0.3
    mlPrediction: number;         // Default 0.25
    sentiment: number;            // Default 0.15
    smartMoney: number;           // Default 0.3
  };
  
  // Thresholds
  strongBuyThreshold: number;     // 80
  buyThreshold: number;           // 65
  watchThreshold: number;         // 50
  
  // Speed
  maxAnalysisTimeMs: number;      // Timeout for analysis
  parallelAnalysis: boolean;      // Run analysis in parallel
}

export class MasterOrchestrator extends EventEmitter {
  private config: OrchestrationConfig;
  private analysisHistory: IntegratedAnalysis[] = [];
  private readonly MAX_HISTORY = 1000;

  private readonly DEFAULT_CONFIG: OrchestrationConfig = {
    enableSmartMoney: true,
    enableSentiment: true,
    enableML: true,
    weights: {
      riskScore: 0.3,
      mlPrediction: 0.25,
      sentiment: 0.15,
      smartMoney: 0.3,
    },
    strongBuyThreshold: 80,
    buyThreshold: 65,
    watchThreshold: 50,
    maxAnalysisTimeMs: 5000,
    parallelAnalysis: true,
  };

  constructor(config: Partial<OrchestrationConfig> = {}) {
    super();
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  /**
   * Process discovered token through full pipeline
   */
  async processDiscovery(discovery: TokenDiscoveryEvent): Promise<IntegratedAnalysis> {
    const startTime = Date.now();
    
    logger.info('MasterOrchestrator', `Processing ${discovery.tokenSymbol} from ${discovery.source}`);

    try {
      // Run all analysis in parallel for speed
      const [
        riskScore,
        mlPrediction,
        sentimentScore,
        smartMoneyActivity
      ] = await this.runParallelAnalysis(discovery);

      // Calculate overall score
      const overallScore = this.calculateOverallScore(
        riskScore,
        mlPrediction,
        sentimentScore,
        smartMoneyActivity
      );

      // Calculate confidence
      const confidence = this.calculateConfidence(
        riskScore,
        mlPrediction,
        sentimentScore,
        smartMoneyActivity
      );

      // Make recommendation
      const { recommendation, reasoning } = this.makeRecommendation(
        overallScore,
        confidence,
        riskScore,
        mlPrediction,
        sentimentScore,
        smartMoneyActivity
      );

      const analysisTimeMs = Date.now() - startTime;
      const latencyFromDiscovery = Date.now() - discovery.discoveredAt;

      const analysis: IntegratedAnalysis = {
        token: discovery,
        riskScore,
        mlPrediction,
        sentimentScore,
        smartMoneyActivity,
        overallScore,
        confidence,
        recommendation,
        reasoning,
        analysisTimeMs,
        latencyFromDiscovery,
        timestamp: Date.now(),
      };

      // Store history
      this.analysisHistory.push(analysis);
      if (this.analysisHistory.length > this.MAX_HISTORY) {
        this.analysisHistory.shift();
      }

      // Emit events
      this.emit('analysis_complete', analysis);
      this.emit(recommendation.toLowerCase(), analysis);

      logger.info('MasterOrchestrator', `${discovery.tokenSymbol}: ${recommendation} (score: ${overallScore}, confidence: ${(confidence * 100).toFixed(0)}%) in ${analysisTimeMs}ms`);

      return analysis;

    } catch (error: any) {
      logger.error('MasterOrchestrator', `Analysis failed for ${discovery.tokenSymbol}:`, error);
      throw error;
    }
  }

  /**
   * Run all analysis in parallel
   */
  private async runParallelAnalysis(discovery: TokenDiscoveryEvent): Promise<[
    number, // riskScore
    number, // mlPrediction
    number, // sentimentScore
    any     // smartMoneyActivity
  ]> {
    const promises: Promise<any>[] = [];

    // Risk analysis (always enabled)
    promises.push(this.analyzeRisk(discovery));

    // ML prediction
    promises.push(
      this.config.enableML
        ? this.analyzeML(discovery)
        : Promise.resolve(0.5) // Neutral
    );

    // Sentiment analysis
    promises.push(
      this.config.enableSentiment
        ? this.analyzeSentiment(discovery)
        : Promise.resolve(0) // Neutral
    );

    // Smart money analysis
    promises.push(
      this.config.enableSmartMoney
        ? this.analyzeSmartMoney(discovery)
        : Promise.resolve({ isBuying: false, topWalletsCount: 0, avgConfidence: 0 })
    );

    // Run with timeout
    return Promise.race([
      Promise.all(promises),
      this.timeout(this.config.maxAnalysisTimeMs),
    ]) as Promise<[number, number, number, any]>;
  }

  /**
   * Analyze risk
   */
  private async analyzeRisk(discovery: TokenDiscoveryEvent): Promise<number> {
    // In real implementation, would call risk classifier
    // Placeholder: score based on liquidity
    const liquidity = discovery.initialData.liquidity || 0;
    
    let score = 50; // Base
    if (liquidity >= 50000) score += 30;
    else if (liquidity >= 10000) score += 20;
    else if (liquidity < 1000) score -= 20;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Analyze ML prediction
   */
  private async analyzeML(discovery: TokenDiscoveryEvent): Promise<number> {
    // In real implementation, would call ML predictor
    // Placeholder: return rug probability
    return 0.3; // 30% rug probability
  }

  /**
   * Analyze sentiment
   */
  private async analyzeSentiment(discovery: TokenDiscoveryEvent): Promise<number> {
    // In real implementation, would call sentiment tracker
    // Placeholder
    return 0.2; // Slightly bullish
  }

  /**
   * Analyze smart money
   */
  private async analyzeSmartMoney(discovery: TokenDiscoveryEvent): Promise<any> {
    // In real implementation, would check smart money tracker
    // Placeholder
    return {
      isBuying: true,
      topWalletsCount: 3,
      avgConfidence: 0.75,
    };
  }

  /**
   * Calculate overall score
   */
  private calculateOverallScore(
    riskScore: number,
    mlPrediction: number,
    sentimentScore: number,
    smartMoneyActivity: any
  ): number {
    const { weights } = this.config;

    // Convert ML prediction (rug prob) to score (lower rug prob = higher score)
    const mlScore = (1 - mlPrediction) * 100;

    // Convert sentiment (-1 to +1) to score (0 to 100)
    const sentimentScoreNormalized = ((sentimentScore + 1) / 2) * 100;

    // Smart money score (0 to 100)
    const smartMoneyScore = smartMoneyActivity.isBuying
      ? smartMoneyActivity.avgConfidence * 100
      : 0;

    // Weighted combination
    const overall =
      weights.riskScore * riskScore +
      weights.mlPrediction * mlScore +
      weights.sentiment * sentimentScoreNormalized +
      weights.smartMoney * smartMoneyScore;

    return Math.max(0, Math.min(100, overall));
  }

  /**
   * Calculate confidence
   */
  private calculateConfidence(
    riskScore: number,
    mlPrediction: number,
    sentimentScore: number,
    smartMoneyActivity: any
  ): number {
    // Confidence based on:
    // 1. Agreement between signals
    // 2. Data quality
    // 3. Smart money confidence

    // Normalize scores to 0-1
    const risk = riskScore / 100;
    const ml = 1 - mlPrediction;
    const sentiment = (sentimentScore + 1) / 2;
    const smartMoney = smartMoneyActivity.isBuying ? smartMoneyActivity.avgConfidence : 0;

    // Calculate variance (lower = more agreement)
    const signals = [risk, ml, sentiment, smartMoney];
    const avg = signals.reduce((a, b) => a + b, 0) / signals.length;
    const variance = signals.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / signals.length;

    const agreement = Math.max(0, 1 - variance * 2);

    // Data quality (placeholder)
    const dataQuality = 0.8;

    // Combined confidence
    return (agreement * 0.6 + dataQuality * 0.2 + smartMoneyActivity.avgConfidence * 0.2);
  }

  /**
   * Make recommendation
   */
  private makeRecommendation(
    overallScore: number,
    confidence: number,
    riskScore: number,
    mlPrediction: number,
    sentimentScore: number,
    smartMoneyActivity: any
  ): { recommendation: IntegratedAnalysis['recommendation']; reasoning: string[] } {
    const reasoning: string[] = [];

    // Strong avoid conditions
    if (mlPrediction > 0.7) {
      reasoning.push('⚠️ High rug probability detected');
      return { recommendation: 'STRONG_AVOID', reasoning };
    }

    if (riskScore < 30) {
      reasoning.push('⚠️ Very low risk score');
      return { recommendation: 'STRONG_AVOID', reasoning };
    }

    // Strong buy conditions
    if (overallScore >= this.config.strongBuyThreshold && confidence >= 0.7) {
      if (smartMoneyActivity.isBuying && smartMoneyActivity.topWalletsCount >= 3) {
        reasoning.push('🔥 Top smart money wallets buying');
      }
      if (riskScore >= 70) {
        reasoning.push('✅ High risk score');
      }
      if (sentimentScore > 0.3) {
        reasoning.push('📈 Strong bullish sentiment');
      }
      if (mlPrediction < 0.2) {
        reasoning.push('🛡️ Very low rug probability');
      }
      return { recommendation: 'STRONG_BUY', reasoning };
    }

    // Buy conditions
    if (overallScore >= this.config.buyThreshold && confidence >= 0.6) {
      if (smartMoneyActivity.isBuying) {
        reasoning.push('💰 Smart money accumulating');
      }
      if (riskScore >= 60) {
        reasoning.push('✅ Good risk score');
      }
      return { recommendation: 'BUY', reasoning };
    }

    // Watch conditions
    if (overallScore >= this.config.watchThreshold) {
      reasoning.push('👀 Meets minimum criteria');
      if (sentimentScore > 0) {
        reasoning.push('Positive sentiment');
      }
      return { recommendation: 'WATCH', reasoning };
    }

    // Avoid
    reasoning.push('Below thresholds');
    return { recommendation: 'AVOID', reasoning };
  }

  /**
   * Timeout helper
   */
  private async timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Analysis timeout')), ms);
    });
  }

  /**
   * Get analysis history
   */
  getHistory(limit: number = 50): IntegratedAnalysis[] {
    return this.analysisHistory.slice(-limit);
  }

  /**
   * Get strong buy signals
   */
  getStrongBuySignals(limit: number = 20): IntegratedAnalysis[] {
    return this.analysisHistory
      .filter(a => a.recommendation === 'STRONG_BUY')
      .slice(-limit);
  }

  /**
   * Get statistics
   */
  getStats() {
    const total = this.analysisHistory.length;
    if (total === 0) return null;

    return {
      totalAnalyzed: total,
      avgAnalysisTimeMs: this.analysisHistory.reduce((sum, a) => sum + a.analysisTimeMs, 0) / total,
      avgLatencyMs: this.analysisHistory.reduce((sum, a) => sum + a.latencyFromDiscovery, 0) / total,
      recommendations: {
        strongBuy: this.analysisHistory.filter(a => a.recommendation === 'STRONG_BUY').length,
        buy: this.analysisHistory.filter(a => a.recommendation === 'BUY').length,
        watch: this.analysisHistory.filter(a => a.recommendation === 'WATCH').length,
        avoid: this.analysisHistory.filter(a => a.recommendation === 'AVOID').length,
        strongAvoid: this.analysisHistory.filter(a => a.recommendation === 'STRONG_AVOID').length,
      },
      avgOverallScore: this.analysisHistory.reduce((sum, a) => sum + a.overallScore, 0) / total,
      avgConfidence: this.analysisHistory.reduce((sum, a) => sum + a.confidence, 0) / total,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<OrchestrationConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('MasterOrchestrator', 'Configuration updated');
  }
}
