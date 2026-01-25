import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { smartMoneyApi } from '@/api/smartMoney';

export const useSmartMoneyWallets = (limit: number = 50) => {
  return useQuery({
    queryKey: ['smart-money-wallets', limit],
    queryFn: () => smartMoneyApi.getWallets(limit),
    refetchInterval: 30000,
  });
};

export const useWalletDetail = (walletAddress: string) => {
  return useQuery({
    queryKey: ['wallet-detail', walletAddress],
    queryFn: () => smartMoneyApi.getWalletDetail(walletAddress),
    enabled: !!walletAddress,
  });
};

export const useWalletTrades = (walletAddress: string, limit: number = 100) => {
  return useQuery({
    queryKey: ['wallet-trades', walletAddress, limit],
    queryFn: () => smartMoneyApi.getWalletTrades(walletAddress, limit),
    enabled: !!walletAddress,
  });
};

export const useSmartMoneyActivity = (limit: number = 50) => {
  return useQuery({
    queryKey: ['smart-money-activity', limit],
    queryFn: () => smartMoneyApi.getRecentActivity(limit),
    refetchInterval: 15000,
  });
};

export const useTokenSmartMoneyActivity = (mint: string) => {
  return useQuery({
    queryKey: ['token-smart-money', mint],
    queryFn: () => smartMoneyApi.getTokenActivity(mint),
    enabled: !!mint,
    refetchInterval: 20000,
  });
};

export const useAddWallet = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (walletAddress: string) => smartMoneyApi.addWallet(walletAddress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smart-money-wallets'] });
    },
  });
};

export const useRemoveWallet = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (walletAddress: string) => smartMoneyApi.removeWallet(walletAddress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smart-money-wallets'] });
    },
  });
};
