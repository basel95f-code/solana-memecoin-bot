# Copy Trading System - User Guide

## Overview

The Copy Trading system enables you to track profitable Solana wallets and receive real-time alerts when they trade. This allows you to copy successful traders' strategies and potentially improve your own trading performance.

## Features

### 1. **Wallet Tracking**
- Manually add wallets to your watchlist
- Auto-discover profitable wallets
- Track unlimited wallets
- Label wallets for easy identification

### 2. **Real-Time Monitoring**
- WebSocket-based transaction monitoring
- Instant alerts when tracked wallets trade
- Detects buys, sells, and large trades
- Works across all major Solana DEXes (Raydium, Jupiter, Pump.fun, Orca, Meteora)

### 3. **Performance Analytics**
- Win rate tracking
- Total profit/loss calculations
- Average hold times
- Trading style classification (scalper, swing, holder)
- Entry timing analysis
- Favorite tokens and DEXes

### 4. **Smart Alerts**
- Priority levels (low, medium, high, critical)
- Filters out low-quality wallets
- Configurable thresholds
- Multi-channel delivery (Telegram, Discord, Email)

### 5. **Wallet Discovery**
- Auto-discovers profitable wallets from token activity
- Scores wallets based on performance
- Auto-adds high-scoring wallets to your watchlist

## Telegram Commands

### Basic Commands

#### `/track_wallet <address> [label]`
Add a wallet to your copy trading watchlist.

**Example:**
```
/track_wallet 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU SmartTrader
```

#### `/untrack_wallet <address>`
Remove a wallet from your watchlist.

**Example:**
```
/untrack_wallet 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
```

#### `/watchlist`
Show all wallets in your watchlist with summary stats.

**Example:**
```
/watchlist
```

### Analysis Commands

#### `/wallet_stats <address>`
View detailed performance statistics for a tracked wallet.

**Example:**
```
/wallet_stats 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
```

**Shows:**
- Overall score (0-100)
- Win rate
- Total profit
- Average profit per trade
- Trading style
- Hold times
- Risk level
- Recommendation

#### `/wallet_trades <address> [limit]`
View recent trades from a specific wallet.

**Example:**
```
/wallet_trades 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 10
```

### Discovery Commands

#### `/top_wallets`
View the top 10 performing wallets in your watchlist.

**Example:**
```
/top_wallets
```

Shows wallets ranked by overall performance score.

#### `/copy_status`
Check the status of the copy trading monitoring system.

**Example:**
```
/copy_status
```

**Shows:**
- Monitor status (running/stopped)
- Number of tracked wallets
- Active WebSocket subscriptions
- Average wallet statistics

## Alert Types

### 🟢 Buy Alert
Triggered when a tracked wallet buys a token.

**Includes:**
- Wallet details (label, score, win rate)
- Token information
- Purchase amount and value
- Links to Solscan and DexScreener

### 🔴 Sell Alert
Triggered when a tracked wallet sells a token.

**Includes:**
- All buy alert information
- Profit/loss percentage
- Hold duration
- Exit reason

### 💚 Large Buy Alert
Triggered when a tracked wallet makes a large purchase (>$5,000 default).

**Priority:** High or Critical
**Reason:** Large trades from successful wallets are strong signals.

### ❤️ Large Sell Alert
Triggered when a tracked wallet makes a large sale (>$5,000 default).

**Priority:** High or Critical
**Reason:** May indicate a top or profit-taking opportunity.

## Alert Priority Levels

### ℹ️ Low Priority
- Basic trades from wallets that meet minimum criteria
- Win rate: 55%+
- Score: 60+

### ⚠️ Medium Priority
- Trades from good performing wallets
- Win rate: 55%+
- Score: 65+

### 🚨 High Priority
- Trades from strong performers
- Large trades OR
- Win rate: 65%+
- Score: 75+

### 🔥 Critical Priority
- Large trades from top performers
- Win rate: 70%+
- Score: 80+
- Trade value: $5,000+

## Performance Metrics Explained

### Score (0-100)
Overall wallet performance rating based on:
- Win rate
- Total profit
- Consistency
- Number of trades

**Interpretation:**
- 80-100: Excellent performer
- 70-79: Strong performer
- 60-69: Decent performer
- 50-59: Average performer
- Below 50: Poor performer

### Win Rate
Percentage of profitable trades.

**Interpretation:**
- 70%+: Exceptional
- 60-69%: Very good
- 50-59%: Good
- 40-49%: Below average
- Below 40%: Poor

### Trading Style

#### Scalper
- Average hold time: < 2 hours
- Quick in and out
- High trade frequency

#### Swing Trader
- Average hold time: 2-48 hours
- Holds for short-term moves
- Moderate frequency

#### Holder
- Average hold time: > 48 hours
- Long-term positions
- Lower frequency

### Risk Level

#### Low Risk ✅
- High win rate (70%+)
- Positive average returns (20%+)
- Consistent performance

#### Medium Risk ⚠️
- Moderate win rate (50-70%)
- Moderate returns (5-20%)
- Some volatility

#### High Risk ❌
- Low win rate (< 50%)
- Negative or inconsistent returns
- High volatility

## Configuration

### Environment Variables

Add these to your `.env` file:

```env
# Enable/disable wallet tracking
WALLET_TRACKING_ENABLED=true

# Minimum wallet score to trigger alerts (0-100)
WALLET_TRACKING_MIN_SCORE=60

# Minimum win rate to trigger alerts (%)
WALLET_TRACKING_MIN_WIN_RATE=55

# Minimum trade value to trigger alerts (USD)
WALLET_TRACKING_MIN_VALUE_USD=100

# Large trade threshold (USD)
WALLET_TRACKING_LARGE_TRADE_USD=5000

# Helius API key for better RPC performance
HELIUS_API_KEY=your_api_key_here
```

### Recommended Settings

#### Conservative (Fewer Alerts, Higher Quality)
```env
WALLET_TRACKING_MIN_SCORE=75
WALLET_TRACKING_MIN_WIN_RATE=65
WALLET_TRACKING_MIN_VALUE_USD=500
```

#### Balanced (Default)
```env
WALLET_TRACKING_MIN_SCORE=60
WALLET_TRACKING_MIN_WIN_RATE=55
WALLET_TRACKING_MIN_VALUE_USD=100
```

#### Aggressive (More Alerts, Lower Quality)
```env
WALLET_TRACKING_MIN_SCORE=50
WALLET_TRACKING_MIN_WIN_RATE=45
WALLET_TRACKING_MIN_VALUE_USD=50
```

## Best Practices

### 1. **Start Small**
- Begin by tracking 3-5 high-performing wallets
- Study their trading patterns
- Gradually expand your watchlist

### 2. **Verify Performance**
- Use `/wallet_stats` to thoroughly analyze a wallet before tracking
- Look for consistent performance, not just high win rates
- Check trade frequency and hold times

### 3. **Diversify**
- Track wallets with different trading styles
- Mix scalpers, swing traders, and holders
- Don't rely on a single wallet

### 4. **Set Up Proper Alerts**
- Configure thresholds based on your risk tolerance
- Use priority levels to filter noise
- Consider using Discord/Email for critical alerts

### 5. **Don't Blindly Copy**
- Alerts are signals, not financial advice
- Always do your own research (DYOR)
- Consider your own risk tolerance and strategy

### 6. **Monitor Performance**
- Regularly review wallet performance with `/wallet_stats`
- Remove underperforming wallets with `/untrack_wallet`
- Add new top performers from `/top_wallets`

### 7. **Use Large Trade Alerts**
- Pay special attention to large buys from top wallets
- These often indicate high-conviction trades
- Consider faster entry on critical priority alerts

## Troubleshooting

### Not Receiving Alerts?

1. **Check if monitor is running:**
   ```
   /copy_status
   ```

2. **Verify wallet is tracked:**
   ```
   /watchlist
   ```

3. **Check wallet meets minimum criteria:**
   ```
   /wallet_stats <address>
   ```
   Ensure score and win rate are above thresholds.

4. **Verify trade value:**
   Trades below minimum value threshold won't trigger alerts.

### Wallet Shows No Trades?

- Wallet may not have traded recently
- Give it time to accumulate trading history
- Check wallet on Solscan to verify activity

### Performance Metrics Not Updating?

- Performance is calculated after each trade
- May take a few minutes to update
- Use `/wallet_stats` to manually refresh

## Database Schema

The system uses the following Supabase tables:

- **`tracked_wallets`** - Your wallet watchlist
- **`wallet_transactions`** - All detected transactions
- **`wallet_performance`** - Aggregated performance metrics
- **`wallet_discovery_queue`** - Auto-discovered wallets
- **`copy_trading_alerts`** - Alert history

## API Integration

The copy trading system can be integrated with external applications via WebSocket events:

```typescript
copyTradingAlertHandler.on('copy_trading_alert', (alert) => {
  // Handle alert in your custom application
  console.log('New trade:', alert);
});
```

## Support & Feedback

For issues, feature requests, or questions:
- Check the bot logs for errors
- Review this documentation
- Contact the development team

## Disclaimer

⚠️ **Important:** This tool is for informational purposes only. Copying trades from other wallets does not guarantee profits. Always conduct your own research and never invest more than you can afford to lose. Past performance is not indicative of future results.

---

**Happy Copy Trading! 🚀**
