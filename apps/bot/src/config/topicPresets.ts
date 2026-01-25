import type { TopicMode } from '../services/topicManager';

export interface TopicPreset {
  mode: TopicMode;
  allowedCommands?: string[];
  description: string;
}

export const TOPIC_PRESETS: Record<string, TopicPreset> = {
  'token-scanner': {
    mode: 'command_only',
    allowedCommands: [
      'check',
      'scan',
      'watch',
      'unwatch',
      'risk',
      'holders',
      'lp',
      'socials',
      'compare',
      'rug',
      'contract',
      'honeypot',
      'diagnose',
    ],
    description: 'Token analysis and scanning commands',
  },

  'whale-tracker': {
    mode: 'command_only',
    allowedCommands: [
      'whales',
      'track',
      'untrack',
      'wallet',
      'wallets',
      'profile',
      'leaderboard',
      'whale',
      'whaleactivity',
      'accumulating',
      'distributing',
      'style',
      'clusters',
      'sybil',
      'vsleader',
    ],
    description: 'Whale and wallet tracking commands',
  },

  'signals': {
    mode: 'command_only',
    allowedCommands: [
      'signals',
      'ack',
      'outcome',
      'kelly',
      'correlation',
    ],
    description: 'Trading signals commands',
  },

  'aped-tokens': {
    mode: 'read_only',
    description: 'Bot-only updates for group watchlist',
  },

  'leaderboard': {
    mode: 'command_only',
    allowedCommands: [
      'leaderboard',
      'mystats',
    ],
    description: 'Leaderboard and stats commands',
  },

  'general': {
    mode: 'normal',
    description: 'All messages allowed - normal discussion',
  },

  'market-discovery': {
    mode: 'command_only',
    allowedCommands: [
      'trending',
      'new',
      'gainers',
      'losers',
      'volume',
      'scanner',
    ],
    description: 'Market discovery and trending commands',
  },

  'portfolio': {
    mode: 'command_only',
    allowedCommands: [
      'portfolio',
      'buy',
      'sell',
      'pnl',
    ],
    description: 'Portfolio tracking commands',
  },

  'backtesting': {
    mode: 'command_only',
    allowedCommands: [
      'strategies',
      'backtest',
      'btresults',
      'newstrategy',
      'viewstrategy',
      'snapshots',
    ],
    description: 'Backtesting and strategy commands',
  },

  'ml-training': {
    mode: 'command_only',
    allowedCommands: [
      'ml',
      'learn',
      'outcomes',
      'sentiment',
    ],
    description: 'ML training and learning commands',
  },
};

/**
 * Get list of all preset names
 */
export function getPresetNames(): string[] {
  return Object.keys(TOPIC_PRESETS);
}

/**
 * Get preset by name
 */
export function getPreset(name: string): TopicPreset | null {
  return TOPIC_PRESETS[name] || null;
}

/**
 * Check if preset exists
 */
export function hasPreset(name: string): boolean {
  return name in TOPIC_PRESETS;
}
