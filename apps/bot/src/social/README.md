# Social Media Integration

Twitter monitoring, sentiment analysis, and influencer tracking for Solana tokens.

## Features

### 🐦 Twitter Monitoring
- Real-time tweet tracking via Twitter API v2
- Monitor token mentions, hashtags, and cashtags
- Track keywords: #Solana, $SOL, pump.fun, etc.
- Volume spike detection
- Automatic mention storage

### 💭 Sentiment Analysis
- Basic NLP-based sentiment scoring
- Positive/negative/neutral classification
- Emoji sentiment detection
- Sentiment trend tracking (bullish/bearish shifts)
- Aggregate sentiment per token

### 🎯 Influencer Tracking
- Automatic influencer discovery (10K+ followers)
- Track KOL (Key Opinion Leader) token calls
- Performance metrics (success rate, avg returns)
- Call outcome tracking (success/fail/pending)
- Leaderboard of top performers

### 📊 Social Metrics
- Mention volume tracking
- Trending token detection
- Influencer mention counts
- Historical sentiment data
- Social stats caching

## Architecture

```
apps/bot/src/social/
├── sentimentAnalyzer.ts   # NLP sentiment analysis
├── twitterMonitor.ts      # Twitter API integration
├── influencerTracker.ts   # Influencer performance tracking
├── index.ts               # Module exports
└── README.md
```

## Database Schema

See `supabase/migrations/20250129000000_social_integration.sql`:

- **twitter_mentions** - Tweet data and sentiment
- **influencers** - Tracked influencer profiles
- **influencer_calls** - Token calls by influencers
- **sentiment_scores** - Aggregated sentiment by token
- **social_stats_cache** - Quick lookup cache
- **discord_alerts** - Alert delivery log
- **discord_watchlist** - Discord user watchlists

## Setup

### 1. Twitter API Access

1. Apply for Twitter Developer account: https://developer.twitter.com/
2. Create a new App
3. Get Bearer Token from "Keys and tokens"
4. Add to `.env`:

```env
TWITTER_BEARER_TOKEN=your_bearer_token_here
```

**Rate Limits:**
- Essential: 450 requests / 15 min
- Elevated: 900 requests / 15 min

### 2. Database Migration

Run the migration to create social tables:

```bash
cd supabase
npx supabase db push
```

Or manually apply `20250129000000_social_integration.sql`.

### 3. Initialize Services

```typescript
import { SupabaseDB } from '../database/supabase-db';
import { TwitterMonitor, InfluencerTracker, sentimentAnalyzer } from './social';

const db = new SupabaseDB();
const influencerTracker = new InfluencerTracker(db);
const twitterMonitor = new TwitterMonitor(db, influencerTracker);

// Start monitoring
await twitterMonitor.start(60000); // Poll every 60s
```

## Usage Examples

### Sentiment Analysis

```typescript
import { sentimentAnalyzer } from './social';

const result = sentimentAnalyzer.analyze(
  "This token is going to the moon! 🚀💎 Very bullish!"
);

console.log(result);
// {
//   score: 0.85,           // -1 to 1
//   label: 'positive',
//   confidence: 0.92,
//   positiveWords: ['moon', 'bullish'],
//   negativeWords: [],
//   emojiScore: 2.7
// }
```

### Twitter Monitoring

```typescript
import { TwitterMonitor } from './social';

// Get trending tokens
const trending = await twitterMonitor.getTrendingTokens(10);

for (const token of trending) {
  console.log(`${token.symbol}: ${token.mentions24h} mentions`);
  console.log(`Sentiment: ${token.avgSentiment > 0 ? 'Bullish' : 'Bearish'}`);
  console.log(`Influencers: ${token.influencerMentions}`);
}

// Get token sentiment
const sentiment = await twitterMonitor.getTokenSentiment(tokenMint, 24);
console.log(`Total mentions: ${sentiment.totalMentions}`);
console.log(`Avg sentiment: ${sentiment.avgSentiment}`);
console.log(`Trend: ${sentiment.sentimentLabel}`);
```

### Influencer Tracking

```typescript
import { InfluencerTracker } from './social';

// Get top influencers
const topInfluencers = await influencerTracker.getTopInfluencers(10);

for (const inf of topInfluencers) {
  console.log(`@${inf.username}`);
  console.log(`Success rate: ${inf.successRate}%`);
  console.log(`Avg return: ${inf.avgReturnPercent}%`);
}

// Get influencer stats
const stats = await influencerTracker.getInfluencerStats('solana_trader');

if (stats) {
  console.log(`Total calls: ${stats.performance.totalCalls}`);
  console.log(`Win rate: ${stats.performance.successRate}%`);
  console.log(`Best call: ${stats.performance.bestCall?.symbol} (+${stats.performance.bestCall?.maxGainPercent}%)`);
}

// Record a call
await influencerTracker.recordCall({
  twitterId: '123456789',
  tweetId: '987654321',
  tokenMint: 'DezXAZ...',
  symbol: 'BONK',
  tweetText: 'BONK is going to moon! 🚀',
  calledAt: new Date()
});
```

### Auto-discover Influencers

```typescript
const discovered = await influencerTracker.discoverInfluencers(10000);
console.log(`Found ${discovered.length} potential influencers`);
```

### Update Call Outcomes

```typescript
// Periodically update pending calls with current prices
const pending = await influencerTracker.getPendingCalls(7); // Last 7 days

for (const call of pending) {
  const currentPrice = await fetchTokenPrice(call.tokenMint);
  await influencerTracker.updateCallOutcome(
    call.tweetId,
    currentPrice
  );
}
```

## Telegram Commands

Add to your Telegram bot:

### `/twitter <token>`
Show Twitter stats for a token:
- Total mentions (24h)
- Influencer mentions
- Sentiment (bullish/bearish/neutral)
- Top tweet

### `/influencers`
List tracked influencers:
- Ranked by success rate
- Follower counts
- Performance metrics

### `/influencer @username`
Detailed influencer profile:
- Win rate and avg returns
- Recent calls
- Track record

### `/social_stats`
Overall social media overview:
- Twitter activity
- Trending tokens
- Tracked influencers count

## Discord Bot Commands

See `apps/discord-bot/` for full Discord integration.

### `/check <address>`
Quick token check with social sentiment

### `/analyze <address>`
Full analysis including Twitter data

### `/track <address>`
Add to watchlist for social alerts

## Alert Integration

Social alerts automatically integrate with existing alert system:

```typescript
import { AlertManager } from '../services/alerts';

const alertManager = new AlertManager();

// Twitter mention alerts
alertManager.addAlertType('twitter_mention', {
  name: 'Twitter Mention',
  description: 'Token mentioned by influencer'
});

// Sentiment shift alerts
alertManager.addAlertType('sentiment_shift', {
  name: 'Sentiment Shift',
  description: 'Sentiment changed from bearish to bullish (or vice versa)'
});

// Influencer call alerts
alertManager.addAlertType('influencer_call', {
  name: 'Influencer Call',
  description: 'KOL called a token'
});
```

## Configuration

Customize monitoring in your config:

```typescript
export const socialConfig = {
  twitter: {
    enabled: true,
    pollInterval: 60000,        // Poll every 60s
    keywords: [
      '#Solana',
      '$SOL',
      'pump.fun',
      'raydium',
      'memecoin'
    ],
    minInfluencerFollowers: 5000
  },
  sentiment: {
    shiftThreshold: 0.3,         // Significant sentiment change
    minMentionsForTrend: 10      // Min mentions to be trending
  },
  influencers: {
    autoDiscover: true,
    minFollowers: 10000,
    trackThreshold: 5            // Auto-track if 5+ calls
  }
};
```

## Performance

**Twitter API Rate Limits:**
- Essential tier: 450 requests / 15 min
- With 100 tweets/request: 45,000 tweets / 15 min
- Recommended poll interval: 60-120 seconds

**Database Optimization:**
- Indexes on token_mint, author_id, created_at
- Cached aggregates in `social_stats_cache`
- Auto-cleanup old mentions (30 days)

**Memory Usage:**
- Sentiment analyzer: ~5 MB (lexicon)
- Twitter monitor: Minimal (stateless)
- Influencer tracker: ~1 MB per 1000 influencers

## Testing

```bash
# Test sentiment analysis
npm test src/social/sentimentAnalyzer.test.ts

# Test Twitter monitor (requires API key)
TWITTER_BEARER_TOKEN=xxx npm test src/social/twitterMonitor.test.ts

# Test influencer tracker
npm test src/social/influencerTracker.test.ts
```

## Roadmap

- [ ] Twitter Stream API (real-time instead of polling)
- [ ] Advanced NLP with transformers (BERT, RoBERTa)
- [ ] Reddit integration
- [ ] Telegram channel monitoring
- [ ] Influencer reputation scoring
- [ ] Sentiment-based trading signals
- [ ] Multi-language sentiment support

## API Documentation

**Twitter API v2:**
https://developer.twitter.com/en/docs/twitter-api

**Endpoints Used:**
- `GET /2/tweets/search/recent` - Search recent tweets
- `GET /2/users/:id` - Get user info

**Required Fields:**
- `tweet.fields`: created_at, public_metrics, entities
- `user.fields`: username, name, public_metrics, verified
- `expansions`: author_id

## Troubleshooting

**No tweets fetched?**
- Check Twitter API token is valid
- Verify rate limits haven't been exceeded
- Ensure keywords match actual tweets

**Sentiment always neutral?**
- Short tweets may lack sentiment signals
- Check lexicon includes relevant terms
- Consider using ML-based sentiment

**Influencers not discovered?**
- Lower `minInfluencerFollowers` threshold
- Check Twitter data has author metrics
- Verify `is_influencer` flag is set

## Contributing

When adding new features:

1. Update database schema in migrations
2. Add TypeScript interfaces
3. Update this README
4. Add tests
5. Update Telegram/Discord commands

## License

Part of the Solana Memecoin Bot project.
