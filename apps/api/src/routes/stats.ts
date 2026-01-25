/**
 * Statistics endpoints
 */

import { Router } from 'express';
import { botDB } from '../utils/database.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

/**
 * GET /api/v1/stats
 * Get bot statistics
 */
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const stats = await botDB.getStats();

    res.json({
      success: true,
      data: stats
    });
  })
);

export default router;
