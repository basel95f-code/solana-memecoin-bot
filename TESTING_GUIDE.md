# Scam Detection Testing Guide

## 🧪 Quick Test Commands

Test these in your Telegram bot to verify database integration:

### 1. Test Bundle Detection ✅
```
/bundle DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
```
**Expected:**
- Bot analyzes top 50 holders
- Shows bundle clusters (if any)
- Saves results to `bundle_flags` table

**Verify in Supabase:**
```sql
SELECT * FROM bundle_flags ORDER BY detected_at DESC LIMIT 5;
```

---

### 2. Test Funding Tracer ✅
```
/funded 7xKjH3RqkDrWZ9dTgFJnVw8HvMhZQnHd9PqN5Xk8Ym3K
```
**Expected:**
- Bot traces wallet funding source
- Shows funder type (CEX/unknown/dev_wallet)
- Saves to `funding_traces` table

**Verify in Supabase:**
```sql
SELECT * FROM funding_traces ORDER BY traced_at DESC LIMIT 5;
```

---

### 3. Test Early Wallets ✅
```
/early_wallets DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
```
**Expected:**
- Shows first 20 buyers
- Flags insiders (first 5)
- Saves suspicious insiders to `known_dev_wallets`

**Verify in Supabase:**
```sql
SELECT * FROM known_dev_wallets WHERE classification = 'insider' ORDER BY flagged_at DESC LIMIT 5;
```

---

### 4. Test Twitter Reuse ⚠️
```
/twitter_reuse meme_coin_2024
```
**Expected:**
- Checks if handle linked to rugged tokens
- Shows account age
- ⚠️ NOT saving (would need token parameter)

**Note:** To enable saving, change command to accept token:
```
/twitter_reuse <token> <handle>
```

---

### 5. Test Common Traders ℹ️
```
/common_traders DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM
```
**Expected:**
- Shows wallet overlap
- Calculates coordination risk
- ℹ️ Doesn't save (analysis only)

---

### 6. Test Image Check ✅
```
/image_check DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 https://example.com/logo.png
```
**Expected:**
- Generates image hash
- Checks for duplicates
- Saves to `token_images` table

**Verify in Supabase:**
```sql
SELECT * FROM token_images ORDER BY created_at DESC LIMIT 5;
```

---

## 📊 Database Queries for Verification

### Check All Tables Have Data
```sql
-- Bundle flags
SELECT COUNT(*) as bundle_count FROM bundle_flags;

-- Funding traces
SELECT COUNT(*) as funding_count FROM funding_traces;

-- Known dev wallets
SELECT COUNT(*) as dev_wallet_count FROM known_dev_wallets;

-- Twitter history
SELECT COUNT(*) as twitter_count FROM twitter_token_history;

-- Token images
SELECT COUNT(*) as image_count FROM token_images;
```

### View Recent Scam Detections
```sql
-- Most suspicious bundles
SELECT 
  token_mint,
  wallet_count,
  total_percentage,
  risk_score,
  detected_at
FROM bundle_flags
WHERE is_suspicious = true
ORDER BY risk_score DESC
LIMIT 10;

-- Fresh suspicious wallets
SELECT 
  wallet_address,
  funder_type,
  risk_score,
  is_fresh_wallet,
  traced_at
FROM funding_traces
WHERE is_fresh_wallet = true AND risk_score >= 60
ORDER BY traced_at DESC
LIMIT 10;

-- Known insiders who dumped
SELECT 
  wallet_address,
  classification,
  reputation_score,
  evidence_notes,
  flagged_at
FROM known_dev_wallets
WHERE classification = 'insider'
ORDER BY flagged_at DESC
LIMIT 10;
```

---

## 🚨 Test With Real Scam Tokens

For realistic testing, use known rug tokens:

1. Find a recent rug on https://rugcheck.xyz/advanced
2. Copy the token mint
3. Run all 6 commands on it
4. Should see high risk scores and flagged data

---

## ✅ Expected Database State After Full Test

After running all test commands, your Supabase tables should have:

| Table | Expected Rows | From Command |
|-------|---------------|--------------|
| bundle_flags | 1-5 rows | /bundle |
| funding_traces | 1+ rows | /funded |
| known_dev_wallets | 0-3 rows | /early_wallets (if insiders exited) |
| twitter_token_history | 0 rows | /twitter_reuse (not saving yet) |
| token_images | 1 row | /image_check |

---

## 🐛 Troubleshooting

### No Data Appearing?

**1. Check Supabase credentials:**
```bash
# In apps/bot/.env
SUPABASE_URL=https://xeifjvnhdcyqmrgoanvn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=(should be long JWT starting with eyJ...)
```

**2. Check bot logs:**
```bash
npm run dev:bot
# Look for "Saved bundle flag for..." or errors
```

**3. Check tables exist:**
```sql
-- Run in Supabase SQL Editor
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
AND table_name IN ('bundle_flags', 'funding_traces', 'known_dev_wallets', 'twitter_token_history', 'token_images');
```

**4. Test database connection:**
```typescript
// Add to bot startup
const { data, error } = await supabaseDb.getDb().from('bundle_flags').select('count');
console.log('DB test:', error ? 'FAILED' : 'OK');
```

---

## 🎯 Success Criteria

✅ All 4 primary commands save data:
- `/bundle` → bundle_flags ✅
- `/funded` → funding_traces ✅
- `/early_wallets` → known_dev_wallets ✅
- `/image_check` → token_images ✅

✅ Data visible in Supabase dashboard

✅ No errors in bot logs

✅ Risk scores calculated correctly

✅ Timestamps populated
