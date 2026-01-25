import { useQuery } from '@tanstack/react-query';
import { tokensApi, TokenListParams } from '@/api/tokens';

export const useTokens = (params?: TokenListParams) => {
  return useQuery({
    queryKey: ['tokens', params],
    queryFn: () => tokensApi.getTokens(params),
    refetchInterval: 10000, // Refetch every 10 seconds
    staleTime: 5000,
  });
};

export const useTokenDetail = (mint: string) => {
  return useQuery({
    queryKey: ['token', mint],
    queryFn: () => tokensApi.getTokenDetail(mint),
    enabled: !!mint,
    refetchInterval: 15000,
  });
};

export const usePriceHistory = (mint: string, interval: string = '5m') => {
  return useQuery({
    queryKey: ['price-history', mint, interval],
    queryFn: () => tokensApi.getPriceHistory(mint, interval),
    enabled: !!mint,
    refetchInterval: 30000,
  });
};

export const useHolderDistribution = (mint: string) => {
  return useQuery({
    queryKey: ['holders', mint],
    queryFn: () => tokensApi.getHolderDistribution(mint),
    enabled: !!mint,
    staleTime: 60000, // 1 minute
  });
};
