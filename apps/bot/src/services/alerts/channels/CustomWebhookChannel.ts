/**
 * Custom Webhook Alert Channel
 * Sends alerts to any HTTP endpoint
 * Supports custom payload templates
 */

import axios from 'axios';
import { logger } from '../../../utils/logger';
import { BaseChannel } from './BaseChannel';
import type { Alert, AlertBatch, DeliveryResult, WebhookConfig, ChannelType } from '../types';

export class CustomWebhookChannel extends BaseChannel {
  private config: WebhookConfig;

  constructor(id: string, name: string, config: WebhookConfig) {
    super(id, 'custom_webhook' as ChannelType, name);
    this.config = config;
  }

  /**
   * Send alert to custom webhook
   */
  async send(alert: Alert): Promise<DeliveryResult> {
    try {
      const payload = this.buildPayload(alert);
      
      await axios({
        method: this.config.method,
        url: this.config.url,
        data: payload,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Solana-Memecoin-Bot/1.0',
          ...this.config.headers,
        },
        timeout: 10000,
      });

      logger.info('CustomWebhookChannel', `Sent alert ${alert.id} to ${this.config.url}`);
      
      return this.createSuccessResult(alert.id);
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message || 'Unknown error';
      logger.error('CustomWebhookChannel', `Failed to send alert ${alert.id}:`, errorMsg);
      return this.createFailureResult(errorMsg, alert.id);
    }
  }

  /**
   * Send batch to custom webhook
   */
  async sendBatch(batch: AlertBatch): Promise<DeliveryResult> {
    try {
      const payload = this.buildBatchPayload(batch);
      
      await axios({
        method: this.config.method,
        url: this.config.url,
        data: payload,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Solana-Memecoin-Bot/1.0',
          ...this.config.headers,
        },
        timeout: 10000,
      });

      logger.info('CustomWebhookChannel', `Sent batch ${batch.id} with ${batch.alerts.length} alerts`);
      
      return this.createSuccessResult(batch.id);
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message || 'Unknown error';
      logger.error('CustomWebhookChannel', `Failed to send batch ${batch.id}:`, errorMsg);
      return this.createFailureResult(errorMsg, batch.id);
    }
  }

  /**
   * Build payload for single alert
   */
  private buildPayload(alert: Alert): any {
    // Use custom template if provided
    if (this.config.template) {
      return this.applyTemplate(this.config.template, alert);
    }

    // Default payload format
    return {
      event: 'alert',
      alert: {
        id: alert.id,
        type: alert.type,
        priority: alert.priority,
        title: alert.title,
        message: alert.message,
        data: alert.data,
        timestamp: alert.timestamp,
      },
      metadata: {
        source: 'solana-memecoin-bot',
        version: '1.0',
      },
    };
  }

  /**
   * Build payload for batch
   */
  private buildBatchPayload(batch: AlertBatch): any {
    // Use custom template if provided
    if (this.config.template) {
      return this.applyTemplate(this.config.template, batch);
    }

    // Default batch payload format
    return {
      event: 'alert_batch',
      batch: {
        id: batch.id,
        type: batch.type,
        priority: batch.priority,
        summary: batch.summary,
        alertCount: batch.alerts.length,
        alerts: batch.alerts.map(a => ({
          id: a.id,
          type: a.type,
          title: a.title,
          data: a.data,
        })),
        timestamp: batch.timestamp,
      },
      metadata: {
        source: 'solana-memecoin-bot',
        version: '1.0',
      },
    };
  }

  /**
   * Apply custom template to payload
   */
  private applyTemplate(template: string, data: Alert | AlertBatch): any {
    try {
      // Replace template variables
      let result = template;
      
      // Support {{variable}} syntax
      const vars: Record<string, any> = this.extractTemplateVars(data);
      
      for (const [key, value] of Object.entries(vars)) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        result = result.replace(regex, String(value));
      }

      return JSON.parse(result);
    } catch (error) {
      logger.error('CustomWebhookChannel', 'Failed to apply template:', error);
      // Fallback to default payload
      return 'alerts' in data ? this.buildBatchPayload(data) : this.buildPayload(data);
    }
  }

  /**
   * Extract template variables from alert/batch
   */
  private extractTemplateVars(data: Alert | AlertBatch): Record<string, any> {
    if ('alerts' in data) {
      // Batch
      return {
        id: data.id,
        type: data.type,
        priority: data.priority,
        summary: data.summary,
        alertCount: data.alerts.length,
        timestamp: data.timestamp,
      };
    } else {
      // Single alert
      return {
        id: data.id,
        type: data.type,
        priority: data.priority,
        title: data.title,
        message: data.message,
        timestamp: data.timestamp,
        ...data.data, // Include all data fields
      };
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Try a HEAD request to check if endpoint is reachable
      await axios.head(this.config.url, {
        timeout: 5000,
        headers: this.config.headers,
      });
      return true;
    } catch (error) {
      // HEAD might not be supported, try GET
      try {
        await axios.get(this.config.url, {
          timeout: 5000,
          headers: this.config.headers,
        });
        return true;
      } catch (error2) {
        logger.error('CustomWebhookChannel', 'Health check failed:', error2);
        return false;
      }
    }
  }
}
