import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(num: number, decimals: number = 2): string {
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(decimals) + 'B';
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(decimals) + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(decimals) + 'K';
  }
  return num.toFixed(decimals);
}

export function formatCurrency(num: number, decimals: number = 2): string {
  return '$' + formatNumber(num, decimals);
}

export function formatPercent(num: number, decimals: number = 1): string {
  const sign = num >= 0 ? '+' : '';
  return sign + num.toFixed(decimals) + '%';
}

export function formatPrice(price: number): string {
  if (price === 0) return '$0.00';
  if (price >= 1) return '$' + price.toFixed(2);
  if (price >= 0.01) return '$' + price.toFixed(4);
  if (price >= 0.0001) return '$' + price.toFixed(6);
  return '$' + price.toExponential(2);
}

export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

export function shortenAddress(address: string, chars: number = 4): string {
  if (!address) return '';
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function getRiskColor(level: string): string {
  switch (level) {
    case 'LOW':
      return 'text-green-500';
    case 'MEDIUM':
      return 'text-yellow-500';
    case 'HIGH':
      return 'text-orange-500';
    case 'VERY_HIGH':
    case 'EXTREME':
      return 'text-red-500';
    default:
      return 'text-gray-500';
  }
}

export function getRiskBgColor(level: string): string {
  switch (level) {
    case 'LOW':
      return 'bg-green-500/20';
    case 'MEDIUM':
      return 'bg-yellow-500/20';
    case 'HIGH':
      return 'bg-orange-500/20';
    case 'VERY_HIGH':
    case 'EXTREME':
      return 'bg-red-500/20';
    default:
      return 'bg-gray-500/20';
  }
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'healthy':
      return 'bg-green-500';
    case 'degraded':
      return 'bg-yellow-500';
    case 'unhealthy':
      return 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
}

export function getPriceChangeColor(change: number): string {
  if (change > 0) return 'text-green-500';
  if (change < 0) return 'text-red-500';
  return 'text-gray-500';
}
