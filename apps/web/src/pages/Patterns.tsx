import { useState } from 'react';
import { Brain, TrendingUp, AlertTriangle, RefreshCw } from 'lucide-react';
import { usePatterns, usePatternHistory, useDiscoverPatterns } from '@/hooks/usePatterns';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { cn } from '@/utils/cn';

export const Patterns = () => {
  const [selectedType, setSelectedType] = useState<'all' | 'success' | 'rug'>('all');
  const { data: patterns, isLoading } = usePatterns();
  const { data: history } = usePatternHistory(50);
  const discoverMutation = useDiscoverPatterns();

  const filteredPatterns = patterns?.filter(
    (p) => selectedType === 'all' || p.patternType === selectedType
  );

  const handleDiscoverPatterns = async () => {
    try {
      await discoverMutation.mutateAsync();
      alert('Pattern discovery started! This may take a few minutes.');
    } catch (error) {
      alert('Failed to start pattern discovery');
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">
              Pattern Detection 🧠
            </h1>
            <p className="text-gray-400">
              AI-learned patterns from historical token data
            </p>
          </div>
          <button
            onClick={handleDiscoverPatterns}
            disabled={discoverMutation.isPending}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 transition-colors',
              discoverMutation.isPending && 'opacity-50 cursor-not-allowed'
            )}
          >
            <RefreshCw className={cn('h-4 w-4', discoverMutation.isPending && 'animate-spin')} />
            Discover New Patterns
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2">
          {[
            { value: 'all', label: 'All Patterns', icon: Brain },
            { value: 'success', label: 'Success Patterns', icon: TrendingUp },
            { value: 'rug', label: 'Rug Patterns', icon: AlertTriangle },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.value}
                onClick={() => setSelectedType(tab.value as any)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all',
                  selectedType === tab.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pattern List */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <h2 className="text-xl font-bold text-white mb-4">
              Active Patterns ({filteredPatterns?.length || 0})
            </h2>

            {isLoading ? (
              <LoadingSpinner size="lg" />
            ) : filteredPatterns && filteredPatterns.length > 0 ? (
              <div className="space-y-4">
                {filteredPatterns.map((pattern) => {
                  const isSuccess = pattern.patternType === 'success';
                  return (
                    <div
                      key={pattern.id}
                      className={cn(
                        'p-4 rounded-lg border transition-all hover:shadow-lg',
                        isSuccess
                          ? 'border-green-500/30 bg-green-500/5 hover:border-green-500/50'
                          : 'border-red-500/30 bg-red-500/5 hover:border-red-500/50'
                      )}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="text-lg font-semibold text-white mb-1">
                            {isSuccess ? '✅' : '🚨'} {pattern.patternName}
                          </h3>
                          <div className="flex items-center gap-4 text-sm text-gray-400">
                            <span>Seen {pattern.occurrenceCount}x</span>
                            <span>•</span>
                            <span>Confidence: {(pattern.confidenceScore * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div
                            className={cn(
                              'text-2xl font-bold mb-1',
                              isSuccess ? 'text-green-400' : 'text-red-400'
                            )}
                          >
                            {(pattern.successRate * 100).toFixed(1)}%
                          </div>
                          <div className="text-xs text-gray-500">Success Rate</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4 mb-3 p-3 rounded bg-gray-800/30">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Avg Peak</div>
                          <div className="font-semibold text-white">
                            {pattern.averagePeakMultiplier.toFixed(1)}x
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Time to Peak</div>
                          <div className="font-semibold text-white">
                            {pattern.averageTimeToPeakHours.toFixed(0)}h
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Wins/Total</div>
                          <div className="font-semibold text-white">
                            {pattern.successCount}/{pattern.occurrenceCount}
                          </div>
                        </div>
                      </div>

                      {/* Criteria */}
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(pattern.criteria).map(([key, value], idx) => (
                          <span
                            key={idx}
                            className="px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-xs font-medium"
                          >
                            {key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12">
                <Brain className="h-16 w-16 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-400 mb-2">
                  No patterns found
                </h3>
                <p className="text-gray-500">
                  {selectedType === 'all'
                    ? 'Start discovering patterns from historical data'
                    : `No ${selectedType} patterns detected yet`}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Match History Sidebar */}
        <div>
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 sticky top-24">
            <h2 className="text-xl font-bold text-white mb-4">Recent Matches</h2>
            {history && history.length > 0 ? (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {history.map((match) => (
                  <div
                    key={match.id}
                    className="p-3 rounded-lg border border-gray-800 bg-gray-800/30"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <code className="text-sm font-mono text-blue-400">
                        {match.tokenSymbol}
                      </code>
                      <span className="text-xs text-gray-500">
                        {Math.round(match.matchScore * 100)}% match
                      </span>
                    </div>
                    
                    <div className="text-sm text-white mb-2 truncate">
                      {match.patternName}
                    </div>

                    {match.actualOutcome && (
                      <div
                        className={cn(
                          'text-xs px-2 py-1 rounded inline-block',
                          match.actualOutcome === 'success' || match.actualOutcome === 'moon'
                            ? 'bg-green-500/20 text-green-400'
                            : match.actualOutcome === 'rug'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-gray-500/20 text-gray-400'
                        )}
                      >
                        {match.actualOutcome}
                        {match.peakMultiplier && ` • ${match.peakMultiplier.toFixed(1)}x`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                No matches yet
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
