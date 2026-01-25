/**
 * Analytics Telegram Commands
 * User-facing commands for accessing analytics insights
 */

import { CommandContext } from 'grammy';
import { analyticsAPI } from '../../analytics/api';
import { logger } from '../../utils/logger';

/**
 * /analytics - Overall performance summary
 */
export async function analyticsCommand(ctx: CommandContext): Promise<void> {
  try {
    await ctx.reply('📊 Generating analytics summary...');

    const summary = await analyticsAPI.getAnalyticsSummary();

    const message = `
📊 **ANALYTICS SUMMARY**

**🎯 Patterns**
• Total Patterns: ${summary.patterns.totalPatterns}
• Avg Win Rate: ${summary.patterns.avgWinRate.toFixed(1)}%
• Best Pattern: ${summary.patterns.bestPattern}
• Total Matches: ${summary.patterns.totalMatches}

**⏰ Time Insights**
• Best Entry Hour: ${summary.time.bestEntryHour}:00 UTC
• Best Day: ${summary.time.bestEntryDay}
• Avg Hold Time: ${summary.time.avgHoldTime.toFixed(1)}h
• Preferred: ${summary.time.weekdayVsWeekend.preferred} (${summary.time.weekdayVsWeekend.winRateDiff.toFixed(1)}% better)

**📈 Lifecycle**
• Avg Time to Peak: ${summary.lifecycle.avgTimeToPeak.toFixed(1)}h
• Success Rate: ${summary.lifecycle.successRate.toFixed(1)}%
• Avg Peak: ${summary.lifecycle.avgPeakMultiplier.toFixed(1)}x
• 24h Survival: ${summary.lifecycle.survivalRate24h.toFixed(1)}%

**🛡️ Risk Validation**
• Overall Accuracy: ${summary.risk.overallAccuracy.toFixed(1)}%
• Optimal Threshold: ${summary.risk.optimalThreshold}
• Top Feature: ${summary.risk.topFeature}

_Use /pattern_stats, /best_times, /lifecycle_stats, or /risk_accuracy for detailed insights_
    `.trim();

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('AnalyticsCommand', 'Failed to generate analytics summary', error);
    await ctx.reply('❌ Failed to generate analytics summary. Please try again later.');
  }
}

/**
 * /pattern_stats - Pattern performance breakdown
 */
export async function patternStatsCommand(ctx: CommandContext): Promise<void> {
  try {
    await ctx.reply('🎯 Analyzing pattern performance...');

    const patterns = await analyticsAPI.getPatternPerformance() as any[];

    if (!Array.isArray(patterns) || patterns.length === 0) {
      await ctx.reply('No pattern data available yet.');
      return;
    }

    // Show top 10 patterns
    const topPatterns = patterns
      .filter(p => p.sampleSize >= 5)
      .slice(0, 10);

    let message = '🎯 **TOP PERFORMING PATTERNS**\n\n';

    for (let i = 0; i < topPatterns.length; i++) {
      const p = topPatterns[i];
      const icon = p.patternType === 'success' ? '✅' : p.patternType === 'rug' ? '⚠️' : '⚪';

      message += `${i + 1}. ${icon} **${p.patternName}**\n`;
      message += `   Win Rate: ${p.winRate.toFixed(1)}% | Matches: ${p.totalMatches}\n`;
      message += `   Avg Return: ${p.averageReturnPercent > 0 ? '+' : ''}${p.averageReturnPercent.toFixed(1)}%\n`;
      message += `   Accuracy: ${p.accuracy.toFixed(1)}% | F1: ${p.f1Score.toFixed(1)}\n\n`;
    }

    // Pattern correlations
    const correlations = await analyticsAPI.getPatternCorrelations(5);

    if (correlations.length > 0) {
      message += '\n🔗 **PATTERN CORRELATIONS**\n\n';

      for (const corr of correlations.slice(0, 5)) {
        message += `• ${corr.pattern1} + ${corr.pattern2}\n`;
        message += `  Combined Win Rate: ${corr.combinedWinRate.toFixed(1)}%\n`;
        message += `  Co-occurrence: ${corr.coOccurrenceCount} times\n\n`;
      }
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('AnalyticsCommand', 'Failed to get pattern stats', error);
    await ctx.reply('❌ Failed to get pattern statistics. Please try again later.');
  }
}

/**
 * /best_times - Best entry times analysis
 */
export async function bestTimesCommand(ctx: CommandContext): Promise<void> {
  try {
    await ctx.reply('⏰ Analyzing best entry times...');

    const timeInsights = await analyticsAPI.getTimeBasedInsights();

    let message = '⏰ **BEST ENTRY TIMES**\n\n';

    // Best hours
    message += '🕐 **Best Hours (UTC)**\n';
    for (const hour of timeInsights.bestTimes.slice(0, 5)) {
      message += `${hour.hour}:00 - Win Rate: ${hour.winRate.toFixed(1)}% | ${hour.totalTrades} trades\n`;
    }

    message += '\n📅 **Best Days**\n';
    const topDays = timeInsights.daily
      .filter(d => d.totalTrades >= 5)
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 3);

    for (const day of topDays) {
      message += `${day.dayName} - Win Rate: ${day.winRate.toFixed(1)}% | ${day.totalTrades} trades\n`;
    }

    // Weekday vs Weekend
    message += '\n📊 **Weekday vs Weekend**\n';
    message += `Weekday: ${timeInsights.weekdayWeekend.weekday.winRate.toFixed(1)}% (${timeInsights.weekdayWeekend.weekday.totalTrades} trades)\n`;
    message += `Weekend: ${timeInsights.weekdayWeekend.weekend.winRate.toFixed(1)}% (${timeInsights.weekdayWeekend.weekend.totalTrades} trades)\n`;

    const preferred = timeInsights.weekdayWeekend.difference.winRateDiff > 0 ? 'Weekday' : 'Weekend';
    message += `✅ Better: ${preferred} (+${Math.abs(timeInsights.weekdayWeekend.difference.winRateDiff).toFixed(1)}%)\n`;

    // Time to pump
    message += '\n⚡ **Time to Pump**\n';
    message += `Average: ${timeInsights.timeToPump.avgTimeToPump.toFixed(1)}h\n`;
    message += `Median: ${timeInsights.timeToPump.medianTimeToPump.toFixed(1)}h\n`;
    message += `Fastest: ${timeInsights.timeToPump.fastestPump.toFixed(1)}h\n`;

    // Hold time analysis
    message += '\n⏱️ **Optimal Hold Times**\n';
    const topHoldTimes = timeInsights.holdTime
      .filter(h => h.count >= 3)
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 3);

    for (const ht of topHoldTimes) {
      message += `${ht.holdTimeRange}: ${ht.winRate.toFixed(1)}% win rate, ${ht.avgReturn > 0 ? '+' : ''}${ht.avgReturn.toFixed(1)}% avg\n`;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('AnalyticsCommand', 'Failed to get best times', error);
    await ctx.reply('❌ Failed to get time analysis. Please try again later.');
  }
}

/**
 * /lifecycle_stats - Token lifecycle insights
 */
export async function lifecycleStatsCommand(ctx: CommandContext): Promise<void> {
  try {
    await ctx.reply('📈 Analyzing token lifecycles...');

    const lifecycleData = await analyticsAPI.getLifecycleStats();

    let message = '📈 **TOKEN LIFECYCLE INSIGHTS**\n\n';

    // Overall lifecycle
    message += '⏱️ **Lifecycle Timing**\n';
    message += `Launch → Peak: ${lifecycleData.stats.avgLaunchToPeak.toFixed(1)}h avg, ${lifecycleData.stats.medianLaunchToPeak.toFixed(1)}h median\n`;
    message += `Peak → Dump: ${lifecycleData.stats.avgPeakToDump.toFixed(1)}h avg\n`;
    message += `Total Lifecycle: ${lifecycleData.stats.avgTotalLifecycle.toFixed(1)}h avg\n`;

    message += '\n💰 **Performance**\n';
    message += `Success Rate: ${lifecycleData.stats.successRate.toFixed(1)}%\n`;
    message += `Avg Peak: ${lifecycleData.stats.avgPeakMultiplier.toFixed(1)}x\n`;
    message += `Median Peak: ${lifecycleData.stats.medianPeakMultiplier.toFixed(1)}x\n`;

    // Survival rates
    message += '\n💀 **Survival Rates**\n';
    message += `After 24h: ${lifecycleData.survivalRates.after24h.toFixed(1)}%\n`;
    message += `After 7d: ${lifecycleData.survivalRates.after7d.toFixed(1)}%\n`;
    message += `After 30d: ${lifecycleData.survivalRates.after30d.toFixed(1)}%\n`;
    message += `Total Analyzed: ${lifecycleData.survivalRates.totalTokens}\n`;

    // Smart money timing
    message += '\n🧠 **Smart Money Behavior**\n';
    message += `Avg Entry: ${lifecycleData.smartMoneyTiming.avgEntryTime.toFixed(1)}h after launch\n`;
    message += `Avg Exit: ${lifecycleData.smartMoneyTiming.avgExitTime.toFixed(1)}h after launch\n`;
    message += `Avg Hold: ${lifecycleData.smartMoneyTiming.avgHoldDuration.toFixed(1)}h\n`;

    // Entry distribution
    if (lifecycleData.smartMoneyTiming.entryDistribution.length > 0) {
      message += '\n🎯 **Smart Money Entry Distribution**\n';
      for (const dist of lifecycleData.smartMoneyTiming.entryDistribution) {
        if (dist.count > 0) {
          message += `${dist.range}: ${dist.percentage.toFixed(0)}%\n`;
        }
      }
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('AnalyticsCommand', 'Failed to get lifecycle stats', error);
    await ctx.reply('❌ Failed to get lifecycle statistics. Please try again later.');
  }
}

/**
 * /risk_accuracy - Risk score validation
 */
export async function riskAccuracyCommand(ctx: CommandContext): Promise<void> {
  try {
    await ctx.reply('🛡️ Validating risk scores...');

    const riskData = await analyticsAPI.getRiskScoreAccuracy();

    let message = '🛡️ **RISK SCORE VALIDATION**\n\n';

    // Summary
    message += '📊 **Overall**\n';
    message += `Accuracy: ${riskData.summary.overallAccuracy.toFixed(1)}%\n`;
    message += `Avg Calibration Error: ${riskData.summary.avgCalibrationError.toFixed(1)}%\n`;
    message += `Optimal Threshold: ${riskData.summary.optimalThreshold}\n`;
    message += `Well-Calibrated Ranges: ${riskData.summary.wellCalibratedRanges}/4\n`;
    message += `Total Samples: ${riskData.summary.totalSamples}\n`;

    // By risk level
    message += '\n🎯 **Accuracy by Risk Level**\n';
    for (const level of riskData.byLevel) {
      if (level.totalTokens === 0) continue;

      const icon = level.riskLevel === 'LOW' ? '✅' : 
                   level.riskLevel === 'MEDIUM' ? '⚠️' : 
                   level.riskLevel === 'HIGH' ? '🔴' : '☠️';

      message += `\n${icon} **${level.riskLevel}** (${level.scoreRange.min}-${level.scoreRange.max})\n`;
      message += `Actual Success: ${level.actualSuccessRate.toFixed(1)}% | Expected: ${level.expectedSuccessRate.toFixed(1)}%\n`;
      message += `Calibration Error: ${level.calibrationError.toFixed(1)}%\n`;
      message += `Samples: ${level.totalTokens} | Avg Return: ${level.avgReturn > 0 ? '+' : ''}${level.avgReturn.toFixed(1)}%\n`;
    }

    // Feature importance
    message += '\n🔍 **Top Features**\n';
    const topFeatures = riskData.featureImportance.slice(0, 5);
    for (const feature of topFeatures) {
      message += `• ${feature.feature.replace(/_/g, ' ')}: ${feature.importance.toFixed(1)} (${feature.correlation > 0 ? '+' : ''}${feature.correlation.toFixed(2)})\n`;
    }

    // Optimal threshold
    if (riskData.optimalThresholds.length > 0) {
      const optimal = riskData.optimalThresholds[0];
      message += '\n✨ **Optimal Threshold: ${optimal.threshold}**\n';
      message += `Precision: ${optimal.precision.toFixed(1)}% | Recall: ${optimal.recall.toFixed(1)}%\n`;
      message += `F1 Score: ${optimal.f1Score.toFixed(1)}% | Accuracy: ${optimal.accuracy.toFixed(1)}%\n`;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('AnalyticsCommand', 'Failed to get risk accuracy', error);
    await ctx.reply('❌ Failed to get risk validation. Please try again later.');
  }
}

/**
 * Register all analytics commands
 */
export function registerAnalyticsCommands(bot: any): void {
  bot.command('analytics', analyticsCommand);
  bot.command('pattern_stats', patternStatsCommand);
  bot.command('best_times', bestTimesCommand);
  bot.command('lifecycle_stats', lifecycleStatsCommand);
  bot.command('risk_accuracy', riskAccuracyCommand);

  logger.info('AnalyticsCommands', 'Registered analytics commands');
}
