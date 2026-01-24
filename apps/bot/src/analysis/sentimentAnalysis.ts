import type {
  SentimentAnalysis,
  MultiPlatformSentimentAnalysis,
  PlatformSentimentData,
  SentimentPlatform,
  TokenInfo,
  MonitoredChannel,
} from '../types';
import { twitterService } from '../services/twitter';
import { telegramMtprotoService } from '../services/telegramMtproto';
import { discordBotService } from '../services/discordBot';
import { config } from '../config';
import { SENTIMENT, SENTIMENT_AGGREGATION } from '../constants';

// Bullish/positive keywords for crypto sentiment
const BULLISH_KEYWORDS = [
  // Strong positive
  'moon', 'mooning', 'pump', 'pumping', 'gem', 'bullish', 'lfg', 'wagmi',
  'rocket', 'lambo', 'rich', 'millionaire', '100x', '1000x', 'buy',
  // Moderate positive
  'good', 'great', 'amazing', 'solid', 'legit', 'real', 'based',
  'diamond', 'hold', 'hodl', 'accumulate', 'undervalued', 'early',
  // Community positive
  'community', 'dev', 'team', 'trust', 'transparent', 'doxxed',
];

// Bearish/negative keywords for crypto sentiment
const BEARISH_KEYWORDS = [
  // Strong negative
  'rug', 'rugged', 'scam', 'scammer', 'honeypot', 'dump', 'dumping',
  'sell', 'selling', 'exit', 'rekt', 'dead', 'dying', 'worthless',
  // Moderate negative
  'bad', 'fake', 'fraud', 'avoid', 'warning', 'careful', 'sus',
  'suspicious', 'sketchy', 'shady', 'redflag',
  // Technical warnings
  'rugpull', 'ponzi', 'scamtoken',
];

// Keyword weights (strong signals get higher weight)
const KEYWORD_WEIGHTS: Record<string, number> = {
  // Strong negative (weight 3)
  'rug': 3, 'rugged': 3, 'scam': 3, 'honeypot': 3, 'rugpull': 3,
  // Moderate negative (weight 2)
  'avoid': 2.5, 'warning': 2, 'sus': 2, 'suspicious': 2, 'fraud': 2.5,
  // Strong positive (weight 2)
  'gem': 2, 'moon': 1.5, 'bullish': 1.5, '100x': 2, '1000x': 2,
  // Moderate positive (weight 1.5)
  'lfg': 1, 'wagmi': 1, 'diamond': 1.5,
};

interface TermCount {
  term: string;
  count: number;
  sentiment: 'positive' | 'negative';
}

interface SentimentResult {
  positiveCount: number;
  negativeCount: number;
  sentimentScore: number;
  confidence: number;
  topTerms: TermCount[];
}

/**
 * Main entry point for sentiment analysis
 * Coordinates all enabled platforms and aggregates results
 */
export async function analyzeSentiment(
  tokenInfo: TokenInfo,
  channels?: { telegram?: MonitoredChannel[]; discord?: MonitoredChannel[] }
): Promise<MultiPlatformSentimentAnalysis> {
  const platforms: PlatformSentimentData[] = [];
  const platformsAnalyzed: SentimentPlatform[] = [];

  // Build search terms
  const searchTerms = buildSearchTerms(tokenInfo);

  // Analyze each enabled platform in parallel
  const promises: Promise<PlatformSentimentData | null>[] = [];

  // Twitter analysis
  if (config.sentiment.twitterEnabled) {
    promises.push(analyzeTwitterSentiment(searchTerms).catch(() => null));
  }

  // Telegram analysis
  if (config.sentiment.telegramEnabled && telegramMtprotoService.isReady()) {
    const telegramChannels = channels?.telegram ||
      config.sentiment.defaultTelegramChannels.map(c => ({
        id: c,
        name: c,
        platform: 'telegram' as const,
        addedAt: Date.now(),
      }));
    if (telegramChannels.length > 0) {
      promises.push(analyzeTelegramSentiment(searchTerms, telegramChannels).catch(() => null));
    }
  }

  // Discord analysis
  if (config.sentiment.discordEnabled && discordBotService.isReady()) {
    const discordChannels = channels?.discord ||
      config.sentiment.defaultDiscordChannels.map(c => ({
        id: c,
        name: c,
        platform: 'discord' as const,
        addedAt: Date.now(),
      }));
    if (discordChannels.length > 0) {
      promises.push(analyzeDiscordSentiment(searchTerms, discordChannels).catch(() => null));
    }
  }

  // Wait for all platform analyses
  const results = await Promise.all(promises);

  // Collect successful results
  for (const result of results) {
    if (result && result.messageCount > 0) {
      platforms.push(result);
      platformsAnalyzed.push(result.platform);
    }
  }

  // Aggregate results
  return aggregatePlatformSentiment(platforms, platformsAnalyzed);
}

/**
 * Analyze Twitter sentiment
 */
async function analyzeTwitterSentiment(searchTerms: string[]): Promise<PlatformSentimentData | null> {
  if (searchTerms.length === 0) {
    return null;
  }

  try {
    const tweets = await twitterService.searchRecentTweets(searchTerms, {
      maxResults: SENTIMENT.MAX_TWEETS,
      excludeRetweets: true,
    });

    if (!tweets || tweets.length === 0) {
      return null;
    }

    const result = calculateSentiment(tweets);

    return {
      platform: 'twitter',
      messageCount: tweets.length,
      sentimentScore: result.sentimentScore,
      confidence: result.confidence,
      positivePercent: tweets.length > 0 ? (result.positiveCount / tweets.length) * 100 : 0,
      negativePercent: tweets.length > 0 ? (result.negativeCount / tweets.length) * 100 : 0,
      neutralPercent: tweets.length > 0 ?
        100 - ((result.positiveCount + result.negativeCount) / tweets.length) * 100 : 100,
      topPositiveTerms: result.topTerms
        .filter(t => t.sentiment === 'positive')
        .slice(0, 5)
        .map(t => t.term),
      topNegativeTerms: result.topTerms
        .filter(t => t.sentiment === 'negative')
        .slice(0, 5)
        .map(t => t.term),
      analyzedAt: new Date(),
    };
  } catch (error) {
    console.error('Twitter sentiment analysis failed:', error);
    return null;
  }
}

/**
 * Analyze Telegram sentiment from configured channels
 */
async function analyzeTelegramSentiment(
  searchTerms: string[],
  channels: MonitoredChannel[]
): Promise<PlatformSentimentData | null> {
  const allMessages: string[] = [];

  // Collect messages from all channels
  for (const channel of channels) {
    try {
      const messages = await telegramMtprotoService.searchMessages(channel.id, searchTerms);
      allMessages.push(...messages);
    } catch (error) {
      console.error(`Telegram channel ${channel.id} error:`, error);
    }
  }

  if (allMessages.length === 0) {
    return null;
  }

  const result = calculateSentiment(allMessages);

  return {
    platform: 'telegram',
    messageCount: allMessages.length,
    sentimentScore: result.sentimentScore,
    confidence: result.confidence,
    positivePercent: allMessages.length > 0 ? (result.positiveCount / allMessages.length) * 100 : 0,
    negativePercent: allMessages.length > 0 ? (result.negativeCount / allMessages.length) * 100 : 0,
    neutralPercent: allMessages.length > 0 ?
      100 - ((result.positiveCount + result.negativeCount) / allMessages.length) * 100 : 100,
    topPositiveTerms: result.topTerms
      .filter(t => t.sentiment === 'positive')
      .slice(0, 5)
      .map(t => t.term),
    topNegativeTerms: result.topTerms
      .filter(t => t.sentiment === 'negative')
      .slice(0, 5)
      .map(t => t.term),
    analyzedAt: new Date(),
  };
}

/**
 * Analyze Discord sentiment from configured channels
 */
async function analyzeDiscordSentiment(
  searchTerms: string[],
  channels: MonitoredChannel[]
): Promise<PlatformSentimentData | null> {
  const allMessages: string[] = [];

  // Collect messages from all channels
  for (const channel of channels) {
    try {
      const messages = await discordBotService.searchMessages(channel.id, searchTerms);
      allMessages.push(...messages);
    } catch (error) {
      console.error(`Discord channel ${channel.id} error:`, error);
    }
  }

  if (allMessages.length === 0) {
    return null;
  }

  const result = calculateSentiment(allMessages);

  return {
    platform: 'discord',
    messageCount: allMessages.length,
    sentimentScore: result.sentimentScore,
    confidence: result.confidence,
    positivePercent: allMessages.length > 0 ? (result.positiveCount / allMessages.length) * 100 : 0,
    negativePercent: allMessages.length > 0 ? (result.negativeCount / allMessages.length) * 100 : 0,
    neutralPercent: allMessages.length > 0 ?
      100 - ((result.positiveCount + result.negativeCount) / allMessages.length) * 100 : 100,
    topPositiveTerms: result.topTerms
      .filter(t => t.sentiment === 'positive')
      .slice(0, 5)
      .map(t => t.term),
    topNegativeTerms: result.topTerms
      .filter(t => t.sentiment === 'negative')
      .slice(0, 5)
      .map(t => t.term),
    analyzedAt: new Date(),
  };
}

/**
 * Aggregate sentiment from multiple platforms using weighted scoring
 */
function aggregatePlatformSentiment(
  platforms: PlatformSentimentData[],
  platformsAnalyzed: SentimentPlatform[]
): MultiPlatformSentimentAnalysis {
  if (platforms.length === 0) {
    return getDefaultMultiPlatformSentiment();
  }

  // Calculate weighted sentiment score
  let totalWeight = 0;
  let weightedScore = 0;
  let totalMessages = 0;
  let totalPositive = 0;
  let totalNegative = 0;

  // Collect all terms
  const allPositiveTerms: Map<string, number> = new Map();
  const allNegativeTerms: Map<string, number> = new Map();

  for (const platform of platforms) {
    const weight = getplatformWeight(platform.platform);
    totalWeight += weight;
    weightedScore += platform.sentimentScore * weight;
    totalMessages += platform.messageCount;
    totalPositive += (platform.positivePercent / 100) * platform.messageCount;
    totalNegative += (platform.negativePercent / 100) * platform.messageCount;

    // Aggregate top terms
    for (const term of platform.topPositiveTerms) {
      allPositiveTerms.set(term, (allPositiveTerms.get(term) || 0) + 1);
    }
    for (const term of platform.topNegativeTerms) {
      allNegativeTerms.set(term, (allNegativeTerms.get(term) || 0) + 1);
    }
  }

  // Normalize weighted score
  const aggregatedScore = totalWeight > 0 ? weightedScore / totalWeight : 0;

  // Calculate aggregate confidence
  let confidence = calculateAggregateConfidence(platforms, totalMessages);

  // Apply penalty if only one platform
  if (platforms.length === 1) {
    confidence *= (1 - SENTIMENT_AGGREGATION.SINGLE_PLATFORM_CONFIDENCE_PENALTY);
  }

  // Sort and get top terms
  const topPositiveTerms = Array.from(allPositiveTerms.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([term]) => term);

  const topNegativeTerms = Array.from(allNegativeTerms.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([term]) => term);

  // Calculate percentages
  const positivePercent = totalMessages > 0 ? (totalPositive / totalMessages) * 100 : 0;
  const negativePercent = totalMessages > 0 ? (totalNegative / totalMessages) * 100 : 0;
  const neutralPercent = 100 - positivePercent - negativePercent;

  // Calculate Twitter tweet count for backward compatibility
  const twitterPlatform = platforms.find(p => p.platform === 'twitter');
  const telegramPlatform = platforms.find(p => p.platform === 'telegram');
  const discordPlatform = platforms.find(p => p.platform === 'discord');

  return {
    hasSentimentData: true,
    tweetCount: twitterPlatform?.messageCount || 0,
    telegramMessageCount: telegramPlatform?.messageCount,
    discordMessageCount: discordPlatform?.messageCount,
    totalMessageCount: totalMessages,
    sentimentScore: aggregatedScore,
    positivePercent,
    negativePercent,
    neutralPercent,
    confidence,
    topPositiveTerms,
    topNegativeTerms,
    analyzedAt: new Date(),
    platforms,
    platformsAnalyzed,
  };
}

/**
 * Get weight for a platform
 */
function getplatformWeight(platform: SentimentPlatform): number {
  switch (platform) {
    case 'twitter':
      return SENTIMENT_AGGREGATION.WEIGHTS.TWITTER;
    case 'telegram':
      return SENTIMENT_AGGREGATION.WEIGHTS.TELEGRAM;
    case 'discord':
      return SENTIMENT_AGGREGATION.WEIGHTS.DISCORD;
    default:
      return 0;
  }
}

/**
 * Calculate aggregate confidence score
 */
function calculateAggregateConfidence(platforms: PlatformSentimentData[], totalMessages: number): number {
  if (platforms.length === 0) return 0;

  // Sample size confidence
  const sampleConfidence = Math.min(
    totalMessages / SENTIMENT_AGGREGATION.HIGH_CONFIDENCE_MESSAGES,
    1
  );

  // Average platform confidence
  const avgPlatformConfidence = platforms.reduce((sum, p) => sum + p.confidence, 0) / platforms.length;

  // Platform count bonus
  const platformBonus = platforms.length >= SENTIMENT_AGGREGATION.MIN_PLATFORMS_HIGH_CONFIDENCE ? 0.1 : 0;

  return Math.min(sampleConfidence * 0.5 + avgPlatformConfidence * 0.5 + platformBonus, 1);
}

function buildSearchTerms(tokenInfo: TokenInfo): string[] {
  const terms: string[] = [];

  // Add symbol if valid (2+ chars, alphanumeric)
  if (tokenInfo.symbol && tokenInfo.symbol.length >= 2) {
    const cleanSymbol = tokenInfo.symbol.replace(/[^a-zA-Z0-9]/g, '');
    if (cleanSymbol.length >= 2 && cleanSymbol.length <= 10) {
      terms.push(`$${cleanSymbol}`); // Cashtag format
      terms.push(cleanSymbol);
    }
  }

  // Add name if different from symbol and valid
  if (tokenInfo.name && tokenInfo.name !== tokenInfo.symbol) {
    const cleanName = tokenInfo.name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    if (cleanName.length >= 3 && cleanName.length <= 30 && cleanName.split(' ').length <= 3) {
      terms.push(cleanName);
    }
  }

  return terms;
}

function calculateSentiment(messages: string[]): SentimentResult {
  let positiveCount = 0;
  let negativeCount = 0;
  const termCounts: Map<string, TermCount> = new Map();

  for (const message of messages) {
    const lowerMessage = message.toLowerCase();
    let messagePositive = 0;
    let messageNegative = 0;

    // Count bullish keywords
    for (const keyword of BULLISH_KEYWORDS) {
      if (lowerMessage.includes(keyword)) {
        const weight = KEYWORD_WEIGHTS[keyword] || 1;
        messagePositive += weight;

        const existing = termCounts.get(keyword);
        if (existing) {
          existing.count++;
        } else {
          termCounts.set(keyword, { term: keyword, count: 1, sentiment: 'positive' });
        }
      }
    }

    // Count bearish keywords
    for (const keyword of BEARISH_KEYWORDS) {
      if (lowerMessage.includes(keyword)) {
        const weight = KEYWORD_WEIGHTS[keyword] || 1;
        messageNegative += weight;

        const existing = termCounts.get(keyword);
        if (existing) {
          existing.count++;
        } else {
          termCounts.set(keyword, { term: keyword, count: 1, sentiment: 'negative' });
        }
      }
    }

    // Classify message based on weighted scores
    if (messagePositive > messageNegative) {
      positiveCount++;
    } else if (messageNegative > messagePositive) {
      negativeCount++;
    }
  }

  // Calculate sentiment score (-1 to 1)
  const totalScored = positiveCount + negativeCount;
  let sentimentScore = 0;
  if (totalScored > 0) {
    sentimentScore = (positiveCount - negativeCount) / totalScored;
  }

  // Calculate confidence (based on sample size and clarity)
  const sampleConfidence = Math.min(messages.length / SENTIMENT.HIGH_CONFIDENCE_TWEETS, 1);
  const clarityConfidence = totalScored > 0 ? Math.abs(sentimentScore) : 0;
  const confidence = sampleConfidence * 0.6 + clarityConfidence * 0.4;

  // Get top terms sorted by count
  const topTerms = Array.from(termCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    positiveCount,
    negativeCount,
    sentimentScore,
    confidence,
    topTerms,
  };
}

export function getDefaultSentiment(): SentimentAnalysis {
  return {
    hasSentimentData: false,
    tweetCount: 0,
    sentimentScore: 0,
    positivePercent: 0,
    negativePercent: 0,
    neutralPercent: 100,
    confidence: 0,
    topPositiveTerms: [],
    topNegativeTerms: [],
    analyzedAt: new Date(),
  };
}

export function getDefaultMultiPlatformSentiment(): MultiPlatformSentimentAnalysis {
  return {
    hasSentimentData: false,
    tweetCount: 0,
    totalMessageCount: 0,
    sentimentScore: 0,
    positivePercent: 0,
    negativePercent: 0,
    neutralPercent: 100,
    confidence: 0,
    topPositiveTerms: [],
    topNegativeTerms: [],
    analyzedAt: new Date(),
    platforms: [],
    platformsAnalyzed: [],
  };
}
