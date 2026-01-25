/**
 * Advanced ML Telegram Commands
 * User commands for price prediction, sentiment analysis, and whale tracking
 */

import { Context } from 'telegraf';
import { logger } from '../../utils/logger';
import { mlInferenceServer } from '../../ml/inference/server';
import { pricePredictionModel } from '../../ml/pricePrediction';
import { sentimentCorrelationModel } from '../../ml/sentimentCorrelation';
import { whaleBehaviorModel } from '../../ml/whaleBehavior';
import { mlTrainingPipeline } from '../../ml/training/pipeline';
import { database } from '../../database';
import { featureEngineering } from '../../ml/featureEngineering';
import type { TokenAnalysis } from '../../types';

/**
 * /predict_price <token> [timeframe]
 * Predict price movement for 1h, 6h, or 24h
 */
export async function handlePredictPrice(ctx: Context): Promise<void> {
  try {
    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const tokenAddress = args[0];
    const timeframe = (args[1] as '1h' | '6h' | '24h') || '1h';

    if (!tokenAddress) {
      await ctx.reply('❌ Usage: /predict_price <token_address> [timeframe]\nTimeframe: 1h, 6h, 24h (default: 1h)');
      return;
    }

    await ctx.reply('🤖 Analyzing token and predicting price movement...');

    // Get token analysis
    const analysis = await getTokenAnalysis(tokenAddress);
    if (!analysis) {
      await ctx.reply('❌ Token not found or not analyzed yet.');
      return;
    }

    // Extract features
    const features = featureEngineering.extractFeatures(analysis);

    // Predict
    const predictions = await pricePredictionModel.predictAll({ features });
    const prediction = predictions.find(p => p.timeframe === timeframe) || predictions[0];

    // Format response
    const emoji = getDirectionEmoji(prediction.predictedDirection);
    const timeframeDisplay = timeframe.toUpperCase();

    let message = `📊 **Price Prediction (${timeframeDisplay})**\n`;
    message += `Token: \`${tokenAddress.slice(0, 8)}...\`\n\n`;
    message += `${emoji} **Predicted Direction:** ${prediction.predictedDirection.toUpperCase()}\n`;
    message += `📈 **Expected Change:** ${prediction.expectedChange > 0 ? '+' : ''}${prediction.expectedChange.toFixed(2)}%\n`;
    message += `🎯 **Confidence:** ${(prediction.confidence * 100).toFixed(1)}%\n\n`;
    
    message += `**Probabilities:**\n`;
    message += `🟢 Up (>10%): ${(prediction.probabilities.up * 100).toFixed(1)}%\n`;
    message += `🟡 Sideways (±10%): ${(prediction.probabilities.sideways * 100).toFixed(1)}%\n`;
    message += `🔴 Down (<-10%): ${(prediction.probabilities.down * 100).toFixed(1)}%\n\n`;
    
    message += `⏰ Model: ${prediction.modelVersion}`;

    await ctx.reply(message, { parse_mode: 'Markdown' });

    // Record prediction
    await pricePredictionModel.recordPrediction(tokenAddress, prediction);

  } catch (error) {
    logger.error('MLCommands', '/predict_price failed', error as Error);
    await ctx.reply('❌ Failed to predict price. Please try again.');
  }
}

/**
 * /sentiment_impact <token>
 * Analyze sentiment → price correlation
 */
export async function handleSentimentImpact(ctx: Context): Promise<void> {
  try {
    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const tokenAddress = args[0];

    if (!tokenAddress) {
      await ctx.reply('❌ Usage: /sentiment_impact <token_address>');
      return;
    }

    await ctx.reply('📱 Analyzing social sentiment and price correlation...');

    // Get token data
    const analysis = await getTokenAnalysis(tokenAddress);
    if (!analysis) {
      await ctx.reply('❌ Token not found.');
      return;
    }

    // Get sentiment data (would come from sentiment analyzer)
    const sentimentFeatures = {
      sentimentScore: 0.5,
      sentimentVelocity: 0,
      sentimentAcceleration: 0,
      influencerImpact: 0,
      mentionVolume: 0,
      mentionVelocity: 0,
      uniqueAccounts: 0,
      positiveRatio: 0.5,
      engagementRate: 0,
      hasSentimentSpike: false,
    };

    const result = await sentimentCorrelationModel.analyzeCorrelation({
      current: sentimentFeatures,
      currentPrice: analysis.price?.usd || 0,
    });

    // Format response
    const emoji = getRecommendationEmoji(result.recommendation);
    
    let message = `📱 **Sentiment → Price Analysis**\n`;
    message += `Token: \`${tokenAddress.slice(0, 8)}...\`\n\n`;
    message += `${emoji} **Recommendation:** ${result.recommendation.toUpperCase()}\n`;
    message += `📊 **Predicted Impact:** ${result.predictedPriceImpact > 0 ? '+' : ''}${result.predictedPriceImpact.toFixed(2)}%\n`;
    message += `🎯 **Confidence:** ${(result.confidence * 100).toFixed(1)}%\n`;
    message += `📈 **Correlation:** ${(result.correlation * 100).toFixed(1)}%\n`;
    message += `⏱ **Time Lag:** ${result.timeLag} minutes\n`;
    message += `${result.isSignificant ? '✅' : '⚠️'} ${result.isSignificant ? 'Statistically significant' : 'Not statistically significant'}\n\n`;
    message += `💡 *Sentiment changes may affect price in ~${result.timeLag}min*`;

    await ctx.reply(message, { parse_mode: 'Markdown' });

    // Record prediction
    await sentimentCorrelationModel.recordPrediction(tokenAddress, result);

  } catch (error) {
    logger.error('MLCommands', '/sentiment_impact failed', error as Error);
    await ctx.reply('❌ Failed to analyze sentiment impact.');
  }
}

/**
 * /whale_alert <token>
 * Analyze whale behavior and dump risk
 */
export async function handleWhaleAlert(ctx: Context): Promise<void> {
  try {
    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const tokenAddress = args[0];

    if (!tokenAddress) {
      await ctx.reply('❌ Usage: /whale_alert <token_address>');
      return;
    }

    await ctx.reply('🐋 Analyzing whale behavior and dump risk...');

    // Get whale data (would come from whale tracker)
    const whaleData = {
      wallet: {
        address: 'whale123',
        totalBalance: 1000000,
        holdingPercent: 5,
        transactionHistory: [],
        avgBuySize: 50000,
        avgSellSize: 30000,
        buyFrequency: 2,
        sellFrequency: 1,
        profitRatio: 0.7,
        holdingDuration: 48,
        isSmartMoney: true,
      },
      currentPrice: 0.001,
      priceChange24h: 20,
      volumeProfile: {
        buyVolume24h: 100000,
        sellVolume24h: 50000,
      },
    };

    const result = await whaleBehaviorModel.predict(whaleData);

    // Format response
    const riskEmoji = getRiskEmoji(result.riskLevel);
    const actionEmoji = getActionEmoji(result.predictedAction);

    let message = `🐋 **Whale Behavior Analysis**\n`;
    message += `Token: \`${tokenAddress.slice(0, 8)}...\`\n\n`;
    message += `${riskEmoji} **Risk Level:** ${result.riskLevel.toUpperCase()}\n`;
    message += `${actionEmoji} **Predicted Action:** ${result.predictedAction}\n`;
    message += `💣 **Dump Probability:** ${(result.dumpProbability * 100).toFixed(1)}%\n`;
    message += `🎯 **Confidence:** ${(result.confidence * 100).toFixed(1)}%\n`;
    message += `⏰ **Time to Action:** ~${result.timeToAction.toFixed(1)}h\n\n`;

    message += `**Action Probabilities:**\n`;
    message += `📈 Accumulation: ${(result.probabilities.accumulation * 100).toFixed(1)}%\n`;
    message += `📊 Distribution: ${(result.probabilities.distribution * 100).toFixed(1)}%\n`;
    message += `💣 Dump: ${(result.probabilities.dump * 100).toFixed(1)}%\n`;
    message += `💎 Holding: ${(result.probabilities.holding * 100).toFixed(1)}%\n\n`;

    if (result.signals.length > 0) {
      message += `**Detected Patterns:**\n`;
      result.signals.forEach(signal => {
        message += `• ${signal}\n`;
      });
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });

    // Record prediction
    await whaleBehaviorModel.recordPrediction(tokenAddress, 'whale123', result);

  } catch (error) {
    logger.error('MLCommands', '/whale_alert failed', error as Error);
    await ctx.reply('❌ Failed to analyze whale behavior.');
  }
}

/**
 * /ml_models
 * Show all active ML models and their performance
 */
export async function handleMLModels(ctx: Context): Promise<void> {
  try {
    await ctx.reply('📊 Loading ML model statistics...');

    // Get model stats
    const stats = mlInferenceServer.getStats();

    // Get performance from database
    const performanceQuery = `
      SELECT * FROM ml_model_performance_summary
      ORDER BY trained_at DESC
      LIMIT 10
    `;
    const performance = database.query(performanceQuery) as any[];

    let message = `🤖 **ML Models Dashboard**\n\n`;
    message += `**Server Status:**\n`;
    message += `${stats.initialized ? '✅' : '❌'} Initialized\n`;
    message += `📦 Queued Batches: ${stats.queuedBatches}\n\n`;

    message += `**Active Models:**\n\n`;

    for (const [modelName, modelStats] of Object.entries(stats.models)) {
      const perf = performance.find(p => p.model_type === modelName);
      
      message += `📌 **${modelName}**\n`;
      message += `${(modelStats as any).initialized ? '✅' : '❌'} Loaded\n`;
      
      if (perf) {
        message += `📊 Training Acc: ${(perf.training_accuracy * 100).toFixed(1)}%\n`;
        message += `📈 Live Acc: ${perf.live_accuracy_percent || 'N/A'}%\n`;
        message += `🔢 Predictions: ${perf.total_predictions || 0}\n`;
      }
      
      message += `\n`;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });

  } catch (error) {
    logger.error('MLCommands', '/ml_models failed', error as Error);
    await ctx.reply('❌ Failed to load model statistics.');
  }
}

/**
 * /ml_explain <token>
 * Explain prediction with feature importance
 */
export async function handleMLExplain(ctx: Context): Promise<void> {
  try {
    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const tokenAddress = args[0];

    if (!tokenAddress) {
      await ctx.reply('❌ Usage: /ml_explain <token_address>');
      return;
    }

    await ctx.reply('🔍 Generating prediction explanation...');

    // Get token analysis
    const analysis = await getTokenAnalysis(tokenAddress);
    if (!analysis) {
      await ctx.reply('❌ Token not found.');
      return;
    }

    // Extract features
    const features = featureEngineering.extractFeatures(analysis);

    // Make prediction with explanation
    const response = await mlInferenceServer.predict({
      model: 'rug_prediction',
      tokenMint: tokenAddress,
      input: features,
      options: { explain: true },
    });

    // Format explanation
    let message = `🔍 **Prediction Explanation**\n`;
    message += `Token: \`${tokenAddress.slice(0, 8)}...\`\n\n`;
    message += `**Prediction:** ${response.prediction.recommendation}\n`;
    message += `**Confidence:** ${(response.confidence * 100).toFixed(1)}%\n\n`;

    if (response.explanation) {
      message += `**Top Features:**\n`;
      response.explanation.topFeatures.slice(0, 8).forEach((feature, idx) => {
        const impactEmoji = feature.impact === 'positive' ? '🟢' : feature.impact === 'negative' ? '🔴' : '⚪';
        message += `${idx + 1}. ${impactEmoji} ${feature.name}: ${(feature.importance * 100).toFixed(1)}%\n`;
      });
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });

  } catch (error) {
    logger.error('MLCommands', '/ml_explain failed', error as Error);
    await ctx.reply('❌ Failed to generate explanation.');
  }
}

/**
 * /ml_train <model> [--admin-key]
 * Trigger model training (admin only)
 */
export async function handleMLTrain(ctx: Context): Promise<void> {
  try {
    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const modelType = args[0] as 'price_prediction' | 'sentiment_correlation' | 'whale_behavior' | 'rug_prediction';
    const adminKey = args[1];

    // Simple admin check (in production, use proper authentication)
    if (adminKey !== process.env.ML_ADMIN_KEY) {
      await ctx.reply('❌ Unauthorized. Admin key required.');
      return;
    }

    if (!modelType) {
      await ctx.reply('❌ Usage: /ml_train <model_type> <admin_key>\nModels: price_prediction, sentiment_correlation, whale_behavior, rug_prediction');
      return;
    }

    await ctx.reply(`🎓 Starting training for ${modelType}...\nThis may take several minutes.`);

    // Start training
    const result = await mlTrainingPipeline.trainModel({
      model: modelType,
      epochs: 50,
      batchSize: 32,
      minSamples: 100,
    });

    // Format result
    let message = `${result.success ? '✅' : '❌'} **Training ${result.success ? 'Complete' : 'Failed'}**\n\n`;
    
    if (result.success) {
      message += `📊 **Results:**\n`;
      message += `• Samples: ${result.samplesUsed}\n`;
      message += `• Time: ${result.trainingTime.toFixed(1)}s\n`;
      message += `• Loss: ${result.metrics.loss.toFixed(4)}\n`;
      if (result.metrics.accuracy) {
        message += `• Accuracy: ${(result.metrics.accuracy * 100).toFixed(2)}%\n`;
      }
      if (result.metrics.mae) {
        message += `• MAE: ${result.metrics.mae.toFixed(2)}\n`;
      }
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });

  } catch (error) {
    logger.error('MLCommands', '/ml_train failed', error as Error);
    await ctx.reply('❌ Training failed. Check logs for details.');
  }
}

// ============================================
// Helper Functions
// ============================================

async function getTokenAnalysis(address: string): Promise<TokenAnalysis | null> {
  try {
    const query = `SELECT * FROM token_analysis WHERE token_mint = ? ORDER BY analyzed_at DESC LIMIT 1`;
    const rows = database.query(query, [address]);
    
    if (rows.length === 0) return null;
    
    // Convert DB row to TokenAnalysis (simplified)
    return rows[0] as any as TokenAnalysis;
  } catch (error) {
    logger.error('MLCommands', 'Failed to get token analysis', error as Error);
    return null;
  }
}

function getDirectionEmoji(direction: string): string {
  switch (direction) {
    case 'up': return '🚀';
    case 'down': return '📉';
    case 'sideways': return '➡️';
    default: return '❓';
  }
}

function getRecommendationEmoji(recommendation: string): string {
  switch (recommendation) {
    case 'bullish': return '🐂';
    case 'bearish': return '🐻';
    case 'neutral': return '⚖️';
    default: return '❓';
  }
}

function getRiskEmoji(risk: string): string {
  switch (risk) {
    case 'low': return '🟢';
    case 'medium': return '🟡';
    case 'high': return '🟠';
    case 'critical': return '🔴';
    default: return '⚪';
  }
}

function getActionEmoji(action: string): string {
  switch (action) {
    case 'accumulation': return '📈';
    case 'distribution': return '📊';
    case 'dump': return '💣';
    case 'holding': return '💎';
    default: return '❓';
  }
}

// Export all command handlers
export default {
  handlePredictPrice,
  handleSentimentImpact,
  handleWhaleAlert,
  handleMLModels,
  handleMLExplain,
  handleMLTrain,
};
