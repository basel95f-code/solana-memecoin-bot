import { cn } from '@/utils/cn';

interface RiskBadgeProps {
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | 'EXTREME';
  score: number;
  showScore?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const RiskBadge = ({ level, score, showScore = true, size = 'md' }: RiskBadgeProps) => {
  const colors = {
    LOW: 'bg-green-500/20 text-green-400 border-green-500/30',
    MEDIUM: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    HIGH: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    VERY_HIGH: 'bg-red-500/20 text-red-400 border-red-500/30',
    EXTREME: 'bg-red-700/20 text-red-300 border-red-700/30',
  };

  const emojis = {
    LOW: '🟢',
    MEDIUM: '🟡',
    HIGH: '🟠',
    VERY_HIGH: '🔴',
    EXTREME: '⛔',
  };

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-3 py-1',
    lg: 'text-base px-4 py-1.5',
  };

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium',
        colors[level],
        sizeClasses[size]
      )}
    >
      <span>{emojis[level]}</span>
      <span>{level.replace('_', ' ')}</span>
      {showScore && <span className="opacity-75">({score})</span>}
    </div>
  );
};
