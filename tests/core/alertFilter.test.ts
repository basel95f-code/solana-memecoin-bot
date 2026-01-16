import { shouldAlert, shouldSendAdvancedAlert } from '../../src/core/alertFilter';
import { storageService } from '../../src/services/storage';
import { TokenAnalysis, RiskLevel } from '../../src/types';

// Mock the storage service
jest.mock('../../src/services/storage', () => ({
  storageService: {
    getUserSettings: jest.fn(),
    isQuietHours: jest.fn(),
    shouldAlertForPriority: jest.fn(),
    isTokenBlacklisted: jest.fn(),
  },
}));

describe('Alert Filter', () => {
  // Create a mock analysis that passes all checks
  const createMockAnalysis = (overrides: Partial<TokenAnalysis> = {}): TokenAnalysis => ({
    token: {
      mint: 'TestMint123',
      name: 'Test Token',
      symbol: 'TEST',
      decimals: 9,
      supply: 1000000000,
    },
    pool: {
      address: 'PoolAddress123',
      tokenMint: 'TestMint123',
      baseMint: 'TestMint123',
      quoteMint: 'So11111111111111111111111111111111111111112',
      baseReserve: 1000000,
      quoteReserve: 50,
      lpMint: 'LpMint123',
      source: 'raydium',
      createdAt: new Date(),
    },
    liquidity: {
      totalLiquidityUsd: 50000,
      lpBurned: true,
      lpBurnedPercent: 100,
      lpLocked: false,
      lpLockedPercent: 0,
    },
    holders: {
      totalHolders: 500,
      top10HoldersPercent: 30,
      top20HoldersPercent: 45,
      largestHolderPercent: 8,
      whaleAddresses: [],
      devWalletPercent: 5,
      isConcentrated: false,
      topHolders: [],
    },
    contract: {
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      mintAuthority: null,
      freezeAuthority: null,
      isHoneypot: false,
      hasTransferFee: false,
    },
    social: {
      hasTwitter: true,
      hasTelegram: true,
      hasWebsite: true,
    },
    risk: {
      score: 85,
      level: 'LOW' as RiskLevel,
      factors: [],
    },
    analyzedAt: new Date(),
    ...overrides,
  });

  const defaultSettings = {
    chatId: 'test-chat',
    filters: {
      alertsEnabled: true,
      minLiquidity: 1000,
      maxTop10Percent: 80,
      minHolders: 10,
      minRiskScore: 40,
      minTokenAge: 0,
      requireMintRevoked: false,
      requireFreezeRevoked: false,
      requireLPBurned: false,
      requireSocials: false,
      alertCategories: {
        new_token: true,
        volume_spike: true,
        whale_movement: true,
        liquidity_drain: true,
        authority_change: true,
        wallet_activity: true,
      },
    },
    watchlist: [],
    blacklist: [],
    createdAt: Date.now(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (storageService.getUserSettings as jest.Mock).mockReturnValue(defaultSettings);
    (storageService.isQuietHours as jest.Mock).mockReturnValue(false);
    (storageService.shouldAlertForPriority as jest.Mock).mockReturnValue(true);
    (storageService.isTokenBlacklisted as jest.Mock).mockReturnValue(false);
  });

  describe('shouldAlert', () => {
    it('should return true for a token that passes all checks', () => {
      const analysis = createMockAnalysis();
      expect(shouldAlert(analysis, 'test-chat')).toBe(true);
    });

    it('should return false when alerts are disabled', () => {
      (storageService.getUserSettings as jest.Mock).mockReturnValue({
        ...defaultSettings,
        filters: { ...defaultSettings.filters, alertsEnabled: false },
      });

      const analysis = createMockAnalysis();
      expect(shouldAlert(analysis, 'test-chat')).toBe(false);
    });

    it('should return false during quiet hours', () => {
      (storageService.isQuietHours as jest.Mock).mockReturnValue(true);

      const analysis = createMockAnalysis();
      expect(shouldAlert(analysis, 'test-chat')).toBe(false);
    });

    it('should return false for blacklisted tokens', () => {
      (storageService.isTokenBlacklisted as jest.Mock).mockReturnValue(true);

      const analysis = createMockAnalysis();
      expect(shouldAlert(analysis, 'test-chat')).toBe(false);
    });

    it('should return false when liquidity is below threshold', () => {
      const analysis = createMockAnalysis({
        liquidity: {
          totalLiquidityUsd: 500, // Below 1000 threshold
          lpBurned: true,
          lpBurnedPercent: 100,
          lpLocked: false,
          lpLockedPercent: 0,
        },
      });

      expect(shouldAlert(analysis, 'test-chat')).toBe(false);
    });

    it('should return false when holder concentration is too high', () => {
      const analysis = createMockAnalysis({
        holders: {
          totalHolders: 500,
          top10HoldersPercent: 90, // Above 80% threshold
          top20HoldersPercent: 95,
          largestHolderPercent: 50,
          whaleAddresses: [],
          devWalletPercent: 5,
          isConcentrated: true,
          topHolders: [],
        },
      });

      expect(shouldAlert(analysis, 'test-chat')).toBe(false);
    });

    it('should return false when holder count is too low', () => {
      const analysis = createMockAnalysis({
        holders: {
          totalHolders: 5, // Below 10 threshold
          top10HoldersPercent: 30,
          top20HoldersPercent: 45,
          largestHolderPercent: 8,
          whaleAddresses: [],
          devWalletPercent: 5,
          isConcentrated: false,
          topHolders: [],
        },
      });

      expect(shouldAlert(analysis, 'test-chat')).toBe(false);
    });

    it('should return false when risk score is too low', () => {
      const analysis = createMockAnalysis({
        risk: {
          score: 30, // Below 40 threshold
          level: 'HIGH' as RiskLevel,
          factors: [],
        },
      });

      expect(shouldAlert(analysis, 'test-chat')).toBe(false);
    });

    it('should return false when mint authority not revoked and requireMintRevoked is true', () => {
      (storageService.getUserSettings as jest.Mock).mockReturnValue({
        ...defaultSettings,
        filters: { ...defaultSettings.filters, requireMintRevoked: true },
      });

      const analysis = createMockAnalysis({
        contract: {
          mintAuthorityRevoked: false,
          freezeAuthorityRevoked: true,
          mintAuthority: 'SomeAuthority',
          freezeAuthority: null,
          isHoneypot: false,
          hasTransferFee: false,
        },
      });

      expect(shouldAlert(analysis, 'test-chat')).toBe(false);
    });

    it('should return false when LP not burned and requireLPBurned is true', () => {
      (storageService.getUserSettings as jest.Mock).mockReturnValue({
        ...defaultSettings,
        filters: { ...defaultSettings.filters, requireLPBurned: true },
      });

      const analysis = createMockAnalysis({
        liquidity: {
          totalLiquidityUsd: 50000,
          lpBurned: false,
          lpBurnedPercent: 0,
          lpLocked: true,
          lpLockedPercent: 100,
        },
      });

      expect(shouldAlert(analysis, 'test-chat')).toBe(false);
    });

    it('should return false when no socials and requireSocials is true', () => {
      (storageService.getUserSettings as jest.Mock).mockReturnValue({
        ...defaultSettings,
        filters: { ...defaultSettings.filters, requireSocials: true },
      });

      const analysis = createMockAnalysis({
        social: {
          hasTwitter: false,
          hasTelegram: false,
          hasWebsite: false,
        },
      });

      expect(shouldAlert(analysis, 'test-chat')).toBe(false);
    });

    it('should return true when at least one social is present and requireSocials is true', () => {
      (storageService.getUserSettings as jest.Mock).mockReturnValue({
        ...defaultSettings,
        filters: { ...defaultSettings.filters, requireSocials: true },
      });

      const analysis = createMockAnalysis({
        social: {
          hasTwitter: true,
          hasTelegram: false,
          hasWebsite: false,
        },
      });

      expect(shouldAlert(analysis, 'test-chat')).toBe(true);
    });

    it('should return false when new_token category is disabled', () => {
      (storageService.getUserSettings as jest.Mock).mockReturnValue({
        ...defaultSettings,
        filters: {
          ...defaultSettings.filters,
          alertCategories: { ...defaultSettings.filters.alertCategories, new_token: false },
        },
      });

      const analysis = createMockAnalysis();
      expect(shouldAlert(analysis, 'test-chat')).toBe(false);
    });
  });

  describe('shouldSendAdvancedAlert', () => {
    it('should return true for volume_spike when enabled', () => {
      expect(shouldSendAdvancedAlert('volume_spike', 'TestMint123', 'test-chat')).toBe(true);
    });

    it('should return false for volume_spike when disabled', () => {
      (storageService.getUserSettings as jest.Mock).mockReturnValue({
        ...defaultSettings,
        filters: {
          ...defaultSettings.filters,
          alertCategories: { ...defaultSettings.filters.alertCategories, volume_spike: false },
        },
      });

      expect(shouldSendAdvancedAlert('volume_spike', 'TestMint123', 'test-chat')).toBe(false);
    });

    it('should return false for blacklisted tokens', () => {
      (storageService.isTokenBlacklisted as jest.Mock).mockReturnValue(true);
      expect(shouldSendAdvancedAlert('whale_movement', 'TestMint123', 'test-chat')).toBe(false);
    });

    it('should return false during quiet hours', () => {
      (storageService.isQuietHours as jest.Mock).mockReturnValue(true);
      expect(shouldSendAdvancedAlert('liquidity_drain', 'TestMint123', 'test-chat')).toBe(false);
    });

    it('should return false when alerts are globally disabled', () => {
      (storageService.getUserSettings as jest.Mock).mockReturnValue({
        ...defaultSettings,
        filters: { ...defaultSettings.filters, alertsEnabled: false },
      });

      expect(shouldSendAdvancedAlert('authority_change', 'TestMint123', 'test-chat')).toBe(false);
    });
  });
});
