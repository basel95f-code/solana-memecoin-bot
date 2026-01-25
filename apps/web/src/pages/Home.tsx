import { useState } from 'react';
import { Filter, RefreshCw, TrendingUp } from 'lucide-react';
import { useTokens } from '@/hooks/useTokens';
import { useWebSocket } from '@/hooks/useWebSocket';
import { TokenCard } from '@/components/TokenCard';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { cn } from '@/utils/cn';

export const Home = () => {
  const [riskFilters, setRiskFilters] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState('discovered_at');
  const [minLiquidity, setMinLiquidity] = useState<number>();

  const { data: tokens, isLoading, refetch, isFetching } = useTokens({
    riskLevel: riskFilters,
    sortBy,
    minLiquidity,
  });

  useWebSocket(); // Connect to WebSocket for real-time updates

  const toggleRiskFilter = (level: string) => {
    setRiskFilters((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]
    );
  };

  const riskLevels = [
    { value: 'LOW', label: 'Low Risk', color: 'bg-green-500' },
    { value: 'MEDIUM', label: 'Medium', color: 'bg-yellow-500' },
    { value: 'HIGH', label: 'High', color: 'bg-orange-500' },
    { value: 'VERY_HIGH', label: 'Very High', color: 'bg-red-500' },
    { value: 'EXTREME', label: 'Extreme', color: 'bg-red-700' },
  ];

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">
              Live Token Feed 🚀
            </h1>
            <p className="text-gray-400">
              Real-time monitoring of new Solana memecoin launches
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors',
              isFetching && 'opacity-50 cursor-not-allowed'
            )}
          >
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4 p-4 rounded-lg border border-gray-800 bg-gray-900/50">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-400">Filters:</span>
          </div>

          {/* Risk Level Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {riskLevels.map((level) => (
              <button
                key={level.value}
                onClick={() => toggleRiskFilter(level.value)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-all border',
                  riskFilters.includes(level.value)
                    ? `${level.color} text-white border-transparent`
                    : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-600'
                )}
              >
                {level.label}
              </button>
            ))}
          </div>

          {/* Sort By */}
          <div className="flex items-center gap-2 ml-auto">
            <label className="text-sm text-gray-400">Sort:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-white text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="discovered_at">Latest</option>
              <option value="price_change_24h">Price Change</option>
              <option value="volume_24h">Volume</option>
              <option value="risk_score">Risk Score</option>
              <option value="liquidity">Liquidity</option>
            </select>
          </div>

          {/* Min Liquidity */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">Min Liquidity:</label>
            <input
              type="number"
              value={minLiquidity || ''}
              onChange={(e) => setMinLiquidity(e.target.value ? Number(e.target.value) : undefined)}
              placeholder="$10,000"
              className="w-32 px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-white text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Token Grid */}
      {isLoading ? (
        <LoadingSpinner size="lg" />
      ) : tokens && tokens.length > 0 ? (
        <>
          <div className="mb-4 text-sm text-gray-400">
            Showing {tokens.length} token{tokens.length !== 1 ? 's' : ''}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {tokens.map((token) => (
              <TokenCard key={token.mint} token={token} />
            ))}
          </div>
        </>
      ) : (
        <div className="text-center py-16">
          <TrendingUp className="h-16 w-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-400 mb-2">No tokens found</h3>
          <p className="text-gray-500">
            {riskFilters.length > 0 || minLiquidity
              ? 'Try adjusting your filters'
              : 'Waiting for new token discoveries...'}
          </p>
        </div>
      )}
    </div>
  );
};
