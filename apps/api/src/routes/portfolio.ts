/**
 * Portfolio API endpoints
 * REST API for portfolio management
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateQuery, validateBody, schemas } from '../middleware/validation.js';
import { z } from 'zod';
import { getSupabaseClient } from '../../../bot/src/database/supabase.js';
import { positionTracker } from '../../../bot/src/portfolio/positionTracker.js';
import { pnlCalculator } from '../../../bot/src/portfolio/pnlCalculator.js';
import { performanceAnalytics } from '../../../bot/src/portfolio/performanceAnalytics.js';
import { taxReporting } from '../../../bot/src/portfolio/taxReporting.js';

const router = Router();

// ========================================
// GET /api/v1/portfolio
// Get all positions
// ========================================
router.get(
  '/portfolio',
  validateQuery(z.object({
    userId: z.string().optional().default('default'),
    status: z.enum(['open', 'closed', 'all']).optional().default('open'),
  })),
  asyncHandler(async (req, res) => {
    const { userId, status } = req.query as any;
    
    let positions;
    
    if (status === 'open') {
      positions = await positionTracker.getOpenPositions(userId);
    } else {
      const supabase = getSupabaseClient();
      const query = supabase
        .from('portfolio_positions')
        .select('*')
        .eq('user_id', userId);
      
      if (status !== 'all') {
        query.eq('status', status);
      }
      
      const { data } = await query.order('created_at', { ascending: false });
      positions = data || [];
    }
    
    res.json({
      success: true,
      data: positions,
      count: positions.length,
    });
  })
);

// ========================================
// GET /api/v1/portfolio/pnl
// Get P&L summary
// ========================================
router.get(
  '/portfolio/pnl',
  validateQuery(z.object({
    userId: z.string().optional().default('default'),
  })),
  asyncHandler(async (req, res) => {
    const { userId } = req.query as any;
    
    const summary = await pnlCalculator.getPnLSummary(userId);
    const roi = await pnlCalculator.getROIMetrics(userId);
    const winnersLosers = await pnlCalculator.getWinnersLosers(userId);
    
    res.json({
      success: true,
      data: {
        summary,
        roi,
        winnersLosers,
      },
    });
  })
);

// ========================================
// GET /api/v1/portfolio/performance
// Get performance metrics
// ========================================
router.get(
  '/portfolio/performance',
  validateQuery(z.object({
    userId: z.string().optional().default('default'),
    period: z.enum(['daily', 'weekly', 'monthly', 'all_time']).optional().default('all_time'),
  })),
  asyncHandler(async (req, res) => {
    const { userId, period } = req.query as any;
    
    const metrics = await performanceAnalytics.calculatePerformance(userId, period);
    const { best, worst } = await performanceAnalytics.getBestWorstTrades(userId, 10);
    
    res.json({
      success: true,
      data: {
        metrics,
        bestTrades: best,
        worstTrades: worst,
      },
    });
  })
);

// ========================================
// POST /api/v1/portfolio/trade
// Record a trade (buy/sell)
// ========================================
router.post(
  '/portfolio/trade',
  validateBody(z.object({
    userId: z.string().optional().default('default'),
    action: z.enum(['buy', 'sell']),
    tokenMint: z.string(),
    symbol: z.string(),
    name: z.string().optional(),
    price: z.number().positive(),
    amount: z.number().positive(),
    timestamp: z.string().datetime().optional(),
    notes: z.string().optional(),
    txSignature: z.string().optional(),
  })),
  asyncHandler(async (req, res) => {
    const data = req.body;
    
    if (data.action === 'buy') {
      // Add entry
      const position = await positionTracker.addEntry({
        userId: data.userId,
        tokenMint: data.tokenMint,
        symbol: data.symbol,
        name: data.name,
        price: data.price,
        amount: data.amount,
        timestamp: data.timestamp ? new Date(data.timestamp) : undefined,
        notes: data.notes,
      });
      
      res.json({
        success: true,
        message: 'Position entry added',
        data: position,
      });
    } else {
      // Sell
      const position = await positionTracker.getPositionByToken(data.tokenMint, data.userId);
      
      if (!position) {
        res.status(404).json({
          success: false,
          error: 'Position not found',
          message: `No open position found for ${data.symbol}`,
        });
        return;
      }
      
      const result = await positionTracker.partialExit({
        positionId: position.id!,
        exitPrice: data.price,
        exitAmount: data.amount,
        timestamp: data.timestamp ? new Date(data.timestamp) : undefined,
        notes: data.notes,
      });
      
      res.json({
        success: true,
        message: data.amount === position.currentAmount ? 'Position closed' : 'Partial exit recorded',
        data: result,
      });
    }
  })
);

// ========================================
// GET /api/v1/portfolio/tax-report
// Generate tax report
// ========================================
router.get(
  '/portfolio/tax-report',
  validateQuery(z.object({
    userId: z.string().optional().default('default'),
    year: z.string().optional().transform(val => val ? parseInt(val) : undefined),
    format: z.enum(['json', 'csv', 'form8949']).optional().default('json'),
  })),
  asyncHandler(async (req, res) => {
    const { userId, year, format } = req.query as any;
    
    if (format === 'csv') {
      const csv = await taxReporting.exportCSV(userId, year);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="tax_report_${year || 'all'}.csv"`);
      res.send(csv);
      return;
    }
    
    if (format === 'form8949') {
      const { shortTermCSV, longTermCSV } = await taxReporting.exportForm8949CSV(userId, year);
      
      res.json({
        success: true,
        data: {
          shortTerm: shortTermCSV,
          longTerm: longTermCSV,
        },
      });
      return;
    }
    
    // JSON format
    const report = await taxReporting.generateTaxReport(userId, year);
    
    res.json({
      success: true,
      data: report,
    });
  })
);

// ========================================
// GET /api/v1/portfolio/history
// Get historical snapshots
// ========================================
router.get(
  '/portfolio/history',
  validateQuery(z.object({
    userId: z.string().optional().default('default'),
    days: z.string().optional().default('30').transform(val => parseInt(val)),
  })),
  asyncHandler(async (req, res) => {
    const { userId, days } = req.query as any;
    
    const supabase = getSupabaseClient();
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const { data: snapshots } = await supabase
      .from('portfolio_snapshots')
      .select('*')
      .eq('user_id', userId)
      .gte('snapshot_date', startDate.toISOString().split('T')[0])
      .order('snapshot_date', { ascending: true });
    
    res.json({
      success: true,
      data: snapshots || [],
      count: snapshots?.length || 0,
    });
  })
);

// ========================================
// GET /api/v1/portfolio/positions/:id
// Get position by ID
// ========================================
router.get(
  '/portfolio/positions/:id',
  asyncHandler(async (req, res) => {
    const positionId = parseInt(req.params.id);
    
    const position = await positionTracker.getPosition(positionId);
    
    if (!position) {
      res.status(404).json({
        success: false,
        error: 'Position not found',
      });
      return;
    }
    
    res.json({
      success: true,
      data: position,
    });
  })
);

// ========================================
// PUT /api/v1/portfolio/positions/:id/price
// Update position price
// ========================================
router.put(
  '/portfolio/positions/:id/price',
  validateBody(z.object({
    price: z.number().positive(),
  })),
  asyncHandler(async (req, res) => {
    const positionId = parseInt(req.params.id);
    const { price } = req.body;
    
    await positionTracker.updatePrice({
      positionId,
      newPrice: price,
    });
    
    const updated = await positionTracker.getPosition(positionId);
    
    res.json({
      success: true,
      message: 'Position price updated',
      data: updated,
    });
  })
);

// ========================================
// GET /api/v1/portfolio/value
// Get portfolio value breakdown
// ========================================
router.get(
  '/portfolio/value',
  validateQuery(z.object({
    userId: z.string().optional().default('default'),
  })),
  asyncHandler(async (req, res) => {
    const { userId } = req.query as any;
    
    const value = await pnlCalculator.getPortfolioValue(userId);
    
    res.json({
      success: true,
      data: value,
    });
  })
);

export default router;
