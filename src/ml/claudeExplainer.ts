/**
 * Claude AI Integration for Natural Language Explanations
 * Uses Claude Haiku for fast, cheap risk explanations
 */

import Anthropic from '@anthropic-ai/sdk';
import { TokenAnalysis } from '../types';
import { PredictionResult } from './rugPredictor';
import { logger } from '../utils/logger';

interface ExplanationResult {
  explanation: string;
  summary: string;
  keyPoints: string[];
  source: 'claude' | 'local';
}

class ClaudeExplainer {
  private client: Anthropic | null = null;
  private isAvailable: boolean = false;
  private requestCount: number = 0;
  private lastReset: number = Date.now();
  private readonly MAX_REQUESTS_PER_HOUR = 100;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
      this.isAvailable = true;
      logger.info('ClaudeExplainer', 'Claude API initialized');
    } else {
      logger.info('ClaudeExplainer', 'No API key - using local explanations');
    }
  }

  /**
   * Generate an explanation for a token analysis
   */
  async explainAnalysis(
    analysis: TokenAnalysis,
    mlPrediction?: PredictionResult
  ): Promise<ExplanationResult> {
    // Rate limiting check
    this.checkRateLimit();

    if (!this.isAvailable || !this.client || !this.canMakeRequest()) {
      return this.generateLocalExplanation(analysis, mlPrediction);
    }

    try {
      const prompt = this.buildPrompt(analysis, mlPrediction);

      const response = await this.client.messages.create({
        model: 'claude-3-haiku-20240307', // Fast, cheap model
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      });

      this.requestCount++;

      if (response.content[0].type !== 'text') {
        return this.generateLocalExplanation(analysis, mlPrediction);
      }

      const text = response.content[0].text;
      const parsed = this.parseClaudeResponse(text);

      return {
        ...parsed,
        source: 'claude',
      };
    } catch (error) {
      logger.error('ClaudeExplainer', 'API call failed', error as Error);
      return this.generateLocalExplanation(analysis, mlPrediction);
    }
  }

  /**
   * Build the prompt for Claude
   */
  private buildPrompt(analysis: TokenAnalysis, mlPrediction?: PredictionResult): string {
    const mlSection = mlPrediction
      ? `\nML Prediction: ${(mlPrediction.rugProbability * 100).toFixed(1)}% rug probability (${mlPrediction.recommendation})`
      : '';

    return `You are a crypto trading risk analyst. Analyze this Solana memecoin and provide a brief risk assessment.

TOKEN DATA:
- Symbol: ${analysis.token.symbol}
- Name: ${analysis.token.name}
- Risk Score: ${analysis.risk.score}/100 (${analysis.risk.level})
- Liquidity: $${analysis.liquidity.totalLiquidityUsd.toLocaleString()}
- LP Burned: ${analysis.liquidity.lpBurnedPercent.toFixed(1)}%
- LP Locked: ${analysis.liquidity.lpLockedPercent.toFixed(1)}%
- Total Holders: ${analysis.holders.totalHolders}
- Top 10 Hold: ${analysis.holders.top10HoldersPercent.toFixed(1)}%
- Largest Holder: ${analysis.holders.largestHolderPercent.toFixed(1)}%
- Mint Authority: ${analysis.contract.mintAuthorityRevoked ? 'Revoked' : 'ACTIVE'}
- Freeze Authority: ${analysis.contract.freezeAuthorityRevoked ? 'Revoked' : 'ACTIVE'}
- Honeypot: ${analysis.contract.isHoneypot ? 'YES (DANGER)' : 'No'}
- Twitter: ${analysis.social.hasTwitter ? 'Yes' : 'No'}
- Telegram: ${analysis.social.hasTelegram ? 'Yes' : 'No'}
- Website: ${analysis.social.hasWebsite ? 'Yes' : 'No'}${mlSection}

Provide:
1. A one-sentence summary verdict
2. 2-3 key risk points (bullet points)
3. A brief trading recommendation (2-3 sentences)

Keep it concise and actionable. Focus on the most important factors.`;
  }

  /**
   * Parse Claude's response into structured format
   */
  private parseClaudeResponse(text: string): {
    explanation: string;
    summary: string;
    keyPoints: string[];
  } {
    const lines = text.split('\n').filter(l => l.trim());

    // Try to extract summary (first sentence or first line)
    const summary = lines[0]?.replace(/^[1\.\)\-\*]+\s*/, '').trim() || '';

    // Extract bullet points
    const keyPoints: string[] = [];
    for (const line of lines) {
      if (line.match(/^[\-\*\d\.\)]+\s+/)) {
        const point = line.replace(/^[\-\*\d\.\)]+\s+/, '').trim();
        if (point.length > 10 && keyPoints.length < 5) {
          keyPoints.push(point);
        }
      }
    }

    return {
      explanation: text,
      summary: summary.slice(0, 200),
      keyPoints: keyPoints.length > 0 ? keyPoints : [summary],
    };
  }

  /**
   * Generate local explanation without API
   */
  private generateLocalExplanation(
    analysis: TokenAnalysis,
    mlPrediction?: PredictionResult
  ): ExplanationResult {
    const warnings: string[] = [];
    const positives: string[] = [];

    // Analyze critical risks
    if (analysis.contract.isHoneypot) {
      warnings.push('HONEYPOT DETECTED - Cannot sell tokens');
    }

    if (!analysis.contract.mintAuthorityRevoked) {
      warnings.push('Mint authority active - unlimited tokens can be created');
    }

    if (!analysis.contract.freezeAuthorityRevoked) {
      warnings.push('Freeze authority active - your tokens can be frozen');
    }

    if (analysis.liquidity.lpBurnedPercent < 90 && analysis.liquidity.lpLockedPercent < 50) {
      warnings.push('LP not burned or locked - rug pull risk');
    }

    if (analysis.holders.top10HoldersPercent > 70) {
      warnings.push('High concentration - top holders control supply');
    }

    if (analysis.holders.largestHolderPercent > 30) {
      warnings.push(`Single wallet holds ${analysis.holders.largestHolderPercent.toFixed(1)}% of supply`);
    }

    if (analysis.liquidity.totalLiquidityUsd < 5000) {
      warnings.push('Low liquidity - may have high slippage');
    }

    // Analyze positives
    if (analysis.contract.mintAuthorityRevoked) {
      positives.push('Mint authority revoked');
    }

    if (analysis.contract.freezeAuthorityRevoked) {
      positives.push('Freeze authority revoked');
    }

    if (analysis.liquidity.lpBurnedPercent >= 90) {
      positives.push('LP burned');
    } else if (analysis.liquidity.lpLockedPercent >= 50) {
      positives.push('LP locked');
    }

    if (analysis.holders.totalHolders > 100) {
      positives.push('Good holder distribution');
    }

    if (analysis.social.hasTwitter || analysis.social.hasTelegram) {
      positives.push('Has social presence');
    }

    // Build summary
    const riskLevel = analysis.risk.level;
    let summary = `${analysis.token.symbol}: ${riskLevel} RISK (${analysis.risk.score}/100). `;

    if (analysis.contract.isHoneypot) {
      summary = `${analysis.token.symbol}: EXTREME RISK - HONEYPOT DETECTED. Do not buy.`;
    } else if (warnings.length > 2) {
      summary += `Multiple red flags detected.`;
    } else if (positives.length > warnings.length) {
      summary += `Generally appears safer than average.`;
    } else {
      summary += `Mixed signals - proceed with caution.`;
    }

    // Build key points
    const keyPoints = [
      ...warnings.slice(0, 3),
      ...positives.slice(0, 2),
    ].slice(0, 4);

    // Build explanation
    let explanation = summary + '\n\n';

    if (warnings.length > 0) {
      explanation += 'Concerns:\n';
      warnings.slice(0, 3).forEach(w => {
        explanation += `- ${w}\n`;
      });
    }

    if (positives.length > 0) {
      explanation += '\nPositives:\n';
      positives.slice(0, 2).forEach(p => {
        explanation += `- ${p}\n`;
      });
    }

    if (mlPrediction) {
      explanation += `\nML Analysis: ${(mlPrediction.rugProbability * 100).toFixed(1)}% rug probability`;
      explanation += ` (Recommendation: ${mlPrediction.recommendation})`;
    }

    return {
      explanation,
      summary,
      keyPoints,
      source: 'local',
    };
  }

  /**
   * Check and reset rate limiting
   */
  private checkRateLimit(): void {
    const hourInMs = 60 * 60 * 1000;
    if (Date.now() - this.lastReset > hourInMs) {
      this.requestCount = 0;
      this.lastReset = Date.now();
    }
  }

  /**
   * Check if we can make a request
   */
  private canMakeRequest(): boolean {
    return this.requestCount < this.MAX_REQUESTS_PER_HOUR;
  }

  /**
   * Generate a quick one-liner explanation
   */
  quickExplain(analysis: TokenAnalysis): string {
    const { risk, contract, liquidity, holders } = analysis;

    if (contract.isHoneypot) {
      return 'HONEYPOT - Cannot sell';
    }

    const issues: string[] = [];

    if (!contract.mintAuthorityRevoked) issues.push('mint active');
    if (!contract.freezeAuthorityRevoked) issues.push('freeze active');
    if (liquidity.lpBurnedPercent < 90 && liquidity.lpLockedPercent < 50) issues.push('LP at risk');
    if (holders.top10HoldersPercent > 60) issues.push('concentrated');
    if (liquidity.totalLiquidityUsd < 5000) issues.push('low liq');

    if (issues.length === 0) {
      return `${risk.level} risk - Passes basic checks`;
    }

    return `${risk.level} risk - ${issues.slice(0, 3).join(', ')}`;
  }

  /**
   * Get explainer statistics
   */
  getStats(): {
    isAvailable: boolean;
    requestsThisHour: number;
    maxRequestsPerHour: number;
  } {
    return {
      isAvailable: this.isAvailable,
      requestsThisHour: this.requestCount,
      maxRequestsPerHour: this.MAX_REQUESTS_PER_HOUR,
    };
  }
}

// Export singleton instance
export const claudeExplainer = new ClaudeExplainer();

// Export class for testing
export { ClaudeExplainer };
