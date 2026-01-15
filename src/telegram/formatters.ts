import {
  TokenAnalysis,
  RiskLevel,
  TrendingToken,
  WatchedToken,
  FilterSettings,
  DexScreenerPair,
} from '../types';

// ============================================
// Utility Functions
// ============================================

export function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  if (num >= 1) return num.toFixed(2);
  if (num >= 0.0001) return num.toFixed(6);
  return num.toExponential(2);
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
  switch (level) {
    case 'LOW': return '🟢';
    case 'MEDIUM': return '🟡';
    case 'HIGH': return '🟠';
    case 'VERY_HIGH': return '🔴';
    case 'EXTREME': return '💀';
    default: return '⚪';
  }
}

export function getPriceChangeEmoji(change: number): string {
  if (change >= 50) return '🚀';
  if (change >= 20) return '📈';
  if (change >= 0) return '↗️';
  if (change >= -20) return '↘️';
  if (change >= -50) return '📉';
  return '💀';
}

export function truncateAddress(address: string, chars: number = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ============================================
// Alert Formatters
// ============================================

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
  const { token, pool, liquidity, holders, contract, social, risk } = analysis;

  const priceUsd = dexData?.priceUsd ? parseFloat(dexData.priceUsd) : 0;
  const volume24h = dexData?.volume?.h24 || 0;
  const priceChange24h = dexData?.priceChange?.h24 || 0;
  const buys24h = dexData?.txns?.h24?.buys || 0;
  const sells24h = dexData?.txns?.h24?.sells || 0;
  const buyRatio = sells24h > 0 ? (buys24h / sells24h).toFixed(2) : 'N/A';

  const lines = [
    `${getRiskEmoji(risk.level)} <b>NEW TOKEN</b> | Score: ${risk.score}/100`,
    ``,
    `<b>${token.name}</b> ($${token.symbol})`,
    `<code>${token.mint}</code>`,
    ``,
    `💰 <b>Market</b>`,
    priceUsd > 0 ? `├ Price: ${formatPrice(priceUsd)} ${getPriceChangeEmoji(priceChange24h)} ${formatPercent(priceChange24h)}` : null,
    dexData?.marketCap ? `├ MCap: $${formatNumber(dexData.marketCap)}` : null,
    `├ Liq: $${formatNumber(liquidity.totalLiquidityUsd)} ${liquidity.lpBurned ? '🔥' : liquidity.lpLocked ? '🔒' : ''}`,
    volume24h > 0 ? `└ Vol 24h: $${formatNumber(volume24h)}` : null,
    ``,
    `📊 <b>Activity</b>`,
    buys24h > 0 || sells24h > 0 ? `├ Buys: ${buys24h} | Sells: ${sells24h} (${buyRatio})` : null,
    `└ Holders: ${holders.totalHolders} | Top 10: ${holders.top10HoldersPercent.toFixed(1)}%`,
    ``,
    `🔒 <b>Security</b>`,
    `├ Mint: ${contract.mintAuthorityRevoked ? '✅ Revoked' : '❌ Active'}`,
    `├ Freeze: ${contract.freezeAuthorityRevoked ? '✅ Revoked' : '❌ Active'}`,
    liquidity.lpBurnedPercent > 0 ? `└ LP: ${liquidity.lpBurnedPercent.toFixed(0)}% Burned 🔥` :
      liquidity.lpLockedPercent > 0 ? `└ LP: ${liquidity.lpLockedPercent.toFixed(0)}% Locked 🔒` :
      `└ LP: Not burned/locked ⚠️`,
    ``,
  ];

  // Add ML prediction if available
  if (mlPrediction) {
    const rugPct = (mlPrediction.rugProbability * 100).toFixed(0);
    const confPct = (mlPrediction.confidence * 100).toFixed(0);
    const rugEmoji = mlPrediction.rugProbability > 0.7 ? '🚨' :
                     mlPrediction.rugProbability > 0.4 ? '⚠️' : '✅';
    lines.push(`🤖 <b>ML Analysis</b>`);
    lines.push(`${rugEmoji} Rug Risk: ${rugPct}% (${confPct}% conf)`);
    lines.push(`└ ${mlPrediction.recommendation}`);
    lines.push(``);
  }

  // Add risk factors (top 3 failed)
  const failedFactors = risk.factors.filter(f => !f.passed).slice(0, 3);
  if (failedFactors.length > 0) {
    lines.push(`⚠️ <b>Risks</b>`);
    failedFactors.forEach(f => lines.push(`• ${f.name}`));
    lines.push(``);
  }

  // Links
  lines.push(
    `🔗 <a href="https://dexscreener.com/solana/${token.mint}">DexScreener</a> | ` +
    `<a href="https://rugcheck.xyz/tokens/${token.mint}">RugCheck</a> | ` +
    `<a href="https://jup.ag/swap/SOL-${token.mint}">Jupiter</a>`
  );
  lines.push(`📍 ${pool.source.toUpperCase()} | ${new Date().toLocaleTimeString()}`);

  return lines.filter(l => l !== null).join('\n');
}

export function formatDexScreenerAnalysis(dexData: DexScreenerPair): string {
  const priceUsd = parseFloat(dexData.priceUsd || '0');
  const priceChange24h = dexData.priceChange?.h24 || 0;
  const volume24h = dexData.volume?.h24 || 0;
  const liquidity = dexData.liquidity?.usd || 0;
  const buys24h = dexData.txns?.h24?.buys || 0;
  const sells24h = dexData.txns?.h24?.sells || 0;

  const lines = [
    `📋 <b>TOKEN ANALYSIS</b> (DexScreener)`,
    ``,
    `<b>${dexData.baseToken.name}</b> ($${dexData.baseToken.symbol})`,
    `<code>${dexData.baseToken.address}</code>`,
    ``,
    `━━━ <b>MARKET DATA</b> ━━━`,
    `Price: ${formatPrice(priceUsd)} ${getPriceChangeEmoji(priceChange24h)} ${formatPercent(priceChange24h)}`,
    dexData.marketCap ? `MCap: $${formatNumber(dexData.marketCap)}` : null,
    dexData.fdv ? `FDV: $${formatNumber(dexData.fdv)}` : null,
    `Liquidity: $${formatNumber(liquidity)}`,
    ``,
    `━━━ <b>VOLUME & ACTIVITY</b> ━━━`,
    `24h Volume: $${formatNumber(volume24h)}`,
    dexData.volume?.h1 ? `1h Volume: $${formatNumber(dexData.volume.h1)}` : null,
    `Buys: ${buys24h} | Sells: ${sells24h}`,
    buys24h + sells24h > 0 ? `Buy/Sell Ratio: ${(buys24h / (sells24h || 1)).toFixed(2)}` : null,
    ``,
    `━━━ <b>PAIR INFO</b> ━━━`,
    `DEX: ${dexData.dexId}`,
    `Pair: ${dexData.baseToken.symbol}/${dexData.quoteToken.symbol}`,
    dexData.pairCreatedAt ? `Created: ${timeAgo(dexData.pairCreatedAt)}` : null,
    ``,
    `⚠️ <i>Blockchain data unavailable (RPC rate limit)</i>`,
    `<i>Use a premium RPC for full analysis</i>`,
    ``,
    `🔗 <a href="https://dexscreener.com/solana/${dexData.baseToken.address}">DexScreener</a> | ` +
    `<a href="https://rugcheck.xyz/tokens/${dexData.baseToken.address}">RugCheck</a> | ` +
    `<a href="https://jup.ag/swap/SOL-${dexData.baseToken.address}">Jupiter</a>`,
  ];

  return lines.filter(l => l !== null).join('\n');
}

export function formatFullAnalysis(analysis: TokenAnalysis, dexData?: DexScreenerPair): string {
  const { token, pool, liquidity, holders, contract, social, risk } = analysis;

  const priceUsd = dexData?.priceUsd ? parseFloat(dexData.priceUsd) : 0;

  const lines = [
    `📋 <b>TOKEN ANALYSIS</b>`,
    ``,
    `<b>${token.name}</b> ($${token.symbol})`,
    `<code>${token.mint}</code>`,
    ``,
    `━━━ <b>OVERVIEW</b> ━━━`,
    `Score: ${getRiskEmoji(risk.level)} ${risk.score}/100 (${risk.level})`,
    dexData?.pairCreatedAt ? `Age: ${timeAgo(dexData.pairCreatedAt)}` : null,
    priceUsd > 0 ? `Price: ${formatPrice(priceUsd)}` : null,
    dexData?.marketCap ? `MCap: $${formatNumber(dexData.marketCap)}` : null,
    dexData?.fdv ? `FDV: $${formatNumber(dexData.fdv)}` : null,
    ``,
    `━━━ <b>LIQUIDITY</b> ━━━`,
    `Total: $${formatNumber(liquidity.totalLiquidityUsd)}`,
    `LP Burned: ${liquidity.lpBurned ? `✅ ${liquidity.lpBurnedPercent.toFixed(1)}%` : '❌ No'}`,
    `LP Locked: ${liquidity.lpLocked ? `✅ ${liquidity.lpLockedPercent.toFixed(1)}%` : '❌ No'}`,
    ``,
    `━━━ <b>VOLUME</b> ━━━`,
    dexData?.volume?.h24 ? `24h: $${formatNumber(dexData.volume.h24)}` : 'N/A',
    dexData?.volume?.h1 ? `1h: $${formatNumber(dexData.volume.h1)}` : null,
    dexData?.txns?.h24 ? `Buys/Sells: ${dexData.txns.h24.buys}/${dexData.txns.h24.sells}` : null,
    ``,
    `━━━ <b>HOLDERS</b> ━━━`,
    `Total: ${holders.totalHolders}`,
    `Top 10: ${holders.top10HoldersPercent.toFixed(1)}%`,
    `Largest: ${holders.largestHolderPercent.toFixed(1)}%`,
    `Dev: ${holders.devWalletPercent.toFixed(1)}%`,
    holders.whaleAddresses.length > 0 ? `Whales (>5%): ${holders.whaleAddresses.length}` : null,
    ``,
    `━━━ <b>SECURITY</b> ━━━`,
    `Mint Authority: ${contract.mintAuthorityRevoked ? '✅ Revoked' : '❌ Active'}`,
    `Freeze Authority: ${contract.freezeAuthorityRevoked ? '✅ Revoked' : '❌ Active'}`,
    `Honeypot: ${contract.isHoneypot ? '⚠️ DETECTED' : '✅ No'}`,
    contract.hasTransferFee ? `Transfer Fee: ${contract.transferFeePercent}%` : null,
    ``,
    `━━━ <b>SOCIALS</b> ━━━`,
    social.hasTwitter ? `Twitter: ${social.twitterUrl || '✅ Found'}` : 'Twitter: ❌',
    social.hasTelegram ? `Telegram: ${social.telegramUrl || '✅ Found'}` : 'Telegram: ❌',
    social.hasWebsite ? `Website: ${social.websiteUrl || '✅ Found'}` : 'Website: ❌',
    ``,
    `━━━ <b>RISK FACTORS</b> ━━━`,
  ];

  // Add all risk factors
  const passedFactors = risk.factors.filter(f => f.passed);
  const failedFactors = risk.factors.filter(f => !f.passed);

  failedFactors.slice(0, 5).forEach(f => {
    lines.push(`⚠️ ${f.name}: ${f.description}`);
  });
  passedFactors.slice(0, 3).forEach(f => {
    lines.push(`✅ ${f.name}`);
  });

  lines.push(``);
  lines.push(
    `🔗 <a href="https://dexscreener.com/solana/${token.mint}">DexScreener</a> | ` +
    `<a href="https://birdeye.so/token/${token.mint}">Birdeye</a> | ` +
    `<a href="https://solscan.io/token/${token.mint}">Solscan</a>`
  );

  return lines.filter(l => l !== null).join('\n');
}

// ============================================
// Watchlist Formatters
// ============================================

export function formatWatchlistAlert(token: WatchedToken): string {
  const emoji = token.priceChangePercent >= 0 ? '📈' : '📉';
  const direction = token.priceChangePercent >= 0 ? 'up' : 'down';

  return [
    `⚡ <b>WATCHLIST ALERT</b>`,
    ``,
    `<b>${token.name}</b> ($${token.symbol})`,
    ``,
    `${emoji} Price moved ${direction} <b>${formatPercent(token.priceChangePercent)}</b>`,
    ``,
    `Added at: ${formatPrice(token.addedPrice)}`,
    `Current: ${formatPrice(token.lastPrice)}`,
    ``,
    `🔗 <a href="https://dexscreener.com/solana/${token.mint}">Chart</a> | ` +
    `<a href="https://jup.ag/swap/SOL-${token.mint}">Swap</a>`,
  ].join('\n');
}

export function formatWatchlist(tokens: WatchedToken[]): string {
  if (tokens.length === 0) {
    return [
      `📋 <b>WATCHLIST</b>`,
      ``,
      `Your watchlist is empty.`,
      ``,
      `Use <code>/watch [address]</code> to add tokens.`,
    ].join('\n');
  }

  const lines = [
    `📋 <b>WATCHLIST</b> (${tokens.length}/20)`,
    ``,
  ];

  tokens.forEach((token, i) => {
    const emoji = token.priceChangePercent >= 0 ? '🟢' : '🔴';
    lines.push(
      `${i + 1}. ${emoji} <b>${token.symbol}</b> ${formatPercent(token.priceChangePercent)}`
    );
    lines.push(`   ${formatPrice(token.lastPrice)} | Added ${timeAgo(token.addedAt)}`);
  });

  return lines.join('\n');
}

// ============================================
// Discovery Formatters
// ============================================

export function formatTrendingList(tokens: TrendingToken[], title: string): string {
  if (tokens.length === 0) {
    return `${title}\n\nNo tokens found.`;
  }

  const lines = [
    `${title}`,
    ``,
  ];

  tokens.forEach((token, i) => {
    const emoji = getPriceChangeEmoji(token.priceChange24h);
    lines.push(
      `${i + 1}. <b>${token.symbol}</b> ${emoji} ${formatPercent(token.priceChange24h)}`
    );
    lines.push(
      `   ${formatPrice(token.priceUsd)} | Vol: $${formatNumber(token.volume24h)} | Liq: $${formatNumber(token.liquidity)}`
    );
  });

  lines.push(``);
  lines.push(`<i>Updated: ${new Date().toLocaleTimeString()}</i>`);

  return lines.join('\n');
}

// ============================================
// Settings Formatters
// ============================================

export function formatSettings(settings: FilterSettings): string {
  const profileEmoji: Record<string, string> = {
    conservative: '🛡️',
    balanced: '⚖️',
    aggressive: '🎯',
    degen: '🎰',
    custom: '⚙️',
  };

  return [
    `⚙️ <b>SETTINGS</b>`,
    ``,
    `<b>Profile:</b> ${profileEmoji[settings.profile] || ''} ${settings.profile.toUpperCase()}`,
    `<b>Alerts:</b> ${settings.alertsEnabled ? '✅ Enabled' : '❌ Disabled'}`,
    ``,
    `━━━ <b>FILTERS</b> ━━━`,
    `Min Liquidity: $${formatNumber(settings.minLiquidity)}`,
    `Max Top 10: ${settings.maxTop10Percent}%`,
    `Min Holders: ${settings.minHolders}`,
    `Min Risk Score: ${settings.minRiskScore}`,
    `Min Token Age: ${Math.floor(settings.minTokenAge / 60)}min`,
    ``,
    `━━━ <b>REQUIREMENTS</b> ━━━`,
    `Mint Revoked: ${settings.requireMintRevoked ? '✅' : '❌'}`,
    `Freeze Revoked: ${settings.requireFreezeRevoked ? '✅' : '❌'}`,
    `LP Burned: ${settings.requireLPBurned ? '✅' : '❌'}`,
    `Has Socials: ${settings.requireSocials ? '✅' : '❌'}`,
    ``,
    `━━━ <b>OTHER</b> ━━━`,
    `Timezone: ${settings.timezone}`,
    settings.quietHoursStart !== undefined && settings.quietHoursEnd !== undefined
      ? `Quiet Hours: ${settings.quietHoursStart}:00 - ${settings.quietHoursEnd}:00`
      : `Quiet Hours: Not set`,
  ].join('\n');
}

export function formatFilterProfile(profile: string): string {
  const profiles: Record<string, string> = {
    conservative: [
      `🛡️ <b>CONSERVATIVE</b>`,
      ``,
      `Safe, established tokens only.`,
      ``,
      `• Min Liquidity: $10,000`,
      `• Max Top 10: 25%`,
      `• Min Holders: 100`,
      `• Min Score: 75`,
      `• Requires: Mint + Freeze revoked, LP burned, socials`,
    ].join('\n'),
    balanced: [
      `⚖️ <b>BALANCED</b>`,
      ``,
      `Good balance of opportunity and safety.`,
      ``,
      `• Min Liquidity: $2,000`,
      `• Max Top 10: 40%`,
      `• Min Holders: 25`,
      `• Min Score: 50`,
      `• Requires: Mint revoked`,
    ].join('\n'),
    aggressive: [
      `🎯 <b>AGGRESSIVE</b>`,
      ``,
      `More signals, higher risk.`,
      ``,
      `• Min Liquidity: $500`,
      `• Max Top 10: 60%`,
      `• Min Holders: 10`,
      `• Min Score: 30`,
      `• No strict requirements`,
    ].join('\n'),
    degen: [
      `🎰 <b>DEGEN</b>`,
      ``,
      `Everything. DYOR.`,
      ``,
      `• Min Liquidity: $100`,
      `• Max Top 10: 90%`,
      `• Min Holders: 3`,
      `• Min Score: 0`,
      `• No requirements - you decide`,
    ].join('\n'),
  };

  return profiles[profile] || 'Unknown profile';
}

// ============================================
// Help & Info Formatters
// ============================================

export function formatHelp(): string {
  return [
    `🤖 <b>SOLANA MEMECOIN BOT</b>`,
    ``,
    `━━━ <b>BASIC</b> ━━━`,
    `/start - Welcome message`,
    `/help - This help menu`,
    `/status - Bot status`,
    `/stats - Monitoring statistics`,
    ``,
    `━━━ <b>ALERTS</b> ━━━`,
    `/alerts - Show alert status`,
    `/alerts on - Enable alerts`,
    `/alerts off - Disable alerts`,
    `/mute [min] - Mute for X minutes`,
    ``,
    `━━━ <b>FILTERS</b> ━━━`,
    `/filter - Show current filter`,
    `/filter [profile] - Set profile`,
    `  Profiles: conservative, balanced, aggressive, degen`,
    `/set [param] [value] - Set filter param`,
    `/reset filters - Reset to default`,
    `/settings - Show all settings`,
    ``,
    `━━━ <b>ANALYSIS</b> ━━━`,
    `/check [address] - Full token analysis`,
    `/scan [address] - Quick safety check`,
    `/holders [address] - Holder breakdown`,
    `/lp [address] - LP analysis`,
    `/socials [address] - Social links`,
    `/compare [addr1] [addr2] - Compare tokens`,
    ``,
    `━━━ <b>WATCHLIST</b> ━━━`,
    `/watch [address] - Add to watchlist`,
    `/unwatch [address] - Remove from watchlist`,
    `/watchlist - Show watchlist`,
    `/watchlist clear - Clear watchlist`,
    ``,
    `━━━ <b>DISCOVERY</b> ━━━`,
    `/trending - Top by volume`,
    `/new - Latest tokens`,
    `/gainers - Top gainers`,
    `/losers - Top losers`,
    `/volume - Volume leaders`,
    ``,
    `━━━ <b>SETTINGS</b> ━━━`,
    `/timezone [tz] - Set timezone`,
    `/quiet [start] [end] - Set quiet hours`,
  ].join('\n');
}

export function formatStats(stats: {
  tokensAnalyzed: number;
  alertsSent: number;
  uptime: number;
  watchlistCount: number;
  monitorsActive: string[];
}): string {
  const uptimeHours = Math.floor(stats.uptime / 3600000);
  const uptimeMinutes = Math.floor((stats.uptime % 3600000) / 60000);

  return [
    `📊 <b>BOT STATISTICS</b>`,
    ``,
    `⏱️ Uptime: ${uptimeHours}h ${uptimeMinutes}m`,
    `📈 Tokens Analyzed: ${stats.tokensAnalyzed}`,
    `🔔 Alerts Sent: ${stats.alertsSent}`,
    `⭐ Watchlist Items: ${stats.watchlistCount}`,
    ``,
    `<b>Active Monitors:</b>`,
    stats.monitorsActive.map(m => `• ${m}`).join('\n'),
  ].join('\n');
}
