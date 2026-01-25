# Analytics System

Learn what works and what doesn't in memecoin trading.

## Quick Start

```typescript
import { analyticsAPI } from './analytics';

// Get overall summary
const summary = await analyticsAPI.getAnalyticsSummary();
console.log(`Overall win rate: ${summary.patterns.avgWinRate}%`);

// Get best entry time
const timeInsights = await analyticsAPI.getTimeBasedInsights();
console.log(`Best hour: ${timeInsights.bestTimes[0].hour}:00 UTC`);
```

## Modules

### 📊 Pattern Analytics
- Win rates by pattern type
- Pattern correlations
- Best combinations
- Accuracy metrics (precision, recall, F1)

### ⏰ Time Analytics
- Best entry hours/days
- Hold time optimization
- Time to pump analysis
- Weekday vs weekend

### 📈 Lifecycle Analytics
- Launch → Peak → Dump timing
- Liquidity patterns
- Smart money behavior
- Survival rates

### 🛡️ Risk Analytics
- Risk score accuracy
- Feature importance
- Calibration validation
- Threshold optimization

## Telegram Commands

- `/analytics` - Overall summary
- `/pattern_stats` - Pattern performance
- `/best_times` - Optimal timing
- `/lifecycle_stats` - Token lifecycles
- `/risk_accuracy` - Risk validation

## Database Tables

- `analytics_cache` - Pre-computed metrics
- `performance_snapshots` - Daily/weekly summaries
- `pattern_performance_history` - Historical tracking
- `feature_importance_history` - Feature tracking

## Key Metrics

**Win Rate**: % of successful outcomes
**Accuracy**: Overall prediction correctness
**Precision**: True positive rate
**Recall**: Sensitivity
**F1 Score**: Harmonic mean of precision and recall
**Calibration Error**: |predicted - actual|

## Example Integration

```typescript
// Analyze token with analytics insights
const patterns = await patternDetector.matchToken(tokenData);
const performance = await analyticsAPI.getPatternPerformance(patterns[0].patternName);

if (performance.winRate > 70) {
  // High confidence pattern
  executeTradeWithPositionSizing(performance.avgReturn);
}
```

## Documentation

See [ANALYTICS.md](../../../docs/ANALYTICS.md) for comprehensive documentation.

## Implementation Status

✅ Pattern Performance Analytics
✅ Time-Based Analytics
✅ Lifecycle Analytics
✅ Risk Validation Analytics
✅ Unified API
✅ Database Schema
✅ Telegram Commands
✅ Documentation

## Next Steps

1. Deploy database migration
2. Register Telegram commands
3. Set up analytics cache refresh job
4. Create daily snapshot job
5. Integrate with trading decisions
