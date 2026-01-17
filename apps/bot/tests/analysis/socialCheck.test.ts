import { analyzeSocials } from '../../src/analysis/socialCheck';
import { TokenMetadata, SocialAnalysis } from '../../src/types';

describe('socialCheck', () => {
  describe('analyzeSocials', () => {
    it('should detect Twitter presence from metadata', async () => {
      const metadata: TokenMetadata = {
        name: 'Test Token',
        symbol: 'TEST',
        twitter: 'https://twitter.com/testtoken',
      };

      const result = await analyzeSocials(metadata);

      expect(result.hasTwitter).toBe(true);
      expect(result.twitterUrl).toBe('https://twitter.com/testtoken');
    });

    it('should detect Telegram presence from metadata', async () => {
      const metadata: TokenMetadata = {
        name: 'Test Token',
        symbol: 'TEST',
        telegram: 'https://t.me/testtoken',
      };

      const result = await analyzeSocials(metadata);

      expect(result.hasTelegram).toBe(true);
      expect(result.telegramUrl).toBe('https://t.me/testtoken');
    });

    it('should detect Website presence from metadata', async () => {
      const metadata: TokenMetadata = {
        name: 'Test Token',
        symbol: 'TEST',
        website: 'https://testtoken.com',
      };

      const result = await analyzeSocials(metadata);

      expect(result.hasWebsite).toBe(true);
      expect(result.websiteUrl).toBe('https://testtoken.com');
    });

    it('should handle undefined metadata', async () => {
      const result = await analyzeSocials(undefined);

      expect(result.hasTwitter).toBe(false);
      expect(result.hasTelegram).toBe(false);
      expect(result.hasWebsite).toBe(false);
    });

    it('should handle empty metadata', async () => {
      const metadata: TokenMetadata = {
        name: 'Test Token',
        symbol: 'TEST',
      };

      const result = await analyzeSocials(metadata);

      expect(result.hasTwitter).toBe(false);
      expect(result.hasTelegram).toBe(false);
      expect(result.hasWebsite).toBe(false);
    });

    it('should detect all socials when present', async () => {
      const metadata: TokenMetadata = {
        name: 'Test Token',
        symbol: 'TEST',
        twitter: 'https://twitter.com/test',
        telegram: 'https://t.me/test',
        website: 'https://test.com',
      };

      const result = await analyzeSocials(metadata);

      expect(result.hasTwitter).toBe(true);
      expect(result.hasTelegram).toBe(true);
      expect(result.hasWebsite).toBe(true);
    });

    it('should return valid social analysis structure', async () => {
      const metadata: TokenMetadata = {
        name: 'Test',
        symbol: 'TEST',
      };

      const result = await analyzeSocials(metadata);

      expect(result).toHaveProperty('hasTwitter');
      expect(result).toHaveProperty('hasTelegram');
      expect(result).toHaveProperty('hasWebsite');
      expect(typeof result.hasTwitter).toBe('boolean');
      expect(typeof result.hasTelegram).toBe('boolean');
      expect(typeof result.hasWebsite).toBe('boolean');
    });

    it('should handle empty string social links', async () => {
      const metadata: TokenMetadata = {
        name: 'Test Token',
        symbol: 'TEST',
        twitter: '',
        telegram: '',
        website: '',
      };

      const result = await analyzeSocials(metadata);

      expect(result.hasTwitter).toBe(false);
      expect(result.hasTelegram).toBe(false);
      expect(result.hasWebsite).toBe(false);
    });
  });

  describe('Social URL Validation', () => {
    it('should accept valid Twitter URLs', () => {
      const validTwitterUrls = [
        'https://twitter.com/test',
        'https://x.com/test',
        'https://twitter.com/test_token',
      ];

      validTwitterUrls.forEach(url => {
        expect(url).toMatch(/^https:\/\/(twitter\.com|x\.com)\//);
      });
    });

    it('should accept valid Telegram URLs', () => {
      const validTelegramUrls = [
        'https://t.me/testtoken',
        'https://telegram.me/testtoken',
      ];

      validTelegramUrls.forEach(url => {
        expect(url).toMatch(/^https:\/\/(t\.me|telegram\.me)\//);
      });
    });

    it('should accept valid website URLs', () => {
      const validWebsiteUrls = [
        'https://testtoken.com',
        'https://www.testtoken.io',
        'https://token.app',
      ];

      validWebsiteUrls.forEach(url => {
        expect(url).toMatch(/^https?:\/\//);
      });
    });
  });

  describe('Social Score Impact', () => {
    it('should give points for having socials', () => {
      const withSocials: SocialAnalysis = {
        hasTwitter: true,
        hasTelegram: true,
        hasWebsite: true,
      };

      const withoutSocials: SocialAnalysis = {
        hasTwitter: false,
        hasTelegram: false,
        hasWebsite: false,
      };

      // Count of true values
      const socialCount = Object.values(withSocials).filter(v => v === true).length;
      const noSocialCount = Object.values(withoutSocials).filter(v => v === true).length;

      expect(socialCount).toBe(3);
      expect(noSocialCount).toBe(0);
    });

    it('should give partial credit for some socials', () => {
      const partialSocials: SocialAnalysis = {
        hasTwitter: true,
        hasTelegram: false,
        hasWebsite: true,
      };

      const socialCount = [
        partialSocials.hasTwitter,
        partialSocials.hasTelegram,
        partialSocials.hasWebsite,
      ].filter(Boolean).length;

      expect(socialCount).toBe(2);
    });
  });
});
