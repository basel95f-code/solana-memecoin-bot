import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import type { FilterProfile, WatchedToken, FilterSettings } from '../types';

// ═══════════════════════════════════════════
// MAIN MENU - Central navigation hub
// ═══════════════════════════════════════════

export function mainMenuKeyboard(): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Market', 'menu_market'),
      Markup.button.callback('🔍 Analyze', 'menu_analyze'),
    ],
    [
      Markup.button.callback('⭐ Watchlist', 'menu_watchlist'),
      Markup.button.callback('🔔 Alerts', 'menu_alerts'),
    ],
    [
      Markup.button.callback('⚙️ Settings', 'menu_settings'),
      Markup.button.callback('📈 Stats', 'menu_stats'),
    ],
  ]);
}

export function backToMenuKeyboard(): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [Markup.button.callback('◀ Menu', 'back_menu')],
  ]);
}

// ═══════════════════════════════════════════
// TOKEN ACTIONS
// ═══════════════════════════════════════════

export function tokenActionKeyboard(mint: string): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.url('📊 Chart', `https://dexscreener.com/solana/${mint}`),
      Markup.button.url('💱 Swap', `https://jup.ag/swap/SOL-${mint}`),
    ],
    [
      Markup.button.callback('⭐ Watch', `watch_${mint.slice(0, 20)}`),
      Markup.button.url('🔎 RugCheck', `https://rugcheck.xyz/tokens/${mint}`),
    ],
    [Markup.button.callback('◀ Menu', 'back_menu')],
  ]);
}

export function alertActionKeyboard(mint: string): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.url('📊 Chart', `https://dexscreener.com/solana/${mint}`),
      Markup.button.url('💱 Buy', `https://jup.ag/swap/SOL-${mint}`),
    ],
    [
      Markup.button.callback('🔍 Details', `check_${mint.slice(0, 20)}`),
      Markup.button.callback('⭐ Watch', `watch_${mint.slice(0, 20)}`),
    ],
  ]);
}

export function signalActionKeyboard(signalId: string, mint: string): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.url('📊 Chart', `https://dexscreener.com/solana/${mint}`),
      Markup.button.url('💱 Trade', `https://jup.ag/swap/SOL-${mint}`),
    ],
    [
      Markup.button.callback('✅ Acknowledge', `ack_${signalId.slice(0, 16)}`),
      Markup.button.callback('📝 Record', `outcome_${signalId.slice(0, 16)}`),
    ],
    [
      Markup.button.callback('🔍 Details', `check_${mint.slice(0, 20)}`),
      Markup.button.callback('⭐ Watch', `watch_${mint.slice(0, 20)}`),
    ],
  ]);
}

// ═══════════════════════════════════════════
// MARKET / DISCOVERY
// ═══════════════════════════════════════════

export function marketKeyboard(): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🔥 Trending', 'show_trending'),
      Markup.button.callback('📈 Gainers', 'show_gainers'),
    ],
    [
      Markup.button.callback('🆕 New', 'show_new'),
      Markup.button.callback('💰 Volume', 'show_volume'),
    ],
    [
      Markup.button.callback('🐋 Smart Money', 'show_smartmoney'),
      Markup.button.callback('🔄 Refresh', 'market_refresh'),
    ],
    [Markup.button.callback('◀ Menu', 'back_menu')],
  ]);
}

export function trendingKeyboard(): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📈 Gainers', 'show_gainers'),
      Markup.button.callback('📉 Losers', 'show_losers'),
    ],
    [
      Markup.button.callback('💰 Volume', 'show_volume'),
      Markup.button.callback('🐋 Whales', 'show_smartmoney'),
    ],
    [
      Markup.button.callback('🔄 Refresh', 'trending_refresh'),
      Markup.button.callback('◀ Menu', 'back_menu'),
    ],
  ]);
}

export function smartMoneyKeyboard(): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('6h', 'smartmoney_6h'),
      Markup.button.callback('24h', 'smartmoney_24h'),
      Markup.button.callback('🔄', 'smartmoney_refresh'),
    ],
    [Markup.button.callback('◀ Menu', 'back_menu')],
  ]);
}

// ═══════════════════════════════════════════
// WATCHLIST
// ═══════════════════════════════════════════

export function watchlistKeyboard(tokens: WatchedToken[]): Markup.Markup<InlineKeyboardMarkup> {
  const buttons = tokens.slice(0, 6).map(token => [
    Markup.button.callback(
      `${token.priceChangePercent >= 0 ? '▲' : '▼'} ${token.symbol} ${token.priceChangePercent >= 0 ? '+' : ''}${token.priceChangePercent.toFixed(1)}%`,
      `check_${token.mint.slice(0, 20)}`
    ),
    Markup.button.callback('✕', `unwatch_${token.mint.slice(0, 20)}`),
  ]);

  if (tokens.length > 0) {
    buttons.push([
      Markup.button.callback('🗑 Clear All', 'watchlist_clear'),
      Markup.button.callback('🔄 Refresh', 'watchlist_refresh'),
    ]);
  }

  buttons.push([Markup.button.callback('◀ Menu', 'back_menu')]);

  return Markup.inlineKeyboard(buttons);
}

// ═══════════════════════════════════════════
// ALERTS
// ═══════════════════════════════════════════

export function alertsKeyboard(alertsEnabled: boolean): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        alertsEnabled ? '🔕 Turn Off' : '🔔 Turn On',
        'toggle_alerts'
      ),
      Markup.button.callback('⏸ Mute 30m', 'mute_30'),
    ],
    [
      Markup.button.callback('🎚 Filters', 'show_filters'),
      Markup.button.callback('📋 History', 'alert_history'),
    ],
    [Markup.button.callback('◀ Menu', 'back_menu')],
  ]);
}

// ═══════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════

export function filterProfileKeyboard(currentProfile: FilterProfile): Markup.Markup<InlineKeyboardMarkup> {
  const profiles: { name: FilterProfile; icon: string }[] = [
    { name: 'sniper', icon: '🎯' },
    { name: 'early', icon: '⚡' },
    { name: 'balanced', icon: '⚖️' },
    { name: 'conservative', icon: '🛡️' },
  ];

  const profiles2: { name: FilterProfile; icon: string }[] = [
    { name: 'degen', icon: '🎰' },
    { name: 'whale', icon: '🐋' },
    { name: 'trending', icon: '🔥' },
    { name: 'fresh', icon: '🆕' },
  ];

  const makeButton = (p: { name: FilterProfile; icon: string }) => {
    const isActive = p.name === currentProfile;
    return Markup.button.callback(
      `${isActive ? '● ' : ''}${p.icon}`,
      `filter_${p.name}`
    );
  };

  return Markup.inlineKeyboard([
    profiles.map(makeButton),
    profiles2.map(makeButton),
    [
      Markup.button.callback('📋 More', 'show_all_profiles'),
      Markup.button.callback('◀ Menu', 'back_menu'),
    ],
  ]);
}

export function allProfilesKeyboard(currentProfile: FilterProfile): Markup.Markup<InlineKeyboardMarkup> {
  const allProfiles: { name: FilterProfile; icon: string }[] = [
    { name: 'micro', icon: '💎' },
    { name: 'small', icon: '🥉' },
    { name: 'mid', icon: '🥈' },
    { name: 'large', icon: '🥇' },
    { name: 'graduation', icon: '🎓' },
    { name: 'cto', icon: '🔍' },
    { name: 'momentum', icon: '📈' },
    { name: 'revival', icon: '💀' },
  ];

  const rows = [];
  for (let i = 0; i < allProfiles.length; i += 4) {
    rows.push(
      allProfiles.slice(i, i + 4).map(p =>
        Markup.button.callback(
          `${p.name === currentProfile ? '● ' : ''}${p.icon}`,
          `filter_${p.name}`
        )
      )
    );
  }

  rows.push([Markup.button.callback('◀ Back', 'show_filters')]);

  return Markup.inlineKeyboard(rows);
}

// ═══════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════

export function settingsKeyboard(settings: FilterSettings): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        `🔔 ${settings.alertsEnabled ? 'On' : 'Off'}`,
        'toggle_alerts'
      ),
      Markup.button.callback('🎚 Filter', 'show_filters'),
    ],
    [
      Markup.button.callback('🌙 Quiet Hours', 'set_quiet'),
      Markup.button.callback('🔄 Reset', 'reset_filters'),
    ],
    [Markup.button.callback('◀ Menu', 'back_menu')],
  ]);
}

// ═══════════════════════════════════════════
// UTILITY KEYBOARDS
// ═══════════════════════════════════════════

export function confirmKeyboard(action: string, data: string): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✓ Yes', `confirm_${action}_${data}`),
      Markup.button.callback('✕ No', 'cancel'),
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
    buttons.push(Markup.button.callback('◀', `${prefix}_page_${currentPage - 1}`));
  }

  buttons.push(Markup.button.callback(`${currentPage}/${totalPages}`, 'noop'));

  if (currentPage < totalPages) {
    buttons.push(Markup.button.callback('▶', `${prefix}_page_${currentPage + 1}`));
  }

  return Markup.inlineKeyboard([
    buttons,
    [Markup.button.callback('◀ Menu', 'back_menu')],
  ]);
}

export function compareKeyboard(mint1: string, mint2: string): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.url('📊 Chart 1', `https://dexscreener.com/solana/${mint1}`),
      Markup.button.url('📊 Chart 2', `https://dexscreener.com/solana/${mint2}`),
    ],
    [Markup.button.callback('◀ Menu', 'back_menu')],
  ]);
}

// ═══════════════════════════════════════════
// CHART KEYBOARD - For live chart viewing
// ═══════════════════════════════════════════

export function chartKeyboard(mint: string): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([
    [
      Markup.button.url('📊 DexScreener', `https://dexscreener.com/solana/${mint}`),
      Markup.button.url('🦅 Birdeye', `https://birdeye.so/token/${mint}?chain=solana`),
    ],
    [
      Markup.button.url('📈 DEXTools', `https://www.dextools.io/app/en/solana/pair-explorer/${mint}`),
      Markup.button.url('🔎 Solscan', `https://solscan.io/token/${mint}`),
    ],
    [Markup.button.callback('◀ Menu', 'back_menu')],
  ]);
}
