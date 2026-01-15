import { Context, Telegraf } from 'telegraf';
import { dexScreenerService } from '../../services/dexscreener';
import { formatTrendingList } from '../formatters';
import { trendingKeyboard } from '../keyboards';

export function registerDiscoveryCommands(bot: Telegraf): void {
  // /trending command
  bot.command('trending', async (ctx: Context) => {
    const loadingMsg = await ctx.replyWithHTML(`📈 Fetching trending tokens...`);

    try {
      const tokens = await dexScreenerService.getTrendingTokens(10);
      const formatted = formatTrendingList(tokens, `🔥 <b>TRENDING TOKENS</b>`);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        formatted,
        { parse_mode: 'HTML', ...trendingKeyboard() }
      );
    } catch (error) {
      console.error('Trending command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error fetching trending tokens.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /new command
  bot.command('new', async (ctx: Context) => {
    const loadingMsg = await ctx.replyWithHTML(`🆕 Fetching new tokens...`);

    try {
      const tokens = await dexScreenerService.getNewTokens(24, 10);
      const formatted = formatTrendingList(tokens, `🆕 <b>NEWEST TOKENS</b> (24h)`);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        formatted,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('New command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error fetching new tokens.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /gainers command
  bot.command('gainers', async (ctx: Context) => {
    const loadingMsg = await ctx.replyWithHTML(`📈 Fetching top gainers...`);

    try {
      const tokens = await dexScreenerService.getTopGainers(10);
      const formatted = formatTrendingList(tokens, `📈 <b>TOP GAINERS</b> (24h)`);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        formatted,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Gainers command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error fetching gainers.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /losers command
  bot.command('losers', async (ctx: Context) => {
    const loadingMsg = await ctx.replyWithHTML(`📉 Fetching top losers...`);

    try {
      const tokens = await dexScreenerService.getTopLosers(10);
      const formatted = formatTrendingList(tokens, `📉 <b>TOP LOSERS</b> (24h)`);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        formatted,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Losers command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error fetching losers.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /volume command
  bot.command('volume', async (ctx: Context) => {
    const loadingMsg = await ctx.replyWithHTML(`💹 Fetching volume leaders...`);

    try {
      const tokens = await dexScreenerService.getVolumeLeaders(10);
      const formatted = formatTrendingList(tokens, `💹 <b>VOLUME LEADERS</b> (24h)`);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        formatted,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Volume command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error fetching volume data.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // Handle callback queries for trending keyboard
  bot.action('trending_refresh', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');

    try {
      const tokens = await dexScreenerService.getTrendingTokens(10);
      const formatted = formatTrendingList(tokens, `🔥 <b>TRENDING TOKENS</b>`);

      await ctx.editMessageText(formatted, {
        parse_mode: 'HTML',
        ...trendingKeyboard()
      });
    } catch (error) {
      await ctx.answerCbQuery('Error refreshing');
    }
  });

  bot.action('show_gainers', async (ctx) => {
    await ctx.answerCbQuery('Loading gainers...');

    try {
      const tokens = await dexScreenerService.getTopGainers(10);
      const formatted = formatTrendingList(tokens, `📈 <b>TOP GAINERS</b> (24h)`);

      await ctx.editMessageText(formatted, {
        parse_mode: 'HTML',
        ...trendingKeyboard()
      });
    } catch (error) {
      await ctx.answerCbQuery('Error loading');
    }
  });

  bot.action('show_losers', async (ctx) => {
    await ctx.answerCbQuery('Loading losers...');

    try {
      const tokens = await dexScreenerService.getTopLosers(10);
      const formatted = formatTrendingList(tokens, `📉 <b>TOP LOSERS</b> (24h)`);

      await ctx.editMessageText(formatted, {
        parse_mode: 'HTML',
        ...trendingKeyboard()
      });
    } catch (error) {
      await ctx.answerCbQuery('Error loading');
    }
  });

  bot.action('show_volume', async (ctx) => {
    await ctx.answerCbQuery('Loading volume...');

    try {
      const tokens = await dexScreenerService.getVolumeLeaders(10);
      const formatted = formatTrendingList(tokens, `💹 <b>VOLUME LEADERS</b> (24h)`);

      await ctx.editMessageText(formatted, {
        parse_mode: 'HTML',
        ...trendingKeyboard()
      });
    } catch (error) {
      await ctx.answerCbQuery('Error loading');
    }
  });

  bot.action('show_new', async (ctx) => {
    await ctx.answerCbQuery('Loading new tokens...');

    try {
      const tokens = await dexScreenerService.getNewTokens(24, 10);
      const formatted = formatTrendingList(tokens, `🆕 <b>NEWEST TOKENS</b> (24h)`);

      await ctx.editMessageText(formatted, {
        parse_mode: 'HTML',
        ...trendingKeyboard()
      });
    } catch (error) {
      await ctx.answerCbQuery('Error loading');
    }
  });
}
