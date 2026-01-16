/**
 * Backfill Historical Outcomes
 * Populates token_outcomes table from existing token_analysis data
 *
 * Usage: npx ts-node scripts/backfill-outcomes.ts [--days=30] [--limit=500] [--dry-run]
 */

import { database } from '../src/database';
import { dexScreenerService } from '../src/services/dexscreener';
import { logger } from '../src/utils/logger';

// Configuration
const BATCH_SIZE = 30; // DexScreener batch limit
const DELAY_BETWEEN_BATCHES_MS = 1000; // Rate limit friendly
const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 500;

// Outcome thresholds (same as outcomeTracker)
const RUG_LIQUIDITY_DROP = 0.2;
const RUG_PRICE_DROP = 0.1;
const PUMP_THRESHOLD = 2.0;
const STABLE_RANGE = 0.3;

interface AnalysisRecord {
  mint: string;
  symbol: string;
  name: string;
  riskScore: number;
  liquidityUsd: number;
  holderCount: number;
  top10Percent: number;
  mintRevoked: boolean;
  freezeRevoked: boolean;
  lpBurnedPercent: number;
  hasTwitter: boolean;
  hasTelegram: boolean;
  hasWebsite: boolean;
  analyzedAt: number;
}

interface OutcomeResult {
  mint: string;
  symbol: string;
  outcome: string;
  peakMultiplier: number;
  finalMultiplier: number;
  initialPrice: number;
  currentPrice: number;
  initialLiquidity: number;
  currentLiquidity: number;
}

function parseArgs(): { days: number; limit: number; dryRun: boolean } {
  const args = process.argv.slice(2);
  let days = DEFAULT_DAYS;
  let limit = DEFAULT_LIMIT;
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--days=')) {
      days = parseInt(arg.split('=')[1]) || DEFAULT_DAYS;
    } else if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1]) || DEFAULT_LIMIT;
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { days, limit, dryRun };
}

function classifyOutcome(
  initialPrice: number,
  currentPrice: number,
  peakPrice: number,
  initialLiquidity: number,
  currentLiquidity: number
): { outcome: string; confidence: number } {
  const peakMultiplier = initialPrice > 0 ? peakPrice / initialPrice : 1;
  const finalMultiplier = initialPrice > 0 ? currentPrice / initialPrice : 1;
  const liquidityRatio = initialLiquidity > 0 ? currentLiquidity / initialLiquidity : 1;

  // Check for rug
  if (liquidityRatio < RUG_LIQUIDITY_DROP || finalMultiplier < RUG_PRICE_DROP) {
    const confidence = Math.min(1, (1 - liquidityRatio) + (1 - finalMultiplier)) / 2;
    return { outcome: 'rug', confidence };
  }

  // Check for pump (even if dumped after)
  if (peakMultiplier >= PUMP_THRESHOLD) {
    const confidence = Math.min(1, (peakMultiplier - 1) / 5);
    return { outcome: 'pump', confidence };
  }

  // Check for stable
  if (finalMultiplier >= (1 - STABLE_RANGE) && finalMultiplier <= (1 + STABLE_RANGE)) {
    const confidence = 1 - Math.abs(1 - finalMultiplier) / STABLE_RANGE;
    return { outcome: 'stable', confidence };
  }

  // Slow decline
  if (finalMultiplier < 1) {
    return { outcome: 'slow_decline', confidence: 1 - finalMultiplier };
  }

  return { outcome: 'unknown', confidence: 0.5 };
}

async function getTokensToBackfill(days: number, limit: number): Promise<AnalysisRecord[]> {
  const db = database['db'];
  if (!db) return [];

  const cutoffTime = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);

  // Get tokens from token_analysis that don't have outcomes yet
  const result = db.exec(`
    SELECT
      ta.mint,
      ta.symbol,
      ta.name,
      ta.risk_score,
      ta.liquidity_usd,
      ta.total_holders,
      ta.top10_percent,
      ta.mint_revoked,
      ta.freeze_revoked,
      ta.lp_burned_percent,
      ta.has_twitter,
      ta.has_telegram,
      ta.has_website,
      ta.analyzed_at
    FROM token_analysis ta
    LEFT JOIN token_outcomes toc ON ta.mint = toc.mint
    WHERE ta.analyzed_at >= ?
      AND toc.mint IS NULL
      AND ta.liquidity_usd > 0
    ORDER BY ta.analyzed_at DESC
    LIMIT ?
  `, [cutoffTime, limit]);

  if (result.length === 0) return [];

  const columns = result[0].columns;
  return result[0].values.map(values => {
    const row: any = {};
    columns.forEach((col, i) => {
      row[col] = values[i];
    });

    return {
      mint: row.mint,
      symbol: row.symbol || 'UNKNOWN',
      name: row.name || '',
      riskScore: row.risk_score || 0,
      liquidityUsd: row.liquidity_usd || 0,
      holderCount: row.total_holders || 0,
      top10Percent: row.top10_percent || 0,
      mintRevoked: row.mint_revoked === 1,
      freezeRevoked: row.freeze_revoked === 1,
      lpBurnedPercent: row.lp_burned_percent || 0,
      hasTwitter: row.has_twitter === 1,
      hasTelegram: row.has_telegram === 1,
      hasWebsite: row.has_website === 1,
      analyzedAt: row.analyzed_at,
    };
  });
}

async function processBatch(
  tokens: AnalysisRecord[],
  dryRun: boolean
): Promise<OutcomeResult[]> {
  const mints = tokens.map(t => t.mint);
  const results: OutcomeResult[] = [];

  try {
    const pairDataMap = await dexScreenerService.getMultipleTokensData(mints);
    const now = Math.floor(Date.now() / 1000);

    for (const token of tokens) {
      const pairData = pairDataMap.get(token.mint);

      // Get current price and liquidity
      const currentPrice = pairData ? parseFloat(pairData.priceUsd || '0') : 0;
      const currentLiquidity = pairData?.liquidity?.usd || 0;

      // Estimate initial price from liquidity (rough approximation)
      // This is imperfect but gives us something to work with
      const initialPrice = token.liquidityUsd > 0 && currentLiquidity > 0 && currentPrice > 0
        ? currentPrice * (token.liquidityUsd / currentLiquidity)
        : currentPrice;

      // Use current as peak (we don't have historical peak data)
      // For rugs, current will be near 0, so this works
      // For pumps that dumped, we'll miss the peak - classify based on current state
      const peakPrice = Math.max(initialPrice, currentPrice);

      const { outcome, confidence } = classifyOutcome(
        initialPrice,
        currentPrice,
        peakPrice,
        token.liquidityUsd,
        currentLiquidity
      );

      const peakMultiplier = initialPrice > 0 ? peakPrice / initialPrice : 1;
      const finalMultiplier = initialPrice > 0 ? currentPrice / initialPrice : 0;

      results.push({
        mint: token.mint,
        symbol: token.symbol,
        outcome,
        peakMultiplier,
        finalMultiplier,
        initialPrice,
        currentPrice,
        initialLiquidity: token.liquidityUsd,
        currentLiquidity,
      });

      if (!dryRun) {
        // Save initial state
        database.saveTokenOutcomeInitial({
          mint: token.mint,
          symbol: token.symbol,
          initialPrice,
          initialLiquidity: token.liquidityUsd,
          initialRiskScore: token.riskScore,
          initialHolders: token.holderCount,
          initialTop10Percent: token.top10Percent,
          discoveredAt: token.analyzedAt,
        });

        // Save final outcome
        database.saveTokenOutcomeFinal({
          mint: token.mint,
          symbol: token.symbol,
          outcome,
          outcomeConfidence: confidence,
          peakPrice,
          peakLiquidity: Math.max(token.liquidityUsd, currentLiquidity),
          finalPrice: currentPrice,
          finalLiquidity: currentLiquidity,
          peakMultiplier,
          timeToOutcome: now - token.analyzedAt,
          outcomeRecordedAt: now,
        });
      }
    }
  } catch (error) {
    console.error('Batch processing error:', (error as Error).message);
  }

  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const { days, limit, dryRun } = parseArgs();

  console.log('=== Backfill Historical Outcomes ===\n');
  console.log(`Configuration:`);
  console.log(`  Days: ${days}`);
  console.log(`  Limit: ${limit}`);
  console.log(`  Dry run: ${dryRun}`);
  console.log('');

  // Initialize database
  console.log('Initializing database...');
  await database.initialize();

  // Get tokens to backfill
  console.log('Finding tokens to backfill...');
  const tokens = await getTokensToBackfill(days, limit);
  console.log(`Found ${tokens.length} tokens without outcomes\n`);

  if (tokens.length === 0) {
    console.log('No tokens to process.');
    return;
  }

  // Process in batches
  const stats = {
    total: 0,
    rug: 0,
    pump: 0,
    stable: 0,
    slow_decline: 0,
    unknown: 0,
  };

  const batches = Math.ceil(tokens.length / BATCH_SIZE);
  console.log(`Processing ${batches} batches...\n`);

  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    process.stdout.write(`Batch ${batchNum}/${batches}: `);

    const results = await processBatch(batch, dryRun);

    // Update stats
    for (const result of results) {
      stats.total++;
      stats[result.outcome as keyof typeof stats]++;
    }

    // Show batch summary
    const batchSummary = results.map(r => {
      const emoji = r.outcome === 'rug' ? '💀' :
                   r.outcome === 'pump' ? '🚀' :
                   r.outcome === 'stable' ? '➡️' :
                   r.outcome === 'slow_decline' ? '📉' : '❓';
      return emoji;
    }).join('');
    console.log(batchSummary);

    // Rate limit delay
    if (i + BATCH_SIZE < tokens.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  // Print summary
  console.log('\n=== Summary ===\n');
  console.log(`Total processed: ${stats.total}`);
  console.log(`  💀 Rug: ${stats.rug} (${((stats.rug / stats.total) * 100).toFixed(1)}%)`);
  console.log(`  🚀 Pump: ${stats.pump} (${((stats.pump / stats.total) * 100).toFixed(1)}%)`);
  console.log(`  ➡️  Stable: ${stats.stable} (${((stats.stable / stats.total) * 100).toFixed(1)}%)`);
  console.log(`  📉 Slow decline: ${stats.slow_decline} (${((stats.slow_decline / stats.total) * 100).toFixed(1)}%)`);
  console.log(`  ❓ Unknown: ${stats.unknown} (${((stats.unknown / stats.total) * 100).toFixed(1)}%)`);

  if (dryRun) {
    console.log('\n⚠️  Dry run - no data was saved');
  } else {
    console.log('\n✅ Data saved to token_outcomes table');

    // Show database stats
    const dbStats = database.getOutcomeStats();
    console.log(`\nDatabase now has ${dbStats.total} classified outcomes`);
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);
