/**
 * Alert rules endpoints
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { validateBody, validateParams, schemas } from '../middleware/validation.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/**
 * GET /api/v1/alerts/rules
 * List all alert rules for the authenticated user
 */
router.get(
  '/alerts/rules',
  asyncHandler(async (req, res) => {
    const userId = req.apiKey?.userId || req.apiKey?.id;

    const { data, error } = await supabase
      .from('alert_rules')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to get alert rules:', error);
      throw new AppError('Failed to retrieve alert rules', 500);
    }

    res.json({
      success: true,
      data: data || []
    });
  })
);

/**
 * POST /api/v1/alerts/rules
 * Create a new alert rule
 */
router.post(
  '/alerts/rules',
  validateBody(schemas.createAlertRule),
  asyncHandler(async (req, res) => {
    const userId = req.apiKey?.userId || req.apiKey?.id;

    const { data, error } = await supabase
      .from('alert_rules')
      .insert({
        user_id: userId,
        name: req.body.name,
        conditions: req.body.conditions,
        webhook_url: req.body.webhookUrl,
        is_active: req.body.isActive
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create alert rule:', error);
      throw new AppError('Failed to create alert rule', 500);
    }

    res.status(201).json({
      success: true,
      data
    });
  })
);

/**
 * PUT /api/v1/alerts/rules/:id
 * Update an existing alert rule
 */
router.put(
  '/alerts/rules/:id',
  validateParams(z.object({ id: z.string().uuid() })),
  validateBody(schemas.createAlertRule.partial()),
  asyncHandler(async (req, res) => {
    const userId = req.apiKey?.userId || req.apiKey?.id;
    const { id } = req.params;

    // First check if rule exists and belongs to user
    const { data: existing } = await supabase
      .from('alert_rules')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (!existing) {
      throw new AppError('Alert rule not found or unauthorized', 404);
    }

    const { data, error } = await supabase
      .from('alert_rules')
      .update({
        name: req.body.name,
        conditions: req.body.conditions,
        webhook_url: req.body.webhookUrl,
        is_active: req.body.isActive
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update alert rule:', error);
      throw new AppError('Failed to update alert rule', 500);
    }

    res.json({
      success: true,
      data
    });
  })
);

/**
 * DELETE /api/v1/alerts/rules/:id
 * Delete an alert rule
 */
router.delete(
  '/alerts/rules/:id',
  validateParams(z.object({ id: z.string().uuid() })),
  asyncHandler(async (req, res) => {
    const userId = req.apiKey?.userId || req.apiKey?.id;
    const { id } = req.params;

    const { error } = await supabase
      .from('alert_rules')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      logger.error('Failed to delete alert rule:', error);
      throw new AppError('Failed to delete alert rule', 500);
    }

    res.json({
      success: true,
      message: 'Alert rule deleted successfully'
    });
  })
);

export default router;
