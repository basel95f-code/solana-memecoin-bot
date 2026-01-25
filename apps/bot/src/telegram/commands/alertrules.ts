/**
 * Alert Rules Commands for Telegram
 * Manage custom alert rules via interactive builder
 */

import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { getAlertSystem } from '../../alerts/AlertSystem';
import type { AlertRule, SimpleCondition, ComparisonOperator } from '../../alerts/RuleEngine';

// ============================================
// Command: /alertrule - Main menu
// ============================================

export function registerAlertRuleCommands(bot: Telegraf): void {
  // Main command - show alert rules menu
  bot.command('alertrule', async (ctx: Context) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const alertSystem = getAlertSystem();
    const userRules = alertSystem.listRules({ userId: chatId });

    let text = '🔔 *Alert Rules Manager*\n\n';
    text += `You have ${userRules.length} custom rules:\n\n`;

    if (userRules.length === 0) {
      text += '_No rules yet. Create your first rule!_\n\n';
      text += '💡 Rules let you get instant alerts when tokens meet your criteria.\n';
      text += 'Examples: High liquidity, price spikes, smart money activity, etc.';
    } else {
      for (const rule of userRules.slice(0, 10)) {
        const status = rule.enabled ? '🟢' : '⚫';
        const priority = getPriorityEmoji(rule.priority);
        text += `${status} ${priority} *${rule.name}*\n`;
        text += `  ID: \`${rule.id}\`\n`;
        text += `  Triggers: ${rule.triggerCount}\n\n`;
      }

      if (userRules.length > 10) {
        text += `_... and ${userRules.length - 10} more_\n`;
      }
    }

    await ctx.replyWithMarkdown(text, getMainMenuKeyboard());
  });

  // Create new rule
  bot.command('alertrule_create', async (ctx: Context) => {
    await showRuleBuilder(ctx);
  });

  // List all rules
  bot.command('alertrule_list', async (ctx: Context) => {
    await listUserRules(ctx);
  });

  // Toggle rule on/off
  bot.command('alertrule_toggle', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithMarkdown(
        '⚠️ Usage: `/alertrule_toggle <rule_id>`\n\n' +
        'Get rule ID from `/alertrule_list`'
      );
      return;
    }

    const ruleId = args[0];
    const alertSystem = getAlertSystem();
    const rule = alertSystem.toggleRule(ruleId);

    if (!rule) {
      await ctx.replyWithMarkdown(`❌ Rule \`${ruleId}\` not found`);
      return;
    }

    const status = rule.enabled ? '🟢 Enabled' : '⚫ Disabled';
    await ctx.replyWithMarkdown(
      `✅ Rule *${rule.name}* is now ${status}`
    );
  });

  // Delete rule
  bot.command('alertrule_delete', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithMarkdown(
        '⚠️ Usage: `/alertrule_delete <rule_id>`\n\n' +
        'Get rule ID from `/alertrule_list`'
      );
      return;
    }

    const ruleId = args[0];
    const alertSystem = getAlertSystem();
    const rule = alertSystem.getRule(ruleId);

    if (!rule) {
      await ctx.replyWithMarkdown(`❌ Rule \`${ruleId}\` not found`);
      return;
    }

    const deleted = alertSystem.deleteRule(ruleId);

    if (deleted) {
      await ctx.replyWithMarkdown(
        `🗑 Deleted rule *${rule.name}*`
      );
    } else {
      await ctx.replyWithMarkdown('❌ Failed to delete rule');
    }
  });

  // Test rule delivery
  bot.command('alertrule_test', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithMarkdown(
        '⚠️ Usage: `/alertrule_test <rule_id>`\n\n' +
        'Get rule ID from `/alertrule_list`'
      );
      return;
    }

    const ruleId = args[0];
    const alertSystem = getAlertSystem();

    await ctx.replyWithMarkdown('🧪 Testing rule delivery...');

    try {
      const result = await alertSystem.testRule(ruleId);

      if (result.dispatched) {
        await ctx.replyWithMarkdown(
          `✅ Test alert sent!\n\n` +
          `Channels: ${result.channels.join(', ')}\n` +
          `Check your configured channels for the test alert.`
        );
      } else {
        await ctx.replyWithMarkdown(
          `❌ Test failed\n\n` +
          `Errors: ${result.errors.map((e: any) => e.error).join(', ')}`
        );
      }
    } catch (error: any) {
      await ctx.replyWithMarkdown(`❌ Error: ${error.message}`);
    }
  });

  // Show rule details
  bot.command('alertrule_info', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithMarkdown(
        '⚠️ Usage: `/alertrule_info <rule_id>`\n\n' +
        'Get rule ID from `/alertrule_list`'
      );
      return;
    }

    const ruleId = args[0];
    const alertSystem = getAlertSystem();
    const rule = alertSystem.getRule(ruleId);

    if (!rule) {
      await ctx.replyWithMarkdown(`❌ Rule \`${ruleId}\` not found`);
      return;
    }

    let text = `📋 *Rule Details*\n\n`;
    text += `*Name:* ${rule.name}\n`;
    text += `*ID:* \`${rule.id}\`\n`;
    text += `*Status:* ${rule.enabled ? '🟢 Enabled' : '⚫ Disabled'}\n`;
    text += `*Priority:* ${getPriorityEmoji(rule.priority)} ${rule.priority}\n\n`;

    if (rule.description) {
      text += `*Description:*\n${rule.description}\n\n`;
    }

    text += `*Channels:* ${rule.channels.join(', ')}\n`;
    text += `*Cooldown:* ${rule.cooldownSeconds}s\n`;
    text += `*Max per hour:* ${rule.maxAlertsPerHour}\n\n`;

    text += `*Stats:*\n`;
    text += `  • Triggered: ${rule.triggerCount} times\n`;
    if (rule.lastTriggeredAt) {
      const lastTriggered = new Date(rule.lastTriggeredAt);
      text += `  • Last: ${lastTriggered.toLocaleString()}\n`;
    }

    text += `\n*Tags:* ${rule.tags.join(', ') || 'none'}\n`;
    text += `\n*Created:* ${new Date(rule.createdAt).toLocaleString()}`;

    await ctx.replyWithMarkdown(text);
  });

  // Callback handlers for interactive buttons
  bot.action('alertrule_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      'Choose an action:',
      getMainMenuKeyboard()
    );
  });
}

// ============================================
// Helper Functions
// ============================================

function getMainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('➕ Create Rule', 'alertrule_create'),
      Markup.button.callback('📋 List Rules', 'alertrule_list'),
    ],
    [
      Markup.button.callback('📊 Statistics', 'alertrule_stats'),
      Markup.button.callback('❓ Help', 'alertrule_help'),
    ],
  ]);
}

function getPriorityEmoji(priority: string): string {
  const emojiMap: Record<string, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    normal: '🟡',
    low: '🟢',
  };
  return emojiMap[priority] || '⚪';
}

async function showRuleBuilder(ctx: Context) {
  let text = '🔧 *Rule Builder*\n\n';
  text += '⚠️ *Interactive rule builder coming soon!*\n\n';
  text += 'For now, create rules via code or use these templates:\n\n';
  text += '1️⃣ *High Liquidity Alert*\n';
  text += '   `/create_high_liquidity <amount>`\n';
  text += '   Example: `/create_high_liquidity 50000`\n\n';
  text += '2️⃣ *Price Spike Alert*\n';
  text += '   `/create_price_spike <percent>`\n';
  text += '   Example: `/create_price_spike 50`\n\n';
  text += '3️⃣ *Smart Money Alert*\n';
  text += '   `/create_smart_money <count>`\n';
  text += '   Example: `/create_smart_money 3`\n\n';
  text += '_Full interactive builder will be added in the next update!_';

  await ctx.replyWithMarkdown(text);
}

async function listUserRules(ctx: Context) {
  const chatId = ctx.chat?.id.toString();
  if (!chatId) return;

  const alertSystem = getAlertSystem();
  const userRules = alertSystem.listRules({ userId: chatId });

  if (userRules.length === 0) {
    await ctx.replyWithMarkdown(
      '📋 *Your Alert Rules*\n\n' +
      '_No rules yet._\n\n' +
      'Create your first rule with `/alertrule_create`'
    );
    return;
  }

  let text = `📋 *Your Alert Rules* (${userRules.length})\n\n`;

  for (const rule of userRules) {
    const status = rule.enabled ? '🟢' : '⚫';
    const priority = getPriorityEmoji(rule.priority);
    
    text += `${status} ${priority} *${rule.name}*\n`;
    text += `   ID: \`${rule.id}\`\n`;
    text += `   Triggers: ${rule.triggerCount}\n`;
    text += `   Actions: `;
    text += `[Toggle](/alertrule_toggle ${rule.id}) | `;
    text += `[Test](/alertrule_test ${rule.id}) | `;
    text += `[Info](/alertrule_info ${rule.id}) | `;
    text += `[Delete](/alertrule_delete ${rule.id})\n\n`;
  }

  text += '\n_Tap actions to manage rules_';

  await ctx.replyWithMarkdown(text, { disable_web_page_preview: true });
}

// ============================================
// Quick Rule Templates
// ============================================

export function registerRuleTemplates(bot: Telegraf): void {
  // High liquidity template
  bot.command('create_high_liquidity', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithMarkdown(
        '⚠️ Usage: `/create_high_liquidity <amount>`\n\n' +
        'Example: `/create_high_liquidity 50000` for $50K minimum'
      );
      return;
    }

    const amount = parseFloat(args[0]);
    if (isNaN(amount) || amount <= 0) {
      await ctx.replyWithMarkdown('❌ Invalid amount. Must be a positive number.');
      return;
    }

    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const alertSystem = getAlertSystem();

    const rule: Omit<AlertRule, 'id' | 'createdAt' | 'triggerCount'> = {
      name: `High Liquidity (>$${amount.toLocaleString()})`,
      description: `Alert when new token has liquidity above $${amount.toLocaleString()}`,
      enabled: true,
      rootCondition: {
        id: 'root',
        type: 'simple',
        field: 'liquidity',
        operator: '>=',
        value: amount,
      } as SimpleCondition,
      priority: 'high',
      channels: ['telegram-default'],
      cooldownSeconds: 300,
      maxAlertsPerHour: 10,
      createdBy: chatId,
      tags: ['discovery', 'liquidity'],
      metadata: { category: 'discovery' },
    };

    const created = alertSystem.createRule(rule);

    await ctx.replyWithMarkdown(
      `✅ Created rule: *${created.name}*\n\n` +
      `ID: \`${created.id}\`\n` +
      `Status: 🟢 Enabled\n\n` +
      `Manage with: /alertrule_info ${created.id}`
    );
  });

  // Price spike template
  bot.command('create_price_spike', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithMarkdown(
        '⚠️ Usage: `/create_price_spike <percent>`\n\n' +
        'Example: `/create_price_spike 50` for 50% increase'
      );
      return;
    }

    const percent = parseFloat(args[0]);
    if (isNaN(percent) || percent <= 0) {
      await ctx.replyWithMarkdown('❌ Invalid percent. Must be a positive number.');
      return;
    }

    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const alertSystem = getAlertSystem();

    const rule: Omit<AlertRule, 'id' | 'createdAt' | 'triggerCount'> = {
      name: `Price Spike (>${percent}% in 15m)`,
      description: `Alert when price increases more than ${percent}% in 15 minutes`,
      enabled: true,
      rootCondition: {
        id: 'root',
        type: 'percent',
        field: 'price',
        operator: 'percent_increase',
        threshold: percent,
        timeframe: '15m',
      },
      priority: 'high',
      channels: ['telegram-default'],
      cooldownSeconds: 600,
      maxAlertsPerHour: 5,
      createdBy: chatId,
      tags: ['price', 'opportunity'],
      metadata: { category: 'opportunity' },
    };

    const created = alertSystem.createRule(rule);

    await ctx.replyWithMarkdown(
      `✅ Created rule: *${created.name}*\n\n` +
      `ID: \`${created.id}\`\n` +
      `Status: 🟢 Enabled\n\n` +
      `Manage with: /alertrule_info ${created.id}`
    );
  });

  // Smart money template
  bot.command('create_smart_money', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithMarkdown(
        '⚠️ Usage: `/create_smart_money <count>`\n\n' +
        'Example: `/create_smart_money 3` for 3+ wallets'
      );
      return;
    }

    const count = parseInt(args[0], 10);
    if (isNaN(count) || count <= 0) {
      await ctx.replyWithMarkdown('❌ Invalid count. Must be a positive number.');
      return;
    }

    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const alertSystem = getAlertSystem();

    const rule: Omit<AlertRule, 'id' | 'createdAt' | 'triggerCount'> = {
      name: `Smart Money (${count}+ wallets buying)`,
      description: `Alert when ${count} or more smart wallets buy the same token`,
      enabled: true,
      rootCondition: {
        id: 'root',
        type: 'simple',
        field: 'smartMoneyBuying',
        operator: '>=',
        value: count,
      } as SimpleCondition,
      priority: 'critical',
      channels: ['telegram-default'],
      cooldownSeconds: 600,
      maxAlertsPerHour: 3,
      createdBy: chatId,
      tags: ['smart_money', 'whale'],
      metadata: { category: 'whale' },
    };

    const created = alertSystem.createRule(rule);

    await ctx.replyWithMarkdown(
      `✅ Created rule: *${created.name}*\n\n` +
      `ID: \`${created.id}\`\n` +
      `Status: 🟢 Enabled\n\n` +
      `Manage with: /alertrule_info ${created.id}`
    );
  });
}
