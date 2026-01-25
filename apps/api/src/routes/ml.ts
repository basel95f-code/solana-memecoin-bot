/**
 * ML API Routes
 * RESTful API for ML predictions and model management
 */

import { Router, Request, Response } from 'express';
import { mlInferenceServer } from '../../../bot/src/ml/inference/server';
import { mlTrainingPipeline } from '../../../bot/src/ml/training/pipeline';
import { database } from '../../../bot/src/database';
import { logger } from '../../../bot/src/utils/logger';

const router = Router();

// Middleware for API key authentication (simple version)
const authenticateAPI = (req: Request, res: Response, next: Function) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (apiKey !== process.env.ML_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
};

// Middleware for admin authentication
const authenticateAdmin = (req: Request, res: Response, next: Function) => {
  const adminKey = req.headers['x-admin-key'] || req.query.adminKey;
  
  if (adminKey !== process.env.ML_ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden - Admin access required' });
  }
  
  next();
};

/**
 * POST /api/v1/ml/predict
 * Get ML prediction for a token
 * 
 * Body:
 * {
 *   "model": "price_prediction" | "sentiment_correlation" | "whale_behavior" | "rug_prediction",
 *   "tokenMint": "string",
 *   "input": { ... model-specific input },
 *   "options": {
 *     "useCache": true,
 *     "explain": false
 *   }
 * }
 */
router.post('/predict', authenticateAPI, async (req: Request, res: Response) => {
  try {
    const { model, tokenMint, input, options } = req.body;

    if (!model || !input) {
      return res.status(400).json({
        error: 'Missing required fields: model, input',
      });
    }

    const validModels = ['price_prediction', 'sentiment_correlation', 'whale_behavior', 'rug_prediction'];
    if (!validModels.includes(model)) {
      return res.status(400).json({
        error: `Invalid model. Must be one of: ${validModels.join(', ')}`,
      });
    }

    // Make prediction
    const prediction = await mlInferenceServer.predict({
      model,
      tokenMint,
      input,
      options,
    });

    res.json({
      success: true,
      data: prediction,
    });

  } catch (error) {
    logger.error('ML API', 'Prediction failed', error as Error);
    res.status(500).json({
      error: 'Prediction failed',
      message: (error as Error).message,
    });
  }
});

/**
 * POST /api/v1/ml/predict/batch
 * Batch prediction for multiple tokens
 * 
 * Body:
 * {
 *   "requests": [
 *     { "model": "...", "tokenMint": "...", "input": {...} },
 *     ...
 *   ]
 * }
 */
router.post('/predict/batch', authenticateAPI, async (req: Request, res: Response) => {
  try {
    const { requests } = req.body;

    if (!Array.isArray(requests) || requests.length === 0) {
      return res.status(400).json({
        error: 'Invalid request: "requests" must be a non-empty array',
      });
    }

    if (requests.length > 100) {
      return res.status(400).json({
        error: 'Batch size too large. Maximum 100 requests per batch.',
      });
    }

    const predictions = await mlInferenceServer.predictBatch(requests);

    res.json({
      success: true,
      count: predictions.length,
      data: predictions,
    });

  } catch (error) {
    logger.error('ML API', 'Batch prediction failed', error as Error);
    res.status(500).json({
      error: 'Batch prediction failed',
      message: (error as Error).message,
    });
  }
});

/**
 * GET /api/v1/ml/models
 * List all ML models and their status
 */
router.get('/models', authenticateAPI, async (req: Request, res: Response) => {
  try {
    const stats = mlInferenceServer.getStats();

    // Get models from database
    const query = `
      SELECT 
        model_type,
        version,
        accuracy,
        loss,
        training_samples,
        is_active,
        is_production,
        created_at,
        deployed_at
      FROM ml_models
      WHERE is_active = TRUE
      ORDER BY created_at DESC
    `;
    
    const models = database.query(query);

    res.json({
      success: true,
      server: {
        initialized: stats.initialized,
        queuedBatches: stats.queuedBatches,
      },
      models: models || [],
      modelStats: stats.models,
    });

  } catch (error) {
    logger.error('ML API', 'Failed to list models', error as Error);
    res.status(500).json({
      error: 'Failed to list models',
      message: (error as Error).message,
    });
  }
});

/**
 * GET /api/v1/ml/performance
 * Get model performance metrics
 */
router.get('/performance', authenticateAPI, async (req: Request, res: Response) => {
  try {
    const { modelType, modelVersion, hours } = req.query;

    let query = `SELECT * FROM ml_model_performance_summary`;
    const params: any[] = [];

    if (modelType) {
      query += ` WHERE model_type = ?`;
      params.push(modelType);
    }

    query += ` ORDER BY trained_at DESC LIMIT 20`;

    const performance = database.query(query, params);

    // Get recent predictions
    const predictionsQuery = `
      SELECT 
        model_type,
        COUNT(*) as total,
        AVG(confidence) as avg_confidence,
        COUNT(CASE WHEN was_correct = TRUE THEN 1 END) as correct,
        COUNT(CASE WHEN was_correct = FALSE THEN 1 END) as incorrect
      FROM ml_predictions
      WHERE created_at > datetime('now', '-${hours || 24} hours')
      ${modelType ? 'AND model_type = ?' : ''}
      GROUP BY model_type
    `;
    
    const recentPredictions = database.query(
      predictionsQuery,
      modelType ? [modelType] : []
    );

    res.json({
      success: true,
      performance: performance || [],
      recentPredictions: recentPredictions || [],
    });

  } catch (error) {
    logger.error('ML API', 'Failed to get performance', error as Error);
    res.status(500).json({
      error: 'Failed to get performance metrics',
      message: (error as Error).message,
    });
  }
});

/**
 * GET /api/v1/ml/predictions/:tokenMint
 * Get prediction history for a token
 */
router.get('/predictions/:tokenMint', authenticateAPI, async (req: Request, res: Response) => {
  try {
    const { tokenMint } = req.params;
    const { limit = 10 } = req.query;

    const query = `
      SELECT *
      FROM ml_predictions
      WHERE token_mint = ?
      ORDER BY created_at DESC
      LIMIT ?
    `;

    const predictions = database.query(query, [tokenMint, Number(limit)]);

    res.json({
      success: true,
      tokenMint,
      count: (predictions as any[]).length,
      predictions: predictions || [],
    });

  } catch (error) {
    logger.error('ML API', 'Failed to get predictions', error as Error);
    res.status(500).json({
      error: 'Failed to get predictions',
      message: (error as Error).message,
    });
  }
});

/**
 * POST /api/v1/ml/train
 * Trigger model training (admin only)
 * 
 * Body:
 * {
 *   "model": "price_prediction",
 *   "timeframe": "1h",
 *   "epochs": 100,
 *   "batchSize": 32
 * }
 */
router.post('/train', authenticateAPI, authenticateAdmin, async (req: Request, res: Response) => {
  try {
    const { model, timeframe, epochs, batchSize, minSamples } = req.body;

    if (!model) {
      return res.status(400).json({
        error: 'Missing required field: model',
      });
    }

    // Start training (async)
    const result = await mlTrainingPipeline.trainModel({
      model,
      timeframe,
      epochs,
      batchSize,
      minSamples,
    });

    res.json({
      success: result.success,
      data: result,
    });

  } catch (error) {
    logger.error('ML API', 'Training failed', error as Error);
    res.status(500).json({
      error: 'Training failed',
      message: (error as Error).message,
    });
  }
});

/**
 * GET /api/v1/ml/training/status
 * Get training pipeline status and history
 */
router.get('/training/status', authenticateAPI, async (req: Request, res: Response) => {
  try {
    const stats = mlTrainingPipeline.getStats();

    res.json({
      success: true,
      stats,
    });

  } catch (error) {
    logger.error('ML API', 'Failed to get training status', error as Error);
    res.status(500).json({
      error: 'Failed to get training status',
      message: (error as Error).message,
    });
  }
});

/**
 * PUT /api/v1/ml/predictions/:id/outcome
 * Update prediction outcome (for tracking accuracy)
 * 
 * Body:
 * {
 *   "actualOutcome": "rug" | "pump" | "dump" | etc,
 *   "actualChange": 25.5
 * }
 */
router.put('/predictions/:id/outcome', authenticateAPI, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { actualOutcome, actualChange } = req.body;

    if (!actualOutcome) {
      return res.status(400).json({
        error: 'Missing required field: actualOutcome',
      });
    }

    // Update prediction outcome
    database.query(
      `SELECT update_prediction_outcome(?, ?, ?)`,
      [Number(id), actualOutcome, actualChange || null]
    );

    res.json({
      success: true,
      message: 'Prediction outcome updated',
    });

  } catch (error) {
    logger.error('ML API', 'Failed to update outcome', error as Error);
    res.status(500).json({
      error: 'Failed to update outcome',
      message: (error as Error).message,
    });
  }
});

/**
 * GET /api/v1/ml/health
 * Health check endpoint
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const stats = mlInferenceServer.getStats();

    res.json({
      success: true,
      status: stats.initialized ? 'healthy' : 'initializing',
      models: stats.models,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: (error as Error).message,
    });
  }
});

export default router;
