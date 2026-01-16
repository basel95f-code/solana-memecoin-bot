/**
 * Telegram Backtest Commands
 * Commands for running and managing backtests
 */

import { Telegraf, Context } from 'telegraf';
import { database } from '../../database';
import {
  runBacktest,
  getPresetStrategy,
  getPresetNames,
  formatPresetInfo,
  formatResultsSummary,
  PRESET_STRATEGIES,
  BacktestConfig,
  BacktestTrade,
} from '../../backtest';
import { logger } from '../../utils/logger';

/**
 * Register backtest commands
 */
export function registerBacktestCommands(bot: Telegraf): void {
  // /strategies - List available strategies
  bot.command('strategies', handleStrategies);

  // /backtest <name> [days] - Run a backtest
  bot.command('backtest', handleBacktest);
  bot.command('bt', handleBacktest); // Alias

  // /btresults <run_id> - Show detailed results
  bot.command('btresults', handleResults);

  logger.info('Commands', 'Backtest commands registered');
}

/**
 * /strategies - List available strategies
 */
async function handleStrategies(ctx: Context): Promise<void> {
  try {
    const lines: string[] = [
      '📊 *Available Backtest Strategies*',
      '',
      '*Preset Strategies:*',
    ];

    // Add preset strategies
    for (const strategy of PRESET_STRATEGIES) {
      lines.push(`• \`${strategy.name}\``);
      lines.push(`  ${strategy.description}`);
      lines.push('');
    }

    // Add custom strategies from database
    const customStrategies = database.getAllBacktestStrategies().filter(s => !s.isPreset);
    if (customStrategies.length > 0) {
      lines.push('*Custom Strategies:*');
      for (const strategy of customStrategies) {
        lines.push(`• \`${strategy.name}\``);
        lines.push(`  ${strategy.description}`);
        lines.push('');
      }
    }

    lines.push('');
    lines.push('*Usage:*');
    lines.push('`/backtest <strategy_name> [days]`');
    lines.push('');
    lines.push('*Examples:*');
    lines.push('`/backtest conservative_trader 30`');
    lines.push('`/backtest degen_sniper 7`');

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Backtest', 'Error listing strategies', error as Error);
    await ctx.reply('Error listing strategies. Please try again.');
  }
}

/**
 * /backtest <name> [days] - Run a backtest
 */
async function handleBacktest(ctx: Context): Promise<void> {
  try {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.reply(
        '📊 *Backtest Usage*\n\n' +
        '`/backtest <strategy_name> [days]`\n\n' +
        '*Examples:*\n' +
        '`/backtest conservative_trader 30`\n' +
        '`/backtest degen_sniper 7`\n\n' +
        'Use `/strategies` to see available strategies.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const strategyName = args[0].toLowerCase();
    const days = parseInt(args[1]) || 30;

    // Validate days
    if (days < 1 || days > 365) {
      await ctx.reply('Days must be between 1 and 365.');
      return;
    }

    // Get strategy
    let strategy = getPresetStrategy(strategyName);
    if (!strategy) {
      const dbStrategy = database.getBacktestStrategy(strategyName);
      if (dbStrategy) {
        strategy = dbStrategy;
      }
    }

    if (!strategy) {
      await ctx.reply(
        `Strategy "${strategyName}" not found.\n\n` +
        'Use `/strategies` to see available strategies.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Send initial message
    const statusMsg = await ctx.reply(
      `⏳ Running backtest...\n\n` +
      `Strategy: ${strategy.name}\n` +
      `Period: Last ${days} days\n` +
      `Initial Capital: $10,000`,
    );

    // Ensure strategy has an ID
    if (!strategy.id) {
      strategy.id = database.saveBacktestStrategy(strategy);
    }

    // Run backtest
    const config: BacktestConfig = {
      strategy,
      days,
      initialCapital: 10000,
      includeTradeDetails: true,
    };

    const results = await runBacktest(
      config,
      async (startDate, endDate) => database.getTokensWithOutcomes(startDate, endDate)
    );

    // Save results
    const runId = database.saveBacktestRun(results, []);

    // Format results
    const resultLines: string[] = [
      `📊 *Backtest Results*`,
      '',
      `*Strategy:* ${results.strategyName}`,
      `*Period:* ${results.daysAnalyzed} days`,
      `*Run ID:* ${runId}`,
      '',
      '*Performance:*',
      `  Total Return: ${results.totalReturn >= 0 ? '+' : ''}${results.totalReturn.toFixed(2)}%`,
      `  Final Capital: $${results.finalCapital.toFixed(2)}`,
      `  P&L: ${results.totalProfitLoss >= 0 ? '+' : ''}$${results.totalProfitLoss.toFixed(2)}`,
      '',
      '*Trade Stats:*',
      `  Total Trades: ${results.totalTrades}`,
      `  Win Rate: ${results.winRate.toFixed(1)}%`,
      `  Winners: ${results.winningTrades} | Losers: ${results.losingTrades}`,
    ];

    if (results.totalTrades > 0) {
      resultLines.push(`  Avg Win: $${results.averageWin.toFixed(2)}`);
      resultLines.push(`  Avg Loss: $${results.averageLoss.toFixed(2)}`);
      resultLines.push('');
      resultLines.push('*Risk Metrics:*');
      resultLines.push(`  Max Drawdown: ${results.maxDrawdown.toFixed(2)}%`);
      resultLines.push(`  Sharpe Ratio: ${results.sharpeRatio.toFixed(2)}`);
      resultLines.push(`  Profit Factor: ${results.profitFactor === Infinity ? '∞' : results.profitFactor.toFixed(2)}`);
      resultLines.push('');
      resultLines.push(`Avg Hold Time: ${formatDuration(results.averageHoldTime)}`);
    } else {
      resultLines.push('');
      resultLines.push('_No tokens matched entry conditions in this period._');
      resultLines.push('_Try a longer period or different strategy._');
    }

    resultLines.push('');
    resultLines.push(`Use \`/btresults ${runId}\` for trade details.`);

    // Update message with results
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      resultLines.join('\n'),
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    logger.error('Backtest', 'Error running backtest', error as Error);
    await ctx.reply('Error running backtest. Please try again.');
  }
}

/**
 * /btresults <run_id> - Show detailed results
 */
async function handleResults(ctx: Context): Promise<void> {
  try {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      // Show recent runs
      const recentRuns = database.getRecentBacktestRuns(5);

      if (recentRuns.length === 0) {
        await ctx.reply('No backtest runs found. Use `/backtest` to run one.', { parse_mode: 'Markdown' });
        return;
      }

      const lines: string[] = [
        '📊 *Recent Backtest Runs*',
        '',
      ];

      for (const run of recentRuns) {
        const date = new Date(run.executedAt * 1000).toLocaleDateString();
        const returnStr = run.totalReturn >= 0 ? `+${run.totalReturn.toFixed(1)}%` : `${run.totalReturn.toFixed(1)}%`;
        lines.push(`*#${run.id}* - ${run.strategyName}`);
        lines.push(`  ${date} | ${run.totalTrades} trades | ${returnStr}`);
        lines.push('');
      }

      lines.push('Use `/btresults <run_id>` to see details.');

      await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
      return;
    }

    const runId = parseInt(args[0]);
    if (isNaN(runId)) {
      await ctx.reply('Invalid run ID. Use a number like `/btresults 123`', { parse_mode: 'Markdown' });
      return;
    }

    // Get run details
    const run = database.getBacktestRun(runId);
    if (!run) {
      await ctx.reply(`Run #${runId} not found.`);
      return;
    }

    // Get trades
    const trades = database.getBacktestTrades(runId, 20);

    const lines: string[] = [
      `📊 *Backtest Run #${runId}*`,
      '',
      `*Strategy:* ${run.strategyName}`,
      `*Period:* ${run.daysAnalyzed} days`,
      `*Executed:* ${new Date(run.executedAt * 1000).toLocaleString()}`,
      '',
      '*Summary:*',
      `  Return: ${run.totalReturn >= 0 ? '+' : ''}${run.totalReturn.toFixed(2)}%`,
      `  P&L: ${run.totalProfitLoss >= 0 ? '+' : ''}$${run.totalProfitLoss.toFixed(2)}`,
      `  Win Rate: ${run.winRate.toFixed(1)}% (${run.winningTrades}/${run.totalTrades})`,
      `  Max Drawdown: ${run.maxDrawdown.toFixed(2)}%`,
      `  Sharpe: ${run.sharpeRatio.toFixed(2)}`,
      '',
    ];

    if (trades.length > 0) {
      lines.push('*Recent Trades:*');
      for (const trade of trades.slice(0, 10)) {
        const pnlStr = trade.profitLoss >= 0
          ? `+$${trade.profitLoss.toFixed(2)}`
          : `-$${Math.abs(trade.profitLoss).toFixed(2)}`;
        const pctStr = trade.profitLossPercent >= 0
          ? `+${trade.profitLossPercent.toFixed(1)}%`
          : `${trade.profitLossPercent.toFixed(1)}%`;
        lines.push(`• ${trade.tokenSymbol}: ${pnlStr} (${pctStr}) - ${trade.exitReason}`);
      }

      if (trades.length > 10) {
        lines.push(`_...and ${trades.length - 10} more trades_`);
      }
    } else {
      lines.push('_No trades recorded for this run._');
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });

  } catch (error) {
    logger.error('Backtest', 'Error showing results', error as Error);
    await ctx.reply('Error showing results. Please try again.');
  }
}

/**
 * Format duration in human-readable form
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}
