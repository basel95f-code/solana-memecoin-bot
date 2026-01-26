import type {
  TokenAnalysis,
  RiskLevel,
  TrendingToken,
  WatchedToken,
  FilterSettings,
  DexScreenerPair,
  SmartMoneyActivity,
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

export function getSentimentEmoji(score: number): string {
  if (score > 0.5) return '🟢';
  if (score > 0.2) return '🌱';
  if (score >= -0.2) return '⚪';
  if (score >= -0.5) return '🟠';
  return '🔴';
}

export function getSentimentLabel(score: number): string {
  if (score > 0.5) return 'Very Positive';
  if (score > 0.2) return 'Positive';
  if (score >= -0.2) return 'Neutral';
  if (score >= -0.5) return 'Negative';
  return 'Very Negative';
}

export function getSmartMoneyEmoji(netBuys: number): string {
  if (netBuys >= 5) return '🐋🔥'; // Whales accumulating heavily
  if (netBuys >= 2) return '🐋'; // Whales accumulating
  if (netBuys >= 1) return '👀'; // Slight interest
  if (netBuys === 0) return '⚪'; // Neutral
  return '🚨'; // Dumping
}

export function formatSmartMoney(smartMoney: SmartMoneyActivity): string {
  const netBuys = smartMoney.netSmartMoney;
  const emoji = getSmartMoneyEmoji(netBuys);

  if (netBuys > 0) {
    return `${emoji} +${netBuys} net (${smartMoney.smartBuys24h} buys, ${smartMoney.smartSells24h} sells)`;
  } else if (netBuys < 0) {
    return `${emoji} ${netBuys} net (${smartMoney.smartSells24h} sells > ${smartMoney.smartBuys24h} buys)`;
  }
  return `${emoji} Neutral (${smartMoney.smartBuys24h}B/${smartMoney.smartSells24h}S)`;
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
  const { token, pool, liquidity, holders, contract, social, sentiment, smartMoney, risk } = analysis;

  const priceUsd = dexData?.priceUsd ? parseFloat(dexData.priceUsd) : 0;
  const volume24h = dexData?.volume?.h24 || 0;
  const priceChange24h = dexData?.priceChange?.h24 || 0;
  const buys24h = dexData?.txns?.h24?.buys || 0;
  const sells24h = dexData?.txns?.h24?.sells || 0;
  const buyRatio = sells24h > 0 ? (buys24h / sells24h).toFixed(2) : '∞';

  // Fun header based on risk
  const header = risk.level === 'LOW' ? '🎯 GEM ALERT!' :
                 risk.level === 'MEDIUM' ? '👀 NEW TOKEN SPOTTED!' :
                 risk.level === 'HIGH' ? '⚠️ RISKY TOKEN DETECTED' :
                 '🚨 DEGEN ALERT';

  const lines = [
    `${getRiskEmoji(risk.level)} <b>${header}</b>`,
    ``,
    `🪙 <b>${token.name}</b> ($${token.symbol})`,
    `<code>${token.mint}</code>`,
    ``,
    `💵 ━━━ MARKET ━━━`,
    priceUsd > 0 ? `💲 Price: ${formatPrice(priceUsd)} ${getPriceChangeEmoji(priceChange24h)} ${formatPercent(priceChange24h)}` : null,
    dexData?.marketCap ? `📊 MCap: $${formatNumber(dexData.marketCap)}` : null,
    `💧 Liquidity: $${formatNumber(liquidity.totalLiquidityUsd)} ${liquidity.lpBurned ? '🔥' : liquidity.lpLocked ? '🔒' : ''}`,
    volume24h > 0 ? `📈 Volume 24h: $${formatNumber(volume24h)}` : null,
    ``,
    `👥 ━━━ COMMUNITY ━━━`,
    `🧑‍🤝‍🧑 Holders: ${holders.totalHolders > 0 ? holders.totalHolders.toLocaleString() : 'Loading...'}`,
    `🏆 Top 10 own: ${holders.top10HoldersPercent.toFixed(1)}%`,
    buys24h > 0 || sells24h > 0 ? `🛒 Buys: ${buys24h} | 🏷️ Sells: ${sells24h} (${buyRatio}x)` : null,
    ``,
    // Smart Money section from GMGN
    smartMoney && (smartMoney.smartBuys24h > 0 || smartMoney.smartSells24h > 0) ? `🐋 ━━━ SMART MONEY ━━━` : null,
    smartMoney && (smartMoney.smartBuys24h > 0 || smartMoney.smartSells24h > 0) ? formatSmartMoney(smartMoney) : null,
    smartMoney && smartMoney.isSmartMoneyBullish ? `✨ Smart money is ACCUMULATING!` : null,
    smartMoney && smartMoney.netSmartMoney < 0 ? `⚠️ Smart money is DUMPING!` : null,
    smartMoney && (smartMoney.smartBuys24h > 0 || smartMoney.smartSells24h > 0) ? `` : null,
    `🛡️ ━━━ SAFETY ━━━`,
    `${contract.mintAuthorityRevoked ? '✅' : '❌'} Mint ${contract.mintAuthorityRevoked ? 'Revoked' : 'Active ⚠️'}`,
    `${contract.freezeAuthorityRevoked ? '✅' : '❌'} Freeze ${contract.freezeAuthorityRevoked ? 'Revoked' : 'Active ⚠️'}`,
    liquidity.lpBurnedPercent > 0 ? `🔥 LP ${liquidity.lpBurnedPercent.toFixed(0)}% Burned!` :
      liquidity.lpLockedPercent > 0 ? `🔒 LP ${liquidity.lpLockedPercent.toFixed(0)}% Locked` :
      `⚠️ LP not burned/locked`,
    ``,
    `🌐 ━━━ SOCIALS ━━━`,
    `${social.hasTwitter ? '✅' : '❌'} Twitter ${social.hasTwitter ? '🐦' : ''}`,
    `${social.hasTelegram ? '✅' : '❌'} Telegram ${social.hasTelegram ? '💬' : ''}`,
    `${social.hasWebsite ? '✅' : '❌'} Website ${social.hasWebsite ? '🌍' : ''}`,
    ``,
  ];

  // Add sentiment section if available
  if (sentiment?.hasSentimentData) {
    lines.push(`📊 ━━━ SENTIMENT ━━━`);
    lines.push(`${getSentimentEmoji(sentiment.sentimentScore)} Twitter: ${getSentimentLabel(sentiment.sentimentScore)} (${sentiment.tweetCount} tweets)`);
    if (sentiment.topNegativeTerms.length > 0 && sentiment.sentimentScore < 0) {
      lines.push(`⚠️ Warnings: ${sentiment.topNegativeTerms.slice(0, 2).join(', ')}`);
    }
    lines.push(``);
  }

  // Add ML prediction if available
  if (mlPrediction) {
    const rugPct = (mlPrediction.rugProbability * 100).toFixed(0);
    const confPct = (mlPrediction.confidence * 100).toFixed(0);
    const rugEmoji = mlPrediction.rugProbability > 0.7 ? '🚨' :
                     mlPrediction.rugProbability > 0.4 ? '⚠️' : '✅';
    lines.push(`🤖 ━━━ AI ANALYSIS ━━━`);
    lines.push(`${rugEmoji} Rug Risk: ${rugPct}% (${confPct}% conf)`);
    lines.push(`💡 ${mlPrediction.recommendation}`);
    lines.push(``);
  }

  // Add risk factors (top 3 failed)
  const failedFactors = risk.factors.filter(f => !f.passed).slice(0, 3);
  if (failedFactors.length > 0) {
    lines.push(`⚠️ ━━━ WATCH OUT ━━━`);
    failedFactors.forEach(f => lines.push(`❗ ${f.name}`));
    lines.push(``);
  }

  // Score badge
  const scoreBadge = risk.score >= 75 ? '🏆 SOLID' :
                     risk.score >= 50 ? '👍 OKAY' :
                     risk.score >= 25 ? '🤔 RISKY' : '💀 DEGEN';
  lines.push(`📋 Score: ${risk.score}/100 ${scoreBadge}`);
  lines.push(``);

  // Links with emojis
  lines.push(
    `🔗 <a href="https://dexscreener.com/solana/${token.mint}">📊 Chart</a> | ` +
    `<a href="https://rugcheck.xyz/tokens/${token.mint}">🔍 RugCheck</a> | ` +
    `<a href="https://jup.ag/swap/SOL-${token.mint}">💱 Buy</a>`
  );
  lines.push(`📍 Found on ${pool.source.toUpperCase()} • ${new Date().toLocaleTimeString()}`);

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
  const { token, liquidity, holders, contract, social, sentiment, smartMoney, risk } = analysis;

  const priceUsd = dexData?.priceUsd ? parseFloat(dexData.priceUsd) : 0;

  // Score badge
  const scoreBadge = risk.score >= 75 ? '🏆 SOLID' :
                     risk.score >= 50 ? '👍 DECENT' :
                     risk.score >= 25 ? '🤔 RISKY' : '💀 DEGEN';

  const lines = [
    `🔍 <b>TOKEN ANALYSIS</b>`,
    ``,
    `🪙 <b>${token.name}</b> ($${token.symbol})`,
    `<code>${token.mint}</code>`,
    ``,
    `📊 ━━━ OVERVIEW ━━━`,
    `${getRiskEmoji(risk.level)} Score: ${risk.score}/100 ${scoreBadge}`,
    dexData?.pairCreatedAt ? `⏰ Age: ${timeAgo(dexData.pairCreatedAt)}` : null,
    priceUsd > 0 ? `💲 Price: ${formatPrice(priceUsd)}` : null,
    dexData?.marketCap ? `📈 MCap: $${formatNumber(dexData.marketCap)}` : null,
    dexData?.fdv ? `💎 FDV: $${formatNumber(dexData.fdv)}` : null,
    ``,
    `💧 ━━━ LIQUIDITY ━━━`,
    `💰 Total: $${formatNumber(liquidity.totalLiquidityUsd)}`,
    `${liquidity.lpBurned ? '🔥' : '❌'} LP Burned: ${liquidity.lpBurned ? `${liquidity.lpBurnedPercent.toFixed(1)}%` : 'No'}`,
    `${liquidity.lpLocked ? '🔒' : '❌'} LP Locked: ${liquidity.lpLocked ? `${liquidity.lpLockedPercent.toFixed(1)}%` : 'No'}`,
    ``,
    `📈 ━━━ VOLUME ━━━`,
    dexData?.volume?.h24 ? `📊 24h: $${formatNumber(dexData.volume.h24)}` : '📊 24h: N/A',
    dexData?.volume?.h1 ? `⏱️ 1h: $${formatNumber(dexData.volume.h1)}` : null,
    dexData?.txns?.h24 ? `🛒 Buys: ${dexData.txns.h24.buys} | 🏷️ Sells: ${dexData.txns.h24.sells}` : null,
    ``,
    `👥 ━━━ HOLDERS ━━━`,
    `🧑‍🤝‍🧑 Total: ${holders.totalHolders > 0 ? holders.totalHolders.toLocaleString() : 'Loading...'}`,
    `🏆 Top 10: ${holders.top10HoldersPercent.toFixed(1)}%`,
    `👑 Largest: ${holders.largestHolderPercent.toFixed(1)}%`,
    `🎮 Dev Wallet: ${holders.devWalletPercent.toFixed(1)}%`,
    holders.whaleAddresses.length > 0 ? `🐋 Whales (>5%): ${holders.whaleAddresses.length}` : `🐋 Whales: 0`,
    ``,
    `🛡️ ━━━ SECURITY ━━━`,
    `${contract.mintAuthorityRevoked ? '✅' : '❌'} Mint: ${contract.mintAuthorityRevoked ? 'Revoked 👍' : 'Active ⚠️'}`,
    `${contract.freezeAuthorityRevoked ? '✅' : '❌'} Freeze: ${contract.freezeAuthorityRevoked ? 'Revoked 👍' : 'Active ⚠️'}`,
    `${contract.isHoneypot ? '🚨' : '✅'} Honeypot: ${contract.isHoneypot ? 'DETECTED! 🚫' : 'Not detected 👍'}`,
    contract.hasTransferFee ? `💸 Transfer Fee: ${contract.transferFeePercent}%` : null,
    ``,
    `🌐 ━━━ SOCIALS ━━━`,
    `${social.hasTwitter ? '✅ 🐦' : '❌'} Twitter${social.twitterUrl ? `: ${social.twitterUrl}` : ''}`,
    `${social.hasTelegram ? '✅ 💬' : '❌'} Telegram${social.telegramUrl ? `: ${social.telegramUrl}` : ''}`,
    `${social.hasWebsite ? '✅ 🌍' : '❌'} Website${social.websiteUrl ? `: ${social.websiteUrl}` : ''}`,
    ``,
  ];

  // Add smart money section if available
  if (smartMoney && (smartMoney.smartBuys24h > 0 || smartMoney.smartSells24h > 0)) {
    lines.push(`🐋 ━━━ SMART MONEY (GMGN) ━━━`);
    lines.push(`${getSmartMoneyEmoji(smartMoney.netSmartMoney)} Activity: ${formatSmartMoney(smartMoney)}`);
    lines.push(`📊 24h Buys: ${smartMoney.smartBuys24h} | 24h Sells: ${smartMoney.smartSells24h}`);
    if (smartMoney.isSmartMoneyBullish) {
      lines.push(`✨ Status: Smart money is ACCUMULATING!`);
    } else if (smartMoney.netSmartMoney < 0) {
      lines.push(`⚠️ Status: Smart money is DUMPING!`);
    } else {
      lines.push(`⚪ Status: Neutral activity`);
    }
    lines.push(``);
  }

  // Add sentiment section if available
  if (sentiment?.hasSentimentData) {
    lines.push(`📊 ━━━ TWITTER SENTIMENT ━━━`);
    lines.push(`${getSentimentEmoji(sentiment.sentimentScore)} Score: ${getSentimentLabel(sentiment.sentimentScore)}`);
    lines.push(`📈 Positive: ${sentiment.positivePercent.toFixed(0)}%`);
    lines.push(`📉 Negative: ${sentiment.negativePercent.toFixed(0)}%`);
    lines.push(`🔢 Tweets analyzed: ${sentiment.tweetCount}`);
    if (sentiment.topPositiveTerms.length > 0) {
      lines.push(`✅ Bullish terms: ${sentiment.topPositiveTerms.slice(0, 3).join(', ')}`);
    }
    if (sentiment.topNegativeTerms.length > 0) {
      lines.push(`⚠️ Warning terms: ${sentiment.topNegativeTerms.slice(0, 3).join(', ')}`);
    }
    lines.push(``);
  }

  lines.push(`⚠️ ━━━ RISK FACTORS ━━━`);

  // Add all risk factors
  const passedFactors = risk.factors.filter(f => f.passed);
  const failedFactors = risk.factors.filter(f => !f.passed);

  if (failedFactors.length > 0) {
    failedFactors.slice(0, 5).forEach(f => {
      lines.push(`❗ ${f.name}: ${f.description}`);
    });
  } else {
    lines.push(`✅ No major risks detected!`);
  }

  if (passedFactors.length > 0) {
    lines.push(``);
    lines.push(`✅ ━━━ GOOD SIGNS ━━━`);
    passedFactors.slice(0, 4).forEach(f => {
      lines.push(`👍 ${f.name}`);
    });
  }

  lines.push(``);
  lines.push(
    `🔗 <a href="https://dexscreener.com/solana/${token.mint}">📊 Chart</a> | ` +
    `<a href="https://birdeye.so/token/${token.mint}">🦅 Birdeye</a> | ` +
    `<a href="https://solscan.io/token/${token.mint}">🔎 Solscan</a>`
  );
  lines.push(``);
  lines.push(`🤖 Analyzed at ${new Date().toLocaleTimeString()}`);

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

export interface SmartMoneyPick extends TrendingToken {
  smartMoney: SmartMoneyActivity;
}

export function formatSmartMoneyList(tokens: SmartMoneyPick[], title: string): string {
  if (tokens.length === 0) {
    return `${title}\n\nNo smart money activity detected.\n\n<i>Smart money data from GMGN.ai</i>`;
  }

  const lines = [
    `${title}`,
    ``,
  ];

  tokens.forEach((token, i) => {
    const sm = token.smartMoney;
    const emoji = getSmartMoneyEmoji(sm.netSmartMoney);
    const priceEmoji = getPriceChangeEmoji(token.priceChange24h);

    lines.push(
      `${i + 1}. ${emoji} <b>${token.symbol}</b> ${priceEmoji} ${formatPercent(token.priceChange24h)}`
    );
    lines.push(
      `   💰 ${formatPrice(token.priceUsd)} | Liq: $${formatNumber(token.liquidity)}`
    );
    lines.push(
      `   🐋 Smart: +${sm.smartBuys24h} buys / -${sm.smartSells24h} sells (net <b>+${sm.netSmartMoney}</b>)`
    );
    lines.push(
      `   <code>${token.mint}</code>`
    );
    lines.push(``);
  });

  lines.push(`━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`<i>🐋 = Smart money accumulating</i>`);
  lines.push(`<i>Data from GMGN.ai | ${new Date().toLocaleTimeString()}</i>`);

  return lines.join('\n');
}

// ============================================
// Settings Formatters
// ============================================

export function formatSettings(settings: FilterSettings): string {
  const profileEmoji: Record<string, string> = {
    // Risk-based
    sniper: '🎯', early: '⚡', balanced: '⚖️', conservative: '🛡️',
    graduation: '🎓', whale: '🐋', degen: '🎰', cto: '🔍',
    // Market cap
    micro: '💎', small: '🥉', mid: '🥈', large: '🥇', mega: '👑',
    // Strategy
    trending: '🔥', momentum: '📈', fresh: '🆕', revival: '💀', runner: '🏃',
    custom: '⚙️',
  };

  const lines = [
    `⚙️ <b>SETTINGS</b>`,
    ``,
  ];
  
  // Show profile or stack
  if (settings.profileStack && settings.profileStack.length > 0) {
    lines.push(`<b>Profile:</b> 📚 STACKED`);
    lines.push(`<b>Stack:</b> ${settings.profileStack.map(p => profileEmoji[p] + ' ' + p).join(' + ')}`);
  } else {
    lines.push(`<b>Profile:</b> ${profileEmoji[settings.profile] || ''} ${settings.profile.toUpperCase()}`);
  }
  
  lines.push(`<b>Alerts:</b> ${settings.alertsEnabled ? '✅ Enabled' : '❌ Disabled'}`);
  if (settings.fastMode) {
    lines.push(`<b>Fast Mode:</b> ✅ Enabled`);
  }
  lines.push(``);
  
  lines.push(`━━━ <b>LIQUIDITY</b> ━━━`);
  lines.push(`Min: $${formatNumber(settings.minLiquidity)}`);
  if (settings.maxLiquidity) {
    lines.push(`Max: $${formatNumber(settings.maxLiquidity)}`);
  }
  lines.push(
    ``,
    `━━━ <b>HOLDERS</b> ━━━`,
    `Max Top 10: ${settings.maxTop10Percent}%`,
    settings.maxSingleHolderPercent ? `Max Single: ${settings.maxSingleHolderPercent}%` : null,
    `Min Holders: ${settings.minHolders}`,
    ``,
    `━━━ <b>TOKEN AGE</b> ━━━`,
    `Min Age: ${Math.floor(settings.minTokenAge / 60)}min`,
    settings.maxTokenAge ? `Max Age: ${Math.floor(settings.maxTokenAge / 60)}min` : null,
    ``,
    `━━━ <b>MARKET CAP</b> ━━━`,
    settings.minMcap ? `Min MCap: $${formatNumber(settings.minMcap)}` : `Min MCap: None`,
    settings.maxMcap ? `Max MCap: $${formatNumber(settings.maxMcap)}` : `Max MCap: None`,
    ``,
    `━━━ <b>SCORES</b> ━━━`,
    `Min Risk Score: ${settings.minRiskScore}`,
    settings.minOpportunityScore ? `Min Opportunity: ${settings.minOpportunityScore}` : null,
    ``,
    `━━━ <b>REQUIREMENTS</b> ━━━`,
    `Mint Revoked: ${settings.requireMintRevoked ? '✅' : '❌'}`,
    `Freeze Revoked: ${settings.requireFreezeRevoked ? '✅' : '❌'}`,
    `LP Burned: ${settings.requireLPBurned ? '✅' : '❌'}${settings.lpBurnedMinPercent ? ` (${settings.lpBurnedMinPercent}%+)` : ''}`,
    `Has Socials: ${settings.requireSocials ? '✅' : '❌'}`,
  ];

  // Add Pump.fun specific if set
  if (settings.minBondingCurve || settings.maxBondingCurve) {
    lines.push(``);
    lines.push(`━━━ <b>PUMP.FUN</b> ━━━`);
    if (settings.minBondingCurve) lines.push(`Min Bonding: ${settings.minBondingCurve}%`);
    if (settings.maxBondingCurve) lines.push(`Max Bonding: ${settings.maxBondingCurve}%`);
  }

  // Add volume/momentum if set
  if (settings.volumeSpikeMultiplier || settings.minPriceChange1h || settings.minVolume24h) {
    lines.push(``);
    lines.push(`━━━ <b>MOMENTUM</b> ━━━`);
    if (settings.volumeSpikeMultiplier) lines.push(`Volume Spike: ${settings.volumeSpikeMultiplier}x`);
    if (settings.minPriceChange1h) lines.push(`Min 1h Change: ${settings.minPriceChange1h}%`);
    if (settings.maxPriceChange1h) lines.push(`Max 1h Change: ${settings.maxPriceChange1h}%`);
    if (settings.minVolume24h) lines.push(`Min 24h Volume: $${formatNumber(settings.minVolume24h)}`);
  }

  // Add smart money filters if set
  if (settings.minSmartBuys || settings.minSmartFlow || settings.requireSmartMoney) {
    lines.push(``);
    lines.push(`━━━ <b>SMART MONEY</b> 🐋 ━━━`);
    if (settings.minSmartBuys) lines.push(`Min Smart Buys: ${settings.minSmartBuys}`);
    if (settings.minSmartFlow) lines.push(`Min Net Flow: ${settings.minSmartFlow > 0 ? '+' : ''}${settings.minSmartFlow}`);
    if (settings.requireSmartMoney) lines.push(`Require Activity: ✅`);
  }

  lines.push(``);
  lines.push(`━━━ <b>OTHER</b> ━━━`);
  lines.push(`Timezone: ${settings.timezone}`);
  lines.push(
    settings.quietHoursStart !== undefined && settings.quietHoursEnd !== undefined
      ? `Quiet Hours: ${settings.quietHoursStart}:00 - ${settings.quietHoursEnd}:00`
      : `Quiet Hours: Not set`
  );

  return lines.filter(l => l !== null).join('\n');
}

export function formatFilterProfile(profile: string, profileStack?: string[]): string {
  // Handle stacked profiles
  if (profileStack && profileStack.length > 0) {
    const { formatStackSummary } = require('./commands/filter-stack');
    const { mergeFilterProfiles } = require('./commands/filter-stack');
    const { merged } = mergeFilterProfiles(profileStack);
    
    return formatStackSummary(profileStack as any[], merged);
  }

  // Single profile display
  const profiles: Record<string, string> = {
    // Risk-based profiles
    sniper: [
      `🎯 <b>SNIPER</b>`,
      ``,
      `Catch tokens at birth. Maximum risk.`,
      ``,
      `• Min Liquidity: $100`,
      `• Max Top 10: 80%`,
      `• Max Age: 1 minute`,
      `• Fast Mode: Enabled`,
      `• No safety requirements`,
    ].join('\n'),
    early: [
      `⚡ <b>EARLY</b>`,
      ``,
      `Early entry with basic safety.`,
      ``,
      `• Min Liquidity: $500`,
      `• Max Top 10: 60%`,
      `• Max Age: 10 minutes`,
      `• Requires: Mint revoked`,
    ].join('\n'),
    balanced: [
      `⚖️ <b>BALANCED</b>`,
      ``,
      `Good balance of opportunity and safety.`,
      ``,
      `• Min Liquidity: $2,000`,
      `• Max Top 10: 40%`,
      `• Max Single: 10%`,
      `• Min Holders: 25`,
      `• Min Score: 50`,
      `• Requires: Mint revoked`,
    ].join('\n'),
    conservative: [
      `🛡️ <b>CONSERVATIVE</b>`,
      ``,
      `Safe, established tokens only.`,
      ``,
      `• Min Liquidity: $10,000`,
      `• Max Top 10: 25%`,
      `• Min Holders: 100`,
      `• Min Score: 70`,
      `• Min Smart Buys: 2`,
      `• Min Net Smart Flow: +1`,
      `• Requires: Mint + Freeze revoked, LP 50%+ burned, socials`,
    ].join('\n'),
    graduation: [
      `🎓 <b>GRADUATION</b>`,
      ``,
      `Track Pump.fun tokens near graduation.`,
      ``,
      `• Min Liquidity: $5,000`,
      `• Bonding Curve: 70-95%`,
      `• Min Holders: 50`,
      `• Graduation = migration to Raydium`,
    ].join('\n'),
    whale: [
      `🐋 <b>WHALE</b>`,
      ``,
      `Alert on whale and smart money activity only.`,
      ``,
      `• Min Liquidity: $5,000`,
      `• Min 24h Volume: $50,000`,
      `• Min Smart Buys: 3`,
      `• Min Net Smart Flow: +2`,
      `• Requires smart money activity`,
    ].join('\n'),
    degen: [
      `🎰 <b>DEGEN</b>`,
      ``,
      `Everything. DYOR.`,
      ``,
      `• Min Liquidity: $50`,
      `• No holder limits`,
      `• No requirements`,
      `• Maximum risk, maximum potential`,
    ].join('\n'),
    cto: [
      `🔍 <b>CTO (Community Takeover)</b>`,
      ``,
      `Dev abandoned tokens with community revival.`,
      ``,
      `• Age: 24h - 7 days`,
      `• MCap: $10K - $250K`,
      `• Requires: Mint + Freeze revoked`,
      `• Look for community-driven revivals`,
    ].join('\n'),

    // Market cap profiles
    micro: [
      `💎 <b>MICRO CAP</b>`,
      ``,
      `High risk/high reward gems. $1K-$50K MCap.`,
      ``,
      `• MCap: $1K - $50K`,
      `• Min Liquidity: $100`,
      `• 100x potential, extreme risk`,
    ].join('\n'),
    small: [
      `🥉 <b>SMALL CAP</b>`,
      ``,
      `Small cap plays. $50K-$500K MCap.`,
      ``,
      `• MCap: $50K - $500K`,
      `• Min Liquidity: $1,000`,
      `• 10-50x potential`,
    ].join('\n'),
    mid: [
      `🥈 <b>MID CAP</b>`,
      ``,
      `More established tokens. $500K-$5M MCap.`,
      ``,
      `• MCap: $500K - $5M`,
      `• Min Liquidity: $10,000`,
      `• 5-10x potential`,
    ].join('\n'),
    large: [
      `🥇 <b>LARGE CAP</b>`,
      ``,
      `Safer plays. $5M-$50M MCap.`,
      ``,
      `• MCap: $5M - $50M`,
      `• Min Liquidity: $50,000`,
      `• 2-5x potential, lower risk`,
    ].join('\n'),
    mega: [
      `👑 <b>MEGA CAP</b>`,
      ``,
      `Blue chip memecoins. $50M+ MCap.`,
      ``,
      `• MCap: $50M+`,
      `• Min Liquidity: $100,000`,
      `• Established tokens only`,
    ].join('\n'),

    // Strategy profiles
    trending: [
      `🔥 <b>TRENDING</b>`,
      ``,
      `Tokens with volume spikes + smart money.`,
      ``,
      `• Volume Spike: 3x+`,
      `• Min Liquidity: $2,000`,
      `• Min Smart Buys: 2`,
      `• Min Net Smart Flow: +1`,
      `• Catch the momentum`,
    ].join('\n'),
    momentum: [
      `📈 <b>MOMENTUM</b>`,
      ``,
      `Price up with volume increase.`,
      ``,
      `• Price up 50%+ in 1h`,
      `• Volume spike 2x+`,
      `• Ride the wave`,
    ].join('\n'),
    fresh: [
      `🆕 <b>FRESH</b>`,
      ``,
      `Catch tokens at birth.`,
      ``,
      `• Max Age: 5 minutes`,
      `• Fast Mode: Enabled`,
      `• High risk, first mover advantage`,
    ].join('\n'),
    revival: [
      `💀 <b>REVIVAL</b>`,
      ``,
      `Down 80%+ but showing volume comeback.`,
      ``,
      `• Down 80%+ from highs`,
      `• Volume spike 2x+`,
      `• Mint revoked required`,
      `• Second chance plays`,
    ].join('\n'),
    runner: [
      `🏃 <b>RUNNER</b>`,
      ``,
      `Already pumping, ride the momentum.`,
      ``,
      `• Up 100%+ today`,
      `• Min Volume: $100K`,
      `• Already validated, catch continuation`,
    ].join('\n'),
    custom: [
      `⚙️ <b>CUSTOM</b>`,
      ``,
      `Your custom settings.`,
      `Use /set to customize individual parameters.`,
    ].join('\n'),
  };

  return profiles[profile] || `Unknown profile: ${profile}`;
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
    `/smartmoney - Smart money picks (GMGN)`,
    `/whales - Whale accumulation`,
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

// ============================================
// Filter Performance Formatters
// ============================================

export function formatFilterStats(perfData: import('../types').FilterPerformanceData): string {
  if (!perfData) {
    return [
      `📊 <b>FILTER PERFORMANCE</b>`,
      ``,
      `No performance data yet.`,
      ``,
      `<i>Start detecting tokens to build stats!</i>`,
    ].join('\n');
  }

  const lines = [
    `📊 <b>FILTER PERFORMANCE</b>`,
    ``,
    `━━━ <b>OVERALL</b> ━━━`,
    `🔍 Tokens Detected: ${perfData.totalTokensDetected}`,
    `🏆 Winners (+50%): ${perfData.totalWinners}`,
    `💀 Losers/Rugs: ${perfData.totalLosers}`,
  ];

  if (perfData.totalTokensDetected > 0) {
    const totalDecided = perfData.totalWinners + perfData.totalLosers;
    if (totalDecided > 0) {
      const overallWinRate = (perfData.totalWinners / totalDecided) * 100;
      lines.push(`📈 Overall Win Rate: ${overallWinRate.toFixed(1)}%`);
    }
  }

  lines.push(``);
  lines.push(`━━━ <b>TOP PROFILES</b> ━━━`);

  // Sort profiles by win rate (with minimum 3 detections)
  const profilesWithData = Object.values(perfData.profileStats)
    .filter(p => (p.winners + p.losers) >= 3)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 5);

  if (profilesWithData.length === 0) {
    lines.push(`<i>Not enough data yet (min 3 outcomes per profile)</i>`);
  } else {
    const profileEmoji: Record<string, string> = {
      sniper: '🎯', early: '⚡', balanced: '⚖️', conservative: '🛡️',
      graduation: '🎓', whale: '🐋', degen: '🎰', cto: '🔍',
      micro: '💎', small: '🥉', mid: '🥈', large: '🥇', mega: '👑',
      trending: '🔥', momentum: '📈', fresh: '🆕', revival: '💀', runner: '🏃',
      custom: '⚙️',
    };

    profilesWithData.forEach((p, i) => {
      const emoji = profileEmoji[p.profile] || '•';
      const decided = p.winners + p.losers;
      lines.push(
        `${i + 1}. ${emoji} <b>${p.profile.toUpperCase()}</b>: ${p.winRate.toFixed(0)}% win (${p.winners}W/${p.losers}L)`
      );
      if (p.avgPriceChange24h !== 0) {
        lines.push(`   Avg 24h: ${formatPercent(p.avgPriceChange24h)}`);
      }
    });
  }

  if (perfData.lastOptimized) {
    lines.push(``);
    lines.push(`🔧 Last optimized: ${timeAgo(perfData.lastOptimized)}`);
  }

  lines.push(``);
  lines.push(`<i>💡 Use /filter optimize to switch to best performer</i>`);

  return lines.join('\n');
}

export function formatFilterAdjustment(type: 'tighten' | 'loosen', changes: { param: string; old: any; new: any }[]): string {
  const emoji = type === 'tighten' ? '🔒' : '🔓';
  const action = type === 'tighten' ? 'TIGHTENED' : 'LOOSENED';
  const desc = type === 'tighten' 
    ? 'Made stricter (75% harder to pass)'
    : 'Made looser (150% easier to pass)';

  const lines = [
    `${emoji} <b>FILTERS ${action}</b>`,
    ``,
    `<i>${desc}</i>`,
    ``,
    `━━━ <b>KEY CHANGES</b> ━━━`,
  ];

  // Show top 5 most significant changes
  changes.slice(0, 5).forEach(change => {
    lines.push(`${change.param}: ${change.old} → ${change.new}`);
  });

  if (changes.length > 5) {
    lines.push(`<i>...and ${changes.length - 5} more</i>`);
  }

  lines.push(``);
  lines.push(`✅ Profile switched to <b>CUSTOM</b>`);
  lines.push(``);
  lines.push(`Use /settings to see all current filters`);

  return lines.join('\n');
}
