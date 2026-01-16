/**
 * Tests for Outcome Tracker classification logic
 */

// We need to test the classification logic without starting the actual service
// Import the types and thresholds

describe('Outcome Classification Logic', () => {
  // Threshold constants (matching outcomeTracker.ts)
  const RUG_LIQUIDITY_DROP = 0.2;
  const RUG_PRICE_DROP = 0.1;
  const PUMP_THRESHOLD = 2.0;
  const STABLE_RANGE = 0.3;

  type OutcomeType = 'rug' | 'pump' | 'stable' | 'slow_decline' | 'unknown';

  interface TrackedToken {
    mint: string;
    symbol: string;
    initialPrice: number;
    initialLiquidity: number;
    initialRiskScore: number;
    initialHolders: number;
    peakPrice: number;
    peakLiquidity: number;
    peakHolders: number;
    peakAt?: number;
    currentPrice: number;
    currentLiquidity: number;
    currentHolders: number;
    discoveredAt: number;
    lastUpdatedAt: number;
    updateCount: number;
  }

  // Replicate the classification logic for testing
  function classifyOutcome(token: TrackedToken): { outcome: OutcomeType; confidence: number; peakMultiplier: number } {
    const peakMultiplier = token.initialPrice > 0 ? token.peakPrice / token.initialPrice : 1;
    const finalMultiplier = token.initialPrice > 0 ? token.currentPrice / token.initialPrice : 1;
    const liquidityRatio = token.initialLiquidity > 0
      ? token.currentLiquidity / token.initialLiquidity
      : 1;

    let outcome: OutcomeType;
    let confidence: number;

    // Check for rug
    if (liquidityRatio < RUG_LIQUIDITY_DROP || finalMultiplier < RUG_PRICE_DROP) {
      outcome = 'rug';
      confidence = Math.min(1, (1 - liquidityRatio) + (1 - finalMultiplier)) / 2;
    }
    // Check for pump
    else if (peakMultiplier >= PUMP_THRESHOLD) {
      outcome = 'pump';
      confidence = Math.min(1, (peakMultiplier - 1) / 5);
    }
    // Check for stable
    else if (finalMultiplier >= (1 - STABLE_RANGE) && finalMultiplier <= (1 + STABLE_RANGE)) {
      outcome = 'stable';
      confidence = 1 - Math.abs(1 - finalMultiplier) / STABLE_RANGE;
    }
    // Slow decline
    else if (finalMultiplier < 1) {
      outcome = 'slow_decline';
      confidence = 1 - finalMultiplier;
    }
    // Unknown
    else {
      outcome = 'unknown';
      confidence = 0.5;
    }

    return { outcome, confidence, peakMultiplier };
  }

  // Check if token is rugged
  function isRugged(token: TrackedToken): boolean {
    if (token.initialLiquidity === 0) return false;
    const liquidityRatio = token.currentLiquidity / token.initialLiquidity;
    const priceRatio = token.initialPrice > 0 ? token.currentPrice / token.initialPrice : 0;
    return liquidityRatio < RUG_LIQUIDITY_DROP || priceRatio < RUG_PRICE_DROP;
  }

  const createMockToken = (overrides: Partial<TrackedToken> = {}): TrackedToken => ({
    mint: 'TestMint123',
    symbol: 'TEST',
    initialPrice: 0.001,
    initialLiquidity: 10000,
    initialRiskScore: 75,
    initialHolders: 100,
    peakPrice: 0.001,
    peakLiquidity: 10000,
    peakHolders: 100,
    currentPrice: 0.001,
    currentLiquidity: 10000,
    currentHolders: 100,
    discoveredAt: Math.floor(Date.now() / 1000) - 86400, // 24h ago
    lastUpdatedAt: Math.floor(Date.now() / 1000),
    updateCount: 10,
    ...overrides,
  });

  describe('Rug Detection', () => {
    it('should classify as rug when liquidity drops below 20%', () => {
      const token = createMockToken({
        initialLiquidity: 10000,
        currentLiquidity: 1000, // 10% of initial
      });

      const result = classifyOutcome(token);
      expect(result.outcome).toBe('rug');
    });

    it('should classify as rug when price drops below 10%', () => {
      const token = createMockToken({
        initialPrice: 0.01,
        currentPrice: 0.0005, // 5% of initial
      });

      const result = classifyOutcome(token);
      expect(result.outcome).toBe('rug');
    });

    it('should detect rug early with isRugged function', () => {
      const ruggedToken = createMockToken({
        initialLiquidity: 10000,
        currentLiquidity: 500, // 5% of initial
      });

      expect(isRugged(ruggedToken)).toBe(true);
    });

    it('should not detect healthy token as rug', () => {
      const healthyToken = createMockToken({
        initialLiquidity: 10000,
        currentLiquidity: 8000, // 80% of initial
      });

      expect(isRugged(healthyToken)).toBe(false);
    });
  });

  describe('Pump Detection', () => {
    it('should classify as pump when peak is 2x or more', () => {
      const token = createMockToken({
        initialPrice: 0.001,
        peakPrice: 0.003, // 3x
        currentPrice: 0.0015, // Currently at 1.5x
      });

      const result = classifyOutcome(token);
      expect(result.outcome).toBe('pump');
      expect(result.peakMultiplier).toBe(3);
    });

    it('should classify as pump even if dumped after pumping', () => {
      const token = createMockToken({
        initialPrice: 0.001,
        peakPrice: 0.005, // 5x peak
        currentPrice: 0.0008, // Dumped but not rugged
      });

      const result = classifyOutcome(token);
      expect(result.outcome).toBe('pump');
      expect(result.peakMultiplier).toBe(5);
    });

    it('should have higher confidence for bigger pumps', () => {
      const smallPump = createMockToken({
        initialPrice: 0.001,
        peakPrice: 0.002, // 2x
        currentPrice: 0.0015,
      });

      const bigPump = createMockToken({
        initialPrice: 0.001,
        peakPrice: 0.01, // 10x
        currentPrice: 0.005,
      });

      const smallResult = classifyOutcome(smallPump);
      const bigResult = classifyOutcome(bigPump);

      expect(bigResult.confidence).toBeGreaterThan(smallResult.confidence);
    });
  });

  describe('Stable Classification', () => {
    it('should classify as stable when price stays within ±30%', () => {
      const token = createMockToken({
        initialPrice: 0.001,
        peakPrice: 0.0012, // 1.2x peak (not 2x)
        currentPrice: 0.0009, // -10% from initial
      });

      const result = classifyOutcome(token);
      expect(result.outcome).toBe('stable');
    });

    it('should have higher confidence when closer to initial price', () => {
      const veryStable = createMockToken({
        initialPrice: 0.001,
        peakPrice: 0.001,
        currentPrice: 0.001, // Exactly at initial
      });

      const slightlyStable = createMockToken({
        initialPrice: 0.001,
        peakPrice: 0.0012,
        currentPrice: 0.00075, // -25% from initial (still within 30%)
      });

      const veryStableResult = classifyOutcome(veryStable);
      const slightlyStableResult = classifyOutcome(slightlyStable);

      expect(veryStableResult.confidence).toBeGreaterThan(slightlyStableResult.confidence);
    });
  });

  describe('Slow Decline Classification', () => {
    it('should classify as slow_decline when price drops moderately', () => {
      const token = createMockToken({
        initialPrice: 0.001,
        peakPrice: 0.0015, // 1.5x peak
        currentPrice: 0.0005, // -50% from initial
      });

      const result = classifyOutcome(token);
      expect(result.outcome).toBe('slow_decline');
    });

    it('should have higher confidence for bigger declines', () => {
      const smallDecline = createMockToken({
        initialPrice: 0.001,
        peakPrice: 0.001,
        currentPrice: 0.0006, // -40% decline
      });

      const bigDecline = createMockToken({
        initialPrice: 0.001,
        peakPrice: 0.001,
        currentPrice: 0.00015, // -85% decline (but above rug threshold)
      });

      const smallResult = classifyOutcome(smallDecline);
      const bigResult = classifyOutcome(bigDecline);

      expect(bigResult.confidence).toBeGreaterThan(smallResult.confidence);
    });
  });

  describe('Peak Multiplier Calculation', () => {
    it('should correctly calculate peak multiplier', () => {
      const token = createMockToken({
        initialPrice: 0.001,
        peakPrice: 0.005,
      });

      const result = classifyOutcome(token);
      expect(result.peakMultiplier).toBe(5);
    });

    it('should handle zero initial price gracefully', () => {
      const token = createMockToken({
        initialPrice: 0,
        peakPrice: 0.001,
      });

      const result = classifyOutcome(token);
      expect(result.peakMultiplier).toBe(1); // Default to 1 when initial is 0
    });
  });

  describe('Confidence Scores', () => {
    it('should return confidence between 0 and 1', () => {
      const testCases = [
        createMockToken({ currentLiquidity: 100 }), // Rug
        createMockToken({ peakPrice: 0.01 }), // Pump
        createMockToken({}), // Stable
        createMockToken({ currentPrice: 0.0005, peakPrice: 0.001 }), // Slow decline
      ];

      testCases.forEach(token => {
        const result = classifyOutcome(token);
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle token with all zero values', () => {
      const token = createMockToken({
        initialPrice: 0,
        initialLiquidity: 0,
        peakPrice: 0,
        currentPrice: 0,
        currentLiquidity: 0,
      });

      const result = classifyOutcome(token);
      // Should not throw and should return some classification
      expect(['rug', 'pump', 'stable', 'slow_decline', 'unknown']).toContain(result.outcome);
    });

    it('should handle very large multipliers', () => {
      const token = createMockToken({
        initialPrice: 0.000001,
        peakPrice: 1, // 1,000,000x
        currentPrice: 0.5,
      });

      const result = classifyOutcome(token);
      expect(result.outcome).toBe('pump');
      expect(result.confidence).toBe(1); // Capped at 1
    });

    it('should handle negative current price (theoretically impossible but defensive)', () => {
      // This shouldn't happen in practice, but let's ensure it doesn't crash
      const token = createMockToken({
        initialPrice: 0.001,
        currentPrice: -0.0001, // Invalid but testing defensive code
      });

      // Should still return a result without crashing
      const result = classifyOutcome(token);
      expect(['rug', 'pump', 'stable', 'slow_decline', 'unknown']).toContain(result.outcome);
    });
  });
});
