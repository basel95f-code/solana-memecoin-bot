# Mugetsu Bot Features - Implementation Plan
## 6 New Scam Detection Features

**Priority Order:**
1. Bundle Check (highest value)
2. Funded Wallet Tracker
3. Early Pump.fun Wallets
4. Twitter Reuse Detection
5. Common Top Traders
6. Reverse Image Search

---

## Feature 1: Bundle Check (/bundle) 🔴 PRIORITY 1

### What It Does
Detects coordinated wallet clusters (sybil attacks) by analyzing:
- Wallets funded from same source
- Wallets created around same time
- Coordinated buys within seconds

### Files to Create/Modify
```
src/analysis/bundleDetector.ts        (NEW - core logic)
src/telegram/commands/scamDetection.ts (NEW - /bundle command)
src/database/schema/bundleFlags.ts     (NEW - Supabase schema)
```

### Implementation Steps

#### 1. Core Service: `src/analysis/bundleDetector.ts`
```typescript
export interface BundleCluster {
  clusterId: string;
  wallets: string[];
  commonFunder: string;
  funderLabel?: string;
  creationTimeSpan: number; // Seconds between oldest/newest wallet
  totalHoldings: number;
  totalPercentage: number;
  coordinatedBuys: CoordinatedBuy[];
  riskScore: number; // 0-100
  isSuspicious: boolean;
  suspicionReasons: string[];
}

export interface CoordinatedBuy {
  wallets: string[];
  timeSpan: number; // Seconds between first/last buy
  totalAmount: number;
  averageTimeDelta: number; // Avg seconds between buys
}

async function detectBundles(
  tokenMint: string,
  topHolders: HolderInfo[]
): Promise<BundleCluster[]>
```

**Logic:**
1. Get top 50 holders
2. For each wallet:
   - Trace funding source (use existing `findWalletFunder`)
   - Get wallet creation timestamp (first SOL in)
   - Get token purchase timestamp
3. Group wallets by common funder
4. For each group with 3+ wallets:
   - Check creation time clustering (< 1 hour apart = suspicious)
   - Check purchase time clustering (< 60 seconds = coordinated)
   - Calculate risk score
5. Flag clusters with risk > 70

#### 2. Telegram Command: `/bundle <token>`
```typescript
bot.command('bundle', async (ctx) => {
  // 1. Parse token address
  // 2. Get holders
  // 3. Call detectBundles()
  // 4. Format results with emojis/warnings
  // 5. Store flagged bundles in Supabase
});
```

**Response Format:**
```
🚨 Bundle Detection Results

Token: BONK (address)
Analyzed: 50 top holders

⚠️ SUSPICIOUS BUNDLES FOUND: 2

Cluster #1 (🔴 High Risk - 85/100)
├─ Wallets: 8
├─ Total Holdings: 12.3%
├─ Common Funder: 7xKj...Hd9P
├─ Created within: 23 minutes
└─ Coordinated buys: 8 buys in 41 seconds

Reasons:
• 8 wallets funded from same unknown source
• All created within 23 minutes
• Synchronized buys (41s window)
• Controls 12.3% of supply

Cluster #2 (🟡 Medium Risk - 65/100)
...

Overall Risk: 🔴 HIGH (bundle attack likely)
```

#### 3. Database Schema: `bundleFlags` Table
```sql
CREATE TABLE bundle_flags (
  id UUID PRIMARY KEY,
  token_mint TEXT NOT NULL,
  cluster_id TEXT NOT NULL,
  wallets TEXT[], -- Array of wallet addresses
  common_funder TEXT,
  total_percentage DECIMAL,
  risk_score INTEGER,
  detected_at TIMESTAMP DEFAULT NOW()
);
```

---

## Feature 2: Funded Wallet Tracker (/funded <wallet>) 🔴 PRIORITY 2

### What It Does
Traces where a wallet got its initial SOL from:
- CEX withdrawal (legitimate)
- Unknown wallet (suspicious)
- Known dev/insider wallet (red flag)

### Files to Create/Modify
```
src/analysis/fundingTracer.ts         (NEW - core logic)
src/telegram/commands/scamDetection.ts (MODIFY - add /funded)
src/database/schema/knownDevs.ts       (NEW - dev wallet registry)
```

### Implementation Steps

#### 1. Core Service: `src/analysis/fundingTracer.ts`
```typescript
export interface FundingTrace {
  walletAddress: string;
  initialFunder: string;
  funderType: 'cex' | 'unknown' | 'dev_wallet' | 'faucet';
  funderLabel?: string; // "Binance", "Known Rugger", etc.
  fundingAmount: number; // SOL amount
  fundingTimestamp: Date;
  walletAge: number; // Hours since creation
  isFreshWallet: boolean; // < 24h old
  riskScore: number;
  warnings: string[];
}

async function traceFunding(walletAddress: string): Promise<FundingTrace>
```

**Logic:**
1. Get wallet's first incoming SOL transaction
2. Identify funder wallet
3. Check funder against:
   - Known CEX list (KNOWN_FUNDERS from walletCluster.ts)
   - Known dev/scammer database
   - Cross-reference with other flagged tokens
4. Calculate risk score:
   - CEX funder = 0 risk
   - Unknown wallet < 1 day old = 60 risk
   - Known dev wallet = 90 risk

#### 2. Telegram Command: `/funded <wallet>`
```typescript
bot.command('funded', async (ctx) => {
  // Format similar to /bundle but for single wallet
});
```

**Response Format:**
```
💰 Wallet Funding Trace

Wallet: 7xKj...Hd9P
Age: 3 hours old ⏰

🔍 Initial Funding:
├─ Source: 9Bvz...Qm3K
├─ Type: Unknown Wallet
├─ Amount: 2.5 SOL
└─ Time: 2026-01-28 11:23 UTC

⚠️ WARNINGS:
• Fresh wallet (< 24h old)
• Funded from unknown source
• Funder also funded 12 other wallets

Risk Score: 🔴 75/100 (suspicious)
```

---

## Feature 3: Early Pump.fun Wallets (/early_wallets <token>) 🟡 PRIORITY 3

### What It Does
For pump.fun tokens, shows wallets that bought in first 10-20 transactions.

### Files to Create/Modify
```
src/analysis/earlyBuyers.ts            (NEW)
src/services/pumpfun.ts                (MODIFY - add getEarlyBuyers)
src/telegram/commands/scamDetection.ts (MODIFY)
```

### Implementation Steps

#### 1. Core Service: `src/analysis/earlyBuyers.ts`
```typescript
export interface EarlyBuyer {
  wallet: string;
  buyRank: number; // 1st, 2nd, 3rd buyer
  buyAmount: number;
  buyTimestamp: Date;
  currentHoldings: number;
  percentSold: number;
  isInsider: boolean; // Bought in first 5 txs
  hasExited: boolean; // Sold 100%
}

async function getEarlyBuyers(
  tokenMint: string,
  limit: number = 20
): Promise<EarlyBuyer[]>
```

**Logic:**
1. Get token's first 50 transactions (Solana RPC)
2. Filter for token purchases
3. Track each wallet's position (1st, 2nd, 3rd buyer)
4. Get current holdings for each early buyer
5. Flag if bought in first 5 (likely insider) and already sold

#### 2. Telegram Command: `/early_wallets <token>`
```
🏁 Early Buyers Analysis

Token: BONK
Bonding Curve: 67% filled

Top 10 Early Buyers:

#1 - 7xKj...Hd9P (INSIDER 🚨)
├─ Bought: Block 2 (23:11:02)
├─ Amount: 50 SOL
├─ Status: ❌ Sold 100% at block 145
└─ Profit: +125 SOL 🏃 DUMPED

#2 - 9Bvz...Qm3K (INSIDER 🚨)
├─ Bought: Block 3 (23:11:05)
├─ Amount: 30 SOL
└─ Status: ✅ Still holding 85%

...

⚠️ WARNING:
• 3/10 early insiders already exited
• Average insider profit: +215%
```

---

## Feature 4: Twitter Reuse Detection (/twitter_reuse <token>) 🟡 PRIORITY 4

### What It Does
Checks if token's Twitter account was recycled from a previous rug.

### Files to Create/Modify
```
src/analysis/twitterReuse.ts           (NEW)
src/services/twitter.ts                (NEW - Twitter API v2)
src/database/schema/twitterHistory.ts  (NEW)
src/telegram/commands/scamDetection.ts (MODIFY)
```

### Implementation Steps

#### 1. Core Service: `src/analysis/twitterReuse.ts`
```typescript
export interface TwitterReuseCheck {
  handle: string;
  accountCreated: Date;
  handleChangedRecently: boolean;
  previousHandles?: string[];
  linkedToRugs: boolean;
  ruggedTokens?: string[];
  riskScore: number;
  warnings: string[];
}

async function checkTwitterReuse(twitterHandle: string): Promise<TwitterReuseCheck>
```

**Logic:**
1. Call Twitter API to get account creation date
2. Check handle history (requires archive or database tracking)
3. Query database for handle in previous rugged tokens
4. Flag if:
   - Handle changed in last 7 days
   - Account < 30 days old
   - Previously linked to rug

#### 2. Database Schema
```sql
CREATE TABLE twitter_token_history (
  id UUID PRIMARY KEY,
  token_mint TEXT NOT NULL,
  twitter_handle TEXT NOT NULL,
  observed_at TIMESTAMP DEFAULT NOW(),
  was_rugged BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_twitter_handle ON twitter_token_history(twitter_handle);
```

#### 3. Telegram Command: `/twitter_reuse <token>`
```
🐦 Twitter Account Check

Token: SCAM
Handle: @meme_coin_2024

Account Age: 8 days old ⏰
Created: 2026-01-20

⚠️ SUSPICIOUS ACTIVITY:
• Account created < 30 days ago
• Handle was previously @rug_token_jan
• Previous handle linked to 2 rugged tokens:
  ├─ FAKE (rugged 2026-01-15)
  └─ SCAM1 (rugged 2026-01-18)

Risk Score: 🔴 95/100 (likely reused account)
```

**Note:** Requires Twitter API v2 access (costs $$). Alternative: scrape or use archive.org.

---

## Feature 5: Common Top Traders (/common_traders <token1> <token2>) 🟢 PRIORITY 5

### What It Does
Finds wallets appearing as top holders in multiple tokens (coordinated pump groups).

### Files to Create/Modify
```
src/analysis/commonTraders.ts          (NEW)
src/telegram/commands/scamDetection.ts (MODIFY)
```

### Implementation Steps

#### 1. Core Service: `src/analysis/commonTraders.ts`
```typescript
export interface CommonTrader {
  wallet: string;
  tokensInCommon: number;
  percentageInToken1: number;
  percentageInToken2: number;
  totalInvested: number;
  isWhale: boolean;
}

async function findCommonTraders(
  token1: string,
  token2: string
): Promise<CommonTrader[]>
```

**Logic:**
1. Get top 50 holders for both tokens
2. Find intersection (wallets in both)
3. Calculate holdings % in each
4. Flag if overlap > 30% of top holders

#### 2. Telegram Command: `/common_traders <token1> <token2>`
```
🔗 Common Top Traders

Token 1: BONK (7xK...9P)
Token 2: WIF (9Bv...3K)

Common Holders: 12 wallets (24% overlap)

Top 5 Common Traders:

#1 - 7xKj...Hd9P
├─ BONK: 3.2% (rank #4)
├─ WIF: 4.1% (rank #2)
└─ Total: ~$125k

#2 - 9Bvz...Qm3K
...

⚠️ Moderate overlap detected (24%)
This could indicate coordinated trading.
```

---

## Feature 6: Reverse Image Search (/image_check <token>) 🟢 PRIORITY 6

### What It Does
Checks if token's logo has been used before (copy-paste scams).

### Files to Create/Modify
```
src/analysis/imageCheck.ts             (NEW)
src/services/imageHash.ts              (NEW - perceptual hashing)
src/database/schema/tokenImages.ts     (NEW)
src/telegram/commands/scamDetection.ts (MODIFY)
```

### Implementation Steps

#### 1. Core Service: `src/analysis/imageCheck.ts`
```typescript
export interface ImageMatch {
  tokenMint: string;
  symbol: string;
  similarity: number; // 0-100%
  isExactMatch: boolean;
  wasRugged: boolean;
}

export interface ImageCheckResult {
  imageUrl: string;
  imageHash: string;
  matches: ImageMatch[];
  isUnique: boolean;
  riskScore: number;
  warnings: string[];
}

async function checkImageReuse(imageUrl: string): Promise<ImageCheckResult>
```

**Logic:**
1. Download token image
2. Generate perceptual hash (pHash or dHash)
3. Compare hash against database of known token images
4. Flag if hash similarity > 95%
5. Flag if matched token was rugged

#### 2. Perceptual Hashing Library
Use: `sharp` + custom pHash implementation or `blockhash-js`

```typescript
import sharp from 'sharp';
import { blockhash } from 'blockhash-js';

async function generateImageHash(imageUrl: string): Promise<string> {
  const buffer = await fetch(imageUrl).then(r => r.arrayBuffer());
  const img = sharp(Buffer.from(buffer));
  const hash = await blockhash(img, 16); // 16x16 hash
  return hash;
}
```

#### 3. Database Schema
```sql
CREATE TABLE token_images (
  id UUID PRIMARY KEY,
  token_mint TEXT UNIQUE NOT NULL,
  image_url TEXT,
  image_hash TEXT NOT NULL,
  was_rugged BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_image_hash ON token_images(image_hash);
```

#### 4. Telegram Command: `/image_check <token>`
```
🖼️ Image Reuse Check

Token: SCAM
Logo: [image preview]

Image Hash: a3f7d9e2b1c4...

✅ Image appears unique (no matches found)

OR:

⚠️ MATCH FOUND:
├─ Token: FAKE (7xK...9P)
├─ Similarity: 98%
├─ Status: RUGGED on 2026-01-15
└─ Same image used for known scam

Risk Score: 🔴 100/100 (stolen branding)
```

---

## Implementation Order & Timeline

### Week 1: Bundle Check
- Day 1-2: Core `bundleDetector.ts` logic
- Day 3: `/bundle` command
- Day 4: Testing & bug fixes
- Day 5: Database schema + flagging system

### Week 2: Funded Wallet Tracker
- Day 1-2: `fundingTracer.ts` + dev wallet registry
- Day 3: `/funded` command
- Day 4-5: Testing

### Week 3: Early Pump.fun Wallets
- Day 1-2: `earlyBuyers.ts`
- Day 3: `/early_wallets` command
- Day 4-5: Testing

### Week 4: Twitter Reuse + Common Traders
- Day 1-2: Twitter API integration
- Day 3: `/twitter_reuse` command
- Day 4: `/common_traders` command
- Day 5: Testing

### Week 5: Image Check
- Day 1-2: Image hashing service
- Day 3: `/image_check` command
- Day 4-5: Testing + database population

---

## Shared Infrastructure Needed

### 1. Scam Detection Commands File
```
src/telegram/commands/scamDetection.ts
```
Consolidate all 6 commands in one file.

### 2. Database Migrations
```
supabase/migrations/add_scam_detection_tables.sql
```
One migration file with all schemas.

### 3. Utility: Risk Score Calculator
```
src/utils/riskScoring.ts
```
Shared logic for calculating 0-100 risk scores.

### 4. Formatters
```
src/telegram/formatters.ts (UPDATE)
```
Add formatters for all 6 command responses.

---

## Testing Strategy

1. **Unit Tests:**
   - Each analysis function tested with mock data
   - Risk score calculation edge cases

2. **Integration Tests:**
   - Test commands with real Solana addresses
   - Verify Supabase writes

3. **Real-World Testing:**
   - Test on known rug tokens (verify detection works)
   - Test on legitimate tokens (verify no false positives)

---

## Cost Considerations

- **Solana RPC Calls:** Heavy usage (consider paid RPC endpoint)
- **Twitter API:** $100/month for v2 basic tier
- **Image Storage:** Minimal (hashes only, ~32 bytes per token)
- **Database:** Moderate (estimate 1GB for 100k tokens)

---

## Next Steps

1. ✅ Review this plan
2. Approve priority order
3. Start with **Feature 1: Bundle Check**
4. Implement iteratively (ship each feature independently)

Ready to start coding when you give the green light! 🚀
