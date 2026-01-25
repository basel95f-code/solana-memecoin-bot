/**
 * Sentiment Correlation Analyzer
 * Correlates social sentiment with price movements
 * Identifies predictive sentiment patterns
 */

import { logger } from '../../utils/logger';
import type { SentimentData } from './SentimentTracker';

export interface CorrelationData {
  tokenMint: string;
  tokenSymbol: string;
  
  // Correlation coefficients (-1 to +1)
  sentimentPriceCorrelation: number;     // Sentiment vs price
  volumePriceCorrelation: number;        // Social volume vs price
  
  // Lead/lag analysis
  sentimentLeadsPrice: boolean;          // Does sentiment predict price?
  optimalLeadTime: number;               // Best time lag in minutes
  
  // Predictive power
  predictiveScore: number;               // 0-1, how well sentiment predicts price
  
  // Historical accuracy
  correctPredictions: number;
  totalPredictions: number;
  accuracy: number;
  
  // Patterns
  bullishSentimentSuccess: number;       // % times bullish sentiment led to pump
  bearishSentimentSuccess: number;       // % times bearish sentiment led to dump
  
  lastUpdate: number;
}

export interface PriceSentimentEvent {
  tokenMint: string;
  timestamp: number;
  sentimentScore: number;
  priceChange: number;                   // % change after sentiment
  timeLag: number;                       // Minutes between sentiment and price move
  wasCorrect: boolean;                   // Did sentiment predict correctly?
}

export class SentimentCorrelation {
  private correlations: Map<string, CorrelationData> = new Map();
  private events: Map<string, PriceSentimentEvent[]> = new Map(); // tokenMint -> events
  private readonly MAX_EVENTS = 100; // Per token

  /**
   * Analyze correlation for a token
   */
  async analyzeCorrelation(
    tokenMint: string,
    tokenSymbol: string,
    sentiment: SentimentData,
    priceHistory: any[]
  ): Promise<CorrelationData> {
    logger.debug('SentimentCorrelation', `Analyzing correlation for ${tokenSymbol}`);

    // Calculate correlation coefficients
    const sentimentPriceCorrelation = this.calculateCorrelation(
      sentiment,
      priceHistory,
      'sentiment'
    );

    const volumePriceCorrelation = this.calculateCorrelation(
      sentiment,
      priceHistory,
      'volume'
    );

    // Analyze lead/lag relationship
    const { sentimentLeadsPrice, optimalLeadTime } = this.analyzeLeadLag(
      sentiment,
      priceHistory
    );

    // Calculate predictive score
    const predictiveScore = this.calculatePredictiveScore(
      sentimentPriceCorrelation,
      sentimentLeadsPrice
    );

    // Get historical accuracy
    const { correctPredictions, totalPredictions, accuracy } = this.calculateAccuracy(tokenMint);

    // Pattern analysis
    const { bullishSentimentSuccess, bearishSentimentSuccess } = this.analyzePatterns(tokenMint);

    const correlation: CorrelationData = {
      tokenMint,
      tokenSymbol,
      sentimentPriceCorrelation,
      volumePriceCorrelation,
      sentimentLeadsPrice,
      optimalLeadTime,
      predictiveScore,
      correctPredictions,
      totalPredictions,
      accuracy,
      bullishSentimentSuccess,
      bearishSentimentSuccess,
      lastUpdate: Date.now(),
    };

    this.correlations.set(tokenMint, correlation);

    logger.info('SentimentCorrelation', `${tokenSymbol} correlation: ${(sentimentPriceCorrelation * 100).toFixed(1)}%, predictive: ${(predictiveScore * 100).toFixed(1)}%`);

    return correlation;
  }

  /**
   * Record a sentiment -> price event
   */
  recordEvent(
    tokenMint: string,
    sentimentScore: number,
    priceChange: number,
    timeLag: number
  ): void {
    // Determine if sentiment was correct
    const wasCorrect =
      (sentimentScore > 0.2 && priceChange > 5) ||  // Bullish sentiment + pump
      (sentimentScore < -0.2 && priceChange < -5);  // Bearish sentiment + dump

    const event: PriceSentimentEvent = {
      tokenMint,
      timestamp: Date.now(),
      sentimentScore,
      priceChange,
      timeLag,
      wasCorrect,
    };

    if (!this.events.has(tokenMint)) {
      this.events.set(tokenMint, []);
    }

    const tokenEvents = this.events.get(tokenMint)!;
    tokenEvents.push(event);

    // Keep only recent events
    if (tokenEvents.length > this.MAX_EVENTS) {
      tokenEvents.shift();
    }
  }

  /**
   * Calculate correlation coefficient
   */
  private calculateCorrelation(
    sentiment: SentimentData,
    priceHistory: any[],
    type: 'sentiment' | 'volume'
  ): number {
    // Simplified correlation calculation
    // In real implementation, would use Pearson correlation
    
    const sentimentValue = type === 'sentiment'
      ? sentiment.sentimentScore
      : sentiment.totalMentions / 1000; // Normalize volume

    // Compare with recent price changes
    if (priceHistory.length < 2) return 0;

    const recentPriceChange = (priceHistory[0].price - priceHistory[1].price) / priceHistory[1].price;

    // Simple correlation: positive if both positive or both negative
    const correlation = sentimentValue * recentPriceChange;

    return Math.max(-1, Math.min(1, correlation * 5)); // Scale to -1 to +1
  }

  /**
   * Analyze lead/lag relationship
   */
  private analyzeLeadLag(
    sentiment: SentimentData,
    priceHistory: any[]
  ): { sentimentLeadsPrice: boolean; optimalLeadTime: number } {
    // Simplified analysis
    // In real implementation, would test different time lags

    const events = this.events.get(sentiment.tokenMint) || [];
    
    if (events.length < 10) {
      return { sentimentLeadsPrice: false, optimalLeadTime: 0 };
    }

    // Check if sentiment typically leads price by 5-30 minutes
    const leadingEvents = events.filter(e => e.wasCorrect && e.timeLag >= 5 && e.timeLag <= 30);

    const sentimentLeadsPrice = leadingEvents.length / events.length > 0.6;
    const optimalLeadTime = sentimentLeadsPrice
      ? leadingEvents.reduce((sum, e) => sum + e.timeLag, 0) / leadingEvents.length
      : 0;

    return { sentimentLeadsPrice, optimalLeadTime };
  }

  /**
   * Calculate predictive score
   */
  private calculatePredictiveScore(
    correlation: number,
    sentimentLeadsPrice: boolean
  ): number {
    // Combine correlation strength with lead/lag relationship
    const correlationScore = Math.abs(correlation);
    const leadBonus = sentimentLeadsPrice ? 0.3 : 0;

    return Math.min(1, correlationScore * 0.7 + leadBonus);
  }

  /**
   * Calculate historical accuracy
   */
  private calculateAccuracy(tokenMint: string): {
    correctPredictions: number;
    totalPredictions: number;
    accuracy: number;
  } {
    const events = this.events.get(tokenMint) || [];
    
    const correctPredictions = events.filter(e => e.wasCorrect).length;
    const totalPredictions = events.length;
    const accuracy = totalPredictions > 0 ? correctPredictions / totalPredictions : 0;

    return { correctPredictions, totalPredictions, accuracy };
  }

  /**
   * Analyze sentiment patterns
   */
  private analyzePatterns(tokenMint: string): {
    bullishSentimentSuccess: number;
    bearishSentimentSuccess: number;
  } {
    const events = this.events.get(tokenMint) || [];

    const bullishEvents = events.filter(e => e.sentimentScore > 0.2);
    const bearishEvents = events.filter(e => e.sentimentScore < -0.2);

    const bullishSentimentSuccess = bullishEvents.length > 0
      ? bullishEvents.filter(e => e.wasCorrect).length / bullishEvents.length
      : 0;

    const bearishSentimentSuccess = bearishEvents.length > 0
      ? bearishEvents.filter(e => e.wasCorrect).length / bearishEvents.length
      : 0;

    return { bullishSentimentSuccess, bearishSentimentSuccess };
  }

  /**
   * Get correlation data
   */
  getCorrelation(tokenMint: string): CorrelationData | undefined {
    return this.correlations.get(tokenMint);
  }

  /**
   * Get tokens with strong predictive sentiment
   */
  getPredictiveTokens(minScore: number = 0.6): CorrelationData[] {
    return Array.from(this.correlations.values())
      .filter(c => c.predictiveScore >= minScore && c.accuracy >= 0.6)
      .sort((a, b) => b.predictiveScore - a.predictiveScore);
  }

  /**
   * Get tokens where sentiment leads price
   */
  getLeadingIndicators(): CorrelationData[] {
    return Array.from(this.correlations.values())
      .filter(c => c.sentimentLeadsPrice && c.accuracy >= 0.6)
      .sort((a, b) => a.optimalLeadTime - b.optimalLeadTime); // Shortest lead time first
  }

  /**
   * Get recent events
   */
  getEvents(tokenMint: string, limit: number = 20): PriceSentimentEvent[] {
    const events = this.events.get(tokenMint) || [];
    return events.slice(-limit);
  }

  /**
   * Get statistics
   */
  getStats() {
    const correlations = Array.from(this.correlations.values());

    return {
      totalTokens: correlations.length,
      predictiveTokens: correlations.filter(c => c.predictiveScore >= 0.6).length,
      leadingIndicators: correlations.filter(c => c.sentimentLeadsPrice).length,
      avgAccuracy: correlations.length > 0
        ? correlations.reduce((sum, c) => sum + c.accuracy, 0) / correlations.length
        : 0,
      avgPredictiveScore: correlations.length > 0
        ? correlations.reduce((sum, c) => sum + c.predictiveScore, 0) / correlations.length
        : 0,
    };
  }
}
