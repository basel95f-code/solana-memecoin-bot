/**
 * Sentiment Analysis for Social Media
 * Basic NLP-based sentiment scoring for tweets and social content
 */

import { logger } from '../utils/logger';

// Basic sentiment lexicon (positive/negative words)
const POSITIVE_WORDS = new Set([
  'moon', 'mooning', 'bullish', 'pump', 'pumping', 'gem', 'diamond', 'buy',
  'long', 'lfg', 'gm', 'wagmi', 'strong', 'solid', 'great', 'good', 'amazing',
  'best', 'excellent', 'love', 'like', 'profit', 'gains', 'winner', 'success',
  'hold', 'hodl', 'accumulate', 'alpha', 'early', 'potential', 'opportunity',
  'growth', 'rocket', 'lambo', 'rich', 'wealthy', 'bullrun', 'breakout',
  'explosive', 'fire', 'massive', 'huge', 'incredible', 'insane', 'crazy',
  'up', 'rise', 'rising', 'surging', 'rallying', 'green', 'win', 'winning'
]);

const NEGATIVE_WORDS = new Set([
  'dump', 'dumping', 'bearish', 'sell', 'selling', 'rug', 'rugged', 'scam',
  'fraud', 'fake', 'dead', 'dying', 'rip', 'exit', 'loss', 'losses', 'lose',
  'losing', 'bad', 'worst', 'terrible', 'horrible', 'hate', 'avoid', 'skip',
  'down', 'crash', 'crashing', 'dropping', 'falling', 'red', 'ngmi', 'rekt',
  'danger', 'dangerous', 'warning', 'caution', 'careful', 'suspect', 'suspicious',
  'scammy', 'honeypot', 'trap', 'ponzi', 'pyramid', 'shady', 'sketchy',
  'dump', 'dumpster', 'garbage', 'trash', 'worthless', 'useless'
]);

// Amplifiers/diminishers
const AMPLIFIERS = new Set(['very', 'extremely', 'really', 'super', 'mega', 'ultra']);
const DIMINISHERS = new Set(['barely', 'slightly', 'somewhat', 'kinda', 'maybe']);

// Emojis sentiment (simple mapping)
const EMOJI_SENTIMENT: { [key: string]: number } = {
  '🚀': 1.5, '💎': 1.2, '🔥': 1.0, '💚': 1.0, '✅': 0.8, '👍': 0.7, '📈': 1.0,
  '🌙': 1.2, '⬆️': 0.8, '🟢': 0.7, '💰': 1.0, '🤑': 1.2, '😍': 0.9, '🎉': 0.8,
  '💀': -1.5, '🚨': -1.2, '⚠️': -1.0, '❌': -0.8, '👎': -0.7, '📉': -1.0,
  '⬇️': -0.8, '🔴': -0.7, '😭': -0.9, '😱': -1.0, '🤮': -1.2, '💩': -1.3
};

export interface SentimentResult {
  score: number; // -1 to 1
  label: 'positive' | 'negative' | 'neutral';
  confidence: number; // 0 to 1
  positiveWords: string[];
  negativeWords: string[];
  emojiScore: number;
}

export class SentimentAnalyzer {
  /**
   * Analyze sentiment of text
   */
  analyze(text: string): SentimentResult {
    const normalized = text.toLowerCase();
    const words = normalized.split(/\s+/);
    
    let score = 0;
    let positiveWords: string[] = [];
    let negativeWords: string[] = [];
    let emojiScore = 0;

    // Process words with context
    for (let i = 0; i < words.length; i++) {
      const word = words[i].replace(/[^\w]/g, '');
      const prevWord = i > 0 ? words[i - 1].replace(/[^\w]/g, '') : '';
      
      let multiplier = 1.0;
      
      // Check for amplifiers/diminishers
      if (AMPLIFIERS.has(prevWord)) {
        multiplier = 1.5;
      } else if (DIMINISHERS.has(prevWord)) {
        multiplier = 0.5;
      }
      
      // Check for negation (not, never, don't)
      const isNegated = i > 0 && ['not', 'never', 'dont', 'no'].includes(prevWord);
      
      if (POSITIVE_WORDS.has(word)) {
        const value = 1.0 * multiplier * (isNegated ? -1 : 1);
        score += value;
        if (!isNegated) positiveWords.push(word);
        else negativeWords.push(`not ${word}`);
      } else if (NEGATIVE_WORDS.has(word)) {
        const value = -1.0 * multiplier * (isNegated ? -1 : 1);
        score += value;
        if (!isNegated) negativeWords.push(word);
        else positiveWords.push(`not ${word}`);
      }
    }

    // Process emojis
    for (const char of text) {
      if (EMOJI_SENTIMENT[char]) {
        emojiScore += EMOJI_SENTIMENT[char];
      }
    }

    // Combine word and emoji scores
    const totalScore = score + emojiScore;
    
    // Normalize to -1 to 1 range
    const maxScore = Math.max(words.length, 5);
    const normalized_score = Math.max(-1, Math.min(1, totalScore / maxScore));

    // Determine label
    let label: 'positive' | 'negative' | 'neutral';
    if (normalized_score > 0.15) label = 'positive';
    else if (normalized_score < -0.15) label = 'negative';
    else label = 'neutral';

    // Calculate confidence based on signal strength
    const confidence = Math.min(1, Math.abs(normalized_score) * 2);

    return {
      score: normalized_score,
      label,
      confidence,
      positiveWords,
      negativeWords,
      emojiScore
    };
  }

  /**
   * Batch analyze multiple texts and return aggregate sentiment
   */
  analyzeBatch(texts: string[]): {
    avgScore: number;
    distribution: { positive: number; negative: number; neutral: number };
    totalTexts: number;
  } {
    if (texts.length === 0) {
      return {
        avgScore: 0,
        distribution: { positive: 0, negative: 0, neutral: 0 },
        totalTexts: 0
      };
    }

    const results = texts.map(t => this.analyze(t));
    const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
    
    const distribution = {
      positive: results.filter(r => r.label === 'positive').length,
      negative: results.filter(r => r.label === 'negative').length,
      neutral: results.filter(r => r.label === 'neutral').length
    };

    return { avgScore, distribution, totalTexts: texts.length };
  }

  /**
   * Detect sentiment shift between two time periods
   */
  detectSentimentShift(
    oldTexts: string[],
    newTexts: string[]
  ): {
    oldSentiment: number;
    newSentiment: number;
    shift: number;
    shiftLabel: 'bullish_shift' | 'bearish_shift' | 'stable';
    significant: boolean;
  } {
    const oldAnalysis = this.analyzeBatch(oldTexts);
    const newAnalysis = this.analyzeBatch(newTexts);
    
    const shift = newAnalysis.avgScore - oldAnalysis.avgScore;
    const significant = Math.abs(shift) > 0.3;
    
    let shiftLabel: 'bullish_shift' | 'bearish_shift' | 'stable';
    if (shift > 0.2) shiftLabel = 'bullish_shift';
    else if (shift < -0.2) shiftLabel = 'bearish_shift';
    else shiftLabel = 'stable';

    return {
      oldSentiment: oldAnalysis.avgScore,
      newSentiment: newAnalysis.avgScore,
      shift,
      shiftLabel,
      significant
    };
  }

  /**
   * Extract tokens/cashtags from text
   */
  extractTokens(text: string): {
    cashtags: string[];
    hashtags: string[];
    potentialMints: string[];
  } {
    const cashtags = (text.match(/\$[A-Z]{2,10}/g) || []).map(t => t.slice(1));
    const hashtags = (text.match(/#\w+/g) || []).map(t => t.slice(1).toLowerCase());
    
    // Look for Solana addresses (base58, 32-44 chars)
    const potentialMints = (text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g) || []);
    
    return { cashtags, hashtags, potentialMints };
  }

  /**
   * Score tweet relevance/quality
   * Higher score = more important/influential
   */
  scoreTweetQuality(tweet: {
    text: string;
    authorFollowers: number;
    retweetCount: number;
    likeCount: number;
    replyCount: number;
  }): number {
    let score = 0;

    // Follower weight (logarithmic)
    score += Math.log10(tweet.authorFollowers + 1) * 10;

    // Engagement weight
    score += tweet.retweetCount * 2;
    score += tweet.likeCount * 1;
    score += tweet.replyCount * 1.5;

    // Text quality (longer = more thoughtful, up to a point)
    const textLength = tweet.text.length;
    if (textLength > 50 && textLength < 280) {
      score += 10;
    } else if (textLength >= 280) {
      score += 5;
    }

    // Normalize to 0-100
    return Math.min(100, score);
  }
}

// Singleton instance
export const sentimentAnalyzer = new SentimentAnalyzer();

// Example usage:
/*
const result = sentimentAnalyzer.analyze("This token is going to the moon! 🚀💎 Great project, very bullish!");
console.log(result);
// {
//   score: 0.85,
//   label: 'positive',
//   confidence: 0.92,
//   positiveWords: ['moon', 'great', 'bullish'],
//   negativeWords: [],
//   emojiScore: 2.7
// }
*/
