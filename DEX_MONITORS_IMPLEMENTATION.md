# Meteora + Orca DEX Monitors Implementation

## Summary

Successfully implemented monitoring for **Meteora DLMM** and **Orca Whirlpool** DEXs, expanding the bot's token discovery from 3 to 5 DEX sources.

---

## What Was Added

### 1. Meteora DLMM Monitor (`apps/bot/src/monitors/meteora.ts`)
- **API**: `https://dlmm-api.meteora.ag/pair/all`
- **Pool Type**: DLMM (Dynamic Liquidity Market Maker) - concentrated liquidity
- **Polling Interval**: 15 seconds (configurable)
- **Features**:
  - Fetches all active pairs from Meteora's DLMM API
  - Filters for SOL pairs
  - Tracks new pair discoveries
  - Circuit breaker for API failures (opens after 5 failures)
  - Automatic retry with exponential backoff
  - Health monitoring and auto-recovery
  - Graceful degradation with fallback endpoints

### 2. Orca Whirlpool Monitor (`apps/bot/src/monitors/orca.ts`)
- **API**: `https://api.mainnet.orca.so/v1/whirlpool/list`
- **Pool Type**: Whirlpool - concentrated liquidity market maker (CLMM)
- **Polling Interval**: 15 seconds (configurable)
- **Features**:
  - Fetches all Whirlpool pools from Orca's API
  - Filters for SOL pairs
  - Tracks new pool discoveries
  - Circuit breaker for API failures (opens after 5 failures)
  - Automatic retry with exponential backoff
  - Health monitoring and auto-recovery
  - Graceful degradation with fallback endpoints

---

## Architecture Pattern

Both monitors follow the established pattern used by existing monitors (Raydium, Pump.fun, Jupiter):

```typescript
class Monitor extends EventEmitter {
  // Circuit breaker for resilience
  private circuitBreaker: CircuitBreaker;
  
  // Health monitoring
  private health: HealthStatus;
  
  // Known items tracking (deduplication)
  private knownItems: Set<string>;
  
  // Core methods
  async start()
  async stop()
  private async syncKnown() 
  private async checkNew()
  
  // Health methods
  isHealthy(): boolean
  getHealth(): HealthStatus
  resetCircuitBreaker()
  
  // Auto-recovery
  private async attemptAutoRecovery()
}
```

---

## Configuration

### Environment Variables (`.env`)
```env
# Enable/disable monitors
METEORA_ENABLED=true
ORCA_ENABLED=true

# Poll intervals (milliseconds)
METEORA_POLL_INTERVAL=15000
ORCA_POLL_INTERVAL=15000
```

### Configuration File (`apps/bot/src/config.ts`)
```typescript
monitors: {
  meteora: {
    enabled: getEnvBoolean('METEORA_ENABLED', true),
    pollInterval: getEnvNumber('METEORA_POLL_INTERVAL', 15000),
  },
  orca: {
    enabled: getEnvBoolean('ORCA_ENABLED', true),
    pollInterval: getEnvNumber('ORCA_POLL_INTERVAL', 15000),
  },
}
```

---

## Integration Points

### 1. Event Wiring (`apps/bot/src/core/eventWiring.ts`)
Both monitors emit `newPool` events that are automatically queued for analysis:

```typescript
meteoraMonitor.on('newPool', (pool: PoolInfo) => {
  void queueProcessor.queueAnalysis(pool);
});

orcaMonitor.on('newPool', (pool: PoolInfo) => {
  void queueProcessor.queueAnalysis(pool);
});
```

### 2. Main Bot (`apps/bot/src/index.ts`)
- Monitors are started conditionally based on config
- Monitors are stopped gracefully on shutdown

### 3. Type System (`apps/bot/src/types/index.ts`)
Updated `PoolInfo.source` to include:
```typescript
source: 'raydium' | 'pumpfun' | 'pumpswap' | 'jupiter' | 'meteora' | 'orca'
```

---

## Telegram Commands

### `/meteora`
Shows Meteora DLMM monitor status:
- Active/Degraded/Stopped status
- Known pair count
- Last successful sync time
- Health warnings (failures, errors)

### `/orca`
Shows Orca Whirlpool monitor status:
- Active/Degraded/Stopped status
- Known pool count
- Last successful sync time
- Health warnings (failures, errors)

### `/dex_stats`
Comprehensive comparison of all DEX monitors:
- Status indicators for all DEXs
- Item counts where applicable
- Active vs. healthy comparison
- Summary statistics

---

## API Documentation

### Meteora DLMM API
- **Base URL**: `https://dlmm-api.meteora.ag`
- **Endpoint**: `/pair/all`
- **Response**: Array of DLMM pairs with reserves, liquidity, volume, fees
- **Docs**: https://docs.meteora.ag/

### Orca Whirlpool API
- **Base URL**: `https://api.mainnet.orca.so`
- **Endpoint**: `/v1/whirlpool/list`
- **Response**: Object with `whirlpools` array containing pool data
- **Docs**: https://docs.orca.so/

---

## Benefits

1. **Broader Coverage**: 5 DEX sources instead of 3
2. **Concentrated Liquidity**: Both new DEXs use concentrated liquidity (more capital efficient)
3. **Early Discovery**: Catches tokens that launch on Meteora/Orca first
4. **Redundancy**: Multiple sources reduce chance of missing opportunities
5. **Future-Proof**: As SOL DeFi evolves, bot covers major concentrated liquidity protocols

---

## Performance Considerations

- **Polling**: 15-second intervals keep API load manageable
- **Circuit Breakers**: Prevent excessive retries during outages
- **Deduplication**: `knownPairs/knownPools` sets prevent re-processing
- **Caching**: Integrates with existing `tokenCache` to avoid duplicate analyses
- **Graceful Degradation**: Circuit breakers open after 5 failures, auto-recover after 5 minutes

---

## Testing Recommendations

1. **Monitor `/dex_stats`** to verify all monitors are active
2. **Check `/meteora` and `/orca`** for health status
3. **Watch logs** for "New Meteora/Orca pool detected" messages
4. **Verify alerts** are received for new tokens from these sources
5. **Test circuit breaker** by temporarily blocking APIs (should recover automatically)

---

## Future Enhancements

Potential improvements:
- [ ] Filter by minimum liquidity threshold per DEX
- [ ] Track volume trends across DEXs for the same token
- [ ] Alert on cross-DEX arbitrage opportunities
- [ ] Add historical tracking of pool creation times
- [ ] Implement DEX-specific scoring adjustments

---

## Git Commit

All changes committed to `master` with message:
```
feat: Add Meteora and Orca DEX monitoring
```

**DO NOT PUSH** to remote (as per sacred rules).

---

## Files Modified/Created

### Created:
- `apps/bot/src/monitors/meteora.ts` (11 KB)
- `apps/bot/src/monitors/orca.ts` (11 KB)
- `apps/bot/src/telegram/commands/dexstats.ts` (6.5 KB)
- `DEX_MONITORS_IMPLEMENTATION.md` (this file)

### Modified:
- `.env.example` - Added config documentation
- `README.md` - Updated feature list
- `apps/bot/src/config.ts` - Added monitor configs
- `apps/bot/src/types/index.ts` - Added DEX sources
- `apps/bot/src/index.ts` - Wired new monitors
- `apps/bot/src/core/eventWiring.ts` - Added event listeners
- `apps/bot/src/telegram/commands/basic.ts` - Updated status displays
- `apps/bot/src/telegram/commands/index.ts` - Registered new commands

---

## Completion

✅ **Task Complete**

The bot now monitors:
1. Raydium (WebSocket)
2. Pump.fun (Polling)
3. Jupiter (Polling)
4. **Meteora DLMM (Polling)** ⬅️ NEW
5. **Orca Whirlpool (Polling)** ⬅️ NEW

More opportunities = better coverage = higher chance of catching profitable tokens early! 📡
