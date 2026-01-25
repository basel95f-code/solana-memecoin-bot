/**
 * API Key management and generation
 */

import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { apiKeyDB } from './database.js';
import type { APIKey } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Generate a new API key
 */
export async function generateAPIKey(params: {
  name: string;
  userId?: string;
  rateLimit?: number;
  expiresAt?: Date;
}): Promise<{ apiKey: APIKey; rawKey: string }> {
  // Generate random key: prefix + random bytes
  const prefix = 'sk_live_';
  const randomPart = randomBytes(32).toString('hex');
  const rawKey = `${prefix}${randomPart}`;

  // Hash the key for storage
  const hashedKey = await bcrypt.hash(rawKey, 10);

  // Store in database
  const apiKey = await apiKeyDB.createAPIKey({
    key: hashedKey,
    name: params.name,
    userId: params.userId,
    rateLimit: params.rateLimit,
    expiresAt: params.expiresAt
  });

  logger.info(`Generated API key: ${apiKey.name} (${apiKey.id})`);

  // Return both the key object and the raw key (ONLY TIME IT'S VISIBLE)
  return { apiKey, rawKey };
}

/**
 * Validate an API key
 */
export async function validateAPIKey(rawKey: string): Promise<APIKey | null> {
  try {
    // Query all active keys and check hashes
    // In production, you might want to add an index or use a different lookup strategy
    const allKeys = await apiKeyDB.listAPIKeys();

    for (const key of allKeys) {
      if (!key.isActive) continue;

      // Check if expired
      if (key.expiresAt && key.expiresAt < new Date()) {
        continue;
      }

      // Compare hashed key
      const isValid = await bcrypt.compare(rawKey, key.key);
      if (isValid) {
        // Update last used
        await apiKeyDB.updateLastUsed(key.id);
        return key;
      }
    }

    return null;
  } catch (error) {
    logger.error('Error validating API key:', error);
    return null;
  }
}

/**
 * Check rate limit for API key
 */
export async function checkRateLimit(keyId: string, limit: number): Promise<boolean> {
  const currentUsage = await apiKeyDB.getUsageCount(keyId);
  return currentUsage < limit;
}

/**
 * Track API usage
 */
export async function trackUsage(keyId: string): Promise<void> {
  await apiKeyDB.trackUsage(keyId);
}
