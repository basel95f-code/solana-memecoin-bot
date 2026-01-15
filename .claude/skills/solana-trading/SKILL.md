---
name: solana-trading
description: Solana memecoin trading analysis, risk scoring, and token evaluation
---
# Solana Trading Skill

When analyzing Solana tokens:
1. Check holder distribution using Helius RPC
2. Analyze creator wallet history for previous rugs
3. Calculate risk score based on: liquidity, holder concentration, LP lock status
4. Check for honeypot patterns (high buy tax, blocked sells)
5. Monitor volume/liquidity ratio for manipulation signs

Red flags to detect:
- Top holder > 20%
- Creator has previous rugged tokens
- Mint authority not revoked
- LP not locked or burned
- Suspicious same-block buyers

Green flags:
- Well distributed holders (Gini < 0.6)
- LP locked > 30 days or burned
- Creator has successful track record
- Organic trading pattern

## Token Analysis Checklist
- [ ] Verify contract on Solscan
- [ ] Check RugCheck.xyz score
- [ ] Analyze holder distribution
- [ ] Verify LP lock status
- [ ] Review creator wallet history
- [ ] Check social media presence
- [ ] Monitor trading patterns

## Risk Score Calculation
- Liquidity: 25% weight
- Holder distribution: 25% weight
- Contract safety: 20% weight
- Creator history: 15% weight
- Social presence: 10% weight
- Token age: 5% weight
