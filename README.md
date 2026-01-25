# Solana Memecoin Monitoring Bot

A comprehensive bot that monitors Solana DEXs for new memecoin launches, performs safety analysis, classifies risk, and sends Telegram alerts. Includes advanced monitoring, portfolio tracking, and 30+ Telegram commands.

## Features

### Multi-Source Monitoring
- **Raydium**: Real-time WebSocket monitoring for new liquidity pools
- **Pump.fun**: Polling for new token launches and graduations
- **Jupiter**: Monitoring for newly listed tokens (287,000+ tokens indexed)
- **Meteora**: DLMM (concentrated liquidity) pool monitoring
- **Orca**: Whirlpool (CLMM) pool monitoring

### Safety Analysis
- **Liquidity Analysis**: LP lock/burn status, liquidity depth, locker detection
- **Holder Distribution**: Whale detection, concentration analysis, top holder tracking
- **Contract Analysis**: Mint/freeze authority, honeypot detection, Token-2022 support
- **Social Verification**: Twitter, Telegram, website validation
- **RugCheck Integration**: External risk validation

### Risk Classification
- **5-Level System**: LOW, MEDIUM, HIGH, VERY_HIGH, EXTREME
- **Score-based** (0-100 points)
- **Non-linear scoring** for extreme concentration
- **LP lock duration scoring** (longer locks = higher score)

### Advanced Monitoring (Phase 6)
- **Volume Spike Detection**: Alerts on 5x+ volume increases
- **Whale Movement Tracking**: Alerts when 3%+ supply moves
- **Liquidity Drain Detection**: Alerts on 30%+ liquidity removal
- **Authority Change Tracking**: Monitors mint/freeze authority changes

### Portfolio Tracking
- Track positions with entry prices
- Real-time P&L calculation
- Winners/losers breakdown
- Automatic price averaging on multiple buys

### Network Resilience
- Retry logic with exponential backoff
- Circuit breakers for failing endpoints
- Rate limiting to avoid API bans
- Graceful degradation with fallback endpoints

---

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- Telegram account
- Solana RPC endpoint

### 1. Clone the Repository
```bash
git clone https://github.com/basel95f-code/solana-memecoin-bot.git
cd solana-memecoin-bot
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Create Telegram Bot
1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456789:ABCdefGHI...`)

### 4. Get Your Chat ID
1. Start a chat with [@userinfobot](https://t.me/userinfobot)
2. Send any message to get your user ID
3. For group chats: Add [@getidsbot](https://t.me/getidsbot) to your group

### 5. Configure Environment
```bash
cp .env.example .env
```

Edit `.env` with your settings:
```env
# Required
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here

# Optional - Thresholds
MIN_LIQUIDITY_USD=1000
MIN_RISK_SCORE=0

# Optional - Monitors (true/false)
RAYDIUM_ENABLED=true
PUMPFUN_ENABLED=true
JUPITER_ENABLED=true
METEORA_ENABLED=true
ORCA_ENABLED=true
```

### 6. Start the Bot
```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm run build
npm start
```

---

## Telegram Commands

### Analysis Commands
| Command | Description |
|---------|-------------|
| `/check <address>` | Full token analysis with all metrics |
| `/scan <address>` | Quick safety scan |
| `/holders <address>` | Holder distribution breakdown |
| `/lp <address>` | Liquidity pool information |
| `/socials <address>` | Social media links |
| `/compare <addr1> <addr2>` | Compare two tokens |
| `/rug <address>` | Detailed RugCheck report |
| `/whales <address>` | Track whale wallets (>5% holders) |
| `/risk <address>` | Detailed risk factor breakdown |

### Discovery Commands
| Command | Description |
|---------|-------------|
| `/trending` | View trending tokens |
| `/new` | Recently launched tokens |
| `/gainers` | Top price gainers |
| `/losers` | Top price losers |
| `/volume` | Volume leaders |

### Watchlist Commands
| Command | Description |
|---------|-------------|
| `/watch <address>` | Add token to watchlist |
| `/unwatch <address>` | Remove from watchlist |
| `/watchlist` | View your watchlist |

### Advanced Monitoring
| Command | Description |
|---------|-------------|
| `/monitor <address>` | Enable advanced monitoring for token |
| `/unmonitor <address>` | Stop monitoring token |
| `/monitored` | List all monitored tokens |
| `/diagnose <address>` | Quick diagnosis for red flags |

### Portfolio Tracking
| Command | Description |
|---------|-------------|
| `/portfolio` | View all positions with P&L |
| `/buy <address> <amount> [price]` | Add position |
| `/sell <address> <amount> [price]` | Record sale |
| `/pnl` | Quick P&L summary |

### Settings & Alerts
| Command | Description |
|---------|-------------|
| `/alerts` | Toggle alerts on/off |
| `/mute [minutes]` | Mute alerts temporarily |
| `/filter` | Set filter profile (conservative/balanced/aggressive/degen) |
| `/settings` | View all settings |
| `/timezone` | Set your timezone |
| `/quiet` | Set quiet hours |
| `/help` | Show all commands |
| `/status` | Bot status |
| `/stats` | Monitoring statistics |

---

## Filter Profiles

| Profile | Min Liquidity | Max Top 10 | Min Holders | Min Score |
|---------|---------------|------------|-------------|-----------|
| **Conservative** | $10,000 | 25% | 100 | 75 |
| **Balanced** | $2,000 | 40% | 25 | 50 |
| **Aggressive** | $500 | 60% | 10 | 30 |
| **Degen** | $100 | 90% | 3 | 0 |

---

## Risk Score System

### Score Levels
| Score | Level | Emoji | Description |
|-------|-------|-------|-------------|
| 80-100 | LOW | 🟢 | Most safety checks passed |
| 60-79 | MEDIUM | 🟡 | Some concerns |
| 40-59 | HIGH | 🟠 | Multiple red flags |
| 20-39 | VERY_HIGH | 🔴 | Significant risk |
| 0-19 | EXTREME | 💀 | Likely scam |

### Scoring Factors
- **Liquidity** (up to 20 pts): LP burned/locked status
- **LP Lock Duration** (up to 8 pts): Longer = better
- **Holder Distribution** (up to 20 pts): Non-linear penalties for concentration
- **Contract Safety** (up to 20 pts): Mint/freeze authority status
- **Social Presence** (up to 15 pts): Twitter, Telegram, website
- **RugCheck Score** (up to 10 pts): External validation
- **Honeypot Check**: Instant 0 if detected

---

## Advanced Monitoring Alerts

When you `/monitor` a token, you'll receive alerts for:

| Alert Type | Trigger | Severity |
|------------|---------|----------|
| 📊 Volume Spike | 5x+ volume in 1 hour | Warning/Critical |
| 🐋 Whale Movement | 3%+ supply moved | Warning/Critical |
| 💧 Liquidity Drain | 30%+ liquidity removed | Warning/Critical |
| 🔐 Authority Change | Mint/freeze authority changed | Info/Critical |

---

## Project Structure

```
src/
├── index.ts                    # Entry point & queue processor
├── config.ts                   # Configuration
├── types/index.ts              # TypeScript types
├── utils/
│   └── retry.ts                # Retry, circuit breaker, rate limiter
├── monitors/
│   ├── raydium.ts              # Raydium WebSocket monitor
│   ├── pumpfun.ts              # Pump.fun polling monitor
│   └── jupiter.ts              # Jupiter token list monitor
├── analysis/
│   ├── tokenAnalyzer.ts        # Analysis orchestrator
│   ├── liquidityCheck.ts       # Liquidity analysis
│   ├── holderAnalysis.ts       # Holder distribution
│   ├── contractCheck.ts        # Contract safety checks
│   └── socialCheck.ts          # Social verification
├── risk/
│   └── classifier.ts           # Risk scoring algorithm
├── services/
│   ├── solana.ts               # Solana RPC service
│   ├── telegram.ts             # Telegram bot service
│   ├── dexscreener.ts          # DexScreener API
│   ├── rugcheck.ts             # RugCheck API
│   ├── cache.ts                # LRU token cache
│   ├── storage.ts              # Async file storage
│   ├── watchlist.ts            # Batch price fetching
│   ├── ratelimit.ts            # Alert rate limiting
│   └── advancedMonitor.ts      # Volume/whale/liquidity alerts
└── telegram/
    ├── commands/
    │   ├── index.ts            # Command registration
    │   ├── basic.ts            # /help, /status, /stats
    │   ├── analysis.ts         # /check, /scan, /rug, /whales, /risk
    │   ├── discovery.ts        # /trending, /new, /gainers
    │   ├── watchlist.ts        # /watch, /unwatch, /watchlist
    │   ├── filters.ts          # /filter
    │   ├── alerts.ts           # /alerts, /mute
    │   ├── settings.ts         # /settings, /timezone, /quiet
    │   └── advanced.ts         # /monitor, /portfolio, /buy, /sell
    ├── formatters.ts           # Message formatting
    └── keyboards.ts            # Inline keyboards
```

---

## Recommended RPC Providers

The free Solana RPC has rate limits. For production use:

| Provider | Free Tier | Paid Plans |
|----------|-----------|------------|
| [Helius](https://helius.xyz/) | 100k req/day | From $49/mo |
| [QuickNode](https://quicknode.com/) | Limited | From $9/mo |
| [Triton](https://triton.one/) | Limited | Custom |
| [Alchemy](https://alchemy.com/) | 300M CU/mo | From $49/mo |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SOLANA_RPC_URL` | Yes | - | Solana RPC endpoint |
| `SOLANA_WS_URL` | No | Auto | WebSocket URL (derived from RPC) |
| `TELEGRAM_BOT_TOKEN` | Yes | - | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | - | Your Telegram user/group ID |
| `RUGCHECK_API_KEY` | No | - | RugCheck API key |
| `MIN_LIQUIDITY_USD` | No | 1000 | Minimum liquidity for alerts |
| `MIN_RISK_SCORE` | No | 0 | Minimum score for alerts |
| `RAYDIUM_ENABLED` | No | true | Enable Raydium monitor |
| `PUMPFUN_ENABLED` | No | true | Enable Pump.fun monitor |
| `JUPITER_ENABLED` | No | true | Enable Jupiter monitor |

---

## Development

```bash
# Install dependencies
npm install

# Run in development mode (auto-reload)
npm run dev

# Type checking
npx tsc --noEmit

# Build for production
npm run build

# Start production build
npm start
```

---

## Troubleshooting

### Bot not receiving messages
- Ensure you've started a conversation with the bot first
- Check that `TELEGRAM_CHAT_ID` is correct
- For groups, make sure the bot is added as admin

### Rate limit errors
- Use a paid RPC provider
- The bot has built-in retry logic and will recover

### Jupiter sync failing
- Normal on first start, uses fallback endpoint
- Auto-recovery runs every 2 minutes

### Holder analysis fails for large tokens
- Tokens with millions of holders exceed RPC limits
- Works correctly for newer/smaller tokens

---

## Disclaimer

⚠️ **This bot is for informational purposes only.**

- Does not constitute financial advice
- Always do your own research (DYOR)
- Memecoin trading is extremely high risk
- You may lose your entire investment
- Past performance does not guarantee future results

---

## License

MIT

---

## Credits

Built with Claude Code by Anthropic.
