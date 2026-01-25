import { config } from '../config';
import type { RugCheckResult, RugCheckRisk } from '../types';
import { ResilientApiClient, validators } from './resilientApi';
import { logger } from '../utils/logger';

const RUGCHECK_API_BASE = 'https://api.rugcheck.xyz/v1';

// ============================================
// Resilient RugCheck Client
// ============================================

class RugCheckService {
  private api: ResilientApiClient;
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = config.rugcheckApiKey;

    // Create resilient API client
    this.api = new ResilientApiClient({
      name: 'RugCheck',
      baseURL: RUGCHECK_API_BASE,
      timeout: 10000,
      maxRetries: 3,
      rateLimit: { maxTokens: 10, refillRate: 2 }, // Conservative rate limiting
      circuitBreaker: { threshold: 5, resetTimeMs: 60000 },
      cacheTTL: 600000, // 10 minutes (rug check data doesn't change often)
      headers: this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {},
    });
  }

  // ============================================
  // Core API Methods
  // ============================================

  /**
   * Get full token report with robust error handling
   */
  async getTokenReport(mintAddress: string): Promise<RugCheckResult | null> {
    const response = await this.api.get<any>(
      `/tokens/${mintAddress}/report`,
      {
        cache: true,
        cacheKey: `report:${mintAddress}`,
        cacheTTL: 600000, // 10 minutes
        validator: (data) => data && typeof data === 'object',
        transform: (data) => this.parseReport(data),
      }
    );

    if (response.error) {
      // 404 is expected for new tokens that haven't been analyzed yet
      if (response.error.includes('404') || response.error.includes('not found')) {
        logger.debug('RugCheck', `Token ${mintAddress} not found (likely new)`);
        return null;
      }

      logger.warn('RugCheck', `Failed to fetch report for ${mintAddress}: ${response.error}`);
      return null;
    }

    return response.data;
  }

  /**
   * Get quick summary (faster, less data)
   */
  async getSummary(mintAddress: string): Promise<{ score: number; riskCount: number } | null> {
    const response = await this.api.get<any>(
      `/tokens/${mintAddress}/report/summary`,
      {
        cache: true,
        cacheKey: `summary:${mintAddress}`,
        cacheTTL: 600000,
        validator: (data) => data && typeof data === 'object',
      }
    );

    if (response.error) {
      if (response.error.includes('404') || response.error.includes('not found')) {
        logger.debug('RugCheck', `Summary for ${mintAddress} not found`);
        return null;
      }

      logger.warn('RugCheck', `Failed to fetch summary for ${mintAddress}: ${response.error}`);
      return null;
    }

    if (!response.data) return null;

    return {
      score: response.data.score || 0,
      riskCount: response.data.riskCount || response.data.risks?.length || 0,
    };
  }

  // ============================================
  // Data Parsing
  // ============================================

  /**
   * Parse RugCheck report with validation
   */
  private parseReport(data: any): RugCheckResult {
    const risks: RugCheckRisk[] = [];
    let totalScore = 100;

    // Validate and parse risks
    if (data.risks && Array.isArray(data.risks)) {
      for (const risk of data.risks) {
        // Validate risk object has required fields
        if (!risk || typeof risk !== 'object') {
          logger.warn('RugCheck', 'Invalid risk object in response');
          continue;
        }

        const level = this.mapRiskLevel(risk.level || risk.severity);
        const scoreImpact = this.getScoreImpact(level);

        risks.push({
          name: String(risk.name || risk.type || 'Unknown Risk'),
          description: String(risk.description || risk.message || 'No description'),
          level,
          score: scoreImpact,
        });

        totalScore -= scoreImpact;
      }
    }

    // Use API score if available and valid
    if (typeof data.score === 'number' && !isNaN(data.score)) {
      totalScore = data.score;
    }

    // Ensure score is within valid range
    totalScore = Math.max(0, Math.min(100, totalScore));

    return {
      score: totalScore,
      risks,
      verified: Boolean(data.verified),
    };
  }

  /**
   * Map risk level with fallback
   */
  private mapRiskLevel(level: string | undefined): 'info' | 'warning' | 'danger' {
    if (!level || typeof level !== 'string') {
      return 'info';
    }

    const normalized = level.toLowerCase().trim();

    switch (normalized) {
      case 'danger':
      case 'high':
      case 'critical':
      case 'severe':
        return 'danger';
      case 'warning':
      case 'medium':
      case 'moderate':
        return 'warning';
      case 'info':
      case 'low':
      case 'minor':
      default:
        return 'info';
    }
  }

  /**
   * Get score impact based on risk level
   */
  private getScoreImpact(level: 'info' | 'warning' | 'danger'): number {
    switch (level) {
      case 'danger':
        return 25;
      case 'warning':
        return 10;
      case 'info':
        return 5;
      default:
        return 0;
    }
  }

  // ============================================
  // Batch Operations
  // ============================================

  /**
   * Batch fetch summaries for multiple tokens
   */
  async getBatchSummaries(mintAddresses: string[]): Promise<Map<string, { score: number; riskCount: number }>> {
    const results = new Map<string, { score: number; riskCount: number }>();

    // Process in parallel with controlled concurrency
    const batchSize = 5;
    for (let i = 0; i < mintAddresses.length; i += batchSize) {
      const batch = mintAddresses.slice(i, i + batchSize);
      const promises = batch.map(addr => this.getSummary(addr));
      const batchResults = await Promise.allSettled(promises);

      for (let j = 0; j < batch.length; j++) {
        const result = batchResults[j];
        if (result.status === 'fulfilled' && result.value) {
          results.set(batch[j], result.value);
        }
      }
    }

    return results;
  }

  // ============================================
  // Health & Utility
  // ============================================

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.api.isHealthy();
  }

  /**
   * Check if service is available (has API key or public access works)
   */
  isConfigured(): boolean {
    return true; // RugCheck works without API key (with rate limits)
  }

  hasApiKey(): boolean {
    return Boolean(this.apiKey);
  }

  clearCache(): void {
    this.api.clearCache();
  }

  getStats(): any {
    return this.api.getStats();
  }

  resetCircuit(): void {
    this.api.resetCircuit();
  }
}

export const rugCheckService = new RugCheckService();
