import { gmgnService } from '../../src/services/gmgn';
import { SmartMoneyActivity } from '../../src/types';

describe('GMGN Service', () => {
  describe('extractSmartMoneyActivity', () => {
    it('should extract smart money activity from GMGN token data', () => {
      const mockToken = {
        address: 'test123',
        symbol: 'TEST',
        name: 'Test Token',
        decimals: 9,
        price: 0.001,
        smart_buy_24h: 10,
        smart_sell_24h: 3,
        smart_money_holding: 15000,
      };

      const result = gmgnService.extractSmartMoneyActivity(mockToken);

      expect(result.mint).toBe('test123');
      expect(result.symbol).toBe('TEST');
      expect(result.smartBuys24h).toBe(10);
      expect(result.smartSells24h).toBe(3);
      expect(result.netSmartMoney).toBe(7);
      expect(result.isSmartMoneyBullish).toBe(true);
    });

    it('should identify bearish smart money activity', () => {
      const mockToken = {
        address: 'test456',
        symbol: 'DUMP',
        name: 'Dump Token',
        decimals: 9,
        price: 0.0001,
        smart_buy_24h: 1,
        smart_sell_24h: 8,
      };

      const result = gmgnService.extractSmartMoneyActivity(mockToken);

      expect(result.netSmartMoney).toBe(-7);
      expect(result.isSmartMoneyBullish).toBe(false);
    });

    it('should handle missing smart money data', () => {
      const mockToken = {
        address: 'test789',
        symbol: 'NODATA',
        name: 'No Data Token',
        decimals: 9,
        price: 0.01,
        // No smart_buy_24h or smart_sell_24h
      };

      const result = gmgnService.extractSmartMoneyActivity(mockToken);

      expect(result.smartBuys24h).toBe(0);
      expect(result.smartSells24h).toBe(0);
      expect(result.netSmartMoney).toBe(0);
      expect(result.isSmartMoneyBullish).toBe(false);
    });
  });

  describe('toTrendingToken', () => {
    it('should convert GMGN token to TrendingToken format', () => {
      const mockToken = {
        address: 'test123',
        symbol: 'TEST',
        name: 'Test Token',
        decimals: 9,
        price: 0.001,
        price_change_1h: 5.5,
        price_change_24h: 15.2,
        volume_24h: 50000,
        liquidity: 25000,
        market_cap: 100000,
        buys: 120,
        sells: 80,
        pool_address: 'pool123',
        dex: 'raydium',
        open_timestamp: 1700000000,
      };

      const result = gmgnService.toTrendingToken(mockToken);

      expect(result.mint).toBe('test123');
      expect(result.symbol).toBe('TEST');
      expect(result.name).toBe('Test Token');
      expect(result.priceUsd).toBe(0.001);
      expect(result.priceChange1h).toBe(5.5);
      expect(result.priceChange24h).toBe(15.2);
      expect(result.volume24h).toBe(50000);
      expect(result.liquidity).toBe(25000);
      expect(result.marketCap).toBe(100000);
      expect(result.txns24h.buys).toBe(120);
      expect(result.txns24h.sells).toBe(80);
      expect(result.pairAddress).toBe('pool123');
      expect(result.dexId).toBe('raydium');
    });

    it('should handle missing optional fields', () => {
      const mockToken = {
        address: 'test456',
        symbol: 'MIN',
        name: 'Minimal Token',
        decimals: 9,
        price: 0.0001,
      };

      const result = gmgnService.toTrendingToken(mockToken);

      expect(result.mint).toBe('test456');
      expect(result.priceUsd).toBe(0.0001);
      expect(result.priceChange1h).toBe(0);
      expect(result.volume24h).toBe(0);
      expect(result.liquidity).toBe(0);
      expect(result.pairAddress).toBe('');
    });
  });
});
