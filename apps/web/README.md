# Solana Memecoin Bot - Web Dashboard

Production-ready React dashboard for monitoring Solana memecoin launches with AI-powered pattern detection and smart money tracking.

## 🎨 Features

- **Live Token Feed** - Real-time token discovery with filtering and sorting
- **Full Token Analysis** - Comprehensive risk analysis, liquidity, holder distribution
- **Pattern Detection** - AI-learned patterns from historical data
- **Smart Money Tracking** - Follow profitable wallets and their trades
- **Alert System** - Customizable alert rules with multi-channel notifications
- **Real-time Updates** - WebSocket integration for live data

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Backend API server running (see `apps/bot`)

### Installation

```bash
# From the web directory
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your API URL
# VITE_API_URL=http://localhost:3000
# VITE_WS_URL=ws://localhost:3000/ws
```

### Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### Build

```bash
npm run build
npm run preview  # Preview production build
```

## 📁 Project Structure

```
src/
├── api/              # API client & endpoints
│   ├── client.ts     # Axios instance
│   ├── tokens.ts     # Token endpoints
│   ├── patterns.ts   # Pattern endpoints
│   ├── smartMoney.ts # Smart money endpoints
│   └── alerts.ts     # Alert endpoints
├── components/       # React components
│   ├── Navbar.tsx
│   ├── TokenCard.tsx
│   ├── PriceChart.tsx
│   ├── RiskBadge.tsx
│   ├── PatternIndicators.tsx
│   ├── SmartMoneyTable.tsx
│   ├── AlertRuleCard.tsx
│   ├── AlertRuleBuilder.tsx
│   └── LoadingSpinner.tsx
├── pages/            # Route pages
│   ├── Home.tsx           # Token feed
│   ├── TokenDetail.tsx    # Token analysis
│   ├── SmartMoney.tsx     # Wallet tracking
│   ├── Patterns.tsx       # Pattern detection
│   ├── Alerts.tsx         # Alert management
│   └── Settings.tsx       # User settings
├── hooks/            # Custom React hooks
│   ├── useTokens.ts       # Token data
│   ├── usePatterns.ts     # Pattern data
│   ├── useSmartMoney.ts   # Smart money data
│   ├── useAlerts.ts       # Alert data
│   └── useWebSocket.ts    # Real-time updates
├── store/            # Zustand state management
│   └── index.ts
├── types/            # TypeScript types
│   └── index.ts
├── utils/            # Utility functions
│   ├── cn.ts         # Class name utility
│   └── format.ts     # Formatting helpers
├── App.tsx           # Main app with routing
└── main.tsx          # Entry point
```

## 🛠️ Tech Stack

- **Framework**: React 18 + TypeScript
- **Routing**: React Router v6
- **State**: Zustand + React Query
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Icons**: Lucide React
- **HTTP**: Axios
- **Build**: Vite

## 🔌 API Integration

The dashboard expects the following backend endpoints:

### Tokens
- `GET /api/tokens` - List tokens
- `GET /api/tokens/:mint` - Token detail
- `GET /api/tokens/:mint/price-history` - Price data
- `POST /api/tokens/:mint/refresh` - Refresh analysis

### Patterns
- `GET /api/patterns` - List patterns
- `GET /api/patterns/:mint` - Token patterns
- `POST /api/patterns/discover` - Trigger discovery

### Smart Money
- `GET /api/smart-money` - List wallets
- `GET /api/smart-money/:wallet` - Wallet detail
- `GET /api/smart-money/:wallet/trades` - Wallet trades
- `GET /api/smart-money/activity` - Recent activity

### Alerts
- `GET /api/alerts` - List alerts
- `GET /api/alerts/rules` - List rules
- `POST /api/alerts/rules` - Create rule
- `PUT /api/alerts/rules/:id` - Update rule
- `DELETE /api/alerts/rules/:id` - Delete rule

See `../bot/API_ENDPOINTS_NEEDED.md` for complete API documentation.

## 🎨 Design System

### Colors
- **Primary**: Blue (`#3b82f6`)
- **Success**: Green (`#22c55e`)
- **Warning**: Yellow (`#eab308`)
- **Danger**: Red (`#ef4444`)
- **Background**: Gray-950 (`#030712`)

### Typography
- **Font**: Inter (sans-serif)
- **Mono**: JetBrains Mono

### Components
All components follow a consistent dark theme with:
- Rounded corners (8-12px)
- Subtle borders and shadows
- Hover states with transitions
- Mobile-first responsive design

## 📱 Responsive Design

The dashboard is fully responsive:
- **Mobile**: Single column, stacked layouts
- **Tablet**: 2-column grids
- **Desktop**: 3-4 column grids with sidebars

## 🔧 Configuration

### Environment Variables

```env
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000/ws
```

### Vite Proxy

The dev server proxies `/api` and `/ws` to the backend:

```typescript
server: {
  proxy: {
    '/api': 'http://localhost:3000',
    '/ws': { target: 'ws://localhost:3000', ws: true }
  }
}
```

## 🧪 Development Tips

### React Query DevTools

Uncomment in `App.tsx`:

```typescript
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

<ReactQueryDevtools initialIsOpen={false} />
```

### Hot Reload

Vite provides instant HMR. Changes reflect immediately.

### Type Safety

All API responses are typed. Use TypeScript for autocomplete and type checking.

## 🚀 Deployment

### Build for Production

```bash
npm run build
```

Output: `dist/`

### Serve Static Files

```bash
# Preview locally
npm run preview

# Or use any static server
npx serve -s dist
```

### Environment Variables

Set production API URLs:

```env
VITE_API_URL=https://api.yourdomain.com
VITE_WS_URL=wss://api.yourdomain.com/ws
```

## 📊 Performance

- Code splitting with manual chunks
- Lazy loading for routes
- Optimized bundle size (~200KB gzipped)
- React Query caching for reduced API calls
- WebSocket for real-time updates (no polling)

## 🎯 Best Practices

1. **API Calls**: Always use React Query hooks
2. **State**: Use Zustand for global state, React Query for server state
3. **Styling**: Use Tailwind utilities, `cn()` for conditional classes
4. **Types**: Import from `@/types`
5. **Formatting**: Use helpers from `@/utils/format`

## 🐛 Troubleshooting

### API Connection Failed

1. Check backend is running on port 3000
2. Verify `.env` has correct API URL
3. Check browser console for CORS errors

### WebSocket Not Connecting

1. Ensure backend WebSocket server is running
2. Check firewall isn't blocking WS connections
3. Verify `VITE_WS_URL` is correct

### Build Errors

1. Run `npm install` to ensure all deps are installed
2. Delete `node_modules` and reinstall if needed
3. Check TypeScript errors: `npx tsc --noEmit`

## 📝 License

MIT

## 🤝 Contributing

See main project README for contribution guidelines.
