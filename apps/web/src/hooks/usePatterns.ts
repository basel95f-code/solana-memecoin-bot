import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { patternsApi } from '@/api/patterns';

export const usePatterns = () => {
  return useQuery({
    queryKey: ['patterns'],
    queryFn: () => patternsApi.getPatterns(),
    staleTime: 60000, // 1 minute
  });
};

export const useTokenPatterns = (mint: string) => {
  return useQuery({
    queryKey: ['token-patterns', mint],
    queryFn: () => patternsApi.getTokenPatterns(mint),
    enabled: !!mint,
  });
};

export const usePatternHistory = (limit: number = 50) => {
  return useQuery({
    queryKey: ['pattern-history', limit],
    queryFn: () => patternsApi.getPatternHistory(limit),
    refetchInterval: 30000,
  });
};

export const usePatternStats = (patternId: number) => {
  return useQuery({
    queryKey: ['pattern-stats', patternId],
    queryFn: () => patternsApi.getPatternStats(patternId),
    enabled: !!patternId,
  });
};

export const useDiscoverPatterns = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => patternsApi.discoverPatterns(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patterns'] });
      queryClient.invalidateQueries({ queryKey: ['pattern-history'] });
    },
  });
};
