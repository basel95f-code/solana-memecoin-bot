/**
 * Request validation middleware using Zod
 */

import type { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

/**
 * Validate request body against Zod schema
 */
export function validateBody<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validated = schema.parse(req.body);
      req.body = validated;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Validate query parameters against Zod schema
 */
export function validateQuery<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validated = schema.parse(req.query);
      req.query = validated;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Validate route parameters against Zod schema
 */
export function validateParams<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validated = schema.parse(req.params);
      req.params = validated;
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Common validation schemas
export const schemas = {
  // Solana mint address
  mintAddress: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Invalid Solana address'),

  // Pagination
  pagination: z.object({
    page: z.string().optional().transform(val => val ? parseInt(val) : 1),
    limit: z.string().optional().transform(val => val ? Math.min(parseInt(val), 100) : 20)
  }),

  // Risk level filter
  riskLevel: z.enum(['low', 'medium', 'high', 'extreme']).optional(),

  // Alert rule creation
  createAlertRule: z.object({
    name: z.string().min(1).max(100),
    conditions: z.object({
      minRiskScore: z.number().min(0).max(100).optional(),
      maxRiskScore: z.number().min(0).max(100).optional(),
      minLiquidity: z.number().min(0).optional(),
      patterns: z.array(z.string()).optional(),
      minConfidence: z.number().min(0).max(1).optional()
    }),
    webhookUrl: z.string().url().optional(),
    isActive: z.boolean().default(true)
  })
};
