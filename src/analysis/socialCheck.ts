import axios from 'axios';
import type { SocialAnalysis, TokenMetadata } from '../types';
import { logger } from '../utils/logger';
import { TIMEOUTS } from '../constants';

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

/**
 * Get Twitter follower count using Twitter API v2
 * Requires TWITTER_BEARER_TOKEN environment variable
 */
async function getTwitterFollowers(url: string): Promise<number | undefined> {
  const bearerToken = process.env.TWITTER_BEARER_TOKEN;
  if (!bearerToken) {
    logger.silentError('socialCheck', 'No Twitter bearer token configured');
    return undefined;
  }

  try {
    // Extract username from URL
    const match = url.match(/(?:twitter\.com|x\.com)\/([^/?#]+)/i);
    if (!match) return undefined;

    const username = match[1].toLowerCase();
    if (['home', 'explore', 'search', 'notifications', 'messages'].includes(username)) {
      return undefined;
    }

    const response = await axios.get(
      `https://api.twitter.com/2/users/by/username/${username}`,
      {
        headers: { Authorization: `Bearer ${bearerToken}` },
        params: { 'user.fields': 'public_metrics' },
        timeout: TIMEOUTS.HTTP_REQUEST_MS,
      }
    );

    const followers = response.data?.data?.public_metrics?.followers_count;
    if (typeof followers === 'number') {
      logger.debug('socialCheck', `Twitter @${username}: ${followers} followers`);
      return followers;
    }

    return undefined;
  } catch (error) {
    logger.silentError('socialCheck', 'Twitter API failed', error as Error);
    return undefined;
  }
}

/**
 * Get Telegram member count by scraping the public preview page
 */
async function getTelegramMembers(url: string): Promise<number | undefined> {
  try {
    const response = await axios.get(url, {
      timeout: TIMEOUTS.HTTP_REQUEST_MS,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TelegramBot/1.0)',
      },
    });

    const html = response.data;

    // Try to extract member count from various patterns
    // Pattern 1: "X members" or "X subscribers"
    const memberMatch = html.match(/(\d[\d\s,]*)\s*(?:members?|subscribers?)/i);
    if (memberMatch) {
      const count = parseInt(memberMatch[1].replace(/[\s,]/g, ''), 10);
      if (!isNaN(count)) {
        logger.debug('socialCheck', `Telegram: ${count} members`);
        return count;
      }
    }

    // Pattern 2: Look in meta tags
    const metaMatch = html.match(/content="(\d+)\s*(?:members|subscribers)/i);
    if (metaMatch) {
      const count = parseInt(metaMatch[1], 10);
      if (!isNaN(count)) {
        return count;
      }
    }

    return undefined;
  } catch (error) {
    logger.silentError('socialCheck', 'Telegram scrape failed', error as Error);
    return undefined;
  }
}

/**
 * Get website/domain age using WHOIS API
 * Requires WHOIS_API_KEY environment variable
 */
async function getWebsiteAge(url: string): Promise<number | undefined> {
  const whoisApiKey = process.env.WHOIS_API_KEY;

  try {
    // First check if website is accessible
    const headResponse = await axios.head(url, {
      timeout: TIMEOUTS.HTTP_REQUEST_MS,
      validateStatus: () => true,
    });

    if (headResponse.status < 200 || headResponse.status >= 400) {
      return undefined;
    }

    // If no WHOIS API key, just confirm site exists
    if (!whoisApiKey) {
      logger.silentError('socialCheck', 'No WHOIS API key - skipping domain age');
      return undefined;
    }

    // Extract domain from URL
    const domain = new URL(url).hostname;

    // Call WHOIS API (using whoisfreaks.com)
    const whoisResponse = await axios.get(
      `https://api.whoisfreaks.com/v1.0/whois`,
      {
        params: {
          whois: 'live',
          domainName: domain,
          apiKey: whoisApiKey,
        },
        timeout: TIMEOUTS.WHOIS_LOOKUP_MS,
      }
    );

    // Extract creation date
    const creationDate =
      whoisResponse.data?.create_date ||
      whoisResponse.data?.creation_date ||
      whoisResponse.data?.domain_registered;

    if (creationDate) {
      const createdAt = new Date(creationDate).getTime();
      const ageMs = Date.now() - createdAt;
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

      if (ageDays > 0) {
        logger.debug('socialCheck', `Domain ${domain}: ${ageDays} days old`);
        return ageDays;
      }
    }

    return undefined;
  } catch (error) {
    logger.silentError('socialCheck', 'Website age check failed', error as Error);
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
