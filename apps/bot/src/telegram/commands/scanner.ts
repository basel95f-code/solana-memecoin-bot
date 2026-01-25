/**
 * Scanner Commands
 * Commands for token scanner and filter management
 */

import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { tokenScanner } from '../../services/tokenScanner';

export function registerScannerCommands(bot: Telegraf): void {
  // /scanner command - main scanner interface
  bot.command('scanner', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand || subcommand === 'status') {
      // Show scanner status
      const stats = tokenScanner.getStats();
      const filters = tokenScanner.getActiveFilters();

      let message = `<b>🔍 Token Scanner</b>\n\n`;
      message += `<b>Status:</b> ${filters.length > 0 ? '🟢 Active' : '⚪ Idle'}\n`;
      message += `<b>Active Filters:</b> ${filters.length}\n`;
      message += `<b>Total Scanned:</b> ${stats.totalScanned.toLocaleString()}\n`;
      message += `<b>Matches Found:</b> ${stats.totalMatches}\n\n`;

      if (stats.lastScanTime > 0) {
        const timeSince = Math.floor((Date.now() - stats.lastScanTime) / 1000 / 60);
        message += `<b>Last Scan:</b> ${timeSince}m ago\n\n`;
      }

      if (Object.keys(stats.matchesByFilter).length > 0) {
        message += `<b>Matches by Filter:</b>\n`;
        for (const [filterName, count] of Object.entries(stats.matchesByFilter)) {
          message += `  • ${filterName}: ${count}\n`;
        }
      }

      await ctx.replyWithHTML(message, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📋 Filters', callback_data: 'scan_filters' },
              { text: '🎯 Matches', callback_data: 'scan_matches' }
            ],
            [
              { text: '🔄 Refresh', callback_data: 'scan_refresh' }
            ]
          ]
        }
      });
      return;
    }

    if (subcommand === 'filters') {
      // List all filters
      const filters = tokenScanner.getAllFilters();

      if (filters.length === 0) {
        await ctx.replyWithHTML(
          '<i>No filters configured</i>\n\n' +
          'Use <code>/scanner preset</code> to create preset filters.'
        );
        return;
      }

      let message = `<b>📋 Scanner Filters (${filters.length})</b>\n\n`;

      for (const filter of filters) {
        const status = filter.enabled ? '🟢' : '⚪';
        message += `${status} <b>${filter.name}</b>\n`;
        message += `  ${filter.description}\n`;
        
        // Show key criteria
        const criteria: string[] = [];
        if (filter.minRiskScore) criteria.push(`Risk ${filter.minRiskScore}+`);
        if (filter.minLiquidity) criteria.push(`Liq $${(filter.minLiquidity / 1000).toFixed(0)}k+`);
        if (filter.minHolders) criteria.push(`${filter.minHolders}+ holders`);
        if (filter.maxRugProbability) criteria.push(`<${(filter.maxRugProbability * 100).toFixed(0)}% rug`);
        
        if (criteria.length > 0) {
          message += `  <i>${criteria.join(', ')}</i>\n`;
        }
        message += `\n`;
      }

      await ctx.replyWithHTML(message, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '➕ Add Filter', callback_data: 'scan_add_filter' },
              { text: '🎯 Presets', callback_data: 'scan_presets' }
            ],
            [
              { text: '« Back', callback_data: 'scan_refresh' }
            ]
          ]
        }
      });
      return;
    }

    if (subcommand === 'matches') {
      // Show recent matches
      const matches = tokenScanner.getRecentMatches(20);

      if (matches.length === 0) {
        await ctx.replyWithHTML('<i>No matches yet</i>');
        return;
      }

      let message = `<b>🎯 Recent Matches (${matches.length})</b>\n\n`;

      for (const match of matches.slice(0, 10)) {
        const timeSince = Math.floor((Date.now() - match.matchedAt) / 1000 / 60);
        message += `<b>${match.symbol}</b> (${timeSince}m ago)\n`;
        message += `  Filter: ${match.filterName}\n`;
        message += `  Risk: ${match.riskScore}/100\n`;
        message += `  Liquidity: $${match.liquidityUsd.toLocaleString()}\n`;
        if (match.rugProbability) {
          message += `  Rug Risk: ${(match.rugProbability * 100).toFixed(0)}%\n`;
        }
        message += `  <code>${match.tokenMint.slice(0, 16)}...</code>\n\n`;
      }

      await ctx.replyWithHTML(message, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Refresh', callback_data: 'scan_matches_refresh' },
              { text: '« Back', callback_data: 'scan_refresh' }
            ]
          ]
        }
      });
      return;
    }

    if (subcommand === 'preset') {
      // Create preset filters
      await ctx.replyWithHTML('<i>Creating preset filters...</i>');

      try {
        tokenScanner.createPresetFilters();
        await ctx.replyWithHTML(
          '<b>✅ Preset Filters Created</b>\n\n' +
          '• Gem Finder - Safe tokens with growth potential\n' +
          '• Safe Haven - Maximum safety, low risk\n' +
          '• Moonshot - High risk, high reward\n\n' +
          'Use <code>/scanner filters</code> to view them.'
        );
      } catch (error) {
        await ctx.replyWithHTML('<b>❌ Failed to create presets</b>\n\nThey may already exist.');
      }
      return;
    }

    if (subcommand === 'start') {
      tokenScanner.start();
      await ctx.replyWithHTML('<b>✅ Scanner started</b>\n\nScanning every 60 seconds.');
      return;
    }

    if (subcommand === 'stop') {
      tokenScanner.stop();
      await ctx.replyWithHTML('<b>⏸️ Scanner stopped</b>');
      return;
    }

    // Help
    await ctx.replyWithHTML(
      '<b>🔍 Scanner Commands</b>\n\n' +
      '<code>/scan</code> - Scanner status\n' +
      '<code>/scanner filters</code> - List filters\n' +
      '<code>/scanner matches</code> - Recent matches\n' +
      '<code>/scanner preset</code> - Create preset filters\n' +
      '<code>/scanner start</code> - Start scanner\n' +
      '<code>/scanner stop</code> - Stop scanner'
    );
  });

  // Callback handlers
  bot.action('scan_refresh', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');

    const stats = tokenScanner.getStats();
    const filters = tokenScanner.getActiveFilters();

    let message = `<b>🔍 Token Scanner</b>\n\n`;
    message += `<b>Status:</b> ${filters.length > 0 ? '🟢 Active' : '⚪ Idle'}\n`;
    message += `<b>Active Filters:</b> ${filters.length}\n`;
    message += `<b>Total Scanned:</b> ${stats.totalScanned.toLocaleString()}\n`;
    message += `<b>Matches Found:</b> ${stats.totalMatches}\n\n`;

    if (stats.lastScanTime > 0) {
      const timeSince = Math.floor((Date.now() - stats.lastScanTime) / 1000 / 60);
      message += `<b>Last Scan:</b> ${timeSince}m ago\n\n`;
    }

    if (Object.keys(stats.matchesByFilter).length > 0) {
      message += `<b>Matches by Filter:</b>\n`;
      for (const [filterName, count] of Object.entries(stats.matchesByFilter)) {
        message += `  • ${filterName}: ${count}\n`;
      }
    }

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📋 Filters', callback_data: 'scan_filters' },
            { text: '🎯 Matches', callback_data: 'scan_matches' }
          ],
          [
            { text: '🔄 Refresh', callback_data: 'scan_refresh' }
          ]
        ]
      }
    });
  });

  bot.action('scan_filters', async (ctx) => {
    await ctx.answerCbQuery();

    const filters = tokenScanner.getAllFilters();

    if (filters.length === 0) {
      await ctx.editMessageText(
        '<i>No filters configured</i>\n\n' +
        'Use <code>/scanner preset</code> to create preset filters.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    let message = `<b>📋 Scanner Filters (${filters.length})</b>\n\n`;

    for (const filter of filters) {
      const status = filter.enabled ? '🟢' : '⚪';
      message += `${status} <b>${filter.name}</b>\n`;
      message += `  ${filter.description}\n`;
      
      const criteria: string[] = [];
      if (filter.minRiskScore) criteria.push(`Risk ${filter.minRiskScore}+`);
      if (filter.minLiquidity) criteria.push(`Liq $${(filter.minLiquidity / 1000).toFixed(0)}k+`);
      if (filter.minHolders) criteria.push(`${filter.minHolders}+ holders`);
      if (filter.maxRugProbability) criteria.push(`<${(filter.maxRugProbability * 100).toFixed(0)}% rug`);
      
      if (criteria.length > 0) {
        message += `  <i>${criteria.join(', ')}</i>\n`;
      }
      message += `\n`;
    }

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🎯 Presets', callback_data: 'scan_presets' }
          ],
          [
            { text: '« Back', callback_data: 'scan_refresh' }
          ]
        ]
      }
    });
  });

  bot.action('scan_matches', async (ctx) => {
    await ctx.answerCbQuery();

    const matches = tokenScanner.getRecentMatches(20);

    if (matches.length === 0) {
      await ctx.editMessageText('<i>No matches yet</i>', { parse_mode: 'HTML' });
      return;
    }

    let message = `<b>🎯 Recent Matches (${matches.length})</b>\n\n`;

    for (const match of matches.slice(0, 10)) {
      const timeSince = Math.floor((Date.now() - match.matchedAt) / 1000 / 60);
      message += `<b>${match.symbol}</b> (${timeSince}m ago)\n`;
      message += `  Filter: ${match.filterName}\n`;
      message += `  Risk: ${match.riskScore}/100\n`;
      message += `  Liquidity: $${match.liquidityUsd.toLocaleString()}\n`;
      if (match.rugProbability) {
        message += `  Rug Risk: ${(match.rugProbability * 100).toFixed(0)}%\n`;
      }
      message += `  <code>${match.tokenMint.slice(0, 16)}...</code>\n\n`;
    }

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 Refresh', callback_data: 'scan_matches_refresh' },
            { text: '« Back', callback_data: 'scan_refresh' }
          ]
        ]
      }
    });
  });

  bot.action('scan_matches_refresh', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');
    // Trigger matches view
    await ctx.answerCbQuery();
    return bot.handleUpdate({ ...ctx } as any);
  });

  bot.action('scan_presets', async (ctx) => {
    await ctx.answerCbQuery();

    await ctx.editMessageText(
      '<b>🎯 Preset Filters</b>\n\n' +
      '<b>Gem Finder</b>\n' +
      'Safe tokens with growth potential\n' +
      '• Risk 60+, Liquidity $50k+\n' +
      '• 100+ holders, <40% top 10\n' +
      '• Mint/freeze revoked, LP burned\n' +
      '• Has socials, <30% rug risk\n' +
      '• Age <24h\n\n' +
      '<b>Safe Haven</b>\n' +
      'Maximum safety, low risk\n' +
      '• Risk 80+, Liquidity $100k+\n' +
      '• 200+ holders, <30% top 10\n' +
      '• 90%+ LP burned, <15% rug risk\n\n' +
      '<b>Moonshot</b>\n' +
      'High risk, high reward\n' +
      '• Risk 40+, Liquidity $10k+\n' +
      '• +20% in 1h, $50k+ volume\n' +
      '• Age <6h\n\n' +
      'Use <code>/scanner preset</code> to create these.',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Back', callback_data: 'scan_filters' }]
          ]
        }
      }
    );
  });
}
