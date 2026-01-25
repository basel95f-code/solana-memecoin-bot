import { apiClient } from './client';
import { SmartMoneyWallet, SmartMoneyTrade } from '@/types';

export interface SmartMoneyActivity {
  wallet_address: string;
  action: 'buy' | 'sell';
  token_mint: string;
  token_symbol: string;
  amount_sol: number;
  price: number;
  timestamp: number;
}

export const smartMoneyApi = {
  // Get list of tracked smart money wallets
  getWallets: async (limit: number = 50) => {
    const { data } = await apiClient.get<SmartMoneyWallet[]>('/api/smart-money', {
      params: { limit },
    });
    return data;
  },

  // Get single wallet detail
  getWalletDetail: async (walletAddress: string) => {
    const { data } = await apiClient.get<SmartMoneyWallet>(`/api/smart-money/${walletAddress}`);
    return data;
  },

  // Get wallet trades
  getWalletTrades: async (walletAddress: string, limit: number = 100) => {
    const { data } = await apiClient.get<SmartMoneyTrade[]>(
      `/api/smart-money/${walletAddress}/trades`,
      { params: { limit } }
    );
    return data;
  },

  // Get recent smart money activity
  getRecentActivity: async (limit: number = 50) => {
    const { data } = await apiClient.get<SmartMoneyActivity[]>('/api/smart-money/activity', {
      params: { limit },
    });
    return data;
  },

  // Get smart money activity for a specific token
  getTokenActivity: async (mint: string) => {
    const { data } = await apiClient.get<SmartMoneyActivity[]>(
      `/api/smart-money/token/${mint}/activity`
    );
    return data;
  },

  // Add wallet to tracking
  addWallet: async (walletAddress: string) => {
    const { data } = await apiClient.post('/api/smart-money', { wallet_address: walletAddress });
    return data;
  },

  // Remove wallet from tracking
  removeWallet: async (walletAddress: string) => {
    await apiClient.delete(`/api/smart-money/${walletAddress}`);
  },
};
