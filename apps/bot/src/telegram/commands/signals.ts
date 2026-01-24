/**
 * Trading Signals Commands
 * Commands for managing trading signals and webhooks
 */

import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { database } from '../../database';
import { signalService } from '../../signals';
import {
  formatSignalList,
  formatSignalPerformance,
  formatWebhookList,
} from '../formatters';
import type { TradingSignal, SignalType } from '../../signals/types';

// ═══════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════

function getSignalDetailsKeyboard(signal: TradingSignal) {
  return Markup.inlineKeyboard([
    [
      Markup.button.url('📊 Chart', `https://dexscreener.com/solana/${signal.mint}`),
      Markup.button.url('💱 Trade', `https://jup.ag/swap/SOL-${signal.mint}`),
    ],
    [
      Markup.button.callback('✅ Ack', `ack_${signal.id.slice(0, 16)}`),
      Markup.button.callback('📝 Record Outcome', `outcome_start_${signal.id.slice(0, 16)}`),
    ],
    [Markup.button.callback('« Back to Signals', 'signals_list')],
  ]);
}

function getSignalsListKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Active', 'signals_active'),
      Markup.button.callback('📜 History', 'signals_history'),
    ],
    [
      Markup.button.callback('📈 Performance', 'signals_perf'),
      Markup.button.callback('🔄 Refresh', 'signals_refresh'),
    ],
  ]);
}

function getWebhookListKeyboard(webhooks: any[]) {
  const buttons: any[][] = [];

  // Add toggle button for each webhook (limit to 5)
  for (const webhook of webhooks.slice(0, 5)) {
    const statusIcon = webhook.enabled ? '🟢' : '🔴';
    buttons.push([
      Markup.button.callback(
        `${statusIcon} ${webhook.name || 'Webhook'}`,
        `webhook_toggle_${webhook.id}`
      ),
      Markup.button.callback('🗑', `webhook_delete_${webhook.id}`),
    ]);
  }

  buttons.push([
    Markup.button.callback('➕ Add Webhook', 'webhook_add_prompt'),
    Markup.button.callback('🔄 Refresh', 'webhook_refresh'),
  ]);

  return Markup.inlineKeyboard(buttons);
}

// ═══════════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════════

export function registerSignalCommands(bot: Telegraf): void {
  // /signals command - list active signals
  bot.command('signals', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand || subcommand === 'list' || subcommand === 'active') {
      // Show active signals
      const signals = database.getSignals({ status: 'active', limit: 10 });

      if (signals.length === 0) {
        await ctx.replyWithHTML(
          '<b>📊 Trading Signals</b>\n\n' +
          '<i>No active signals at the moment.</i>\n\n' +
          'Signals are generated automatically when tokens meet quality criteria.\n\n' +
          'Use <code>/signals history</code> to view past signals.'
        );
        return;
      }

      const message = formatSignalList(signals, '📊 ACTIVE SIGNALS');
      await ctx.replyWithHTML(message, getSignalsListKeyboard());
      return;
    }

    if (subcommand === 'history') {
      // Show signal history
      const signals = database.getSignals({ limit: 20 });

      if (signals.length === 0) {
        await ctx.replyWithHTML(
          '<b>📜 Signal History</b>\n\n' +
          '<i>No signals generated yet.</i>'
        );
        return;
      }

      const message = formatSignalList(signals, '📜 SIGNAL HISTORY');
      await ctx.replyWithHTML(message);
      return;
    }

    if (subcommand === 'perf' || subcommand === 'performance') {
      // Show performance metrics
      const stats = database.getSignalStats();
      const message = formatSignalPerformance(stats);
      await ctx.replyWithHTML(message);
      return;
    }

    if (subcommand === 'config') {
      // Show configuration
      const config = signalService.getSignalConfig();
      let msg = '<b>⚙️ Signal Configuration</b>\n\n';
      msg += `Min BUY confidence: <b>${config.minBuyConfidence}%</b>\n`;
      msg += `Min SELL confidence: <b>${config.minSellConfidence}%</b>\n`;
      msg += `Max rug probability: <b>${(config.maxRugProbability * 100).toFixed(0)}%</b>\n`;
      msg += `Min risk score: <b>${config.minRiskScore}</b>\n`;
      msg += `Signal expiry: <b>${Math.round(config.signalExpirySeconds / 60)}m</b>\n`;
      msg += `Cooldown per token: <b>${Math.round(config.tokenCooldownSeconds / 60)}m</b>\n`;

      await ctx.replyWithHTML(msg);
      return;
    }

    // Unknown subcommand
    await ctx.replyWithHTML(
      '<b>📊 Signal Commands</b>\n\n' +
      '<code>/signals</code> - Active signals\n' +
      '<code>/signals history</code> - Past signals\n' +
      '<code>/signals perf</code> - Performance metrics\n' +
      '<code>/signals config</code> - View configuration\n' +
      '<code>/ack &lt;id&gt;</code> - Acknowledge a signal\n' +
      '<code>/outcome &lt;id&gt; &lt;entry&gt; &lt;exit&gt;</code> - Record outcome'
    );
  });

  // /ack command - acknowledge a signal
  bot.command('ack', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        '<b>✅ Acknowledge Signal</b>\n\n' +
        'Usage: <code>/ack &lt;signal_id&gt;</code>\n\n' +
        'This marks the signal as seen/acknowledged.'
      );
      return;
    }

    const signalId = args[0];
    const signal = database.getSignalById(signalId);

    if (!signal) {
      await ctx.replyWithHTML(`Signal not found: <code>${signalId}</code>`);
      return;
    }

    database.updateSignalStatus(signalId, 'acknowledged');
    signalService.acknowledgeSignal(signalId);

    await ctx.replyWithHTML(
      `✅ Signal <b>${signal.symbol}</b> acknowledged.\n\n` +
      `Use <code>/outcome ${signalId} &lt;entry&gt; &lt;exit&gt;</code> to record your trade result.`
    );
  });

  // /outcome command - record trade outcome
  bot.command('outcome', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length < 3) {
      await ctx.replyWithHTML(
        '<b>📝 Record Trade Outcome</b>\n\n' +
        'Usage: <code>/outcome &lt;signal_id&gt; &lt;entry_price&gt; &lt;exit_price&gt;</code>\n\n' +
        'Example: <code>/outcome abc123 0.00015 0.00025</code>\n\n' +
        'This helps improve signal accuracy over time.'
      );
      return;
    }

    const [signalId, entryStr, exitStr] = args;
    const entryPrice = parseFloat(entryStr);
    const exitPrice = parseFloat(exitStr);

    if (isNaN(entryPrice) || isNaN(exitPrice)) {
      await ctx.replyWithHTML('Invalid price values. Please use numbers.');
      return;
    }

    const signal = database.getSignalById(signalId);
    if (!signal) {
      await ctx.replyWithHTML(`Signal not found: <code>${signalId}</code>`);
      return;
    }

    const profitLossPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
    const wasAccurate = signal.type === 'BUY' ? profitLossPercent > 0 : profitLossPercent < 0;
    const now = Math.floor(Date.now() / 1000);

    database.recordSignalOutcome({
      id: signalId,
      actualEntry: entryPrice,
      actualExit: exitPrice,
      profitLossPercent,
      wasAccurate,
      entryRecordedAt: now,
      exitRecordedAt: now,
    });
    signalService.recordOutcome(signalId, entryPrice, exitPrice);

    const pnlEmoji = profitLossPercent >= 0 ? '📈' : '📉';
    const pnlColor = profitLossPercent >= 0 ? '+' : '';
    const accuracyEmoji = wasAccurate ? '✅' : '❌';

    await ctx.replyWithHTML(
      `<b>📝 Outcome Recorded</b>\n\n` +
      `Token: <b>${signal.symbol}</b>\n` +
      `Signal: <b>${signal.type}</b>\n` +
      `Entry: <code>$${entryPrice}</code>\n` +
      `Exit: <code>$${exitPrice}</code>\n` +
      `${pnlEmoji} P&L: <b>${pnlColor}${profitLossPercent.toFixed(2)}%</b>\n` +
      `${accuracyEmoji} Signal Accuracy: <b>${wasAccurate ? 'Correct' : 'Incorrect'}</b>\n\n` +
      `<i>Thank you! This data helps improve future signals.</i>`
    );
  });

  // /webhook command - manage webhooks
  bot.command('webhook', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand || subcommand === 'list') {
      // List webhooks
      const webhooks = database.getWebhooks();

      if (webhooks.length === 0) {
        await ctx.replyWithHTML(
          '<b>🔗 Webhooks</b>\n\n' +
          '<i>No webhooks configured.</i>\n\n' +
          'Add a webhook to receive signals in Discord:\n' +
          '<code>/webhook add &lt;discord_url&gt; [name]</code>'
        );
        return;
      }

      const message = formatWebhookList(webhooks);
      await ctx.replyWithHTML(message, getWebhookListKeyboard(webhooks));
      return;
    }

    if (subcommand === 'add') {
      const url = args[1];
      const name = args.slice(2).join(' ') || 'Discord Webhook';

      if (!url) {
        await ctx.replyWithHTML(
          '<b>➕ Add Webhook</b>\n\n' +
          'Usage: <code>/webhook add &lt;url&gt; [name]</code>\n\n' +
          'Example: <code>/webhook add https://discord.com/api/webhooks/... Trading Alerts</code>'
        );
        return;
      }

      // Validate URL format
      if (!url.startsWith('https://discord.com/api/webhooks/') &&
          !url.startsWith('https://discordapp.com/api/webhooks/')) {
        await ctx.replyWithHTML(
          '❌ Invalid webhook URL.\n\n' +
          'Please provide a valid Discord webhook URL.'
        );
        return;
      }

      try {
        const now = Math.floor(Date.now() / 1000);
        const allEvents: SignalType[] = ['BUY', 'SELL', 'TAKE_PROFIT', 'STOP_LOSS'];
        database.saveWebhook({
          url,
          name,
          enabled: true,
          events: allEvents,
          minConfidence: 60,
          createdAt: now,
        });

        // Register with signal service
        signalService.addWebhook({
          id: Date.now().toString(),
          url,
          name,
          enabled: true,
          events: allEvents,
          minConfidence: 60,
        });

        await ctx.replyWithHTML(
          `✅ Webhook added!\n\n` +
          `Name: <b>${name}</b>\n` +
          `Events: BUY, SELL, TAKE_PROFIT, STOP_LOSS\n` +
          `Min confidence: 60%\n\n` +
          `Use <code>/webhook list</code> to view all webhooks.`
        );
      } catch (error) {
        await ctx.replyWithHTML(
          `❌ Failed to add webhook.\n\n` +
          `Error: ${(error as Error).message}`
        );
      }
      return;
    }

    if (subcommand === 'remove' || subcommand === 'delete') {
      const id = args[1];

      if (!id) {
        await ctx.replyWithHTML(
          '<b>🗑 Remove Webhook</b>\n\n' +
          'Usage: <code>/webhook remove &lt;id&gt;</code>\n\n' +
          'Use <code>/webhook list</code> to see webhook IDs.'
        );
        return;
      }

      const webhookId = parseInt(id, 10);
      if (isNaN(webhookId)) {
        await ctx.replyWithHTML('Invalid webhook ID.');
        return;
      }

      database.deleteWebhook(webhookId);
      await ctx.replyWithHTML(`✅ Webhook removed.`);
      return;
    }

    if (subcommand === 'test') {
      // Test all webhooks
      const webhooks = database.getWebhooks();
      const enabledWebhooks = webhooks.filter(w => w.enabled);

      if (enabledWebhooks.length === 0) {
        await ctx.replyWithHTML('No enabled webhooks to test.');
        return;
      }

      await ctx.replyWithHTML(`Testing ${enabledWebhooks.length} webhook(s)...`);

      // Send test signal
      const testSignal: TradingSignal = {
        id: 'test-' + Date.now(),
        mint: 'So11111111111111111111111111111111111111112',
        symbol: 'TEST',
        name: 'Test Signal',
        type: 'BUY',
        confidence: 75,
        suggestedPositionSize: 0.1,
        positionSizeType: 'fixed_sol',
        rugProbability: 0.15,
        riskScore: 65,
        smartMoneyScore: 0.7,
        momentumScore: 0.6,
        holderScore: 0.8,
        entryPrice: 0.001,
        targetPrice: 0.002,
        stopLossPrice: 0.0008,
        reasons: ['Test signal', 'Good metrics'],
        warnings: ['This is a test'],
        status: 'active',
        generatedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      };

      await signalService.dispatchToWebhooks(testSignal);
      await ctx.replyWithHTML('✅ Test signal sent to all enabled webhooks.');
      return;
    }

    // Help
    await ctx.replyWithHTML(
      '<b>🔗 Webhook Commands</b>\n\n' +
      '<code>/webhook</code> - List webhooks\n' +
      '<code>/webhook add &lt;url&gt; [name]</code> - Add webhook\n' +
      '<code>/webhook remove &lt;id&gt;</code> - Remove webhook\n' +
      '<code>/webhook test</code> - Send test signal'
    );
  });

  // ═══════════════════════════════════════════
  // CALLBACK HANDLERS
  // ═══════════════════════════════════════════

  // Signal list callbacks
  bot.action('signals_list', async (ctx) => {
    await ctx.answerCbQuery();
    const signals = database.getSignals({ status: 'active', limit: 10 });

    if (signals.length === 0) {
      await ctx.editMessageText(
        '<b>📊 Trading Signals</b>\n\n<i>No active signals.</i>',
        { parse_mode: 'HTML', ...getSignalsListKeyboard() }
      );
      return;
    }

    const message = formatSignalList(signals);
    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      ...getSignalsListKeyboard(),
    });
  });

  bot.action('signals_active', async (ctx) => {
    await ctx.answerCbQuery();
    const signals = database.getSignals({ status: 'active', limit: 10 });
    const message = signals.length > 0
      ? formatSignalList(signals)
      : '<b>📊 Active Signals</b>\n\n<i>No active signals.</i>';

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      ...getSignalsListKeyboard(),
    });
  });

  bot.action('signals_history', async (ctx) => {
    await ctx.answerCbQuery();
    const signals = database.getSignals({ limit: 15 });
    const message = signals.length > 0
      ? formatSignalList(signals, '📜 SIGNAL HISTORY')
      : '<b>📜 Signal History</b>\n\n<i>No signals yet.</i>';

    await ctx.editMessageText(message, { parse_mode: 'HTML' });
  });

  bot.action('signals_perf', async (ctx) => {
    await ctx.answerCbQuery();
    const stats = database.getSignalStats();
    const message = formatSignalPerformance(stats);
    await ctx.editMessageText(message, { parse_mode: 'HTML' });
  });

  bot.action('signals_refresh', async (ctx) => {
    await ctx.answerCbQuery('Refreshed');
    const signals = database.getSignals({ status: 'active', limit: 10 });
    const message = signals.length > 0
      ? formatSignalList(signals)
      : '<b>📊 Trading Signals</b>\n\n<i>No active signals.</i>';

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      ...getSignalsListKeyboard(),
    });
  });

  // Acknowledge signal callback
  bot.action(/^ack_(.+)$/, async (ctx) => {
    const signalId = ctx.match[1];
    database.updateSignalStatus(signalId, 'acknowledged');
    signalService.acknowledgeSignal(signalId);
    await ctx.answerCbQuery('Signal acknowledged');
  });

  // Outcome recording start callback
  bot.action(/^outcome_start_(.+)$/, async (ctx) => {
    const signalId = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.replyWithHTML(
      `<b>📝 Record Outcome</b>\n\n` +
      `Reply with your entry and exit prices:\n` +
      `<code>/outcome ${signalId} &lt;entry&gt; &lt;exit&gt;</code>\n\n` +
      `Example: <code>/outcome ${signalId} 0.00015 0.00025</code>`
    );
  });

  // Webhook callbacks
  bot.action('webhook_refresh', async (ctx) => {
    await ctx.answerCbQuery('Refreshed');
    const webhooks = database.getWebhooks();
    const message = webhooks.length > 0
      ? formatWebhookList(webhooks)
      : '<b>🔗 Webhooks</b>\n\n<i>No webhooks configured.</i>';

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      ...getWebhookListKeyboard(webhooks),
    });
  });

  bot.action(/^webhook_toggle_(\d+)$/, async (ctx) => {
    const webhookId = parseInt(ctx.match[1], 10);
    const webhooks = database.getWebhooks();
    const webhook = webhooks.find(w => w.id === webhookId);

    if (webhook) {
      // Toggle enabled state
      database.saveWebhook({
        ...webhook,
        enabled: !webhook.enabled,
      });
      await ctx.answerCbQuery(webhook.enabled ? 'Webhook disabled' : 'Webhook enabled');
    } else {
      await ctx.answerCbQuery('Webhook not found');
    }

    // Refresh list
    const updatedWebhooks = database.getWebhooks();
    const message = formatWebhookList(updatedWebhooks);
    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      ...getWebhookListKeyboard(updatedWebhooks),
    });
  });

  bot.action(/^webhook_delete_(\d+)$/, async (ctx) => {
    const webhookId = parseInt(ctx.match[1], 10);
    database.deleteWebhook(webhookId);
    await ctx.answerCbQuery('Webhook deleted');

    const webhooks = database.getWebhooks();
    const message = webhooks.length > 0
      ? formatWebhookList(webhooks)
      : '<b>🔗 Webhooks</b>\n\n<i>No webhooks configured.</i>';

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      ...getWebhookListKeyboard(webhooks),
    });
  });

  bot.action('webhook_add_prompt', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.replyWithHTML(
      '<b>➕ Add Webhook</b>\n\n' +
      'Send your Discord webhook URL:\n' +
      '<code>/webhook add &lt;url&gt; [name]</code>\n\n' +
      'Example:\n' +
      '<code>/webhook add https://discord.com/api/webhooks/123/abc Trading Signals</code>'
    );
  });
}
