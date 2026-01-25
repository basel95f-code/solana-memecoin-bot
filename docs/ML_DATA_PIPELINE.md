# ML Data Pipeline - Self-Learning System

## 🎯 Overview

The ML Data Pipeline is the brain behind the Solana Memecoin Bot's self-improvement capabilities. It automatically collects training data, tracks prediction outcomes, detects data drift, and orchestrates model retraining - creating a truly autonomous learning system.

## 📊 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     ML Data Pipeline                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐        │
│  │   Discovery  │──▶│   Feature    │──▶│   Snapshot   │        │
│  │   (Bot)      │   │   Extractor  │   │   Collector  │        │
│  └──────────────┘   └──────────────┘   └──────┬───────┘        │
│                                                 │                │
│                                                 ▼                │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐        │
│  │   Outcome    │◀──│   Adaptive   │◀──│  Training    │        │
│  │   Tracker    │   │   Sampler    │   │  Database    │        │
│  └──────┬───────┘   └──────────────┘   └──────────────┘        │
│         │                                      ▲                │
│         ▼                                      │                │
│  ┌──────────────┐   ┌──────────────┐   ┌──────┴───────┐        │
│  │   Label      │──▶│   Quality    │──▶│   Auto       │        │
│  │   Generator  │   │   Checker    │   │   Trainer    │        │
│  └──────────────┘   └──────────────┘   └──────┬───────┘        │
│                                                 │                │
│                                                 ▼                │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐        │
│  │ Distribution │──▶│   Model      │──▶│  Production  │        │
│  │   Monitor    │   │   Evaluator  │   │   Model      │        │
│  └──────────────┘   └──────────────┘   └──────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 🔧 Components

### 1. Data Collection System (`/ml/dataCollection/`)

#### TokenSnapshotCollector.ts
- Captures ALL 28 ML features for every tracked token
- Runs every 5 minutes via cron job
- Smart buffering with batch database inserts
- Deduplicates snapshots automatically
- Handles missing data gracefully

```typescript
// Adding a token to tracking
mlDataCollectionJob.addDiscoveredToken(mint, symbol, {
  liquidityUsd: 50000,
  riskScore: 75,
  hasPrediction: true,
});

// Mark interesting event
mlDataCollectionJob.markInterestingEvent(mint, 'whale_buy');
```

#### FeatureExtractor.ts
Extracts 28 comprehensive features:

| Category | Features |
|----------|----------|
| **Core (9)** | liquidityUsd, riskScore, holderCount, top10Percent, mintRevoked, freezeRevoked, lpBurnedPercent, hasSocials, tokenAgeHours |
| **Momentum (6)** | priceChange5m/1h/24h, volumeChange1h/24h, buyPressure1h |
| **Smart Money (3)** | smartMoneyNetBuys, smartMoneyHolding, isSmartMoneyBullish |
| **Trends (4)** | priceVelocity, volumeAcceleration, liquidityTrend, holderTrend |
| **Patterns (3)** | hasVolumeSpike, isPumping, isDumping |
| **Sentiment (3)** | sentimentScore, sentimentConfidence, hasSentimentData |

### 2. Smart Sampling (`/ml/sampling/`)

#### AdaptiveSampler.ts
Dynamically adjusts sampling frequency based on token value:

| Tier | Liquidity | Interval | Priority |
|------|-----------|----------|----------|
| **High** | >$100k | 5 min | 100 |
| **Medium** | $10k-$100k | 15 min | 50 |
| **Low** | $1k-$10k | 1 hour | 25 |
| **Minimal** | <$1k | 4 hours | 10 |

**Special conditions:**
- Tokens with predictions: Upgraded to high priority
- Interesting events: Immediate snapshot + tier upgrade
- Dataset imbalance: Boost priority for underrepresented outcomes

### 3. Outcome Tracking (`/ml/outcomes/`)

#### OutcomeTracker.ts
- Tracks predictions at 1h, 6h, 24h intervals
- Records peak/trough prices
- Detects whale activity
- Auto-updates ml_predictions table
- Calculates real-time accuracy

#### LabelGenerator.ts
Auto-generates labels with configurable thresholds:

| Label | Condition |
|-------|-----------|
| **RUG** | Price drop >80% |
| **DECLINE** | Price drop >30% |
| **STABLE** | Price ±5% |
| **PUMP** | Price up >30% |
| **MOON** | Price up >100% |

### 4. Data Quality Monitoring (`/ml/monitoring/`)

#### DataQualityChecker.ts
- Missing value detection (warn >10%)
- Outlier detection (Z-score >3σ)
- Feature distribution analysis
- Class imbalance detection (warn >10:1)
- Quality score (0-100)

#### DistributionMonitor.ts
- Tracks feature distributions over time
- Detects concept drift using Jensen-Shannon divergence
- Alerts when retraining needed
- Maintains baseline distributions

### 5. Training Orchestrator (`/ml/training/`)

#### AutoTrainer.ts
**Trigger conditions:**
- 1000+ new samples collected
- Weekly schedule (Sunday 3 AM)
- Manual trigger via `/ml_trigger_training`
- Performance degradation detected

**Deployment pipeline:**
1. Train new model
2. Compare with production (A/B test)
3. If >5% improvement: Deploy to shadow mode
4. Shadow mode for 24h with 100+ predictions
5. If shadow performs well: Promote to production
6. Auto-rollback on degradation

#### ModelEvaluator.ts
- Comprehensive metrics: Accuracy, Precision, Recall, F1, AUC
- Calibration analysis (Brier score, ECE)
- McNemar's test for statistical significance
- Confidence intervals

## 📈 Database Tables

### ml_training_data
Primary storage for training samples with features and outcomes.

### ml_predictions
Tracks all model predictions and their outcomes for accuracy measurement.

### ml_data_quality_metrics
Historical quality reports for trend analysis.

### ml_training_jobs
Training job history with metrics and deployment status.

### ml_model_comparisons
A/B test results between model versions.

### ml_drift_reports
Distribution drift analysis history.

## 🎛️ Telegram Commands

| Command | Description |
|---------|-------------|
| `/ml_status` | Overall ML system health |
| `/ml_data_stats` | Training data statistics |
| `/ml_quality` | Data quality report |
| `/ml_trigger_training` | Force training now |
| `/ml_compare_models` | A/B test results |
| `/ml_drift_report` | Distribution drift metrics |

## 🔄 Background Jobs

### mlDataCollection.ts (Every 5 min)
```
- Collect snapshots for all active tokens
- Store to database
- Update dataset balance
- Cleanup expired watches
```

### mlOutcomeTracking.ts (Every 15 min)
```
- Check predictions made 1h/6h/24h ago
- Update outcomes
- Calculate accuracy
- Signal new samples to trainer
```

### mlAutoTraining.ts (Continuous)
```
- Check trigger conditions
- Run training pipeline
- A/B test new models
- Deploy improvements
```

## 📊 Quality Targets

| Metric | Target |
|--------|--------|
| Samples in first week | 1000+ |
| Data quality score | >90% |
| Auto-training trigger | Within 2 weeks |
| Model improvement | >5% per retrain |
| Data loss on failures | Zero |
| Missing features | <1% |
| Drift detection latency | <24h |

## 🛡️ Fault Tolerance

- **Buffered writes**: Snapshots buffered before batch insert
- **Graceful degradation**: System continues if components fail
- **Auto-recovery**: Jobs restart on errors
- **Rate limiting**: Respects API limits
- **Circuit breakers**: Prevents cascade failures
- **Comprehensive logging**: Full observability

## 🚀 Getting Started

### 1. Initialize the system
```typescript
import { mlDataCollectionJob } from './jobs/mlDataCollection';
import { mlOutcomeTrackingJob } from './jobs/mlOutcomeTracking';
import { autoTrainer } from './ml/training/AutoTrainer';

// Initialize
await mlDataCollectionJob.initialize();
await mlOutcomeTrackingJob.initialize();
await autoTrainer.initialize();

// Start jobs
mlDataCollectionJob.start();
mlOutcomeTrackingJob.start();
autoTrainer.startAutoTraining();
```

### 2. Track discovered tokens
```typescript
// When bot discovers a new token
mlDataCollectionJob.addDiscoveredToken(mint, symbol, {
  liquidityUsd: analysis.liquidity.totalLiquidityUsd,
  riskScore: analysis.risk.score,
});
```

### 3. Track predictions
```typescript
// When making a prediction
mlOutcomeTrackingJob.startTracking({
  mint,
  symbol,
  initialPrice: price,
  initialLiquidity: liquidity,
  initialRiskScore: riskScore,
  initialHolders: holders,
  predictedOutcome: 'pump',
  predictedConfidence: 0.85,
  predictedRugProb: 0.12,
});
```

### 4. Monitor via Telegram
```
/ml_status - Check system health
/ml_data_stats - View data collection progress
/ml_quality - Run quality check
```

## 📁 File Structure

```
apps/bot/src/
├── ml/
│   ├── dataCollection/
│   │   ├── types.ts                # Type definitions
│   │   ├── TokenSnapshotCollector.ts
│   │   ├── FeatureExtractor.ts
│   │   └── index.ts
│   ├── sampling/
│   │   ├── AdaptiveSampler.ts
│   │   └── index.ts
│   ├── outcomes/
│   │   ├── OutcomeTracker.ts
│   │   ├── LabelGenerator.ts
│   │   └── index.ts
│   ├── monitoring/
│   │   ├── DataQualityChecker.ts
│   │   ├── DistributionMonitor.ts
│   │   └── index.ts
│   └── training/
│       ├── AutoTrainer.ts
│       └── ModelEvaluator.ts
├── jobs/
│   ├── mlDataCollection.ts
│   ├── mlOutcomeTracking.ts
│   └── mlAutoRetrain.ts
├── telegram/commands/
│   └── ml_admin.ts
└── database/migrations/
    └── 20240325_ml_data_pipeline.ts
```

## 🎯 The Vision

This pipeline transforms the bot from a static analyzer into a **continuously learning system** that:

1. **Learns from every token** it analyzes
2. **Measures its own accuracy** in real-time
3. **Detects when it's wrong** and needs retraining
4. **Improves automatically** without human intervention
5. **Never deploys bad models** (A/B testing + shadow mode)

The goal: A trading bot that gets **5%+ better every training cycle**, compounding into significant alpha over time.

---

*Built with Opus intelligence for the most advanced self-learning trading system ever created.* 🚀🤖💎
