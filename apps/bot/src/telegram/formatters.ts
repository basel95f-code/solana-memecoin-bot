import type {
  TokenAnalysis,
  RiskLevel,
  TrendingToken,
  WatchedToken,
  FilterSettings,
  DexScreenerPair,
  SmartMoneyActivity,
} from '../types';

// ═══════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════

export function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  if (num >= 1) return num.toFixed(2);
  return num.toFixed(6);
}

export function formatPercent(num: number): string {
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(1)}%`;
}

export function formatPrice(price: number): string {
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.0001) return `$${price.toFixed(6)}`;
  return `$${price.toExponential(2)}`;
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
    `💧 $${formatNumber(liquidity.totalLiquidityUsd)} ${liquidity.lpBurned ? '🔥' : liquidity.lpLocked ? '🔒' : ''}` +
    (mcap > 0 ? ` • MC $${formatNumber(mcap)}` : ''),
    vol > 0 ? `📊 Vol $${formatNumber(vol)} • ${holders.totalHolders > 0 ? holders.totalHolders : '?'} holders` : null,
    ``,
    // Safety (compact)
    `${contract.mintAuthorityRevoked ? '✓' : '✗'} Mint ` +
    `${contract.freezeAuthorityRevoked ? '✓' : '✗'} Freeze ` +
    `${social.hasTwitter ? '✓' : '✗'} Social`,
  ];

  // Smart money (only if active)
  if (smartMoney && smartMoney.netSmartMoney !== 0) {
    const sm = smartMoney.netSmartMoney > 0 ? `🐋 +${smartMoney.netSmartMoney}` : `🐋 ${smartMoney.netSmartMoney}`;
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
    price > 0 ? `Price: ${formatPrice(price)} ${formatPercent(change)}` : null,
    dexData?.marketCap ? `MCap: $${formatNumber(dexData.marketCap)}` : null,
    `Liquidity: $${formatNumber(liquidity.totalLiquidityUsd)}`,
    dexData?.volume?.h24 ? `Volume 24h: $${formatNumber(dexData.volume.h24)}` : null,
    ``,
    `<b>◆ Holders</b>`,
    `Total: ${holders.totalHolders || '?'} • Top10: ${holders.top10HoldersPercent.toFixed(1)}%`,
    `Largest: ${holders.largestHolderPercent.toFixed(1)}% • Dev: ${holders.devWalletPercent.toFixed(1)}%`,
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
  if (smartMoney && (smartMoney.smartBuys24h > 0 || smartMoney.smartSells24h > 0)) {
    lines.push(``);
    lines.push(`<b>◆ Smart Money</b>`);
    const net = smartMoney.netSmartMoney;
    const emoji = net > 0 ? '🐋' : net < 0 ? '🚨' : '⚪';
    lines.push(`${emoji} ${net > 0 ? '+' : ''}${net} net (${smartMoney.smartBuys24h}B/${smartMoney.smartSells24h}S)`);
  }

  // Sentiment
  if (sentiment?.hasSentimentData) {
    lines.push(``);
    lines.push(`<b>◆ Sentiment</b>`);
    const label = sentiment.sentimentScore > 0.2 ? '🟢 Positive' :
                  sentiment.sentimentScore < -0.2 ? '🔴 Negative' : '⚪ Neutral';
    lines.push(`${label} (${sentiment.tweetCount} tweets)`);
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
  const change = dexData.priceChange?.h24 || 0;

  return [
    `📊 <b>QUICK SCAN</b>`,
    ``,
    `<b>${dexData.baseToken.symbol}</b> • ${dexData.baseToken.name}`,
    `<code>${dexData.baseToken.address}</code>`,
    ``,
    `Price: ${formatPrice(price)} ${formatPercent(change)}`,
    dexData.marketCap ? `MCap: $${formatNumber(dexData.marketCap)}` : null,
    `Liquidity: $${formatNumber(dexData.liquidity?.usd || 0)}`,
    `Volume 24h: $${formatNumber(dexData.volume?.h24 || 0)}`,
    ``,
    `Buys: ${dexData.txns?.h24?.buys || 0} • Sells: ${dexData.txns?.h24?.sells || 0}`,
    dexData.pairCreatedAt ? `Age: ${timeAgo(dexData.pairCreatedAt)}` : null,
    ``,
    `<i>⚠ RPC limit - basic data only</i>`,
  ].filter(l => l !== null).join('\n');
}

// ═══════════════════════════════════════════
// WATCHLIST (Compact)
// ═══════════════════════════════════════════

export function formatWatchlistAlert(token: WatchedToken): string {
  const emoji = token.priceChangePercent >= 0 ? '📈' : '📉';

  return [
    `${emoji} <b>${token.symbol}</b> ${formatPercent(token.priceChangePercent)}`,
    ``,
    `${formatPrice(token.addedPrice)} → ${formatPrice(token.lastPrice)}`,
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
    const emoji = token.priceChangePercent >= 0 ? '▲' : '▼';
    lines.push(
      `${i + 1}. <b>${token.symbol}</b> ${emoji} ${formatPercent(token.priceChangePercent)}`
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
    const emoji = getPriceEmoji(token.priceChange24h);
    lines.push(
      `${i + 1}. <b>${token.symbol}</b> ${emoji} ${formatPercent(token.priceChange24h)}`
    );
    lines.push(
      `   $${formatNumber(token.priceUsd)} • V:$${formatNumber(token.volume24h)}`
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
    const emoji = sm.netSmartMoney > 0 ? '🐋' : '🚨';
    lines.push(
      `${i + 1}. ${emoji} <b>${token.symbol}</b> ${formatPercent(token.priceChange24h)}`
    );
    lines.push(
      `   +${sm.smartBuys24h}B/-${sm.smartSells24h}S = <b>${sm.netSmartMoney > 0 ? '+' : ''}${sm.netSmartMoney}</b>`
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

  return [
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
    ``,
    `<b>◆ Requirements</b>`,
    `${settings.requireMintRevoked ? '✓' : '✗'} Mint revoked`,
    `${settings.requireFreezeRevoked ? '✓' : '✗'} Freeze revoked`,
    `${settings.requireLPBurned ? '✓' : '✗'} LP burned`,
    `${settings.requireSocials ? '✓' : '✗'} Has socials`,
  ].join('\n');
}

export function formatFilterProfile(profile: string): string {
  const profiles: Record<string, string> = {
    sniper: `🎯 <b>SNIPER</b>\nMax risk, instant alerts\nLiq $100+ • No safety checks`,
    early: `⚡ <b>EARLY</b>\nEarly entry, basic safety\nLiq $500+ • Mint revoked`,
    balanced: `⚖️ <b>BALANCED</b>\nBalanced risk/reward\nLiq $2K+ • Score 50+ • 25 holders`,
    conservative: `🛡️ <b>CONSERVATIVE</b>\nSafe plays only\nLiq $10K+ • All safety checks`,
    degen: `🎰 <b>DEGEN</b>\nEverything. DYOR.\nLiq $50+ • No limits`,
    whale: `🐋 <b>WHALE</b>\nSmart money focus\nLiq $5K+ • Vol $50K+`,
    trending: `🔥 <b>TRENDING</b>\nVolume spikes\nLiq $2K+ • 3x volume`,
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
