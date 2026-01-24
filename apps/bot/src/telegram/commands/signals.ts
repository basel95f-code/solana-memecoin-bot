/**
 * Trading Signals Commands
 * Commands for managing trading signals and webhooks
 */

import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { database } from '../../database';
import { signalService, signalPriceMonitor } from '../../signals';
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

  // /monitor command - price monitor status and control
  bot.command('monitor', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand || subcommand === 'status') {
      // Show monitor status
      const stats = signalPriceMonitor.getStats();
      const activeSignals = signalService.getActiveSignals();

      let msg = '<b>📡 Price Monitor Status</b>\n\n';
      msg += `Status: ${stats.isRunning ? '🟢 Running' : '🔴 Stopped'}\n`;
      msg += `Active signals: <b>${stats.activeSignalsCount}</b>\n`;
      msg += `Cached prices: <b>${stats.cachedPricesCount}</b>\n\n`;

      if (activeSignals.length > 0) {
        msg += '<b>Monitored Signals:</b>\n';
        for (const signal of activeSignals.slice(0, 5)) {
          const targetPct = signal.targetPrice
            ? ((signal.targetPrice - signal.entryPrice) / signal.entryPrice * 100).toFixed(1)
            : 'N/A';
          const stopPct = signal.stopLossPrice
            ? ((signal.stopLossPrice - signal.entryPrice) / signal.entryPrice * 100).toFixed(1)
            : 'N/A';
          msg += `• <b>${signal.symbol}</b> ${signal.type}\n`;
          msg += `  Entry: $${signal.entryPrice.toFixed(8)}\n`;
          msg += `  TP: +${targetPct}% | SL: ${stopPct}%\n`;
        }
        if (activeSignals.length > 5) {
          msg += `<i>...and ${activeSignals.length - 5} more</i>\n`;
        }
      } else {
        msg += '<i>No active signals being monitored.</i>\n';
      }

      msg += '\n<b>Commands:</b>\n';
      msg += '<code>/monitor check</code> - Force price check\n';
      msg += '<code>/monitor start</code> - Start monitoring\n';
      msg += '<code>/monitor stop</code> - Stop monitoring';

      await ctx.replyWithHTML(msg);
      return;
    }

    if (subcommand === 'check') {
      // Force a price check
      await ctx.replyWithHTML('⏳ Checking prices for active signals...');

      try {
        await signalPriceMonitor.forceCheck();
        await ctx.replyWithHTML('✅ Price check completed.');
      } catch (error) {
        await ctx.replyWithHTML(`❌ Price check failed: ${(error as Error).message}`);
      }
      return;
    }

    if (subcommand === 'start') {
      signalPriceMonitor.start();
      await ctx.replyWithHTML('🟢 Price monitor started.');
      return;
    }

    if (subcommand === 'stop') {
      signalPriceMonitor.stop();
      await ctx.replyWithHTML('🔴 Price monitor stopped.');
      return;
    }

    // Unknown subcommand
    await ctx.replyWithHTML(
      '<b>📡 Monitor Commands</b>\n\n' +
      '<code>/monitor</code> - Show status\n' +
      '<code>/monitor check</code> - Force price check\n' +
      '<code>/monitor start</code> - Start monitoring\n' +
      '<code>/monitor stop</code> - Stop monitoring'
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

  // ═══════════════════════════════════════════
  // KELLY CRITERION COMMANDS
  // ═══════════════════════════════════════════

  // /slack command - Slack webhook management
  bot.command('slack', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand || subcommand === 'list') {
      // List Slack webhooks
      const webhooks = signalService.getSlackWebhooks();

      if (webhooks.length === 0) {
        await ctx.replyWithHTML(
          '<b>💬 Slack Webhooks</b>\n\n' +
          '<i>No Slack webhooks configured.</i>\n\n' +
          'Add a Slack webhook to receive signals:\n' +
          '<code>/slack add &lt;webhook_url&gt; [name]</code>\n\n' +
          'Get your webhook URL from:\n' +
          '• Slack App Settings → Incoming Webhooks'
        );
        return;
      }

      let msg = '<b>💬 Slack Webhooks</b>\n\n';
      for (const webhook of webhooks) {
        const status = webhook.enabled ? '🟢' : '🔴';
        msg += `${status} <b>${webhook.name}</b> (ID: ${webhook.id})\n`;
        msg += `   Events: ${webhook.events.join(', ')}\n`;
        msg += `   Min confidence: ${webhook.minConfidence}%\n`;
        msg += `   Sent: ${webhook.totalSent} | Failed: ${webhook.failureCount}\n\n`;
      }

      msg += '<b>Commands:</b>\n';
      msg += '<code>/slack add &lt;url&gt; [name]</code>\n';
      msg += '<code>/slack remove &lt;id&gt;</code>\n';
      msg += '<code>/slack toggle &lt;id&gt;</code>\n';
      msg += '<code>/slack test</code>';

      await ctx.replyWithHTML(msg);
      return;
    }

    if (subcommand === 'add') {
      const url = args[1];
      const name = args.slice(2).join(' ') || 'Slack Webhook';

      if (!url) {
        await ctx.replyWithHTML(
          '<b>➕ Add Slack Webhook</b>\n\n' +
          'Usage: <code>/slack add &lt;url&gt; [name]</code>\n\n' +
          'Example:\n' +
          '<code>/slack add https://hooks.slack.com/services/T00/B00/xxx Trading Alerts</code>'
        );
        return;
      }

      // Validate URL format
      if (!url.startsWith('https://hooks.slack.com/')) {
        await ctx.replyWithHTML(
          '❌ Invalid Slack webhook URL.\n\n' +
          'Please provide a valid Slack incoming webhook URL.\n' +
          'It should start with: https://hooks.slack.com/'
        );
        return;
      }

      try {
        const allEvents: SignalType[] = ['BUY', 'SELL', 'TAKE_PROFIT', 'STOP_LOSS'];
        const webhook = signalService.addSlackWebhook({
          url,
          name,
          enabled: true,
          events: allEvents,
          minConfidence: 60,
        });

        await ctx.replyWithHTML(
          `✅ Slack webhook added!\n\n` +
          `Name: <b>${name}</b>\n` +
          `ID: <b>${webhook.id}</b>\n` +
          `Events: BUY, SELL, TAKE_PROFIT, STOP_LOSS\n` +
          `Min confidence: 60%\n\n` +
          `Use <code>/slack list</code> to view all Slack webhooks.`
        );
      } catch (error) {
        await ctx.replyWithHTML(
          `❌ Failed to add Slack webhook.\n\n` +
          `Error: ${(error as Error).message}`
        );
      }
      return;
    }

    if (subcommand === 'remove' || subcommand === 'delete') {
      const id = parseInt(args[1], 10);

      if (isNaN(id)) {
        await ctx.replyWithHTML(
          '<b>🗑 Remove Slack Webhook</b>\n\n' +
          'Usage: <code>/slack remove &lt;id&gt;</code>\n\n' +
          'Use <code>/slack list</code> to see webhook IDs.'
        );
        return;
      }

      const removed = signalService.removeSlackWebhook(id);
      if (removed) {
        await ctx.replyWithHTML(`✅ Slack webhook removed.`);
      } else {
        await ctx.replyWithHTML(`❌ Webhook not found: ${id}`);
      }
      return;
    }

    if (subcommand === 'toggle') {
      const id = parseInt(args[1], 10);

      if (isNaN(id)) {
        await ctx.replyWithHTML(
          'Usage: <code>/slack toggle &lt;id&gt;</code>'
        );
        return;
      }

      const webhook = signalService.getSlackWebhook(id);
      if (!webhook) {
        await ctx.replyWithHTML(`❌ Webhook not found: ${id}`);
        return;
      }

      signalService.updateSlackWebhook(id, { enabled: !webhook.enabled });
      const status = !webhook.enabled ? 'enabled' : 'disabled';
      await ctx.replyWithHTML(`✅ Slack webhook <b>${webhook.name}</b> ${status}.`);
      return;
    }

    if (subcommand === 'test') {
      const webhooks = signalService.getSlackWebhooks();
      const enabledWebhooks = webhooks.filter(w => w.enabled);

      if (enabledWebhooks.length === 0) {
        await ctx.replyWithHTML('No enabled Slack webhooks to test.');
        return;
      }

      await ctx.replyWithHTML(`Testing ${enabledWebhooks.length} Slack webhook(s)...`);

      // Send test signal
      const testSignal: TradingSignal = {
        id: 'slack-test-' + Date.now(),
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
        reasons: ['Test signal from Telegram', 'Good metrics'],
        warnings: ['This is a test signal'],
        status: 'active',
        generatedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };

      await signalService.dispatchToWebhooks(testSignal);
      await ctx.replyWithHTML('✅ Test signal sent to all enabled Slack webhooks.');
      return;
    }

    // Help
    await ctx.replyWithHTML(
      '<b>💬 Slack Webhook Commands</b>\n\n' +
      '<code>/slack</code> - List webhooks\n' +
      '<code>/slack add &lt;url&gt; [name]</code> - Add webhook\n' +
      '<code>/slack remove &lt;id&gt;</code> - Remove webhook\n' +
      '<code>/slack toggle &lt;id&gt;</code> - Enable/disable\n' +
      '<code>/slack test</code> - Send test signal'
    );
  });

  // /correlation command - Signal correlation analysis
  bot.command('correlation', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand || subcommand === 'status') {
      // Show correlation status
      const config = signalService.getCorrelationConfig();
      const summary = signalService.getCorrelationSummary();

      let msg = '<b>🔗 Signal Correlation Analysis</b>\n\n';

      if (!config.enabled) {
        msg += '⚪ <b>Status:</b> Disabled\n\n';
        msg += '<i>Correlation analysis detects when signals are too similar, ';
        msg += 'helping you avoid concentration risk.</i>\n\n';
        msg += 'Enable with: <code>/correlation enable</code>';
      } else {
        msg += '🟢 <b>Status:</b> Enabled\n\n';

        // Configuration
        msg += `<b>Configuration:</b>\n`;
        msg += `• Correlation threshold: <b>${(config.correlationThreshold * 100).toFixed(0)}%</b>\n`;
        msg += `• Max correlated signals: <b>${config.maxCorrelatedSignals === 0 ? 'Unlimited' : config.maxCorrelatedSignals}</b>\n\n`;

        // Summary
        msg += `<b>Current Portfolio:</b>\n`;
        msg += `• Active signals: <b>${summary.totalSignals}</b>\n`;
        msg += `• High correlation pairs: <b>${summary.correlationPairs}</b>\n`;
        msg += `• Diversification score: <b>${summary.diversificationScore}/100</b>\n`;

        // List high correlation pairs
        if (summary.highCorrelationPairs.length > 0) {
          msg += '\n<b>⚠️ Correlated Pairs:</b>\n';
          for (const pair of summary.highCorrelationPairs.slice(0, 5)) {
            msg += `• ${pair.signalA} ↔ ${pair.signalB}: ${(pair.correlation * 100).toFixed(0)}%\n`;
          }
          if (summary.highCorrelationPairs.length > 5) {
            msg += `<i>...and ${summary.highCorrelationPairs.length - 5} more</i>\n`;
          }
        }
      }

      msg += '\n<b>Commands:</b>\n';
      msg += '<code>/correlation enable</code> - Enable\n';
      msg += '<code>/correlation disable</code> - Disable\n';
      msg += '<code>/correlation threshold 0.7</code> - Set threshold';

      await ctx.replyWithHTML(msg);
      return;
    }

    if (subcommand === 'enable') {
      signalService.updateCorrelationConfig({ enabled: true });
      await ctx.replyWithHTML(
        '✅ <b>Correlation analysis enabled</b>\n\n' +
        'New signals will be checked for correlation with existing active signals.\n\n' +
        '<i>Highly correlated signals will show warnings, and if too many ' +
        'are detected, new signals may be blocked.</i>'
      );
      return;
    }

    if (subcommand === 'disable') {
      signalService.updateCorrelationConfig({ enabled: false });
      await ctx.replyWithHTML(
        '⚪ <b>Correlation analysis disabled</b>\n\n' +
        'Signals will be generated without correlation checks.'
      );
      return;
    }

    if (subcommand === 'threshold') {
      const value = parseFloat(args[1]);

      if (isNaN(value) || value < 0.3 || value > 1) {
        await ctx.replyWithHTML(
          '<b>⚙️ Set Correlation Threshold</b>\n\n' +
          'Usage: <code>/correlation threshold &lt;value&gt;</code>\n\n' +
          'Value must be between 0.3 and 1.0:\n' +
          '• <code>0.5</code> - Very strict (many warnings)\n' +
          '• <code>0.7</code> - Balanced (recommended)\n' +
          '• <code>0.85</code> - Lenient (only strong correlations)'
        );
        return;
      }

      signalService.updateCorrelationConfig({ correlationThreshold: value });
      await ctx.replyWithHTML(
        `✅ <b>Correlation threshold set to ${(value * 100).toFixed(0)}%</b>\n\n` +
        `Signals with correlation above ${(value * 100).toFixed(0)}% will be flagged.`
      );
      return;
    }

    if (subcommand === 'max' || subcommand === 'maxsignals') {
      const value = parseInt(args[1], 10);

      if (isNaN(value) || value < 0 || value > 10) {
        await ctx.replyWithHTML(
          '<b>⚙️ Set Max Correlated Signals</b>\n\n' +
          'Usage: <code>/correlation max &lt;count&gt;</code>\n\n' +
          'Value must be between 0 and 10.\n' +
          'Set to 0 to only warn (never block).'
        );
        return;
      }

      signalService.updateCorrelationConfig({ maxCorrelatedSignals: value });
      const blocking = value > 0
        ? `New signals will be blocked after ${value} correlated signals.`
        : 'Correlation will only add warnings, never block signals.';
      await ctx.replyWithHTML(
        `✅ <b>Max correlated signals set to ${value}</b>\n\n${blocking}`
      );
      return;
    }

    // Unknown subcommand
    await ctx.replyWithHTML(
      '<b>🔗 Correlation Commands</b>\n\n' +
      '<code>/correlation</code> - Show status\n' +
      '<code>/correlation enable</code> - Enable\n' +
      '<code>/correlation disable</code> - Disable\n' +
      '<code>/correlation threshold &lt;0.3-1&gt;</code> - Set threshold\n' +
      '<code>/correlation max &lt;0-10&gt;</code> - Set max correlated'
    );
  });

  // /kelly command - Kelly criterion position sizing
  bot.command('kelly', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand || subcommand === 'status') {
      // Show Kelly status
      const config = signalService.getKellyConfig();
      const metrics = signalService.getKellyMetrics();

      let msg = '<b>📊 Kelly Criterion Position Sizing</b>\n\n';

      if (!config.enabled) {
        msg += '⚪ <b>Status:</b> Disabled\n\n';
        msg += '<i>Kelly criterion uses historical win rate and win/loss ratio ';
        msg += 'to calculate optimal position sizes.</i>\n\n';
        msg += 'Enable with: <code>/kelly enable</code>';
      } else {
        msg += '🟢 <b>Status:</b> Enabled\n\n';

        // Configuration
        const fractionName =
          config.fraction >= 1
            ? 'Full Kelly'
            : config.fraction >= 0.5
              ? 'Half Kelly'
              : config.fraction >= 0.25
                ? 'Quarter Kelly'
                : `${(config.fraction * 100).toFixed(0)}% Kelly`;

        msg += `<b>Configuration:</b>\n`;
        msg += `• Mode: <b>${fractionName}</b> (${(config.fraction * 100).toFixed(0)}%)\n`;
        msg += `• Min trades required: <b>${config.minTradesRequired}</b>\n`;
        msg += `• Lookback window: <b>${config.lookbackTrades}</b> trades\n`;
        msg += `• Position limits: <b>${config.minPositionPercent}%-${config.maxPositionPercent}%</b>\n`;
        msg += `• Confidence adjustment: <b>${config.useConfidenceAdjustment ? 'Yes' : 'No'}</b>\n\n`;

        // Metrics
        if (metrics.tradeCount > 0) {
          msg += `<b>Current Metrics:</b>\n`;
          msg += `• Trade count: <b>${metrics.tradeCount}</b>\n`;
          msg += `• Win rate: <b>${(metrics.winRate * 100).toFixed(1)}%</b>\n`;
          msg += `• Win/Loss ratio: <b>${metrics.winLossRatio.toFixed(2)}</b>\n`;
          msg += `• Suggested position: <b>${metrics.suggestedPosition.toFixed(1)}%</b>\n`;
        } else if (metrics.fallbackReason) {
          msg += `<b>⚠️ Note:</b> ${metrics.fallbackReason}\n`;
          msg += '<i>Using default position sizing until more data is available.</i>\n';
        }
      }

      msg += '\n<b>Commands:</b>\n';
      msg += '<code>/kelly enable</code> - Enable Kelly\n';
      msg += '<code>/kelly disable</code> - Disable Kelly\n';
      msg += '<code>/kelly fraction 0.25</code> - Set fraction\n';
      msg += '<code>/kelly config</code> - Full configuration';

      await ctx.replyWithHTML(msg);
      return;
    }

    if (subcommand === 'enable') {
      signalService.updateKellyConfig({ enabled: true });
      await ctx.replyWithHTML(
        '✅ <b>Kelly criterion enabled</b>\n\n' +
        'Position sizes will now be calculated based on your historical trading performance.\n\n' +
        '<i>Note: Kelly requires at least 20 recorded trade outcomes to calculate positions. ' +
        'Until then, default position sizing will be used.</i>'
      );
      return;
    }

    if (subcommand === 'disable') {
      signalService.updateKellyConfig({ enabled: false });
      await ctx.replyWithHTML(
        '⚪ <b>Kelly criterion disabled</b>\n\n' +
        'Position sizes will use the default calculation method.'
      );
      return;
    }

    if (subcommand === 'fraction' || subcommand === 'frac') {
      const value = parseFloat(args[1]);

      if (isNaN(value) || value <= 0 || value > 1) {
        await ctx.replyWithHTML(
          '<b>⚙️ Set Kelly Fraction</b>\n\n' +
          'Usage: <code>/kelly fraction &lt;value&gt;</code>\n\n' +
          'Common values:\n' +
          '• <code>1.0</code> - Full Kelly (aggressive)\n' +
          '• <code>0.5</code> - Half Kelly (moderate)\n' +
          '• <code>0.25</code> - Quarter Kelly (conservative, recommended)\n' +
          '• <code>0.1</code> - 10% Kelly (very conservative)\n\n' +
          '<i>Lower fractions reduce volatility but also reduce expected returns.</i>'
        );
        return;
      }

      signalService.updateKellyConfig({ fraction: value });

      const fractionName =
        value >= 1
          ? 'Full Kelly'
          : value >= 0.5
            ? 'Half Kelly'
            : value >= 0.25
              ? 'Quarter Kelly'
              : `${(value * 100).toFixed(0)}% Kelly`;

      await ctx.replyWithHTML(
        `✅ <b>Kelly fraction set to ${(value * 100).toFixed(0)}%</b>\n\n` +
        `Mode: <b>${fractionName}</b>\n\n` +
        `<i>This affects how aggressively Kelly criterion sizes positions.</i>`
      );
      return;
    }

    if (subcommand === 'config') {
      const config = signalService.getKellyConfig();

      let msg = '<b>⚙️ Full Kelly Configuration</b>\n\n';
      msg += `Status: <b>${config.enabled ? 'Enabled' : 'Disabled'}</b>\n`;
      msg += `Fraction: <b>${(config.fraction * 100).toFixed(0)}%</b>\n`;
      msg += `Min trades: <b>${config.minTradesRequired}</b>\n`;
      msg += `Lookback trades: <b>${config.lookbackTrades}</b>\n`;
      msg += `Max position: <b>${config.maxPositionPercent}%</b>\n`;
      msg += `Min position: <b>${config.minPositionPercent}%</b>\n`;
      msg += `Min win rate: <b>${(config.minWinRate * 100).toFixed(0)}%</b>\n`;
      msg += `Confidence adjustment: <b>${config.useConfidenceAdjustment ? 'Yes' : 'No'}</b>\n\n`;

      msg += '<b>Configuration commands:</b>\n';
      msg += '<code>/kelly fraction 0.25</code>\n';
      msg += '<code>/kelly mintrades 30</code>\n';
      msg += '<code>/kelly maxpos 20</code>\n';

      await ctx.replyWithHTML(msg);
      return;
    }

    if (subcommand === 'mintrades') {
      const value = parseInt(args[1], 10);

      if (isNaN(value) || value < 5 || value > 100) {
        await ctx.replyWithHTML(
          'Usage: <code>/kelly mintrades &lt;count&gt;</code>\n\n' +
          'Value must be between 5 and 100.'
        );
        return;
      }

      signalService.updateKellyConfig({ minTradesRequired: value });
      await ctx.replyWithHTML(`✅ Minimum trades set to <b>${value}</b>`);
      return;
    }

    if (subcommand === 'maxpos') {
      const value = parseFloat(args[1]);

      if (isNaN(value) || value < 1 || value > 50) {
        await ctx.replyWithHTML(
          'Usage: <code>/kelly maxpos &lt;percent&gt;</code>\n\n' +
          'Value must be between 1 and 50.'
        );
        return;
      }

      signalService.updateKellyConfig({ maxPositionPercent: value });
      await ctx.replyWithHTML(`✅ Maximum position set to <b>${value}%</b>`);
      return;
    }

    // Unknown subcommand - show help
    await ctx.replyWithHTML(
      '<b>📊 Kelly Criterion Commands</b>\n\n' +
      '<code>/kelly</code> - Show status\n' +
      '<code>/kelly enable</code> - Enable Kelly\n' +
      '<code>/kelly disable</code> - Disable Kelly\n' +
      '<code>/kelly fraction &lt;0-1&gt;</code> - Set fraction\n' +
      '<code>/kelly config</code> - View full config\n' +
      '<code>/kelly mintrades &lt;n&gt;</code> - Set min trades\n' +
      '<code>/kelly maxpos &lt;%&gt;</code> - Set max position'
    );
  });
}
