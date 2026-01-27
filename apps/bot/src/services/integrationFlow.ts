/**
 * Integration Flow Service
 * Single command that runs ALL analysis and gives unified recommendation
 */

import { analyzeToken } from '../analysis/tokenAnalyzer';
import { contractAnalyzer } from '../analysis/contractAnalyzer';
import { analyzeSentiment } from '../analysis/sentimentAnalysis';
import { rugPredictor } from '../ml/rugPredictor';
import { advancedRiskManager } from './advancedRiskManager';
import { dexScreenerService } from './dexscreener';
import { strategyAutomation } from './strategyAutomation';
import { logger } from '../utils/logger';
import type { TokenAnalysis } from '../types';

export interface IntegratedAnalysis {
  // Token info
  tokenMint: string;
  symbol: string;
  name: string;

  // All analysis results
  tokenAnalysis: TokenAnalysis | null;
  securityAnalysis: any | null;
  sentimentAnalysis: any | null;
  mlPrediction: any | null;
  priceData: any | null;
  riskCalculation: any | null;
  automationDecision: any | null;

  // Final recommendation
  recommendation: 'BUY' | 'WATCH' | 'AVOID';
  confidence: number; // 0-100
  reasoning: string[];

  // Suggested action
  suggestedPositionSize?: number;
  suggestedStopLoss?: number;
  suggestedTakeProfit?: number;

  // Timing
  analysisTime: number; // ms
  timestamp: number;
}

class IntegrationFlow {
  /**
   * Analyze everything about a token and give unified recommendation
   */
  async analyzeAll(tokenMint: string): Promise<IntegratedAnalysis> {
    const startTime = Date.now();

    const result: IntegratedAnalysis = {
      tokenMint,
      symbol: '',
      name: '',
      tokenAnalysis: null,
      securityAnalysis: null,
      sentimentAnalysis: null,
      mlPrediction: null,
      priceData: null,
      riskCalculation: null,
      automationDecision: null,
      recommendation: 'AVOID',
      confidence: 0,
      reasoning: [],
      analysisTime: 0,
      timestamp: Date.now(),
    };

    try {
      // Step 0: Get pool data first
      const poolData = await dexScreenerService.getTokenData(tokenMint);
      if (!poolData) {
        result.reasoning.push('❌ Failed to fetch token data');
        result.recommendation = 'AVOID';
        return result;
      }

      // Create minimal PoolInfo from poolData
      const pool = {
        address: poolData.pairAddress || '',
        tokenMint: tokenMint,
        baseMint: poolData.baseToken?.address || '',
        quoteMint: poolData.quoteToken?.address || '',
        source: 'raydium',
        createdAt: Date.now(),
      };

      // Step 1: Token Analysis (foundation)
      logger.info('IntegrationFlow', 'Running token analysis...');
      const analysis = await analyzeToken(tokenMint, pool);
      
      if (!analysis) {
        result.reasoning.push('❌ Failed to analyze token');
        result.recommendation = 'AVOID';
        return result;
      }

      result.tokenAnalysis = analysis;
      result.symbol = analysis.token.symbol;
      result.name = analysis.token.name;

      // Step 2-6: Run all analyses in parallel
      logger.info('IntegrationFlow', 'Running comprehensive analysis...');
      
      const [security, sentiment, priceData] = await Promise.allSettled([
        contractAnalyzer.analyzeContract(tokenMint),
        analyzeSentiment(analysis.token),
        dexScreenerService.getTokenData(tokenMint),
      ]);

      // Extract results
      result.securityAnalysis = security.status === 'fulfilled' ? security.value : null;
      result.sentimentAnalysis = sentiment.status === 'fulfilled' ? sentiment.value : null;
      result.priceData = priceData.status === 'fulfilled' ? priceData.value : null;

      // Step 7: ML Prediction
      logger.info('IntegrationFlow', 'Running ML prediction...');
      result.mlPrediction = await rugPredictor.predictEnhanced({
        liquidityUsd: analysis.liquidity.totalLiquidityUsd,
        riskScore: analysis.risk.score,
        holderCount: analysis.holders.totalHolders,
        top10Percent: analysis.holders.top10HoldersPercent,
        mintRevoked: analysis.contract.mintAuthorityRevoked,
        freezeRevoked: analysis.contract.freezeAuthorityRevoked,
        lpBurnedPercent: analysis.liquidity.lpBurnedPercent,
        hasSocials: analysis.social.hasTwitter || analysis.social.hasTelegram,
        tokenAgeHours: 1,
        priceChange1h: result.priceData?.priceChange?.h1,
        sentimentScore: result.sentimentAnalysis?.sentimentScore,
        sentimentConfidence: result.sentimentAnalysis?.confidence,
        hasSentimentData: result.sentimentAnalysis?.hasSentimentData,
      });

      // Step 8: Automation Decision
      logger.info('IntegrationFlow', 'Running strategy automation...');
      result.automationDecision = await strategyAutomation.processToken(analysis);

      // Step 9: Calculate Recommendation
      const recommendation = this.calculateRecommendation(result);
      result.recommendation = recommendation.action;
      result.confidence = recommendation.confidence;
      result.reasoning = recommendation.reasons;

      // Step 10: Risk Calculation (if BUY recommended)
      if (result.recommendation === 'BUY' && result.priceData) {
        logger.info('IntegrationFlow', 'Calculating position size...');
        
        const entryPrice = parseFloat(result.priceData.priceUsd || '0');
        const stopLoss = advancedRiskManager.calculateStopLoss({
          entryPrice,
          riskScore: analysis.risk.score,
        });

        const riskCalc = await advancedRiskManager.calculatePositionSize({
          symbol: result.symbol,
          entryPrice,
          stopLossPrice: stopLoss,
          mlConfidence: result.mlPrediction.confidence,
          riskScore: analysis.risk.score,
        });

        result.riskCalculation = riskCalc;
        result.suggestedPositionSize = riskCalc.recommendedSize;
        result.suggestedStopLoss = riskCalc.stopLossPrice;
        result.suggestedTakeProfit = riskCalc.takeProfitPrice;
      }

    } catch (error) {
      logger.error('IntegrationFlow', 'Analysis failed', error as Error);
      result.reasoning.push(`❌ Error: ${(error as Error).message}`);
      result.recommendation = 'AVOID';
    }

    result.analysisTime = Date.now() - startTime;
    return result;
  }

  /**
   * Calculate final recommendation based on all data
   */
  private calculateRecommendation(result: IntegratedAnalysis): {
    action: 'BUY' | 'WATCH' | 'AVOID';
    confidence: number;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let buyScore = 0;
    let avoidScore = 0;

    // Security Analysis (40 points)
    if (result.securityAnalysis) {
      if (result.securityAnalysis.safetyLevel === 'dangerous') {
        avoidScore += 40;
        reasons.push(`🚫 Security: ${result.securityAnalysis.safetyLevel} (score: ${result.securityAnalysis.securityScore}/100)`);
      } else if (result.securityAnalysis.safetyLevel === 'safe') {
        buyScore += 40;
        reasons.push(`✅ Security: safe (score: ${result.securityAnalysis.securityScore}/100)`);
      } else {
        buyScore += 20;
        reasons.push(`⚠️ Security: caution (score: ${result.securityAnalysis.securityScore}/100)`);
      }
    }

    // ML Prediction (30 points)
    if (result.mlPrediction) {
      if (result.mlPrediction.rugProbability < 0.3) {
        buyScore += 30;
        reasons.push(`✅ ML: Low rug risk (${(result.mlPrediction.rugProbability * 100).toFixed(0)}%)`);
      } else if (result.mlPrediction.rugProbability > 0.7) {
        avoidScore += 30;
        reasons.push(`🚫 ML: High rug risk (${(result.mlPrediction.rugProbability * 100).toFixed(0)}%)`);
      } else {
        buyScore += 10;
        reasons.push(`⚠️ ML: Medium rug risk (${(result.mlPrediction.rugProbability * 100).toFixed(0)}%)`);
      }
    }

    // Risk Score (20 points)
    if (result.tokenAnalysis) {
      if (result.tokenAnalysis.risk.score >= 70) {
        buyScore += 20;
        reasons.push(`✅ Risk: ${result.tokenAnalysis.risk.score}/100`);
      } else if (result.tokenAnalysis.risk.score < 50) {
        avoidScore += 20;
        reasons.push(`🚫 Risk: ${result.tokenAnalysis.risk.score}/100`);
      } else {
        buyScore += 10;
        reasons.push(`⚠️ Risk: ${result.tokenAnalysis.risk.score}/100`);
      }
    }

    // Sentiment (10 points)
    if (result.sentimentAnalysis?.hasSentimentData) {
      if (result.sentimentAnalysis.sentimentScore > 0.5) {
        buyScore += 10;
        reasons.push(`✅ Sentiment: Positive (${(result.sentimentAnalysis.sentimentScore * 100).toFixed(0)}%)`);
      } else if (result.sentimentAnalysis.sentimentScore < -0.5) {
        avoidScore += 10;
        reasons.push(`🚫 Sentiment: Negative (${(result.sentimentAnalysis.sentimentScore * 100).toFixed(0)}%)`);
      }
    }

    // Automation Decision
    if (result.automationDecision) {
      if (result.automationDecision.category === 'gem') {
        buyScore += 15;
        reasons.push(`✅ Automation: Categorized as GEM`);
      } else if (result.automationDecision.category === 'avoid') {
        avoidScore += 15;
        reasons.push(`🚫 Automation: Categorized as AVOID`);
      }
    }

    // Calculate final recommendation
    const totalScore = buyScore + avoidScore;
    const confidence = totalScore > 0 ? Math.min((buyScore / 100) * 100, 100) : 0;

    let action: 'BUY' | 'WATCH' | 'AVOID';
    if (avoidScore > buyScore || buyScore < 50) {
      action = 'AVOID';
    } else if (buyScore >= 70) {
      action = 'BUY';
    } else {
      action = 'WATCH';
    }

    return { action, confidence, reasons };
  }

  /**
   * Format integrated analysis for display
   */
  formatAnalysis(result: IntegratedAnalysis): string {
    let output = `🔍 INTEGRATED ANALYSIS\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    output += `<b>${result.symbol}</b> - ${result.name}\n`;
    output += `<code>${result.tokenMint}</code>\n\n`;

    // Recommendation
    const emoji = {
      BUY: '🟢',
      WATCH: '🟡',
      AVOID: '🔴',
    }[result.recommendation];

    output += `${emoji} <b>RECOMMENDATION: ${result.recommendation}</b>\n`;
    output += `Confidence: ${result.confidence.toFixed(0)}%\n\n`;

    // Reasoning
    output += `<b>Analysis:</b>\n`;
    for (const reason of result.reasoning) {
      output += `${reason}\n`;
    }
    output += `\n`;

    // Position sizing (if BUY)
    if (result.recommendation === 'BUY' && result.riskCalculation) {
      output += `<b>💰 Suggested Position:</b>\n`;
      output += `Size: $${result.suggestedPositionSize?.toFixed(2)}\n`;
      output += `Stop Loss: $${result.suggestedStopLoss?.toFixed(6)}\n`;
      output += `Take Profit: $${result.suggestedTakeProfit?.toFixed(6)}\n`;
      output += `Risk: ${result.riskCalculation.riskPercent.toFixed(2)}% of account\n\n`;
    }

    // Stats
    output += `<i>Analysis completed in ${(result.analysisTime / 1000).toFixed(2)}s</i>`;

    return output;
  }
}

// Export singleton
export const integrationFlow = new IntegrationFlow();
