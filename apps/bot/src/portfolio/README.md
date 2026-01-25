# Portfolio Management System

Comprehensive portfolio tracking with P&L calculation, performance analytics, and tax reporting.

## Features

### 📊 Position Tracking (`positionTracker.ts`)
- Track all token positions (long/short)
- Multiple entries (average down/up)
- Partial exits tracking
- Realized vs unrealized P&L
- Cost basis calculation (FIFO, LIFO, Average)
- Tax lot tracking for accurate cost basis

### 💰 P&L Calculator (`pnlCalculator.ts`)
- Real-time unrealized P&L (current price vs entry)
- Realized P&L (on sells)
- Total portfolio value
- Individual position P&L
- ROI percentage (daily, weekly, monthly, yearly)
- Winners/losers breakdown

### 📈 Performance Analytics (`performanceAnalytics.ts`)
- Win rate (% profitable trades)
- Average win/loss
- Profit factor (gross profit / gross loss)
- Best/worst trades
- **Sharpe ratio** (risk-adjusted returns)
- **Max drawdown** (peak to trough)
- Consecutive wins/losses streaks
- Holding time analysis

### 🧾 Tax Reporting (`taxReporting.ts`)
- Generate tax reports (CSV/JSON)
- FIFO cost basis calculation
- Short-term vs long-term gains (< 1 year vs ≥ 1 year)
- Realized gains/losses by year
- Trade history export
- **IRS Form 8949 compatible format**

### 💲 Price Tracker (`priceTracker.ts`)
- Auto-update position prices from DexScreener
- Price alerts (target/stop-loss/trailing stop)
- Real-time P&L updates
- Alert notifications

### ⏰ Scheduler (`scheduler.ts`)
- Daily portfolio snapshots
- Periodic performance calculations
- Automated maintenance tasks

## Database Schema

### `portfolio_positions`
Current and historical positions with P&L tracking.

### `portfolio_trades`
All buy/sell transactions with realized P&L.

### `portfolio_snapshots`
Daily portfolio value snapshots for performance tracking.

### `portfolio_performance`
Calculated performance metrics by time period.

### `portfolio_tax_lots`
Tax lot tracking for FIFO/LIFO cost basis.

### `portfolio_price_alerts`
Price alerts for target/stop-loss notifications.

## Usage

### Add Position Entry
```typescript
import { positionTracker } from './portfolio';

const position = await positionTracker.addEntry({
  tokenMint: 'So11...ABC',
  symbol: 'BONK',
  price: 0.000012,
  amount: 1000000,
  notes: 'Entry position',
});
```

### Partial/Full Exit
```typescript
const updated = await positionTracker.partialExit({
  positionId: position.id,
  exitPrice: 0.000015,
  exitAmount: 500000, // Partial exit (or full amount)
  notes: 'Taking profits',
});
```

### Get P&L Summary
```typescript
import { pnlCalculator } from './portfolio';

const summary = await pnlCalculator.getPnLSummary();
console.log(`Total P&L: $${summary.totalPnl.toFixed(2)}`);
console.log(`ROI: ${summary.totalPnlPercent.toFixed(2)}%`);
```

### Calculate Performance
```typescript
import { performanceAnalytics } from './portfolio';

const metrics = await performanceAnalytics.calculatePerformance('default', 'all_time');
console.log(`Win Rate: ${metrics.winRate.toFixed(1)}%`);
console.log(`Sharpe Ratio: ${metrics.sharpeRatio?.toFixed(2)}`);
console.log(`Max Drawdown: ${metrics.maxDrawdownPercent.toFixed(2)}%`);
```

### Generate Tax Report
```typescript
import { taxReporting } from './portfolio';

const report = await taxReporting.generateTaxReport('default', 2024);
console.log(`Net Gain/Loss: $${report.netGainLoss.toFixed(2)}`);

// Export as CSV
const csv = await taxReporting.exportCSV('default', 2024);

// Export Form 8949
const { shortTermCSV, longTermCSV } = await taxReporting.exportForm8949CSV('default', 2024);
```

### Auto-Update Prices
```typescript
import { priceTracker } from './portfolio';

// Start auto-updating (every 60 seconds)
priceTracker.start(60000);

// Create price alert
await priceTracker.createAlert({
  positionId: position.id,
  tokenMint: 'So11...ABC',
  symbol: 'BONK',
  alertType: 'target',
  triggerPrice: 0.00002, // Target price
});
```

### Start Scheduler
```typescript
import { portfolioScheduler } from './portfolio';

// Start daily snapshots and performance calculations
portfolioScheduler.start();
```

## Telegram Commands

- `/portfolio` - Show portfolio summary
- `/add_position <token> <amount> <price>` - Add position entry
- `/close_position <token> <exit_price> [amount]` - Exit position
- `/pnl` - Show realized/unrealized P&L
- `/performance` - Show performance metrics
- `/winners` - Best performing positions
- `/losers` - Worst performing positions
- `/tax_report [year]` - Generate tax report

## API Endpoints

- `GET /api/v1/portfolio` - Get all positions
- `GET /api/v1/portfolio/pnl` - P&L summary
- `GET /api/v1/portfolio/performance` - Performance metrics
- `POST /api/v1/portfolio/trade` - Record trade
- `GET /api/v1/portfolio/tax-report` - Tax report
- `GET /api/v1/portfolio/history` - Historical snapshots
- `GET /api/v1/portfolio/value` - Portfolio value breakdown
- `PUT /api/v1/portfolio/positions/:id/price` - Update position price

## Key Calculations

```typescript
// Unrealized P&L
unrealizedPnL = (currentPrice - avgEntryPrice) * currentAmount

// Realized P&L (FIFO/LIFO cost basis)
realizedPnL = (exitPrice * soldAmount) - costBasis

// ROI
roi = (totalValue - totalInvested) / totalInvested * 100

// Win Rate
winRate = winningTrades / totalTrades * 100

// Profit Factor
profitFactor = totalWins / totalLosses

// Sharpe Ratio
sharpeRatio = (meanReturn - riskFreeRate) / stdDeviation * sqrt(365)

// Max Drawdown
maxDrawdown = (troughValue - peakValue) / peakValue * 100
```

## Cost Basis Methods

### FIFO (First-In-First-Out)
Uses the earliest purchase lots first when selling.

### LIFO (Last-In-First-Out)
Uses the most recent purchase lots first when selling.

### AVERAGE
Uses the weighted average cost of all purchases.

## Tax Classification

- **Short-term**: Holding period < 365 days (taxed as ordinary income)
- **Long-term**: Holding period ≥ 365 days (taxed at capital gains rate)

## Integration

The portfolio system integrates with:
- DexScreener API for real-time price updates
- Supabase for data persistence
- Telegram bot for user commands
- REST API for programmatic access

## Performance Considerations

- Position prices updated every 60 seconds (configurable)
- Daily snapshots created at midnight
- Performance metrics calculated every 6 hours
- Database indexes on all query-heavy columns
- Efficient FIFO/LIFO tax lot tracking

## Security

- All operations scoped to `user_id`
- API endpoints protected with authentication
- Sensitive tax data only accessible to owner
- Transaction signatures tracked for audit trail

## Future Enhancements

- [ ] Auto-import from wallet address
- [ ] Sync with on-chain transactions
- [ ] Multi-wallet support
- [ ] Portfolio rebalancing suggestions
- [ ] Risk management rules (max position size, stop-loss automation)
- [ ] PDF report generation
- [ ] Email/SMS alert notifications
- [ ] Portfolio comparison/benchmarking
- [ ] Advanced charting (P&L over time, allocation pie charts)
- [ ] Mobile app integration
