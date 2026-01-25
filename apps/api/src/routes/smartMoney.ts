/**
 * Smart money wallet endpoints
 */

import { Router } from 'express';
import { botDB } from '../utils/database.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateQuery, validateParams, schemas } from '../middleware/validation.js';
import { z } from 'zod';

const router = Router();

/**
 * GET /api/v1/smart-money
 * List smart money wallets
 */
router.get(
  '/smart-money',
  validateQuery(schemas.pagination),
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query as any;

    const result = await botDB.getSmartMoneyWallets({
      page,
      limit
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
 * GET /api/v1/smart-money/:wallet
 * Get smart money wallet details
 */
router.get(
  '/smart-money/:wallet',
  validateParams(z.object({ wallet: schemas.mintAddress })),
  asyncHandler(async (req, res) => {
    const { wallet } = req.params;

    const walletData = await botDB.getSmartMoneyWallet(wallet);

    if (!walletData) {
      res.status(404).json({
        success: false,
        error: 'Wallet not found',
        message: `No smart money wallet found with address: ${wallet}`
      });
      return;
    }

    res.json({
      success: true,
      data: walletData
    });
  })
);

export default router;
