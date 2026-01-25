/**
 * Portfolio Commands
 * Commands for tracking positions, P&L, performance, and tax reporting
 */

import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { positionTracker } from '../../portfolio/positionTracker';
import { pnlCalculator } from '../../portfolio/pnlCalculator';
import { performanceAnalytics } from '../../portfolio/performanceAnalytics';
import { taxReporting } from '../../portfolio/taxReporting';
import { logger } from '../../utils/logger';

export function registerPortfolioCommands(bot: Telegraf): void {
  
  // ========================================
  // /portfolio - Portfolio summary
  // ========================================
  bot.command('portfolio', async (ctx: Context) => {
    await ctx.replyWithHTML('<i>📊 Loading portfolio...</i>');

    try {
      const summary = await pnlCalculator.getPnLSummary();
      
      let message = '<b>📊 Portfolio Summary</b>\n\n';
      
      message += `💼 Positions: ${summary.openPositions} open / ${summary.totalPositions} total\n`;
      message += `💰 Portfolio Value: <b>$${summary.totalValue.toFixed(2)}</b>\n`;
      message += `💵 Total Invested: $${summary.totalInvested.toFixed(2)}\n\n`;
      
      const pnlSymbol = summary.totalPnl >= 0 ? '📈' : '📉';
      const pnlSign = summary.totalPnl >= 0 ? '+' : '';
      message += `${pnlSymbol} <b>Total P&L: ${pnlSign}$${summary.totalPnl.toFixed(2)} (${pnlSign}${summary.totalPnlPercent.toFixed(2)}%)</b>\n`;
      message += `  ├ Realized: $${summary.realizedPnl.toFixed(2)}\n`;
      message += `  └ Unrealized: $${summary.unrealizedPnl.toFixed(2)}\n\n`;
      
      message += `📊 Distribution:\n`;
      message += `  ├ Winners: ${summary.winningPositions} 🟢\n`;
      message += `  ├ Losers: ${summary.losingPositions} 🔴\n`;
      message += `  └ Break-even: ${summary.breakEvenPositions} ⚪\n\n`;
      
      if (summary.bestPosition) {
        message += `🏆 Best: <b>${summary.bestPosition.symbol}</b> (+$${summary.bestPosition.unrealizedPnl.toFixed(2)})\n`;
      }
      if (summary.worstPosition) {
        message += `📉 Worst: <b>${summary.worstPosition.symbol}</b> ($${summary.worstPosition.unrealizedPnl.toFixed(2)})\n`;
      }

      await ctx.replyWithHTML(message, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📋 Positions', callback_data: 'portfolio_positions' },
              { text: '📊 P&L', callback_data: 'portfolio_pnl' }
            ],
            [
              { text: '📈 Performance', callback_data: 'portfolio_performance' },
              { text: '🔄 Refresh', callback_data: 'portfolio_refresh' }
            ]
          ]
        }
      });
    } catch (error) {
      await ctx.replyWithHTML('<b>❌ Failed to load portfolio</b>');
      logger.error('Portfolio', 'Failed to load summary', error as Error);
    }
  });

  // ========================================
  // /add_position - Add entry to position
  // ========================================
  bot.command('add_position', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length < 3) {
      await ctx.replyWithHTML(
        '<b>📝 Add Position</b>\n\n' +
        '<code>/add_position &lt;token&gt; &lt;amount&gt; &lt;price&gt;</code>\n\n' +
        'Example:\n' +
        '<code>/add_position BONK 1000000 0.000012</code>'
      );
      return;
    }

    const [token, amountStr, priceStr] = args;
    const amount = parseFloat(amountStr);
    const price = parseFloat(priceStr);

    if (isNaN(amount) || isNaN(price)) {
      await ctx.replyWithHTML('<b>❌ Invalid amount or price</b>');
      return;
    }

    try {
      const position = await positionTracker.addEntry({
        tokenMint: token,
        symbol: token.toUpperCase(),
        price,
        amount,
        notes: 'Manual entry via Telegram',
      });

      await ctx.replyWithHTML(
        `<b>✅ Position Added</b>\n\n` +
        `Token: <b>${position.symbol}</b>\n` +
        `Amount: ${position.currentAmount}\n` +
        `Price: $${position.currentPrice.toFixed(6)}\n` +
        `Value: $${position.currentValue.toFixed(2)}\n\n` +
        `Avg Entry: $${position.avgEntryPrice.toFixed(6)}`
      );
    } catch (error) {
      await ctx.replyWithHTML('<b>❌ Failed to add position</b>');
      logger.error('Portfolio', 'Failed to add position', error as Error);
    }
  });

  // ========================================
  // /close_position - Exit position
  // ========================================
  bot.command('close_position', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length < 2) {
      await ctx.replyWithHTML(
        '<b>📝 Close Position</b>\n\n' +
        '<code>/close_position &lt;token&gt; &lt;exit_price&gt; [amount]</code>\n\n' +
        'Examples:\n' +
        '<code>/close_position BONK 0.000015</code> (full exit)\n' +
        '<code>/close_position BONK 0.000015 500000</code> (partial)'
      );
      return;
    }

    const [token, exitPriceStr, amountStr] = args;
    const exitPrice = parseFloat(exitPriceStr);
    const amount = amountStr ? parseFloat(amountStr) : undefined;

    if (isNaN(exitPrice)) {
      await ctx.replyWithHTML('<b>❌ Invalid exit price</b>');
      return;
    }

    try {
      // Find position
      const position = await positionTracker.getPositionByToken(token);
      
      if (!position) {
        await ctx.replyWithHTML(`<b>❌ No open position found for ${token}</b>`);
        return;
      }

      const exitAmount = amount || position.currentAmount;
      const isFullExit = exitAmount === position.currentAmount;

      const updated = await positionTracker.partialExit({
        positionId: position.id!,
        exitPrice,
        exitAmount,
        notes: 'Manual exit via Telegram',
      });

      await ctx.replyWithHTML(
        `<b>✅ Position ${isFullExit ? 'Closed' : 'Partially Closed'}</b>\n\n` +
        `Token: <b>${position.symbol}</b>\n` +
        `Exit Price: $${exitPrice.toFixed(6)}\n` +
        `Amount: ${exitAmount}\n\n` +
        `${!isFullExit ? `Remaining: ${updated.currentAmount}\n` : ''}` +
        `Realized P&L: ${updated.realizedPnl >= 0 ? '+' : ''}$${updated.realizedPnl.toFixed(2)}`
      );
    } catch (error) {
      const err = error as Error;
      await ctx.replyWithHTML(`<b>❌ Failed to close position</b>\n\n${err.message}`);
      logger.error('Portfolio', 'Failed to close position', error as Error);
    }
  });

  // ========================================
  // /pnl - Show P&L report
  // ========================================
  bot.command('pnl', async (ctx: Context) => {
    try {
      const summary = await pnlCalculator.getPnLSummary();
      const roi = await pnlCalculator.getROIMetrics();
      
      let message = '<b>📊 P&L Report</b>\n\n';
      
      const totalSymbol = summary.totalPnl >= 0 ? '📈' : '📉';
      const totalSign = summary.totalPnl >= 0 ? '+' : '';
      message += `${totalSymbol} <b>Total P&L: ${totalSign}$${summary.totalPnl.toFixed(2)} (${totalSign}${summary.totalPnlPercent.toFixed(2)}%)</b>\n`;
      message += `  ├ Realized: $${summary.realizedPnl.toFixed(2)}\n`;
      message += `  └ Unrealized: $${summary.unrealizedPnl.toFixed(2)}\n\n`;
      
      message += `💰 Portfolio:\n`;
      message += `  ├ Value: $${summary.totalValue.toFixed(2)}\n`;
      message += `  ├ Invested: $${summary.totalInvested.toFixed(2)}\n`;
      message += `  └ ROI: ${totalSign}${roi.roi.toFixed(2)}%\n\n`;
      
      message += `📊 Annualized Returns:\n`;
      message += `  ├ Daily: ${roi.roiDaily >= 0 ? '+' : ''}${roi.roiDaily.toFixed(3)}%\n`;
      message += `  ├ Weekly: ${roi.roiWeekly >= 0 ? '+' : ''}${roi.roiWeekly.toFixed(2)}%\n`;
      message += `  ├ Monthly: ${roi.roiMonthly >= 0 ? '+' : ''}${roi.roiMonthly.toFixed(2)}%\n`;
      message += `  └ Yearly: ${roi.roiYearly >= 0 ? '+' : ''}${roi.roiYearly.toFixed(2)}%\n`;

      await ctx.replyWithHTML(message);
    } catch (error) {
      await ctx.replyWithHTML('<b>❌ Failed to load P&L</b>');
      logger.error('Portfolio', 'Failed to load P&L', error as Error);
    }
  });

  // ========================================
  // /performance - Performance analytics
  // ========================================
  bot.command('performance', async (ctx: Context) => {
    await ctx.replyWithHTML('<i>📈 Calculating performance...</i>');

    try {
      const metrics = await performanceAnalytics.calculatePerformance();
      
      let message = '<b>📈 Performance Metrics</b>\n\n';
      
      message += `💰 Returns:\n`;
      message += `  ├ Total P&L: ${metrics.totalPnl >= 0 ? '+' : ''}$${metrics.totalPnl.toFixed(2)}\n`;
      message += `  └ ROI: ${metrics.roiPercent >= 0 ? '+' : ''}${metrics.roiPercent.toFixed(2)}%\n\n`;
      
      message += `📊 Trading Stats:\n`;
      message += `  ├ Total Trades: ${metrics.totalTrades}\n`;
      message += `  ├ Win Rate: ${metrics.winRate.toFixed(1)}% (${metrics.winningTrades}/${metrics.totalTrades})\n`;
      message += `  ├ Avg Win: $${metrics.avgWin.toFixed(2)}\n`;
      message += `  ├ Avg Loss: $${Math.abs(metrics.avgLoss).toFixed(2)}\n`;
      message += `  └ Profit Factor: ${metrics.profitFactor.toFixed(2)}\n\n`;
      
      message += `🎯 Best/Worst:\n`;
      message += `  ├ Best Trade: $${metrics.largestWin.toFixed(2)}\n`;
      message += `  └ Worst Trade: $${metrics.largestLoss.toFixed(2)}\n\n`;
      
      message += `📉 Risk Metrics:\n`;
      message += `  ├ Max Drawdown: $${metrics.maxDrawdown.toFixed(2)} (${metrics.maxDrawdownPercent.toFixed(2)}%)\n`;
      if (metrics.sharpeRatio !== null) {
        message += `  └ Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}\n\n`;
      } else {
        message += `  └ Sharpe Ratio: N/A\n\n`;
      }
      
      message += `🔥 Streaks:\n`;
      message += `  ├ Current: ${metrics.currentStreak > 0 ? '🟢' : '🔴'} ${Math.abs(metrics.currentStreak)}\n`;
      message += `  ├ Best: ${metrics.bestStreak} wins\n`;
      message += `  └ Worst: ${Math.abs(metrics.worstStreak)} losses\n\n`;
      
      message += `⏱️ Holding Time:\n`;
      message += `  ├ Average: ${(metrics.avgHoldingTimeHours / 24).toFixed(1)} days\n`;
      message += `  └ Median: ${(metrics.medianHoldingTimeHours / 24).toFixed(1)} days\n`;

      await ctx.replyWithHTML(message);
    } catch (error) {
      await ctx.replyWithHTML('<b>❌ Failed to calculate performance</b>');
      logger.error('Portfolio', 'Failed to calculate performance', error as Error);
    }
  });

  // ========================================
  // /winners - Show winning positions
  // ========================================
  bot.command('winners', async (ctx: Context) => {
    try {
      const breakdown = await pnlCalculator.getWinnersLosers();
      
      if (breakdown.winners.length === 0) {
        await ctx.replyWithHTML('<i>No winning positions</i>');
        return;
      }
      
      let message = `<b>🏆 Winners (${breakdown.winnersCount})</b>\n\n`;
      
      for (const pos of breakdown.winners.slice(0, 10)) {
        message += `<b>${pos.symbol}</b>\n`;
        message += `  Entry: $${pos.avgEntryPrice.toFixed(6)}\n`;
        message += `  Current: $${pos.currentPrice.toFixed(6)}\n`;
        message += `  P&L: <b>+$${pos.unrealizedPnl.toFixed(2)} (+${pos.unrealizedPnlPercent.toFixed(2)}%)</b>\n\n`;
      }
      
      message += `💰 Total Gains: <b>+$${breakdown.totalWinAmount.toFixed(2)}</b>\n`;
      message += `📊 Avg Gain: +${breakdown.avgWinPercent.toFixed(2)}%`;

      await ctx.replyWithHTML(message);
    } catch (error) {
      await ctx.replyWithHTML('<b>❌ Failed to load winners</b>');
      logger.error('Portfolio', 'Failed to load winners', error as Error);
    }
  });

  // ========================================
  // /losers - Show losing positions
  // ========================================
  bot.command('losers', async (ctx: Context) => {
    try {
      const breakdown = await pnlCalculator.getWinnersLosers();
      
      if (breakdown.losers.length === 0) {
        await ctx.replyWithHTML('<i>No losing positions</i>');
        return;
      }
      
      let message = `<b>📉 Losers (${breakdown.losersCount})</b>\n\n`;
      
      for (const pos of breakdown.losers.slice(0, 10)) {
        message += `<b>${pos.symbol}</b>\n`;
        message += `  Entry: $${pos.avgEntryPrice.toFixed(6)}\n`;
        message += `  Current: $${pos.currentPrice.toFixed(6)}\n`;
        message += `  P&L: <b>$${pos.unrealizedPnl.toFixed(2)} (${pos.unrealizedPnlPercent.toFixed(2)}%)</b>\n\n`;
      }
      
      message += `💸 Total Losses: <b>$${breakdown.totalLossAmount.toFixed(2)}</b>\n`;
      message += `📊 Avg Loss: ${breakdown.avgLossPercent.toFixed(2)}%`;

      await ctx.replyWithHTML(message);
    } catch (error) {
      await ctx.replyWithHTML('<b>❌ Failed to load losers</b>');
      logger.error('Portfolio', 'Failed to load losers', error as Error);
    }
  });

  // ========================================
  // /tax_report - Generate tax report
  // ========================================
  bot.command('tax_report', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    const year = args[0] ? parseInt(args[0]) : undefined;

    await ctx.replyWithHTML('<i>📊 Generating tax report...</i>');

    try {
      const report = await taxReporting.generateTaxReport('default', year);
      const formatted = taxReporting.formatTaxReport(report);

      await ctx.replyWithHTML(`<pre>${formatted}</pre>`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📄 Export CSV', callback_data: `tax_csv_${report.year}` },
              { text: '📋 Form 8949', callback_data: `tax_8949_${report.year}` }
            ]
          ]
        }
      });
    } catch (error) {
      await ctx.replyWithHTML('<b>❌ Failed to generate tax report</b>');
      logger.error('Portfolio', 'Failed to generate tax report', error as Error);
    }
  });

  // ========================================
  // Callback handlers
  // ========================================
  
  bot.action('portfolio_refresh', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');
    
    try {
      const summary = await pnlCalculator.getPnLSummary();
      
      let message = '<b>📊 Portfolio Summary</b>\n\n';
      message += `💼 Positions: ${summary.openPositions} open / ${summary.totalPositions} total\n`;
      message += `💰 Portfolio Value: <b>$${summary.totalValue.toFixed(2)}</b>\n`;
      message += `💵 Total Invested: $${summary.totalInvested.toFixed(2)}\n\n`;
      
      const pnlSymbol = summary.totalPnl >= 0 ? '📈' : '📉';
      const pnlSign = summary.totalPnl >= 0 ? '+' : '';
      message += `${pnlSymbol} <b>Total P&L: ${pnlSign}$${summary.totalPnl.toFixed(2)} (${pnlSign}${summary.totalPnlPercent.toFixed(2)}%)</b>\n`;
      
      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📋 Positions', callback_data: 'portfolio_positions' },
              { text: '📊 P&L', callback_data: 'portfolio_pnl' }
            ],
            [
              { text: '📈 Performance', callback_data: 'portfolio_performance' },
              { text: '🔄 Refresh', callback_data: 'portfolio_refresh' }
            ]
          ]
        }
      });
    } catch (error) {
      await ctx.editMessageText('<b>❌ Failed to refresh</b>', { parse_mode: 'HTML' });
    }
  });

  bot.action('portfolio_positions', async (ctx) => {
    await ctx.answerCbQuery();
    
    try {
      const positions = await positionTracker.getOpenPositions();
      
      if (positions.length === 0) {
        await ctx.editMessageText('<i>No open positions</i>', { parse_mode: 'HTML' });
        return;
      }
      
      let message = `<b>📋 Open Positions (${positions.length})</b>\n\n`;
      
      for (const pos of positions.slice(0, 15)) {
        const pnlSymbol = pos.unrealizedPnl >= 0 ? '📈' : '📉';
        const pnlSign = pos.unrealizedPnl >= 0 ? '+' : '';
        
        message += `<b>${pos.symbol}</b>\n`;
        message += `  Entry: $${pos.avgEntryPrice.toFixed(6)}\n`;
        message += `  Current: $${pos.currentPrice.toFixed(6)}\n`;
        message += `  Amount: ${pos.currentAmount.toFixed(2)}\n`;
        message += `  ${pnlSymbol} P&L: ${pnlSign}$${pos.unrealizedPnl.toFixed(2)} (${pnlSign}${pos.unrealizedPnlPercent.toFixed(2)}%)\n\n`;
      }
      
      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Back', callback_data: 'portfolio_refresh' }]
          ]
        }
      });
    } catch (error) {
      await ctx.editMessageText('<b>❌ Failed to load positions</b>', { parse_mode: 'HTML' });
    }
  });

  // Tax export callbacks
  bot.action(/^tax_csv_(\d+)$/, async (ctx) => {
    const year = parseInt(ctx.match[1]);
    await ctx.answerCbQuery('Generating CSV...');
    
    try {
      const csv = await taxReporting.exportCSV('default', year);
      
      // Send as document
      await ctx.replyWithDocument({
        source: Buffer.from(csv, 'utf-8'),
        filename: `tax_report_${year}.csv`,
      }, {
        caption: `📄 Tax Report ${year} (CSV)`,
      });
    } catch (error) {
      await ctx.reply('<b>❌ Failed to export CSV</b>', { parse_mode: 'HTML' });
    }
  });

  bot.action(/^tax_8949_(\d+)$/, async (ctx) => {
    const year = parseInt(ctx.match[1]);
    await ctx.answerCbQuery('Generating Form 8949...');
    
    try {
      const { shortTermCSV, longTermCSV } = await taxReporting.exportForm8949CSV('default', year);
      
      await ctx.replyWithDocument({
        source: Buffer.from(shortTermCSV, 'utf-8'),
        filename: `form_8949_short_term_${year}.csv`,
      }, {
        caption: `📄 Form 8949 - Short-Term ${year}`,
      });
      
      await ctx.replyWithDocument({
        source: Buffer.from(longTermCSV, 'utf-8'),
        filename: `form_8949_long_term_${year}.csv`,
      }, {
        caption: `📄 Form 8949 - Long-Term ${year}`,
      });
    } catch (error) {
      await ctx.reply('<b>❌ Failed to export Form 8949</b>', { parse_mode: 'HTML' });
    }
  });
}
