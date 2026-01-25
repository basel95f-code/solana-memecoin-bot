import { useState } from 'react';
import { Plus, TrendingUp, Wallet } from 'lucide-react';
import { useSmartMoneyWallets, useSmartMoneyActivity } from '@/hooks/useSmartMoney';
import { SmartMoneyTable } from '@/components/SmartMoneyTable';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { formatNumber, truncateAddress, timeAgo } from '@/utils/format';
import { cn } from '@/utils/cn';

export const SmartMoney = () => {
  const [showAddWallet, setShowAddWallet] = useState(false);
  const { data: wallets, isLoading } = useSmartMoneyWallets(100);
  const { data: activity } = useSmartMoneyActivity(20);

  const stats = wallets
    ? {
        totalWallets: wallets.length,
        avgWinRate: wallets.reduce((sum, w) => sum + w.win_rate, 0) / wallets.length,
        totalProfit: wallets.reduce((sum, w) => sum + w.total_profit_sol, 0),
        topPerformer: wallets.reduce((best, w) =>
          w.total_profit_sol > (best?.total_profit_sol || 0) ? w : best
        , wallets[0]),
      }
    : null;

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">
              Smart Money Tracking 💎
            </h1>
            <p className="text-gray-400">
              Follow profitable wallets and their trading activity
            </p>
          </div>
          <button
            onClick={() => setShowAddWallet(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Wallet
          </button>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
              <div className="text-sm text-gray-400 mb-1">Tracked Wallets</div>
              <div className="text-2xl font-bold text-white">{stats.totalWallets}</div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
              <div className="text-sm text-gray-400 mb-1">Avg Win Rate</div>
              <div className="text-2xl font-bold text-green-400">
                {(stats.avgWinRate * 100).toFixed(1)}%
              </div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
              <div className="text-sm text-gray-400 mb-1">Total Profit</div>
              <div className="text-2xl font-bold text-green-400">
                +{stats.totalProfit.toFixed(2)} SOL
              </div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
              <div className="text-sm text-gray-400 mb-1">Top Performer</div>
              <div className="text-sm font-mono text-blue-400 truncate">
                {truncateAddress(stats.topPerformer.wallet_address, 6)}
              </div>
              <div className="text-xs text-green-400">
                +{stats.topPerformer.total_profit_sol.toFixed(2)} SOL
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Table */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <h2 className="text-xl font-bold text-white mb-4">Wallet Performance</h2>
            {isLoading ? (
              <LoadingSpinner size="lg" />
            ) : wallets && wallets.length > 0 ? (
              <SmartMoneyTable wallets={wallets} />
            ) : (
              <div className="text-center py-12">
                <Wallet className="h-16 w-16 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-400 mb-2">No wallets tracked</h3>
                <p className="text-gray-500 mb-4">Start tracking profitable wallets</p>
                <button
                  onClick={() => setShowAddWallet(true)}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
                >
                  Add Your First Wallet
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity Sidebar */}
        <div>
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 sticky top-24">
            <h2 className="text-xl font-bold text-white mb-4">Recent Activity</h2>
            {activity && activity.length > 0 ? (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {activity.map((act, idx) => (
                  <div key={idx} className="p-3 rounded-lg border border-gray-800 bg-gray-800/30">
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded text-xs font-medium',
                          act.action === 'buy'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        )}
                      >
                        {act.action.toUpperCase()}
                      </span>
                      <span className="text-xs text-gray-500">
                        {timeAgo(act.timestamp * 1000)}
                      </span>
                    </div>
                    
                    <div className="text-sm font-medium text-white mb-1">
                      {act.token_symbol}
                    </div>
                    
                    <div className="flex items-center justify-between text-xs">
                      <code className="text-blue-400 font-mono">
                        {truncateAddress(act.wallet_address, 4)}
                      </code>
                      <span className="text-gray-400">
                        {act.amount_sol.toFixed(2)} SOL
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                No recent activity
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Wallet Modal */}
      {showAddWallet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-6">
            <h3 className="text-xl font-bold text-white mb-4">Add Wallet to Track</h3>
            <input
              type="text"
              placeholder="Enter Solana wallet address..."
              className="w-full px-4 py-3 rounded-lg border border-gray-700 bg-gray-800 text-white focus:border-blue-500 focus:outline-none mb-4"
            />
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowAddWallet(false)}
                className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors">
                Add Wallet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
