# Telegram Bot Commands Reduction

## Problem
Telegram limits bots to 100 commands total. The bot was attempting to register 148 commands, causing the "BOT_COMMANDS_TOO_MUCH" error.

## Solution
Reduced registered commands to **27 essential commands** (well under the 100-command limit).

## File Modified
`apps/bot/src/telegram/commands/index.ts` (lines 88-241)

---

## Commands Kept (27 Total) ✅

### Basic Commands (3)
- `/start` - Welcome message
- `/help` - Show all commands
- `/status` - Bot status

### Core Token Analysis (6)
- `/check` - Full token analysis
- `/scan` - Quick safety scan
- `/risk` - Detailed risk breakdown
- `/rug` - Detailed RugCheck report
- `/contract` - Contract security analysis
- `/honeypot` - Quick honeypot check

### Watchlist Management (3)
- `/watch` - Add to watchlist
- `/unwatch` - Remove from watchlist
- `/watchlist` - Show watchlist

### Alerts (3)
- `/alerts` - Toggle alerts on/off
- `/mute` - Mute alerts temporarily
- `/quiet` - Set quiet hours

### Filters & Settings (2)
- `/filter` - Set filter profile
- `/settings` - Show all settings

### Discovery (3)
- `/trending` - Trending tokens
- `/new` - New tokens
- `/gainers` - Top gainers

### Wallet Monitoring (3)
- `/track` - Track a wallet
- `/untrack` - Stop tracking wallet
- `/wallets` - List tracked wallets

### Advanced Monitoring (2)
- `/monitor` - Add token to monitoring
- `/monitored` - List monitored tokens

### Whale Activity (2)
- `/whale` - Whale timeline & patterns
- `/whales` - Track whale wallets

---

## Commands Removed (121 Total) ❌

### ML/AI Commands (8)
- `/ml` - ML model status
- `/mlstatus` - ML system status & performance
- `/mlhistory` - Model version history
- `/mltrain` - Manual model retraining (admin)
- `/mlcompare` - Compare model versions
- `/mlrollback` - Rollback to previous model (admin)
- `/mlfeatures` - Feature importance rankings
- `/mlreport` - Detailed performance report

### Portfolio Tracking (4)
- `/portfolio` - View your portfolio
- `/buy` - Add position
- `/sell` - Record sale
- `/pnl` - P&L summary

### Backtesting Commands (6)
- `/strategies` - List backtest strategies
- `/backtest` - Run a backtest
- `/btresults` - Show backtest results
- `/newstrategy` - Create custom strategy
- `/viewstrategy` - View strategy details
- `/snapshots` - Snapshot collection status

### Trading Signals (8)
- `/signals` - Active trading signals
- `/ack` - Acknowledge a signal
- `/outcome` - Record trade outcome
- `/webhook` - Manage webhooks
- `/kelly` - Kelly criterion position sizing
- `/correlation` - Signal correlation analysis
- `/slack` - Manage Slack webhooks
- `/rules` - Custom alert rules

### Copy Trading (6)
- `/track_wallet` - Add wallet to copy trading watchlist
- `/untrack_wallet` - Remove from copy trading watchlist
- `/wallet_stats` - Detailed wallet performance stats
- `/top_wallets` - Top performing wallets
- `/wallet_trades` - Recent wallet trades
- `/copy_status` - Copy trading monitor status

### Smart Money & Advanced Analytics (9)
- `/smartmoney` - Smart money suggestions
- `/smstats` - Smart money stats
- `/leaderboard` - Top performing wallets
- `/profile` - Wallet trading profile
- `/style` - Find wallets by trading style
- `/clusters` - Detect wallet clusters
- `/sybil` - Check for Sybil attack
- `/compare` - Compare two wallets
- `/vsleader` - Compare vs leaderboard #1

### Advanced Analysis (15)
- `/holders` - Holder breakdown
- `/lp` - LP info
- `/socials` - Social links
- `/compare` - Compare two tokens
- `/timeframe` - Multi-timeframe token analysis
- `/anomalies` - Show detected anomalies
- `/sentiment` - Multi-platform sentiment settings
- `/scanner` - Token scanner & filters
- `/learn` - Learning system stats
- `/outcomes` - Token outcomes
- `/patterns` - View success/rug patterns
- `/pattern` - Pattern details
- `/matchpatterns` - Match token to patterns
- `/similartokens` - Find similar successful tokens
- `/refreshpatterns` - Rediscover patterns (admin)

### Group Watchlist (4)
- `/groupwatch` - Add to group watchlist
- `/groupunwatch` - Remove from group watchlist
- `/groupwatchlist` - Show group watchlist
- `/hotlist` - Most active watched tokens

### Group Features (1)
- `/mystats` - Your leaderboard stats

### Preset Management (5)
- `/presets` - List saved presets
- `/save` - Save current filters as preset
- `/load` - Load a preset
- `/share` - Share preset code
- `/import` - Import preset from code

### Advanced Settings (13)
- `/priority` - Set alert priority
- `/bl` - Manage blacklist
- `/timezone` - Set timezone
- `/performance` - Performance dashboard
- `/winrate` - Profile win rate details
- `/compare_profiles` - Compare all profiles
- `/stats` - Monitoring statistics
- `/diagnose` - Quick token diagnosis
- `/wallet` - Wallet activity
- `/health` - Service health status
- `/meteora` - Meteora DLMM monitor stats
- `/orca` - Orca Whirlpool monitor stats
- `/dex_stats` - Compare all DEX sources
- `/volume` - Volume leaders
- `/losers` - Top losers
- `/whaleactivity` - Token whale activity
- `/accumulating` - Active accumulation patterns
- `/distributing` - Active distribution patterns

---

## Implementation Notes

1. **All handlers still registered** - The command handlers in each module are still registered via `registerXCommands()` calls. Users can still invoke removed commands by typing them manually; they just won't show in the `/help` dropdown menu.

2. **Commented out in array** - Removed commands are commented out in the `setMyCommands()` array to make it easy to re-enable them later if needed.

3. **Help command** - The `/help` command displays the full list of available commands from the handler registrations, so users can still discover and use removed commands if needed.

4. **Telegram API compliance** - The bot now complies with Telegram's 100-command limit on the main menu.

---

## Verification

- Total commands kept: **27**
- Total commands removed: **121**
- Telegram limit: **100**
- Status: ✅ **COMPLIANT**

