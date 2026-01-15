---
name: crypto-analysis
description: Technical and fundamental analysis for cryptocurrency tokens
---
# Crypto Analysis Skill

For token analysis:
1. Fetch price data from DexScreener API
2. Calculate key metrics: volume/liquidity ratio, buy/sell ratio
3. Identify momentum patterns
4. Evaluate market cap potential
5. Compare to similar successful tokens

## Technical Indicators

### Price Momentum
- 5m change: Short-term volatility
- 1h change: Intraday trend
- 24h change: Daily performance

### Volume Analysis
- Volume/Liquidity ratio > 1: High activity
- Buy/Sell ratio > 1.2: Bullish pressure
- Consistent volume: Healthy trading

### Holder Metrics
- Growth rate: New holders per hour
- Concentration: Top 10 holder %
- Whale activity: Large transactions

## Fundamental Analysis

### Token Quality Indicators
- Contract verified
- Liquidity locked/burned
- Active development
- Community engagement

### Market Potential
- Current market cap vs peers
- Total addressable market
- Narrative/trend alignment

## API Endpoints
- DexScreener: https://api.dexscreener.com/latest/dex/tokens/{address}
- Jupiter Price: https://api.jup.ag/price/v2?ids={address}
- RugCheck: https://api.rugcheck.xyz/v1/tokens/{address}/report
