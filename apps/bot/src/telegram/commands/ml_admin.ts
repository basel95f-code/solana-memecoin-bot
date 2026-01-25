/**
 * ML Admin Commands
 * Telegram commands for monitoring and controlling the ML system
 * 
 * Commands:
 * - /ml_status - Overall ML system health
 * - /ml_data_stats - Training data statistics
 * - /ml_quality - Data quality report
 * - /ml_trigger_training - Force training now
 * - /ml_compare_models - A/B test results
 * - /ml_drift_report - Distribution drift metrics
 */

import { Context, Markup } from 'telegraf';
import { logger } from '../../utils/logger';
import { mlDataCollectionJob } from '../../jobs/mlDataCollection';
import { mlOutcomeTrackingJob } from '../../jobs/mlOutcomeTracking';
import { autoTrainer } from '../../ml/training/AutoTrainer';
import { dataQualityChecker } from '../../ml/monitoring/DataQualityChecker';
import { distributionMonitor } from '../../ml/monitoring/DistributionMonitor';
import { database } from '../../database';

// ============================================
// ML Status Command
// ============================================

export async function mlStatusCommand(ctx: Context): Promise<void> {
  try {
    // Get status from all components
    const collectionStats = mlDataCollectionJob.getStats();
    const trackingStats = mlOutcomeTrackingJob.getStats();
    const trainerStatus = autoTrainer.getStatus();
    const collectionHealth = mlDataCollectionJob.getHealthStatus();
    const trackingHealth = mlOutcomeTrackingJob.getHealthStatus();
    
    // Calculate overall health
    const healthStatuses = [collectionHealth.status, trackingHealth.status];
    let overallHealth = '🟢';
    if (healthStatuses.includes('unhealthy')) {
      overallHealth = '🔴';
    } else if (healthStatuses.includes('degraded')) {
      overallHealth = '🟡';
    }
    
    const lines = [
      `${overallHealth} **ML System Status**`,
      '',
      '📊 **Data Collection**',
      `• Status: ${getHealthEmoji(collectionHealth.status)} ${collectionHealth.status}`,
      `• Tracked Tokens: ${collectionStats.collectorStats.trackedTokens}`,
      `• Snapshots Collected: ${collectionStats.stats.snapshotsCollected.toLocaleString()}`,
      `• Buffer Size: ${collectionStats.collectorStats.bufferSize}`,
      '',
      '🎯 **Outcome Tracking**',
      `• Status: ${getHealthEmoji(trackingHealth.status)} ${trackingHealth.status}`,
      `• Pending Outcomes: ${trackingStats.trackerStats.pendingOutcomes}`,
      `• Outcomes Recorded: ${trackingStats.stats.outcomesRecorded.toLocaleString()}`,
      `• Accuracy: ${trackingStats.trackerStats.accuracyPercent.toFixed(1)}%`,
      '',
      '🧠 **Model Training**',
      `• Production Model: ${trainerStatus.productionModelVersion || 'None'}`,
      `• Shadow Model: ${trainerStatus.shadowModelVersion || 'None'}`,
      `• New Samples: ${trainerStatus.newSamplesSinceLastTrain.toLocaleString()}`,
      `• Is Training: ${trainerStatus.isTraining ? 'Yes ⏳' : 'No'}`,
      '',
      '⏱️ **Last Activity**',
      `• Last Collection: ${formatTimestamp(collectionStats.lastRunAt)}`,
      `• Last Tracking: ${formatTimestamp(trackingStats.lastRunAt)}`,
      `• Last Training: ${formatTimestamp(trainerStatus.lastTrainingAt)}`,
    ];
    
    await ctx.replyWithMarkdown(lines.join('\n'));
    
  } catch (error) {
    logger.silentError('ml_admin', 'ml_status failed', error as Error);
    await ctx.reply('❌ Failed to get ML status');
  }
}

// ============================================
// ML Data Stats Command
// ============================================

export async function mlDataStatsCommand(ctx: Context): Promise<void> {
  try {
    const db = database.getDb();
    if (!db) {
      await ctx.reply('❌ Database not available');
      return;
    }
    
    // Get training data stats
    const totalResult = db.exec('SELECT COUNT(*) FROM ml_training_data');
    const totalSamples = totalResult[0]?.values[0]?.[0] as number || 0;
    
    const labeledResult = db.exec('SELECT COUNT(*) FROM ml_training_data WHERE has_outcome = 1');
    const labeledSamples = labeledResult[0]?.values[0]?.[0] as number || 0;
    
    const outcomeResult = db.exec(`
      SELECT outcome, COUNT(*) as count 
      FROM ml_training_data 
      WHERE outcome IS NOT NULL 
      GROUP BY outcome
    `);
    
    const outcomeCounts: Record<string, number> = {};
    if (outcomeResult.length > 0) {
      for (const row of outcomeResult[0].values) {
        outcomeCounts[row[0] as string] = row[1] as number;
      }
    }
    
    // Get recent activity
    const last24hResult = db.exec(`
      SELECT COUNT(*) FROM ml_training_data 
      WHERE created_at > ?
    `, [Math.floor(Date.now() / 1000) - 86400]);
    const last24h = last24hResult[0]?.values[0]?.[0] as number || 0;
    
    const last7dResult = db.exec(`
      SELECT COUNT(*) FROM ml_training_data 
      WHERE created_at > ?
    `, [Math.floor(Date.now() / 1000) - 7 * 86400]);
    const last7d = last7dResult[0]?.values[0]?.[0] as number || 0;
    
    const lines = [
      '📊 **ML Training Data Statistics**',
      '',
      '**Overall**',
      `• Total Samples: ${totalSamples.toLocaleString()}`,
      `• Labeled Samples: ${labeledSamples.toLocaleString()} (${totalSamples > 0 ? ((labeledSamples / totalSamples) * 100).toFixed(1) : 0}%)`,
      `• Unlabeled: ${(totalSamples - labeledSamples).toLocaleString()}`,
      '',
      '**By Outcome**',
    ];
    
    const outcomeEmojis: Record<string, string> = {
      rug: '💀',
      decline: '📉',
      stable: '➡️',
      pump: '📈',
      moon: '🚀',
    };
    
    for (const [outcome, count] of Object.entries(outcomeCounts)) {
      const emoji = outcomeEmojis[outcome] || '❓';
      const percent = labeledSamples > 0 ? ((count / labeledSamples) * 100).toFixed(1) : 0;
      lines.push(`• ${emoji} ${outcome}: ${count.toLocaleString()} (${percent}%)`);
    }
    
    lines.push('');
    lines.push('**Recent Activity**');
    lines.push(`• Last 24h: +${last24h.toLocaleString()} samples`);
    lines.push(`• Last 7d: +${last7d.toLocaleString()} samples`);
    
    // Collection rate
    if (last24h > 0) {
      const hourlyRate = (last24h / 24).toFixed(1);
      lines.push(`• Collection Rate: ~${hourlyRate}/hour`);
    }
    
    await ctx.replyWithMarkdown(lines.join('\n'));
    
  } catch (error) {
    logger.silentError('ml_admin', 'ml_data_stats failed', error as Error);
    await ctx.reply('❌ Failed to get data stats');
  }
}

// ============================================
// ML Quality Command
// ============================================

export async function mlQualityCommand(ctx: Context): Promise<void> {
  try {
    await ctx.reply('⏳ Running data quality check...');
    
    const report = await dataQualityChecker.checkQuality();
    
    const scoreEmoji = report.qualityScore >= 80 ? '🟢' :
                       report.qualityScore >= 60 ? '🟡' :
                       report.qualityScore >= 40 ? '🟠' : '🔴';
    
    const lines = [
      `${scoreEmoji} **Data Quality Report**`,
      '',
      `**Quality Score: ${report.qualityScore.toFixed(1)}/100**`,
      '',
      '**Data Completeness**',
      `• Total Samples: ${report.totalSamples.toLocaleString()}`,
      `• Valid Samples: ${report.validSamples.toLocaleString()} (${report.validPercent.toFixed(1)}%)`,
      `• Missing Data: ${report.totalMissingPercent.toFixed(2)}%`,
      '',
      '**Outliers**',
      `• Total Outliers: ${report.totalOutlierPercent.toFixed(2)}%`,
      '',
      '**Class Balance**',
      `• Imbalanced: ${report.isImbalanced ? 'Yes ⚠️' : 'No ✅'}`,
      `• Imbalance Ratio: ${report.imbalanceRatio.toFixed(1)}:1`,
    ];
    
    if (report.issues.length > 0) {
      lines.push('');
      lines.push('**Issues**');
      for (const issue of report.issues.slice(0, 5)) {
        lines.push(`• ${issue}`);
      }
    }
    
    if (report.recommendations.length > 0) {
      lines.push('');
      lines.push('**Recommendations**');
      for (const rec of report.recommendations.slice(0, 3)) {
        lines.push(`• ${rec}`);
      }
    }
    
    await ctx.replyWithMarkdown(lines.join('\n'));
    
  } catch (error) {
    logger.silentError('ml_admin', 'ml_quality failed', error as Error);
    await ctx.reply('❌ Failed to run quality check');
  }
}

// ============================================
// ML Trigger Training Command
// ============================================

export async function mlTriggerTrainingCommand(ctx: Context): Promise<void> {
  try {
    const status = autoTrainer.getStatus();
    
    if (status.isTraining) {
      await ctx.reply('⏳ Training is already in progress');
      return;
    }
    
    // Confirm with inline keyboard
    await ctx.reply(
      '⚠️ **Trigger Manual Training?**\n\n' +
      'This will start a full model training cycle.\n' +
      `Current samples available: ${status.newSamplesSinceLastTrain.toLocaleString()}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Yes, Train Now', 'ml_train_confirm'),
            Markup.button.callback('❌ Cancel', 'ml_train_cancel'),
          ],
        ]),
      }
    );
    
  } catch (error) {
    logger.silentError('ml_admin', 'ml_trigger_training failed', error as Error);
    await ctx.reply('❌ Failed to trigger training');
  }
}

// Training confirmation handlers
export async function mlTrainConfirmHandler(ctx: Context): Promise<void> {
  try {
    await ctx.answerCbQuery('Starting training...');
    await ctx.editMessageText('🚀 **Training Started**\n\nThis may take several minutes...');
    
    // Start training in background
    autoTrainer.train('manual').then(async job => {
      if (job.status === 'completed') {
        const message = [
          '✅ **Training Completed**',
          '',
          `• Model Version: ${job.modelVersion}`,
          `• Samples Used: ${job.samplesUsed?.toLocaleString()}`,
          `• Accuracy: ${((job.metrics?.accuracy || 0) * 100).toFixed(1)}%`,
          `• F1 Score: ${((job.metrics?.f1Score || 0) * 100).toFixed(1)}%`,
          `• AUC: ${((job.metrics?.auc || 0) * 100).toFixed(1)}%`,
          `• Deployed: ${job.deployed ? 'Yes ✅' : 'No (in shadow mode)'}`,
        ];
        await ctx.reply(message.join('\n'), { parse_mode: 'Markdown' });
      } else {
        await ctx.reply(`❌ Training failed: ${job.error}`);
      }
    }).catch(err => {
      ctx.reply(`❌ Training error: ${err.message}`);
    });
    
  } catch (error) {
    logger.silentError('ml_admin', 'ml_train_confirm failed', error as Error);
  }
}

export async function mlTrainCancelHandler(ctx: Context): Promise<void> {
  try {
    await ctx.answerCbQuery('Cancelled');
    await ctx.editMessageText('Training cancelled.');
  } catch (error) {
    // Ignore
  }
}

// ============================================
// ML Compare Models Command
// ============================================

export async function mlCompareModelsCommand(ctx: Context): Promise<void> {
  try {
    const db = database.getDb();
    if (!db) {
      await ctx.reply('❌ Database not available');
      return;
    }
    
    // Get recent comparisons
    const result = db.exec(`
      SELECT * FROM ml_model_comparisons
      ORDER BY compared_at DESC
      LIMIT 5
    `);
    
    if (result.length === 0 || result[0].values.length === 0) {
      await ctx.reply('📊 No model comparisons found yet.');
      return;
    }
    
    const columns = result[0].columns;
    const comparisons = result[0].values.map(row => {
      const obj: any = {};
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });
    
    const lines = ['📊 **Recent Model Comparisons**', ''];
    
    for (const comp of comparisons) {
      const winnerEmoji = comp.winner === 'challenger' ? '🏆' : 
                          comp.winner === 'production' ? '🛡️' : '🤝';
      
      lines.push(`**${comp.challenger_version}** vs Production`);
      lines.push(`• Accuracy: ${((comp.challenger_accuracy || 0) * 100).toFixed(1)}% vs ${((comp.production_accuracy || 0) * 100).toFixed(1)}% (${formatDelta(comp.accuracy_delta)})`);
      lines.push(`• F1: ${((comp.challenger_f1 || 0) * 100).toFixed(1)}% vs ${((comp.production_f1 || 0) * 100).toFixed(1)}% (${formatDelta(comp.f1_delta)})`);
      lines.push(`• p-value: ${comp.p_value?.toFixed(4) || 'N/A'} ${comp.is_significant ? '✓ sig' : ''}`);
      lines.push(`• Winner: ${winnerEmoji} ${comp.winner}`);
      lines.push(`• Date: ${formatTimestamp(comp.compared_at * 1000)}`);
      lines.push('');
    }
    
    await ctx.replyWithMarkdown(lines.join('\n'));
    
  } catch (error) {
    logger.silentError('ml_admin', 'ml_compare_models failed', error as Error);
    await ctx.reply('❌ Failed to get model comparisons');
  }
}

// ============================================
// ML Drift Report Command
// ============================================

export async function mlDriftReportCommand(ctx: Context): Promise<void> {
  try {
    await ctx.reply('⏳ Checking for distribution drift...');
    
    const report = await distributionMonitor.checkDrift();
    
    const urgencyEmoji = {
      none: '🟢',
      low: '🟡',
      medium: '🟠',
      high: '🔴',
      critical: '🚨',
    };
    
    const lines = [
      `${urgencyEmoji[report.urgency]} **Distribution Drift Report**`,
      '',
      `**Overall Drift Score: ${(report.overallDriftScore * 100).toFixed(1)}%**`,
      `• Drifted Features: ${report.driftedFeatureCount}/${report.featureDrift.length}`,
      `• Urgency: ${report.urgency.toUpperCase()}`,
      `• Retraining Recommended: ${report.retrainingRecommended ? 'Yes ⚠️' : 'No ✅'}`,
    ];
    
    // Top drifted features
    const topDrifted = report.featureDrift
      .filter(f => f.significance !== 'low')
      .sort((a, b) => b.driftScore - a.driftScore)
      .slice(0, 5);
    
    if (topDrifted.length > 0) {
      lines.push('');
      lines.push('**Top Drifted Features**');
      for (const feat of topDrifted) {
        const sigEmoji = feat.significance === 'critical' ? '🔴' :
                         feat.significance === 'high' ? '🟠' : '🟡';
        lines.push(`• ${sigEmoji} ${feat.featureName}: ${(feat.driftScore * 100).toFixed(1)}% (${feat.driftType})`);
      }
    }
    
    if (report.suggestedActions.length > 0) {
      lines.push('');
      lines.push('**Suggested Actions**');
      for (const action of report.suggestedActions.slice(0, 3)) {
        lines.push(`• ${action}`);
      }
    }
    
    await ctx.replyWithMarkdown(lines.join('\n'));
    
  } catch (error) {
    logger.silentError('ml_admin', 'ml_drift_report failed', error as Error);
    await ctx.reply('❌ Failed to check drift');
  }
}

// ============================================
// Helper Functions
// ============================================

function formatTimestamp(ts: number): string {
  if (!ts) return 'Never';
  
  const now = Date.now();
  const diff = now - ts;
  
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatDelta(delta: number): string {
  if (delta === undefined || delta === null) return 'N/A';
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${(delta * 100).toFixed(1)}%`;
}

function getHealthEmoji(status: string): string {
  switch (status) {
    case 'healthy': return '🟢';
    case 'degraded': return '🟡';
    case 'unhealthy': return '🔴';
    default: return '⚪';
  }
}

// Export all commands
export const mlAdminCommands = {
  ml_status: mlStatusCommand,
  ml_data_stats: mlDataStatsCommand,
  ml_quality: mlQualityCommand,
  ml_trigger_training: mlTriggerTrainingCommand,
  ml_compare_models: mlCompareModelsCommand,
  ml_drift_report: mlDriftReportCommand,
};

export const mlAdminCallbacks = {
  ml_train_confirm: mlTrainConfirmHandler,
  ml_train_cancel: mlTrainCancelHandler,
};
