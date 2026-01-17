import type { SentimentAnalysis, TokenInfo } from '../types';
import { twitterService } from '../services/twitter';
import { SENTIMENT } from '../constants';

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

export async function analyzeSentiment(tokenInfo: TokenInfo): Promise<SentimentAnalysis> {
  const result = getDefaultSentiment();

  try {
    // Build search terms using symbol and name
    const searchTerms = buildSearchTerms(tokenInfo);
    if (searchTerms.length === 0) {
      return result;
    }

    // Search Twitter for recent tweets
    const tweets = await twitterService.searchRecentTweets(searchTerms, {
      maxResults: SENTIMENT.MAX_TWEETS,
      excludeRetweets: true,
    });

    if (!tweets || tweets.length === 0) {
      return result;
    }

    // Analyze sentiment
    const sentimentResult = calculateSentiment(tweets);

    // Populate result
    result.hasSentimentData = true;
    result.tweetCount = tweets.length;
    result.sentimentScore = sentimentResult.sentimentScore;
    result.confidence = sentimentResult.confidence;

    if (tweets.length > 0) {
      result.positivePercent = (sentimentResult.positiveCount / tweets.length) * 100;
      result.negativePercent = (sentimentResult.negativeCount / tweets.length) * 100;
      result.neutralPercent = 100 - result.positivePercent - result.negativePercent;
    }

    // Extract top terms
    result.topPositiveTerms = sentimentResult.topTerms
      .filter((t) => t.sentiment === 'positive')
      .slice(0, 5)
      .map((t) => t.term);

    result.topNegativeTerms = sentimentResult.topTerms
      .filter((t) => t.sentiment === 'negative')
      .slice(0, 5)
      .map((t) => t.term);

    result.analyzedAt = new Date();
  } catch (error) {
    console.error('Sentiment analysis failed:', error);
  }

  return result;
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

function calculateSentiment(tweets: string[]): {
  positiveCount: number;
  negativeCount: number;
  sentimentScore: number;
  confidence: number;
  topTerms: TermCount[];
} {
  let positiveCount = 0;
  let negativeCount = 0;
  const termCounts: Map<string, TermCount> = new Map();

  for (const tweet of tweets) {
    const lowerTweet = tweet.toLowerCase();
    let tweetPositive = 0;
    let tweetNegative = 0;

    // Count bullish keywords
    for (const keyword of BULLISH_KEYWORDS) {
      if (lowerTweet.includes(keyword)) {
        const weight = KEYWORD_WEIGHTS[keyword] || 1;
        tweetPositive += weight;

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
      if (lowerTweet.includes(keyword)) {
        const weight = KEYWORD_WEIGHTS[keyword] || 1;
        tweetNegative += weight;

        const existing = termCounts.get(keyword);
        if (existing) {
          existing.count++;
        } else {
          termCounts.set(keyword, { term: keyword, count: 1, sentiment: 'negative' });
        }
      }
    }

    // Classify tweet based on weighted scores
    if (tweetPositive > tweetNegative) {
      positiveCount++;
    } else if (tweetNegative > tweetPositive) {
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
  const sampleConfidence = Math.min(tweets.length / SENTIMENT.HIGH_CONFIDENCE_TWEETS, 1);
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
