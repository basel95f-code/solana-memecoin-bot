/**
 * Shared types for API
 */

export interface APIKey {
  id: string;
  key: string; // hashed
  name: string;
  userId?: string;
  rateLimit: number; // requests per minute
  isActive: boolean;
  createdAt: Date;
  lastUsedAt?: Date;
  expiresAt?: Date;
}

export interface APIKeyUsage {
  keyId: string;
  requestCount: number;
  lastReset: Date;
}

export interface TokenResponse {
  mint: string;
  symbol?: string;
  name?: string;
  riskScore: number;
  riskLevel: string;
  liquidityUsd: number;
  holderCount: number;
  analyzedAt: string;
}

export interface PatternResponse {
  mint: string;
  symbol?: string;
  pattern: string;
  confidence: number;
  detectedAt: string;
  outcome?: string;
}

export interface AlertRule {
  id: string;
  name: string;
  conditions: {
    minRiskScore?: number;
    maxRiskScore?: number;
    minLiquidity?: number;
    patterns?: string[];
    minConfidence?: number;
  };
  webhookUrl?: string;
  isActive: boolean;
  createdAt: Date;
}

export interface WebSocketMessage {
  type: 'token_update' | 'pattern_detected' | 'alert' | 'error' | 'heartbeat';
  data: unknown;
  timestamp: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'down';
  uptime: number;
  timestamp: string;
  services: {
    database: boolean;
    websocket: boolean;
    cache: boolean;
  };
}
