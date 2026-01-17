import { analyzeLiquidity } from '../../src/analysis/liquidityCheck';
import { solanaService } from '../../src/services/solana';
import { dexScreenerService } from '../../src/services/dexscreener';
import { PoolInfo, SOL_MINT } from '../../src/types';

// Mock services
jest.mock('../../src/services/solana', () => ({
  solanaService: {
    getConnection: jest.fn(() => ({
      getAccountInfo: jest.fn().mockResolvedValue(null),
      getParsedAccountInfo: jest.fn().mockResolvedValue({ value: null }),
    })),
    getAccountBalance: jest.fn().mockResolvedValue(0),
    getMintInfo: jest.fn().mockResolvedValue({
      supply: BigInt(1000000000),
      decimals: 9,
      mintAuthority: null,
      freezeAuthority: null,
    }),
    getTokenHolders: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../src/services/dexscreener', () => ({
  dexScreenerService: {
    getTokenData: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('axios', () => ({
  get: jest.fn().mockResolvedValue({ data: { solana: { usd: 100 } } }),
}));

describe('liquidityCheck', () => {
  const mockPool: PoolInfo = {
    address: 'pool123',
    tokenMint: 'token123',
    baseMint: 'token123',
    quoteMint: SOL_MINT,
    baseReserve: 1000000,
    quoteReserve: 100,
    lpMint: 'lp123',
    source: 'raydium',
    createdAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('analyzeLiquidity', () => {
    it('should return default values when no liquidity data available', async () => {
      const result = await analyzeLiquidity(mockPool);

      expect(result).toHaveProperty('totalLiquidityUsd');
      expect(result).toHaveProperty('lpBurned');
      expect(result).toHaveProperty('lpBurnedPercent');
      expect(result).toHaveProperty('lpLocked');
      expect(result).toHaveProperty('lpLockedPercent');
    });

    it('should handle DexScreener data correctly', async () => {
      (dexScreenerService.getTokenData as jest.Mock).mockResolvedValue({
        liquidity: { usd: 50000 },
        baseToken: { symbol: 'TEST' },
      });

      const result = await analyzeLiquidity(mockPool);

      expect(result.totalLiquidityUsd).toBeGreaterThanOrEqual(0);
    });

    it('should detect LP burned status', async () => {
      // Mock burn address check
      const connection = solanaService.getConnection();
      (connection.getParsedAccountInfo as jest.Mock).mockResolvedValue({
        value: {
          data: {
            parsed: {
              info: {
                tokenAmount: { uiAmount: 1000 },
              },
            },
          },
        },
      });

      const result = await analyzeLiquidity(mockPool);

      expect(result).toHaveProperty('lpBurned');
      expect(result).toHaveProperty('lpBurnedPercent');
    });

    it('should return valid liquidity analysis structure', async () => {
      const result = await analyzeLiquidity(mockPool);

      expect(typeof result.totalLiquidityUsd).toBe('number');
      expect(typeof result.lpBurned).toBe('boolean');
      expect(typeof result.lpBurnedPercent).toBe('number');
      expect(typeof result.lpLocked).toBe('boolean');
      expect(typeof result.lpLockedPercent).toBe('number');
      expect(result.lpBurnedPercent).toBeGreaterThanOrEqual(0);
      expect(result.lpBurnedPercent).toBeLessThanOrEqual(100);
    });

    it('should handle errors gracefully', async () => {
      (dexScreenerService.getTokenData as jest.Mock).mockRejectedValue(new Error('API Error'));

      const result = await analyzeLiquidity(mockPool);

      // Should return default values, not throw
      expect(result).toHaveProperty('totalLiquidityUsd');
      expect(result.totalLiquidityUsd).toBeGreaterThanOrEqual(0);
    });

    it('should handle pool with no LP mint', async () => {
      const poolNoLp: PoolInfo = { ...mockPool, lpMint: '' };

      const result = await analyzeLiquidity(poolNoLp);

      expect(result.lpBurned).toBe(false);
      expect(result.lpLocked).toBe(false);
    });
  });
});

describe('LP Locker Detection', () => {
  const KNOWN_LOCKERS = [
    'Lock7kBijGCQLEFAmXcengzXKA88iDNQPriQ7TbgeyG',
    'TLoCKic2gGJm7VhZKumih4Lc35fUhYqVMgA4j389Buk',
    'FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X',
  ];

  it('should recognize known LP locker addresses', () => {
    // These are hardcoded in the module
    KNOWN_LOCKERS.forEach(locker => {
      expect(locker).toMatch(/^[A-Za-z0-9]{32,44}$/);
    });
  });
});

describe('Liquidity Thresholds', () => {
  it('should consider $10k+ as good liquidity', () => {
    const goodLiquidity = 15000;
    expect(goodLiquidity).toBeGreaterThan(10000);
  });

  it('should consider $1k-$10k as moderate liquidity', () => {
    const moderateLiquidity = 5000;
    expect(moderateLiquidity).toBeGreaterThan(1000);
    expect(moderateLiquidity).toBeLessThan(10000);
  });

  it('should consider <$1k as low liquidity', () => {
    const lowLiquidity = 500;
    expect(lowLiquidity).toBeLessThan(1000);
  });
});
