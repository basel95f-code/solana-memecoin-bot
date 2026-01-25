export function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  if (num >= 1) return num.toFixed(2);
  return num.toFixed(6);
}

export function formatPrice(price: number): string {
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.0001) return `$${price.toFixed(6)}`;
  return `$${price.toExponential(2)}`;
}

export function formatPercent(num: number): string {
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(1)}%`;
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

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getRiskColor(score: number): string {
  if (score >= 70) return 'text-profit';
  if (score >= 50) return 'text-yellow-500';
  if (score >= 30) return 'text-orange-500';
  return 'text-loss';
}

export function getRiskEmoji(level: string): string {
  const map: Record<string, string> = {
    LOW: '🟢',
    MEDIUM: '🟡',
    HIGH: '🟠',
    VERY_HIGH: '🔴',
    EXTREME: '⛔',
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
