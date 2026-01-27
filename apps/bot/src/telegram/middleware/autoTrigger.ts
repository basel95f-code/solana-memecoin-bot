/**
 * Auto-Trigger Middleware
 * Automatically detects and responds to token mentions in group chats
 * 
 * Detects:
 * - Contract addresses (Solana base58, 32-44 chars)
 * - DEX links (dexscreener.com, birdeye.so, etc.)
 * - $TICKER mentions (configurable)
 */

import type { Context, Telegraf } from 'telegraf';
import { logger } from '../../utils/logger';
import { formatQuickAnalysis } from '../formatters/quickAnalysis';
import { database } from '../../database';

// Regex patterns for detection
const SOLANA_ADDRESS_REGEX = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const DEX_LINK_REGEX = /(dexscreener\.com|birdeye\.so|jupiter\.ag|raydium\.io)\/[^\s]+/gi;
const TICKER_REGEX = /\$([A-Z][A-Z0-9]{1,10})\b/g;

/**
 * Auto-trigger settings per group
 */
interface AutoTriggerSettings {
  enabled: boolean;
  mode: 'quick' | 'full' | 'chart';
  minMcap?: number;
  detectTickers: boolean;
  cooldownSeconds: number;
}

/**
 * Get auto-trigger settings for a group
 */
function getGroupSettings(groupId: string): AutoTriggerSettings {
  const result = database.query(
    'SELECT * FROM group_settings WHERE group_id = ?',
    [groupId]
  )[0];

  if (!result) {
    // Default settings
    return {
      enabled: true,
      mode: 'quick',
      detectTickers: false,
      cooldownSeconds: 60
    };
  }

  return {
    enabled: result.auto_track_enabled === 1,
    mode: result.auto_mode || 'quick',
    minMcap: result.min_mcap_filter,
    detectTickers: result.detect_tickers === 1,
    cooldownSeconds: result.auto_cooldown || 60
  };
}

/**
 * Update group auto-trigger settings
 */
function updateGroupSettings(groupId: string, settings: Partial<AutoTriggerSettings>): void {
  database.run(
    `INSERT INTO group_settings (group_id, auto_track_enabled, auto_mode, detect_tickers, auto_cooldown)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(group_id) DO UPDATE SET
       auto_track_enabled = excluded.auto_track_enabled,
       auto_mode = excluded.auto_mode,
       detect_tickers = excluded.detect_tickers,
       auto_cooldown = excluded.auto_cooldown,
       updated_at = strftime('%s', 'now')`,
    [
      groupId,
      settings.enabled ? 1 : 0,
      settings.mode || 'quick',
      settings.detectTickers ? 1 : 0,
      settings.cooldownSeconds || 60
    ]
  );
}

/**
 * Check if token was recently analyzed (cooldown)
 */
function isOnCooldown(groupId: string, tokenMint: string, cooldownSeconds: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - cooldownSeconds;

  const result = database.query(
    `SELECT analyzed_at FROM auto_trigger_log 
     WHERE group_id = ? AND token_mint = ? AND analyzed_at > ?
     ORDER BY analyzed_at DESC LIMIT 1`,
    [groupId, tokenMint, cutoff]
  )[0];

  return !!result;
}

/**
 * Log an auto-triggered analysis
 */
function logAutoTrigger(groupId: string, tokenMint: string, triggeredBy: string): void {
  const now = Math.floor(Date.now() / 1000);
  
  database.run(
    `INSERT INTO auto_trigger_log (group_id, token_mint, triggered_by, analyzed_at)
     VALUES (?, ?, ?, ?)`,
    [groupId, tokenMint, triggeredBy, now]
  );

  // Clean up old logs (older than 24 hours)
  database.run(
    'DELETE FROM auto_trigger_log WHERE analyzed_at < ?',
    [now - 86400]
  );
}

/**
 * Extract Solana addresses from text
 */
function extractAddresses(text: string): string[] {
  const matches = text.match(SOLANA_ADDRESS_REGEX);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Extract DEX links from text
 */
function extractDexLinks(text: string): string[] {
  const matches = text.match(DEX_LINK_REGEX);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Extract tickers from text
 */
function extractTickers(text: string): string[] {
  const matches = text.match(TICKER_REGEX);
  return matches ? [...new Set(matches.map(m => m.replace('$', '')))] : [];
}

/**
 * Extract token mint from DEX link
 */
function extractMintFromDexLink(link: string): string | null {
  // Extract Solana address from various DEX link formats
  const addressMatch = link.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  return addressMatch ? addressMatch[0] : null;
}

/**
 * Auto-trigger middleware - processes messages for token mentions
 */
export async function autoTriggerMiddleware(ctx: Context, next: () => Promise<void>): Promise<void> {
  try {
    // Only process in groups
    if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
      return next();
    }

    // Only process text messages
    const message = ctx.message;
    if (!message || !('text' in message)) {
      return next();
    }

    const text = message.text;
    const groupId = ctx.chat.id.toString();
    const userId = ctx.from?.id.toString() || '';
    const username = ctx.from?.username || ctx.from?.first_name || 'Unknown';

    // Get group settings
    const settings = getGroupSettings(groupId);

    // Skip if auto-trigger is disabled
    if (!settings.enabled) {
      return next();
    }

    // Extract potential tokens from message
    const addresses = extractAddresses(text);
    const dexLinks = extractDexLinks(text);
    const tickers = settings.detectTickers ? extractTickers(text) : [];

    // Combine all detected tokens
    const detectedMints: string[] = [];

    // Add direct addresses
    detectedMints.push(...addresses);

    // Add mints from DEX links
    for (const link of dexLinks) {
      const mint = extractMintFromDexLink(link);
      if (mint) detectedMints.push(mint);
    }

    // Remove duplicates
    const uniqueMints = [...new Set(detectedMints)];

    // Process each detected token
    for (const mint of uniqueMints) {
      // Check cooldown
      if (isOnCooldown(groupId, mint, settings.cooldownSeconds)) {
        logger.debug('AutoTrigger', `Token ${mint} on cooldown in group ${groupId}`);
        continue;
      }

      // Trigger analysis
      await triggerQuickAnalysis(ctx, mint, settings, username);

      // Log the trigger
      logAutoTrigger(groupId, mint, userId);

      // Only analyze first detected token to avoid spam
      break;
    }

    // Continue to other middleware/handlers
    return next();
  } catch (error) {
    logger.error('AutoTrigger', 'Middleware error', error as Error);
    return next();
  }
}

/**
 * Trigger quick analysis for a token
 */
async function triggerQuickAnalysis(
  ctx: Context,
  mint: string,
  settings: AutoTriggerSettings,
  triggeredBy: string
): Promise<void> {
  try {
    logger.info('AutoTrigger', `Analyzing ${mint} (triggered by ${triggeredBy})`);

    // Send typing indicator
    await ctx.sendChatAction('typing');

    // TODO: Get actual token analysis from your analysis service
    // For now, using placeholder
    const analysis = {
      symbol: 'TOKEN',
      name: 'Token Name',
      price: 0.00123,
      priceChange24h: 24.5,
      marketCap: 1200000,
      liquidity: 234000,
      volume24h: 567000,
      holders: 234,
      riskScore: 45,
      riskLevel: 'Medium' as const,
      top10Percent: 23,
      whaleCount: 3,
      lpBurnedPercent: 75,
      mint
    };

    // Format and send quick analysis
    const message = formatQuickAnalysis(analysis, settings.mode);

    await ctx.reply(message, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true }
    });

    logger.info('AutoTrigger', `Sent ${settings.mode} analysis for ${mint}`);
  } catch (error) {
    logger.error('AutoTrigger', 'Failed to trigger analysis', error as Error);
    // Don't send error to chat - fail silently for auto-triggers
  }
}

/**
 * Register /auto commands
 */
export function registerAutoCommands(bot: Telegraf): void {
  /**
   * /auto on - Enable auto-trigger
   */
  bot.command('auto_on', async (ctx: Context) => {
    try {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        await ctx.reply('❌ This command only works in group chats!');
        return;
      }

      const groupId = ctx.chat.id.toString();
      updateGroupSettings(groupId, { enabled: true });

      await ctx.reply(
        '✅ <b>Auto-Trigger Enabled</b>\n\n' +
        'The bot will now automatically analyze tokens when posted.\n\n' +
        'Configure with:\n' +
        '/auto_quick - Quick summary (default)\n' +
        '/auto_full - Full analysis\n' +
        '/auto_off - Disable',
        { parse_mode: 'HTML' }
      );

      logger.info('AutoCmd', `Auto-trigger enabled in group ${groupId}`);
    } catch (error) {
      logger.error('AutoCmd', 'Failed to enable auto-trigger', error as Error);
      await ctx.reply('❌ Failed to update settings.');
    }
  });

  /**
   * /auto off - Disable auto-trigger
   */
  bot.command('auto_off', async (ctx: Context) => {
    try {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        await ctx.reply('❌ This command only works in group chats!');
        return;
      }

      const groupId = ctx.chat.id.toString();
      updateGroupSettings(groupId, { enabled: false });

      await ctx.reply(
        '🔕 <b>Auto-Trigger Disabled</b>\n\n' +
        'The bot will no longer automatically respond to token posts.\n\n' +
        'Re-enable with /auto_on',
        { parse_mode: 'HTML' }
      );

      logger.info('AutoCmd', `Auto-trigger disabled in group ${groupId}`);
    } catch (error) {
      logger.error('AutoCmd', 'Failed to disable auto-trigger', error as Error);
      await ctx.reply('❌ Failed to update settings.');
    }
  });

  /**
   * /auto quick - Set quick mode
   */
  bot.command('auto_quick', async (ctx: Context) => {
    try {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        await ctx.reply('❌ This command only works in group chats!');
        return;
      }

      const groupId = ctx.chat.id.toString();
      updateGroupSettings(groupId, { mode: 'quick', enabled: true });

      await ctx.reply('✅ Auto-trigger set to <b>Quick Mode</b>', { parse_mode: 'HTML' });
    } catch (error) {
      logger.error('AutoCmd', 'Failed to set quick mode', error as Error);
      await ctx.reply('❌ Failed to update settings.');
    }
  });

  /**
   * /auto full - Set full analysis mode
   */
  bot.command('auto_full', async (ctx: Context) => {
    try {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        await ctx.reply('❌ This command only works in group chats!');
        return;
      }

      const groupId = ctx.chat.id.toString();
      updateGroupSettings(groupId, { mode: 'full', enabled: true });

      await ctx.reply('✅ Auto-trigger set to <b>Full Analysis Mode</b>', { parse_mode: 'HTML' });
    } catch (error) {
      logger.error('AutoCmd', 'Failed to set full mode', error as Error);
      await ctx.reply('❌ Failed to update settings.');
    }
  });

  /**
   * /auto chart - Set chart mode
   */
  bot.command('auto_chart', async (ctx: Context) => {
    try {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        await ctx.reply('❌ This command only works in group chats!');
        return;
      }

      const groupId = ctx.chat.id.toString();
      updateGroupSettings(groupId, { mode: 'chart', enabled: true });

      await ctx.reply('✅ Auto-trigger set to <b>Chart Mode</b>', { parse_mode: 'HTML' });
    } catch (error) {
      logger.error('AutoCmd', 'Failed to set chart mode', error as Error);
      await ctx.reply('❌ Failed to update settings.');
    }
  });

  /**
   * /auto status - Show current settings
   */
  bot.command('auto_status', async (ctx: Context) => {
    try {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        await ctx.reply('❌ This command only works in group chats!');
        return;
      }

      const groupId = ctx.chat.id.toString();
      const settings = getGroupSettings(groupId);

      let message = '⚙️ <b>Auto-Trigger Settings</b>\n\n';
      message += `Status: ${settings.enabled ? '✅ Enabled' : '🔕 Disabled'}\n`;
      message += `Mode: ${settings.mode.toUpperCase()}\n`;
      message += `Cooldown: ${settings.cooldownSeconds}s\n`;
      message += `Detect Tickers: ${settings.detectTickers ? 'Yes' : 'No'}\n`;

      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (error) {
      logger.error('AutoCmd', 'Failed to show status', error as Error);
      await ctx.reply('❌ Failed to get settings.');
    }
  });

  logger.info('Commands', 'Auto-trigger commands registered');
}
