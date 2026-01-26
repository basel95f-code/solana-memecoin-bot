/**
 * Authentication middleware
 * 
 * FIX #45: Generic error messages in production to prevent information disclosure
 */

import type { Request, Response, NextFunction } from 'express';
import { validateAPIKey, checkRateLimit, trackUsage } from '../auth/keyManager.js';
import { logger } from '../utils/logger.js';

// Extend Express Request to include API key
declare global {
  namespace Express {
    interface Request {
      apiKey?: {
        id: string;
        name: string;
        userId?: string;
        rateLimit: number;
      };
    }
  }
}

// FIX #45: Use generic messages in production to prevent information disclosure
const isProduction = process.env.NODE_ENV === 'production';

function getErrorMessage(devMessage: string, prodMessage: string = 'Authentication failed'): string {
  return isProduction ? prodMessage : devMessage;
}

/**
 * Authenticate API key from Authorization header
 */
export async function authenticateAPIKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({
        error: 'Unauthorized',
        // FIX #45: Generic message in production
        message: getErrorMessage(
          'Please provide an API key in the Authorization header as "Bearer YOUR_API_KEY"',
          'Authentication required'
        )
      });
      return;
    }

    // Extract token from "Bearer <token>"
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      res.status(401).json({
        error: 'Unauthorized',
        // FIX #45: Generic message in production
        message: getErrorMessage(
          'Use format: "Bearer YOUR_API_KEY"',
          'Invalid authentication format'
        )
      });
      return;
    }

    const rawKey = parts[1];

    // Validate key
    const apiKey = await validateAPIKey(rawKey);

    if (!apiKey) {
      logger.warn(`Invalid API key attempted: ${rawKey.substring(0, 10)}...`);
      res.status(401).json({
        error: 'Unauthorized',
        // FIX #45: Generic message - don't reveal if key exists or is expired
        message: getErrorMessage(
          'The provided API key is invalid or has expired',
          'Authentication failed'
        )
      });
      return;
    }

    // Check rate limit
    const withinLimit = await checkRateLimit(apiKey.id, apiKey.rateLimit);

    if (!withinLimit) {
      logger.warn(`Rate limit exceeded for API key: ${apiKey.name} (${apiKey.id})`);
      res.status(429).json({
        error: 'Too Many Requests',
        // FIX #45: Don't reveal specific rate limit in production
        message: getErrorMessage(
          `You have exceeded the rate limit of ${apiKey.rateLimit} requests per minute`,
          'Rate limit exceeded. Please try again later.'
        )
      });
      return;
    }

    // Track usage
    await trackUsage(apiKey.id);

    // Attach API key to request
    req.apiKey = {
      id: apiKey.id,
      name: apiKey.name,
      userId: apiKey.userId,
      rateLimit: apiKey.rateLimit
    };

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'An error occurred during authentication'
    });
  }
}

/**
 * Optional authentication - allows both authenticated and unauthenticated requests
 * Useful for endpoints that have different rate limits for authenticated vs unauthenticated
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    // No auth header, continue without API key
    next();
    return;
  }

  // Has auth header, validate it
  await authenticateAPIKey(req, res, next);
}
