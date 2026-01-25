import { Link } from 'react-router-dom';
import { TrendingUp, Award, ExternalLink } from 'lucide-react';
import { SmartMoneyWallet } from '@/types';
import { formatNumber, truncateAddress, timeAgo } from '@/utils/format';
import { cn } from '@/utils/cn';

interface SmartMoneyTableProps {
  wallets: SmartMoneyWallet[];
  onWalletClick?: (wallet: SmartMoneyWallet) => void;
}

export const SmartMoneyTable = ({ wallets, onWalletClick }: SmartMoneyTableProps) => {
  const getTradingStyleBadge = (style?: string) => {
    const styles = {
      scalper: { label: 'Scalper', color: 'bg-purple-500/20 text-purple-400' },
      swing: { label: 'Swing', color: 'bg-blue-500/20 text-blue-400' },
      holder: { label: 'Holder', color: 'bg-green-500/20 text-green-400' },
    };

    if (!style || !styles[style as keyof typeof styles]) {
      return null;
    }

    const { label, color } = styles[style as keyof typeof styles];

    return (
      <span className={cn('px-2 py-0.5 rounded text-xs font-medium', color)}>
        {label}
      </span>
    );
  };

  const getReputationColor = (score: number) => {
    if (score >= 80) return 'text-green-400';
    if (score >= 60) return 'text-blue-400';
    if (score >= 40) return 'text-yellow-400';
    return 'text-gray-400';
  };

  if (wallets.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No smart money wallets tracked yet
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-800 text-left text-sm text-gray-400">
            <th className="pb-3 font-medium">Wallet</th>
            <th className="pb-3 font-medium">Style</th>
            <th className="pb-3 font-medium text-right">Trades</th>
            <th className="pb-3 font-medium text-right">Win Rate</th>
            <th className="pb-3 font-medium text-right">Profit (SOL)</th>
            <th className="pb-3 font-medium text-right">Avg Profit %</th>
            <th className="pb-3 font-medium text-right">Reputation</th>
            <th className="pb-3 font-medium">Last Trade</th>
            <th className="pb-3"></th>
          </tr>
        </thead>
        <tbody>
          {wallets.map((wallet) => (
            <tr
              key={wallet.wallet_address}
              className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer transition-colors"
              onClick={() => onWalletClick?.(wallet)}
            >
              {/* Wallet Address */}
              <td className="py-4">
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono text-blue-400">
                    {truncateAddress(wallet.wallet_address, 6)}
                  </code>
                </div>
              </td>

              {/* Trading Style */}
              <td className="py-4">
                {getTradingStyleBadge(wallet.trading_style)}
              </td>

              {/* Total Trades */}
              <td className="py-4 text-right font-medium text-white">
                {wallet.total_trades}
              </td>

              {/* Win Rate */}
              <td className="py-4 text-right">
                <div className="flex items-center justify-end gap-1">
                  <div
                    className={cn(
                      'font-medium',
                      wallet.win_rate >= 70 ? 'text-green-400' : wallet.win_rate >= 50 ? 'text-yellow-400' : 'text-red-400'
                    )}
                  >
                    {(wallet.win_rate * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500">
                    ({wallet.winning_trades}/{wallet.total_trades})
                  </div>
                </div>
              </td>

              {/* Total Profit */}
              <td className="py-4 text-right">
                <div
                  className={cn(
                    'font-medium',
                    wallet.total_profit_sol >= 0 ? 'text-green-400' : 'text-red-400'
                  )}
                >
                  {wallet.total_profit_sol >= 0 ? '+' : ''}
                  {wallet.total_profit_sol.toFixed(2)} SOL
                </div>
              </td>

              {/* Avg Profit % */}
              <td className="py-4 text-right">
                <div
                  className={cn(
                    'font-medium',
                    wallet.average_profit_percent >= 0 ? 'text-green-400' : 'text-red-400'
                  )}
                >
                  {wallet.average_profit_percent >= 0 ? '+' : ''}
                  {wallet.average_profit_percent.toFixed(1)}%
                </div>
              </td>

              {/* Reputation Score */}
              <td className="py-4 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Award className={cn('h-4 w-4', getReputationColor(wallet.reputation_score))} />
                  <span className={cn('font-medium', getReputationColor(wallet.reputation_score))}>
                    {wallet.reputation_score}
                  </span>
                </div>
              </td>

              {/* Last Trade */}
              <td className="py-4 text-sm text-gray-500">
                {wallet.last_trade_at ? timeAgo(wallet.last_trade_at * 1000) : 'N/A'}
              </td>

              {/* Actions */}
              <td className="py-4">
                <Link
                  to={`/smart-money/${wallet.wallet_address}`}
                  className="text-blue-400 hover:text-blue-300"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
