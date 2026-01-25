# Analytics System Documentation

## Overview

The Analytics System provides comprehensive insights into what works and what doesn't in memecoin trading. It tracks pattern performance, optimal timing, token lifecycles, and risk score accuracy to continuously improve trading decisions.

## Architecture

The analytics system consists of 4 main modules:

### 1. Pattern Performance Analytics (`patternAnalytics.ts`)

Analyzes the effectiveness of detected patterns:

- **Win rates** by pattern type
- **Accuracy metrics** (precision, recall, F1 score)
- **Pattern correlations** (which patterns appear together)
- **Best performing combinations**
- **Financial performance** (avg return, peak multiplier)

### 2. Time-Based Analytics (`timeAnalytics.ts`)

Identifies optimal entry and exit times:

- **Hourly performance** (best hours to enter trades)
- **Day of week analysis** (best days for trading)
- **Hold time optimization** (optimal position duration)
- **Time to pump** (how long until peak)
- **Weekday vs weekend** comparison

### 3. Token Lifecycle Analytics (`lifecycleAnalytics.ts`)

Tracks token behavior from launch to death:

- **Launch → Peak → Dump** timeline
- **Liquidity patterns** over time
- **Holder behavior** (accumulation vs distribution)
- **Smart money timing** (when smart traders enter/exit)
- **Survival rates** (% still liquid after 24h/7d/30d)

### 4. Risk Score Validation (`riskAnalytics.ts`)

Validates and improves risk scoring:

- **Accuracy by risk level** (LOW, MEDIUM, HIGH, CRITICAL)
- **Calibration** (predicted vs actual success rates)
- **Feature importance** (which factors matter most)
- **Threshold optimization** (finding optimal cutoff points)
- **Distribution analysis** (how scores are distributed)

## API Reference

### Main API (`analyticsAPI`)

```typescript
import { analyticsAPI } from './analytics/api';

// Get overall summary
const summary = await analyticsAPI.getAnalyticsSummary();

// Get pattern performance
const patterns = await analyticsAPI.getPatternPerformance();
const singlePattern = await analyticsAPI.getPatternPerformance('Triple Safe Moon');

// Get time-based insights
const timeInsights = await analyticsAPI.getTimeBasedInsights();

// Get lifecycle stats
const lifecycleData = await analyticsAPI.getLifecycleStats();

// Get risk validation
const riskData = await analyticsAPI.getRiskScoreAccuracy();

// Get top performing signals
const topSignals = await analyticsAPI.getTopPerformingSignals(10);

// Get visualization data (for charts)
const vizData = await analyticsAPI.getVisualizationData();
```

### Pattern Analytics

```typescript
import { patternAnalytics } from './analytics/patternAnalytics';

// Get performance for a specific pattern
const performance = await patternAnalytics.getPatternPerformance('Goldilocks Liquidity');

// Get all patterns
const allPerformance = await patternAnalytics.getAllPatternPerformance();

// Find correlated patterns
const correlations = await patternAnalytics.getPatternCorrelations(5);

// Find best combinations
const combinations = await patternAnalytics.getBestPatternCombinations(5);

// Get summary stats
const stats = await patternAnalytics.getPatternStatsSummary();
```

### Time Analytics

```typescript
import { timeAnalytics } from './analytics/timeAnalytics';

// Get hourly performance
const hourly = await timeAnalytics.getHourlyPerformance();

// Get daily performance
const daily = await timeAnalytics.getDayOfWeekPerformance();

// Analyze hold times
const holdTimes = await timeAnalytics.getHoldTimeAnalysis();

// Time to pump analysis
const timeToPump = await timeAnalytics.getTimeToPumpAnalysis();

// Weekday vs weekend
const comparison = await timeAnalytics.getWeekdayWeekendComparison();

// Get best/worst times
const bestTimes = await timeAnalytics.getBestEntryTimes(5);
const worstTimes = await timeAnalytics.getWorstEntryTimes(5);
```

### Lifecycle Analytics

```typescript
import { lifecycleAnalytics } from './analytics/lifecycleAnalytics';

// Overall lifecycle stats
const stats = await lifecycleAnalytics.getLifecycleStats();

// Liquidity patterns
const liquidityPatterns = await lifecycleAnalytics.getLiquidityPatterns();

// Smart money timing
const smartMoneyTiming = await lifecycleAnalytics.getSmartMoneyTiming();

// Survival rates
const survivalRates = await lifecycleAnalytics.getSurvivalRates();

// Token timeline
const timeline = await lifecycleAnalytics.getTokenLifecycleTimeline('token_mint');
```

### Risk Analytics

```typescript
import { riskAnalytics } from './analytics/riskAnalytics';

// Risk score accuracy
const accuracy = await riskAnalytics.getRiskScoreAccuracy();

// Feature importance
const features = await riskAnalytics.getFeatureImportance();

// Score distribution
const distribution = await riskAnalytics.getRiskDistribution();

// Optimal thresholds
const thresholds = await riskAnalytics.getOptimalThresholds();

// Calibration curve
const calibration = await riskAnalytics.getCalibrationCurve();

// Summary
const summary = await riskAnalytics.getRiskValidationSummary();
```

## Telegram Commands

Users can access analytics through these commands:

### `/analytics`
Overall performance summary with key metrics from all modules.

### `/pattern_stats`
Detailed pattern performance breakdown including:
- Top performing patterns
- Win rates and accuracy
- Pattern correlations

### `/best_times`
Optimal entry timing analysis:
- Best hours (UTC)
- Best days of week
- Weekday vs weekend comparison
- Time to pump statistics
- Optimal hold times

### `/lifecycle_stats`
Token lifecycle insights:
- Launch → peak timing
- Survival rates
- Smart money behavior
- Performance metrics

### `/risk_accuracy`
Risk score validation:
- Accuracy by risk level
- Calibration errors
- Feature importance
- Optimal thresholds

## Database Schema

### Analytics Cache Table

Stores pre-computed metrics for performance:

```sql
CREATE TABLE analytics_cache (
  id SERIAL PRIMARY KEY,
  cache_key TEXT UNIQUE NOT NULL,
  cache_type TEXT NOT NULL,
  cache_data JSONB NOT NULL,
  sample_size INTEGER,
  confidence REAL,
  computed_at TIMESTAMP,
  expires_at TIMESTAMP
);
```

### Performance Snapshots

Daily/weekly summaries:

```sql
CREATE TABLE performance_snapshots (
  id SERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL UNIQUE,
  snapshot_type TEXT,  -- 'daily', 'weekly', 'monthly'
  overall_win_rate REAL,
  avg_return_percent REAL,
  top_pattern TEXT,
  best_entry_hour INTEGER,
  risk_score_accuracy REAL,
  -- ... more fields
);
```

### Pattern Performance History

Tracks pattern metrics over time:

```sql
CREATE TABLE pattern_performance_history (
  id SERIAL PRIMARY KEY,
  pattern_id INTEGER,
  pattern_name TEXT,
  win_rate REAL,
  accuracy REAL,
  precision_score REAL,
  recorded_at TIMESTAMP
);
```

## Key Metrics

### Win Rate
Percentage of successful predictions/trades.

Formula: `(successful_outcomes / total_outcomes) * 100`

### Accuracy
Overall correctness of predictions.

Formula: `(true_positives + true_negatives) / total_predictions * 100`

### Precision
When we predict success, how often are we right?

Formula: `true_positives / (true_positives + false_positives) * 100`

### Recall
Of all actual successes, how many did we catch?

Formula: `true_positives / (true_positives + false_negatives) * 100`

### F1 Score
Harmonic mean of precision and recall.

Formula: `2 * (precision * recall) / (precision + recall)`

### Calibration Error
Difference between predicted and actual success rates.

Formula: `|predicted_rate - actual_rate|`

### Statistical Significance
Using chi-square test (simplified):

Formula: `(observed - expected)² / expected`

## Best Practices

### 1. Sample Size Requirements

- **Patterns**: Minimum 10 matches before trusting metrics
- **Time analysis**: At least 30 days of data
- **Risk validation**: 100+ tokens per risk level

### 2. Confidence Intervals

Always consider sample size when interpreting metrics:

```typescript
const confidenceLevel = sampleSize >= 100 ? 'high' :
                       sampleSize >= 30 ? 'medium' :
                       sampleSize >= 10 ? 'low' : 'very_low';
```

### 3. Cache Invalidation

Analytics cache should be refreshed:

- **Pattern performance**: Every hour
- **Time insights**: Every 6 hours
- **Lifecycle stats**: Daily
- **Risk validation**: Daily

### 4. Continuous Learning

The system should:

1. Collect outcomes for all analyzed tokens
2. Update pattern metrics weekly
3. Recompute feature importance monthly
4. Deactivate poorly performing patterns

## Visualization

### Heatmaps

Hour × Day performance heatmap:

```typescript
const vizData = await analyticsAPI.getVisualizationData();
const { hours, days, data } = vizData.heatmap;

// data[hour][day] = win_rate
// Use for charting libraries like Recharts, Chart.js, etc.
```

### Distribution Charts

```typescript
const { riskScores, holdTimes, timeToPump } = vizData.distributions;

// Risk score distribution
riskScores.forEach(range => {
  console.log(`${range.scoreRange}: ${range.percentage}%`);
});

// Hold time distribution
holdTimes.forEach(ht => {
  console.log(`${ht.holdTimeRange}: ${ht.winRate}% win rate`);
});
```

### Timeline Charts

```typescript
const { lifecycle, smartMoney } = vizData.timelines;

// Lifecycle timeline
console.log(`Launch → Peak: ${lifecycle.avgLaunchToPeak}h`);
console.log(`Peak → Dump: ${lifecycle.avgPeakToDump}h`);

// Smart money entry distribution
smartMoney.entryDistribution.forEach(dist => {
  console.log(`${dist.range}: ${dist.percentage}%`);
});
```

## Integration Example

```typescript
// In your trading bot main loop
import { analyticsAPI } from './analytics';
import { patternDetector } from './services/patternDetector';

async function analyzeToken(tokenMint: string) {
  // Get token data
  const tokenData = await getTokenData(tokenMint);
  
  // Match patterns
  const patterns = await patternDetector.matchToken(tokenData);
  
  // Get pattern performance to inform decision
  const topPattern = patterns[0];
  const performance = await analyticsAPI.getPatternPerformance(topPattern.patternName);
  
  // Check if this is a good time to enter
  const timeInsights = await analyticsAPI.getTimeBasedInsights();
  const currentHour = new Date().getUTCHours();
  const hourPerf = timeInsights.hourly.find(h => h.hour === currentHour);
  
  // Make informed decision
  if (performance.winRate > 70 && hourPerf.winRate > 60) {
    console.log(`✅ Strong signal: ${topPattern.patternName} at ${currentHour}:00 UTC`);
    // Execute trade
  } else {
    console.log(`⚠️ Weak signal or bad timing`);
  }
}
```

## Troubleshooting

### Low Sample Sizes

If analytics show insufficient data:

1. Ensure outcome tracking is working (`token_outcomes_v2` table)
2. Check that pattern matches are being recorded
3. Wait for more data accumulation (at least 7 days)

### Inaccurate Metrics

If metrics seem wrong:

1. Verify data quality in underlying tables
2. Check for outliers skewing averages
3. Ensure proper outcome classification
4. Review pattern matching logic

### Slow Queries

If analytics are slow:

1. Ensure indexes exist on all key columns
2. Use analytics cache for frequently accessed data
3. Limit date ranges for time-based queries
4. Pre-compute daily snapshots

## Future Enhancements

- [ ] A/B testing framework for patterns
- [ ] Machine learning model performance tracking
- [ ] Real-time analytics dashboard
- [ ] Automated pattern discovery
- [ ] Cross-chain pattern comparison
- [ ] Social sentiment correlation
- [ ] Whale wallet behavior patterns

## Support

For questions or issues, see:
- Pattern detection: `apps/bot/src/services/patternDetector.ts`
- Smart money tracking: `apps/bot/src/services/smartMoneyLearner.ts`
- Database schema: `supabase/migrations/20250126000000_analytics_system.sql`
