import axios from 'axios';
import { SocialAnalysis, TokenMetadata } from '../types';

export async function analyzeSocials(metadata: TokenMetadata | undefined): Promise<SocialAnalysis> {
  const result: SocialAnalysis = {
    hasTwitter: false,
    hasTelegram: false,
    hasWebsite: false,
  };

  if (!metadata) {
    return result;
  }

  // Check Twitter
  if (metadata.twitter) {
    result.hasTwitter = true;
    result.twitterUrl = normalizeTwitterUrl(metadata.twitter);
    result.twitterFollowers = await getTwitterFollowers(result.twitterUrl);
  }

  // Check Telegram
  if (metadata.telegram) {
    result.hasTelegram = true;
    result.telegramUrl = normalizeTelegramUrl(metadata.telegram);
    result.telegramMembers = await getTelegramMembers(result.telegramUrl);
  }

  // Check Website
  if (metadata.website) {
    result.hasWebsite = true;
    result.websiteUrl = normalizeWebsiteUrl(metadata.website);
    result.websiteAge = await getWebsiteAge(result.websiteUrl);
  }

  return result;
}

function normalizeTwitterUrl(twitter: string): string {
  if (twitter.startsWith('http')) {
    return twitter;
  }
  if (twitter.startsWith('@')) {
    return `https://twitter.com/${twitter.slice(1)}`;
  }
  return `https://twitter.com/${twitter}`;
}

function normalizeTelegramUrl(telegram: string): string {
  if (telegram.startsWith('http')) {
    return telegram;
  }
  if (telegram.startsWith('@')) {
    return `https://t.me/${telegram.slice(1)}`;
  }
  if (telegram.startsWith('t.me/')) {
    return `https://${telegram}`;
  }
  return `https://t.me/${telegram}`;
}

function normalizeWebsiteUrl(website: string): string {
  if (website.startsWith('http')) {
    return website;
  }
  return `https://${website}`;
}

async function getTwitterFollowers(url: string): Promise<number | undefined> {
  // Twitter API requires authentication, so we'll skip follower count
  // In production, you'd use Twitter API v2 with bearer token
  return undefined;
}

async function getTelegramMembers(url: string): Promise<number | undefined> {
  // Telegram doesn't expose member count via public API
  // Would need to use Telegram Bot API with the bot being a member
  return undefined;
}

async function getWebsiteAge(url: string): Promise<number | undefined> {
  try {
    // Check if website is accessible
    const response = await axios.head(url, {
      timeout: 5000,
      validateStatus: () => true,
    });

    if (response.status >= 200 && response.status < 400) {
      // Website exists, but we can't easily get age without WHOIS lookup
      // Return undefined for now
      return undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function verifySocials(analysis: SocialAnalysis): Promise<{
  twitterValid: boolean;
  telegramValid: boolean;
  websiteValid: boolean;
}> {
  const results = {
    twitterValid: false,
    telegramValid: false,
    websiteValid: false,
  };

  // Verify Twitter
  if (analysis.twitterUrl) {
    try {
      const response = await axios.head(analysis.twitterUrl, {
        timeout: 5000,
        validateStatus: () => true,
      });
      results.twitterValid = response.status === 200;
    } catch {
      results.twitterValid = false;
    }
  }

  // Verify Telegram
  if (analysis.telegramUrl) {
    try {
      const response = await axios.get(analysis.telegramUrl, {
        timeout: 5000,
        validateStatus: () => true,
      });
      // Telegram returns 200 even for non-existent groups, check content
      results.telegramValid =
        response.status === 200 &&
        !response.data?.includes('If you have Telegram');
    } catch {
      results.telegramValid = false;
    }
  }

  // Verify Website
  if (analysis.websiteUrl) {
    try {
      const response = await axios.head(analysis.websiteUrl, {
        timeout: 5000,
        validateStatus: () => true,
      });
      results.websiteValid = response.status >= 200 && response.status < 400;
    } catch {
      results.websiteValid = false;
    }
  }

  return results;
}

export function assessSocialRisk(analysis: SocialAnalysis): {
  score: number;
  issues: string[];
} {
  const issues: string[] = [];
  let score = 100;

  // No socials at all is suspicious
  if (!analysis.hasTwitter && !analysis.hasTelegram && !analysis.hasWebsite) {
    score -= 30;
    issues.push('No social media presence found');
    return { score, issues };
  }

  // Missing individual socials
  if (!analysis.hasTwitter) {
    score -= 15;
    issues.push('No Twitter/X account found');
  }

  if (!analysis.hasTelegram) {
    score -= 10;
    issues.push('No Telegram group found');
  }

  if (!analysis.hasWebsite) {
    score -= 10;
    issues.push('No website found');
  }

  // Low follower counts (if available)
  if (analysis.twitterFollowers !== undefined && analysis.twitterFollowers < 100) {
    score -= 10;
    issues.push('Twitter has very few followers');
  }

  if (analysis.telegramMembers !== undefined && analysis.telegramMembers < 50) {
    score -= 10;
    issues.push('Telegram group has very few members');
  }

  return { score: Math.max(0, score), issues };
}
