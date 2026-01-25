# API Examples

Complete code examples for using the Solana Memecoin Bot API.

## Table of Contents

- [JavaScript/TypeScript](#javascripttypescript)
- [Python](#python)
- [cURL](#curl)
- [WebSocket Examples](#websocket-examples)

## JavaScript/TypeScript

### Basic Setup

```typescript
const API_KEY = 'sk_live_your_api_key_here';
const BASE_URL = 'http://localhost:3001/api/v1';

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json'
};
```

### Get Tokens List

```typescript
async function getTokens(page = 1, limit = 20, filters = {}) {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    ...filters
  });

  const response = await fetch(`${BASE_URL}/tokens?${params}`, {
    headers
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return await response.json();
}

// Usage
const tokens = await getTokens(1, 20, {
  riskLevel: 'high',
  minLiquidity: '10000'
});

console.log(`Found ${tokens.pagination.total} tokens`);
tokens.data.forEach(token => {
  console.log(`${token.symbol}: Risk ${token.riskScore}/100`);
});
```

### Get Token Details

```typescript
async function getToken(mint: string) {
  const response = await fetch(`${BASE_URL}/tokens/${mint}`, {
    headers
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return await response.json();
}

// Usage
const token = await getToken('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
console.log(token.data);
```

### Create Alert Rule

```typescript
async function createAlertRule(rule: {
  name: string;
  conditions: any;
  webhookUrl?: string;
}) {
  const response = await fetch(`${BASE_URL}/alerts/rules`, {
    method: 'POST',
    headers,
    body: JSON.stringify(rule)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return await response.json();
}

// Usage
const alert = await createAlertRule({
  name: 'High Risk Tokens',
  conditions: {
    minRiskScore: 80,
    minLiquidity: 5000
  },
  webhookUrl: 'https://your-webhook.com/alerts'
});

console.log('Created alert:', alert.data.id);
```

## Python

### Basic Setup

```python
import requests
from typing import Dict, List, Optional

API_KEY = 'sk_live_your_api_key_here'
BASE_URL = 'http://localhost:3001/api/v1'

headers = {
    'Authorization': f'Bearer {API_KEY}',
    'Content-Type': 'application/json'
}
```

### Get Tokens List

```python
def get_tokens(page: int = 1, limit: int = 20, **filters) -> Dict:
    params = {
        'page': page,
        'limit': limit,
        **filters
    }
    
    response = requests.get(
        f'{BASE_URL}/tokens',
        headers=headers,
        params=params
    )
    response.raise_for_status()
    
    return response.json()

# Usage
tokens = get_tokens(
    page=1,
    limit=20,
    riskLevel='high',
    minLiquidity='10000'
)

print(f"Found {tokens['pagination']['total']} tokens")
for token in tokens['data']:
    print(f"{token['symbol']}: Risk {token['riskScore']}/100")
```

### Get Pattern Detection

```python
def get_patterns(mint: Optional[str] = None, page: int = 1, limit: int = 20) -> Dict:
    url = f'{BASE_URL}/patterns'
    if mint:
        url = f'{BASE_URL}/patterns/{mint}'
    
    response = requests.get(
        url,
        headers=headers,
        params={'page': page, 'limit': limit}
    )
    response.raise_for_status()
    
    return response.json()

# Usage
patterns = get_patterns(page=1, limit=10, minConfidence='0.8')

for pattern in patterns['data']:
    print(f"{pattern['symbol']}: {pattern['pattern']} ({pattern['confidence']:.2%} confidence)")
```

### Smart Money Wallets

```python
def get_smart_money_wallets(page: int = 1, limit: int = 20) -> Dict:
    response = requests.get(
        f'{BASE_URL}/smart-money',
        headers=headers,
        params={'page': page, 'limit': limit}
    )
    response.raise_for_status()
    
    return response.json()

# Usage
wallets = get_smart_money_wallets()

for wallet in wallets['data']:
    print(f"Wallet: {wallet['address']}")
    print(f"  Total Profit: ${wallet['totalProfitUsd']:,.2f}")
    print(f"  Win Rate: {wallet['winRate']:.1%}")
    print()
```

## cURL

### Get Tokens

```bash
curl -H "Authorization: Bearer sk_live_your_api_key_here" \
  "http://localhost:3001/api/v1/tokens?page=1&limit=20&riskLevel=high"
```

### Get Token Details

```bash
curl -H "Authorization: Bearer sk_live_your_api_key_here" \
  "http://localhost:3001/api/v1/tokens/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
```

### Create Alert Rule

```bash
curl -X POST "http://localhost:3001/api/v1/alerts/rules" \
  -H "Authorization: Bearer sk_live_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "High Risk Alert",
    "conditions": {
      "minRiskScore": 80,
      "minLiquidity": 5000
    },
    "webhookUrl": "https://your-webhook.com/alerts",
    "isActive": true
  }'
```

### Generate API Key (Admin)

```bash
curl -X POST "http://localhost:3001/api/v1/admin/keys" \
  -H "x-admin-key: your_admin_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production API Key",
    "rateLimit": 120,
    "expiresInDays": 365
  }'
```

## WebSocket Examples

### Node.js

```javascript
const WebSocket = require('ws');

const API_KEY = 'sk_live_your_api_key_here';
const ws = new WebSocket('ws://localhost:3001/ws');

ws.on('open', () => {
  console.log('Connected to WebSocket');
  
  // Authenticate
  ws.send(JSON.stringify({
    type: 'auth',
    data: { apiKey: API_KEY }
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  
  console.log('Received:', message.type);
  
  if (message.type === 'heartbeat' && message.data.authenticated) {
    console.log('Authenticated!');
    
    // Subscribe to channels
    ws.send(JSON.stringify({
      type: 'subscribe',
      data: { channels: ['tokens', 'patterns', 'alerts'] }
    }));
  }
  
  if (message.type === 'token_update') {
    console.log('New token:', message.data);
  }
  
  if (message.type === 'pattern_detected') {
    console.log('Pattern detected:', message.data);
  }
  
  if (message.type === 'alert') {
    console.log('Alert:', message.data);
  }
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

ws.on('close', () => {
  console.log('Disconnected from WebSocket');
});
```

### Python (websockets library)

```python
import asyncio
import websockets
import json

API_KEY = 'sk_live_your_api_key_here'
WS_URL = 'ws://localhost:3001/ws'

async def listen():
    async with websockets.connect(WS_URL) as websocket:
        # Authenticate
        await websocket.send(json.dumps({
            'type': 'auth',
            'data': {'apiKey': API_KEY}
        }))
        
        async for message in websocket:
            data = json.loads(message)
            
            print(f"Received: {data['type']}")
            
            if data['type'] == 'heartbeat' and data['data'].get('authenticated'):
                print('Authenticated!')
                
                # Subscribe to channels
                await websocket.send(json.dumps({
                    'type': 'subscribe',
                    'data': {'channels': ['tokens', 'patterns', 'alerts']}
                }))
            
            elif data['type'] == 'token_update':
                print(f"New token: {data['data']}")
            
            elif data['type'] == 'pattern_detected':
                print(f"Pattern detected: {data['data']}")
            
            elif data['type'] == 'alert':
                print(f"Alert: {data['data']}")

# Run
asyncio.get_event_loop().run_until_complete(listen())
```

### Browser JavaScript

```html
<!DOCTYPE html>
<html>
<head>
  <title>WebSocket Example</title>
</head>
<body>
  <div id="status">Connecting...</div>
  <div id="messages"></div>
  
  <script>
    const API_KEY = 'sk_live_your_api_key_here';
    const ws = new WebSocket('ws://localhost:3001/ws');
    
    const statusEl = document.getElementById('status');
    const messagesEl = document.getElementById('messages');
    
    ws.onopen = () => {
      statusEl.textContent = 'Connected';
      
      // Authenticate
      ws.send(JSON.stringify({
        type: 'auth',
        data: { apiKey: API_KEY }
      }));
    };
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === 'heartbeat' && message.data.authenticated) {
        statusEl.textContent = 'Authenticated';
        
        // Subscribe
        ws.send(JSON.stringify({
          type: 'subscribe',
          data: { channels: ['tokens', 'patterns', 'alerts'] }
        }));
      }
      
      // Display message
      const div = document.createElement('div');
      div.textContent = `[${message.type}] ${JSON.stringify(message.data)}`;
      messagesEl.appendChild(div);
    };
    
    ws.onclose = () => {
      statusEl.textContent = 'Disconnected';
    };
    
    ws.onerror = (error) => {
      statusEl.textContent = 'Error: ' + error;
    };
  </script>
</body>
</html>
```

## Error Handling

### TypeScript

```typescript
async function apiRequest(url: string, options: RequestInit = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`API Error: ${error.message}`);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof Error) {
      console.error('API request failed:', error.message);
    }
    throw error;
  }
}
```

### Python

```python
def api_request(method: str, endpoint: str, **kwargs) -> Dict:
    url = f'{BASE_URL}/{endpoint}'
    
    try:
        response = requests.request(
            method,
            url,
            headers=headers,
            **kwargs
        )
        response.raise_for_status()
        return response.json()
    
    except requests.exceptions.HTTPError as e:
        print(f'API Error: {e.response.status_code}')
        print(e.response.json())
        raise
    
    except requests.exceptions.RequestException as e:
        print(f'Request failed: {e}')
        raise
```
