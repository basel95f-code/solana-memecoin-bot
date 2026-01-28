/**
 * Image Reuse Detection
 * Checks if a token's logo has been used before (copy-paste scams)
 * 
 * NOTE: Full implementation requires image hashing library (sharp + blockhash)
 * This is a simplified version that works with URL comparison and database tracking
 */

import { logger } from '../utils/logger';
import { supabase } from '../database/supabase';
import * as crypto from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

export interface ImageMatch {
  tokenMint: string;
  symbol: string;
  similarity: number; // 0-100%
  isExactMatch: boolean;
  wasRugged: boolean;
  rugDate?: Date;
}

export interface ImageCheckResult {
  imageUrl: string;
  imageHash: string;
  hashAlgorithm: string;
  matches: ImageMatch[];
  isUnique: boolean;
  riskScore: number;
  warnings: string[];
}

// ============================================================================
// MAIN CHECK FUNCTION
// ============================================================================

/**
 * Check if a token image has been used before
 */
export async function checkImageReuse(
  tokenMint: string,
  imageUrl: string
): Promise<ImageCheckResult> {
  logger.info('ImageCheck', `Checking image reuse for ${tokenMint.slice(0, 8)}`);

  try {
    // Step 1: Generate image hash
    // NOTE: This is a simplified hash (URL-based + MD5)
    // Real implementation would use perceptual hashing (pHash/dHash)
    const imageHash = await generateSimpleImageHash(imageUrl);

    // Step 2: Search for similar images in database
    const matches = await findSimilarImages(imageHash, tokenMint);

    // Step 3: Assess risk
    const { riskScore, warnings } = assessImageRisk(matches);

    // Step 4: Store this image in database
    await storeImageHash(tokenMint, imageUrl, imageHash);

    const isUnique = matches.length === 0;

    return {
      imageUrl,
      imageHash,
      hashAlgorithm: 'md5-simplified', // Would be 'dhash' or 'phash' in real impl
      matches,
      isUnique,
      riskScore,
      warnings,
    };
  } catch (error) {
    logger.error('ImageCheck', `Failed to check image:`, error as Error);
    throw error;
  }
}

// ============================================================================
// IMAGE HASHING
// ============================================================================

/**
 * Generate a simple hash of the image
 * NOTE: This is a placeholder - real implementation needs perceptual hashing
 */
async function generateSimpleImageHash(imageUrl: string): Promise<string> {
  try {
    // Fetch image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error('Failed to fetch image');
    }

    const buffer = await response.arrayBuffer();
    
    // Generate MD5 hash
    const hash = crypto.createHash('md5').update(Buffer.from(buffer)).digest('hex');

    return hash;
  } catch (error) {
    logger.silentError('ImageCheck', 'Failed to hash image', error as Error);
    
    // Fallback: hash the URL
    return crypto.createHash('md5').update(imageUrl).digest('hex');
  }
}

/**
 * Generate perceptual hash (for future implementation)
 * Requires: npm install sharp blockhash-js
 */
async function generatePerceptualHash(imageUrl: string): Promise<string> {
  // TODO: Implement perceptual hashing
  // const sharp = require('sharp');
  // const { blockhash } = require('blockhash-js');
  //
  // 1. Fetch image
  // 2. Convert to grayscale
  // 3. Resize to 16x16
  // 4. Generate blockhash/dhash
  // 5. Return hash string
  
  throw new Error('Perceptual hashing not implemented');
}

/**
 * Calculate hash similarity (Hamming distance for perceptual hashes)
 */
function calculateHashSimilarity(hash1: string, hash2: string): number {
  // For MD5 hashes, only exact matches work
  if (hash1 === hash2) return 100;

  // For perceptual hashes (hex strings), calculate Hamming distance
  // This would work with pHash/dHash
  if (hash1.length !== hash2.length) return 0;

  let differences = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) differences++;
  }

  // Convert to similarity percentage
  const similarity = ((hash1.length - differences) / hash1.length) * 100;
  return similarity;
}

// ============================================================================
// DATABASE QUERIES
// ============================================================================

/**
 * Find images with similar hashes
 */
async function findSimilarImages(
  imageHash: string,
  excludeTokenMint: string
): Promise<ImageMatch[]> {
  try {
    if (!supabase) return [];

    // Find exact matches (MD5)
    const { data, error } = await supabase
      .from('token_images')
      .select('token_mint, image_hash, was_rugged, rug_date')
      .eq('image_hash', imageHash)
      .neq('token_mint', excludeTokenMint);

    if (error || !data) return [];

    return data.map((row: any) => ({
      tokenMint: row.token_mint,
      symbol: 'Unknown', // Would need token metadata
      similarity: 100, // Exact match
      isExactMatch: true,
      wasRugged: row.was_rugged,
      rugDate: row.rug_date ? new Date(row.rug_date) : undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Store image hash in database
 */
async function storeImageHash(
  tokenMint: string,
  imageUrl: string,
  imageHash: string
): Promise<void> {
  try {
    if (!supabase) return;

    const { error } = await supabase.from('token_images').upsert(
      {
        token_mint: tokenMint,
        image_url: imageUrl,
        image_hash: imageHash,
        hash_algorithm: 'md5-simplified',
        created_at: new Date(),
      },
      { onConflict: 'token_mint' }
    );

    if (error) {
      logger.error('ImageCheck', 'Failed to store image hash:', error);
    }
  } catch (error) {
    logger.silentError('ImageCheck', 'Database error', error as Error);
  }
}

// ============================================================================
// RISK ASSESSMENT
// ============================================================================

/**
 * Assess image reuse risk
 */
function assessImageRisk(matches: ImageMatch[]): { riskScore: number; warnings: string[] } {
  const warnings: string[] = [];
  let riskScore = 0;

  if (matches.length === 0) {
    warnings.push('✅ Image appears unique');
    return { riskScore: 0, warnings };
  }

  // Risk Factor 1: Number of matches
  riskScore += Math.min(matches.length * 20, 50);
  warnings.push(`⚠️ Image matches ${matches.length} other token(s)`);

  // Risk Factor 2: Matches with rugged tokens
  const ruggedMatches = matches.filter(m => m.wasRugged);

  if (ruggedMatches.length > 0) {
    riskScore = 95; // Max risk
    warnings.unshift(`🚨 CRITICAL: Image used by ${ruggedMatches.length} rugged token(s)`);

    ruggedMatches.slice(0, 3).forEach(match => {
      const daysAgo = match.rugDate
        ? Math.floor((Date.now() - match.rugDate.getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      warnings.push(`  • ${match.tokenMint.slice(0, 8)}... rugged ${daysAgo} days ago`);
    });
  }

  // Risk Factor 3: High similarity
  const exactMatches = matches.filter(m => m.isExactMatch);
  if (exactMatches.length > 0 && ruggedMatches.length === 0) {
    riskScore += 30;
    warnings.push('⚠️ Exact image match found (possible copy-paste)');
  }

  // Cap at 100
  riskScore = Math.min(100, riskScore);

  return { riskScore, warnings };
}

// ============================================================================
// FLAG RUGGED TOKEN
// ============================================================================

/**
 * Flag a token's image as associated with a rug
 */
export async function flagImageAsRugged(tokenMint: string): Promise<void> {
  try {
    if (!supabase) return;

    const { error } = await supabase
      .from('token_images')
      .update({
        was_rugged: true,
        rug_date: new Date(),
      })
      .eq('token_mint', tokenMint);

    if (error) {
      logger.error('ImageCheck', 'Failed to flag image as rugged:', error);
    }
  } catch (error) {
    logger.silentError('ImageCheck', 'Database error', error as Error);
  }
}

// ============================================================================
// BATCH CHECKING
// ============================================================================

/**
 * Check multiple tokens for image reuse
 */
export async function batchCheckImages(
  tokens: Array<{ mint: string; imageUrl: string }>
): Promise<Map<string, ImageCheckResult>> {
  const results = new Map<string, ImageCheckResult>();

  await Promise.all(
    tokens.map(async ({ mint, imageUrl }) => {
      try {
        const result = await checkImageReuse(mint, imageUrl);
        results.set(mint, result);
      } catch (error) {
        logger.silentError('ImageCheck', `Failed to check ${mint.slice(0, 8)}`, error as Error);
      }
    })
  );

  return results;
}
