/**
 * Pattern detection endpoints
 */

import { Router } from 'express';
import { botDB } from '../utils/database.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateQuery, validateParams, schemas } from '../middleware/validation.js';
import { z } from 'zod';

const router = Router();

/**
 * GET /api/v1/patterns
 * Get pattern detection history
 * 
 * Query params:
 * - page: Page number
 * - limit: Results per page
 * - minConfidence: Minimum confidence score (0-1)
 */
router.get(
  '/patterns',
  validateQuery(schemas.pagination.extend({
    minConfidence: z.string().optional().transform(val => val ? parseFloat(val) : undefined)
  })),
  asyncHandler(async (req, res) => {
    const { page, limit, minConfidence } = req.query as any;

    const result = await botDB.getPatterns({
      page,
      limit,
      minConfidence
    });

    res.json({
      success: true,
      data: result.data,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages
      }
    });
  })
);

/**
 * GET /api/v1/patterns/:mint
 * Get pattern detection history for specific token
 */
router.get(
  '/patterns/:mint',
  validateParams(z.object({ mint: schemas.mintAddress })),
  validateQuery(schemas.pagination),
  asyncHandler(async (req, res) => {
    const { mint } = req.params;
    const { page, limit } = req.query as any;

    const result = await botDB.getPatterns({
      page,
      limit,
      mint
    });

    if (!result.data || result.data.length === 0) {
      res.status(404).json({
        success: false,
        error: 'No patterns found',
        message: `No pattern detection history found for mint: ${mint}`
      });
      return;
    }

    res.json({
      success: true,
      data: result.data,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages
      }
    });
  })
);

export default router;
