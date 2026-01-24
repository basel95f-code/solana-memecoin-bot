/**
 * Feature Engineering Integration Tests
 * Tests feature extraction, normalization, and pattern detection
 */

import { FeatureEngineering, FEATURE_NAMES, FEATURE_COUNT } from '../../src/ml/featureEngineering';
import type { TokenAnalysis, SmartMoneyActivity, DexScreenerPair } from '../../src/types';

describe('FeatureEngineering', () => {
  let featureEng: FeatureEngineering;

  beforeEach(() => {
    featureEng = new FeatureEngineering();
  });

  describe('extractFeaturesBasic', () => {
    it('should extract 25 features from basic input', () => {
      const input = {
        liquidityUsd: 50000,
        riskScore: 75,
        holderCount: 500,
        top10Percent: 30,
        mintRevoked: true,
        freezeRevoked: true,
        lpBurnedPercent: 90,
        hasSocials: true,
        tokenAgeHours: 48,
      };

      const features = featureEng.extractFeaturesBasic(input);

      expect(features.liquidityUsd).toBe(50000);
      expect(features.riskScore).toBe(75);
      expect(features.holderCount).toBe(500);
      expect(features.top10Percent).toBe(30);
      expect(features.mintRevoked).toBe(1);
      expect(features.freezeRevoked).toBe(1);
      expect(features.lpBurnedPercent).toBe(90);
      expect(features.hasSocials).toBe(1);
      expect(features.tokenAgeHours).toBe(48);

      // Default values for advanced features
      expect(features.priceChange5m).toBe(0);
      expect(features.smartMoneyNetBuys).toBe(0);
      expect(features.hasVolumeSpike).toBe(0);
    });

    it('should convert boolean values to 0/1', () => {
      const input = {
        liquidityUsd: 1000,
        riskScore: 50,
        holderCount: 100,
        top10Percent: 50,
        mintRevoked: false,
        freezeRevoked: false,
        lpBurnedPercent: 0,
        hasSocials: false,
        tokenAgeHours: 1,
      };

      const features = featureEng.extractFeaturesBasic(input);

      expect(features.mintRevoked).toBe(0);
      expect(features.freezeRevoked).toBe(0);
      expect(features.hasSocials).toBe(0);
    });
  });

  describe('extractFeatures', () => {
    const mockAnalysis: Partial<TokenAnalysis> = {
      pool: { createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) } as any,
      liquidity: { totalLiquidityUsd: 100000 } as any,
      risk: { score: 80 } as any,
      holders: { totalHolders: 1000, top10HoldersPercent: 25 } as any,
      contract: { mintAuthorityRevoked: true, freezeAuthorityRevoked: true } as any,
      social: { hasTwitter: true, hasTelegram: true, hasWebsite: true } as any,
    };

    const mockDexData: Partial<DexScreenerPair> = {
      priceChange: { m5: 5, h1: 20, h6: 50, h24: 100 },
      volume: { m5: 5000, h1: 50000, h6: 150000, h24: 300000 },
      txns: { h1: { buys: 100, sells: 50 } } as any,
    };

    const mockSmartMoney: SmartMoneyActivity = {
      mint: 'test',
      symbol: 'TEST',
      smartBuys24h: 10,
      smartSells24h: 3,
      netSmartMoney: 7,
      smartMoneyHolding: 15,
      isSmartMoneyBullish: true,
    };

    it('should extract features from full analysis data', () => {
      const features = featureEng.extractFeatures(
        mockAnalysis as TokenAnalysis,
        mockDexData as DexScreenerPair,
        mockSmartMoney
      );

      expect(features.liquidityUsd).toBe(100000);
      expect(features.riskScore).toBe(80);
      expect(features.holderCount).toBe(1000);
      expect(features.top10Percent).toBe(25);
      expect(features.mintRevoked).toBe(1);
      expect(features.freezeRevoked).toBe(1);
      expect(features.hasSocials).toBe(1);

      // Momentum features from dex data
      expect(features.priceChange5m).toBe(5);
      expect(features.priceChange1h).toBe(20);
      expect(features.priceChange24h).toBe(100);

      // Smart money features
      expect(features.smartMoneyNetBuys).toBe(7);
      expect(features.smartMoneyHolding).toBe(15);
      expect(features.isSmartMoneyBullish).toBe(1);
    });

    it('should calculate buy pressure correctly', () => {
      const features = featureEng.extractFeatures(
        mockAnalysis as TokenAnalysis,
        mockDexData as DexScreenerPair,
        null
      );

      // 100 buys / 150 total = 0.666...
      expect(features.buyPressure1h).toBeCloseTo(0.667, 2);
    });

    it('should detect pumping pattern', () => {
      const pumpingDex: Partial<DexScreenerPair> = {
        priceChange: { m5: 15, h1: 40, h6: 80, h24: 120 },
        volume: { m5: 10000, h1: 100000, h6: 200000, h24: 300000 },
      };

      const features = featureEng.extractFeatures(
        mockAnalysis as TokenAnalysis,
        pumpingDex as DexScreenerPair,
        null
      );

      expect(features.isPumping).toBe(1);
      expect(features.isDumping).toBe(0);
    });

    it('should detect dumping pattern', () => {
      const dumpingDex: Partial<DexScreenerPair> = {
        priceChange: { m5: -15, h1: -40, h6: -60, h24: -70 },
        volume: { m5: 10000, h1: 100000, h6: 200000, h24: 300000 },
      };

      const features = featureEng.extractFeatures(
        mockAnalysis as TokenAnalysis,
        dumpingDex as DexScreenerPair,
        null
      );

      expect(features.isDumping).toBe(1);
      expect(features.isPumping).toBe(0);
    });

    it('should detect volume spike', () => {
      const spikeDex: Partial<DexScreenerPair> = {
        priceChange: { m5: 5, h1: 10, h6: 20, h24: 30 },
        volume: { m5: 50000, h1: 200000, h6: 300000, h24: 400000 }, // h1 = 200k, avg = 16.6k, 12x spike
      };

      const features = featureEng.extractFeatures(
        mockAnalysis as TokenAnalysis,
        spikeDex as DexScreenerPair,
        null
      );

      expect(features.hasVolumeSpike).toBe(1);
    });
  });

  describe('normalizeFeatures', () => {
    it('should normalize all features to 0-1 range', () => {
      const features = featureEng.extractFeaturesBasic({
        liquidityUsd: 500000,
        riskScore: 75,
        holderCount: 1000,
        top10Percent: 40,
        mintRevoked: true,
        freezeRevoked: true,
        lpBurnedPercent: 80,
        hasSocials: true,
        tokenAgeHours: 72,
      });

      const normalized = featureEng.normalizeFeatures(features);

      expect(normalized.features.length).toBe(FEATURE_COUNT);
      expect(normalized.featureNames.length).toBe(FEATURE_COUNT);

      // All values should be between 0 and 1
      for (const value of normalized.features) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });

    it('should preserve raw features', () => {
      const input = {
        liquidityUsd: 100000,
        riskScore: 60,
        holderCount: 500,
        top10Percent: 35,
        mintRevoked: true,
        freezeRevoked: false,
        lpBurnedPercent: 50,
        hasSocials: true,
        tokenAgeHours: 24,
      };

      const features = featureEng.extractFeaturesBasic(input);
      const normalized = featureEng.normalizeFeatures(features);

      expect(normalized.raw.liquidityUsd).toBe(100000);
      expect(normalized.raw.riskScore).toBe(60);
      expect(normalized.raw.holderCount).toBe(500);
    });

    it('should handle extreme values gracefully', () => {
      const extremeFeatures = featureEng.extractFeaturesBasic({
        liquidityUsd: 100000000, // 100M - very high
        riskScore: 100,
        holderCount: 1000000, // 1M holders
        top10Percent: 100,
        mintRevoked: true,
        freezeRevoked: true,
        lpBurnedPercent: 100,
        hasSocials: true,
        tokenAgeHours: 10000,
      });

      const normalized = featureEng.normalizeFeatures(extremeFeatures);

      // All should still be clamped to 0-1
      for (const value of normalized.features) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });

    it('should handle zero/negative values', () => {
      const zeroFeatures = featureEng.extractFeaturesBasic({
        liquidityUsd: 0,
        riskScore: 0,
        holderCount: 0,
        top10Percent: 0,
        mintRevoked: false,
        freezeRevoked: false,
        lpBurnedPercent: 0,
        hasSocials: false,
        tokenAgeHours: 0,
      });

      const normalized = featureEng.normalizeFeatures(zeroFeatures);

      // Should not throw and all values should be valid
      for (const value of normalized.features) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        expect(Number.isNaN(value)).toBe(false);
      }
    });
  });

  describe('featuresToRecord', () => {
    it('should convert features to record format', () => {
      const features = featureEng.extractFeaturesBasic({
        liquidityUsd: 50000,
        riskScore: 70,
        holderCount: 300,
        top10Percent: 35,
        mintRevoked: true,
        freezeRevoked: true,
        lpBurnedPercent: 75,
        hasSocials: true,
        tokenAgeHours: 12,
      });

      const record = featureEng.featuresToRecord(features);

      expect(record.liquidityUsd).toBe(50000);
      expect(record.riskScore).toBe(70);
      expect(record.holderCount).toBe(300);
      expect(Object.keys(record).length).toBe(FEATURE_COUNT);
    });
  });

  describe('FEATURE_NAMES constant', () => {
    it('should have 25 features', () => {
      expect(FEATURE_COUNT).toBe(25);
      expect(FEATURE_NAMES.length).toBe(25);
    });

    it('should have all expected feature categories', () => {
      // Core features
      expect(FEATURE_NAMES).toContain('liquidityUsd');
      expect(FEATURE_NAMES).toContain('riskScore');
      expect(FEATURE_NAMES).toContain('holderCount');

      // Momentum features
      expect(FEATURE_NAMES).toContain('priceChange5m');
      expect(FEATURE_NAMES).toContain('priceChange1h');
      expect(FEATURE_NAMES).toContain('buyPressure1h');

      // Smart money features
      expect(FEATURE_NAMES).toContain('smartMoneyNetBuys');
      expect(FEATURE_NAMES).toContain('isSmartMoneyBullish');

      // Trend features
      expect(FEATURE_NAMES).toContain('priceVelocity');
      expect(FEATURE_NAMES).toContain('volumeAcceleration');

      // Pattern features
      expect(FEATURE_NAMES).toContain('hasVolumeSpike');
      expect(FEATURE_NAMES).toContain('isPumping');
      expect(FEATURE_NAMES).toContain('isDumping');
    });
  });
});
