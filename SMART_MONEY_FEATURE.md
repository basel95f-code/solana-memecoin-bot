# 🧠 Smart Money Tracking Feature

**Track and copy profitable wallets automatically!**

---

## 🎯 What Is This?

Smart Money Tracking automatically monitors the performance of all wallets you track, identifies top performers, and sends you alerts when they make trades — so you can copy winning strategies.

---

## ✨ Key Features

### 1. **Automatic Performance Tracking**
- Every buy/sell from tracked wallets is recorded
- Win rate, ROI, P&L calculated in real-time
- Position tracking with unrealized P&L for open trades

### 2. **Leaderboard System**
- Top 10/20 wallets ranked by total ROI
- Minimum 5 closed trades to qualify
- See best/worst trades for each wallet

### 3. **Copy Trading Alerts**
- Get notified when high-performing wallets trade
- Only alerts for wallets with:
  - 5+ closed trades
  - 50%+ win rate
- Includes wallet's performance metrics in alert

### 4. **Smart Money Discovery**
- Bot suggests wallets to track based on performance
- Auto-identifies "smart money" (65%+ win rate, 100%+ ROI)
- Track the best traders automatically

### 5. **Detailed Metrics**
- Win rate, total ROI, profit factor
- 7-day and 30-day P&L
- Win/loss streaks
- Average hold duration
- Best and worst trades

---

## 📱 Telegram Commands

### `/leaderboard` (or `/lb`)
Show top 10 performing tracked wallets

**Example:**
```
🏆 Smart Money Leaderboard
Top performers by total ROI

🥇 Whale Master
   ROI: +245.3% | WR: 75% | Trades: 24
   P&L: +12.45 SOL

🥈 Diamond Hands
   ROI: +189.7% | WR: 68% | Trades: 19
   P&L: +8.92 SOL
```

**Actions:**
- 🔄 Refresh - Update leaderboard
- 📊 Top 20 - Show top 20 wallets

---

### `/smstats [wallet]`
Show detailed performance stats for a wallet

**Usage:**
- `/smstats` - Show all tracked wallets' stats (top 5)
- `/smstats [address]` - Detailed stats for specific wallet
- `/smstats [label]` - Find wallet by label (partial match)

**Example:**
```
#1 - Whale Master
7xKX...3nFd

📊 Performance
   Win Rate: 75.0% (18W/6L)
   Total ROI: +245.3%
   Total P&L: +12.45 SOL

💰 Recent P&L
   Last 7 days: +2.34 SOL
   Last 30 days: +8.92 SOL

📈 Stats
   Total Trades: 26 (24 closed, 2 open)
   Avg Win: +42.5%
   Avg Loss: -12.3%
   Profit Factor: 3.46x
   Avg Hold: 18.5h

🔥 Streaks
   Current: 🟢 3W
   Best Win: 7W
   Worst Loss: 2L

⭐ Best Trade
   PEPE: +187.5% (+3.42 SOL)

💀 Worst Trade
   SCAM: -45.2% (-0.89 SOL)
```

---

### `/smartmoney` (or `/sm`)
Get suggestions for wallets to track

**Example:**
```
🧠 Smart Money Suggestions
High-performing wallets to track

⭐ 7xKX...nFd3
   ROI: +245.3% | WR: 75%
   Trades: 24 | PF: 3.5x
   /track 7xKX... Smart Money #1

⭐ 9aB4...2cF8
   ROI: +189.7% | WR: 68%
   Trades: 19 | PF: 2.8x
   /track 9aB4... Smart Money #2
```

**Smart Money Criteria:**
- ✅ 10+ closed trades
- ✅ 65%+ win rate
- ✅ 100%+ total ROI
- ✅ 2x+ profit factor

---

## 🚨 Smart Money Alerts

When a wallet with good performance makes a trade, you get an alert:

```
🟢 Smart Money Alert

👤 Whale Master
🪙 Token: BONK
💵 Value: 2.50 SOL (~$310)

📊 Wallet Performance
   Win Rate: 75.0%
   Total ROI: +245.3%
   30d P&L: +8.92 SOL

📈 Chart | 🔍 Token
```

**Alert Criteria:**
- Wallet has 5+ closed trades
- Win rate >= 50%
- Buy or sell transaction detected

---

## 📊 How It Works

### 1. **Track Wallets**
Use existing `/track` command:
```
/track 7xKX...3nFd Whale Master
```

### 2. **Automatic Recording**
- Bot monitors all tracked wallets 24/7
- Records every buy and sell transaction
- Calculates P&L when positions close

### 3. **Performance Calculation**
- Win rate: (Wins / Total Trades) × 100
- Total ROI: (Total P&L / Total Invested) × 100
- Profit Factor: Avg Win / Avg Loss

### 4. **Leaderboard Ranking**
- Wallets ranked by total ROI
- Must have 5+ closed trades to qualify
- Updated in real-time

### 5. **Smart Alerts**
- Only wallets with proven track record
- Includes performance context
- Helps you decide whether to copy the trade

---

## 💡 Use Cases

### **1. Copy Top Performers**
Track known successful traders and get notified when they trade

### **2. Evaluate Your Trades**
Track your own wallet to see detailed performance analytics

### **3. Discover Talent**
Use `/smartmoney` to find high-performing wallets automatically

### **4. Compare Strategies**
Track multiple wallets with different strategies, see which works best

### **5. Learn from Winners**
Analyze what top performers are buying and when

---

## 🔧 Technical Details

### Performance Metrics Explained

**Win Rate**
- Percentage of profitable trades
- Formula: (Wins / Total Closed Trades) × 100
- Example: 18 wins out of 24 trades = 75% win rate

**Total ROI**
- Return on investment across all trades
- Formula: (Total P&L / Total Invested) × 100
- Example: Invested 10 SOL, made 24.5 SOL profit = +245% ROI

**Profit Factor**
- Average win divided by average loss
- Shows risk/reward efficiency
- Example: Avg win +42.5%, avg loss -12.3% = 3.46x

**Hold Duration**
- Average time between buy and sell
- Measured in hours
- Helps identify trading style (day trader vs holder)

---

## ⚠️ Important Notes

### Limitations
- Only tracks transactions detected by wallet monitor
- Requires wallet monitor to be enabled (`WALLET_MONITOR_ENABLED=true`)
- Performance metrics based on detected trades only
- Open positions show unrealized P&L (updated every 5 min)

### Privacy
- All data stored locally in memory (not persisted to disk yet)
- Data resets when bot restarts
- No external sharing of wallet performance data

### Accuracy
- Relies on DexScreener for token prices
- P&L calculations may have small discrepancies due to fees
- Some transactions may be missed if wallet monitor is down

---

## 🚀 Getting Started

### Step 1: Track a Wallet
```
/track 7xKX...3nFd Whale #1
```

### Step 2: Wait for Trades
Bot monitors wallet 24/7 and records buy/sell transactions

### Step 3: Check Performance
```
/smstats Whale
```

### Step 4: View Leaderboard
```
/leaderboard
```

### Step 5: Get Suggestions
```
/smartmoney
```

---

## 📈 Example Workflow

```
1. Track 5 known successful wallets
   /track 7xKX... Whale #1
   /track 9aB4... Whale #2
   ...

2. Bot monitors them and records trades automatically

3. After 1 week, check leaderboard
   /leaderboard
   
4. See Whale #1 has 80% win rate, +150% ROI

5. Get alert when Whale #1 buys:
   🟢 Smart Money Alert
   Whale #1 BOUGHT $BONK
   Win Rate: 80% | ROI: +150%

6. You decide to copy the trade

7. Track your own wallet to compare:
   /track [your wallet] My Trades
   
8. Compare your performance vs Whale #1:
   /smstats My Trades
   /smstats Whale
```

---

## 🎯 Tips for Best Results

### Track Quality Wallets
- Look for consistent performers, not one-hit wonders
- Track wallets with diverse holdings (not just one token)
- Prefer wallets with 10+ trades for reliable stats

### Use Filters
- Set minimum SOL value for alerts (`/settings`)
- Focus on wallets with 65%+ win rate
- Look for 2x+ profit factor

### Don't Blindly Copy
- Smart money alert = research signal, not buy signal
- Still do your own analysis on the token
- Consider market conditions

### Monitor Over Time
- Give wallets time to build track record (2-4 weeks)
- Watch for consistency in performance
- Check if recent performance matches historical

### Diversify Sources
- Track multiple wallets with different strategies
- Don't rely on single "guru" wallet
- Combine smart money alerts with your own analysis

---

## 🔜 Future Enhancements

Planned improvements:
- Persistent storage (trades saved to database)
- Historical performance charts
- Wallet comparison tool
- Auto-track suggestions based on ML
- Custom alert filters per wallet
- Export performance data to CSV

---

## 🐛 Troubleshooting

**No alerts appearing?**
- Check wallet monitor is enabled
- Verify tracked wallet is actually trading
- Check alert settings (`/settings`)

**Metrics seem wrong?**
- Open positions show unrealized P&L
- P&L updates every 5 minutes
- Bot restart resets all data (temp limitation)

**Wallet not on leaderboard?**
- Needs minimum 5 closed trades
- Wallet must have completed buy → sell cycles

**Smart money suggestions empty?**
- Needs wallets with 10+ trades, 65%+ WR, 100%+ ROI
- Keep tracking wallets, suggestions will appear over time

---

## 📞 Support

Questions or issues? Ask in the chat!

**Commands Quick Reference:**
- `/leaderboard` or `/lb` - Top performers
- `/smstats [wallet]` - Detailed metrics
- `/smartmoney` or `/sm` - Track suggestions
- `/track [address] [label]` - Track wallet
- `/wallets` - List tracked wallets

---

**Happy copy trading! 🚀**
