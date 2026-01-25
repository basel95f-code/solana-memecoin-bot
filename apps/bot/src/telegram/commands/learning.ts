/**
 * Learning Commands
 * Commands for viewing learning system stats and outcomes
 */

import type { Context, Telegraf } from 'telegraf';
import { learningOrchestrator } from '../../services/learningOrchestrator';
import { database } from '../../database';

export function registerLearningCommands(bot: Telegraf): void {
  // /learn command - learning system stats
  bot.command('learn', async (ctx: Context) => {
    const stats = learningOrchestrator.getStats();
    const formatted = learningOrchestrator.formatStats();

    await ctx.replyWithHTML(
      `<pre>${formatted}</pre>`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📊 Outcomes', callback_data: 'learn_outcomes' },
              { text: '🏆 Best/Worst', callback_data: 'learn_best_worst' }
            ],
            [
              { text: '🔄 Refresh', callback_data: 'learn_refresh' }
            ]
          ]
        }
      }
    );
  });

  // /outcomes command - view recent token outcomes
  bot.command('outcomes', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    const filter = args[0]?.toLowerCase(); // moon, rug, stable, decline

    let query = 'SELECT * FROM token_outcomes_v2 ORDER BY checked_at DESC LIMIT 20';
    let params: any[] = [];

    if (filter && ['moon', 'rug', 'stable', 'decline'].includes(filter)) {
      query = 'SELECT * FROM token_outcomes_v2 WHERE outcome_type = ? ORDER BY checked_at DESC LIMIT 20';
      params = [filter];
    }

    const outcomes = database.all<any>(query, params);

    if (outcomes.length === 0) {
      await ctx.replyWithHTML('<i>No outcomes tracked yet</i>');
      return;
    }

    let message = `<b>📊 Token Outcomes${filter ? ` (${filter})` : ''}</b>\n\n`;

    for (const outcome of outcomes.slice(0, 10)) {
      const emoji = {
        moon: '🚀',
        rug: '💀',
        stable: '➖',
        decline: '📉',
        unknown: '❓',
      }[outcome.outcome_type];

      const timeSince = Math.floor((Date.now() - outcome.checked_at) / 1000 / 60 / 60);

      message += `${emoji} <b>${outcome.symbol}</b> (${timeSince}h ago)\n`;
      message += `  Outcome: ${outcome.outcome_type}\n`;
      
      if (outcome.price_change_24h) {
        const sign = outcome.price_change_24h >= 0 ? '+' : '';
        message += `  24h Change: ${sign}${outcome.price_change_24h.toFixed(1)}%\n`;
      }
      
      message += `  Initial Risk: ${outcome.initial_risk_score}/100\n`;
      
      if (outcome.initial_rug_prob) {
        message += `  ML Prediction: ${(outcome.initial_rug_prob * 100).toFixed(0)}% rug\n`;
      }
      
      if (outcome.was_traded) {
        const profitSign = (outcome.trade_profit || 0) >= 0 ? '+' : '';
        message += `  💼 Traded: ${profitSign}$${(outcome.trade_profit || 0).toFixed(2)}\n`;
      }
      
      message += `\n`;
    }

    await ctx.replyWithHTML(message, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🚀 Moons', callback_data: 'outcomes_moon' },
            { text: '💀 Rugs', callback_data: 'outcomes_rug' }
          ],
          [
            { text: '➖ Stable', callback_data: 'outcomes_stable' },
            { text: '📉 Decline', callback_data: 'outcomes_decline' }
          ],
          [
            { text: '🔄 All', callback_data: 'outcomes_all' }
          ]
        ]
      }
    });
  });

  // Callback handlers
  bot.action('learn_refresh', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');

    const formatted = learningOrchestrator.formatStats();

    await ctx.editMessageText(
      `<pre>${formatted}</pre>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📊 Outcomes', callback_data: 'learn_outcomes' },
              { text: '🏆 Best/Worst', callback_data: 'learn_best_worst' }
            ],
            [
              { text: '🔄 Refresh', callback_data: 'learn_refresh' }
            ]
          ]
        }
      }
    );
  });

  bot.action('learn_outcomes', async (ctx) => {
    await ctx.answerCbQuery();

    const outcomes = database.all<any>(
      'SELECT * FROM token_outcomes_v2 ORDER BY checked_at DESC LIMIT 10'
    );

    if (outcomes.length === 0) {
      await ctx.editMessageText('<i>No outcomes tracked yet</i>', { parse_mode: 'HTML' });
      return;
    }

    let message = `<b>📊 Recent Outcomes</b>\n\n`;

    for (const outcome of outcomes) {
      const emoji = {
        moon: '🚀',
        rug: '💀',
        stable: '➖',
        decline: '📉',
        unknown: '❓',
      }[outcome.outcome_type];

      const timeSince = Math.floor((Date.now() - outcome.checked_at) / 1000 / 60 / 60);

      message += `${emoji} <b>${outcome.symbol}</b> (${timeSince}h ago)\n`;
      message += `  ${outcome.outcome_type}\n`;
      
      if (outcome.price_change_24h) {
        const sign = outcome.price_change_24h >= 0 ? '+' : '';
        message += `  ${sign}${outcome.price_change_24h.toFixed(1)}% (24h)\n`;
      }
      
      message += `\n`;
    }

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '« Back', callback_data: 'learn_refresh' }]
        ]
      }
    });
  });

  bot.action('learn_best_worst', async (ctx) => {
    await ctx.answerCbQuery();

    const best = database.all<any>(
      'SELECT * FROM token_outcomes_v2 WHERE price_change_24h IS NOT NULL ORDER BY price_change_24h DESC LIMIT 5'
    );

    const worst = database.all<any>(
      'SELECT * FROM token_outcomes_v2 WHERE price_change_24h IS NOT NULL ORDER BY price_change_24h ASC LIMIT 5'
    );

    let message = `<b>🏆 Best & Worst Outcomes</b>\n\n`;

    if (best.length > 0) {
      message += `<b>🚀 Top Performers:</b>\n`;
      for (const outcome of best) {
        message += `${outcome.symbol}: +${outcome.price_change_24h.toFixed(1)}%\n`;
      }
      message += `\n`;
    }

    if (worst.length > 0) {
      message += `<b>💀 Worst Performers:</b>\n`;
      for (const outcome of worst) {
        message += `${outcome.symbol}: ${outcome.price_change_24h.toFixed(1)}%\n`;
      }
    }

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '« Back', callback_data: 'learn_refresh' }]
        ]
      }
    });
  });

  // Outcome filter handlers
  for (const outcomeType of ['moon', 'rug', 'stable', 'decline', 'all']) {
    bot.action(`outcomes_${outcomeType}`, async (ctx) => {
      await ctx.answerCbQuery();

      let query = 'SELECT * FROM token_outcomes_v2 ORDER BY checked_at DESC LIMIT 10';
      let params: any[] = [];

      if (outcomeType !== 'all') {
        query = 'SELECT * FROM token_outcomes_v2 WHERE outcome_type = ? ORDER BY checked_at DESC LIMIT 10';
        params = [outcomeType];
      }

      const outcomes = database.all<any>(query, params);

      if (outcomes.length === 0) {
        await ctx.editMessageText(
          `<i>No ${outcomeType} outcomes yet</i>`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      let message = `<b>📊 Token Outcomes${outcomeType !== 'all' ? ` (${outcomeType})` : ''}</b>\n\n`;

      for (const outcome of outcomes) {
        const emoji = {
          moon: '🚀',
          rug: '💀',
          stable: '➖',
          decline: '📉',
          unknown: '❓',
        }[outcome.outcome_type];

        const timeSince = Math.floor((Date.now() - outcome.checked_at) / 1000 / 60 / 60);

        message += `${emoji} <b>${outcome.symbol}</b> (${timeSince}h ago)\n`;
        message += `  Outcome: ${outcome.outcome_type}\n`;
        
        if (outcome.price_change_24h) {
          const sign = outcome.price_change_24h >= 0 ? '+' : '';
          message += `  24h: ${sign}${outcome.price_change_24h.toFixed(1)}%\n`;
        }
        
        message += `  Risk: ${outcome.initial_risk_score}/100\n`;
        
        if (outcome.was_traded) {
          const profitSign = (outcome.trade_profit || 0) >= 0 ? '+' : '';
          message += `  💼 ${profitSign}$${(outcome.trade_profit || 0).toFixed(2)}\n`;
        }
        
        message += `\n`;
      }

      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🚀 Moons', callback_data: 'outcomes_moon' },
              { text: '💀 Rugs', callback_data: 'outcomes_rug' }
            ],
            [
              { text: '➖ Stable', callback_data: 'outcomes_stable' },
              { text: '📉 Decline', callback_data: 'outcomes_decline' }
            ],
            [
              { text: '🔄 All', callback_data: 'outcomes_all' }
            ]
          ]
        }
      });
    });
  }
}
