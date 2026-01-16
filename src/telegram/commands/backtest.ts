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
  BacktestStrategy,
} from '../../backtest';
import {
  strategyManager,
  StrategyWizardState,
  createWizardState,
} from '../../backtest/strategyManager';
import { snapshotCollector } from '../../backtest/snapshotCollector';
import { logger } from '../../utils/logger';

// Store wizard states by chat ID
const wizardStates = new Map<string, StrategyWizardState>();

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

  // Strategy management commands
  bot.command('newstrategy', handleNewStrategy);
  bot.command('editstrategy', handleEditStrategy);
  bot.command('delstrategy', handleDeleteStrategy);
  bot.command('clonestrategy', handleCloneStrategy);
  bot.command('viewstrategy', handleViewStrategy);

  // Snapshot commands
  bot.command('snapshots', handleSnapshots);
  bot.command('watchsnap', handleWatchSnapshot);

  // Handle text input for wizard
  bot.on('text', handleWizardInput);

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

// ============================================
// Strategy Management Commands
// ============================================

/**
 * /newstrategy - Start interactive strategy creation
 */
async function handleNewStrategy(ctx: Context): Promise<void> {
  try {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    // Start wizard
    const state = createWizardState();
    wizardStates.set(chatId, state);

    await ctx.reply(
      '📝 *Create New Strategy*\n\n' +
      'Step 1: Enter a name for your strategy.\n\n' +
      '_Use lowercase letters, numbers, and underscores only._\n' +
      '_Example: my\\_degen\\_strategy_\n\n' +
      'Type `/cancel` to cancel.',
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    logger.error('Backtest', 'Error starting new strategy wizard', error as Error);
    await ctx.reply('Error starting strategy wizard.');
  }
}

/**
 * Handle wizard text input
 */
async function handleWizardInput(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id?.toString();
  if (!chatId) return;

  const state = wizardStates.get(chatId);
  if (!state) return; // Not in wizard mode

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';

  // Check for cancel
  if (text.toLowerCase() === '/cancel') {
    wizardStates.delete(chatId);
    await ctx.reply('Strategy creation cancelled.');
    return;
  }

  // Skip if it's another command
  if (text.startsWith('/')) return;

  try {
    switch (state.step) {
      case 'name':
        await handleWizardName(ctx, state, text);
        break;
      case 'entry':
        await handleWizardEntry(ctx, state, text);
        break;
      case 'exit':
        await handleWizardExit(ctx, state, text);
        break;
      case 'sizing':
        await handleWizardSizing(ctx, state, text);
        break;
      case 'confirm':
        await handleWizardConfirm(ctx, state, text);
        break;
    }

    // Update state
    wizardStates.set(chatId, state);
  } catch (error) {
    logger.error('Backtest', 'Error in wizard input', error as Error);
    await ctx.reply('Error processing input. Please try again.');
  }
}

async function handleWizardName(ctx: Context, state: StrategyWizardState, text: string): Promise<void> {
  const name = text.trim().toLowerCase().replace(/\s+/g, '_');

  // Validate name
  if (!/^[a-z0-9_]+$/.test(name)) {
    await ctx.reply('Invalid name. Use only lowercase letters, numbers, and underscores.');
    return;
  }

  if (name.length < 3 || name.length > 30) {
    await ctx.reply('Name must be between 3 and 30 characters.');
    return;
  }

  // Check if exists
  if (strategyManager.getStrategy(name)) {
    await ctx.reply(`Strategy "${name}" already exists. Choose a different name.`);
    return;
  }

  state.name = name;
  state.step = 'entry';

  await ctx.reply(
    '📝 *Step 2: Entry Conditions*\n\n' +
    'Describe when to enter trades. You can use natural language:\n\n' +
    '*Examples:*\n' +
    '• `risk 50+ liq 5k+ holders 50+`\n' +
    '• `risk 70 mint revoked lp burned`\n' +
    '• `liquidity $10000 holders 100`\n\n' +
    '*Available conditions:*\n' +
    '• `risk <score>` - Min risk score\n' +
    '• `liq/liquidity <amount>` - Min liquidity\n' +
    '• `holders <count>` - Min holders\n' +
    '• `mint revoked` - Require mint revoked\n' +
    '• `freeze revoked` - Require freeze revoked\n' +
    '• `lp burned` - Require LP burned\n' +
    '• `socials` - Require social links\n\n' +
    'Type your entry conditions:',
    { parse_mode: 'Markdown' }
  );
}

async function handleWizardEntry(ctx: Context, state: StrategyWizardState, text: string): Promise<void> {
  const conditions = strategyManager.parseEntryInput(text);
  state.entry = { ...state.entry, ...conditions };
  state.step = 'exit';

  // Show parsed conditions
  const parsed: string[] = [];
  if (conditions.minRiskScore !== undefined) parsed.push(`Risk Score: ${conditions.minRiskScore}+`);
  if (conditions.minLiquidity !== undefined) parsed.push(`Min Liquidity: $${conditions.minLiquidity}`);
  if (conditions.minHolders !== undefined) parsed.push(`Min Holders: ${conditions.minHolders}`);
  if (conditions.requireMintRevoked) parsed.push('Mint Revoked: Required');
  if (conditions.requireFreezeRevoked) parsed.push('Freeze Revoked: Required');
  if (conditions.requireLPBurned) parsed.push('LP Burned: Required');
  if (conditions.requireSocials) parsed.push('Socials: Required');

  await ctx.reply(
    '📝 *Step 3: Exit Conditions*\n\n' +
    `_Parsed entry: ${parsed.length > 0 ? parsed.join(', ') : 'Default settings'}_\n\n` +
    'Describe your exit strategy:\n\n' +
    '*Examples:*\n' +
    '• `tp 50% 100% sl -25%`\n' +
    '• `take profit 2x 3x stop loss 30%`\n' +
    '• `tp 100 200 300 sl 50 trailing 15`\n\n' +
    '*Available conditions:*\n' +
    '• `tp/take profit <percent>` - Take profit levels\n' +
    '• `sl/stop loss <percent>` - Stop loss\n' +
    '• `trailing <percent>` - Trailing stop\n\n' +
    'Type your exit conditions:',
    { parse_mode: 'Markdown' }
  );
}

async function handleWizardExit(ctx: Context, state: StrategyWizardState, text: string): Promise<void> {
  const conditions = strategyManager.parseExitInput(text);
  state.exit = { ...state.exit, ...conditions };
  state.step = 'sizing';

  // Show parsed conditions
  const parsed: string[] = [];
  if (conditions.takeProfitLevels && conditions.takeProfitLevels.length > 0) {
    parsed.push(`TP: ${conditions.takeProfitLevels.map(tp => `${tp.percent}%`).join(', ')}`);
  }
  if (conditions.stopLossPercent !== undefined) {
    parsed.push(`SL: ${conditions.stopLossPercent}%`);
  }
  if (conditions.trailingStopPercent !== undefined) {
    parsed.push(`Trailing: ${conditions.trailingStopPercent}%`);
  }

  await ctx.reply(
    '📝 *Step 4: Position Sizing*\n\n' +
    `_Parsed exit: ${parsed.length > 0 ? parsed.join(', ') : 'Default settings'}_\n\n` +
    'How much to invest per trade?\n\n' +
    '*Examples:*\n' +
    '• `5%` - 5% of capital per trade\n' +
    '• `$500` - Fixed $500 per trade\n' +
    '• `5% max $1000` - 5% capped at $1000\n\n' +
    'Type your position sizing:',
    { parse_mode: 'Markdown' }
  );
}

async function handleWizardSizing(ctx: Context, state: StrategyWizardState, text: string): Promise<void> {
  const lower = text.toLowerCase();

  // Parse percentage
  const pctMatch = lower.match(/(\d+)\s*%/);
  if (pctMatch) {
    state.sizing.method = 'percent_of_capital';
    state.sizing.percentOfCapital = parseInt(pctMatch[1]);
  }

  // Parse fixed amount
  const fixedMatch = lower.match(/\$\s*(\d+)/);
  if (fixedMatch && !pctMatch) {
    state.sizing.method = 'fixed';
    state.sizing.fixedAmount = parseInt(fixedMatch[1]);
  }

  // Parse max position
  const maxMatch = lower.match(/max\s*\$?\s*(\d+)/);
  if (maxMatch) {
    state.sizing.maxPositionSize = parseInt(maxMatch[1]);
  }

  state.step = 'confirm';

  // Build strategy preview
  const strategy = strategyManager.buildFromWizard(state);
  if (!strategy) {
    await ctx.reply('Error building strategy. Please start over with /newstrategy');
    return;
  }

  const summary = strategyManager.formatStrategySummary(strategy);

  await ctx.reply(
    '📝 *Step 5: Confirm Strategy*\n\n' +
    summary + '\n\n' +
    'Type `yes` to save or `no` to cancel.',
    { parse_mode: 'Markdown' }
  );
}

async function handleWizardConfirm(ctx: Context, state: StrategyWizardState, text: string): Promise<void> {
  const chatId = ctx.chat?.id?.toString();
  if (!chatId) return;

  const lower = text.toLowerCase().trim();

  if (lower === 'yes' || lower === 'y') {
    const strategy = strategyManager.buildFromWizard(state);
    if (!strategy) {
      await ctx.reply('Error building strategy.');
      wizardStates.delete(chatId);
      return;
    }

    const result = strategyManager.createStrategy(strategy);
    wizardStates.delete(chatId);

    if (result.success) {
      await ctx.reply(
        `Strategy "${strategy.name}" created successfully.\n\n` +
        `Use \`/backtest ${strategy.name}\` to test it.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(`Failed to create strategy:\n${result.errors.join('\n')}`);
    }
  } else if (lower === 'no' || lower === 'n') {
    wizardStates.delete(chatId);
    await ctx.reply('Strategy creation cancelled.');
  } else {
    await ctx.reply('Please type `yes` to save or `no` to cancel.', { parse_mode: 'Markdown' });
  }
}

/**
 * /editstrategy <name> - Edit a custom strategy
 */
async function handleEditStrategy(ctx: Context): Promise<void> {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const args = text.split(' ').slice(1);

  if (args.length === 0) {
    await ctx.reply(
      '*Edit Strategy*\n\n' +
      'Usage: `/editstrategy <name> <field> <value>`\n\n' +
      '*Fields:*\n' +
      '• `description` - Update description\n' +
      '• `stoploss` - Update stop loss %\n\n' +
      'Example: `/editstrategy my_strategy stoploss -30`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await ctx.reply('Edit functionality coming soon. Use `/delstrategy` and `/newstrategy` to recreate.');
}

/**
 * /delstrategy <name> - Delete a custom strategy
 */
async function handleDeleteStrategy(ctx: Context): Promise<void> {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const args = text.split(' ').slice(1);

  if (args.length === 0) {
    await ctx.reply('Usage: `/delstrategy <name>`', { parse_mode: 'Markdown' });
    return;
  }

  const name = args[0].toLowerCase();
  const result = strategyManager.deleteStrategy(name);

  if (result.success) {
    await ctx.reply(`Strategy "${name}" deleted.`);
  } else {
    await ctx.reply(result.error || 'Failed to delete strategy.');
  }
}

/**
 * /clonestrategy <source> <new_name> - Clone a strategy
 */
async function handleCloneStrategy(ctx: Context): Promise<void> {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const args = text.split(' ').slice(1);

  if (args.length < 2) {
    await ctx.reply(
      '*Clone Strategy*\n\n' +
      'Usage: `/clonestrategy <source> <new_name>`\n\n' +
      'Example: `/clonestrategy conservative_trader my_conservative`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const sourceName = args[0].toLowerCase();
  const newName = args[1].toLowerCase();

  const result = strategyManager.cloneStrategy(sourceName, newName);

  if (result.success) {
    await ctx.reply(
      `Strategy cloned successfully.\n\n` +
      `Use \`/backtest ${newName}\` to test it or \`/editstrategy ${newName}\` to modify it.`,
      { parse_mode: 'Markdown' }
    );
  } else {
    await ctx.reply(`Failed to clone:\n${result.errors.join('\n')}`);
  }
}

/**
 * /viewstrategy <name> - View strategy details
 */
async function handleViewStrategy(ctx: Context): Promise<void> {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const args = text.split(' ').slice(1);

  if (args.length === 0) {
    await ctx.reply('Usage: `/viewstrategy <name>`', { parse_mode: 'Markdown' });
    return;
  }

  const name = args[0].toLowerCase();
  const strategy = strategyManager.getStrategy(name);

  if (!strategy) {
    await ctx.reply(`Strategy "${name}" not found.`);
    return;
  }

  const summary = strategyManager.formatStrategySummary(strategy);
  await ctx.reply(summary, { parse_mode: 'Markdown' });
}

// ============================================
// Snapshot Commands
// ============================================

/**
 * /snapshots - Show snapshot collection status
 */
async function handleSnapshots(ctx: Context): Promise<void> {
  const stats = snapshotCollector.getStats();
  const watchList = snapshotCollector.getWatchList();

  const lines: string[] = [
    '📸 *Snapshot Collection Status*',
    '',
    `Status: ${stats.isRunning ? 'Running' : 'Stopped'}`,
    `Watched Tokens: ${stats.watchedTokens}`,
    `Total Snapshots: ${stats.totalSnapshots}`,
    '',
  ];

  if (watchList.length > 0) {
    lines.push('*Currently Watching:*');
    for (const token of watchList.slice(0, 10)) {
      const snapCount = token.snapshotCount || 0;
      lines.push(`• ${token.symbol || token.mint.slice(0, 8)}: ${snapCount} snapshots`);
    }
    if (watchList.length > 10) {
      lines.push(`_...and ${watchList.length - 10} more_`);
    }
  } else {
    lines.push('_No tokens being watched._');
  }

  lines.push('');
  lines.push('Use `/watchsnap <mint>` to watch a token.');

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}

/**
 * /watchsnap <mint> [hours] - Add token to snapshot watch list
 */
async function handleWatchSnapshot(ctx: Context): Promise<void> {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const args = text.split(' ').slice(1);

  if (args.length === 0) {
    await ctx.reply(
      '*Watch Token Snapshots*\n\n' +
      'Usage: `/watchsnap <mint> [hours]`\n\n' +
      'Collects price/volume snapshots every 5 minutes.\n' +
      'Default duration: 24 hours.\n\n' +
      'Example: `/watchsnap ABC123... 48`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const mint = args[0];
  const hours = parseInt(args[1]) || 24;
  const durationMs = hours * 60 * 60 * 1000;

  // Trigger initial snapshot
  const snapshot = await snapshotCollector.triggerSnapshot(mint);
  if (!snapshot) {
    await ctx.reply('Could not fetch token data. Check the mint address.');
    return;
  }

  // Add to watch list
  const added = snapshotCollector.addToWatchList(mint, snapshot.symbol, durationMs);
  if (added) {
    await ctx.reply(
      `Started watching ${snapshot.symbol || mint}.\n\n` +
      `Duration: ${hours} hours\n` +
      `Interval: Every 5 minutes\n\n` +
      `Initial price: $${snapshot.priceUsd.toFixed(6)}`
    );
  } else {
    await ctx.reply('Failed to add to watch list. Max tokens may be reached.');
  }
}
