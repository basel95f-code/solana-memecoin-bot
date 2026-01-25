# Backend API Endpoints Needed

This file lists all the API endpoints that the web dashboard expects. These need to be implemented in the backend Express server.

## Base URL
`http://localhost:3000`

## Endpoints

### 📊 Tokens

```typescript
GET /api/tokens
Query params: limit?, offset?, sortBy?, riskLevel[]?, minLiquidity?, maxRiskScore?
Response: Token[]

GET /api/tokens/:mint
Response: TokenAnalysis

GET /api/tokens/:mint/price-history
Query params: interval? (default: '5m')
Response: Array<{ timestamp: number; price: number; volume: number }>

GET /api/tokens/:mint/holders
Response: Array<{ range: string; count: number; percentage: number }>

POST /api/tokens/:mint/refresh
Response: TokenAnalysis
```

### 🧠 Patterns

```typescript
GET /api/patterns
Response: Pattern[]

GET /api/patterns/:mint
Response: PatternMatch[]

GET /api/patterns/history
Query params: limit? (default: 50)
Response: PatternHistory[]

GET /api/patterns/:patternId/stats
Response: PatternStats

POST /api/patterns/discover
Response: { message: string; patternsDiscovered: number }
```

### 💎 Smart Money

```typescript
GET /api/smart-money
Query params: limit? (default: 50)
Response: SmartMoneyWallet[]

GET /api/smart-money/:walletAddress
Response: SmartMoneyWallet

GET /api/smart-money/:walletAddress/trades
Query params: limit? (default: 100)
Response: SmartMoneyTrade[]

GET /api/smart-money/activity
Query params: limit? (default: 50)
Response: SmartMoneyActivity[]

GET /api/smart-money/token/:mint/activity
Response: SmartMoneyActivity[]

POST /api/smart-money
Body: { wallet_address: string }
Response: { success: boolean }

DELETE /api/smart-money/:walletAddress
Response: { success: boolean }
```

### 🔔 Alerts

```typescript
GET /api/alerts
Query params: limit? (default: 100), unread_only? (boolean)
Response: Alert[]

PATCH /api/alerts/:alertId/read
Response: { success: boolean }

POST /api/alerts/read-all
Response: { success: boolean }

DELETE /api/alerts/:alertId
Response: { success: boolean }

GET /api/alerts/rules
Response: AlertRule[]

POST /api/alerts/rules
Body: AlertRule
Response: AlertRule

PUT /api/alerts/rules/:ruleId
Body: Partial<AlertRule>
Response: AlertRule

DELETE /api/alerts/rules/:ruleId
Response: { success: boolean }

PATCH /api/alerts/rules/:ruleId/toggle
Body: { enabled: boolean }
Response: { success: boolean }
```

### 🔌 WebSocket

```typescript
WebSocket connection: ws://localhost:3000/ws

Message types:
- token_update: { type: 'token_update', data: Token, timestamp: number }
- smart_money_activity: { type: 'smart_money_activity', data: SmartMoneyActivity, timestamp: number }
- pattern_detected: { type: 'pattern_detected', data: PatternMatch, timestamp: number }
- alert: { type: 'alert', data: Alert, timestamp: number }
```

## Implementation Example

```typescript
// Example Express router setup
import express from 'express';
import { database } from './database';
import { patternDetector } from './services/patternDetector';

const router = express.Router();

// Tokens
router.get('/api/tokens', async (req, res) => {
  const { limit = 50, sortBy = 'discovered_at', riskLevel } = req.query;
  
  let query = 'SELECT * FROM tokens WHERE 1=1';
  const params: any[] = [];
  
  if (riskLevel) {
    // Add risk level filter
  }
  
  query += ` ORDER BY ${sortBy} DESC LIMIT ?`;
  params.push(limit);
  
  const tokens = database.all(query, params);
  res.json(tokens);
});

router.get('/api/tokens/:mint', async (req, res) => {
  const { mint } = req.params;
  const analysis = database.get('SELECT * FROM token_analysis WHERE mint = ?', [mint]);
  
  if (!analysis) {
    return res.status(404).json({ error: 'Token not found' });
  }
  
  // Format and return full analysis
  res.json(formatTokenAnalysis(analysis));
});

// Patterns
router.get('/api/patterns', async (req, res) => {
  const patterns = await patternDetector.getAllPatterns(true);
  res.json(patterns);
});

router.post('/api/patterns/discover', async (req, res) => {
  const newPatterns = await patternDetector.discoverPatterns();
  res.json({ message: 'Pattern discovery complete', patternsDiscovered: newPatterns.length });
});

// Smart Money
router.get('/api/smart-money', async (req, res) => {
  const { limit = 50 } = req.query;
  const wallets = database.all(
    'SELECT * FROM smart_money_wallets ORDER BY reputation_score DESC LIMIT ?',
    [limit]
  );
  res.json(wallets);
});

// Alerts
router.get('/api/alerts', async (req, res) => {
  const { limit = 100, unread_only } = req.query;
  
  let query = 'SELECT * FROM alerts';
  if (unread_only === 'true') {
    query += ' WHERE read = 0';
  }
  query += ' ORDER BY created_at DESC LIMIT ?';
  
  const alerts = database.all(query, [limit]);
  res.json(alerts);
});

export default router;
```

## Database Schema References

Refer to `apps/bot/src/database/schema.sql` for complete table definitions.

Key tables:
- `tokens` / `token_analysis` - Token data
- `success_patterns` - ML patterns
- `token_pattern_matches` - Pattern matches
- `smart_money_wallets` / `smart_money_trades` - Wallet tracking
- `alerts` / `alert_rules` - Alert system

## Next Steps

1. Create `apps/bot/src/api/routes.ts` with all endpoints
2. Mount router in main server file
3. Add WebSocket server for real-time updates
4. Test all endpoints with the frontend
5. Add proper error handling and validation
