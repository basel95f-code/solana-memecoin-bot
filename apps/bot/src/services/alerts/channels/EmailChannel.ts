/**
 * Email Alert Channel
 * Sends alerts via SendGrid or Resend
 */

import axios from 'axios';
import { logger } from '../../../utils/logger';
import { BaseChannel } from './BaseChannel';
import type { Alert, AlertBatch, DeliveryResult, ChannelType } from '../types';

export interface EmailConfig {
  provider: 'sendgrid' | 'resend';
  apiKey: string;
  fromEmail: string;
  fromName?: string;
  toEmail: string;
  toName?: string;
}

interface SendGridPayload {
  personalizations: Array<{
    to: Array<{ email: string; name?: string }>;
    subject: string;
  }>;
  from: { email: string; name?: string };
  content: Array<{ type: string; value: string }>;
}

interface ResendPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
}

export class EmailChannel extends BaseChannel {
  private config: EmailConfig;

  constructor(id: string, name: string, config: EmailConfig) {
    super(id, 'custom_webhook' as ChannelType, name); // Using custom_webhook as closest type
    this.config = config;
  }

  /**
   * Send alert via email
   */
  async send(alert: Alert): Promise<DeliveryResult> {
    try {
      if (this.config.provider === 'sendgrid') {
        await this.sendViaSendGrid(alert);
      } else if (this.config.provider === 'resend') {
        await this.sendViaResend(alert);
      } else {
        throw new Error(`Unknown email provider: ${this.config.provider}`);
      }

      logger.info('EmailChannel', `Sent alert ${alert.id} via ${this.config.provider}`);
      
      return this.createSuccessResult(alert.id);
    } catch (error: any) {
      const errorMsg = error.response?.data?.errors?.[0]?.message || error.message;
      logger.error('EmailChannel', `Failed to send alert ${alert.id}:`, errorMsg);
      return this.createFailureResult(errorMsg, alert.id);
    }
  }

  /**
   * Send batch via email
   */
  async sendBatch(batch: AlertBatch): Promise<DeliveryResult> {
    try {
      const batchAlert = this.formatBatchAsAlert(batch);
      return await this.send(batchAlert);
    } catch (error: any) {
      const errorMsg = error.message;
      logger.error('EmailChannel', `Failed to send batch ${batch.id}:`, errorMsg);
      return this.createFailureResult(errorMsg, batch.id);
    }
  }

  /**
   * Send via SendGrid
   */
  private async sendViaSendGrid(alert: Alert): Promise<void> {
    const subject = this.formatSubject(alert);
    const html = this.formatHtml(alert);

    const payload: SendGridPayload = {
      personalizations: [
        {
          to: [{ email: this.config.toEmail, name: this.config.toName }],
          subject,
        },
      ],
      from: {
        email: this.config.fromEmail,
        name: this.config.fromName || 'Solana Alert Bot',
      },
      content: [
        {
          type: 'text/html',
          value: html,
        },
      ],
    };

    await axios.post('https://api.sendgrid.com/v3/mail/send', payload, {
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
  }

  /**
   * Send via Resend
   */
  private async sendViaResend(alert: Alert): Promise<void> {
    const subject = this.formatSubject(alert);
    const html = this.formatHtml(alert);

    const from = this.config.fromName
      ? `${this.config.fromName} <${this.config.fromEmail}>`
      : this.config.fromEmail;

    const payload: ResendPayload = {
      from,
      to: [this.config.toEmail],
      subject,
      html,
    };

    await axios.post('https://api.resend.com/emails', payload, {
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
  }

  /**
   * Format email subject
   */
  private formatSubject(alert: Alert): string {
    const priorityPrefix = this.getPriorityPrefix(alert.priority);
    return `${priorityPrefix}${alert.title}`;
  }

  /**
   * Format HTML email body
   */
  private formatHtml(alert: Alert): string {
    const emoji = this.getEmojiForType(alert.type);
    const priorityBadge = this.getPriorityBadge(alert.priority);

    let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${alert.title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: #ffffff;
      border-radius: 8px;
      padding: 30px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 20px;
      margin-bottom: 20px;
    }
    .title {
      font-size: 24px;
      font-weight: bold;
      color: #1a1a1a;
      margin: 0 0 10px 0;
    }
    .priority-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
      text-transform: uppercase;
    }
    .priority-critical { background-color: #ff4444; color: white; }
    .priority-high { background-color: #ff9944; color: white; }
    .priority-normal { background-color: #ffdd44; color: #333; }
    .priority-low { background-color: #44ff44; color: #333; }
    .message {
      font-size: 16px;
      margin: 20px 0;
      white-space: pre-wrap;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    .data-table th,
    .data-table td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #e0e0e0;
    }
    .data-table th {
      background-color: #f5f5f5;
      font-weight: 600;
      color: #666;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      font-size: 12px;
      color: #999;
      text-align: center;
    }
    .code {
      background-color: #f5f5f5;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title">${emoji} ${alert.title}</div>
      ${priorityBadge}
    </div>
    
    <div class="message">${this.escapeHtml(alert.message)}</div>
`;

    // Add data table if there's data
    if (Object.keys(alert.data).length > 0) {
      html += this.formatDataTable(alert.data);
    }

    html += `
    <div class="footer">
      Solana Alert Bot • ${new Date(alert.timestamp).toLocaleString()}<br>
      Alert ID: <span class="code">${alert.id}</span>
    </div>
  </div>
</body>
</html>
`;

    return html;
  }

  /**
   * Format data table in HTML
   */
  private formatDataTable(data: Record<string, any>): string {
    const rows: string[] = [];

    // Add common fields in a specific order
    const fieldOrder = ['symbol', 'mint', 'price', 'liquidity', 'volume', 'marketCap', 'riskScore'];

    for (const key of fieldOrder) {
      if (data[key] !== undefined) {
        const displayKey = this.formatFieldName(key);
        const displayValue = this.formatFieldValue(key, data[key]);
        rows.push(`<tr><th>${displayKey}</th><td>${displayValue}</td></tr>`);
      }
    }

    // Add remaining fields
    for (const [key, value] of Object.entries(data)) {
      if (!fieldOrder.includes(key) && value !== undefined) {
        const displayKey = this.formatFieldName(key);
        const displayValue = this.formatFieldValue(key, value);
        rows.push(`<tr><th>${displayKey}</th><td>${displayValue}</td></tr>`);
      }
    }

    if (rows.length === 0) return '';

    return `
<table class="data-table">
  ${rows.join('\n  ')}
</table>
`;
  }

  /**
   * Format field name for display
   */
  private formatFieldName(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }

  /**
   * Format field value for display
   */
  private formatFieldValue(key: string, value: any): string {
    if (key === 'mint' && typeof value === 'string') {
      return `<span class="code">${value}</span>`;
    }

    if ((key === 'price' || key === 'liquidity' || key === 'volume' || key === 'marketCap') && typeof value === 'number') {
      return `$${this.formatNumber(value)}`;
    }

    if (typeof value === 'number') {
      return this.formatNumber(value);
    }

    if (typeof value === 'boolean') {
      return value ? '✓ Yes' : '✗ No';
    }

    return this.escapeHtml(String(value));
  }

  /**
   * Format number with commas
   */
  private formatNumber(num: number): string {
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  /**
   * Escape HTML
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, char => map[char]);
  }

  /**
   * Get priority prefix for subject
   */
  private getPriorityPrefix(priority: string): string {
    const prefixMap: Record<string, string> = {
      critical: '[CRITICAL] ',
      high: '[HIGH] ',
      normal: '',
      low: '[INFO] ',
    };
    return prefixMap[priority] || '';
  }

  /**
   * Get priority badge HTML
   */
  private getPriorityBadge(priority: string): string {
    return `<span class="priority-badge priority-${priority}">${priority}</span>`;
  }

  /**
   * Get emoji for alert type
   */
  private getEmojiForType(type: string): string {
    const emojiMap: Record<string, string> = {
      new_token: '✨',
      volume_spike: '📊',
      whale_movement: '🐋',
      liquidity_drain: '💧',
      authority_change: '🔐',
      price_alert: '💰',
      smart_money: '🧠',
      wallet_activity: '👛',
      trading_signal: '📡',
      rug_detected: '🚨',
      system: 'ℹ️',
    };
    return emojiMap[type] || '🔔';
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Just verify API key is set
      return this.config.apiKey.length > 0;
    } catch (error) {
      logger.error('EmailChannel', 'Health check failed:', error);
      return false;
    }
  }
}
