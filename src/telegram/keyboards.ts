import { Markup } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { FilterProfile, WatchedToken, FilterSettings } from '../types';

export function tokenActionKeyboard(mint: string): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Full Analysis', `check_${mint.slice(0, 20)}`),
      Markup.button.url('Chart', `https://dexscreener.com/solana/${mint}`),
    ],
    [
      Markup.button.url('Swap', `https://jup.ag/swap/SOL-${mint}`),
      Markup.button.callback('Watch', `watch_${mint.slice(0, 20)}`),
    ],
    [
      Markup.button.callback('Holders', `holders_${mint.slice(0, 20)}`),
      Markup.button.callback('LP Info', `lp_${mint.slice(0, 20)}`),
    ],
  ]);
}

export function alertActionKeyboard(mint: string): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Analyze', `check_${mint.slice(0, 20)}`),
      Markup.button.url('Chart', `https://dexscreener.com/solana/${mint}`),
      Markup.button.url('Swap', `https://jup.ag/swap/SOL-${mint}`),
    ],
    [
      Markup.button.callback('Watch', `watch_${mint.slice(0, 20)}`),
      Markup.button.url('RugCheck', `https://rugcheck.xyz/tokens/${mint}`),
    ],
  ]);
}

export function watchlistKeyboard(tokens: WatchedToken[]): Markup.Markup<InlineKeyboardMarkup> {
  const buttons = tokens.slice(0, 8).map(token => [
    Markup.button.callback(
      `${token.symbol} ${token.priceChangePercent >= 0 ? '+' : ''}${token.priceChangePercent.toFixed(1)}%`,
      `check_${token.mint.slice(0, 20)}`
    ),
    Markup.button.callback('Remove', `unwatch_${token.mint.slice(0, 20)}`),
  ]);

  if (tokens.length > 0) {
    buttons.push([Markup.button.callback('Clear All', 'watchlist_clear')]);
  }

  return Markup.inlineKeyboard(buttons);
}

export function filterProfileKeyboard(currentProfile: FilterProfile): Markup.Markup<InlineKeyboardMarkup> {
  const profiles: FilterProfile[] = ['conservative', 'balanced', 'aggressive', 'degen'];

  const buttons = profiles.map(profile => {
    const emoji = profile === currentProfile ? '✓ ' : '';
    const label = profile.charAt(0).toUpperCase() + profile.slice(1);
    return Markup.button.callback(`${emoji}${label}`, `filter_${profile}`);
  });

  return Markup.inlineKeyboard([
    buttons.slice(0, 2),
    buttons.slice(2, 4),
  ]);
}

export function settingsKeyboard(settings: FilterSettings): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        `Alerts: ${settings.alertsEnabled ? 'ON' : 'OFF'}`,
        `toggle_alerts`
      ),
      Markup.button.callback('Change Filter', 'show_filters'),
    ],
    [
      Markup.button.callback('Set Quiet Hours', 'set_quiet'),
      Markup.button.callback('Reset Defaults', 'reset_filters'),
    ],
  ]);
}

export function confirmKeyboard(action: string, data: string): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Yes', `confirm_${action}_${data}`),
      Markup.button.callback('No', 'cancel'),
    ],
  ]);
}

export function paginationKeyboard(
  currentPage: number,
  totalPages: number,
  prefix: string
): Markup.Markup<InlineKeyboardMarkup> {
  const buttons = [];

  if (currentPage > 1) {
    buttons.push(Markup.button.callback('◀ Prev', `${prefix}_page_${currentPage - 1}`));
  }

  buttons.push(Markup.button.callback(`${currentPage}/${totalPages}`, 'noop'));

  if (currentPage < totalPages) {
    buttons.push(Markup.button.callback('Next ▶', `${prefix}_page_${currentPage + 1}`));
  }

  return Markup.inlineKeyboard([buttons]);
}

export function trendingKeyboard(): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Refresh', 'trending_refresh'),
      Markup.button.callback('Gainers', 'show_gainers'),
      Markup.button.callback('Losers', 'show_losers'),
    ],
    [
      Markup.button.callback('Volume', 'show_volume'),
      Markup.button.callback('New', 'show_new'),
      Markup.button.callback('🐋 Whales', 'show_smartmoney'),
    ],
  ]);
}

export function smartMoneyKeyboard(): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🔄 Refresh', 'smartmoney_refresh'),
      Markup.button.callback('📈 Trending', 'show_trending'),
    ],
    [
      Markup.button.callback('6h View', 'smartmoney_6h'),
      Markup.button.callback('24h View', 'smartmoney_24h'),
    ],
  ]);
}

export function compareKeyboard(mint1: string, mint2: string): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`Analyze ${mint1.slice(0, 6)}...`, `check_${mint1.slice(0, 20)}`),
      Markup.button.callback(`Analyze ${mint2.slice(0, 6)}...`, `check_${mint2.slice(0, 20)}`),
    ],
    [
      Markup.button.url(`Chart 1`, `https://dexscreener.com/solana/${mint1}`),
      Markup.button.url(`Chart 2`, `https://dexscreener.com/solana/${mint2}`),
    ],
  ]);
}
