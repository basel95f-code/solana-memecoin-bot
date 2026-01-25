import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, RefreshCw, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { useTokenDetail, usePriceHistory } from '@/hooks/useTokens';
import { useTokenPatterns } from '@/hooks/usePatterns';
import { useTokenSmartMoneyActivity } from '@/hooks/useSmartMoney';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { RiskBadge } from '@/components/RiskBadge';
import { PriceChart } from '@/components/PriceChart';
import { PatternIndicators } from '@/components/PatternIndicators';
import { formatNumber, formatPrice, formatPercent, truncateAddress } from '@/utils/format';
import { cn } from '@/utils/cn';

export const TokenDetail = () => {
  const { mint } = useParams<{ mint: string }>();
  const { data: analysis, isLoading, refetch } = useTokenDetail(mint!);
  const { data: priceHistory } = usePriceHistory(mint!);
  const { data: patterns } = useTokenPatterns(mint!);
  const { data: smartMoneyActivity } = useTokenSmartMoneyActivity(mint!);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="container mx-auto px-4 py-8 text-center">
        <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-white mb-2">Token not found</h2>
        <Link to="/" className="text-blue-400 hover:text-blue-300">
          ← Back to home
        </Link>
      </div>
    );
  }

  const StatusIcon = ({ passed }: { passed: boolean }) =>
    passed ? (
      <CheckCircle className="h-5 w-5 text-green-400" />
    ) : (
      <XCircle className="h-5 w-5 text-red-400" />
    );

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link to="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-4">
          <ArrowLeft className="h-4 w-4" />
          Back to tokens
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-white">{analysis.token.symbol}</h1>
              <RiskBadge level={analysis.risk.level} score={analysis.risk.score} />
            </div>
            <p className="text-gray-400 mb-2">{analysis.token.name}</p>
            <div className="flex items-center gap-4 text-sm">
              <code className="px-2 py-1 rounded bg-gray-800 text-blue-400 font-mono">
                {truncateAddress(analysis.token.mint, 8)}
              </code>
              <a
                href={`https://solscan.io/token/${analysis.token.mint}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-400 hover:text-blue-300"
              >
                View on Solscan <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Price Chart */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <h2 className="text-xl font-bold text-white mb-4">Price Chart</h2>
            {priceHistory && priceHistory.length > 0 ? (
              <PriceChart data={priceHistory} type="area" height={400} />
            ) : (
              <div className="h-[400px] flex items-center justify-center text-gray-500">
                No price history available yet
              </div>
            )}
          </div>

          {/* Pattern Matches */}
          {patterns && patterns.length > 0 && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
              <h2 className="text-xl font-bold text-white mb-4">🧠 Pattern Matches</h2>
              <PatternIndicators patterns={patterns} maxDisplay={10} />
              
              <div className="mt-4 space-y-3">
                {patterns.slice(0, 5).map((pattern, idx) => (
                  <div key={idx} className="p-4 rounded-lg border border-gray-800 bg-gray-800/30">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-white">{pattern.patternName}</h3>
                      <span className="text-sm text-gray-400">
                        {Math.round(pattern.matchScore * 100)}% match
                      </span>
                    </div>
                    <div className="text-sm text-gray-400">
                      Success Rate: {Math.round(pattern.successRate * 100)}% • 
                      Avg Peak: {pattern.averagePeakMultiplier.toFixed(1)}x
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {pattern.matchedCriteria.map((criteria, i) => (
                        <span key={i} className="px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-xs">
                          {criteria}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Smart Money Activity */}
          {smartMoneyActivity && smartMoneyActivity.length > 0 && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
              <h2 className="text-xl font-bold text-white mb-4">💎 Smart Money Activity</h2>
              <div className="space-y-2">
                {smartMoneyActivity.map((activity, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-gray-800/30">
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          'px-2 py-1 rounded text-xs font-medium',
                          activity.action === 'buy'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        )}
                      >
                        {activity.action.toUpperCase()}
                      </span>
                      <code className="text-sm text-blue-400 font-mono">
                        {truncateAddress(activity.wallet_address)}
                      </code>
                    </div>
                    <div className="text-right text-sm">
                      <div className="text-white font-medium">{activity.amount_sol.toFixed(2)} SOL</div>
                      <div className="text-gray-500">{formatPrice(activity.price)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Liquidity Info */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <h3 className="text-lg font-bold text-white mb-4">💧 Liquidity</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Total USD</span>
                <span className="font-medium text-white">
                  ${formatNumber(analysis.liquidity.totalLiquidityUsd)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">LP Burned</span>
                <div className="flex items-center gap-2">
                  <StatusIcon passed={analysis.liquidity.lpBurned} />
                  <span className="font-medium text-white">
                    {analysis.liquidity.lpBurnedPercent.toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">LP Locked</span>
                <div className="flex items-center gap-2">
                  <StatusIcon passed={analysis.liquidity.lpLocked} />
                  <span className="font-medium text-white">
                    {analysis.liquidity.lpLockedPercent.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Holder Distribution */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <h3 className="text-lg font-bold text-white mb-4">👥 Holders</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Total</span>
                <span className="font-medium text-white">
                  {formatNumber(analysis.holders.totalHolders)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Top 10%</span>
                <span className={cn(
                  'font-medium',
                  analysis.holders.top10HoldersPercent > 50 ? 'text-red-400' : 'text-green-400'
                )}>
                  {analysis.holders.top10HoldersPercent.toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Largest</span>
                <span className={cn(
                  'font-medium',
                  analysis.holders.largestHolderPercent > 20 ? 'text-red-400' : 'text-green-400'
                )}>
                  {analysis.holders.largestHolderPercent.toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Dev Wallet</span>
                <span className={cn(
                  'font-medium',
                  analysis.holders.devWalletPercent > 10 ? 'text-red-400' : 'text-green-400'
                )}>
                  {analysis.holders.devWalletPercent.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* Contract Security */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <h3 className="text-lg font-bold text-white mb-4">🔒 Contract</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Mint Revoked</span>
                <StatusIcon passed={analysis.contract.mintAuthorityRevoked} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Freeze Revoked</span>
                <StatusIcon passed={analysis.contract.freezeAuthorityRevoked} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Honeypot</span>
                <StatusIcon passed={!analysis.contract.isHoneypot} />
              </div>
            </div>
          </div>

          {/* Social Links */}
          {(analysis.social.hasTwitter || analysis.social.hasTelegram || analysis.social.hasWebsite) && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
              <h3 className="text-lg font-bold text-white mb-4">🌐 Social</h3>
              <div className="space-y-2">
                {analysis.social.hasTwitter && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-blue-400">Twitter:</span>
                    <span className="text-gray-400">
                      {analysis.social.twitterFollowers
                        ? `${formatNumber(analysis.social.twitterFollowers)} followers`
                        : 'Available'}
                    </span>
                  </div>
                )}
                {analysis.social.hasTelegram && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-blue-400">Telegram:</span>
                    <span className="text-gray-400">
                      {analysis.social.telegramMembers
                        ? `${formatNumber(analysis.social.telegramMembers)} members`
                        : 'Available'}
                    </span>
                  </div>
                )}
                {analysis.social.hasWebsite && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-blue-400">Website:</span>
                    <span className="text-gray-400">Available</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Risk Factors */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <h3 className="text-lg font-bold text-white mb-4">⚠️ Risk Factors</h3>
            <div className="space-y-2">
              {analysis.risk.factors.map((factor, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'flex items-center gap-2 p-2 rounded text-sm',
                    factor.passed
                      ? 'bg-green-500/10 text-green-400'
                      : factor.severity === 'critical'
                      ? 'bg-red-500/10 text-red-400'
                      : 'bg-yellow-500/10 text-yellow-400'
                  )}
                >
                  <StatusIcon passed={factor.passed} />
                  <span>{factor.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
