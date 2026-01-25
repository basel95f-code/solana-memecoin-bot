/**
 * OpenAPI/Swagger documentation
 */

import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Solana Memecoin Bot API',
      version: '1.0.0',
      description: 'REST API for accessing Solana memecoin analysis data, patterns, and smart money tracking',
      contact: {
        name: 'API Support',
        url: 'https://github.com/yourusername/solana-memecoin-bot'
      }
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Development server'
      },
      {
        url: 'https://api.yourdomain.com',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API Key',
          description: 'API key authentication. Use your API key as the bearer token.'
        }
      },
      schemas: {
        Token: {
          type: 'object',
          properties: {
            mint: { type: 'string', description: 'Token mint address' },
            symbol: { type: 'string', description: 'Token symbol' },
            name: { type: 'string', description: 'Token name' },
            riskScore: { type: 'number', description: 'Risk score (0-100)' },
            riskLevel: { 
              type: 'string', 
              enum: ['low', 'medium', 'high', 'extreme'],
              description: 'Risk level classification'
            },
            liquidityUsd: { type: 'number', description: 'Liquidity in USD' },
            holderCount: { type: 'number', description: 'Number of token holders' },
            analyzedAt: { type: 'string', format: 'date-time', description: 'Analysis timestamp' }
          }
        },
        Pattern: {
          type: 'object',
          properties: {
            mint: { type: 'string', description: 'Token mint address' },
            symbol: { type: 'string', description: 'Token symbol' },
            pattern: { type: 'string', description: 'Detected pattern type' },
            confidence: { type: 'number', description: 'Confidence score (0-1)' },
            detectedAt: { type: 'string', format: 'date-time' },
            outcome: { type: 'string', description: 'Pattern outcome if known' }
          }
        },
        SmartMoneyWallet: {
          type: 'object',
          properties: {
            address: { type: 'string', description: 'Wallet address' },
            totalProfitUsd: { type: 'number', description: 'Total profit in USD' },
            winRate: { type: 'number', description: 'Win rate (0-1)' },
            totalTrades: { type: 'number', description: 'Total number of trades' }
          }
        },
        AlertRule: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            conditions: { 
              type: 'object',
              properties: {
                minRiskScore: { type: 'number' },
                maxRiskScore: { type: 'number' },
                minLiquidity: { type: 'number' },
                patterns: { type: 'array', items: { type: 'string' } },
                minConfidence: { type: 'number' }
              }
            },
            webhookUrl: { type: 'string', format: 'uri' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
            details: { type: 'array', items: { type: 'object' } }
          }
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'number' },
            limit: { type: 'number' },
            total: { type: 'number' },
            totalPages: { type: 'number' }
          }
        }
      },
      responses: {
        Unauthorized: {
          description: 'Unauthorized - Invalid or missing API key',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' }
            }
          }
        },
        RateLimited: {
          description: 'Rate limit exceeded',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' }
            }
          }
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' }
            }
          }
        }
      }
    },
    security: [
      {
        BearerAuth: []
      }
    ],
    tags: [
      {
        name: 'Health',
        description: 'Health check endpoints'
      },
      {
        name: 'Tokens',
        description: 'Token analysis endpoints'
      },
      {
        name: 'Patterns',
        description: 'Pattern detection endpoints'
      },
      {
        name: 'Smart Money',
        description: 'Smart money wallet tracking'
      },
      {
        name: 'Alerts',
        description: 'Alert rule management'
      },
      {
        name: 'Stats',
        description: 'Bot statistics'
      },
      {
        name: 'Admin',
        description: 'Admin endpoints (API key management)'
      }
    ]
  },
  apis: ['./src/routes/*.ts'] // Path to API route files
};

export const swaggerSpec = swaggerJsdoc(options);
