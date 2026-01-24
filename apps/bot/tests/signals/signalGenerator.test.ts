/**
 * Signal Generator Integration Tests
 * Tests the signal generation flow, confidence calculation, and signal lifecycle
 */

import { SignalGenerator } from '../../src/signals/signalGenerator';
import type { SignalGenerationInput } from '../../src/signals/types';

describe('SignalGenerator', () => {
  let generator: SignalGenerator;

  beforeEach(() => {
    generator = new SignalGenerator();
    generator.clearCooldowns();
  });

  describe('calculateConfidence', () => {
    it('should calculate high confidence for ideal token', () => {
      const input: SignalGenerationInput = {
        mint: 'test123',
        symbol: 'TEST',
        name: 'Test Token',
        rugProbability: 0.1,
        riskScore: 80,
        smartMoneyNetBuys: 8,
        smartMoneyHolding: 15,
        isSmartMoneyBullish: true,
        priceUsd: 0.001,
        priceChange1h: 30,
        priceChange24h: 100,
        volume1h: 100000,
        volume24h: 500000,
        holderCount: 500,
        top10Percent: 25,
        mintRevoked: true,
        freezeRevoked: true,
        lpBurnedPercent: 95,
        liquidityUsd: 50000,
      };

      const result = generator.calculateConfidence(input);

      expect(result.confidence).toBeGreaterThan(70);
      expect(result.smartMoneyScore).toBeGreaterThan(0.7);
      expect(result.momentumScore).toBeGreaterThan(0.5);
      expect(result.holderScore).toBeGreaterThan(0.6);
    });

    it('should calculate low confidence for risky token', () => {
      const input: SignalGenerationInput = {
        mint: 'risky123',
        symbol: 'RISKY',
        name: 'Risky Token',
        rugProbability: 0.7,
        riskScore: 20,
        smartMoneyNetBuys: -5,
        isSmartMoneyBullish: false,
        priceUsd: 0.0001,
        priceChange1h: -40,
        priceChange24h: -60,
        holderCount: 15,
        top10Percent: 85,
        mintRevoked: false,
        freezeRevoked: false,
        liquidityUsd: 1000,
      };

      const result = generator.calculateConfidence(input);

      expect(result.confidence).toBeLessThan(40);
      expect(result.smartMoneyScore).toBeLessThan(0.4);
    });

    it('should use neutral score when smart money data is missing', () => {
      const input: SignalGenerationInput = {
        mint: 'neutral123',
        symbol: 'NEUTRAL',
        name: 'Neutral Token',
        rugProbability: 0.3,
        riskScore: 50,
        priceUsd: 0.001,
        mintRevoked: true,
        freezeRevoked: true,
        liquidityUsd: 10000,
      };

      const result = generator.calculateConfidence(input);

      expect(result.smartMoneyScore).toBe(0.5);
      expect(result.momentumScore).toBe(0.5);
    });
  });

  describe('generateSignal', () => {
    it('should generate BUY signal for high confidence token', () => {
      const input: SignalGenerationInput = {
        mint: 'buy123',
        symbol: 'GOOD',
        name: 'Good Token',
        rugProbability: 0.1,
        riskScore: 75,
        smartMoneyNetBuys: 7,
        isSmartMoneyBullish: true,
        priceUsd: 0.005,
        priceChange1h: 25,
        priceChange24h: 80,
        volume1h: 75000,
        volume24h: 200000,
        holderCount: 300,
        top10Percent: 30,
        mintRevoked: true,
        freezeRevoked: true,
        lpBurnedPercent: 90,
        liquidityUsd: 40000,
      };

      const signal = generator.generateSignal(input);

      expect(signal).not.toBeNull();
      expect(signal!.type).toBe('BUY');
      expect(signal!.confidence).toBeGreaterThanOrEqual(60);
      expect(signal!.mint).toBe('buy123');
      expect(signal!.symbol).toBe('GOOD');
      expect(signal!.status).toBe('active');
      expect(signal!.targetPrice).toBeGreaterThan(input.priceUsd);
      expect(signal!.stopLossPrice).toBeLessThan(input.priceUsd);
      expect(signal!.reasons.length).toBeGreaterThan(0);
    });

    it('should generate SELL signal for declining token', () => {
      // SELL signals require confidence >= 50 (minSellConfidence)
      // Test a token that WAS good but is now showing warning signs
      // Base metrics must be decent to meet confidence threshold
      const input: SignalGenerationInput = {
        mint: 'sell123',
        symbol: 'DECLINE',
        name: 'Declining Token',
        rugProbability: 0.15, // Token was safe
        riskScore: 70, // Good safety score
        smartMoneyNetBuys: -2, // But smart money is now selling
        isSmartMoneyBullish: false,
        priceUsd: 0.0001,
        priceChange1h: -35, // Strong negative momentum triggers SELL
        holderCount: 500,
        top10Percent: 30,
        mintRevoked: true,
        freezeRevoked: true,
        lpBurnedPercent: 80,
        liquidityUsd: 50000,
      };

      const signal = generator.generateSignal(input);

      expect(signal).not.toBeNull();
      expect(signal!.type).toBe('SELL');
      expect(signal!.reasons).toContain('Significant price drop (1h)');
    });

    it('should return null when confidence is too low', () => {
      const input: SignalGenerationInput = {
        mint: 'lowconf123',
        symbol: 'LOW',
        name: 'Low Confidence',
        rugProbability: 0.35,
        riskScore: 35,
        priceUsd: 0.001,
        mintRevoked: false,
        freezeRevoked: false,
        liquidityUsd: 5000,
      };

      const signal = generator.generateSignal(input);

      expect(signal).toBeNull();
    });

    it('should respect cooldown period', () => {
      const input: SignalGenerationInput = {
        mint: 'cooldown123',
        symbol: 'COOL',
        name: 'Cooldown Token',
        rugProbability: 0.1,
        riskScore: 80,
        smartMoneyNetBuys: 10,
        isSmartMoneyBullish: true,
        priceUsd: 0.01,
        priceChange1h: 50,
        holderCount: 1000,
        top10Percent: 20,
        mintRevoked: true,
        freezeRevoked: true,
        lpBurnedPercent: 100,
        liquidityUsd: 100000,
      };

      // First signal should succeed
      const signal1 = generator.generateSignal(input);
      expect(signal1).not.toBeNull();

      // Second signal for same token should be blocked by cooldown
      const signal2 = generator.generateSignal(input);
      expect(signal2).toBeNull();
    });

    it('should generate warnings for risky conditions', () => {
      const input: SignalGenerationInput = {
        mint: 'warn123',
        symbol: 'WARN',
        name: 'Warning Token',
        rugProbability: 0.1,
        riskScore: 70,
        smartMoneyNetBuys: 8,
        isSmartMoneyBullish: true,
        priceUsd: 0.001,
        priceChange1h: 40,
        holderCount: 30, // Low holder count
        top10Percent: 60, // High concentration
        mintRevoked: false, // Not revoked
        freezeRevoked: true,
        liquidityUsd: 3000, // Low liquidity
      };

      const signal = generator.generateSignal(input);

      expect(signal).not.toBeNull();
      expect(signal!.warnings).toContain('High holder concentration');
      expect(signal!.warnings).toContain('Low holder count');
      expect(signal!.warnings).toContain('Low liquidity');
      expect(signal!.warnings).toContain('Mint authority not revoked');
    });
  });

  describe('position sizing', () => {
    it('should calculate higher position for higher confidence', () => {
      const highConfInput: SignalGenerationInput = {
        mint: 'high123',
        symbol: 'HIGH',
        name: 'High Confidence',
        rugProbability: 0.05,
        riskScore: 90,
        smartMoneyNetBuys: 10,
        isSmartMoneyBullish: true,
        priceUsd: 0.01,
        priceChange1h: 50,
        holderCount: 1000,
        top10Percent: 15,
        mintRevoked: true,
        freezeRevoked: true,
        lpBurnedPercent: 100,
        liquidityUsd: 200000,
      };

      const lowConfInput: SignalGenerationInput = {
        mint: 'low123',
        symbol: 'LOW',
        name: 'Lower Confidence',
        rugProbability: 0.2,
        riskScore: 55,
        smartMoneyNetBuys: 3,
        isSmartMoneyBullish: true,
        priceUsd: 0.005,
        priceChange1h: 15,
        holderCount: 200,
        top10Percent: 40,
        mintRevoked: true,
        freezeRevoked: true,
        lpBurnedPercent: 60,
        liquidityUsd: 30000,
      };

      const highSignal = generator.generateSignal(highConfInput);
      const lowSignal = generator.generateSignal(lowConfInput);

      expect(highSignal).not.toBeNull();
      expect(lowSignal).not.toBeNull();
      expect(highSignal!.suggestedPositionSize).toBeGreaterThan(lowSignal!.suggestedPositionSize);
    });
  });

  describe('price targets', () => {
    it('should set conservative targets for high risk score', () => {
      const input: SignalGenerationInput = {
        mint: 'safe123',
        symbol: 'SAFE',
        name: 'Safe Token',
        rugProbability: 0.05,
        riskScore: 85, // High safety
        smartMoneyNetBuys: 8,
        isSmartMoneyBullish: true,
        priceUsd: 1.0,
        priceChange1h: 30,
        holderCount: 800,
        top10Percent: 20,
        mintRevoked: true,
        freezeRevoked: true,
        lpBurnedPercent: 95,
        liquidityUsd: 100000,
      };

      const signal = generator.generateSignal(input);

      expect(signal).not.toBeNull();
      // Conservative target = 1.3x (30% gain)
      expect(signal!.targetPrice).toBeCloseTo(1.3, 1);
      // Conservative stop loss = 0.85x (15% loss)
      expect(signal!.stopLossPrice).toBeCloseTo(0.85, 1);
    });

    it('should set wider targets for lower risk score', () => {
      // Use custom config with lower minRiskScore to test riskScore < 40 branch
      const customGenerator = new SignalGenerator({
        minRiskScore: 30, // Allow lower risk scores to generate signals
      });

      const input: SignalGenerationInput = {
        mint: 'risky123',
        symbol: 'RISKY',
        name: 'Riskier Token',
        rugProbability: 0.15,
        riskScore: 35, // Lower safety triggers 2.0x target
        smartMoneyNetBuys: 10,
        isSmartMoneyBullish: true,
        priceUsd: 1.0,
        priceChange1h: 60,
        holderCount: 400,
        top10Percent: 35,
        mintRevoked: true,
        freezeRevoked: true,
        lpBurnedPercent: 70,
        liquidityUsd: 50000,
      };

      const signal = customGenerator.generateSignal(input);

      expect(signal).not.toBeNull();
      // Wider target = 2.0x (100% gain)
      expect(signal!.targetPrice).toBeCloseTo(2.0, 1);
      // Wider stop loss = 0.7x (30% loss)
      expect(signal!.stopLossPrice).toBeCloseTo(0.7, 1);
    });
  });

  describe('configuration', () => {
    it('should allow custom config', () => {
      const customGenerator = new SignalGenerator({
        minBuyConfidence: 70,
        maxRugProbability: 0.2,
        minRiskScore: 50,
      });

      const input: SignalGenerationInput = {
        mint: 'custom123',
        symbol: 'CUSTOM',
        name: 'Custom Config Test',
        rugProbability: 0.25, // Above custom threshold
        riskScore: 60,
        smartMoneyNetBuys: 5,
        isSmartMoneyBullish: true,
        priceUsd: 0.01,
        priceChange1h: 20,
        holderCount: 300,
        top10Percent: 30,
        mintRevoked: true,
        freezeRevoked: true,
        liquidityUsd: 50000,
      };

      const signal = customGenerator.generateSignal(input);

      // Should fail due to custom maxRugProbability of 0.2
      expect(signal).toBeNull();
    });

    it('should update config at runtime', () => {
      const input: SignalGenerationInput = {
        mint: 'update123',
        symbol: 'UPDATE',
        name: 'Update Config Test',
        rugProbability: 0.1,
        riskScore: 65,
        smartMoneyNetBuys: 6,
        isSmartMoneyBullish: true,
        priceUsd: 0.01,
        priceChange1h: 25,
        holderCount: 400,
        top10Percent: 30,
        mintRevoked: true,
        freezeRevoked: true,
        lpBurnedPercent: 80,
        liquidityUsd: 40000,
      };

      // With default config, should generate signal
      const signal1 = generator.generateSignal(input);
      expect(signal1).not.toBeNull();

      generator.clearCooldowns();

      // Update to stricter config
      generator.updateConfig({ minBuyConfidence: 90 });

      // Now should fail due to higher threshold
      const signal2 = generator.generateSignal(input);
      expect(signal2).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle zero liquidity gracefully', () => {
      const input: SignalGenerationInput = {
        mint: 'zeroliq123',
        symbol: 'ZERO',
        name: 'Zero Liquidity',
        rugProbability: 0.1,
        riskScore: 70,
        priceUsd: 0.001,
        volume1h: 1000,
        mintRevoked: true,
        freezeRevoked: true,
        liquidityUsd: 0,
      };

      // Should not throw
      expect(() => generator.calculateConfidence(input)).not.toThrow();
    });

    it('should handle negative price change', () => {
      const input: SignalGenerationInput = {
        mint: 'negative123',
        symbol: 'NEG',
        name: 'Negative Change',
        rugProbability: 0.2,
        riskScore: 60,
        priceUsd: 0.001,
        priceChange1h: -50,
        priceChange24h: -80,
        mintRevoked: true,
        freezeRevoked: true,
        liquidityUsd: 10000,
      };

      const result = generator.calculateConfidence(input);

      // Momentum should be low/zero for negative changes
      expect(result.momentumScore).toBeLessThan(0.5);
    });

    it('should clamp confidence to 0-100 range', () => {
      // Extreme positive case
      const extremeInput: SignalGenerationInput = {
        mint: 'extreme123',
        symbol: 'EXT',
        name: 'Extreme Values',
        rugProbability: 0,
        riskScore: 100,
        smartMoneyNetBuys: 100,
        smartMoneyHolding: 50,
        isSmartMoneyBullish: true,
        priceUsd: 0.01,
        priceChange1h: 500,
        priceChange24h: 1000,
        volume1h: 1000000,
        holderCount: 10000,
        top10Percent: 0,
        mintRevoked: true,
        freezeRevoked: true,
        lpBurnedPercent: 100,
        liquidityUsd: 1000000,
      };

      const result = generator.calculateConfidence(extremeInput);

      expect(result.confidence).toBeLessThanOrEqual(100);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });
  });
});
