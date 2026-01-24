/**
 * Alert Rules Commands
 * Commands for managing custom alert rules
 */

import type { Context, Telegraf } from 'telegraf';
import { alertRulesEngine, RULE_FIELDS } from '../../services/alertRules';
import type { ComparisonOperator, RuleAction } from '../../services/alertRules';

// ═══════════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════════

export function registerRulesCommands(bot: Telegraf): void {
  // /rules command - manage alert rules
  bot.command('rules', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    const subcommand = args[0]?.toLowerCase();
    const chatId = ctx.chat?.id?.toString();

    if (!subcommand || subcommand === 'list') {
      // List rules
      const rules = alertRulesEngine.getRules(chatId);

      if (rules.length === 0) {
        await ctx.replyWithHTML(
          '<b>📋 Alert Rules</b>\n\n' +
          '<i>No custom alert rules configured.</i>\n\n' +
          'Alert rules let you create custom conditions that trigger alerts or block signals.\n\n' +
          '<b>Quick start:</b>\n' +
          '<code>/rules preset high_liquidity</code> - Alert on >$100k liquidity\n' +
          '<code>/rules preset whale_alert</code> - Alert on whale concentration\n' +
          '<code>/rules preset rug_risk</code> - Block high rug risk tokens\n\n' +
          'Or create custom rules with:\n' +
          '<code>/rules create</code>'
        );
        return;
      }

      let msg = '<b>📋 Alert Rules</b>\n\n';
      for (const rule of rules) {
        const status = rule.enabled ? '🟢' : '🔴';
        const actionEmoji = {
          alert: '🔔',
          block: '🚫',
          boost: '⬆️',
          tag: '🏷️',
        }[rule.action];

        msg += `${status} <b>${rule.name}</b>\n`;
        msg += `   ${actionEmoji} Action: ${rule.action}\n`;
        msg += `   📊 Triggered: ${rule.triggeredCount} times\n`;
        msg += `   🆔 ID: <code>${rule.id.slice(0, 8)}</code>\n\n`;
      }

      msg += '<b>Commands:</b>\n';
      msg += '<code>/rules view &lt;id&gt;</code> - View rule details\n';
      msg += '<code>/rules toggle &lt;id&gt;</code> - Enable/disable\n';
      msg += '<code>/rules delete &lt;id&gt;</code> - Delete rule\n';
      msg += '<code>/rules create</code> - Create new rule\n';
      msg += '<code>/rules fields</code> - Available fields';

      await ctx.replyWithHTML(msg);
      return;
    }

    if (subcommand === 'preset') {
      const presetName = args[1]?.toLowerCase();
      const validPresets = ['high_liquidity', 'whale_alert', 'rug_risk', 'pump_detector'];

      if (!presetName || !validPresets.includes(presetName)) {
        await ctx.replyWithHTML(
          '<b>🎯 Preset Rules</b>\n\n' +
          '<code>/rules preset high_liquidity</code>\n' +
          '   Alert when token has >$100k liquidity\n\n' +
          '<code>/rules preset whale_alert</code>\n' +
          '   Alert when top 10 holders own >70%\n\n' +
          '<code>/rules preset rug_risk</code>\n' +
          '   Block tokens with high rug risk\n\n' +
          '<code>/rules preset pump_detector</code>\n' +
          '   Alert on potential pumps (+50% 1h)'
        );
        return;
      }

      try {
        const rule = alertRulesEngine.createPresetRule(presetName as any, chatId);
        await ctx.replyWithHTML(
          `✅ <b>Preset rule created!</b>\n\n` +
          `Name: <b>${rule.name}</b>\n` +
          `Action: ${rule.action}\n` +
          `ID: <code>${rule.id.slice(0, 8)}</code>\n\n` +
          `Use <code>/rules view ${rule.id.slice(0, 8)}</code> to see details.`
        );
      } catch (error) {
        await ctx.replyWithHTML(`❌ Error: ${(error as Error).message}`);
      }
      return;
    }

    if (subcommand === 'view') {
      const ruleId = args[1];

      if (!ruleId) {
        await ctx.replyWithHTML('Usage: <code>/rules view &lt;id&gt;</code>');
        return;
      }

      // Find rule by partial ID
      const rules = alertRulesEngine.getRules(chatId);
      const rule = rules.find(r => r.id.startsWith(ruleId));

      if (!rule) {
        await ctx.replyWithHTML(`❌ Rule not found: ${ruleId}`);
        return;
      }

      let msg = `<b>📋 Rule: ${rule.name}</b>\n\n`;
      msg += `Status: ${rule.enabled ? '🟢 Enabled' : '🔴 Disabled'}\n`;
      msg += `Action: <b>${rule.action}</b>\n`;
      if (rule.description) {
        msg += `Description: ${rule.description}\n`;
      }
      msg += `\n<b>Conditions</b> (${rule.logicalOperator}):\n`;

      for (const cond of rule.conditions) {
        msg += `• <code>${cond.field}</code> ${cond.operator} <code>${cond.value}</code>\n`;
      }

      if (rule.actionConfig.message) {
        msg += `\n<b>Alert message:</b> ${rule.actionConfig.message}\n`;
      }

      msg += `\n<b>Stats:</b>\n`;
      msg += `• Triggered: ${rule.triggeredCount} times\n`;
      if (rule.lastTriggeredAt) {
        msg += `• Last triggered: ${new Date(rule.lastTriggeredAt).toLocaleString()}\n`;
      }
      msg += `• Created: ${new Date(rule.createdAt).toLocaleDateString()}\n`;

      await ctx.replyWithHTML(msg);
      return;
    }

    if (subcommand === 'toggle') {
      const ruleId = args[1];

      if (!ruleId) {
        await ctx.replyWithHTML('Usage: <code>/rules toggle &lt;id&gt;</code>');
        return;
      }

      const rules = alertRulesEngine.getRules(chatId);
      const rule = rules.find(r => r.id.startsWith(ruleId));

      if (!rule) {
        await ctx.replyWithHTML(`❌ Rule not found: ${ruleId}`);
        return;
      }

      alertRulesEngine.updateRule(rule.id, { enabled: !rule.enabled });
      const status = !rule.enabled ? 'enabled' : 'disabled';
      await ctx.replyWithHTML(`✅ Rule <b>${rule.name}</b> ${status}.`);
      return;
    }

    if (subcommand === 'delete') {
      const ruleId = args[1];

      if (!ruleId) {
        await ctx.replyWithHTML('Usage: <code>/rules delete &lt;id&gt;</code>');
        return;
      }

      const rules = alertRulesEngine.getRules(chatId);
      const rule = rules.find(r => r.id.startsWith(ruleId));

      if (!rule) {
        await ctx.replyWithHTML(`❌ Rule not found: ${ruleId}`);
        return;
      }

      alertRulesEngine.deleteRule(rule.id);
      await ctx.replyWithHTML(`✅ Rule <b>${rule.name}</b> deleted.`);
      return;
    }

    if (subcommand === 'fields') {
      let msg = '<b>📊 Available Rule Fields</b>\n\n';

      const categories: Record<string, string[]> = {
        'Liquidity': ['liquidity.totalLiquidityUsd', 'liquidity.lpBurnedPercent'],
        'Risk': ['risk.score'],
        'Holders': ['holders.totalHolders', 'holders.top10HoldersPercent'],
        'Contract': ['contract.mintAuthorityRevoked', 'contract.freezeAuthorityRevoked'],
        'Token': ['token.symbol', 'token.name'],
        'Social': ['social.hasTwitter', 'social.hasTelegram', 'social.hasWebsite'],
        'Price': ['price.priceUsd', 'price.priceChange1h', 'price.priceChange24h', 'price.volume24h'],
      };

      for (const [category, fields] of Object.entries(categories)) {
        msg += `<b>${category}:</b>\n`;
        for (const field of fields) {
          const info = RULE_FIELDS[field as keyof typeof RULE_FIELDS];
          msg += `• <code>${field}</code>\n  ${info.description} (${info.type})\n`;
        }
        msg += '\n';
      }

      msg += '<b>Operators:</b>\n';
      msg += '• <code>&gt;</code> <code>&lt;</code> <code>&gt;=</code> <code>&lt;=</code> <code>==</code> <code>!=</code>\n';
      msg += '• <code>contains</code> <code>not_contains</code> (for text)';

      await ctx.replyWithHTML(msg);
      return;
    }

    if (subcommand === 'create') {
      // Guide user through rule creation
      await ctx.replyWithHTML(
        '<b>📝 Create Alert Rule</b>\n\n' +
        'To create a rule, use the following format:\n\n' +
        '<code>/rules new &lt;name&gt; | &lt;field&gt; &lt;op&gt; &lt;value&gt; | &lt;action&gt;</code>\n\n' +
        '<b>Examples:</b>\n' +
        '<code>/rules new High Liq | liquidity.totalLiquidityUsd &gt;= 50000 | alert</code>\n\n' +
        '<code>/rules new Whale Warn | holders.top10HoldersPercent &gt;= 80 | alert</code>\n\n' +
        '<code>/rules new Low Risk Block | risk.score &lt; 20 | block</code>\n\n' +
        '<b>Actions:</b> alert, block, boost, tag\n\n' +
        'Use <code>/rules fields</code> to see available fields.'
      );
      return;
    }

    if (subcommand === 'new') {
      // Parse rule from arguments
      // Format: /rules new Name | field op value | action
      const fullArgs = text.split(' ').slice(2).join(' ');
      const parts = fullArgs.split('|').map(p => p.trim());

      if (parts.length < 3) {
        await ctx.replyWithHTML(
          '❌ Invalid format.\n\n' +
          'Use: <code>/rules new Name | field op value | action</code>\n\n' +
          'Example: <code>/rules new High Liq | liquidity.totalLiquidityUsd >= 50000 | alert</code>'
        );
        return;
      }

      const [name, conditionStr, action] = parts;

      // Parse condition
      const condMatch = conditionStr.match(/^(\S+)\s*(>=|<=|>|<|==|!=|contains|not_contains)\s*(.+)$/);
      if (!condMatch) {
        await ctx.replyWithHTML(
          '❌ Invalid condition format.\n\n' +
          'Use: <code>field operator value</code>\n' +
          'Example: <code>liquidity.totalLiquidityUsd >= 50000</code>'
        );
        return;
      }

      const [, field, operator, valueStr] = condMatch;

      // Validate field
      if (!(field in RULE_FIELDS)) {
        await ctx.replyWithHTML(
          `❌ Invalid field: ${field}\n\n` +
          'Use <code>/rules fields</code> to see available fields.'
        );
        return;
      }

      // Parse value
      let value: number | string | boolean = valueStr;
      if (valueStr === 'true') value = true;
      else if (valueStr === 'false') value = false;
      else if (!isNaN(Number(valueStr))) value = Number(valueStr);

      // Validate action
      const validActions = ['alert', 'block', 'boost', 'tag'];
      if (!validActions.includes(action)) {
        await ctx.replyWithHTML(
          `❌ Invalid action: ${action}\n\n` +
          'Valid actions: alert, block, boost, tag'
        );
        return;
      }

      try {
        const rule = alertRulesEngine.createRule(
          name,
          [{ field, operator: operator as ComparisonOperator, value }],
          action as RuleAction,
          { chatId }
        );

        await ctx.replyWithHTML(
          `✅ <b>Rule created!</b>\n\n` +
          `Name: <b>${rule.name}</b>\n` +
          `Condition: <code>${field} ${operator} ${value}</code>\n` +
          `Action: ${action}\n` +
          `ID: <code>${rule.id.slice(0, 8)}</code>`
        );
      } catch (error) {
        await ctx.replyWithHTML(`❌ Error: ${(error as Error).message}`);
      }
      return;
    }

    // Help
    await ctx.replyWithHTML(
      '<b>📋 Alert Rules Commands</b>\n\n' +
      '<code>/rules</code> - List your rules\n' +
      '<code>/rules preset &lt;name&gt;</code> - Use preset rule\n' +
      '<code>/rules create</code> - Create custom rule\n' +
      '<code>/rules view &lt;id&gt;</code> - View rule details\n' +
      '<code>/rules toggle &lt;id&gt;</code> - Enable/disable\n' +
      '<code>/rules delete &lt;id&gt;</code> - Delete rule\n' +
      '<code>/rules fields</code> - Available fields'
    );
  });
}
