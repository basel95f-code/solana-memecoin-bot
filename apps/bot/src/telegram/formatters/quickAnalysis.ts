/**
 * Quick Analysis Formatter
 * Formats token analysis for auto-triggered responses
 */

export interface QuickAnalysisData {
  symbol: string;
  name: string;
  price: number;
  priceChange24h: number;
  marketCap: number;
  liquidity: number;
  volume24h: number;
  holders: number;
  riskScore: number;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  top10Percent: number;
  whaleCount: number;
  lpBurnedPercent: number;
  mint: string;
}

/**
 * Format number with K/M/B suffixes
 */
function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(2)}`;
}

/**
 * Get risk emoji and color
 */
function getRiskIndicator(riskScore: number): { emoji: string; label: string } {
  if (riskScore >= 80) return { emoji: '🟢', label: 'Low' };
  if (riskScore >= 60) return { emoji: '🟡', label: 'Medium' };
  if (riskScore >= 40) return { emoji: '🟠', label: 'High' };
  return { emoji: '🔴', label: 'Critical' };
}

/**
 * Get price change emoji
 */
function getPriceChangeEmoji(change: number): string {
  if (change >= 50) return '🚀';
  if (change >= 20) return '📈';
  if (change >= 5) return '⬆️';
  if (change >= -5) return '➡️';
  if (change >= -20) return '⬇️';
  return '📉';
}

/**
 * Format quick analysis (compact, single message)
 */
export function formatQuickAnalysis(data: QuickAnalysisData, mode: 'quick' | 'full' | 'chart' = 'quick'): string {
  if (mode === 'full') {
    return formatFullAnalysis(data);
  }

  if (mode === 'chart') {
    return formatChartAnalysis(data);
  }

  // Quick mode (default)
  const risk = getRiskIndicator(data.riskScore);
  const priceEmoji = getPriceChangeEmoji(data.priceChange24h);
  const changeSign = data.priceChange24h >= 0 ? '+' : '';

  let message = `🪙 <b>${data.symbol}</b> | ${formatPrice(data.price)} ${priceEmoji} ${changeSign}${data.priceChange24h.toFixed(1)}%\n`;
  message += `💰 MCap: ${formatNumber(data.marketCap)} | Liq: ${formatNumber(data.liquidity)}\n`;
  message += `📊 24h Vol: ${formatNumber(data.volume24h)} | 👥 ${data.holders} holders\n`;
  message += `${risk.emoji} Risk: ${data.riskScore}/100 (${risk.label}) | Top10: ${data.top10Percent.toFixed(0)}%\n`;
  
  // Add warnings
  const warnings: string[] = [];
  if (data.lpBurnedPercent < 50) warnings.push(`🔥 LP: ${data.lpBurnedPercent.toFixed(0)}%`);
  if (data.whaleCount > 5) warnings.push(`🐋 ${data.whaleCount} whales`);
  if (data.top10Percent > 50) warnings.push('⚠️ High concentration');

  if (warnings.length > 0) {
    message += warnings.join(' | ') + '\n';
  }

  message += `\n<code>${data.mint.slice(0, 8)}...${data.mint.slice(-6)}</code>`;

  return message;
}

/**
 * Format full analysis (detailed)
 */
function formatFullAnalysis(data: QuickAnalysisData): string {
  const risk = getRiskIndicator(data.riskScore);
  const priceEmoji = getPriceChangeEmoji(data.priceChange24h);
  const changeSign = data.priceChange24h >= 0 ? '+' : '';

  let message = `━━━ <b>${data.symbol}</b> - ${data.name} ━━━\n\n`;
  
  message += `💵 <b>Price:</b> ${formatPrice(data.price)} ${priceEmoji} ${changeSign}${data.priceChange24h.toFixed(1)}%\n`;
  message += `💰 <b>Market Cap:</b> ${formatNumber(data.marketCap)}\n`;
  message += `💧 <b>Liquidity:</b> ${formatNumber(data.liquidity)}\n`;
  message += `📊 <b>24h Volume:</b> ${formatNumber(data.volume24h)}\n\n`;

  message += `━━━ <b>Safety</b> ━━━\n`;
  message += `${risk.emoji} <b>Risk Score:</b> ${data.riskScore}/100 (${risk.label})\n`;
  message += `🔥 <b>LP Burned:</b> ${data.lpBurnedPercent.toFixed(0)}%\n`;
  message += `👥 <b>Holders:</b> ${data.holders}\n`;
  message += `📊 <b>Top 10:</b> ${data.top10Percent.toFixed(1)}%\n`;
  message += `🐋 <b>Whales:</b> ${data.whaleCount}\n\n`;

  // Verdict
  if (data.riskScore >= 70 && data.lpBurnedPercent >= 80 && data.top10Percent < 30) {
    message += `✅ <b>Verdict:</b> Relatively safe\n`;
  } else if (data.riskScore < 40 || data.lpBurnedPercent < 30 || data.top10Percent > 60) {
    message += `❌ <b>Verdict:</b> High risk - proceed with caution\n`;
  } else {
    message += `⚠️ <b>Verdict:</b> Medium risk - DYOR\n`;
  }

  message += `\n<code>${data.mint}</code>`;

  return message;
}

/**
 * Format chart analysis (with price action focus)
 */
function formatChartAnalysis(data: QuickAnalysisData): string {
  const risk = getRiskIndicator(data.riskScore);
  const priceEmoji = getPriceChangeEmoji(data.priceChange24h);
  const changeSign = data.priceChange24h >= 0 ? '+' : '';

  let message = `📈 <b>${data.symbol}</b> - Chart Analysis\n\n`;

  // Price action
  message += `💵 ${formatPrice(data.price)} ${priceEmoji} ${changeSign}${data.priceChange24h.toFixed(1)}% (24h)\n`;
  message += `📊 Vol: ${formatNumber(data.volume24h)} | MCap: ${formatNumber(data.marketCap)}\n\n`;

  // Quick metrics
  message += `${risk.emoji} Risk: ${data.riskScore}/100 | 💧 Liq: ${formatNumber(data.liquidity)}\n`;
  message += `👥 ${data.holders} holders | Top10: ${data.top10Percent.toFixed(0)}%\n`;

  // Technical signals (placeholder - you can add real TA later)
  const trend = data.priceChange24h > 10 ? '📈 Bullish' : data.priceChange24h < -10 ? '📉 Bearish' : '➡️ Neutral';
  message += `\n<b>Trend:</b> ${trend}\n`;

  message += `\n<code>${data.mint.slice(0, 8)}...${data.mint.slice(-6)}</code>`;

  return message;
}

/**
 * Format price with appropriate decimals
 */
function formatPrice(price: number): string {
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  if (price >= 0.0001) return `$${price.toFixed(6)}`;
  return `$${price.toExponential(2)}`;
}
