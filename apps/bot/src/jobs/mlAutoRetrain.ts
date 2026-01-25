/**
 * ML Auto-Retrain Job
 * Runs daily to check if model retraining is needed
 * Automatically trains and deploys improved models
 */

import { mlRetrainer } from '../services/ml/mlRetrainer';
import { logger } from '../utils/logger';
import { telegram } from '../services/telegram';
import { config } from '../config';

export async function checkAndRetrain(): Promise<void> {
  try {
    logger.info('MLAutoRetrain', 'Checking if retraining is needed');

    // Check if retraining is due
    const shouldRetrain = await mlRetrainer.shouldRetrain();

    if (!shouldRetrain) {
      logger.info('MLAutoRetrain', 'Not due for retraining yet');
      return;
    }

    logger.info('MLAutoRetrain', '🚀 Starting new training run');

    // 1. Prepare data
    const trainData = await mlRetrainer.getTrainingSamples();
    const valData = await mlRetrainer.getValidationSamples();
    const testData = await mlRetrainer.getTestSamples();

    logger.info(
      'MLAutoRetrain',
      `📊 Samples: ${trainData.length} train, ${valData.length} val, ${testData.length} test`
    );

    // 2. Train new model
    const newVersion = await mlRetrainer.trainNewModel();

    logger.info(
      'MLAutoRetrain',
      `✅ Model ${newVersion.version} trained: accuracy=${(newVersion.accuracy * 100).toFixed(2)}%, f1=${(newVersion.f1_score * 100).toFixed(2)}%`
    );

    // 3. Compare to current production model
    const currentModel = await mlRetrainer.getCurrentProductionModel();

    if (currentModel) {
      const comparison = await mlRetrainer.compareModels(
        currentModel.version,
        newVersion.version
      );

      logger.info(
        'MLAutoRetrain',
        `📈 Comparison: ${(comparison.improvement * 100).toFixed(2)}% improvement - ${comparison.recommendation}`
      );

      if (comparison.recommendation === 'deploy') {
        logger.info('MLAutoRetrain', `🎯 New model is better! Deploying ${newVersion.version}`);
        await mlRetrainer.deployModel(newVersion.version);
      } else if (comparison.recommendation === 'reject') {
        logger.warn('MLAutoRetrain', `❌ New model underperformed. Keeping ${currentModel.version}`);
      } else {
        logger.info('MLAutoRetrain', `⏸️ Marginal improvement. Keeping ${currentModel.version} for now`);
      }
    } else {
      // First model, deploy it
      logger.info('MLAutoRetrain', '🆕 First model trained, deploying');
      await mlRetrainer.deployModel(newVersion.version);
    }

    // 4. Generate report
    const report = await mlRetrainer.generateTrainingReport(newVersion.version);

    // 5. Alert admins
    await notifyAdmins(report);

    logger.info('MLAutoRetrain', '✅ Auto-retrain cycle completed successfully');

  } catch (error) {
    logger.error('MLAutoRetrain', 'Error during auto-retrain cycle', error as Error);
    
    // Notify admins of failure
    try {
      await telegram.sendMessage(
        config.ADMIN_CHAT_ID || '',
        `⚠️ ML Auto-Retrain Failed\n\nError: ${(error as Error).message}\n\nPlease check logs for details.`
      );
    } catch (notifyError) {
      logger.error('MLAutoRetrain', 'Failed to notify admins', notifyError as Error);
    }
  }
}

/**
 * Notify admins about training results
 */
async function notifyAdmins(report: any): Promise<void> {
  try {
    const adminChatId = config.ADMIN_CHAT_ID;
    if (!adminChatId) {
      logger.warn('MLAutoRetrain', 'No admin chat ID configured');
      return;
    }

    const accuracyEmoji = report.accuracyDelta > 0 ? '📈' : report.accuracyDelta < 0 ? '📉' : '➡️';
    const deployedEmoji = report.deployed ? '✅' : '⏸️';

    const message = `
🔄 **ML Model Retrained**

📊 **New Model:** ${report.version}
✅ **Accuracy:** ${(report.accuracy * 100).toFixed(2)}% (${accuracyEmoji} ${report.accuracyDelta > 0 ? '+' : ''}${(report.accuracyDelta * 100).toFixed(2)}%)
🎯 **F1 Score:** ${(report.f1Score * 100).toFixed(2)}%
📈 **Training Samples:** ${report.trainingSamples}

**Performance vs Previous:**
- False Positives: ${report.falsePositives} (${report.fpDelta})
- False Negatives: ${report.falseNegatives} (${report.fnDelta})

${deployedEmoji} **Status:** ${report.deployed ? 'Deployed to production' : 'Held for review'}

${report.notes ? `📝 ${report.notes}` : ''}
    `.trim();

    await telegram.sendMessage(adminChatId, message);

    logger.info('MLAutoRetrain', 'Admin notification sent');

  } catch (error) {
    logger.error('MLAutoRetrain', 'Error notifying admins', error as Error);
  }
}

/**
 * Start the auto-retrain scheduler
 * Runs daily at 3 AM
 */
export function startAutoRetrainScheduler(): void {
  // Run once per day at 3 AM
  const DAILY_CHECK_HOUR = 3;
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;

  // Calculate time until next 3 AM
  const now = new Date();
  const next3AM = new Date();
  next3AM.setHours(DAILY_CHECK_HOUR, 0, 0, 0);
  
  if (now.getHours() >= DAILY_CHECK_HOUR) {
    next3AM.setDate(next3AM.getDate() + 1);
  }

  const timeUntilNext = next3AM.getTime() - now.getTime();

  logger.info('MLAutoRetrain', `Scheduler started. Next check in ${(timeUntilNext / HOUR_MS).toFixed(1)} hours`);

  // Initial check after delay
  setTimeout(() => {
    checkAndRetrain().catch(error => {
      logger.error('MLAutoRetrain', 'Scheduled check failed', error as Error);
    });

    // Then check daily
    setInterval(() => {
      checkAndRetrain().catch(error => {
        logger.error('MLAutoRetrain', 'Scheduled check failed', error as Error);
      });
    }, DAY_MS);

  }, timeUntilNext);
}
