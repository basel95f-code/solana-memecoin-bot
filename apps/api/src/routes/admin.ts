/**
 * Admin endpoints for API key management
 * These endpoints require admin authentication
 */

import { Router } from 'express';
import { generateAPIKey } from '../auth/keyManager.js';
import { apiKeyDB } from '../auth/database.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { validateBody } from '../middleware/validation.js';
import { z } from 'zod';

const router = Router();

// Simple admin check middleware
function requireAdmin(req: any, res: any, next: any) {
  // In production, implement proper admin role checking
  const adminKey = process.env.ADMIN_API_KEY;
  const providedKey = req.headers['x-admin-key'];

  if (!adminKey || providedKey !== adminKey) {
    throw new AppError('Unauthorized - Admin access required', 403);
  }

  next();
}

/**
 * POST /api/v1/admin/keys
 * Generate a new API key
 */
router.post(
  '/admin/keys',
  requireAdmin,
  validateBody(z.object({
    name: z.string().min(1),
    userId: z.string().optional(),
    rateLimit: z.number().min(1).max(10000).optional(),
    expiresInDays: z.number().min(1).optional()
  })),
  asyncHandler(async (req, res) => {
    const expiresAt = req.body.expiresInDays
      ? new Date(Date.now() + req.body.expiresInDays * 24 * 60 * 60 * 1000)
      : undefined;

    const { apiKey, rawKey } = await generateAPIKey({
      name: req.body.name,
      userId: req.body.userId,
      rateLimit: req.body.rateLimit,
      expiresAt
    });

    res.status(201).json({
      success: true,
      data: {
        id: apiKey.id,
        name: apiKey.name,
        key: rawKey, // ONLY shown once!
        rateLimit: apiKey.rateLimit,
        createdAt: apiKey.createdAt,
        expiresAt: apiKey.expiresAt
      },
      warning: 'This key will only be shown once. Store it securely!'
    });
  })
);

/**
 * GET /api/v1/admin/keys
 * List all API keys
 */
router.get(
  '/admin/keys',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const keys = await apiKeyDB.listAPIKeys();

    res.json({
      success: true,
      data: keys.map(key => ({
        id: key.id,
        name: key.name,
        userId: key.userId,
        rateLimit: key.rateLimit,
        isActive: key.isActive,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
        expiresAt: key.expiresAt
      }))
    });
  })
);

/**
 * DELETE /api/v1/admin/keys/:id
 * Revoke an API key
 */
router.delete(
  '/admin/keys/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    await apiKeyDB.revokeAPIKey(id);

    res.json({
      success: true,
      message: 'API key revoked successfully'
    });
  })
);

export default router;
