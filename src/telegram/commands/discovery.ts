import { Context, Telegraf } from 'telegraf';
import { dexScreenerService } from '../../services/dexscreener';
import { gmgnService } from '../../services/gmgn';
import { dataAggregator } from '../../services/dataAggregator';
import { formatTrendingList, formatSmartMoneyList, SmartMoneyPick } from '../formatters';
import { trendingKeyboard, smartMoneyKeyboard } from '../keyboards';

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

  // /smartmoney command - tokens smart money is accumulating
  bot.command('smartmoney', async (ctx: Context) => {
    const loadingMsg = await ctx.replyWithHTML(`🐋 Fetching smart money activity from GMGN.ai...`);

    try {
      // Check if GMGN is available
      if (!gmgnService.isAvailable()) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `⚠️ <b>GMGN.ai Temporarily Unavailable</b>\n\n` +
          `Smart money data is currently blocked by Cloudflare.\n` +
          `This usually resolves automatically.\n\n` +
          `<i>Try /trending for DexScreener data instead.</i>`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      const tokens = await gmgnService.getSmartMoneyPicks(10);

      if (tokens.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMsg.message_id,
          undefined,
          `⚠️ <b>No Smart Money Data</b>\n\n` +
          `Could not fetch data from GMGN.ai.\n` +
          `The service may be temporarily unavailable.\n\n` +
          `<i>Try /trending for DexScreener data.</i>`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      const formatted = formatSmartMoneyList(tokens, `🐋 <b>SMART MONEY PICKS</b>`);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        formatted,
        { parse_mode: 'HTML', ...smartMoneyKeyboard() }
      );
    } catch (error) {
      console.error('Smart money command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error fetching smart money data.\n\n<i>GMGN.ai may be temporarily unavailable.</i>`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /whales command - alias for smartmoney
  bot.command('whales', async (ctx: Context) => {
    const loadingMsg = await ctx.replyWithHTML(`🐋 Fetching whale activity...`);

    try {
      const tokens = await gmgnService.getSmartMoneyPicks(10);
      const formatted = formatSmartMoneyList(tokens, `🐋 <b>WHALE ACCUMULATION</b>`);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        formatted,
        { parse_mode: 'HTML', ...smartMoneyKeyboard() }
      );
    } catch (error) {
      console.error('Whales command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error fetching whale data.`,
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

  // Smart money callback handlers
  bot.action('show_smartmoney', async (ctx) => {
    await ctx.answerCbQuery('Loading smart money data...');

    try {
      const tokens = await gmgnService.getSmartMoneyPicks(10);
      const formatted = formatSmartMoneyList(tokens, `🐋 <b>SMART MONEY PICKS</b>`);

      await ctx.editMessageText(formatted, {
        parse_mode: 'HTML',
        ...smartMoneyKeyboard()
      });
    } catch (error) {
      await ctx.answerCbQuery('Error loading smart money data');
    }
  });

  bot.action('smartmoney_refresh', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');

    try {
      const tokens = await gmgnService.getSmartMoneyPicks(10);
      const formatted = formatSmartMoneyList(tokens, `🐋 <b>SMART MONEY PICKS</b>`);

      await ctx.editMessageText(formatted, {
        parse_mode: 'HTML',
        ...smartMoneyKeyboard()
      });
    } catch (error) {
      await ctx.answerCbQuery('Error refreshing');
    }
  });

  bot.action('smartmoney_6h', async (ctx) => {
    await ctx.answerCbQuery('Loading 6h view...');

    try {
      const rawTokens = await gmgnService.getSmartMoneyTokens('6h', 10);
      const tokens = rawTokens
        .filter(t => {
          const activity = gmgnService.extractSmartMoneyActivity(t);
          return activity.isSmartMoneyBullish;
        })
        .map(t => ({
          ...gmgnService.toTrendingToken(t),
          smartMoney: gmgnService.extractSmartMoneyActivity(t),
        }));

      const formatted = formatSmartMoneyList(tokens, `🐋 <b>SMART MONEY (6H)</b>`);

      await ctx.editMessageText(formatted, {
        parse_mode: 'HTML',
        ...smartMoneyKeyboard()
      });
    } catch (error) {
      await ctx.answerCbQuery('Error loading');
    }
  });

  bot.action('smartmoney_24h', async (ctx) => {
    await ctx.answerCbQuery('Loading 24h view...');

    try {
      const rawTokens = await gmgnService.getSmartMoneyTokens('24h', 10);
      const tokens = rawTokens
        .filter(t => {
          const activity = gmgnService.extractSmartMoneyActivity(t);
          return activity.isSmartMoneyBullish;
        })
        .map(t => ({
          ...gmgnService.toTrendingToken(t),
          smartMoney: gmgnService.extractSmartMoneyActivity(t),
        }));

      const formatted = formatSmartMoneyList(tokens, `🐋 <b>SMART MONEY (24H)</b>`);

      await ctx.editMessageText(formatted, {
        parse_mode: 'HTML',
        ...smartMoneyKeyboard()
      });
    } catch (error) {
      await ctx.answerCbQuery('Error loading');
    }
  });

  bot.action('show_trending', async (ctx) => {
    await ctx.answerCbQuery('Loading trending...');

    try {
      const tokens = await dexScreenerService.getTrendingTokens(10);
      const formatted = formatTrendingList(tokens, `🔥 <b>TRENDING TOKENS</b>`);

      await ctx.editMessageText(formatted, {
        parse_mode: 'HTML',
        ...trendingKeyboard()
      });
    } catch (error) {
      await ctx.answerCbQuery('Error loading');
    }
  });
}
