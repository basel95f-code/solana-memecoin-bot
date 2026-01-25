/**
 * Token endpoints
 */

import { Router } from 'express';
import { botDB } from '../utils/database.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateQuery, validateParams, schemas } from '../middleware/validation.js';
import { z } from 'zod';

const router = Router();

/**
 * GET /api/v1/tokens
 * List monitored tokens with pagination and filters
 * 
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Results per page (default: 20, max: 100)
 * - riskLevel: Filter by risk level (low, medium, high, extreme)
 * - minLiquidity: Minimum liquidity in USD
 */
router.get(
  '/tokens',
  validateQuery(schemas.pagination.extend({
    riskLevel: schemas.riskLevel,
    minLiquidity: z.string().optional().transform(val => val ? parseFloat(val) : undefined)
  })),
  asyncHandler(async (req, res) => {
    const { page, limit, riskLevel, minLiquidity } = req.query as any;

    const result = await botDB.getTokens({
      page,
      limit,
      riskLevel,
      minLiquidity
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
 * GET /api/v1/tokens/:mint
 * Get token details by mint address
 */
router.get(
  '/tokens/:mint',
  validateParams(z.object({ mint: schemas.mintAddress })),
  asyncHandler(async (req, res) => {
    const { mint } = req.params;

    const token = await botDB.getToken(mint);

    if (!token) {
      res.status(404).json({
        success: false,
        error: 'Token not found',
        message: `No token found with mint address: ${mint}`
      });
      return;
    }

    res.json({
      success: true,
      data: token
    });
  })
);

/**
 * GET /api/v1/tokens/:mint/analysis
 * Get full analysis history for a token
 */
router.get(
  '/tokens/:mint/analysis',
  validateParams(z.object({ mint: schemas.mintAddress })),
  asyncHandler(async (req, res) => {
    const { mint } = req.params;

    const analysis = await botDB.getTokenAnalysis(mint);

    if (!analysis || analysis.length === 0) {
      res.status(404).json({
        success: false,
        error: 'No analysis found',
        message: `No analysis history found for mint address: ${mint}`
      });
      return;
    }

    res.json({
      success: true,
      data: analysis,
      count: analysis.length
    });
  })
);

export default router;
