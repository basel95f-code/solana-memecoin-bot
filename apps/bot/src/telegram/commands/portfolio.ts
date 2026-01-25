/**
 * Portfolio Commands
 * Commands for tracking positions and PnL
 */

import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { portfolioTracker } from '../../services/portfolioTracker';

export function registerPortfolioCommands(bot: Telegraf): void {
  // /portfolio command - show summary
  bot.command('portfolio', async (ctx: Context) => {
    await ctx.replyWithHTML('<i>📊 Loading portfolio...</i>');

    try {
      const summary = await portfolioTracker.getPortfolioSummary();
      const formatted = portfolioTracker.formatSummary(summary);

      await ctx.replyWithHTML(
        `<pre>${formatted}</pre>`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📋 Positions', callback_data: 'portfolio_positions' },
                { text: '📊 PnL Report', callback_data: 'portfolio_pnl' }
              ],
              [
                { text: '🔄 Refresh', callback_data: 'portfolio_refresh' }
              ]
            ]
          }
        }
      );
    } catch (error) {
      await ctx.replyWithHTML('<b>❌ Failed to load portfolio</b>');
      console.error(error);
    }
  });

  // /positions command - list all open positions
  bot.command('positions', async (ctx: Context) => {
    try {
      const positions = portfolioTracker.getOpenPositions();

      if (positions.length === 0) {
        await ctx.replyWithHTML('<i>No open positions</i>');
        return;
      }

      let message = `<b>📋 Open Positions (${positions.length})</b>\n\n`;

      for (const pos of positions) {
        const pnlSymbol = pos.unrealizedPnl >= 0 ? '📈' : '📉';
        const pnlSign = pos.unrealizedPnl >= 0 ? '+' : '';
        
        message += `<b>${pos.symbol}</b> ${pos.side === 'long' ? '🟢' : '🔴'}\n`;
        message += `  Entry: $${pos.entryPrice.toFixed(6)}\n`;
        message += `  Current: $${pos.currentPrice.toFixed(6)}\n`;
        message += `  Qty: ${pos.quantity.toFixed(2)}\n`;
        message += `  ${pnlSymbol} PnL: ${pnlSign}$${pos.unrealizedPnl.toFixed(2)} (${pnlSign}${pos.unrealizedPnlPercent.toFixed(2)}%)\n`;
        message += `  Age: ${this.formatAge(Date.now() - pos.entryTime)}\n\n`;
      }

      await ctx.replyWithHTML(message, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Refresh', callback_data: 'portfolio_positions_refresh' },
              { text: '« Back', callback_data: 'portfolio_refresh' }
            ]
          ]
        }
      });
    } catch (error) {
      await ctx.replyWithHTML('<b>❌ Failed to load positions</b>');
      console.error(error);
    }
  });

  // /pnl command - show PnL report
  bot.command('pnl', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    const period = (args[0] as any) || 'all';

    try {
      const report = portfolioTracker.getPnLReport(period);
      const formatted = portfolioTracker.formatPnLReport(report);

      await ctx.replyWithHTML(
        `<pre>${formatted}</pre>`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Today', callback_data: 'pnl_today' },
                { text: '7d', callback_data: 'pnl_7d' },
                { text: '30d', callback_data: 'pnl_30d' },
                { text: 'All', callback_data: 'pnl_all' }
              ],
              [
                { text: '« Back', callback_data: 'portfolio_refresh' }
              ]
            ]
          }
        }
      );
    } catch (error) {
      await ctx.replyWithHTML('<b>❌ Failed to load PnL report</b>');
      console.error(error);
    }
  });

  // /open command - open a position
  bot.command('open', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length < 5) {
      await ctx.replyWithHTML(
        '<b>📝 Open Position</b>\n\n' +
        '<code>/open &lt;mint&gt; &lt;symbol&gt; &lt;side&gt; &lt;price&gt; &lt;quantity&gt;</code>\n\n' +
        'Example:\n' +
        '<code>/open So11...ABC BONK long 0.000012 1000000</code>'
      );
      return;
    }

    const [mint, symbol, side, priceStr, quantityStr] = args;

    if (side !== 'long' && side !== 'short') {
      await ctx.replyWithHTML('<b>❌ Side must be "long" or "short"</b>');
      return;
    }

    const price = parseFloat(priceStr);
    const quantity = parseFloat(quantityStr);

    if (isNaN(price) || isNaN(quantity)) {
      await ctx.replyWithHTML('<b>❌ Invalid price or quantity</b>');
      return;
    }

    try {
      const entryValue = price * quantity;
      const positionId = portfolioTracker.openPosition({
        tokenMint: mint,
        symbol: symbol.toUpperCase(),
        name: symbol,
        side: side as 'long' | 'short',
        entryPrice: price,
        quantity,
        entryValue,
      });

      await ctx.replyWithHTML(
        `<b>✅ Position Opened</b>\n\n` +
        `ID: ${positionId}\n` +
        `Token: ${symbol}\n` +
        `Side: ${side}\n` +
        `Entry: $${price.toFixed(6)}\n` +
        `Quantity: ${quantity}\n` +
        `Value: $${entryValue.toFixed(2)}`
      );
    } catch (error) {
      await ctx.replyWithHTML('<b>❌ Failed to open position</b>');
      console.error(error);
    }
  });

  // /close command - close a position
  bot.command('close', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length < 2) {
      await ctx.replyWithHTML(
        '<b>📝 Close Position</b>\n\n' +
        '<code>/close &lt;position_id&gt; &lt;exit_price&gt; [quantity] [fees]</code>\n\n' +
        'Example:\n' +
        '<code>/close 1 0.000015</code>\n' +
        '<code>/close 1 0.000015 500000 0.25</code> (partial close with fees)'
      );
      return;
    }

    const positionId = parseInt(args[0]);
    const exitPrice = parseFloat(args[1]);
    const quantity = args[2] ? parseFloat(args[2]) : undefined;
    const fees = args[3] ? parseFloat(args[3]) : 0;

    if (isNaN(positionId) || isNaN(exitPrice)) {
      await ctx.replyWithHTML('<b>❌ Invalid position ID or exit price</b>');
      return;
    }

    try {
      portfolioTracker.closePosition({
        positionId,
        exitPrice,
        quantity,
        fees,
      });

      await ctx.replyWithHTML(
        `<b>✅ Position Closed</b>\n\n` +
        `Exit Price: $${exitPrice.toFixed(6)}\n` +
        `${quantity ? `Quantity: ${quantity}\n` : ''}` +
        `${fees > 0 ? `Fees: $${fees.toFixed(2)}` : ''}`
      );
    } catch (error) {
      const err = error as Error;
      await ctx.replyWithHTML(`<b>❌ Failed to close position</b>\n\n${err.message}`);
      console.error(error);
    }
  });

  // Callback handlers
  bot.action('portfolio_refresh', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');

    try {
      const summary = await portfolioTracker.getPortfolioSummary();
      const formatted = portfolioTracker.formatSummary(summary);

      await ctx.editMessageText(
        `<pre>${formatted}</pre>`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📋 Positions', callback_data: 'portfolio_positions' },
                { text: '📊 PnL Report', callback_data: 'portfolio_pnl' }
              ],
              [
                { text: '🔄 Refresh', callback_data: 'portfolio_refresh' }
              ]
            ]
          }
        }
      );
    } catch (error) {
      await ctx.editMessageText('<b>❌ Failed to refresh</b>', { parse_mode: 'HTML' });
    }
  });

  bot.action('portfolio_positions', async (ctx) => {
    await ctx.answerCbQuery();

    try {
      const positions = portfolioTracker.getOpenPositions();

      if (positions.length === 0) {
        await ctx.editMessageText('<i>No open positions</i>', { parse_mode: 'HTML' });
        return;
      }

      let message = `<b>📋 Open Positions (${positions.length})</b>\n\n`;

      for (const pos of positions) {
        const pnlSymbol = pos.unrealizedPnl >= 0 ? '📈' : '📉';
        const pnlSign = pos.unrealizedPnl >= 0 ? '+' : '';
        
        message += `<b>${pos.symbol}</b> ${pos.side === 'long' ? '🟢' : '🔴'}\n`;
        message += `  Entry: $${pos.entryPrice.toFixed(6)}\n`;
        message += `  Current: $${pos.currentPrice.toFixed(6)}\n`;
        message += `  Qty: ${pos.quantity.toFixed(2)}\n`;
        message += `  ${pnlSymbol} PnL: ${pnlSign}$${pos.unrealizedPnl.toFixed(2)} (${pnlSign}${pos.unrealizedPnlPercent.toFixed(2)}%)\n`;
        message += `  Age: ${formatAge(Date.now() - pos.entryTime)}\n\n`;
      }

      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Refresh', callback_data: 'portfolio_positions_refresh' },
              { text: '« Back', callback_data: 'portfolio_refresh' }
            ]
          ]
        }
      });
    } catch (error) {
      await ctx.editMessageText('<b>❌ Failed to load positions</b>', { parse_mode: 'HTML' });
    }
  });

  bot.action('portfolio_positions_refresh', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');
    await ctx.answerCbQuery();
    // Trigger positions view
    ctx.callbackQuery!.data = 'portfolio_positions';
    return bot.handleUpdate(ctx as any);
  });

  bot.action('portfolio_pnl', async (ctx) => {
    await ctx.answerCbQuery();

    try {
      const report = portfolioTracker.getPnLReport('all');
      const formatted = portfolioTracker.formatPnLReport(report);

      await ctx.editMessageText(
        `<pre>${formatted}</pre>`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Today', callback_data: 'pnl_today' },
                { text: '7d', callback_data: 'pnl_7d' },
                { text: '30d', callback_data: 'pnl_30d' },
                { text: 'All', callback_data: 'pnl_all' }
              ],
              [
                { text: '« Back', callback_data: 'portfolio_refresh' }
              ]
            ]
          }
        }
      );
    } catch (error) {
      await ctx.editMessageText('<b>❌ Failed to load PnL report</b>', { parse_mode: 'HTML' });
    }
  });

  // PnL period handlers
  for (const period of ['today', '7d', '30d', 'all']) {
    bot.action(`pnl_${period}`, async (ctx) => {
      await ctx.answerCbQuery();

      try {
        const report = portfolioTracker.getPnLReport(period as any);
        const formatted = portfolioTracker.formatPnLReport(report);

        await ctx.editMessageText(
          `<pre>${formatted}</pre>`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: 'Today', callback_data: 'pnl_today' },
                  { text: '7d', callback_data: 'pnl_7d' },
                  { text: '30d', callback_data: 'pnl_30d' },
                  { text: 'All', callback_data: 'pnl_all' }
                ],
                [
                  { text: '« Back', callback_data: 'portfolio_refresh' }
                ]
              ]
            }
          }
        );
      } catch (error) {
        await ctx.editMessageText('<b>❌ Failed to load PnL report</b>', { parse_mode: 'HTML' });
      }
    });
  }
}

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}
