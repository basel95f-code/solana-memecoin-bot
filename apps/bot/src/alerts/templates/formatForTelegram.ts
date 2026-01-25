/**
 * Format alerts for Telegram (Markdown)
 */

import type { Alert, AlertBatch } from '../../services/alerts/types';

export interface TelegramFormattedMessage {
  text: string;
  parse_mode: 'Markdown' | 'HTML';
  disable_web_page_preview?: boolean;
}

/**
 * Format single alert for Telegram
 */
export function formatAlertForTelegram(alert: Alert): TelegramFormattedMessage {
  const emoji = getEmojiForType(alert.type);
  const priorityTag = getPriorityTag(alert.priority);

  let text = `${emoji} *${escapeMarkdown(alert.title)}* ${priorityTag}\n\n`;
  text += escapeMarkdown(alert.message);

  // Add data fields if present
  if (Object.keys(alert.data).length > 0) {
    text += '\n\n' + formatDataFields(alert.data);
  }

  return {
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  };
}

/**
 * Format batch for Telegram
 */
export function formatBatchForTelegram(batch: AlertBatch): TelegramFormattedMessage {
  const emoji = getEmojiForType(batch.type);
  const priorityTag = getPriorityTag(batch.priority);

  let text = `${emoji} *${escapeMarkdown(batch.summary)}* ${priorityTag}\n\n`;
  text += `📋 ${batch.alerts.length} alerts:\n\n`;

  // List first 5 alerts
  for (const alert of batch.alerts.slice(0, 5)) {
    text += `• ${escapeMarkdown(alert.title)}\n`;
    if (alert.data.symbol) {
      text += `  Symbol: *${escapeMarkdown(alert.data.symbol)}*\n`;
    }
  }

  if (batch.alerts.length > 5) {
    text += `\n_... and ${batch.alerts.length - 5} more alerts_`;
  }

  return {
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  };
}

/**
 * Format data fields for display
 */
function formatDataFields(data: Record<string, any>): string {
  const lines: string[] = [];

  // Token info
  if (data.symbol) {
    lines.push(`📌 *Symbol:* ${escapeMarkdown(data.symbol)}`);
  }

  if (data.mint || data.tokenMint) {
    const mint = data.mint || data.tokenMint;
    const shortMint = `${mint.slice(0, 8)}...${mint.slice(-6)}`;
    lines.push(`🔑 *Mint:* \`${shortMint}\``);
  }

  // Price info
  if (data.price !== undefined) {
    lines.push(`💰 *Price:* $${formatNumber(data.price)}`);
  }

  if (data.priceChange1h !== undefined) {
    const change = data.priceChange1h;
    const emoji = change >= 0 ? '📈' : '📉';
    lines.push(`${emoji} *1h Change:* ${formatPercent(change)}`);
  }

  if (data.priceChange24h !== undefined) {
    const change = data.priceChange24h;
    const emoji = change >= 0 ? '📈' : '📉';
    lines.push(`${emoji} *24h Change:* ${formatPercent(change)}`);
  }

  // Volume and liquidity
  if (data.volume !== undefined || data.volume24h !== undefined) {
    const volume = data.volume || data.volume24h;
    lines.push(`📊 *Volume:* $${formatNumber(volume)}`);
  }

  if (data.liquidity !== undefined) {
    lines.push(`💧 *Liquidity:* $${formatNumber(data.liquidity)}`);
  }

  if (data.marketCap !== undefined) {
    lines.push(`🏦 *Market Cap:* $${formatNumber(data.marketCap)}`);
  }

  // Risk indicators
  if (data.riskScore !== undefined) {
    const riskEmoji = data.riskScore >= 80 ? '🟢' : data.riskScore >= 50 ? '🟡' : '🔴';
    lines.push(`${riskEmoji} *Risk Score:* ${data.riskScore}/100`);
  }

  if (data.holders !== undefined) {
    lines.push(`👥 *Holders:* ${formatNumber(data.holders)}`);
  }

  if (data.topHolderPercent !== undefined) {
    lines.push(`🐋 *Top Holder:* ${formatPercent(data.topHolderPercent)}`);
  }

  // Authority status
  if (data.mintDisabled !== undefined) {
    const emoji = data.mintDisabled ? '✅' : '⚠️';
    lines.push(`${emoji} *Mint:* ${data.mintDisabled ? 'Disabled' : 'Enabled'}`);
  }

  if (data.freezeDisabled !== undefined) {
    const emoji = data.freezeDisabled ? '✅' : '⚠️';
    lines.push(`${emoji} *Freeze:* ${data.freezeDisabled ? 'Disabled' : 'Enabled'}`);
  }

  if (data.lpLocked !== undefined) {
    const emoji = data.lpLocked ? '🔒' : '⚠️';
    lines.push(`${emoji} *LP:* ${data.lpLocked ? 'Locked' : 'Unlocked'}`);
  }

  return lines.join('\n');
}

/**
 * Format number with K/M/B suffix
 */
function formatNumber(num: number): string {
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(num < 1 ? 6 : 2);
}

/**
 * Format percentage
 */
function formatPercent(num: number): string {
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

/**
 * Get emoji for alert type
 */
function getEmojiForType(type: string): string {
  const emojiMap: Record<string, string> = {
    new_token: '✨',
    volume_spike: '📊',
    whale_movement: '🐋',
    liquidity_drain: '💧',
    authority_change: '🔐',
    price_alert: '💰',
    smart_money: '🧠',
    wallet_activity: '👛',
    trading_signal: '📡',
    rug_detected: '🚨',
    system: 'ℹ️',
  };

  return emojiMap[type] || '🔔';
}

/**
 * Get priority tag
 */
function getPriorityTag(priority: string): string {
  switch (priority) {
    case 'critical':
      return '🔴 *CRITICAL*';
    case 'high':
      return '🟠 *HIGH*';
    case 'normal':
      return '🟡';
    case 'low':
      return '🟢';
    default:
      return '';
  }
}

/**
 * Escape Markdown special characters
 */
function escapeMarkdown(text: string): string {
  // Escape Markdown special characters
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
