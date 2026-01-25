/**
 * ML Manager Commands
 * Commands for managing ML auto-retraining and model versioning
 */

import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { mlRetrainer } from '../../services/ml/mlRetrainer';
import { checkAndRetrain } from '../../jobs/mlAutoRetrain';
import { logger } from '../../utils/logger';
import { config } from '../../config';

// Admin-only commands
const ADMIN_COMMANDS = ['mltrain', 'mlrollback'];

/**
 * Check if user is admin
 */
function isAdmin(ctx: Context): boolean {
  const userId = ctx.from?.id;
  const adminIds = config.ADMIN_USER_IDS || [];
  return adminIds.includes(userId?.toString() || '');
}

/**
 * Format duration
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Format timestamp
 */
function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function registerMLManagerCommands(bot: Telegraf): void {
  /**
   * /mlstatus - Show ML system status
   */
  bot.command('mlstatus', async (ctx: Context) => {
    try {
      const productionModel = await mlRetrainer.getCurrentProductionModel();
      const schedule = await mlRetrainer['getTrainingSchedule']();
      
      if (!productionModel) {
        await ctx.replyWithHTML(`
⚙️ <b>ML System Status</b>

❌ No production model deployed yet

Use /mltrain to train your first model
        `.trim());
        return;
      }

      const performance = await mlRetrainer.getModelPerformance(productionModel.version);
      const now = Math.floor(Date.now() / 1000);
      const nextRetrainingIn = schedule?.next_run_at 
        ? formatDuration(schedule.next_run_at - now)
        : 'Not scheduled';

      const message = `
⚙️ <b>ML System Status</b>

📊 <b>Current Model:</b> ${productionModel.version}
✅ <b>Accuracy:</b> ${(productionModel.accuracy * 100).toFixed(2)}%
🎯 <b>F1 Score:</b> ${(productionModel.f1_score * 100).toFixed(2)}%
📅 <b>Trained:</b> ${formatDate(productionModel.trained_at)}

📈 <b>Performance:</b>
• Predictions Made: ${performance?.totalPredictions || 0}
• Accuracy: ${((performance?.accuracy || 0) * 100).toFixed(2)}%
• False Positives: ${performance?.falsePositives || 0}
• False Negatives: ${performance?.falseNegatives || 0}

🔄 <b>Auto-Retraining:</b>
• Status: ${schedule?.is_enabled ? '✅ Enabled' : '❌ Disabled'}
• Next Check: ${nextRetrainingIn}
• Frequency: Every ${schedule?.frequency_days || 7} days
• Min Samples: ${schedule?.min_new_samples || 50}

<i>Use /mlhistory to see version history</i>
      `.trim();

      await ctx.replyWithHTML(message, Markup.inlineKeyboard([
        [
          Markup.button.callback('📜 History', 'ml_show_history'),
          Markup.button.callback('📊 Report', 'ml_show_report')
        ],
        [
          Markup.button.callback('🔄 Refresh', 'ml_refresh_status')
        ]
      ]));

    } catch (error) {
      logger.error('MLManager', 'Error in /mlstatus', error as Error);
      await ctx.replyWithHTML('❌ Error fetching ML status. Please try again.');
    }
  });

  /**
   * /mlhistory - Show model version history
   */
  bot.command('mlhistory', async (ctx: Context) => {
    try {
      const history = await mlRetrainer.getModelHistory();

      if (history.length === 0) {
        await ctx.replyWithHTML(`
📜 <b>Model History</b>

No models trained yet.

Use /mltrain to train your first model.
        `.trim());
        return;
      }

      const lines: string[] = ['📜 <b>Model Version History</b>\n'];

      for (const model of history.slice(0, 10)) {
        const icon = model.is_production ? '🟢' : model.is_active ? '🟡' : '⚪';
        const delta = model.accuracy_delta 
          ? `(${model.accuracy_delta > 0 ? '+' : ''}${(model.accuracy_delta * 100).toFixed(2)}%)` 
          : '';

        lines.push(
          `${icon} <b>${model.version}</b> - ${(model.accuracy * 100).toFixed(2)}% ${delta}`,
          `   Trained: ${formatDate(model.trained_at)}`,
          `   F1: ${(model.f1_score * 100).toFixed(2)}% | Samples: ${model.training_samples}`,
          ''
        );
      }

      lines.push('\n<i>🟢 Production | 🟡 Active | ⚪ Inactive</i>');
      lines.push('<i>Use /mlcompare v1 v2 to compare versions</i>');

      await ctx.replyWithHTML(lines.join('\n'));

    } catch (error) {
      logger.error('MLManager', 'Error in /mlhistory', error as Error);
      await ctx.replyWithHTML('❌ Error fetching model history. Please try again.');
    }
  });

  /**
   * /mltrain - Manually trigger retraining (admin only)
   */
  bot.command('mltrain', async (ctx: Context) => {
    if (!isAdmin(ctx)) {
      await ctx.replyWithHTML('🔒 This command is admin-only.');
      return;
    }

    try {
      await ctx.replyWithHTML('🚀 <b>Starting Manual Training Run</b>\n\nThis may take a few minutes...');

      // Run the auto-retrain job
      await checkAndRetrain();

      await ctx.replyWithHTML('✅ Training completed! Use /mlstatus to see results.');

    } catch (error) {
      logger.error('MLManager', 'Error in /mltrain', error as Error);
      await ctx.replyWithHTML(`❌ Training failed: ${(error as Error).message}`);
    }
  });

  /**
   * /mlcompare <v1> <v2> - Compare two model versions
   */
  bot.command('mlcompare', async (ctx: Context) => {
    try {
      const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
      const args = text.split(' ').slice(1);

      if (args.length !== 2) {
        await ctx.replyWithHTML(`
📊 <b>Compare Models</b>

Usage: <code>/mlcompare v1.0.0 v1.0.1</code>

Get a detailed comparison between two model versions.
        `.trim());
        return;
      }

      const [v1, v2] = args;
      const comparison = await mlRetrainer.compareModels(v1, v2);

      const improvementIcon = comparison.improvement > 0 ? '📈' : comparison.improvement < 0 ? '📉' : '➡️';
      const recommendationIcon = 
        comparison.recommendation === 'deploy' ? '✅' : 
        comparison.recommendation === 'reject' ? '❌' : '⚠️';

      const message = `
📊 <b>Model Comparison</b>

<b>${v1}</b> vs <b>${v2}</b>

📈 <b>Metrics:</b>

<b>${v1}:</b>
• Accuracy: ${(comparison.v1.accuracy * 100).toFixed(2)}%
• F1 Score: ${(comparison.v1.f1_score * 100).toFixed(2)}%
• Precision: ${(comparison.v1.precision_score * 100).toFixed(2)}%
• Recall: ${(comparison.v1.recall_score * 100).toFixed(2)}%
• Trained: ${formatDate(comparison.v1.trained_at)}
• Samples: ${comparison.v1.training_samples}

<b>${v2}:</b>
• Accuracy: ${(comparison.v2.accuracy * 100).toFixed(2)}%
• F1 Score: ${(comparison.v2.f1_score * 100).toFixed(2)}%
• Precision: ${(comparison.v2.precision_score * 100).toFixed(2)}%
• Recall: ${(comparison.v2.recall_score * 100).toFixed(2)}%
• Trained: ${formatDate(comparison.v2.trained_at)}
• Samples: ${comparison.v2.training_samples}

${improvementIcon} <b>Improvement:</b> ${(comparison.improvement * 100).toFixed(2)}%

${recommendationIcon} <b>Recommendation:</b> ${comparison.recommendation.toUpperCase()}
<i>${comparison.reasoning}</i>
      `.trim();

      await ctx.replyWithHTML(message);

    } catch (error) {
      logger.error('MLManager', 'Error in /mlcompare', error as Error);
      await ctx.replyWithHTML(`❌ Comparison failed: ${(error as Error).message}`);
    }
  });

  /**
   * /mlrollback - Rollback to previous model (admin only)
   */
  bot.command('mlrollback', async (ctx: Context) => {
    if (!isAdmin(ctx)) {
      await ctx.replyWithHTML('🔒 This command is admin-only.');
      return;
    }

    try {
      const currentModel = await mlRetrainer.getCurrentProductionModel();
      
      if (!currentModel) {
        await ctx.replyWithHTML('❌ No production model to rollback from.');
        return;
      }

      await ctx.replyWithHTML(`⚠️ <b>Confirm Rollback</b>\n\nAre you sure you want to rollback from ${currentModel.version}?`, 
        Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Yes, Rollback', 'ml_rollback_confirm'),
            Markup.button.callback('❌ Cancel', 'ml_rollback_cancel')
          ]
        ])
      );

    } catch (error) {
      logger.error('MLManager', 'Error in /mlrollback', error as Error);
      await ctx.replyWithHTML(`❌ Rollback failed: ${(error as Error).message}`);
    }
  });

  /**
   * /mlfeatures - Show feature importance
   */
  bot.command('mlfeatures', async (ctx: Context) => {
    try {
      const productionModel = await mlRetrainer.getCurrentProductionModel();
      
      if (!productionModel) {
        await ctx.replyWithHTML('❌ No production model deployed yet.');
        return;
      }

      // Parse feature importance (if available)
      let features: any[] = [];
      if (productionModel.feature_importance) {
        try {
          features = JSON.parse(productionModel.feature_importance);
        } catch (e) {
          // Ignore parse errors
        }
      }

      const message = `
🔍 <b>Feature Importance</b>

Model: ${productionModel.version}

${features.length > 0 
  ? features.slice(0, 10).map((f, i) => 
      `${i + 1}. ${f.name}: <b>${(f.importance * 100).toFixed(1)}%</b>`
    ).join('\n')
  : '<i>Feature importance data not available for this model.</i>'
}

<i>These features have the most impact on rug predictions.</i>
      `.trim();

      await ctx.replyWithHTML(message);

    } catch (error) {
      logger.error('MLManager', 'Error in /mlfeatures', error as Error);
      await ctx.replyWithHTML('❌ Error fetching feature importance. Please try again.');
    }
  });

  /**
   * /mlreport - Generate detailed performance report
   */
  bot.command('mlreport', async (ctx: Context) => {
    try {
      const productionModel = await mlRetrainer.getCurrentProductionModel();
      
      if (!productionModel) {
        await ctx.replyWithHTML('❌ No production model deployed yet.');
        return;
      }

      const report = await mlRetrainer.generateTrainingReport(productionModel.version);
      const falsePositives = await mlRetrainer.analyzeFalsePositives(productionModel.version);
      const falseNegatives = await mlRetrainer.analyzeFalseNegatives(productionModel.version);

      const message = `
📊 <b>ML Performance Report</b>

<b>Model:</b> ${report.version}
<b>Training Date:</b> ${formatDate(productionModel.trained_at)}

📈 <b>Metrics:</b>
• Accuracy: ${(report.accuracy * 100).toFixed(2)}% (${report.accuracyDelta > 0 ? '+' : ''}${(report.accuracyDelta * 100).toFixed(2)}%)
• F1 Score: ${(report.f1Score * 100).toFixed(2)}%
• Training Samples: ${report.trainingSamples}

❌ <b>False Positives:</b> ${report.falsePositives} (${report.fpDelta})
<i>Predicted pump, actually rugged</i>
${falsePositives.recommendations.slice(0, 2).map((r: string) => `• ${r}`).join('\n')}

❌ <b>False Negatives:</b> ${report.falseNegatives} (${report.fnDelta})
<i>Predicted rug, actually pumped</i>
${falseNegatives.recommendations.slice(0, 2).map((r: string) => `• ${r}`).join('\n')}

${report.deployed ? '✅ Currently in production' : '⏸️ Not in production'}

${report.notes ? `\n📝 ${report.notes}` : ''}
      `.trim();

      await ctx.replyWithHTML(message);

    } catch (error) {
      logger.error('MLManager', 'Error in /mlreport', error as Error);
      await ctx.replyWithHTML('❌ Error generating report. Please try again.');
    }
  });

  // ═══════════════════════════════════════════
  // CALLBACK QUERY HANDLERS
  // ═══════════════════════════════════════════

  bot.action('ml_show_history', async (ctx) => {
    await ctx.answerCbQuery();
    
    const history = await mlRetrainer.getModelHistory();
    const lines: string[] = ['📜 <b>Recent Model Versions</b>\n'];

    for (const model of history.slice(0, 5)) {
      const icon = model.is_production ? '🟢' : '⚪';
      lines.push(
        `${icon} ${model.version} - ${(model.accuracy * 100).toFixed(2)}%`,
        `   ${formatDate(model.trained_at)}`
      );
    }

    await ctx.editMessageText(lines.join('\n'), { 
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('« Back', 'ml_refresh_status')]
      ])
    });
  });

  bot.action('ml_show_report', async (ctx) => {
    await ctx.answerCbQuery();
    
    const productionModel = await mlRetrainer.getCurrentProductionModel();
    if (!productionModel) {
      await ctx.answerCbQuery('No production model available', { show_alert: true });
      return;
    }

    const report = await mlRetrainer.generateTrainingReport(productionModel.version);
    
    await ctx.editMessageText(
      `📊 <b>Quick Report</b>\n\nModel: ${report.version}\nAccuracy: ${(report.accuracy * 100).toFixed(2)}%\nFP: ${report.falsePositives} | FN: ${report.falseNegatives}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('« Back', 'ml_refresh_status')]
        ])
      }
    );
  });

  bot.action('ml_refresh_status', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');
    
    const productionModel = await mlRetrainer.getCurrentProductionModel();
    if (!productionModel) {
      await ctx.editMessageText('No production model deployed yet.');
      return;
    }

    const performance = await mlRetrainer.getModelPerformance(productionModel.version);
    const schedule = await mlRetrainer['getTrainingSchedule']();
    const now = Math.floor(Date.now() / 1000);
    const nextRetrainingIn = schedule?.next_run_at 
      ? formatDuration(schedule.next_run_at - now)
      : 'Not scheduled';

    const message = `
⚙️ <b>ML System Status</b>

📊 <b>Model:</b> ${productionModel.version}
✅ <b>Accuracy:</b> ${(productionModel.accuracy * 100).toFixed(2)}%
🎯 <b>F1:</b> ${(productionModel.f1_score * 100).toFixed(2)}%

📈 Predictions: ${performance?.totalPredictions || 0}
🔄 Next Check: ${nextRetrainingIn}
    `.trim();

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('📜 History', 'ml_show_history'),
          Markup.button.callback('📊 Report', 'ml_show_report')
        ],
        [
          Markup.button.callback('🔄 Refresh', 'ml_refresh_status')
        ]
      ])
    });
  });

  bot.action('ml_rollback_confirm', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('Admin only!', { show_alert: true });
      return;
    }

    await ctx.answerCbQuery('Rolling back...');
    
    try {
      await mlRetrainer.rollbackModel();
      const newModel = await mlRetrainer.getCurrentProductionModel();
      
      await ctx.editMessageText(
        `✅ <b>Rollback Successful</b>\n\nNow using model: ${newModel?.version}`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      await ctx.editMessageText(
        `❌ Rollback failed: ${(error as Error).message}`,
        { parse_mode: 'HTML' }
      );
    }
  });

  bot.action('ml_rollback_cancel', async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    await ctx.editMessageText('Rollback cancelled.');
  });
}
