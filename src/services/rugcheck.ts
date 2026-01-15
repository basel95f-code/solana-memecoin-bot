import axios from 'axios';
import { config } from '../config';
import { RugCheckResult, RugCheckRisk } from '../types';
import { withRetry } from '../utils/retry';

const RUGCHECK_API_BASE = 'https://api.rugcheck.xyz/v1';

class RugCheckService {
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = config.rugcheckApiKey;
  }

  async getTokenReport(mintAddress: string): Promise<RugCheckResult | null> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await withRetry(
        () => axios.get(
          `${RUGCHECK_API_BASE}/tokens/${mintAddress}/report`,
          {
            headers,
            timeout: 10000,
          }
        ),
        {
          maxRetries: 3,
          initialDelayMs: 500,
          retryableErrors: ['ECONNRESET', 'ETIMEDOUT', '429', '502', '503', '504'],
        }
      );

      return this.parseReport(response.data);
    } catch (error) {
      // RugCheck might not have data for new tokens
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      console.error(`RugCheck API error for ${mintAddress}:`, error);
      return null;
    }
  }

  private parseReport(data: any): RugCheckResult {
    const risks: RugCheckRisk[] = [];
    let totalScore = 100;

    // Parse risks from the API response
    if (data.risks && Array.isArray(data.risks)) {
      for (const risk of data.risks) {
        const level = this.mapRiskLevel(risk.level || risk.severity);
        const scoreImpact = this.getScoreImpact(level);

        risks.push({
          name: risk.name || risk.type,
          description: risk.description || risk.message,
          level,
          score: scoreImpact,
        });

        totalScore -= scoreImpact;
      }
    }

    // Use API score if available
    if (typeof data.score === 'number') {
      totalScore = data.score;
    }

    return {
      score: Math.max(0, Math.min(100, totalScore)),
      risks,
      verified: data.verified || false,
    };
  }

  private mapRiskLevel(level: string): 'info' | 'warning' | 'danger' {
    switch (level?.toLowerCase()) {
      case 'danger':
      case 'high':
      case 'critical':
        return 'danger';
      case 'warning':
      case 'medium':
        return 'warning';
      default:
        return 'info';
    }
  }

  private getScoreImpact(level: 'info' | 'warning' | 'danger'): number {
    switch (level) {
      case 'danger': return 25;
      case 'warning': return 10;
      case 'info': return 5;
      default: return 0;
    }
  }

  async getSummary(mintAddress: string): Promise<{ score: number; riskCount: number } | null> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await withRetry(
        () => axios.get(
          `${RUGCHECK_API_BASE}/tokens/${mintAddress}/report/summary`,
          {
            headers,
            timeout: 5000,
          }
        ),
        {
          maxRetries: 2,
          initialDelayMs: 300,
          retryableErrors: ['ECONNRESET', 'ETIMEDOUT', '429', '502', '503', '504'],
        }
      );

      return {
        score: response.data.score || 0,
        riskCount: response.data.riskCount || response.data.risks?.length || 0,
      };
    } catch {
      return null;
    }
  }
}

export const rugCheckService = new RugCheckService();
