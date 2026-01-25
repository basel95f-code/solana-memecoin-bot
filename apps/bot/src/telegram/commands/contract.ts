/**
 * Contract Commands
 * Commands for smart contract security analysis
 */

import type { Context, Telegraf } from 'telegraf';
import { contractAnalyzer } from '../../analysis/contractAnalyzer';

export function registerContractCommands(bot: Telegraf): void {
  // /contract command - analyze token contract
  bot.command('contract', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    const mint = args[0];

    if (!mint) {
      await ctx.replyWithHTML(
        '<b>🔐 Contract Security Analysis</b>\n\n' +
        'Analyze a token contract for security issues:\n' +
        '• Honeypot detection\n' +
        '• Hidden mint authority\n' +
        '• Freeze authority\n' +
        '• Scam patterns\n\n' +
        '<b>Usage:</b>\n' +
        '<code>/contract &lt;token_mint&gt;</code>\n\n' +
        '<b>Example:</b>\n' +
        '<code>/contract So11111111111111111111111111111111111111112</code>'
      );
      return;
    }

    await ctx.replyWithHTML('<i>🔍 Analyzing contract security...</i>');

    try {
      const result = await contractAnalyzer.analyzeContract(mint);
      const formatted = contractAnalyzer.formatAnalysis(result);

      // Add mint address
      const message = `<pre>${formatted}</pre>\n\n<code>${mint}</code>`;

      // Color-coded based on safety
      const replyOptions: any = { parse_mode: 'HTML' };
      
      if (result.safetyLevel === 'dangerous') {
        replyOptions.reply_markup = {
          inline_keyboard: [
            [
              { text: '🚨 AVOID THIS TOKEN', callback_data: 'noop' }
            ]
          ]
        };
      } else if (result.safetyLevel === 'caution') {
        replyOptions.reply_markup = {
          inline_keyboard: [
            [
              { text: '⚠️ Trade with Caution', callback_data: 'noop' }
            ]
          ]
        };
      } else {
        replyOptions.reply_markup = {
          inline_keyboard: [
            [
              { text: '✅ Appears Safe', callback_data: 'noop' }
            ]
          ]
        };
      }

      await ctx.replyWithHTML(message, replyOptions);
    } catch (error) {
      const err = error as Error;
      await ctx.replyWithHTML(
        `<b>❌ Analysis Failed</b>\n\n${err.message}\n\n` +
        'Make sure you provided a valid token mint address.'
      );
    }
  });

  // /honeypot command - quick honeypot check
  bot.command('honeypot', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    const mint = args[0];

    if (!mint) {
      await ctx.replyWithHTML(
        '<b>🍯 Quick Honeypot Check</b>\n\n' +
        '<b>Usage:</b> <code>/honeypot &lt;token_mint&gt;</code>\n\n' +
        'Fast check for basic honeypot indicators:\n' +
        '• Active mint authority\n' +
        '• Active freeze authority'
      );
      return;
    }

    await ctx.replyWithHTML('<i>🔍 Checking...</i>');

    try {
      const isHoneypot = await contractAnalyzer.quickHoneypotCheck(mint);

      if (isHoneypot) {
        await ctx.replyWithHTML(
          `<b>🚨 WARNING: Likely Honeypot</b>\n\n` +
          `Token has active mint or freeze authority.\n` +
          `Owner can:\n` +
          `• Create unlimited tokens (mint)\n` +
          `• Freeze your tokens (freeze)\n\n` +
          `<b>Recommendation: AVOID</b>\n\n` +
          `<code>${mint}</code>`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🔍 Full Analysis', callback_data: `contract_full_${mint.slice(0, 20)}` }
                ]
              ]
            }
          }
        );
      } else {
        await ctx.replyWithHTML(
          `<b>✅ Initial Check Passed</b>\n\n` +
          `No obvious honeypot indicators found.\n` +
          `Mint and freeze authorities appear revoked.\n\n` +
          `<i>Note: This is a quick check. Use /contract for full analysis.</i>\n\n` +
          `<code>${mint}</code>`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🔍 Full Analysis', callback_data: `contract_full_${mint.slice(0, 20)}` }
                ]
              ]
            }
          }
        );
      }
    } catch (error) {
      const err = error as Error;
      await ctx.replyWithHTML(`<b>❌ Check Failed</b>\n\n${err.message}`);
    }
  });

  // Noop handler for inline buttons
  bot.action('noop', async (ctx) => {
    await ctx.answerCbQuery();
  });

  // Full analysis callback handler
  bot.action(/^contract_full_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    
    const mintPrefix = ctx.match![1];
    
    await ctx.editMessageText(
      `<i>🔍 Running full analysis...</i>\n\n` +
      `Use <code>/contract ${mintPrefix}...</code> for detailed results.`,
      { parse_mode: 'HTML' }
    );
  });
}
