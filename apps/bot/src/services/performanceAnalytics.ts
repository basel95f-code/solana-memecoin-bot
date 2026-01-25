/**
 * Performance Analytics Service
 * Deep insights: Why do moons moon? Why do rugs rug? What actually works?
 */

import { database } from '../database';
import { logger } from '../utils/logger';

export interface PatternAnalysis {
  pattern: string;
  count: number;
  winRate: number;
  avgReturn: number;
  confidence: number;
}

export interface TimeAnalysis {
  hour: number;
  dayOfWeek: number;
  tradesCount: number;
  winRate: number;
  avgReturn: number;
}

export interface FeatureCorrelation {
  featureName: string;
  outcomeType: 'moon' | 'rug' | 'stable' | 'decline';
  correlation: number; // -1 to +1
  sampleSize: number;
}

export interface FilterPerformance {
  filterName: string;
  matchCount: number;
  moons: number;
  rugs: number;
  moonRate: number;
  rugRate: number;
  avgReturn: number;
  roi: number; // Return on investment if traded all matches
}

class PerformanceAnalytics {
  /**
   * Analyze common patterns in successful (moon) tokens
   */
  getMoonPatterns(): PatternAnalysis[] {
    const moons = database.all<any>(
      `SELECT * FROM token_outcomes_v2 
       WHERE outcome_type = 'moon'
       AND price_change_24h IS NOT NULL`
    );

    if (moons.length < 10) {
      return [];
    }

    const patterns: PatternAnalysis[] = [];

    // Pattern 1: High risk score + low rug prob
    const highRiskLowRug = moons.filter(m => 
      m.initial_risk_score > 70 && m.initial_rug_prob < 0.3
    );
    if (highRiskLowRug.length > 0) {
      patterns.push({
        pattern: 'High Risk Score + Low Rug Probability',
        count: highRiskLowRug.length,
        winRate: (highRiskLowRug.length / moons.length) * 100,
        avgReturn: this.avgField(highRiskLowRug, 'price_change_24h'),
        confidence: this.calculateConfidence(highRiskLowRug.length, moons.length),
      });
    }

    // Pattern 2: High liquidity
    const highLiq = moons.filter(m => m.initial_liquidity > 100000);
    if (highLiq.length > 0) {
      patterns.push({
        pattern: 'High Initial Liquidity (>$100k)',
        count: highLiq.length,
        winRate: (highLiq.length / moons.length) * 100,
        avgReturn: this.avgField(highLiq, 'price_change_24h'),
        confidence: this.calculateConfidence(highLiq.length, moons.length),
      });
    }

    // Pattern 3: Traded successfully
    const traded = moons.filter(m => m.was_traded && m.trade_profit > 0);
    if (traded.length > 0) {
      patterns.push({
        pattern: 'Successfully Traded (Actual Profit)',
        count: traded.length,
        winRate: (traded.length / moons.length) * 100,
        avgReturn: this.avgField(traded, 'trade_profit'),
        confidence: this.calculateConfidence(traded.length, moons.length),
      });
    }

    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Analyze common patterns in rug pulls
   */
  getRugPatterns(): PatternAnalysis[] {
    const rugs = database.all<any>(
      `SELECT * FROM token_outcomes_v2 
       WHERE outcome_type = 'rug'
       AND price_change_24h IS NOT NULL`
    );

    if (rugs.length < 10) {
      return [];
    }

    const patterns: PatternAnalysis[] = [];

    // Pattern 1: High rug probability prediction
    const highRugProb = rugs.filter(r => r.initial_rug_prob > 0.7);
    if (highRugProb.length > 0) {
      patterns.push({
        pattern: 'ML Predicted High Rug Risk (>70%)',
        count: highRugProb.length,
        winRate: (highRugProb.length / rugs.length) * 100,
        avgReturn: this.avgField(highRugProb, 'price_change_24h'),
        confidence: this.calculateConfidence(highRugProb.length, rugs.length),
      });
    }

    // Pattern 2: Low risk score
    const lowRisk = rugs.filter(r => r.initial_risk_score < 50);
    if (lowRisk.length > 0) {
      patterns.push({
        pattern: 'Low Risk Score (<50)',
        count: lowRisk.length,
        winRate: (lowRisk.length / rugs.length) * 100,
        avgReturn: this.avgField(lowRisk, 'price_change_24h'),
        confidence: this.calculateConfidence(lowRisk.length, rugs.length),
      });
    }

    // Pattern 3: Low liquidity
    const lowLiq = rugs.filter(r => r.initial_liquidity < 10000);
    if (lowLiq.length > 0) {
      patterns.push({
        pattern: 'Low Liquidity (<$10k)',
        count: lowLiq.length,
        winRate: (lowLiq.length / rugs.length) * 100,
        avgReturn: this.avgField(lowLiq, 'price_change_24h'),
        confidence: this.calculateConfidence(lowLiq.length, rugs.length),
      });
    }

    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Analyze best trading times
   */
  getBestTradingTimes(): TimeAnalysis[] {
    const trades = database.all<any>(
      `SELECT * FROM trades 
       WHERE action IN ('close', 'partial_close')
       AND realized_pnl IS NOT NULL`
    );

    if (trades.length < 20) {
      return [];
    }

    // Group by hour
    const hourlyStats = new Map<number, { count: number; wins: number; totalReturn: number }>();

    for (const trade of trades) {
      const date = new Date(trade.timestamp);
      const hour = date.getHours();

      const stats = hourlyStats.get(hour) || { count: 0, wins: 0, totalReturn: 0 };
      stats.count++;
      if (trade.realized_pnl > 0) stats.wins++;
      stats.totalReturn += trade.realized_pnl_percent || 0;
      hourlyStats.set(hour, stats);
    }

    const results: TimeAnalysis[] = [];
    for (const [hour, stats] of hourlyStats) {
      if (stats.count >= 3) { // Minimum 3 trades for significance
        results.push({
          hour,
          dayOfWeek: 0, // Not implemented yet
          tradesCount: stats.count,
          winRate: (stats.wins / stats.count) * 100,
          avgReturn: stats.totalReturn / stats.count,
        });
      }
    }

    return results.sort((a, b) => b.winRate - a.winRate);
  }

  /**
   * Analyze feature → outcome correlations
   */
  getFeatureCorrelations(): FeatureCorrelation[] {
    const outcomes = database.all<any>(
      `SELECT * FROM token_outcomes_v2 
       WHERE outcome_type IN ('moon', 'rug')
       AND initial_risk_score IS NOT NULL
       AND initial_rug_prob IS NOT NULL`
    );

    if (outcomes.length < 30) {
      return [];
    }

    const correlations: FeatureCorrelation[] = [];

    // Correlation: Risk Score → Moon
    const moons = outcomes.filter(o => o.outcome_type === 'moon');
    if (moons.length > 0) {
      const riskScoreMoonCorr = this.calculateCorrelation(
        moons.map(m => m.initial_risk_score),
        moons.map(() => 1) // 1 for moon
      );

      correlations.push({
        featureName: 'Risk Score',
        outcomeType: 'moon',
        correlation: riskScoreMoonCorr,
        sampleSize: moons.length,
      });
    }

    // Correlation: ML Rug Prob → Rug
    const rugs = outcomes.filter(o => o.outcome_type === 'rug');
    if (rugs.length > 0) {
      const rugProbRugCorr = this.calculateCorrelation(
        rugs.map(r => r.initial_rug_prob),
        rugs.map(() => 1) // 1 for rug
      );

      correlations.push({
        featureName: 'ML Rug Probability',
        outcomeType: 'rug',
        correlation: rugProbRugCorr,
        sampleSize: rugs.length,
      });
    }

    // Correlation: Liquidity → Moon
    if (moons.length > 0) {
      const liqMoonCorr = this.calculateCorrelation(
        moons.map(m => m.initial_liquidity),
        moons.map(() => 1)
      );

      correlations.push({
        featureName: 'Initial Liquidity',
        outcomeType: 'moon',
        correlation: liqMoonCorr,
        sampleSize: moons.length,
      });
    }

    return correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  }

  /**
   * Analyze scanner filter performance
   */
  getFilterPerformance(): FilterPerformance[] {
    const matches = database.all<any>(
      `SELECT 
        sm.filter_name,
        sm.token_mint,
        sm.symbol,
        o.outcome_type,
        o.price_change_24h
       FROM scan_matches sm
       LEFT JOIN token_outcomes_v2 o ON sm.token_mint = o.token_mint
       WHERE o.outcome_type IS NOT NULL`
    );

    if (matches.length === 0) {
      return [];
    }

    // Group by filter
    const filterStats = new Map<string, {
      matches: number;
      moons: number;
      rugs: number;
      totalReturn: number;
    }>();

    for (const match of matches) {
      const stats = filterStats.get(match.filter_name) || {
        matches: 0,
        moons: 0,
        rugs: 0,
        totalReturn: 0,
      };

      stats.matches++;
      if (match.outcome_type === 'moon') stats.moons++;
      if (match.outcome_type === 'rug') stats.rugs++;
      if (match.price_change_24h) stats.totalReturn += match.price_change_24h;

      filterStats.set(match.filter_name, stats);
    }

    const results: FilterPerformance[] = [];
    for (const [filterName, stats] of filterStats) {
      results.push({
        filterName,
        matchCount: stats.matches,
        moons: stats.moons,
        rugs: stats.rugs,
        moonRate: (stats.moons / stats.matches) * 100,
        rugRate: (stats.rugs / stats.matches) * 100,
        avgReturn: stats.totalReturn / stats.matches,
        roi: stats.totalReturn, // Simplified ROI
      });
    }

    return results.sort((a, b) => b.moonRate - a.moonRate);
  }

  /**
   * Calculate Pearson correlation coefficient
   */
  private calculateCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    if (n === 0 || n !== y.length) return 0;

    const meanX = x.reduce((sum, val) => sum + val, 0) / n;
    const meanY = y.reduce((sum, val) => sum + val, 0) / n;

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < n; i++) {
      const diffX = x[i] - meanX;
      const diffY = y[i] - meanY;
      numerator += diffX * diffY;
      denomX += diffX * diffX;
      denomY += diffY * diffY;
    }

    if (denomX === 0 || denomY === 0) return 0;
    return numerator / Math.sqrt(denomX * denomY);
  }

  /**
   * Calculate confidence score (0-1) based on sample size
   */
  private calculateConfidence(matches: number, total: number): number {
    const proportion = matches / total;
    const minSampleSize = Math.min(matches, 30);
    const sampleConfidence = minSampleSize / 30;
    const extremeness = Math.abs(proportion - 0.5) * 2;

    return sampleConfidence * 0.6 + extremeness * 0.4;
  }

  /**
   * Calculate average of a field
   */
  private avgField(items: any[], field: string): number {
    if (items.length === 0) return 0;
    return items.reduce((sum, item) => sum + (item[field] || 0), 0) / items.length;
  }

  /**
   * Format analytics report
   */
  formatReport(): string {
    let report = `📊 Performance Analytics Report\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Moon patterns
    const moonPatterns = this.getMoonPatterns();
    if (moonPatterns.length > 0) {
      report += `🚀 MOON PATTERNS (What Works):\n\n`;
      for (const pattern of moonPatterns.slice(0, 3)) {
        report += `${pattern.pattern}\n`;
        report += `  Found in: ${pattern.count} moons (${pattern.winRate.toFixed(1)}%)\n`;
        report += `  Avg Return: +${pattern.avgReturn.toFixed(1)}%\n`;
        report += `  Confidence: ${(pattern.confidence * 100).toFixed(0)}%\n\n`;
      }
    }

    // Rug patterns
    const rugPatterns = this.getRugPatterns();
    if (rugPatterns.length > 0) {
      report += `💀 RUG PATTERNS (Warning Signs):\n\n`;
      for (const pattern of rugPatterns.slice(0, 3)) {
        report += `${pattern.pattern}\n`;
        report += `  Found in: ${pattern.count} rugs (${pattern.winRate.toFixed(1)}%)\n`;
        report += `  Avg Loss: ${pattern.avgReturn.toFixed(1)}%\n`;
        report += `  Confidence: ${(pattern.confidence * 100).toFixed(0)}%\n\n`;
      }
    }

    // Best trading times
    const tradingTimes = this.getBestTradingTimes();
    if (tradingTimes.length > 0) {
      report += `⏰ BEST TRADING HOURS:\n\n`;
      for (const time of tradingTimes.slice(0, 3)) {
        report += `${time.hour}:00 - ${time.hour + 1}:00\n`;
        report += `  Win Rate: ${time.winRate.toFixed(1)}% (${time.tradesCount} trades)\n`;
        report += `  Avg Return: ${time.avgReturn > 0 ? '+' : ''}${time.avgReturn.toFixed(1)}%\n\n`;
      }
    }

    // Filter performance
    const filterPerf = this.getFilterPerformance();
    if (filterPerf.length > 0) {
      report += `🎯 SCANNER FILTER PERFORMANCE:\n\n`;
      for (const filter of filterPerf.slice(0, 3)) {
        report += `${filter.filterName}\n`;
        report += `  Matches: ${filter.matchCount}\n`;
        report += `  Moons: ${filter.moons} (${filter.moonRate.toFixed(1)}%)\n`;
        report += `  Rugs: ${filter.rugs} (${filter.rugRate.toFixed(1)}%)\n`;
        report += `  Avg Return: ${filter.avgReturn > 0 ? '+' : ''}${filter.avgReturn.toFixed(1)}%\n\n`;
      }
    }

    return report;
  }
}

// Export singleton
export const performanceAnalytics = new PerformanceAnalytics();
