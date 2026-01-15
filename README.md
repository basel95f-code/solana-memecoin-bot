# Solana Memecoin Monitoring Bot

A comprehensive bot that monitors Solana DEXs for new memecoin launches, performs safety analysis, classifies risk, and sends Telegram alerts.

## Features

- **Multi-Source Monitoring**
  - Raydium: Real-time WebSocket monitoring for new liquidity pools
  - Pump.fun: Polling for new token launches and graduations
  - Jupiter: Monitoring for newly listed tokens

- **Safety Checks**
  - Liquidity analysis (LP lock/burn status, liquidity depth)
  - Holder distribution (whale detection, concentration)
  - Contract analysis (mint/freeze authority, honeypot detection)
  - Social verification (Twitter, Telegram, website)
  - RugCheck API integration

- **Risk Classification**
  - Score-based system (0-100)
  - Categories: LOW, MEDIUM, HIGH, EXTREME
  - Detailed risk factor breakdown

- **Telegram Alerts**
  - Formatted alerts with all safety metrics
  - Quick links to Birdeye, DexScreener, RugCheck, Solscan
  - Configurable thresholds

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd solana-memecoin-bot
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your settings:
```env
# Required
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
TELEGRAM_CHAT_ID=your_telegram_user_or_group_id

# Optional
RUGCHECK_API_KEY=your_rugcheck_api_key
MIN_LIQUIDITY_USD=1000
MIN_RISK_SCORE=0
```

4. Build the project:
```bash
npm run build
```

5. Start the bot:
```bash
npm start
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SOLANA_RPC_URL` | Yes | - | Solana RPC endpoint URL |
| `SOLANA_WS_URL` | No | Auto | WebSocket URL (derived from RPC URL) |
| `TELEGRAM_BOT_TOKEN` | Yes | - | Telegram bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | - | Your Telegram user/group ID |
| `RUGCHECK_API_KEY` | No | - | RugCheck API key for enhanced analysis |
| `MIN_LIQUIDITY_USD` | No | 1000 | Minimum liquidity to trigger alert |
| `MIN_RISK_SCORE` | No | 0 | Minimum risk score to send alert |
| `RAYDIUM_ENABLED` | No | true | Enable Raydium monitoring |
| `PUMPFUN_ENABLED` | No | true | Enable Pump.fun monitoring |
| `JUPITER_ENABLED` | No | true | Enable Jupiter monitoring |

### Getting Your Telegram Chat ID

1. Start a chat with [@userinfobot](https://t.me/userinfobot)
2. Send any message to get your user ID
3. For group IDs, add the bot to your group and use [@getidsbot](https://t.me/getidsbot)

### Recommended RPC Providers

For production use, consider a paid RPC provider:
- [Helius](https://helius.xyz/)
- [QuickNode](https://quicknode.com/)
- [Triton](https://triton.one/)

Free tier RPCs have rate limits that may cause missed tokens.

## Alert Format

```
🚨 NEW TOKEN DETECTED

Token: Example Token ($EXAMPLE)
CA: TokenMintAddress...
Risk: 🟢 LOW (Score: 85/100)

━━━━━━ LIQUIDITY ━━━━━━
💧 Total: $50,000
🔒 LP Burned: ✅ Yes (95.0%)
🔐 LP Locked: ✅ Yes (5.0%)

━━━━━━ HOLDERS ━━━━━━
👥 Total: 150
🐋 Top 10: 25.0%
👤 Largest: 5.2%

━━━━━━ CONTRACT ━━━━━━
🔐 Mint Authority: ✅ Revoked
❄️ Freeze Authority: ✅ Revoked
🍯 Honeypot: ✅ No

━━━━━━ SOCIAL ━━━━━━
🐦 Twitter: Found
💬 Telegram: Found
🌐 Website: Found

━━━━━━ LINKS ━━━━━━
Birdeye | DexScreener | RugCheck | Solscan

📍 Source: RAYDIUM
🕐 Detected: 1/15/2026, 12:00:00 PM
```

## Risk Score Breakdown

| Score | Level | Description |
|-------|-------|-------------|
| 70-100 | LOW | Most safety checks passed |
| 40-69 | MEDIUM | Some concerns but potentially tradeable |
| 10-39 | HIGH | Multiple red flags |
| 0-9 | EXTREME | Likely scam or rug pull |

### Risk Factors

- **Liquidity (25%)**: LP burn/lock status, liquidity depth
- **Holders (25%)**: Distribution, whale concentration
- **Contract (30%)**: Mint/freeze authority, honeypot
- **Social (10%)**: Social media presence
- **RugCheck (10%)**: External validation

## Development

```bash
# Run in development mode
npm run dev

# Watch for changes
npm run watch

# Build for production
npm run build
```

## Project Structure

```
src/
├── index.ts                 # Entry point
├── config.ts                # Configuration
├── monitors/
│   ├── raydium.ts           # Raydium monitor
│   ├── pumpfun.ts           # Pump.fun monitor
│   └── jupiter.ts           # Jupiter monitor
├── analysis/
│   ├── tokenAnalyzer.ts     # Analysis orchestrator
│   ├── liquidityCheck.ts    # Liquidity analysis
│   ├── holderAnalysis.ts    # Holder analysis
│   ├── contractCheck.ts     # Contract checks
│   └── socialCheck.ts       # Social verification
├── services/
│   ├── solana.ts            # Solana RPC service
│   ├── rugcheck.ts          # RugCheck API
│   ├── telegram.ts          # Telegram bot
│   └── cache.ts             # Token cache
├── risk/
│   └── classifier.ts        # Risk scoring
└── types/
    └── index.ts             # TypeScript types
```

## Disclaimer

This bot is for informational purposes only. It does not constitute financial advice. Always do your own research (DYOR) before trading any token. Memecoin trading is extremely high risk and you may lose your entire investment.

## License

MIT
