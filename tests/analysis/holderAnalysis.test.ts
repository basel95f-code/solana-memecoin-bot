import { analyzeHolders, assessHolderRisk } from '../../src/analysis/holderAnalysis';
import { solanaService } from '../../src/services/solana';
import { TokenInfo, HolderAnalysis } from '../../src/types';

// Mock the solana service
jest.mock('../../src/services/solana', () => ({
  solanaService: {
    getTokenHolders: jest.fn(),
    getConnection: jest.fn(() => ({
      getParsedProgramAccounts: jest.fn().mockResolvedValue([]),
    })),
  },
}));

describe('holderAnalysis', () => {
  // Use valid Solana public key format for testing
  const mockToken: TokenInfo = {
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // Valid base58 pubkey (BONK)
    name: 'Test Token',
    symbol: 'TEST',
    decimals: 9,
    supply: 1000000000, // 1 billion
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('analyzeHolders', () => {
    it('should return default values when no holders found', async () => {
      (solanaService.getTokenHolders as jest.Mock).mockResolvedValue([]);

      const result = await analyzeHolders(mockToken);

      expect(result.totalHolders).toBe(0);
      expect(result.top10HoldersPercent).toBe(0);
      expect(result.isConcentrated).toBe(true);
    });

    it('should calculate holder percentages correctly', async () => {
      const mockHolders = [
        { address: 'holder1', balance: 200000000 }, // 20%
        { address: 'holder2', balance: 150000000 }, // 15%
        { address: 'holder3', balance: 100000000 }, // 10%
        { address: 'holder4', balance: 50000000 },  // 5%
        { address: 'holder5', balance: 50000000 },  // 5%
      ];
      (solanaService.getTokenHolders as jest.Mock).mockResolvedValue(mockHolders);

      const result = await analyzeHolders(mockToken);

      expect(result.largestHolderPercent).toBeCloseTo(20, 1);
      expect(result.top10HoldersPercent).toBeCloseTo(55, 1);
      expect(result.isConcentrated).toBe(true); // > 50%
    });

    it('should detect whales correctly (>5% holders)', async () => {
      const mockHolders = [
        { address: 'whale1', balance: 100000000 },   // 10%
        { address: 'whale2', balance: 60000000 },    // 6%
        { address: 'normal1', balance: 40000000 },   // 4%
        { address: 'normal2', balance: 30000000 },   // 3%
      ];
      (solanaService.getTokenHolders as jest.Mock).mockResolvedValue(mockHolders);

      const result = await analyzeHolders(mockToken);

      expect(result.whaleAddresses).toHaveLength(2);
      expect(result.whaleAddresses).toContain('whale1');
      expect(result.whaleAddresses).toContain('whale2');
    });

    it('should filter out excluded addresses', async () => {
      const mockHolders = [
        { address: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', balance: 500000000 }, // Raydium - excluded
        { address: 'holder1', balance: 200000000 },
        { address: 'holder2', balance: 100000000 },
      ];
      (solanaService.getTokenHolders as jest.Mock).mockResolvedValue(mockHolders);

      const result = await analyzeHolders(mockToken);

      // Should not include Raydium address in calculations
      expect(result.totalHolders).toBe(2);
      expect(result.whaleAddresses).not.toContain('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1');
    });

    it('should populate topHolders array with percentage info', async () => {
      const mockHolders = [
        { address: 'holder1', balance: 300000000 }, // 30%
        { address: 'holder2', balance: 200000000 }, // 20%
      ];
      (solanaService.getTokenHolders as jest.Mock).mockResolvedValue(mockHolders);

      const result = await analyzeHolders(mockToken);

      expect(result.topHolders).toHaveLength(2);
      expect(result.topHolders[0].address).toBe('holder1');
      expect(result.topHolders[0].percentage).toBeCloseTo(30, 1);
      expect(result.topHolders[1].percentage).toBeCloseTo(20, 1);
    });

    it('should handle zero supply gracefully', async () => {
      const zeroSupplyToken: TokenInfo = { ...mockToken, supply: 0 };
      (solanaService.getTokenHolders as jest.Mock).mockResolvedValue([
        { address: 'holder1', balance: 100 },
      ]);

      const result = await analyzeHolders(zeroSupplyToken);

      expect(result.totalHolders).toBe(0);
      expect(result.isConcentrated).toBe(true);
    });

    it('should mark as not concentrated when top 10 < 50%', async () => {
      const mockHolders = Array(20).fill(null).map((_, i) => ({
        address: `holder${i}`,
        balance: 40000000, // 4% each
      }));
      (solanaService.getTokenHolders as jest.Mock).mockResolvedValue(mockHolders);

      const result = await analyzeHolders(mockToken);

      expect(result.top10HoldersPercent).toBeCloseTo(40, 1);
      expect(result.isConcentrated).toBe(false);
    });
  });

  describe('assessHolderRisk', () => {
    it('should return high score for well-distributed holders', () => {
      const analysis: HolderAnalysis = {
        totalHolders: 500,
        top10HoldersPercent: 30,
        top20HoldersPercent: 40,
        largestHolderPercent: 5,
        whaleAddresses: ['whale1'],
        devWalletPercent: 5,
        isConcentrated: false,
        topHolders: [],
      };

      const result = assessHolderRisk(analysis);

      expect(result.score).toBeGreaterThan(70);
      expect(result.issues).toHaveLength(0);
    });

    it('should penalize high concentration (>80%)', () => {
      const analysis: HolderAnalysis = {
        totalHolders: 50,
        top10HoldersPercent: 85,
        top20HoldersPercent: 90,
        largestHolderPercent: 15,
        whaleAddresses: ['whale1', 'whale2', 'whale3'],
        devWalletPercent: 15,
        isConcentrated: true,
        topHolders: [],
      };

      const result = assessHolderRisk(analysis);

      expect(result.score).toBeLessThan(70);
      expect(result.issues).toContainEqual(expect.stringContaining('>80%'));
    });

    it('should penalize single large holder (>20%)', () => {
      const analysis: HolderAnalysis = {
        totalHolders: 100,
        top10HoldersPercent: 50,
        top20HoldersPercent: 60,
        largestHolderPercent: 25,
        whaleAddresses: ['whale1'],
        devWalletPercent: 25,
        isConcentrated: true,
        topHolders: [],
      };

      const result = assessHolderRisk(analysis);

      expect(result.issues).toContainEqual(expect.stringContaining('25.0%'));
    });

    it('should penalize very few holders (<10)', () => {
      const analysis: HolderAnalysis = {
        totalHolders: 5,
        top10HoldersPercent: 100,
        top20HoldersPercent: 100,
        largestHolderPercent: 50,
        whaleAddresses: ['whale1', 'whale2'],
        devWalletPercent: 50,
        isConcentrated: true,
        topHolders: [],
      };

      const result = assessHolderRisk(analysis);

      expect(result.issues).toContainEqual(expect.stringContaining('<10'));
    });

    it('should penalize many whale wallets (>5)', () => {
      const analysis: HolderAnalysis = {
        totalHolders: 100,
        top10HoldersPercent: 60,
        top20HoldersPercent: 70,
        largestHolderPercent: 8,
        whaleAddresses: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'],
        devWalletPercent: 8,
        isConcentrated: true,
        topHolders: [],
      };

      const result = assessHolderRisk(analysis);

      expect(result.issues).toContainEqual(expect.stringContaining('6 whale'));
    });

    it('should not return negative score', () => {
      const terribleAnalysis: HolderAnalysis = {
        totalHolders: 3,
        top10HoldersPercent: 100,
        top20HoldersPercent: 100,
        largestHolderPercent: 80,
        whaleAddresses: Array(10).fill('whale'),
        devWalletPercent: 80,
        isConcentrated: true,
        topHolders: [],
      };

      const result = assessHolderRisk(terribleAnalysis);

      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });
});
