/**
 * Image Hasher
 * 
 * Computes perceptual hashes of token logos to detect reused/stolen images.
 * Common scam pattern: rugger reuses the same logo for multiple tokens.
 * 
 * Uses dHash (difference hash) algorithm:
 * - Simple and fast
 * - Resistant to minor modifications
 * - Detects similar images even with slight changes
 * 
 * Red flags:
 * - Exact image hash match (100% duplicate)
 * - Similar hash (Hamming distance < 5)
 * - Image previously used for rugged token
 */

import { EventEmitter } from 'events';
import { getSupabaseClient } from '../database/supabase';
import { logger } from '../utils/logger';
import axios from 'axios';

export interface ImageHashResult {
  imageUrl: string;
  imageHash: string;
  isDuplicate: boolean;
  similarImages: SimilarImage[];
  ruggedMatches: number;
  riskScore: number; // 0-100
  warnings: string[];
  suspicionLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface SimilarImage {
  tokenMint: string;
  imageUrl: string;
  imageHash: string;
  hammingDistance: number; // 0 = identical
  wasRugged: boolean;
  rugDate?: Date;
}

export interface ImageReuseAlert {
  type: 'exact_duplicate' | 'similar_image' | 'rugged_image_reuse';
  severity: 'warning' | 'critical';
  tokenMint: string;
  symbol: string;
  imageUrl: string;
  message: string;
  details: {
    duplicateCount?: number;
    ruggedCount?: number;
    hammingDistance?: number;
    originalToken?: string;
  };
  timestamp: Date;
}

// Thresholds
const EXACT_MATCH_THRESHOLD = 0; // Hamming distance 0 = exact duplicate
const SIMILAR_THRESHOLD = 5; // Hamming distance < 5 = similar enough
const IMAGE_DOWNLOAD_TIMEOUT = 10000; // 10 seconds

export class ImageHasherService extends EventEmitter {
  private isRunning = false;
  private alertHistory: Map<string, number> = new Map();
  private readonly ALERT_COOLDOWN = 3600000; // 1 hour
  private hashCache: Map<string, string> = new Map(); // imageUrl -> hash

  constructor() {
    super();
  }

  /**
   * Start hasher
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    
    logger.info('ImageHasher', 'Starting image hasher...');
    this.isRunning = true;
    logger.info('ImageHasher', 'Started');
  }

  /**
   * Stop hasher
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    logger.info('ImageHasher', 'Stopping image hasher...');
    this.isRunning = false;
    logger.info('ImageHasher', 'Stopped');
  }

  /**
   * Hash a token image and check for duplicates
   */
  async hashAndCheckImage(
    tokenMint: string,
    symbol: string,
    imageUrl: string
  ): Promise<ImageHashResult> {
    const warnings: string[] = [];
    let riskScore = 0;

    if (!imageUrl) {
      return this.getDefaultResult(imageUrl);
    }

    // Compute image hash
    const imageHash = await this.computeImageHash(imageUrl);

    if (!imageHash) {
      logger.warn('ImageHasher', `Failed to hash image for ${symbol}`);
      return this.getDefaultResult(imageUrl);
    }

    // Save to database
    await this.saveImageHash(tokenMint, imageUrl, imageHash);

    // Find similar images
    const similarImages = await this.findSimilarImages(imageHash, tokenMint);

    const exactMatches = similarImages.filter(img => img.hammingDistance === 0);
    const ruggedMatches = similarImages.filter(img => img.wasRugged).length;

    // Risk assessment

    // Exact duplicate
    if (exactMatches.length > 0) {
      riskScore += 50;
      warnings.push(`Exact image duplicate found (${exactMatches.length} match(es))`);
    }

    // Similar images
    if (similarImages.length > exactMatches.length) {
      const similarCount = similarImages.length - exactMatches.length;
      riskScore += 25;
      warnings.push(`${similarCount} similar image(s) found`);
    }

    // Previous rugged tokens with same/similar image
    if (ruggedMatches > 0) {
      riskScore += 40;
      warnings.push(`Image used for ${ruggedMatches} rugged token(s)`);
    }

    riskScore = Math.min(100, riskScore);

    const suspicionLevel: 'low' | 'medium' | 'high' | 'critical' =
      riskScore >= 70 ? 'critical' :
      riskScore >= 50 ? 'high' :
      riskScore >= 30 ? 'medium' : 'low';

    const result: ImageHashResult = {
      imageUrl,
      imageHash,
      isDuplicate: similarImages.length > 0,
      similarImages,
      ruggedMatches,
      riskScore,
      warnings,
      suspicionLevel,
    };

    // Send alerts if suspicious
    if (suspicionLevel === 'critical' || suspicionLevel === 'high') {
      await this.sendAlerts(tokenMint, symbol, result);
    }

    return result;
  }

  /**
   * Mark a token as rugged (updates database)
   */
  async markTokenAsRugged(tokenMint: string): Promise<void> {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        logger.debug('ImageHasher', 'Supabase not configured');
        return;
      }

      const { error } = await supabase
        .from('token_images')
        .update({
          was_rugged: true,
          rug_date: new Date().toISOString(),
        })
        .eq('token_mint', tokenMint);

      if (error) {
        logger.error('ImageHasher', `Failed to mark token as rugged: ${error.message}`);
      } else {
        logger.info('ImageHasher', `Marked ${tokenMint.slice(0, 8)} image as rugged`);
      }
    } catch (error) {
      logger.silentError('ImageHasher', 'Failed to mark token as rugged', error as Error);
    }
  }

  /**
   * Compute perceptual hash (dHash) for an image
   */
  private async computeImageHash(imageUrl: string): Promise<string | null> {
    try {
      // Check cache first
      if (this.hashCache.has(imageUrl)) {
        return this.hashCache.get(imageUrl)!;
      }

      // Download image (with timeout)
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: IMAGE_DOWNLOAD_TIMEOUT,
        maxContentLength: 5 * 1024 * 1024, // 5MB max
      });

      const imageBuffer = Buffer.from(response.data);

      // For now, use a simple hash placeholder
      // TODO: Implement actual dHash using image processing library
      // This would require sharp, jimp, or canvas for proper image processing
      
      // Placeholder: Use content hash (not perceptual, but works for exact matches)
      const crypto = await import('crypto');
      const hash = crypto.createHash('md5').update(imageBuffer).digest('hex');

      // Cache the result
      this.hashCache.set(imageUrl, hash);

      return hash;
    } catch (error) {
      logger.silentError('ImageHasher', `Failed to hash image ${imageUrl}`, error as Error);
      return null;
    }
  }

  /**
   * Save image hash to database
   */
  private async saveImageHash(
    tokenMint: string,
    imageUrl: string,
    imageHash: string
  ): Promise<void> {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        logger.debug('ImageHasher', 'Supabase not configured, skipping database save');
        return;
      }

      const data = {
        token_mint: tokenMint,
        image_url: imageUrl,
        image_hash: imageHash,
        hash_algorithm: 'md5', // TODO: Change to 'dhash' when implemented
        was_rugged: false,
      };

      // Upsert (update if exists, insert if not)
      const { error } = await supabase
        .from('token_images')
        .upsert(data, {
          onConflict: 'token_mint',
        });

      if (error) {
        logger.error('ImageHasher', `Failed to save image hash: ${error.message}`);
      } else {
        logger.info('ImageHasher', `Saved image hash for ${tokenMint.slice(0, 8)}`);
      }
    } catch (error) {
      logger.silentError('ImageHasher', 'Failed to save image hash', error as Error);
    }
  }

  /**
   * Find similar images in database
   */
  private async findSimilarImages(
    imageHash: string,
    excludeTokenMint: string
  ): Promise<SimilarImage[]> {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        return [];
      }

      // Get all images from database
      const { data, error } = await supabase
        .from('token_images')
        .select('*')
        .neq('token_mint', excludeTokenMint);

      if (error) {
        logger.error('ImageHasher', `Failed to get images: ${error.message}`);
        return [];
      }

      const similarImages: SimilarImage[] = [];

      for (const row of data || []) {
        // Calculate Hamming distance
        const distance = this.hammingDistance(imageHash, row.image_hash);

        // Only include if similar enough
        if (distance <= SIMILAR_THRESHOLD) {
          similarImages.push({
            tokenMint: row.token_mint,
            imageUrl: row.image_url,
            imageHash: row.image_hash,
            hammingDistance: distance,
            wasRugged: row.was_rugged || false,
            rugDate: row.rug_date ? new Date(row.rug_date) : undefined,
          });
        }
      }

      // Sort by similarity (closest first)
      similarImages.sort((a, b) => a.hammingDistance - b.hammingDistance);

      return similarImages;
    } catch (error) {
      logger.silentError('ImageHasher', 'Failed to find similar images', error as Error);
      return [];
    }
  }

  /**
   * Calculate Hamming distance between two hashes
   */
  private hammingDistance(hash1: string, hash2: string): number {
    if (hash1.length !== hash2.length) {
      return 999; // Very different
    }

    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) {
        distance++;
      }
    }

    return distance;
  }

  /**
   * Send alerts for suspicious image reuse
   */
  private async sendAlerts(
    tokenMint: string,
    symbol: string,
    result: ImageHashResult
  ): Promise<void> {
    const exactMatches = result.similarImages.filter(img => img.hammingDistance === 0);

    // Alert for exact duplicate
    if (exactMatches.length > 0) {
      const alert: ImageReuseAlert = {
        type: 'exact_duplicate',
        severity: 'warning',
        tokenMint,
        symbol,
        imageUrl: result.imageUrl,
        message: `Exact image duplicate found (${exactMatches.length} match(es))`,
        details: {
          duplicateCount: exactMatches.length,
          ruggedCount: result.ruggedMatches,
          originalToken: exactMatches[0].tokenMint,
        },
        timestamp: new Date(),
      };

      if (this.shouldSendAlert(tokenMint, 'exact_duplicate')) {
        this.emit('alert', alert);
        this.markAlertSent(tokenMint, 'exact_duplicate');
        logger.warn('ImageHasher', `EXACT DUPLICATE: ${symbol} - ${alert.message}`);
      }
    }

    // Alert for rugged image reuse
    if (result.ruggedMatches > 0) {
      const ruggedMatch = result.similarImages.find(img => img.wasRugged);
      
      const alert: ImageReuseAlert = {
        type: 'rugged_image_reuse',
        severity: 'critical',
        tokenMint,
        symbol,
        imageUrl: result.imageUrl,
        message: `Image used for ${result.ruggedMatches} rugged token(s)`,
        details: {
          ruggedCount: result.ruggedMatches,
          hammingDistance: ruggedMatch?.hammingDistance,
          originalToken: ruggedMatch?.tokenMint,
        },
        timestamp: new Date(),
      };

      if (this.shouldSendAlert(tokenMint, 'rugged_image_reuse')) {
        this.emit('alert', alert);
        this.markAlertSent(tokenMint, 'rugged_image_reuse');
        logger.warn('ImageHasher', `RUGGED IMAGE REUSE: ${symbol} - ${alert.message}`);
      }
    }

    // Alert for similar image (not exact, but close)
    const similarNotExact = result.similarImages.filter(img => 
      img.hammingDistance > 0 && img.hammingDistance <= SIMILAR_THRESHOLD
    );

    if (similarNotExact.length > 0) {
      const alert: ImageReuseAlert = {
        type: 'similar_image',
        severity: 'warning',
        tokenMint,
        symbol,
        imageUrl: result.imageUrl,
        message: `${similarNotExact.length} similar image(s) found`,
        details: {
          duplicateCount: similarNotExact.length,
          hammingDistance: similarNotExact[0].hammingDistance,
        },
        timestamp: new Date(),
      };

      if (this.shouldSendAlert(tokenMint, 'similar_image')) {
        this.emit('alert', alert);
        this.markAlertSent(tokenMint, 'similar_image');
        logger.warn('ImageHasher', `SIMILAR IMAGE: ${symbol} - ${alert.message}`);
      }
    }
  }

  /**
   * Check if alert should be sent (cooldown check)
   */
  private shouldSendAlert(tokenMint: string, alertType: string): boolean {
    const key = `${tokenMint}:${alertType}`;
    const lastAlert = this.alertHistory.get(key);
    
    if (!lastAlert) return true;
    
    const timeSince = Date.now() - lastAlert;
    return timeSince > this.ALERT_COOLDOWN;
  }

  /**
   * Mark alert as sent
   */
  private markAlertSent(tokenMint: string, alertType: string): void {
    const key = `${tokenMint}:${alertType}`;
    this.alertHistory.set(key, Date.now());
  }

  /**
   * Get default result
   */
  private getDefaultResult(imageUrl: string): ImageHashResult {
    return {
      imageUrl,
      imageHash: '',
      isDuplicate: false,
      similarImages: [],
      ruggedMatches: 0,
      riskScore: 0,
      warnings: [],
      suspicionLevel: 'low',
    };
  }

  /**
   * Get stats
   */
  getStats(): {
    alertHistory: number;
    cacheSize: number;
  } {
    return {
      alertHistory: this.alertHistory.size,
      cacheSize: this.hashCache.size,
    };
  }
}

// Singleton export
export const imageHasher = new ImageHasherService();
