---
name: telegram-alerts
description: Format and send professional Telegram trading alerts
---
# Telegram Alert Formatting Skill

When creating alerts:
1. Use clear emoji indicators
2. Structure: Token info -> Metrics -> Scores -> Flags -> Links
3. Include contract address as copyable code
4. Add DexScreener, Birdeye, Solscan links
5. Show risk/reward assessment

## Emoji Guide
- Bullish/Good: ✅
- Warning: ⚠️
- Danger/Bad: 🚨 ❌
- Money/Price: 💰 💵
- Chart/Stats: 📊 📈
- Token: 🪙
- Address: 📍
- Link: 🔗
- New: 🆕
- Fire/Hot: 🔥

## Alert Template

```
🚀 ALPHA ALERT - [Confidence Level]

━━━━━━━━━━━━━━━━━━━━━━━━━━━

🪙 $TOKEN (Symbol)
📍 <code>contract_address</code>

━━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 MARKET DATA
├ Price: $X.XXXXX
├ Liquidity: $XX,XXX
├ Volume 24h: $XX,XXX
├ Market Cap: $X.XM
└ Holders: XXX

📊 SCORES
├ 🛡️ Safety: XX/100
├ 📈 Opportunity: XX/100
├ 👤 Creator Trust: XX/100
└ 🎯 FINAL: XX/100 [RATING]

✅ GREEN FLAGS
├ LP locked/burned
├ Mint authority revoked
└ Well distributed holders

⚠️ WARNINGS
└ [Any concerns]

🔗 <a href="dexscreener_url">DexScreener</a> | <a href="birdeye_url">Birdeye</a> | <a href="solscan_url">Solscan</a>

━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏱️ Analyzed in X.Xs
```

## Confidence Levels
- HIGH CONFIDENCE: Score >= 80
- MEDIUM CONFIDENCE: Score 60-79
- SPECULATIVE: Score 40-59
- HIGH RISK: Score < 40

## Link Format
- DexScreener: https://dexscreener.com/solana/{address}
- Birdeye: https://birdeye.so/token/{address}
- Solscan: https://solscan.io/token/{address}
- RugCheck: https://rugcheck.xyz/tokens/{address}
