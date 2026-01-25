# Multi-Channel Alert Delivery System

A robust, flexible alert system for the Solana Memecoin Bot that supports multiple delivery channels with advanced features like deduplication, batching, retry logic, and custom rule engines.

## 🌟 Features

### Core Capabilities
- **Multi-Channel Delivery**: Telegram, Discord, Email, WebSocket, SMS (future)
- **Custom Alert Rules**: Build complex conditions with AND/OR logic
- **Smart Deduplication**: Prevents duplicate alerts using configurable time windows
- **Intelligent Batching**: Groups similar alerts to reduce notification spam
- **Retry Logic**: Exponential backoff for transient failures
- **Rate Limiting**: Per-channel rate limits to respect API quotas
- **Priority Levels**: Critical, High, Normal, Low
- **Historical Tracking**: Complete delivery logs and statistics

### Rule Engine
- **Flexible Conditions**: Simple comparisons, percentage changes, timeframe-based
- **Composite Rules**: Combine multiple conditions with AND/OR/NOT
- **Per-Token Cooldowns**: Prevent alert spam for the same token
- **Hourly Rate Limits**: Control maximum alerts per hour per rule
- **Custom Message Templates**: Personalize alert messages
- **Tag-Based Organization**: Categorize rules for easy management

## 📁 Architecture

```
apps/bot/src/
├── alerts/
│   ├── RuleEngine.ts           # Rule evaluation engine
│   ├── Dispatcher.ts           # Routes rules to channels
│   ├── AlertSystem.ts          # Main integration layer
│   ├── templates/              # Message formatters
│   │   ├── formatForTelegram.ts
│   │   └── index.ts
│   └── examples/               # Usage examples
│       └── setup.example.ts
├── services/alerts/
│   ├── AlertManager.ts         # Alert orchestration
│   ├── DeliveryManager.ts      # Delivery tracking & retry
│   ├── AlertRouter.ts          # Channel routing logic
│   ├── AlertDeduplicator.ts    # Duplicate detection
│   ├── AlertBatcher.ts         # Alert batching
│   ├── types.ts                # Type definitions
│   └── channels/               # Channel implementations
│       ├── BaseChannel.ts
│       ├── TelegramChannel.ts
│       ├── DiscordChannel.ts
│       ├── EmailChannel.ts
│       └── WebSocketChannel.ts
└── telegram/commands/
    └── alertrules.ts           # Telegram commands for rules
```

## 🚀 Quick Start

### 1. Environment Setup

Add to your `.env`:

```bash
# Required: Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Optional: Discord
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_USERNAME=Solana Bot

# Optional: Email (SendGrid or Resend)
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=your_api_key
SENDGRID_FROM_EMAIL=alerts@yourdomain.com
SENDGRID_TO_EMAIL=your@email.com

# Optional: WebSocket
WEBSOCKET_PORT=8080
WEBSOCKET_PATH=/alerts
```

### 2. Initialize Alert System

```typescript
import { initializeAlertSystem } from './alerts/AlertSystem';
import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

const alertSystem = await initializeAlertSystem({
  // Deduplication
  enableDeduplication: true,
  dedupWindowMs: 5 * 60 * 1000, // 5 minutes

  // Batching
  enableBatching: true,
  batchWindowMs: 30 * 1000, // 30 seconds

  // Channels
  telegram: {
    bot,
    defaultChatId: process.env.TELEGRAM_CHAT_ID,
  },
  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL,
  },
  email: {
    provider: 'sendgrid',
    apiKey: process.env.SENDGRID_API_KEY!,
    fromEmail: process.env.SENDGRID_FROM_EMAIL!,
    toEmail: process.env.SENDGRID_TO_EMAIL!,
  },
  websocket: {
    port: 8080,
    path: '/alerts',
  },
});
```

### 3. Create Alert Rules

```typescript
// High liquidity new tokens
const rule = alertSystem.createRule({
  name: 'High Liquidity New Token',
  description: 'Alert when a new token launches with >$50K liquidity',
  enabled: true,
  rootCondition: {
    id: 'root',
    type: 'simple',
    field: 'liquidity',
    operator: '>=',
    value: 50000,
  },
  priority: 'high',
  channels: ['telegram-default', 'discord-default'],
  cooldownSeconds: 300,
  maxAlertsPerHour: 10,
  createdBy: userId,
  tags: ['discovery', 'liquidity'],
  metadata: {},
});
```

### 4. Evaluate Tokens

```typescript
const results = await alertSystem.evaluateToken({
  tokenMint: 'TokenAddress123...',
  symbol: 'TOKEN',
  currentData: {
    price: 0.001,
    liquidity: 75000,
    volume24h: 50000,
    holders: 150,
  },
  timestamp: Date.now(),
});

// Alerts are automatically dispatched for matched rules
```

## 📋 Rule Types

### Simple Condition
Direct field comparison:

```typescript
{
  type: 'simple',
  field: 'liquidity',
  operator: '>=',
  value: 50000
}
```

**Operators**: `>`, `<`, `>=`, `<=`, `==`, `!=`, `contains`, `not_contains`, `in`, `not_in`

### Percent Condition
Percentage change over time:

```typescript
{
  type: 'percent',
  field: 'price',
  operator: 'percent_increase',
  threshold: 50,
  timeframe: '15m'
}
```

**Operators**: `percent_increase`, `percent_decrease`, `percent_change_abs`  
**Timeframes**: `1m`, `5m`, `15m`, `1h`, `24h`

### Timeframe Condition
Absolute change over time:

```typescript
{
  type: 'timeframe',
  field: 'liquidity',
  operator: 'change_5m',
  compareOperator: '>',
  value: 10000
}
```

### Composite Condition
Combine multiple conditions:

```typescript
{
  type: 'composite',
  combinator: 'AND',
  conditions: [
    { type: 'simple', field: 'liquidity', operator: '>=', value: 50000 },
    { type: 'simple', field: 'holders', operator: '>', value: 100 }
  ]
}
```

**Combinators**: `AND`, `OR`, `NOT`

## 🔌 Channels

### Telegram
- **Format**: Markdown with emojis
- **Features**: Threading support, inline buttons
- **Rate Limit**: 20/min, 100/hour
- **Status**: ✅ Fully implemented

### Discord
- **Format**: Rich embeds with colors
- **Features**: Webhook-based, custom avatar/username
- **Rate Limit**: 5/min, 30/hour
- **Status**: ✅ Fully implemented

### Email
- **Format**: HTML with styled templates
- **Providers**: SendGrid, Resend
- **Rate Limit**: 2/min, 10/hour
- **Status**: ✅ Fully implemented

### WebSocket
- **Format**: JSON payloads
- **Features**: Real-time frontend updates, ping/pong
- **Rate Limit**: None
- **Status**: ✅ Fully implemented

### SMS (Future)
- **Provider**: Twilio
- **Status**: ⏳ Planned

## 📱 Telegram Commands

### Rule Management
- `/alertrule` - Open rules manager
- `/alertrule_list` - List all your rules
- `/alertrule_info <id>` - Show rule details
- `/alertrule_toggle <id>` - Enable/disable rule
- `/alertrule_delete <id>` - Delete rule
- `/alertrule_test <id>` - Test rule delivery

### Quick Templates
- `/create_high_liquidity <amount>` - High liquidity alert
- `/create_price_spike <percent>` - Price spike alert
- `/create_smart_money <count>` - Smart money activity

## 🗄️ Database Schema

### Tables Created
1. **alert_rules** - Store user-defined rules
2. **alert_delivery_log** - Track delivery status per channel
3. **user_channel_preferences** - User channel configs
4. **alert_dedup_cache** - Temporary deduplication cache
5. **alert_batches** - Track batched alerts

### Migration
```typescript
import { applyAlertRulesSchema } from './database/migrations/alert_rules_schema';
import { database } from './database';

const db = database.getDb();
applyAlertRulesSchema(db);
```

## 📊 Statistics

Get system stats:

```typescript
const stats = alertSystem.getStats();
console.log(stats);

// Output:
{
  rules: {
    total: 5,
    enabled: 4,
    disabled: 1
  },
  dispatcher: {
    totalDispatches: 120,
    uniqueTokens: 45,
    uniqueRules: 4
  },
  alerts: {
    totalAlerts: 120,
    deduplicated: 15,
    batched: 8,
    sent: 112,
    failed: 3
  },
  channels: [
    { id: 'telegram-default', name: 'Telegram', type: 'telegram' },
    { id: 'discord-default', name: 'Discord', type: 'discord' }
  ]
}
```

## 🔄 Export/Import Rules

```typescript
// Export rules to JSON
const rules = alertSystem.exportRules();
await fs.writeFile('rules.json', JSON.stringify(rules, null, 2));

// Import rules from JSON
const rules = JSON.parse(await fs.readFile('rules.json', 'utf-8'));
alertSystem.importRules(rules);
```

## 🛠️ Advanced Configuration

### Custom Deduplication
```typescript
const alertSystem = await initializeAlertSystem({
  enableDeduplication: true,
  dedupWindowMs: 10 * 60 * 1000, // 10 minutes
});
```

### Custom Batching
```typescript
const alertSystem = await initializeAlertSystem({
  enableBatching: true,
  batchWindowMs: 60 * 1000, // 1 minute
});
```

### Custom Retry Logic
```typescript
const alertSystem = await initializeAlertSystem({
  maxRetries: 5,
  initialRetryDelayMs: 2000, // 2 seconds
});
```

## 🧪 Testing

Test a rule without triggering actual evaluation:

```typescript
const result = await alertSystem.testRule(ruleId, {
  tokenMint: 'TEST123',
  symbol: 'TEST',
  currentData: {
    price: 0.005,
    liquidity: 100000,
  },
});

console.log(result.dispatched); // true/false
console.log(result.channels); // ['telegram-default', 'discord-default']
console.log(result.errors); // []
```

## 🔒 Security

### API Keys
- Store all API keys in environment variables
- Never commit `.env` file
- Use separate keys for production/development

### Rate Limiting
- Respect channel-specific rate limits
- Built-in exponential backoff
- Graceful degradation on failures

### Channel Isolation
- One channel failure doesn't affect others
- Each channel has independent retry logic
- Comprehensive error tracking

## 🐛 Troubleshooting

### Alerts Not Sending
1. Check rule is enabled: `/alertrule_info <id>`
2. Verify cooldown hasn't expired
3. Check channel configuration in `.env`
4. Test delivery: `/alertrule_test <id>`
5. Review delivery logs in database

### Discord Rate Limited
- Check `DISCORD_WEBHOOK_URL` is valid
- Reduce `maxAlertsPerHour` for rules
- Enable batching to group alerts

### Email Not Delivering
- Verify API key is correct
- Check sender email is verified
- Review SendGrid/Resend dashboard
- Test with simple rule first

## 📈 Performance

- **Throughput**: 1000+ alerts/minute (batched)
- **Latency**: <100ms evaluation, <500ms delivery
- **Memory**: ~50MB for 1000 active rules
- **Database**: Indexes on all lookups

## 🔮 Future Enhancements

- [ ] Interactive rule builder UI
- [ ] SMS channel via Twilio
- [ ] Webhook channel templates
- [ ] Machine learning-based deduplication
- [ ] Multi-language support
- [ ] Mobile push notifications
- [ ] Slack integration
- [ ] Microsoft Teams integration

## 📚 Examples

See `apps/bot/src/alerts/examples/setup.example.ts` for complete examples.

## 🤝 Contributing

When adding new features:
1. Follow TypeScript best practices
2. Add comprehensive tests
3. Update documentation
4. Maintain backward compatibility
5. Handle errors gracefully

## 📄 License

Part of Solana Memecoin Bot - All rights reserved
