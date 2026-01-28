/**
 * Twitter Reuse Detection
 * Checks if a token's Twitter account was previously used by other tokens
 * 
 * NOTE: Full implementation requires Twitter API v2 ($100/mo)
 * This is a simplified version that works with database tracking
 */

import { logger } from '../utils/logger';
import { supabase } from '../database/supabase';

// ============================================================================
// TYPES
// ============================================================================

export interface TwitterReuseCheck {
  handle: string;
  accountCreated: Date | null;
  accountAgeDays: number;
  handleChangedRecently: boolean;
  previousHandles?: string[];
  linkedToRugs: boolean;
  ruggedTokens: Array<{ mint: string; symbol: string; rugDate: Date }>;
  riskScore: number;
  warnings: string[];
}

// ============================================================================
// MAIN CHECK FUNCTION
// ============================================================================

/**
 * Check if a Twitter handle was previously used by rugged tokens
 */
export async function checkTwitterReuse(twitterHandle: string): Promise<TwitterReuseCheck> {
  logger.info('TwitterReuse', `Checking Twitter handle: @${twitterHandle}`);

  // Normalize handle (remove @ if present)
  const normalizedHandle = twitterHandle.startsWith('@')
    ? twitterHandle.slice(1)
    : twitterHandle;

  try {
    // Step 1: Check database for previous usage
    const ruggedTokens = await findRuggedTokensWithHandle(normalizedHandle);

    // Step 2: Get account age from database (if available)
    const accountAge = await getAccountAge(normalizedHandle);

    // Step 3: Assess risk
    const { riskScore, warnings } = assessTwitterRisk(
      normalizedHandle,
      accountAge,
      ruggedTokens
    );

    return {
      handle: normalizedHandle,
      accountCreated: accountAge?.created || null,
      accountAgeDays: accountAge?.ageDays || 0,
      handleChangedRecently: false, // Would need Twitter API
      linkedToRugs: ruggedTokens.length > 0,
      ruggedTokens,
      riskScore,
      warnings,
    };
  } catch (error) {
    logger.error('TwitterReuse', `Failed to check @${normalizedHandle}:`, error as Error);
    throw error;
  }
}

// ============================================================================
// DATABASE QUERIES
// ============================================================================

/**
 * Find rugged tokens that used this Twitter handle
 */
async function findRuggedTokensWithHandle(
  handle: string
): Promise<Array<{ mint: string; symbol: string; rugDate: Date }>> {
  try {
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('twitter_token_history')
      .select('token_mint, was_rugged, rug_date')
      .eq('twitter_handle', handle)
      .eq('was_rugged', true)
      .order('rug_date', { ascending: false });

    if (error || !data) return [];

    return data.map((row: any) => ({
      mint: row.token_mint,
      symbol: 'Unknown', // Would need token metadata
      rugDate: new Date(row.rug_date),
    }));
  } catch {
    return [];
  }
}

/**
 * Get Twitter account age from our database
 */
async function getAccountAge(
  handle: string
): Promise<{ created: Date; ageDays: number } | null> {
  try {
    if (!supabase) return null;

    const { data, error } = await supabase
      .from('twitter_token_history')
      .select('account_created_at, account_age_days')
      .eq('twitter_handle', handle)
      .order('observed_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data || !data.account_created_at) return null;

    return {
      created: new Date(data.account_created_at),
      ageDays: data.account_age_days || 0,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// RISK ASSESSMENT
// ============================================================================

/**
 * Assess Twitter reuse risk
 */
function assessTwitterRisk(
  handle: string,
  accountAge: { created: Date; ageDays: number } | null,
  ruggedTokens: Array<{ mint: string; symbol: string; rugDate: Date }>
): { riskScore: number; warnings: string[] } {
  const warnings: string[] = [];
  let riskScore = 0;

  // Risk Factor 1: Previously linked to rugs
  if (ruggedTokens.length > 0) {
    riskScore = 90; // Very high risk
    warnings.push(`🚨 CRITICAL: Handle linked to ${ruggedTokens.length} rugged token(s)`);

    ruggedTokens.slice(0, 3).forEach(token => {
      const daysAgo = Math.floor(
        (Date.now() - token.rugDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      warnings.push(`  • ${token.mint.slice(0, 8)}... rugged ${daysAgo} days ago`);
    });
  }

  // Risk Factor 2: Account age
  if (accountAge) {
    if (accountAge.ageDays < 7) {
      riskScore += 30;
      warnings.push(`⚠️ Very new account (${accountAge.ageDays} days old)`);
    } else if (accountAge.ageDays < 30) {
      riskScore += 15;
      warnings.push(`⚠️ New account (${accountAge.ageDays} days old)`);
    } else if (accountAge.ageDays > 365) {
      warnings.push(`✅ Established account (${Math.floor(accountAge.ageDays / 30)} months old)`);
    }
  } else {
    riskScore += 10;
    warnings.push('⚠️ Unable to verify account age');
  }

  // Cap at 100
  riskScore = Math.min(100, riskScore);

  // Success message for low risk
  if (riskScore < 20 && ruggedTokens.length === 0) {
    warnings.push('✅ No red flags found');
  }

  return { riskScore, warnings };
}

// ============================================================================
// STORAGE
// ============================================================================

/**
 * Store Twitter-token association in database
 */
export async function storeTwitterTokenLink(
  tokenMint: string,
  twitterHandle: string,
  accountCreated?: Date,
  accountAgeDays?: number
): Promise<void> {
  try {
    if (!supabase) return;

    // Normalize handle
    const normalizedHandle = twitterHandle.startsWith('@')
      ? twitterHandle.slice(1)
      : twitterHandle;

    const { error } = await supabase.from('twitter_token_history').upsert(
      {
        token_mint: tokenMint,
        twitter_handle: normalizedHandle,
        account_created_at: accountCreated,
        account_age_days: accountAgeDays,
        observed_at: new Date(),
      },
      { onConflict: 'token_mint,twitter_handle' }
    );

    if (error) {
      logger.error('TwitterReuse', 'Failed to store Twitter-token link:', error);
    }
  } catch (error) {
    logger.silentError('TwitterReuse', 'Database error', error as Error);
  }
}

/**
 * Flag a token as rugged in the Twitter history
 */
export async function flagTokenAsRugged(tokenMint: string): Promise<void> {
  try {
    if (!supabase) return;

    const { error } = await supabase
      .from('twitter_token_history')
      .update({
        was_rugged: true,
        rug_date: new Date(),
      })
      .eq('token_mint', tokenMint);

    if (error) {
      logger.error('TwitterReuse', 'Failed to flag token as rugged:', error);
    }
  } catch (error) {
    logger.silentError('TwitterReuse', 'Database error', error as Error);
  }
}

// ============================================================================
// PLACEHOLDER FOR TWITTER API INTEGRATION
// ============================================================================

/**
 * Fetch Twitter account data from Twitter API v2
 * NOTE: Requires Twitter API credentials and paid plan ($100/mo)
 */
export async function fetchTwitterAccountData(handle: string): Promise<{
  id: string;
  username: string;
  name: string;
  created_at: string;
  followers_count: number;
  verified: boolean;
} | null> {
  // TODO: Implement Twitter API v2 integration
  // Requires TWITTER_BEARER_TOKEN environment variable
  // Endpoint: GET https://api.twitter.com/2/users/by/username/:username
  
  logger.warn('TwitterReuse', 'Twitter API integration not implemented - using database only');
  return null;
}
