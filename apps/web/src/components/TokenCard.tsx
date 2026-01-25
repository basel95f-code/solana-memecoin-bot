import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Users, Droplet, ExternalLink } from 'lucide-react';
import { Token } from '@/types';
import { RiskBadge } from './RiskBadge';
import { formatNumber, formatPrice, formatPercent, timeAgo } from '@/utils/format';
import { cn } from '@/utils/cn';

interface TokenCardProps {
  token: Token;
}

export const TokenCard = ({ token }: TokenCardProps) => {
  const isPriceUp = token.priceChange24h >= 0;

  const getRiskLevel = (score: number) => {
    if (score >= 70) return 'LOW';
    if (score >= 50) return 'MEDIUM';
    if (score >= 30) return 'HIGH';
    if (score >= 15) return 'VERY_HIGH';
    return 'EXTREME';
  };

  return (
    <Link
      to={`/token/${token.mint}`}
      className="block rounded-xl border border-gray-800 bg-gray-900/50 p-4 transition-all hover:border-gray-700 hover:shadow-lg hover:shadow-blue-500/10"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-lg font-bold text-white">{token.symbol}</h3>
          <p className="text-sm text-gray-500 truncate max-w-[200px]">{token.name}</p>
        </div>
        <RiskBadge level={getRiskLevel(token.riskScore)} score={token.riskScore} size="sm" />
      </div>

      {/* Price & Change */}
      <div className="mb-3">
        <div className="text-2xl font-bold text-white mb-1">
          {formatPrice(token.priceUsd)}
        </div>
        <div
          className={cn(
            'flex items-center gap-1 text-sm font-medium',
            isPriceUp ? 'text-green-400' : 'text-red-400'
          )}
        >
          {isPriceUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          {formatPercent(token.priceChange24h)}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="flex items-center gap-2 text-sm">
          <Droplet className="h-4 w-4 text-blue-400" />
          <div>
            <div className="text-xs text-gray-500">Liquidity</div>
            <div className="font-medium text-white">${formatNumber(token.liquidity)}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Users className="h-4 w-4 text-purple-400" />
          <div>
            <div className="text-xs text-gray-500">Holders</div>
            <div className="font-medium text-white">{formatNumber(token.holders)}</div>
          </div>
        </div>
      </div>

      {/* Market Stats */}
      <div className="grid grid-cols-2 gap-2 pt-3 border-t border-gray-800 text-xs">
        <div>
          <span className="text-gray-500">MCap: </span>
          <span className="text-white font-medium">${formatNumber(token.marketCap)}</span>
        </div>
        <div>
          <span className="text-gray-500">Vol: </span>
          <span className="text-white font-medium">${formatNumber(token.volume24h)}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-800">
        <span className="text-xs text-gray-500">{timeAgo(token.discoveredAt * 1000)}</span>
        <ExternalLink className="h-3.5 w-3.5 text-gray-500" />
      </div>

      {/* Rug Probability Warning */}
      {token.rugProbability > 50 && (
        <div className="mt-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-1.5 text-xs text-red-400">
          ⚠️ High rug probability: {token.rugProbability.toFixed(0)}%
        </div>
      )}
    </Link>
  );
};
