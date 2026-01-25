# Solana Memecoin Bot API

Production-ready REST + WebSocket API for accessing Solana memecoin analysis data.

## Features

- 🔐 **API Key Authentication** - Secure bearer token authentication
- ⚡ **Rate Limiting** - Per-key rate limits (configurable)
- 📊 **Real-time Updates** - WebSocket server for live data
- 📝 **OpenAPI Documentation** - Interactive Swagger UI
- 🛡️ **Production Ready** - Error handling, logging, security headers
- 🔄 **Shared Database** - Integrates with bot's Supabase instance

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

### 3. Run Development Server

```bash
npm run dev
```

The API will be available at `http://localhost:3001`

## API Documentation

Interactive API documentation is available at `/api-docs` when the server is running:

```
http://localhost:3001/api-docs
```

## Authentication

All endpoints (except `/health`) require API key authentication via Bearer token:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3001/api/v1/tokens
```

### Generating API Keys

Use the admin endpoint to generate new API keys:

```bash
curl -X POST http://localhost:3001/api/v1/admin/keys \
  -H "Content-Type: application/json" \
  -H "x-admin-key: YOUR_ADMIN_KEY" \
  -d '{
    "name": "My App",
    "rateLimit": 60,
    "expiresInDays": 365
  }'
```

**⚠️ Important:** The API key is only shown once during creation. Store it securely!

## REST Endpoints

### Health Check
- `GET /api/v1/health` - Server health status

### Tokens
- `GET /api/v1/tokens` - List monitored tokens
- `GET /api/v1/tokens/:mint` - Get token details
- `GET /api/v1/tokens/:mint/analysis` - Get full analysis history

### Patterns
- `GET /api/v1/patterns` - Pattern detection history
- `GET /api/v1/patterns/:mint` - Patterns for specific token

### Smart Money
- `GET /api/v1/smart-money` - List smart money wallets
- `GET /api/v1/smart-money/:wallet` - Wallet details

### Alerts
- `GET /api/v1/alerts/rules` - List alert rules
- `POST /api/v1/alerts/rules` - Create alert rule
- `PUT /api/v1/alerts/rules/:id` - Update alert rule
- `DELETE /api/v1/alerts/rules/:id` - Delete alert rule

### Statistics
- `GET /api/v1/stats` - Bot statistics

## WebSocket API

Connect to `ws://localhost:3001/ws` for real-time updates.

### Connection Flow

1. **Connect** to WebSocket endpoint
2. **Authenticate** with API key
3. **Subscribe** to channels
4. **Receive** real-time updates

### Example (JavaScript)

```javascript
const ws = new WebSocket('ws://localhost:3001/ws');

ws.on('open', () => {
  // Authenticate
  ws.send(JSON.stringify({
    type: 'auth',
    data: { apiKey: 'YOUR_API_KEY' }
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data);
  console.log('Received:', message);
  
  if (message.type === 'heartbeat' && message.data.authenticated) {
    // Subscribe to channels
    ws.send(JSON.stringify({
      type: 'subscribe',
      data: { channels: ['tokens', 'patterns', 'alerts'] }
    }));
  }
});
```

### Message Types

**From Client:**
- `auth` - Authenticate with API key
- `subscribe` - Subscribe to channels
- `unsubscribe` - Unsubscribe from channels
- `ping` - Heartbeat ping

**From Server:**
- `heartbeat` - Connection status/pong
- `token_update` - New token analysis
- `pattern_detected` - Pattern detection event
- `alert` - Alert notification
- `error` - Error message

### Channels

- `tokens` - Token analysis updates
- `patterns` - Pattern detection events
- `alerts` - Alert notifications

## Rate Limiting

Default: 60 requests/minute per API key

Rate limits are enforced per API key and reset every minute. Exceeding the limit returns HTTP 429.

## Error Handling

All errors follow a consistent format:

```json
{
  "error": "Error type",
  "message": "Human-readable error message",
  "details": []
}
```

Common status codes:
- `400` - Bad Request (validation error)
- `401` - Unauthorized (missing/invalid API key)
- `404` - Not Found
- `429` - Rate Limit Exceeded
- `500` - Internal Server Error

## Examples

### Python

```python
import requests

API_KEY = "your_api_key_here"
BASE_URL = "http://localhost:3001/api/v1"

headers = {
    "Authorization": f"Bearer {API_KEY}"
}

# Get tokens
response = requests.get(f"{BASE_URL}/tokens", headers=headers)
print(response.json())

# Get specific token
mint = "TokenMintAddress123..."
response = requests.get(f"{BASE_URL}/tokens/{mint}", headers=headers)
print(response.json())
```

### cURL

```bash
# List tokens
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:3001/api/v1/tokens?page=1&limit=20"

# Get token details
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:3001/api/v1/tokens/MINT_ADDRESS"

# Create alert rule
curl -X POST "http://localhost:3001/api/v1/alerts/rules" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "High Risk Alert",
    "conditions": {
      "minRiskScore": 80
    },
    "webhookUrl": "https://your-webhook.com/alerts"
  }'
```

### JavaScript/TypeScript

```typescript
const API_KEY = 'your_api_key_here';
const BASE_URL = 'http://localhost:3001/api/v1';

async function getTokens() {
  const response = await fetch(`${BASE_URL}/tokens`, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`
    }
  });
  
  return await response.json();
}

async function getToken(mint: string) {
  const response = await fetch(`${BASE_URL}/tokens/${mint}`, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`
    }
  });
  
  return await response.json();
}
```

## Production Deployment

### Environment Variables

Ensure these are set in production:

```bash
NODE_ENV=production
API_PORT=3001
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
ADMIN_API_KEY=strong-random-key
CORS_ORIGIN=https://yourdomain.com
LOG_LEVEL=info
```

### Build

```bash
npm run build
```

### Start

```bash
npm start
```

### Docker

```bash
docker build -t memecoin-api .
docker run -p 3001:3001 --env-file .env memecoin-api
```

## Security

- API keys are hashed with bcrypt before storage
- Rate limiting per API key
- Helmet.js for security headers
- CORS configuration
- Request validation with Zod
- Secure WebSocket authentication

## Database Schema

The API uses the same Supabase database as the bot. Additional tables for API functionality:

- `api_keys` - API key storage (hashed)
- `api_usage` - Usage tracking for rate limiting
- `alert_rules` - User-defined alert rules

## Support

For issues or questions, please open an issue on GitHub.
