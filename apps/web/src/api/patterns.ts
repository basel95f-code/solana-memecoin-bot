import { apiClient } from './client';
import { Pattern } from '@/types';

export interface PatternMatch {
  id: number;
  patternName: string;
  patternType: 'success' | 'rug' | 'neutral';
  matchScore: number;
  matchedCriteria: string[];
  successRate: number;
  averagePeakMultiplier: number;
}

export interface PatternHistory {
  id: number;
  tokenMint: string;
  tokenSymbol: string;
  patternName: string;
  matchScore: number;
  actualOutcome?: string;
  peakMultiplier?: number;
  matchedAt: number;
}

export const patternsApi = {
  // Get all patterns
  getPatterns: async () => {
    const { data } = await apiClient.get<Pattern[]>('/api/patterns');
    return data;
  },

  // Get pattern matches for a specific token
  getTokenPatterns: async (mint: string) => {
    const { data } = await apiClient.get<PatternMatch[]>(`/api/patterns/${mint}`);
    return data;
  },

  // Get pattern match history
  getPatternHistory: async (limit: number = 50) => {
    const { data } = await apiClient.get<PatternHistory[]>('/api/patterns/history', {
      params: { limit },
    });
    return data;
  },

  // Get pattern statistics
  getPatternStats: async (patternId: number) => {
    const { data } = await apiClient.get(`/api/patterns/${patternId}/stats`);
    return data;
  },

  // Trigger pattern discovery
  discoverPatterns: async () => {
    const { data } = await apiClient.post('/api/patterns/discover');
    return data;
  },
};
