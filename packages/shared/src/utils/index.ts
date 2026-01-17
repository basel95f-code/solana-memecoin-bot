/**
 * Shared Utilities for Solana Memecoin Bot
 */

// ============================================
// Number Formatters
// ============================================

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

export function formatSol(amount: number): string {
  return amount.toFixed(4) + ' SOL';
}

// ============================================
// Time Formatters
// ============================================

export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ============================================
// Address Formatters
// ============================================

export function shortenAddress(address: string, chars: number = 4): string {
  if (!address) return '';
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function isValidSolanaAddress(address: string): boolean {
  if (!address) return false;
  if (address.length < 32 || address.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

// ============================================
// Risk Level Helpers
// ============================================

import type { RiskLevel, AlertPriority } from '../types';

export function getRiskColor(level: RiskLevel): string {
  switch (level) {
    case 'LOW':
      return '#22c55e'; // green
    case 'MEDIUM':
      return '#eab308'; // yellow
    case 'HIGH':
      return '#f97316'; // orange
    case 'VERY_HIGH':
      return '#ef4444'; // red
    case 'EXTREME':
      return '#dc2626'; // dark red
    default:
      return '#6b7280'; // gray
  }
}

export function getRiskEmoji(level: RiskLevel): string {
  switch (level) {
    case 'LOW':
      return '🟢';
    case 'MEDIUM':
      return '🟡';
    case 'HIGH':
      return '🟠';
    case 'VERY_HIGH':
      return '🔴';
    case 'EXTREME':
      return '⛔';
    default:
      return '⚪';
  }
}

export function getPriorityColor(priority: AlertPriority): string {
  switch (priority) {
    case 'critical':
      return '#dc2626'; // red
    case 'high':
      return '#f97316'; // orange
    case 'normal':
      return '#3b82f6'; // blue
    case 'low':
      return '#6b7280'; // gray
    default:
      return '#6b7280';
  }
}

// ============================================
// Validation Helpers
// ============================================

export function validateFilterSettings(settings: any): string[] {
  const errors: string[] = [];

  if (typeof settings.minLiquidity !== 'number' || settings.minLiquidity < 0) {
    errors.push('minLiquidity must be a non-negative number');
  }

  if (typeof settings.maxTop10Percent !== 'number' ||
      settings.maxTop10Percent < 0 ||
      settings.maxTop10Percent > 100) {
    errors.push('maxTop10Percent must be between 0 and 100');
  }

  if (typeof settings.minHolders !== 'number' || settings.minHolders < 1) {
    errors.push('minHolders must be at least 1');
  }

  if (typeof settings.minRiskScore !== 'number' ||
      settings.minRiskScore < 0 ||
      settings.minRiskScore > 100) {
    errors.push('minRiskScore must be between 0 and 100');
  }

  return errors;
}

// ============================================
// Calculation Helpers
// ============================================

export function calculatePnL(entryPrice: number, currentPrice: number): {
  absolute: number;
  percent: number;
} {
  const absolute = currentPrice - entryPrice;
  const percent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
  return { absolute, percent };
}

export function calculateWinRate(wins: number, total: number): number {
  if (total === 0) return 0;
  return (wins / total) * 100;
}

export function calculateSharpeRatio(
  returns: number[],
  riskFreeRate: number = 0
): number {
  if (returns.length < 2) return 0;

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
    (returns.length - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;
  return (avgReturn - riskFreeRate) / stdDev;
}

export function calculateMaxDrawdown(equityCurve: number[]): {
  maxDrawdown: number;
  maxDrawdownDuration: number;
} {
  if (equityCurve.length < 2) {
    return { maxDrawdown: 0, maxDrawdownDuration: 0 };
  }

  let peak = equityCurve[0];
  let maxDrawdown = 0;
  let maxDrawdownDuration = 0;
  let currentDrawdownStart = 0;

  for (let i = 0; i < equityCurve.length; i++) {
    if (equityCurve[i] > peak) {
      peak = equityCurve[i];
      currentDrawdownStart = i;
    }

    const drawdown = ((peak - equityCurve[i]) / peak) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownDuration = i - currentDrawdownStart;
    }
  }

  return { maxDrawdown, maxDrawdownDuration };
}
