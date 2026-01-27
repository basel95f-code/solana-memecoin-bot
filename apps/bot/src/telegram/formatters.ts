import type {
  TokenAnalysis,
  RiskLevel,
  TrendingToken,
  WatchedToken,
  FilterSettings,
  DexScreenerPair,
  SmartMoneyActivity,
} from '../types';
import type {
  TradingSignal,
  SignalPerformanceMetrics,
  WebhookConfig,
} from '../signals/types';
import type { LiquidityAlert } from '../services/liquidityMonitor';
import type { DevBehaviorAlert } from '../services/devWalletTracker';
import type { BundleAlert } from '../services/bundledWalletDetector';
import type { HolderChangeAlert } from '../services/topHolderTracker';
import type { PatternMatch, Prediction } from '../services/patternDetector';

// ═══════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════

export function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) return '?';
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  if (num >= 1) return num.toFixed(2);
  if (num >= 0.01) return num.toFixed(4);
  return num.toFixed(6);
}

export function formatPercent(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) return '0.0%';
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(1)}%`;
}

export function formatPrice(price: number | undefined | null): string {
  if (price === undefined || price === null || isNaN(price)) return '$?';
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.0001) return `$${price.toFixed(6)}`;
  if (price > 0) return `$${price.toExponential(2)}`;
  return '$0';
}

export function getRiskEmoji(level: RiskLevel): string {
  const map: Record<string, string> = {
    LOW: '🟢', MEDIUM: '🟡', HIGH: '🟠', VERY_HIGH: '🔴', EXTREME: '⛔'
  };
  return map[level] || '⚪';
}

export function getPriceEmoji(change: number): string {
  if (change >= 50) return '🚀';
  if (change >= 10) return '📈';
  if (change >= 0) return '▲';
  if (change >= -10) return '▼';
  if (change >= -50) return '📉';
  return '💀';
}

export function truncateAddress(address: string, chars: number = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// ═══════════════════════════════════════════
// MAIN MENU
// ═══════════════════════════════════════════

export function formatMainMenu(): string {
  return [
    `<b>◆ SOLANA MEMECOIN BOT</b>`,
    ``,
    `Real-time token monitoring on Solana.`,
    ``,
    `<b>◆ Features</b>`,
    `• Live alerts from Raydium, Pump.fun, Jupiter`,
    `• Token analysis with risk scoring`,
    `• Smart money & whale tracking`,
    `• Watchlist with price alerts`,
    `• Backtesting strategies`,
    ``,
    `Select an option:`,
  ].join('\n');
}

// ═══════════════════════════════════════════
// TOKEN ALERTS (Compact)
// ═══════════════════════════════════════════

export interface MLPrediction {
  rugProbability: number;
  confidence: number;
  recommendation: string;
}

export function formatTokenAlert(
  analysis: TokenAnalysis,
  dexData?: DexScreenerPair,
  mlPrediction?: MLPrediction
): string {
  const { token, liquidity, holders, contract, social, smartMoney, risk } = analysis;

  const price = dexData?.priceUsd ? parseFloat(dexData.priceUsd) : 0;
  const change = dexData?.priceChange?.h24 || 0;
  const vol = dexData?.volume?.h24 || 0;
  const mcap = dexData?.marketCap || 0;

  // Header based on risk
  const header = risk.level === 'LOW' ? '🎯 GEM FOUND' :
                 risk.level === 'MEDIUM' ? '👀 NEW TOKEN' :
                 risk.level === 'HIGH' ? '⚠️ RISKY' : '🚨 DEGEN';

  const lines = [
    `${getRiskEmoji(risk.level)} <b>${header}</b>`,
    ``,
    `<b>${token.symbol}</b> • ${token.name}`,
    `<code>${token.mint}</code>`,
    ``,
    // Market line
    price > 0 ? `${formatPrice(price)} ${getPriceEmoji(change)} ${formatPercent(change)}` : null,
    // Stats line
    `💧 $${formatNumber(liquidity.totalLiquidityUsd)} ${liquidity.lpBurned ? '🔥' : liquidity.lpLocked ? '🔒' : '⚠️'}` +
    (mcap && mcap > 0 ? ` • MC $${formatNumber(mcap)}` : ''),
    vol > 0 ? `📊 Vol $${formatNumber(vol)} • ${holders.totalHolders > 0 ? formatNumber(holders.totalHolders) : '?'} holders` : null,
    ``,
    // Safety (compact)
    `${contract.mintAuthorityRevoked ? '✓' : '✗'} Mint ` +
    `${contract.freezeAuthorityRevoked ? '✓' : '✗'} Freeze ` +
    `${social.hasTwitter ? '✓' : '✗'} Social`,
  ];

  // Smart money (only if active)
  if (smartMoney && (smartMoney.netSmartMoney ?? 0) !== 0) {
    const netSm = smartMoney.netSmartMoney ?? 0;
    const sm = netSm > 0 ? `🐋 +${netSm}` : `🐋 ${netSm}`;
    lines.push(sm + ` smart money`);
  }

  // Risk factors (top 2 only)
  const failed = risk.factors.filter(f => !f.passed).slice(0, 2);
  if (failed.length > 0) {
    lines.push(``);
    failed.forEach(f => lines.push(`⚠ ${f.name}`));
  }

  // Score
  const badge = risk.score >= 70 ? '🏆' : risk.score >= 50 ? '👍' : risk.score >= 30 ? '🤔' : '💀';
  lines.push(``);
  lines.push(`${badge} <b>${risk.score}/100</b>`);

  return lines.filter(l => l !== null).join('\n');
}

// ═══════════════════════════════════════════
// FULL ANALYSIS (Compact)
// ═══════════════════════════════════════════

export function formatFullAnalysis(analysis: TokenAnalysis, dexData?: DexScreenerPair): string {
  const { token, liquidity, holders, contract, social, sentiment, smartMoney, risk } = analysis;

  const price = dexData?.priceUsd ? parseFloat(dexData.priceUsd) : 0;
  const change = dexData?.priceChange?.h24 || 0;

  const badge = risk.score >= 70 ? '🏆' : risk.score >= 50 ? '👍' : risk.score >= 30 ? '🤔' : '💀';

  const lines = [
    `🔍 <b>ANALYSIS</b>`,
    ``,
    `<b>${token.symbol}</b> • ${token.name}`,
    `<code>${token.mint}</code>`,
    ``,
    `${getRiskEmoji(risk.level)} ${badge} <b>${risk.score}/100</b> ${risk.level}`,
    ``,
    `<b>◆ Market</b>`,
    price > 0 ? `Price: ${formatPrice(price)} ${formatPercent(change)}` : `Price: ${formatPrice(price)}`,
    dexData?.marketCap && dexData.marketCap > 0 ? `MCap: $${formatNumber(dexData.marketCap)}` : null,
    `Liquidity: $${formatNumber(liquidity.totalLiquidityUsd)}`,
    dexData?.volume?.h24 && dexData.volume.h24 > 0 ? `Volume 24h: $${formatNumber(dexData.volume.h24)}` : null,
    ``,
    `<b>◆ Holders</b>`,
    `Total: ${holders.totalHolders > 0 ? formatNumber(holders.totalHolders) : '?'} • Top10: ${(holders.top10HoldersPercent ?? 0).toFixed(1)}%`,
    `Largest: ${(holders.largestHolderPercent ?? 0).toFixed(1)}% • Dev: ${(holders.devWalletPercent ?? 0).toFixed(1)}%`,
    ``,
    `<b>◆ Security</b>`,
    `${contract.mintAuthorityRevoked ? '✓' : '✗'} Mint revoked`,
    `${contract.freezeAuthorityRevoked ? '✓' : '✗'} Freeze revoked`,
    `${liquidity.lpBurned ? '✓ LP burned ' + liquidity.lpBurnedPercent.toFixed(0) + '%' : liquidity.lpLocked ? '✓ LP locked' : '✗ LP unlocked'}`,
    `${contract.isHoneypot ? '⛔ HONEYPOT' : '✓ Not honeypot'}`,
    ``,
    `<b>◆ Social</b>`,
    `${social.hasTwitter ? '✓' : '✗'} Twitter ${social.hasTelegram ? '✓' : '✗'} Telegram ${social.hasWebsite ? '✓' : '✗'} Web`,
  ];

  // Smart money
  if (smartMoney && ((smartMoney.smartBuys24h ?? 0) > 0 || (smartMoney.smartSells24h ?? 0) > 0)) {
    lines.push(``);
    lines.push(`<b>◆ Smart Money</b>`);
    const net = smartMoney.netSmartMoney ?? 0;
    const emoji = net > 0 ? '🐋' : net < 0 ? '🚨' : '⚪';
    lines.push(`${emoji} ${net > 0 ? '+' : ''}${net} net (${smartMoney.smartBuys24h ?? 0}B/${smartMoney.smartSells24h ?? 0}S)`);
  }

  // NOTE: Tracked smart money wallets section is added dynamically in /check command

  // Sentiment
  if (sentiment?.hasSentimentData) {
    lines.push(``);
    lines.push(`<b>◆ Sentiment</b>`);
    const score = sentiment.sentimentScore ?? 0;
    const label = score > 0.2 ? '🟢 Positive' :
                  score < -0.2 ? '🔴 Negative' : '⚪ Neutral';
    lines.push(`${label} (${sentiment.tweetCount ?? 0} tweets)`);
  }

  // Risk factors
  const failed = risk.factors.filter(f => !f.passed);
  if (failed.length > 0) {
    lines.push(``);
    lines.push(`<b>◆ Risks</b>`);
    failed.slice(0, 4).forEach(f => lines.push(`⚠ ${f.name}`));
  }

  return lines.filter(l => l !== null).join('\n');
}

export function formatDexScreenerAnalysis(dexData: DexScreenerPair): string {
  const price = parseFloat(dexData.priceUsd || '0');
  const change = dexData.priceChange?.h24 ?? 0;

  return [
    `📊 <b>QUICK SCAN</b>`,
    ``,
    `<b>${dexData.baseToken.symbol}</b> • ${dexData.baseToken.name}`,
    `<code>${dexData.baseToken.address}</code>`,
    ``,
    `Price: ${formatPrice(price)} ${formatPercent(change)}`,
    dexData.marketCap && dexData.marketCap > 0 ? `MCap: $${formatNumber(dexData.marketCap)}` : null,
    `Liquidity: $${formatNumber(dexData.liquidity?.usd ?? 0)}`,
    dexData.volume?.h24 && dexData.volume.h24 > 0 ? `Volume 24h: $${formatNumber(dexData.volume.h24)}` : null,
    ``,
    `Buys: ${dexData.txns?.h24?.buys ?? 0} • Sells: ${dexData.txns?.h24?.sells ?? 0}`,
    dexData.pairCreatedAt ? `Age: ${timeAgo(dexData.pairCreatedAt)}` : null,
    ``,
    `<i>⚠ RPC limit - basic data only</i>`,
  ].filter(l => l !== null).join('\n');
}

// ═══════════════════════════════════════════
// WATCHLIST (Compact)
// ═══════════════════════════════════════════

export function formatWatchlistAlert(token: WatchedToken): string {
  const change = token.priceChangePercent ?? 0;
  const emoji = change >= 0 ? '📈' : '📉';

  return [
    `${emoji} <b>${token.symbol}</b> ${formatPercent(change)}`,
    ``,
    `${formatPrice(token.addedPrice ?? 0)} → ${formatPrice(token.lastPrice ?? 0)}`,
  ].join('\n');
}

export function formatWatchlist(tokens: WatchedToken[]): string {
  if (tokens.length === 0) {
    return [
      `⭐ <b>WATCHLIST</b>`,
      ``,
      `Empty. Use /watch [address] to add.`,
    ].join('\n');
  }

  const lines = [`⭐ <b>WATCHLIST</b> (${tokens.length})`, ``];

  tokens.forEach((token, i) => {
    const change = token.priceChangePercent ?? 0;
    const emoji = change >= 0 ? '▲' : '▼';
    lines.push(
      `${i + 1}. <b>${token.symbol}</b> ${emoji} ${formatPercent(change)}`
    );
  });

  return lines.join('\n');
}

// ═══════════════════════════════════════════
// MARKET / DISCOVERY (Compact)
// ═══════════════════════════════════════════

export function formatTrendingList(tokens: TrendingToken[], title: string): string {
  if (tokens.length === 0) {
    return `${title}\n\nNo data.`;
  }

  const lines = [title, ``];

  tokens.slice(0, 10).forEach((token, i) => {
    const emoji = getPriceEmoji(token.priceChange24h ?? 0);
    lines.push(
      `${i + 1}. <b>${token.symbol}</b> ${emoji} ${formatPercent(token.priceChange24h)}`
    );
    lines.push(
      `   ${formatPrice(token.priceUsd)} • V:$${formatNumber(token.volume24h)}`
    );
  });

  return lines.join('\n');
}

export interface SmartMoneyPick extends TrendingToken {
  smartMoney: SmartMoneyActivity;
}

export function formatSmartMoneyList(tokens: SmartMoneyPick[], title: string): string {
  if (tokens.length === 0) {
    return `${title}\n\nNo activity.`;
  }

  const lines = [title, ``];

  tokens.slice(0, 8).forEach((token, i) => {
    const sm = token.smartMoney;
    const emoji = (sm.netSmartMoney ?? 0) > 0 ? '🐋' : '🚨';
    lines.push(
      `${i + 1}. ${emoji} <b>${token.symbol}</b> ${formatPercent(token.priceChange24h)}`
    );
    const netSm = sm.netSmartMoney ?? 0;
    lines.push(
      `   +${sm.smartBuys24h ?? 0}B/-${sm.smartSells24h ?? 0}S = <b>${netSm > 0 ? '+' : ''}${netSm}</b>`
    );
  });

  lines.push(``);
  lines.push(`<i>Data: GMGN.ai</i>`);

  return lines.join('\n');
}

// ═══════════════════════════════════════════
// SETTINGS (Compact)
// ═══════════════════════════════════════════

export function formatSettings(settings: FilterSettings): string {
  const icons: Record<string, string> = {
    sniper: '🎯', early: '⚡', balanced: '⚖️', conservative: '🛡️',
    degen: '🎰', whale: '🐋', trending: '🔥', fresh: '🆕',
    micro: '💎', small: '🥉', mid: '🥈', large: '🥇', custom: '⚙️',
  };

  const lines = [
    `⚙️ <b>SETTINGS</b>`,
    ``,
    `Profile: ${icons[settings.profile] || ''} ${settings.profile}`,
    `Alerts: ${settings.alertsEnabled ? '🔔 On' : '🔕 Off'}`,
    ``,
    `<b>◆ Filters</b>`,
    `Liquidity: $${formatNumber(settings.minLiquidity)}${settings.maxLiquidity ? ' - $' + formatNumber(settings.maxLiquidity) : '+'}`,
    `Top10 max: ${settings.maxTop10Percent}%`,
    `Min holders: ${settings.minHolders}`,
    `Min score: ${settings.minRiskScore}`,
  ];

  // Add smart money filters if set
  if (settings.minSmartBuys || settings.minSmartFlow || settings.requireSmartMoney) {
    lines.push(``);
    lines.push(`<b>◆ Smart Money 🐋</b>`);
    if (settings.minSmartBuys) lines.push(`Min buys: ${settings.minSmartBuys}`);
    if (settings.minSmartFlow) lines.push(`Min flow: ${settings.minSmartFlow > 0 ? '+' : ''}${settings.minSmartFlow}`);
    if (settings.requireSmartMoney) lines.push(`Required: ✓`);
  }

  lines.push(``);
  lines.push(`<b>◆ Requirements</b>`);
  lines.push(`${settings.requireMintRevoked ? '✓' : '✗'} Mint revoked`);
  lines.push(`${settings.requireFreezeRevoked ? '✓' : '✗'} Freeze revoked`);
  lines.push(`${settings.requireLPBurned ? '✓' : '✗'} LP burned`);
  lines.push(`${settings.requireSocials ? '✓' : '✗'} Has socials`);

  return lines.join('\n');
}

export function formatFilterProfile(profile: string): string {
  const profiles: Record<string, string> = {
    sniper: `🎯 <b>SNIPER</b>\nMax risk, instant alerts\nLiq $100+ • No safety checks`,
    early: `⚡ <b>EARLY</b>\nEarly entry, basic safety\nLiq $500+ • Mint revoked`,
    balanced: `⚖️ <b>BALANCED</b>\nBalanced risk/reward\nLiq $2K+ • Score 50+ • 25 holders`,
    conservative: `🛡️ <b>CONSERVATIVE</b>\nSafe plays only\nLiq $10K+ • Smart money • All safety checks`,
    degen: `🎰 <b>DEGEN</b>\nEverything. DYOR.\nLiq $50+ • No limits`,
    whale: `🐋 <b>WHALE</b>\nSmart money focus\nLiq $5K+ • Vol $50K+ • 3+ smart buys`,
    trending: `🔥 <b>TRENDING</b>\nVolume spikes + smart money\nLiq $2K+ • 3x volume • 2+ smart buys`,
    fresh: `🆕 <b>FRESH</b>\nNew tokens only\nMax age 5min • Fast mode`,
    micro: `💎 <b>MICRO</b>\n$1K-$50K mcap gems`,
    small: `🥉 <b>SMALL</b>\n$50K-$500K mcap`,
    mid: `🥈 <b>MID</b>\n$500K-$5M mcap`,
    large: `🥇 <b>LARGE</b>\n$5M-$50M mcap`,
    graduation: `🎓 <b>GRADUATION</b>\nPump.fun near migration\n70-95% bonding curve`,
    cto: `🔍 <b>CTO</b>\nCommunity takeovers\nAge 1-7d • $10K-$250K mcap`,
    momentum: `📈 <b>MOMENTUM</b>\nPrice + volume up\n+50% 1h • 2x volume`,
    revival: `💀 <b>REVIVAL</b>\nDown 80%+ comebacks`,
  };

  return profiles[profile] || `⚙️ <b>${profile.toUpperCase()}</b>`;
}

// ═══════════════════════════════════════════
// HELP (Compact)
// ═══════════════════════════════════════════

export function formatHelp(): string {
  return [
    `<b>◆ COMMANDS</b>`,
    ``,
    `/menu • Main menu`,
    `/check [addr] • Analyze token`,
    `/watch [addr] • Add to watchlist`,
    `/trending • Hot tokens`,
    `/smartmoney • Whale activity`,
    `/filter [profile] • Set filter`,
    `/alerts on|off • Toggle alerts`,
    `/settings • View settings`,
    ``,
    `<i>Tip: Use buttons for navigation</i>`,
  ].join('\n');
}

export function formatStats(stats: {
  tokensAnalyzed: number;
  alertsSent: number;
  uptime: number;
  watchlistCount: number;
  monitorsActive: string[];
}): string {
  const hours = Math.floor(stats.uptime / 3600000);
  const mins = Math.floor((stats.uptime % 3600000) / 60000);

  return [
    `📈 <b>STATS</b>`,
    ``,
    `Uptime: ${hours}h ${mins}m`,
    `Analyzed: ${stats.tokensAnalyzed}`,
    `Alerts: ${stats.alertsSent}`,
    `Watching: ${stats.watchlistCount}`,
    ``,
    `Monitors: ${stats.monitorsActive.join(', ')}`,
  ].join('\n');
}

// ═══════════════════════════════════════════
// CHART MESSAGE
// ═══════════════════════════════════════════

export function formatChartMessage(symbol: string, mint: string): string {
  return [
    `📊 <b>${symbol} CHART</b>`,
    ``,
    `<a href="https://dexscreener.com/solana/${mint}">Open live chart</a>`,
  ].join('\n');
}

// ═══════════════════════════════════════════
// MARKET OVERVIEW
// ═══════════════════════════════════════════

export function formatMarketMenu(): string {
  return [
    `📊 <b>MARKET</b>`,
    ``,
    `Select a view:`,
  ].join('\n');
}

// ═══════════════════════════════════════════
// ALERTS MENU
// ═══════════════════════════════════════════

export function formatAlertsMenu(enabled: boolean, mutedUntil?: number): string {
  const status = enabled ? '🔔 Alerts are <b>ON</b>' : '🔕 Alerts are <b>OFF</b>';
  const muted = mutedUntil && mutedUntil > Date.now()
    ? `\n⏸ Muted for ${Math.ceil((mutedUntil - Date.now()) / 60000)}m`
    : '';

  return [
    `🔔 <b>ALERTS</b>`,
    ``,
    status + muted,
  ].join('\n');
}

// ═══════════════════════════════════════════
// ANALYZE MENU
// ═══════════════════════════════════════════

export function formatAnalyzeMenu(): string {
  return [
    `🔍 <b>ANALYZE</b>`,
    ``,
    `Send a token address to analyze.`,
    ``,
    `<i>Paste address or reply with /check [addr]</i>`,
  ].join('\n');
}

// Utility exports for backwards compatibility
export function getSentimentEmoji(score: number): string {
  if (score > 0.2) return '🟢';
  if (score < -0.2) return '🔴';
  return '⚪';
}

export function getSentimentLabel(score: number): string {
  if (score > 0.5) return 'Very Positive';
  if (score > 0.2) return 'Positive';
  if (score >= -0.2) return 'Neutral';
  if (score >= -0.5) return 'Negative';
  return 'Very Negative';
}

export function getSmartMoneyEmoji(netBuys: number): string {
  if (netBuys >= 3) return '🐋';
  if (netBuys >= 1) return '👀';
  if (netBuys === 0) return '⚪';
  return '🚨';
}

export function formatSmartMoney(smartMoney: SmartMoneyActivity): string {
  const net = smartMoney.netSmartMoney;
  return `${net > 0 ? '+' : ''}${net} (${smartMoney.smartBuys24h}B/${smartMoney.smartSells24h}S)`;
}

/**
 * Format tracked smart money wallet activity for a token
 */
export function formatTrackedSmartMoneyActivity(activity: {
  holders: string[];
  recentBuys: any[];
  recentSells: any[];
}): string | null {
  const { holders, recentBuys, recentSells } = activity;

  // Only show if there's activity
  if (holders.length === 0 && recentBuys.length === 0 && recentSells.length === 0) {
    return null;
  }

  const lines: string[] = [];
  lines.push(`<b>🎯 Tracked Wallets</b>`);

  // Show holders
  if (holders.length > 0) {
    lines.push(`${holders.length} tracked wallet${holders.length > 1 ? 's' : ''} holding`);
  }

  // Show recent buys
  if (recentBuys.length > 0) {
    const buyCount = recentBuys.length;
    lines.push(`🟢 ${buyCount} recent buy${buyCount > 1 ? 's' : ''} (24h)`);
  }

  // Show recent sells
  if (recentSells.length > 0) {
    const sellCount = recentSells.length;
    lines.push(`🔴 ${sellCount} recent sell${sellCount > 1 ? 's' : ''} (24h)`);
  }

  // Add insight
  if (recentBuys.length > recentSells.length) {
    lines.push(`💡 Smart money accumulating`);
  } else if (recentSells.length > recentBuys.length) {
    lines.push(`⚠️ Smart money exiting`);
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════
// TRADING SIGNALS
// ═══════════════════════════════════════════

export function getSignalEmoji(type: string): string {
  switch (type) {
    case 'BUY': return '🟢';
    case 'SELL': return '🔴';
    case 'TAKE_PROFIT': return '🎯';
    case 'STOP_LOSS': return '🛑';
    default: return '📊';
  }
}

export function formatSignalAlert(signal: TradingSignal): string {
  const emoji = getSignalEmoji(signal.type);
  const header = signal.type === 'BUY' ? 'BUY SIGNAL' :
                 signal.type === 'SELL' ? 'SELL SIGNAL' :
                 signal.type === 'TAKE_PROFIT' ? 'TAKE PROFIT' : 'STOP LOSS';

  const lines = [
    `${emoji} <b>${header}</b>`,
    ``,
    `<b>${signal.symbol}</b>${signal.name ? ` • ${signal.name}` : ''}`,
    `<code>${signal.mint}</code>`,
    ``,
    `Confidence: <b>${signal.confidence}%</b>`,
    `Entry: ${formatPrice(signal.entryPrice)}`,
  ];

  if (signal.type === 'BUY') {
    if (signal.targetPrice) {
      const targetPct = ((signal.targetPrice / signal.entryPrice - 1) * 100).toFixed(0);
      lines.push(`Target: ${formatPrice(signal.targetPrice)} (+${targetPct}%)`);
    }
    if (signal.stopLossPrice) {
      const stopPct = ((signal.stopLossPrice / signal.entryPrice - 1) * 100).toFixed(0);
      lines.push(`Stop: ${formatPrice(signal.stopLossPrice)} (${stopPct}%)`);
    }
  }

  lines.push(``);
  lines.push(`<b>◆ Metrics</b>`);
  lines.push(`Risk: ${signal.riskScore}/100 • Rug: ${(signal.rugProbability * 100).toFixed(0)}%`);
  lines.push(`Smart $: ${(signal.smartMoneyScore * 100).toFixed(0)}% • Mom: ${(signal.momentumScore * 100).toFixed(0)}%`);

  // Position size
  lines.push(``);
  const sizeStr = signal.positionSizeType === 'percentage'
    ? `${signal.suggestedPositionSize}% of portfolio`
    : `${signal.suggestedPositionSize} SOL`;
  lines.push(`Position: ${sizeStr}`);

  // Reasons (top 3)
  if (signal.reasons.length > 0) {
    lines.push(``);
    lines.push(`<b>◆ Reasons</b>`);
    signal.reasons.slice(0, 3).forEach(r => lines.push(`✓ ${r}`));
  }

  // Warnings (top 2)
  if (signal.warnings.length > 0) {
    lines.push(``);
    signal.warnings.slice(0, 2).forEach(w => lines.push(`⚠ ${w}`));
  }

  // Expiry
  const expiresIn = Math.max(0, signal.expiresAt - Math.floor(Date.now() / 1000));
  const expiryStr = expiresIn < 60 ? `${expiresIn}s` :
                    expiresIn < 3600 ? `${Math.floor(expiresIn / 60)}m` :
                    `${Math.floor(expiresIn / 3600)}h`;
  lines.push(``);
  lines.push(`<i>Expires in ${expiryStr} • ID: ${signal.id.slice(0, 8)}</i>`);

  return lines.join('\n');
}

export function formatSignalList(signals: TradingSignal[], title: string = '📊 ACTIVE SIGNALS'): string {
  if (signals.length === 0) {
    return [
      `<b>${title}</b>`,
      ``,
      `No active signals.`,
    ].join('\n');
  }

  const lines = [`<b>${title}</b> (${signals.length})`, ``];

  signals.slice(0, 10).forEach((signal, i) => {
    const emoji = getSignalEmoji(signal.type);
    const age = timeAgo(signal.generatedAt * 1000);
    lines.push(
      `${i + 1}. ${emoji} <b>${signal.symbol}</b> • ${signal.confidence}%`
    );
    lines.push(
      `   ${formatPrice(signal.entryPrice)} • ${age} ago`
    );
  });

  return lines.join('\n');
}

export function formatSignalPerformance(metrics: SignalPerformanceMetrics | {
  totalSignals: number;
  activeSignals: number;
  executedSignals: number;
  accurateSignals: number;
  avgProfitLoss: number;
}): string {
  // Handle simple stats from database
  if ('executedSignals' in metrics && !('winRate' in metrics)) {
    const winRate = metrics.executedSignals > 0
      ? (metrics.accurateSignals / metrics.executedSignals) * 100
      : 0;

    return [
      `📈 <b>SIGNAL PERFORMANCE</b>`,
      ``,
      `<b>◆ Overview</b>`,
      `Total: ${metrics.totalSignals} • Active: ${metrics.activeSignals}`,
      `Executed: ${metrics.executedSignals}`,
      ``,
      `<b>◆ Results</b>`,
      `Win rate: <b>${winRate.toFixed(1)}%</b>`,
      `Accurate: ${metrics.accurateSignals}/${metrics.executedSignals}`,
      `Avg P&L: ${metrics.avgProfitLoss >= 0 ? '+' : ''}${metrics.avgProfitLoss.toFixed(1)}%`,
    ].join('\n');
  }

  // Full metrics format
  const fullMetrics = metrics as SignalPerformanceMetrics;
  return [
    `📈 <b>SIGNAL PERFORMANCE</b>`,
    ``,
    `<b>◆ Overview</b>`,
    `Total: ${fullMetrics.totalSignals} • Active: ${fullMetrics.activeSignals}`,
    `With outcome: ${fullMetrics.signalsWithOutcome}`,
    ``,
    `<b>◆ Results</b>`,
    `Win rate: <b>${fullMetrics.winRate.toFixed(1)}%</b>`,
    `Avg return: ${fullMetrics.averageReturn >= 0 ? '+' : ''}${fullMetrics.averageReturn.toFixed(1)}%`,
    `Best: +${fullMetrics.bestReturn.toFixed(1)}% • Worst: ${fullMetrics.worstReturn.toFixed(1)}%`,
    ``,
    `<b>◆ By Type</b>`,
    `BUY: ${fullMetrics.buySignals.total} (${fullMetrics.buySignals.winRate.toFixed(0)}% win)`,
    `SELL: ${fullMetrics.sellSignals.total} (${fullMetrics.sellSignals.winRate.toFixed(0)}% win)`,
    ``,
    `<b>◆ Activity</b>`,
    `Last 24h: ${fullMetrics.signalsLast24h}`,
    `Last 7d: ${fullMetrics.signalsLast7d}`,
  ].join('\n');
}

export function formatWebhookList(webhooks: WebhookConfig[]): string {
  if (webhooks.length === 0) {
    return [
      `🔗 <b>WEBHOOKS</b>`,
      ``,
      `No webhooks configured.`,
      ``,
      `Use /webhook add [url] to add one.`,
    ].join('\n');
  }

  const lines = [`🔗 <b>WEBHOOKS</b> (${webhooks.length})`, ``];

  webhooks.forEach((webhook, i) => {
    const status = webhook.enabled ? '✓' : '✗';
    lines.push(`${i + 1}. ${status} <b>${webhook.name}</b>`);
    lines.push(`   Events: ${webhook.events.join(', ')}`);
    lines.push(`   Min confidence: ${webhook.minConfidence}%`);
    lines.push(`   Sent: ${webhook.totalSent} • Fails: ${webhook.failureCount}`);
    lines.push(``);
  });

  return lines.join('\n');
}

// ═══════════════════════════════════════════
// ML TRAINING STATUS
// ═══════════════════════════════════════════

export function formatMLStatus(status: {
  isTraining: boolean;
  lastTrainingAt?: number;
  totalSamples: number;
  newSamplesSinceLastTrain: number;
  nextTrainingEligible: boolean;
  activeModelVersion?: string;
  modelLoaded?: boolean;
  sampleCounts?: { labeled: number; byOutcome: Record<string, number> };
  metrics?: {
    accuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
  };
}): string {
  const lastTrained = status.lastTrainingAt
    ? timeAgo(status.lastTrainingAt)
    : 'Never';

  const lines = [
    `🤖 <b>ML STATUS</b>`,
    ``,
    `<b>◆ Model</b>`,
    status.activeModelVersion ? `Version: ${status.activeModelVersion}` : 'No model active',
    `Status: ${status.isTraining ? '🔄 Training...' : status.modelLoaded ? '✓ Ready' : '⚠ Not loaded'}`,
    ``,
    `<b>◆ Data</b>`,
    `Total samples: ${status.sampleCounts?.labeled ?? status.totalSamples}`,
    `New samples: ${status.newSamplesSinceLastTrain}`,
    `Last trained: ${lastTrained}`,
  ];

  if (status.metrics) {
    lines.push(``);
    lines.push(`<b>◆ Metrics</b>`);
    lines.push(`Accuracy: ${(status.metrics.accuracy * 100).toFixed(1)}%`);
    lines.push(`Precision: ${(status.metrics.precision * 100).toFixed(1)}%`);
    lines.push(`Recall: ${(status.metrics.recall * 100).toFixed(1)}%`);
    lines.push(`F1 Score: ${(status.metrics.f1Score * 100).toFixed(1)}%`);
  }

  lines.push(``);
  lines.push(status.nextTrainingEligible
    ? `✓ Ready for training`
    : `⏳ Not ready for training`);

  return lines.join('\n');
}

export function formatPendingLabels(tokens: Array<{
  mint: string;
  symbol?: string;
  priceChangePercent?: number;
  suggestedLabel?: string;
  suggestConfidence?: number;
}>): string {
  if (tokens.length === 0) {
    return [
      `🏷 <b>PENDING LABELS</b>`,
      ``,
      `No tokens pending.`,
    ].join('\n');
  }

  const lines = [`🏷 <b>PENDING LABELS</b> (${tokens.length})`, ``];

  tokens.slice(0, 10).forEach((token, i) => {
    const symbol = token.symbol || token.mint.slice(0, 8);
    const change = token.priceChangePercent !== undefined
      ? ` ${formatPercent(token.priceChangePercent)}`
      : '';
    const suggestion = token.suggestedLabel
      ? ` → ${token.suggestedLabel} (${((token.suggestConfidence || 0) * 100).toFixed(0)}%)`
      : '';

    lines.push(`${i + 1}. <b>${symbol}</b>${change}${suggestion}`);
  });

  lines.push(``);
  lines.push(`Use /ml label [mint] [rug|pump|stable|decline]`);

  return lines.join('\n');
}

export function formatTrainingHistory(runs: Array<{
  model_version: string;
  accuracy: number;
  f1_score: number;
  samples_used: number;
  trained_at: number;
  is_active: boolean;
}>): string {
  if (runs.length === 0) {
    return [
      `📜 <b>TRAINING HISTORY</b>`,
      ``,
      `No training runs yet.`,
    ].join('\n');
  }

  const lines = [`📜 <b>TRAINING HISTORY</b>`, ``];

  runs.slice(0, 5).forEach((run, i) => {
    const active = run.is_active ? ' ✓' : '';
    const age = timeAgo(run.trained_at * 1000);
    lines.push(
      `${i + 1}. <b>${run.model_version}</b>${active}`
    );
    lines.push(
      `   Acc: ${(run.accuracy * 100).toFixed(1)}% • F1: ${(run.f1_score * 100).toFixed(1)}%`
    );
    lines.push(
      `   Samples: ${run.samples_used} • ${age} ago`
    );
    lines.push(``);
  });

  return lines.join('\n');
}


// -------------------------------------------
// LIQUIDITY ALERTS
// -------------------------------------------

export function formatLiquidityAlert(alert: LiquidityAlert): string {
  const emojiMap = {
    drain: alert.severity === 'critical' ? '🚨' : '⚠️',
    unlock: '🔓',
    burn_change: '🔥',
    locker_expiry: '⏰',
  };

  const emoji = emojiMap[alert.type];
  const title = alert.type === 'drain' ? 'LIQUIDITY DRAIN' :
                alert.type === 'unlock' ? 'LP UNLOCKED' :
                alert.type === 'burn_change' ? 'LP BURN CHANGE' :
                'LOCKER EXPIRY';

  const lines = [
    `${emoji} <b>${title}</b>`,
    ``,
    `<b>${alert.symbol}</b>`,
    alert.message,
  ];

  // Add details
  if (alert.details.percentChange !== undefined && alert.details.percentChange !== null) {
    const change = alert.details.percentChange;
    lines.push(`Change: ${formatPercent(change)}`);
  }

  if (alert.details.drainedUsd !== undefined && alert.details.drainedUsd !== null) {
    lines.push(`Drained: $${formatNumber(alert.details.drainedUsd)}`);
  }

  if (alert.details.before?.liquidityUsd !== undefined && alert.details.after?.liquidityUsd !== undefined) {
    lines.push(``);
    lines.push(`Before: $${formatNumber(alert.details.before.liquidityUsd)}`);
    lines.push(`After: $${formatNumber(alert.details.after.liquidityUsd)}`);
  }

  lines.push(``);
  lines.push(`<code>${alert.tokenMint}</code>`);

  if (alert.severity === 'critical') {
    lines.push(``);
    lines.push(`🚨 <b>CRITICAL - Consider selling immediately</b>`);
  }

  return lines.join('\n');
}



// -------------------------------------------
// DEV WALLET BEHAVIOR ALERTS
// -------------------------------------------

export function formatDevBehaviorAlert(alert: { type: string; severity: string; symbol: string; devAddress: string; message: string; details: any }): string {
  const emojiMap: Record<string, string> = {
    first_sell: '⚠️',
    large_dump: '🚨',
    rapid_selling: '📉',
    complete_exit: '💀',
  };

  const emoji = emojiMap[alert.type] || '⚠️';
  const title = alert.type === 'first_sell' ? 'DEV FIRST SELL' :
                alert.type === 'large_dump' ? 'DEV DUMP' :
                alert.type === 'rapid_selling' ? 'RAPID SELLING' :
                'DEV EXIT';

  const lines = [
    `${emoji} <b>${title}</b>`,
    ``,
    `<b>${alert.symbol}</b>`,
    alert.message,
    ``,
    `Dev: <code>${truncateAddress(alert.devAddress)}</code>`,
  ];

  if (alert.details.soldPercent !== undefined && alert.details.soldPercent !== null) {
    lines.push(`Sold: ${alert.details.soldPercent.toFixed(1)}%`);
  }

  if (alert.details.currentHolding !== undefined && alert.details.currentHolding !== null) {
    lines.push(`Remaining: ${alert.details.currentHolding.toFixed(1)}%`);
  }

  if (alert.details.sellCount !== undefined && alert.details.sellCount !== null) {
    lines.push(`Sell count: ${alert.details.sellCount}`);
  }

  if (alert.severity === 'critical') {
    lines.push(``);
    lines.push(`🚨 <b>CRITICAL - High rug risk</b>`);
  }

  return lines.join('\n');
}



// -------------------------------------------
// BUNDLED WALLET ALERTS
// -------------------------------------------

export function formatBundleAlert(alert: { type: string; severity: string; symbol: string; message: string; details: any }): string {
  const emoji = alert.severity === 'critical' ? '🚨' : '⚠️';
  const title = 'BUNDLED WALLETS DETECTED';

  const lines = [
    `${emoji} <b>${title}</b>`,
    ``,
    `<b>${alert.symbol}</b>`,
    alert.message,
    ``,
  ];

  if (alert.details.walletsInBundle !== undefined && alert.details.walletsInBundle !== null) {
    lines.push(`Wallets in bundle: ${alert.details.walletsInBundle}`);
  }

  if (alert.details.totalPercent !== undefined && alert.details.totalPercent !== null) {
    lines.push(`Total held: ${alert.details.totalPercent.toFixed(1)}%`);
  }

  if (alert.details.creationSlot !== undefined && alert.details.creationSlot !== null) {
    lines.push(`Creation slot: ${alert.details.creationSlot}`);
  }

  if (alert.details.fundingSource) {
    lines.push(``);
    lines.push(`Funding source: <code>${truncateAddress(alert.details.fundingSource)}</code>`);
  }

  if (alert.severity === 'critical') {
    lines.push(``);
    lines.push(`🚨 <b>CRITICAL - Possible Sybil attack</b>`);
  } else {
    lines.push(``);
    lines.push(`⚠️ Suspicious wallet creation pattern - proceed with caution`);
  }

  return lines.join('\n');
}



// -------------------------------------------
// TOP HOLDER CHANGE ALERTS
// -------------------------------------------

export function formatHolderChangeAlert(alert: { type: string; severity: string; symbol: string; walletAddress: string; message: string; details: any }): string {
  const emojiMap: Record<string, string> = {
    whale_accumulation: '🐋💎',
    whale_dump: '🐋💀',
    new_whale: '🐋',
    whale_exit: '👋',
    rank_change: '📊',
  };

  const emoji = emojiMap[alert.type] || '📊';
  const title = alert.type === 'whale_accumulation' ? 'WHALE ACCUMULATION' :
                alert.type === 'whale_dump' ? 'WHALE DUMP' :
                alert.type === 'new_whale' ? 'NEW WHALE' :
                alert.type === 'whale_exit' ? 'WHALE EXIT' :
                'RANK CHANGE';

  const lines = [
    `${emoji} <b>${title}</b>`,
    ``,
    `<b>${alert.symbol}</b>`,
    alert.message,
    ``,
    `Wallet: <code>${truncateAddress(alert.walletAddress)}</code>`,
  ];

  if (alert.details.oldPercent !== undefined && alert.details.oldPercent !== null &&
      alert.details.newPercent !== undefined && alert.details.newPercent !== null) {
    lines.push(`Position: ${alert.details.oldPercent.toFixed(1)}% → ${alert.details.newPercent.toFixed(1)}%`);
  } else if (alert.details.newPercent !== undefined && alert.details.newPercent !== null) {
    lines.push(`Position: ${alert.details.newPercent.toFixed(1)}%`);
  }

  if (alert.details.oldRank !== undefined && alert.details.oldRank !== null &&
      alert.details.newRank !== undefined && alert.details.newRank !== null) {
    lines.push(`Rank: #${alert.details.oldRank} → #${alert.details.newRank}`);
  } else if (alert.details.newRank !== undefined && alert.details.newRank !== null) {
    lines.push(`Rank: #${alert.details.newRank}`);
  }

  if (alert.severity === 'critical') {
    lines.push(``);
    lines.push(`🚨 <b>Large dump detected - consider selling</b>`);
  } else if (alert.type === 'whale_accumulation' && (alert.details.percentChange ?? 0) > 3) {
    lines.push(``);
    lines.push(`💎 Whale loading up - bullish signal`);
  }

  return lines.join('\n');
}


// -------------------------------------------
// PATTERN ANALYSIS
// -------------------------------------------

export function formatPatternAnalysis(
  matches: PatternMatch[],
  prediction: Prediction,
  similarTokens?: any[]
): string {
  if (matches.length === 0) {
    return '';
  }

  const lines = [
    '',
    '<b>📊 Pattern Analysis</b>',
  ];

  // Top matches
  for (const match of matches.slice(0, 3)) {
    const emoji = match.patternType === 'success' ? '🚀' : '💀';
    lines.push(
      `${emoji} ${match.patternName} (${(match.matchScore * 100).toFixed(0)}% match, ${(match.successRate * 100).toFixed(0)}% success)`
    );
  }

  // Prediction
  lines.push('');
  const predEmoji = prediction.predictedOutcome === 'success' ? '🎯' :
                    prediction.predictedOutcome === 'rug' ? '🚨' : '⚪';
  lines.push(`${predEmoji} Prediction: ${(prediction.successProbability * 100).toFixed(0)}% success probability`);

  // Similar tokens
  if (similarTokens && similarTokens.length > 0) {
    lines.push('');
    lines.push('💎 Similar Successful Tokens:');
    for (const token of similarTokens.slice(0, 2)) {
      const multiplier = token.max_price && token.initial_price && token.initial_price > 0
        ? (token.max_price / token.initial_price).toFixed(1)
        : '?';
      const similarity = (token.similarity ?? 0) * 100;
      lines.push(`  • ${token.symbol || token.name || 'Unknown'} (${multiplier}x peak) - ${similarity.toFixed(0)}% similar`);
    }
  }

  return lines.join('\n');
}


/**
 * Format filter adjustment changes
 */
export function formatFilterAdjustment(action: 'tighten' | 'loosen', changes: Array<{ param: string; old: any; new: any }>): string {
  const emoji = action === 'tighten' ? '🔒' : '🔓';
  const actionText = action === 'tighten' ? 'Tightened' : 'Loosened';
  const lines = [
    ` <b>Filters `</b>`,
    '',
  ];
  for (const change of changes) {
    lines.push(`<b>`:</b> ` → ``);
  }
  return lines.join('\\n');
}

/**
 * Format filter performance stats
 */
export function formatFilterStats(perfData: any): string {
  const lines = [
    '📊 <b>Filter Performance</b>',
    '',
    `Tokens Passed: ``,
    `Tokens Filtered: ``,
    `Success Rate: ``,
    '',
    'Recent Adjustments:',
  ];
  if (perfData.recentChanges && perfData.recentChanges.length > 0) {
    for (const change of perfData.recentChanges.slice(0, 5)) {
      lines.push(`  • ` at ``);
    }
  } else {
    lines.push('  No recent changes');
  }
  return lines.join('\\n');
}
