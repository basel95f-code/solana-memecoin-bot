/**
 * Learning Orchestrator
 * Connects all features into a continuous learning loop
 * - Tracks token outcomes
 * - Learns from portfolio results
 * - Auto-retrains ML models
 * - Updates scanner filters
 * - Improves over time
 */

import { database } from '../database';
import { portfolioTracker } from './portfolioTracker';
import { trainingPipeline } from '../ml/trainingPipeline';
import { featureSelection } from '../ml/featureSelection';
import { tokenScanner } from './tokenScanner';
import { dexScreenerService } from './dexscreener';
import { logger } from '../utils/logger';

export interface TokenOutcome {
  tokenMint: string;
  symbol: string;
  
  // Initial state when discovered
  discoveredAt: number;
  initialPrice: number;
  initialLiquidity: number;
  initialRiskScore: number;
  initialRugProb: number;
  
  // Outcome after X hours
  outcomeType: 'moon' | 'rug' | 'stable' | 'decline' | 'unknown';
  priceChange24h?: number;
  priceChange7d?: number;
  finalPrice?: number;
  maxPrice?: number; // Highest price reached
  minPrice?: number; // Lowest price reached
  
  // Trading result (if traded)
  wasTraded: boolean;
  tradeProfit?: number;
  tradeProfitPercent?: number;
  
  // Learning metadata
  checkedAt: number;
  confidence: number; // How sure we are of this outcome
}

export interface LearningStats {
  totalOutcomesTracked: number;
  moonCount: number;
  rugCount: number;
  stableCount: number;
  declineCount: number;
  
  // Trading performance
  totalTrades: number;
  profitableTrades: number;
  unprofitableTrades: number;
  avgProfit: number;
  
  // Model performance
  lastTrainingDate: number;
  modelAccuracy: number;
  totalTrainingSamples: number;
  
  // Filter performance
  bestFilter: string | null;
  bestFilterWinRate: number;
}

class LearningOrchestrator {
  private isRunning: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  private readonly OUTCOME_CHECK_HOURS = 24; // Check outcomes after 24h

  /**
   * Start the learning orchestrator
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('LearningOrchestrator', 'Already running');
      return;
    }

    this.isRunning = true;

    // Run initial check
    this.runLearningCycle().catch(error => {
      logger.error('LearningOrchestrator', 'Initial learning cycle failed', error as Error);
    });

    // Schedule periodic checks
    this.checkInterval = setInterval(() => {
      this.runLearningCycle().catch(error => {
        logger.error('LearningOrchestrator', 'Learning cycle failed', error as Error);
      });
    }, this.CHECK_INTERVAL_MS);

    logger.info('LearningOrchestrator', 'Learning orchestrator started');
  }

  /**
   * Stop the orchestrator
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    logger.info('LearningOrchestrator', 'Learning orchestrator stopped');
  }

  /**
   * Main learning cycle
   */
  private async runLearningCycle(): Promise<void> {
    logger.info('LearningOrchestrator', 'Starting learning cycle...');

    // Step 1: Check outcomes of recently discovered tokens
    await this.checkTokenOutcomes();

    // Step 2: Learn from portfolio trades
    await this.learnFromPortfolio();

    // Step 3: Update ML training data
    await this.updateMLTrainingData();

    // Step 4: Check if we should retrain the model
    await this.checkAndRetrain();

    // Step 5: Update scanner filters based on results
    await this.optimizeScannerFilters();

    // Step 6: Analyze feature importance
    await this.analyzeFeaturePerformance();

    logger.info('LearningOrchestrator', 'Learning cycle complete');
  }

  /**
   * Check outcomes of recently discovered tokens
   */
  private async checkTokenOutcomes(): Promise<void> {
    const cutoffTime = Date.now() - this.OUTCOME_CHECK_HOURS * 60 * 60 * 1000;

    // Get tokens discovered in the last 24-48 hours that haven't been checked yet
    const tokens = database.all<any>(
      `SELECT * FROM token_analysis 
       WHERE analyzed_at > ? 
       AND analyzed_at < ?
       AND mint NOT IN (SELECT token_mint FROM token_outcomes_v2_v2)
       LIMIT 50`,
      [cutoffTime - 24 * 60 * 60 * 1000, cutoffTime]
    );

    if (tokens.length === 0) {
      logger.debug('LearningOrchestrator', 'No tokens to check');
      return;
    }

    logger.info('LearningOrchestrator', `Checking outcomes for ${tokens.length} tokens`);

    for (const token of tokens) {
      try {
        const outcome = await this.determineTokenOutcome(token);
        this.recordOutcome(outcome);
      } catch (error) {
        logger.silentError('LearningOrchestrator', `Failed to check outcome for ${token.symbol}`, error as Error);
      }
    }
  }

  /**
   * Determine what happened to a token
   */
  private async determineTokenOutcome(token: any): Promise<TokenOutcome> {
    const outcome: TokenOutcome = {
      tokenMint: token.mint,
      symbol: token.symbol,
      discoveredAt: token.analyzed_at,
      initialPrice: 0,
      initialLiquidity: token.liquidity_usd,
      initialRiskScore: token.risk_score,
      initialRugProb: token.ml_rug_probability || 0,
      outcomeType: 'unknown',
      wasTraded: false,
      checkedAt: Date.now(),
      confidence: 0.5,
    };

    try {
      // Get current price data
      const pairData = await dexScreenerService.getTokenData(token.mint);

      if (!pairData) {
        outcome.outcomeType = 'rug'; // Token disappeared - likely rug
        outcome.confidence = 0.8;
        return outcome;
      }

      const currentPrice = parseFloat(pairData.priceUsd || '0');
      const priceChange24h = pairData.priceChange?.h24 || 0;
      const priceChange7d = pairData.priceChange?.h6 ? pairData.priceChange.h6 * 28 : null; // Estimate

      outcome.finalPrice = currentPrice;
      outcome.priceChange24h = priceChange24h;
      if (priceChange7d) outcome.priceChange7d = priceChange7d;

      // Classify outcome
      if (priceChange24h > 100) {
        outcome.outcomeType = 'moon'; // 100%+ gain = moon
        outcome.confidence = 0.9;
      } else if (priceChange24h < -50) {
        outcome.outcomeType = 'rug'; // 50%+ loss = likely rug
        outcome.confidence = 0.85;
      } else if (priceChange24h > 20) {
        outcome.outcomeType = 'stable'; // Moderate gain
        outcome.confidence = 0.7;
      } else if (priceChange24h < -20) {
        outcome.outcomeType = 'decline'; // Moderate loss
        outcome.confidence = 0.7;
      } else {
        outcome.outcomeType = 'stable'; // Flat
        outcome.confidence = 0.6;
      }

      // Check liquidity - if it dropped significantly, likely rug
      const currentLiquidity = parseFloat(pairData.liquidity?.usd || '0');
      if (currentLiquidity < outcome.initialLiquidity * 0.5) {
        outcome.outcomeType = 'rug';
        outcome.confidence = 0.9;
      }

    } catch (error) {
      logger.silentError('LearningOrchestrator', 'Failed to get price data', error as Error);
    }

    return outcome;
  }

  /**
   * Record token outcome
   */
  private recordOutcome(outcome: TokenOutcome): void {
    database.run(
      `INSERT OR IGNORE INTO token_outcomes_v2_v2 (
        token_mint, symbol, discovered_at,
        initial_price, initial_liquidity, initial_risk_score, initial_rug_prob,
        outcome_type, price_change_24h, price_change_7d, final_price,
        was_traded, trade_profit, trade_profit_percent,
        checked_at, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        outcome.tokenMint,
        outcome.symbol,
        outcome.discoveredAt,
        outcome.initialPrice,
        outcome.initialLiquidity,
        outcome.initialRiskScore,
        outcome.initialRugProb,
        outcome.outcomeType,
        outcome.priceChange24h,
        outcome.priceChange7d,
        outcome.finalPrice,
        outcome.wasTraded ? 1 : 0,
        outcome.tradeProfit,
        outcome.tradeProfitPercent,
        outcome.checkedAt,
        outcome.confidence,
      ]
    );

    logger.debug('LearningOrchestrator', `Recorded outcome: ${outcome.symbol} = ${outcome.outcomeType}`);
  }

  /**
   * Learn from portfolio trades
   */
  private async learnFromPortfolio(): Promise<void> {
    // Get recent closed trades
    const trades = database.all<any>(
      `SELECT * FROM trades 
       WHERE action IN ('close', 'partial_close')
       AND timestamp > ?
       ORDER BY timestamp DESC
       LIMIT 100`,
      [Date.now() - 30 * 24 * 60 * 60 * 1000] // Last 30 days
    );

    if (trades.length === 0) {
      return;
    }

    logger.info('LearningOrchestrator', `Learning from ${trades.length} trades`);

    for (const trade of trades) {
      // Check if this token already has an outcome
      const existing = database.get<any>(
        'SELECT * FROM token_outcomes_v2 WHERE token_mint = ?',
        [trade.token_mint]
      );

      if (existing) {
        // Update with trading result
        database.run(
          `UPDATE token_outcomes_v2 SET
            was_traded = 1,
            trade_profit = ?,
            trade_profit_percent = ?
          WHERE token_mint = ?`,
          [trade.realized_pnl, trade.realized_pnl_percent, trade.token_mint]
        );
      } else {
        // Create new outcome based on trade result
        const outcome: TokenOutcome = {
          tokenMint: trade.token_mint,
          symbol: trade.symbol,
          discoveredAt: trade.timestamp,
          initialPrice: trade.entry_price,
          initialLiquidity: 0,
          initialRiskScore: 50,
          initialRugProb: 0,
          outcomeType: trade.realized_pnl > 0 ? 'moon' : trade.realized_pnl < 0 ? 'decline' : 'stable',
          wasTraded: true,
          tradeProfit: trade.realized_pnl,
          tradeProfitPercent: trade.realized_pnl_percent,
          checkedAt: Date.now(),
          confidence: 1.0, // High confidence - we actually traded it
        };

        this.recordOutcome(outcome);
      }
    }
  }

  /**
   * Update ML training data from outcomes
   */
  private async updateMLTrainingData(): Promise<void> {
    // Get outcomes that aren't yet in ML training data
    const newOutcomes = database.all<any>(
      `SELECT o.*, a.* FROM token_outcomes_v2 o
       LEFT JOIN token_analysis a ON o.token_mint = a.mint
       WHERE o.token_mint NOT IN (SELECT mint FROM ml_training_samples)
       AND o.confidence > 0.6
       LIMIT 100`
    );

    if (newOutcomes.length === 0) {
      return;
    }

    logger.info('LearningOrchestrator', `Adding ${newOutcomes.length} outcomes to ML training data`);

    for (const outcome of newOutcomes) {
      // Convert outcome to ML label
      let label: 'rug' | 'pump' | 'stable' | 'decline';
      if (outcome.outcome_type === 'moon') {
        label = 'pump';
      } else if (outcome.outcome_type === 'rug') {
        label = 'rug';
      } else if (outcome.outcome_type === 'decline') {
        label = 'decline';
      } else {
        label = 'stable';
      }

      // Add to ML training samples
      database.run(
        `INSERT OR IGNORE INTO ml_training_samples (
          mint, symbol, outcome, confidence,
          liquidity_usd, risk_score, total_holders, top10_percent,
          mint_revoked, freeze_revoked, lp_burned_percent,
          has_twitter, has_telegram, has_website,
          features, labeled_at, labeled_by, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          outcome.token_mint,
          outcome.symbol,
          label,
          outcome.confidence,
          outcome.liquidity_usd || 0,
          outcome.risk_score || 50,
          outcome.total_holders || 0,
          outcome.top10_percent || 100,
          outcome.mint_revoked || 0,
          outcome.freeze_revoked || 0,
          outcome.lp_burned_percent || 0,
          outcome.has_twitter || 0,
          outcome.has_telegram || 0,
          outcome.has_website || 0,
          null, // features (will be extracted during training)
          Date.now(),
          'auto',
          'outcome_tracker',
        ]
      );
    }
  }

  /**
   * Check if we should retrain the model
   */
  private async checkAndRetrain(): Promise<void> {
    const stats = this.getStats();

    // Retrain if:
    // 1. We have 50+ new samples since last training
    // 2. It's been 7+ days since last training
    const newSamples = stats.totalTrainingSamples;
    const daysSinceTraining = (Date.now() - stats.lastTrainingDate) / (24 * 60 * 60 * 1000);

    if (newSamples >= 50 || daysSinceTraining >= 7) {
      logger.info('LearningOrchestrator', `Triggering model retraining (${newSamples} new samples, ${daysSinceTraining.toFixed(1)} days)`);
      
      try {
        const result = await trainingPipeline.train();
        if (result.success) {
          logger.info('LearningOrchestrator', 'Model retrained successfully');
        }
      } catch (error) {
        logger.error('LearningOrchestrator', 'Model retraining failed', error as Error);
      }
    }
  }

  /**
   * Optimize scanner filters based on results
   */
  private async optimizeScannerFilters(): Promise<void> {
    // Get scanner matches and their outcomes
    const matches = database.all<any>(
      `SELECT m.*, o.outcome_type, o.price_change_24h
       FROM scan_matches m
       LEFT JOIN token_outcomes_v2 o ON m.token_mint = o.token_mint
       WHERE o.outcome_type IS NOT NULL`
    );

    if (matches.length < 20) {
      return; // Not enough data yet
    }

    // Group by filter
    const filterStats: Record<string, { wins: number; total: number; avgGain: number }> = {};

    for (const match of matches) {
      if (!filterStats[match.filter_name]) {
        filterStats[match.filter_name] = { wins: 0, total: 0, avgGain: 0 };
      }

      filterStats[match.filter_name].total++;
      
      if (match.outcome_type === 'moon' || match.price_change_24h > 20) {
        filterStats[match.filter_name].wins++;
      }

      filterStats[match.filter_name].avgGain += match.price_change_24h || 0;
    }

    // Calculate win rates
    for (const [filterName, stats] of Object.entries(filterStats)) {
      const winRate = stats.total > 0 ? stats.wins / stats.total : 0;
      stats.avgGain = stats.avgGain / stats.total;

      logger.info('LearningOrchestrator', `Filter "${filterName}": ${(winRate * 100).toFixed(1)}% win rate, avg gain: ${stats.avgGain.toFixed(1)}%`);

      // If win rate < 20%, consider disabling the filter
      if (winRate < 0.2 && stats.total > 10) {
        logger.warn('LearningOrchestrator', `Filter "${filterName}" performing poorly - consider disabling`);
      }
    }
  }

  /**
   * Analyze which features led to best outcomes
   */
  private async analyzeFeaturePerformance(): Promise<void> {
    // This would analyze which feature combinations led to profitable trades
    // For now, we'll just run the feature selection analysis
    try {
      await featureSelection.analyzeFeatureImportance();
      logger.info('LearningOrchestrator', 'Feature performance analysis complete');
    } catch (error) {
      logger.silentError('LearningOrchestrator', 'Feature analysis failed', error as Error);
    }
  }

  /**
   * Get learning statistics
   */
  getStats(): LearningStats {
    const outcomes = database.all<any>('SELECT outcome_type FROM token_outcomes_v2');
    
    const stats: LearningStats = {
      totalOutcomesTracked: outcomes.length,
      moonCount: outcomes.filter(o => o.outcome_type === 'moon').length,
      rugCount: outcomes.filter(o => o.outcome_type === 'rug').length,
      stableCount: outcomes.filter(o => o.outcome_type === 'stable').length,
      declineCount: outcomes.filter(o => o.outcome_type === 'decline').length,
      totalTrades: 0,
      profitableTrades: 0,
      unprofitableTrades: 0,
      avgProfit: 0,
      lastTrainingDate: 0,
      modelAccuracy: 0,
      totalTrainingSamples: 0,
      bestFilter: null,
      bestFilterWinRate: 0,
    };

    // Trading stats
    const trades = database.all<any>(
      'SELECT * FROM trades WHERE action IN ("close", "partial_close")'
    );
    stats.totalTrades = trades.length;
    stats.profitableTrades = trades.filter(t => (t.realized_pnl || 0) > 0).length;
    stats.unprofitableTrades = trades.filter(t => (t.realized_pnl || 0) < 0).length;
    
    if (trades.length > 0) {
      stats.avgProfit = trades.reduce((sum, t) => sum + (t.realized_pnl || 0), 0) / trades.length;
    }

    // ML stats
    const lastRun = database.get<any>(
      'SELECT * FROM ml_training_runs ORDER BY trained_at DESC LIMIT 1'
    );
    if (lastRun) {
      stats.lastTrainingDate = lastRun.trained_at;
      stats.modelAccuracy = lastRun.accuracy || 0;
    }

    const sampleCount = database.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM ml_training_samples'
    );
    stats.totalTrainingSamples = sampleCount?.count || 0;

    return stats;
  }

  /**
   * Format stats for display
   */
  formatStats(): string {
    const stats = this.getStats();

    let output = `🧠 Learning System Stats\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    output += `📊 Token Outcomes Tracked: ${stats.totalOutcomesTracked}\n`;
    output += `  🚀 Moon: ${stats.moonCount}\n`;
    output += `  💀 Rug: ${stats.rugCount}\n`;
    output += `  ➖ Stable: ${stats.stableCount}\n`;
    output += `  📉 Decline: ${stats.declineCount}\n\n`;

    output += `💼 Trading Performance:\n`;
    output += `  Total Trades: ${stats.totalTrades}\n`;
    output += `  Wins: ${stats.profitableTrades} (${stats.totalTrades > 0 ? ((stats.profitableTrades / stats.totalTrades) * 100).toFixed(1) : 0}%)\n`;
    output += `  Losses: ${stats.unprofitableTrades}\n`;
    output += `  Avg Profit: $${stats.avgProfit.toFixed(2)}\n\n`;

    output += `🤖 ML Model:\n`;
    output += `  Training Samples: ${stats.totalTrainingSamples}\n`;
    output += `  Model Accuracy: ${(stats.modelAccuracy * 100).toFixed(1)}%\n`;
    
    if (stats.lastTrainingDate > 0) {
      const daysSince = (Date.now() - stats.lastTrainingDate) / (24 * 60 * 60 * 1000);
      output += `  Last Training: ${daysSince.toFixed(1)} days ago\n`;
    }

    return output;
  }
}

// Export singleton
export const learningOrchestrator = new LearningOrchestrator();
