/**
 * ML Training Commands
 * Commands for managing ML model training and labeling
 */

import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { database } from '../../database';
import { trainingPipeline } from '../../ml/trainingPipeline';
import { manualLabelingService, type OutcomeLabel } from '../../ml/manualLabeling';
import { modelVersionManager } from '../../ml/modelVersioning';
import { rugPredictor } from '../../ml/rugPredictor';
import { featureEngineering } from '../../ml/featureEngineering';
import { featureSelection } from '../../ml/featureSelection';
import { ensemblePredictor } from '../../ml/ensemblePredictor';
import {
  formatMLStatus,
  formatPendingLabels,
  formatTrainingHistory,
} from '../formatters';

// ═══════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════

const VALID_LABELS: OutcomeLabel[] = ['rug', 'pump', 'stable', 'decline'];

function getMLStatusKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Metrics', 'ml_metrics'),
      Markup.button.callback('📜 History', 'ml_history'),
    ],
    [
      Markup.button.callback('🏷 Pending Labels', 'ml_pending'),
      Markup.button.callback('🚀 Train Now', 'ml_train_confirm'),
    ],
    [
      Markup.button.callback('🔄 Refresh', 'ml_refresh'),
    ],
  ]);
}

function getPendingLabelsKeyboard(tokens: any[]) {
  const buttons: any[][] = [];

  // Quick label buttons for each token (limit to 5)
  for (const token of tokens.slice(0, 5)) {
    const shortMint = token.mint.slice(0, 8);
    const symbol = token.symbol || shortMint;
    buttons.push([
      Markup.button.callback(`🏷 ${symbol}`, `ml_label_select_${token.mint.slice(0, 20)}`),
    ]);
  }

  buttons.push([
    Markup.button.callback('🔄 Refresh', 'ml_pending_refresh'),
    Markup.button.callback('« Back', 'ml_back'),
  ]);

  return Markup.inlineKeyboard(buttons);
}

function getLabelOptionsKeyboard(mint: string) {
  const shortMint = mint.slice(0, 20);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('💀 Rug', `ml_label_${shortMint}_rug`),
      Markup.button.callback('🚀 Pump', `ml_label_${shortMint}_pump`),
    ],
    [
      Markup.button.callback('➖ Stable', `ml_label_${shortMint}_stable`),
      Markup.button.callback('📉 Decline', `ml_label_${shortMint}_decline`),
    ],
    [
      Markup.button.callback('⏭ Skip', `ml_label_${shortMint}_skip`),
      Markup.button.callback('« Back', 'ml_pending'),
    ],
  ]);
}

// ═══════════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════════

export function registerMLCommands(bot: Telegraf): void {
  // /ml command - main ML status
  bot.command('ml', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand || subcommand === 'status') {
      // Show ML status
      const status = trainingPipeline.getStatus();
      const sampleCounts = database.getMLSampleCount();
      const activeVersion = database.getActiveModelVersion();

      const message = formatMLStatus({
        ...status,
        sampleCounts,
        activeModelVersion: activeVersion ?? undefined,
        modelLoaded: rugPredictor.isModelLoaded(),
      });

      await ctx.replyWithHTML(message, getMLStatusKeyboard());
      return;
    }

    if (subcommand === 'train') {
      // Trigger manual training
      const status = trainingPipeline.getStatus();

      if (status.isTraining) {
        await ctx.replyWithHTML('⏳ Training already in progress...');
        return;
      }

      const sampleCounts = database.getMLSampleCount();
      if (sampleCounts.labeled < 50) {
        await ctx.replyWithHTML(
          `❌ Not enough labeled samples for training.\n\n` +
          `Current: <b>${sampleCounts.labeled}</b>\n` +
          `Required: <b>50+</b>\n\n` +
          `Use <code>/ml label</code> to add more labels.`
        );
        return;
      }

      await ctx.replyWithHTML('🚀 Starting training...');

      const result = await trainingPipeline.train();

      if (result.success) {
        await ctx.replyWithHTML(
          `✅ <b>Training Complete!</b>\n\n` +
          `Version: <code>${result.modelVersion}</code>\n` +
          `Accuracy: <b>${((result.metrics?.accuracy || 0) * 100).toFixed(1)}%</b>\n` +
          `F1 Score: <b>${((result.metrics?.f1Score || 0) * 100).toFixed(1)}%</b>\n` +
          `Precision: <b>${((result.metrics?.precision || 0) * 100).toFixed(1)}%</b>\n` +
          `Recall: <b>${((result.metrics?.recall || 0) * 100).toFixed(1)}%</b>`
        );
      } else {
        await ctx.replyWithHTML(`❌ Training failed: ${result.error}`);
      }
      return;
    }

    if (subcommand === 'metrics') {
      // Show detailed metrics
      const latestRun = database.getLatestTrainingRun();

      if (!latestRun) {
        await ctx.replyWithHTML(
          '<b>📊 ML Metrics</b>\n\n' +
          '<i>No training runs yet.</i>\n\n' +
          'Train the model first with <code>/ml train</code>'
        );
        return;
      }

      let msg = '<b>📊 ML Model Metrics</b>\n\n';
      msg += `Version: <code>${latestRun.model_version}</code>\n`;
      msg += `Trained: ${new Date(latestRun.trained_at * 1000).toLocaleDateString()}\n\n`;

      msg += '<b>Performance:</b>\n';
      msg += `Accuracy: <b>${(latestRun.accuracy * 100).toFixed(1)}%</b>\n`;
      msg += `Precision: <b>${(latestRun.precision_score * 100).toFixed(1)}%</b>\n`;
      msg += `Recall: <b>${(latestRun.recall_score * 100).toFixed(1)}%</b>\n`;
      msg += `F1 Score: <b>${(latestRun.f1_score * 100).toFixed(1)}%</b>\n`;
      msg += `AUC: <b>${(latestRun.auc_score * 100).toFixed(1)}%</b>\n\n`;

      msg += '<b>Training Data:</b>\n';
      msg += `Samples: <b>${latestRun.samples_used}</b>\n`;
      msg += `Train/Val/Test: ${latestRun.train_samples}/${latestRun.validation_samples}/${latestRun.test_samples}\n`;
      msg += `Epochs: <b>${latestRun.epochs}</b>\n`;
      msg += `Duration: <b>${(latestRun.training_duration_ms / 1000).toFixed(1)}s</b>\n`;

      if (latestRun.confusion_matrix) {
        msg += `\n<b>Confusion Matrix:</b>\n<pre>${latestRun.confusion_matrix}</pre>`;
      }

      await ctx.replyWithHTML(msg);
      return;
    }

    if (subcommand === 'history') {
      // Show training history
      const runs = database.getTrainingRuns(10);
      const message = formatTrainingHistory(runs);
      await ctx.replyWithHTML(message);
      return;
    }

    if (subcommand === 'pending') {
      // Show pending labels
      const pending = manualLabelingService.getPendingTokens(20);
      const message = formatPendingLabels(pending);
      await ctx.replyWithHTML(message, getPendingLabelsKeyboard(pending));
      return;
    }

    if (subcommand === 'label') {
      // Manual labeling: /ml label <mint> <label>
      const mint = args[1];
      const label = args[2]?.toLowerCase() as OutcomeLabel;

      if (!mint || !label) {
        await ctx.replyWithHTML(
          '<b>🏷 Manual Labeling</b>\n\n' +
          'Usage: <code>/ml label &lt;mint&gt; &lt;outcome&gt;</code>\n\n' +
          '<b>Outcomes:</b>\n' +
          '• <code>rug</code> - Token rugged (>90% drop)\n' +
          '• <code>pump</code> - Significant gains (>100%)\n' +
          '• <code>stable</code> - Moderate performance\n' +
          '• <code>decline</code> - Gradual decline (50-90%)\n\n' +
          'Example: <code>/ml label ABC123... rug</code>'
        );
        return;
      }

      if (!VALID_LABELS.includes(label)) {
        await ctx.replyWithHTML(
          `Invalid label: <code>${label}</code>\n\n` +
          `Valid options: ${VALID_LABELS.join(', ')}`
        );
        return;
      }

      // Get token analysis to extract features
      const analysis = database.getAnalysisByMint(mint);
      const chatId = ctx.chat?.id.toString() || 'manual';

      let features: Record<string, number>;
      if (analysis) {
        const enhancedFeatures = featureEngineering.extractFeaturesBasic({
          liquidityUsd: analysis.liquidity_usd,
          riskScore: analysis.risk_score,
          holderCount: analysis.holder_count,
          top10Percent: analysis.top_10_percent,
          mintRevoked: analysis.mint_revoked,
          freezeRevoked: analysis.freeze_revoked,
          lpBurnedPercent: analysis.lp_burned_percent,
          hasSocials: analysis.has_twitter || analysis.has_telegram || analysis.has_website,
          tokenAgeHours: 24, // Default
        });
        features = featureEngineering.featuresToRecord(enhancedFeatures);
      } else {
        // Basic features if no analysis found
        const enhancedFeatures = featureEngineering.extractFeaturesBasic({
          liquidityUsd: 0,
          riskScore: 50,
          holderCount: 100,
          top10Percent: 50,
          mintRevoked: false,
          freezeRevoked: false,
          lpBurnedPercent: 0,
          hasSocials: false,
          tokenAgeHours: 24,
        });
        features = featureEngineering.featuresToRecord(enhancedFeatures);
      }

      const success = manualLabelingService.labelToken(mint, label, chatId, features);

      if (success) {
        trainingPipeline.recordNewSample();

        const labelEmoji = {
          rug: '💀',
          pump: '🚀',
          stable: '➖',
          decline: '📉',
        }[label];

        await ctx.replyWithHTML(
          `${labelEmoji} Token labeled as <b>${label}</b>!\n\n` +
          `Mint: <code>${mint.slice(0, 8)}...</code>\n\n` +
          `<i>This data will be used in the next training run.</i>`
        );
      } else {
        await ctx.replyWithHTML(`❌ Failed to label token.`);
      }
      return;
    }

    if (subcommand === 'compare') {
      // A/B test comparison
      const abTest = modelVersionManager.getABTestStats();

      if (!abTest) {
        await ctx.replyWithHTML(
          '<b>🔬 A/B Test Results</b>\n\n' +
          '<i>No A/B test running.</i>\n\n' +
          'A/B tests run automatically when a new model is trained.'
        );
        return;
      }

      const durationHours = Math.floor(abTest.duration / (1000 * 60 * 60));
      let msg = '<b>🔬 A/B Test Results</b>\n\n';
      msg += `<b>Champion Model:</b>\n`;
      msg += `Predictions: ${abTest.champion.predictions}\n`;
      msg += `Accuracy: ${(abTest.champion.accuracy * 100).toFixed(1)}%\n\n`;
      msg += `<b>Challenger Model:</b>\n`;
      msg += `Predictions: ${abTest.challenger.predictions}\n`;
      msg += `Accuracy: ${(abTest.challenger.accuracy * 100).toFixed(1)}%\n\n`;
      msg += `Duration: ${durationHours}h`;

      await ctx.replyWithHTML(msg);
      return;
    }

    if (subcommand === 'features') {
      // Feature importance analysis
      await ctx.replyWithHTML('<i>🔍 Analyzing feature importance...</i>');

      try {
        const result = await featureSelection.analyzeFeatureImportance();
        const formatted = featureSelection.formatForDisplay(result);

        await ctx.replyWithHTML(`<pre>${formatted}</pre>`, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Refresh', callback_data: 'ml_features_refresh' },
                { text: '« Back', callback_data: 'ml_back' }
              ]
            ]
          }
        });
      } catch (error) {
        const err = error as Error;
        await ctx.replyWithHTML(
          '<b>❌ Feature Analysis Failed</b>\n\n' +
          `<i>${err.message}</i>\n\n` +
          'Make sure you have at least 100 labeled samples.'
        );
      }
      return;
    }

    if (subcommand === 'ensemble') {
      // Ensemble predictor stats and controls
      const statsArg = args[1]?.toLowerCase();

      if (statsArg === 'on') {
        rugPredictor.setUseEnsemble(true);
        await ctx.replyWithHTML('<b>✅ Ensemble predictions enabled</b>\n\nAll predictions will now use the ensemble.');
        return;
      }

      if (statsArg === 'off') {
        rugPredictor.setUseEnsemble(false);
        await ctx.replyWithHTML('<b>❌ Ensemble predictions disabled</b>\n\nUsing single model predictions.');
        return;
      }

      // Show stats
      const isEnabled = rugPredictor.isEnsembleEnabled();
      const stats = ensemblePredictor.formatStats();

      await ctx.replyWithHTML(
        `<b>🎯 Ensemble Status: ${isEnabled ? '✅ ON' : '❌ OFF'}</b>\n\n<pre>${stats}</pre>`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: isEnabled ? '❌ Disable' : '✅ Enable', callback_data: isEnabled ? 'ml_ensemble_off' : 'ml_ensemble_on' },
                { text: '🔄 Refresh', callback_data: 'ml_ensemble_refresh' }
              ],
              [
                { text: '« Back', callback_data: 'ml_back' }
              ]
            ]
          }
        }
      );
      return;
    }

    // Help
    await ctx.replyWithHTML(
      '<b>🤖 ML Commands</b>\n\n' +
      '<code>/ml</code> - Model status\n' +
      '<code>/ml train</code> - Trigger training\n' +
      '<code>/ml metrics</code> - Detailed metrics\n' +
      '<code>/ml history</code> - Training history\n' +
      '<code>/ml pending</code> - Tokens to label\n' +
      '<code>/ml label &lt;mint&gt; &lt;outcome&gt;</code> - Label token\n' +
      '<code>/ml features</code> - Feature importance\n' +
      '<code>/ml ensemble</code> - Ensemble stats\n' +
      '<code>/ml ensemble on/off</code> - Toggle ensemble\n' +
      '<code>/ml compare</code> - A/B test results'
    );
  });

  // ═══════════════════════════════════════════
  // CALLBACK HANDLERS
  // ═══════════════════════════════════════════

  // Main ML status refresh
  bot.action('ml_refresh', async (ctx) => {
    await ctx.answerCbQuery('Refreshed');
    const status = trainingPipeline.getStatus();
    const sampleCounts = database.getMLSampleCount();
    const activeVersion = database.getActiveModelVersion();

    const message = formatMLStatus({
      ...status,
      sampleCounts,
      activeModelVersion: activeVersion ?? undefined,
      modelLoaded: rugPredictor.isModelLoaded(),
    });

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      ...getMLStatusKeyboard(),
    });
  });

  bot.action('ml_back', async (ctx) => {
    await ctx.answerCbQuery();
    const status = trainingPipeline.getStatus();
    const sampleCounts = database.getMLSampleCount();
    const activeVersion = database.getActiveModelVersion();

    const message = formatMLStatus({
      ...status,
      sampleCounts,
      activeModelVersion: activeVersion ?? undefined,
      modelLoaded: rugPredictor.isModelLoaded(),
    });

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      ...getMLStatusKeyboard(),
    });
  });

  // Metrics callback
  bot.action('ml_metrics', async (ctx) => {
    await ctx.answerCbQuery();
    const latestRun = database.getLatestTrainingRun();

    if (!latestRun) {
      await ctx.editMessageText(
        '<b>📊 ML Metrics</b>\n\n<i>No training runs yet.</i>',
        { parse_mode: 'HTML' }
      );
      return;
    }

    let msg = '<b>📊 ML Model Metrics</b>\n\n';
    msg += `Version: <code>${latestRun.model_version}</code>\n`;
    msg += `Accuracy: <b>${(latestRun.accuracy * 100).toFixed(1)}%</b>\n`;
    msg += `Precision: <b>${(latestRun.precision_score * 100).toFixed(1)}%</b>\n`;
    msg += `Recall: <b>${(latestRun.recall_score * 100).toFixed(1)}%</b>\n`;
    msg += `F1: <b>${(latestRun.f1_score * 100).toFixed(1)}%</b>\n`;
    msg += `AUC: <b>${(latestRun.auc_score * 100).toFixed(1)}%</b>`;

    await ctx.editMessageText(msg, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('« Back', 'ml_back')]]),
    });
  });

  // History callback
  bot.action('ml_history', async (ctx) => {
    await ctx.answerCbQuery();
    const runs = database.getTrainingRuns(10);
    const message = formatTrainingHistory(runs);

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('« Back', 'ml_back')]]),
    });
  });

  // Pending labels callbacks
  bot.action('ml_pending', async (ctx) => {
    await ctx.answerCbQuery();
    const pending = manualLabelingService.getPendingTokens(20);
    const message = formatPendingLabels(pending);

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      ...getPendingLabelsKeyboard(pending),
    });
  });

  bot.action('ml_pending_refresh', async (ctx) => {
    await ctx.answerCbQuery('Refreshed');
    const pending = manualLabelingService.getPendingTokens(20);
    const message = formatPendingLabels(pending);

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      ...getPendingLabelsKeyboard(pending),
    });
  });

  // Label selection callback
  bot.action(/^ml_label_select_(.+)$/, async (ctx) => {
    const mint = ctx.match[1];
    await ctx.answerCbQuery();

    const pending = database.getPendingLabels(100);
    const token = pending.find(p => p.mint.startsWith(mint));

    if (!token) {
      await ctx.editMessageText('Token not found in pending list.', { parse_mode: 'HTML' });
      return;
    }

    let msg = '<b>🏷 Label Token</b>\n\n';
    msg += `<b>${token.symbol || 'Unknown'}</b>\n`;
    msg += `<code>${token.mint}</code>\n\n`;

    if (token.current_price && token.initial_price) {
      const change = ((token.current_price - token.initial_price) / token.initial_price) * 100;
      msg += `Price change: <b>${change >= 0 ? '+' : ''}${change.toFixed(1)}%</b>\n`;
    }

    msg += '\nSelect the outcome:';

    await ctx.editMessageText(msg, {
      parse_mode: 'HTML',
      ...getLabelOptionsKeyboard(token.mint),
    });
  });

  // Label assignment callback
  bot.action(/^ml_label_(.+)_(rug|pump|stable|decline|skip)$/, async (ctx) => {
    const mint = ctx.match[1];
    const label = ctx.match[2] as OutcomeLabel | 'skip';
    const chatId = ctx.chat?.id.toString() || 'manual';

    if (label === 'skip') {
      manualLabelingService.skipToken(mint);
      await ctx.answerCbQuery('Token skipped');
    } else {
      // Get features
      const analysis = database.getAnalysisByMint(mint);
      let features: Record<string, number>;

      if (analysis) {
        const enhancedFeatures = featureEngineering.extractFeaturesBasic({
          liquidityUsd: analysis.liquidity_usd,
          riskScore: analysis.risk_score,
          holderCount: analysis.holder_count,
          top10Percent: analysis.top_10_percent,
          mintRevoked: analysis.mint_revoked,
          freezeRevoked: analysis.freeze_revoked,
          lpBurnedPercent: analysis.lp_burned_percent,
          hasSocials: analysis.has_twitter || analysis.has_telegram || analysis.has_website,
          tokenAgeHours: 24,
        });
        features = featureEngineering.featuresToRecord(enhancedFeatures);
      } else {
        const enhancedFeatures = featureEngineering.extractFeaturesBasic({
          liquidityUsd: 0,
          riskScore: 50,
          holderCount: 100,
          top10Percent: 50,
          mintRevoked: false,
          freezeRevoked: false,
          lpBurnedPercent: 0,
          hasSocials: false,
          tokenAgeHours: 24,
        });
        features = featureEngineering.featuresToRecord(enhancedFeatures);
      }

      const success = manualLabelingService.labelToken(mint, label, chatId, features);

      if (success) {
        trainingPipeline.recordNewSample();
        await ctx.answerCbQuery(`Labeled as ${label}`);
      } else {
        await ctx.answerCbQuery('Failed to label');
      }
    }

    // Refresh pending list
    const pending = manualLabelingService.getPendingTokens(20);
    const message = formatPendingLabels(pending);

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      ...getPendingLabelsKeyboard(pending),
    });
  });

  // Training confirmation
  bot.action('ml_train_confirm', async (ctx) => {
    const status = trainingPipeline.getStatus();

    if (status.isTraining) {
      await ctx.answerCbQuery('Training already in progress');
      return;
    }

    const sampleCounts = database.getMLSampleCount();
    if (sampleCounts.labeled < 50) {
      await ctx.answerCbQuery(`Need ${50 - sampleCounts.labeled} more samples`);
      return;
    }

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '<b>🚀 Start Training?</b>\n\n' +
      `Labeled samples: <b>${sampleCounts.labeled}</b>\n` +
      `New samples: <b>${status.newSamplesSinceLastTrain}</b>\n\n` +
      'This may take a few moments.',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Start', 'ml_train_start'),
            Markup.button.callback('❌ Cancel', 'ml_back'),
          ],
        ]),
      }
    );
  });

  bot.action('ml_train_start', async (ctx) => {
    await ctx.answerCbQuery('Training started...');
    await ctx.editMessageText('⏳ Training in progress...', { parse_mode: 'HTML' });

    const result = await trainingPipeline.train();

    if (result.success) {
      await ctx.editMessageText(
        `✅ <b>Training Complete!</b>\n\n` +
        `Version: <code>${result.modelVersion}</code>\n` +
        `Accuracy: <b>${((result.metrics?.accuracy || 0) * 100).toFixed(1)}%</b>\n` +
        `F1 Score: <b>${((result.metrics?.f1Score || 0) * 100).toFixed(1)}%</b>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('« Back', 'ml_back')]]),
        }
      );
    } else {
      await ctx.editMessageText(
        `❌ Training failed: ${result.error}`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('« Back', 'ml_back')]]),
        }
      );
    }
  });

  bot.action('ml_features_refresh', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');
    await ctx.editMessageText('<i>🔍 Analyzing feature importance...</i>', { parse_mode: 'HTML' });

    try {
      const result = await featureSelection.analyzeFeatureImportance();
      const formatted = featureSelection.formatForDisplay(result);

      await ctx.editMessageText(`<pre>${formatted}</pre>`, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Refresh', callback_data: 'ml_features_refresh' },
              { text: '« Back', callback_data: 'ml_back' }
            ]
          ]
        }
      });
    } catch (error) {
      const err = error as Error;
      await ctx.editMessageText(
        '<b>❌ Feature Analysis Failed</b>\n\n' +
        `<i>${err.message}</i>\n\n` +
        'Make sure you have at least 100 labeled samples.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '« Back', callback_data: 'ml_back' }]]
          }
        }
      );
    }
  });

  bot.action('ml_ensemble_on', async (ctx) => {
    rugPredictor.setUseEnsemble(true);
    await ctx.answerCbQuery('Ensemble enabled');
    
    const stats = ensemblePredictor.formatStats();
    await ctx.editMessageText(
      `<b>🎯 Ensemble Status: ✅ ON</b>\n\n<pre>${stats}</pre>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '❌ Disable', callback_data: 'ml_ensemble_off' },
              { text: '🔄 Refresh', callback_data: 'ml_ensemble_refresh' }
            ],
            [{ text: '« Back', callback_data: 'ml_back' }]
          ]
        }
      }
    );
  });

  bot.action('ml_ensemble_off', async (ctx) => {
    rugPredictor.setUseEnsemble(false);
    await ctx.answerCbQuery('Ensemble disabled');
    
    const stats = ensemblePredictor.formatStats();
    await ctx.editMessageText(
      `<b>🎯 Ensemble Status: ❌ OFF</b>\n\n<pre>${stats}</pre>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Enable', callback_data: 'ml_ensemble_on' },
              { text: '🔄 Refresh', callback_data: 'ml_ensemble_refresh' }
            ],
            [{ text: '« Back', callback_data: 'ml_back' }]
          ]
        }
      }
    );
  });

  bot.action('ml_ensemble_refresh', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');
    
    const isEnabled = rugPredictor.isEnsembleEnabled();
    const stats = ensemblePredictor.formatStats();

    await ctx.editMessageText(
      `<b>🎯 Ensemble Status: ${isEnabled ? '✅ ON' : '❌ OFF'}</b>\n\n<pre>${stats}</pre>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: isEnabled ? '❌ Disable' : '✅ Enable', callback_data: isEnabled ? 'ml_ensemble_off' : 'ml_ensemble_on' },
              { text: '🔄 Refresh', callback_data: 'ml_ensemble_refresh' }
            ],
            [{ text: '« Back', callback_data: 'ml_back' }]
          ]
        }
      }
    );
  });
}
