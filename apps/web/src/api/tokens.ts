import { apiClient } from './client';
import { Token, TokenAnalysis } from '@/types';

export interface TokenListParams {
  limit?: number;
  offset?: number;
  sortBy?: string;
  riskLevel?: string[];
  minLiquidity?: number;
  maxRiskScore?: number;
}

export const tokensApi = {
  // Get list of monitored tokens
  getTokens: async (params?: TokenListParams) => {
    const { data } = await apiClient.get<Token[]>('/api/tokens', { params });
    return data;
  },

  // Get single token detail with full analysis
  getTokenDetail: async (mint: string) => {
    const { data } = await apiClient.get<TokenAnalysis>(`/api/tokens/${mint}`);
    return data;
  },

  // Get token price history
  getPriceHistory: async (mint: string, interval: string = '5m') => {
    const { data } = await apiClient.get<Array<{ timestamp: number; price: number; volume: number }>>(
      `/api/tokens/${mint}/price-history`,
      { params: { interval } }
    );
    return data;
  },

  // Get token holder distribution
  getHolderDistribution: async (mint: string) => {
    const { data } = await apiClient.get<Array<{ range: string; count: number; percentage: number }>>(
      `/api/tokens/${mint}/holders`
    );
    return data;
  },

  // Refresh token analysis
  refreshAnalysis: async (mint: string) => {
    const { data } = await apiClient.post<TokenAnalysis>(`/api/tokens/${mint}/refresh`);
    return data;
  },
};
