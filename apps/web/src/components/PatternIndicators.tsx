import { cn } from '@/utils/cn';

interface Pattern {
  patternName: string;
  patternType: 'success' | 'rug' | 'neutral';
  matchScore: number;
  successRate: number;
}

interface PatternIndicatorsProps {
  patterns: Pattern[];
  maxDisplay?: number;
  compact?: boolean;
}

export const PatternIndicators = ({ patterns, maxDisplay = 3, compact = false }: PatternIndicatorsProps) => {
  const displayPatterns = patterns.slice(0, maxDisplay);

  if (patterns.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        No patterns detected
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {displayPatterns.map((pattern, idx) => {
        const isSuccess = pattern.patternType === 'success';
        const isRug = pattern.patternType === 'rug';

        const colorClasses = isSuccess
          ? 'bg-green-500/10 border-green-500/30 text-green-400'
          : isRug
          ? 'bg-red-500/10 border-red-500/30 text-red-400'
          : 'bg-gray-500/10 border-gray-500/30 text-gray-400';

        const emoji = isSuccess ? '✅' : isRug ? '🚨' : '⚪';

        return (
          <div
            key={idx}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium',
              colorClasses
            )}
            title={`${pattern.patternName} - ${Math.round(pattern.matchScore * 100)}% match, ${Math.round(pattern.successRate * 100)}% success rate`}
          >
            <span>{emoji}</span>
            {!compact && (
              <>
                <span className="max-w-[120px] truncate">{pattern.patternName}</span>
                <span className="opacity-75">
                  {Math.round(pattern.matchScore * 100)}%
                </span>
              </>
            )}
            {compact && (
              <span className="opacity-75">
                {Math.round(pattern.matchScore * 100)}%
              </span>
            )}
          </div>
        );
      })}
      
      {patterns.length > maxDisplay && (
        <div className="flex items-center px-2 py-1 text-xs text-gray-500">
          +{patterns.length - maxDisplay} more
        </div>
      )}
    </div>
  );
};
