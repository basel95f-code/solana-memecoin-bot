/**
 * Alert Router
 * Routes alerts to appropriate channels based on priority, type, and rules
 * Supports flexible routing rules per channel
 */

import { logger } from '../../utils/logger';
import type { Alert, AlertBatch, ChannelConfig, RoutingRule, RoutingResult } from './types';
import { AlertPriority } from './types';

export class AlertRouter {
  private channels: Map<string, ChannelConfig> = new Map();

  /**
   * Register a channel
   */
  registerChannel(config: ChannelConfig): void {
    this.channels.set(config.id, config);
    logger.info('AlertRouter', `Registered channel: ${config.name} (${config.type})`);
  }

  /**
   * Unregister a channel
   */
  unregisterChannel(channelId: string): boolean {
    const deleted = this.channels.delete(channelId);
    if (deleted) {
      logger.info('AlertRouter', `Unregistered channel: ${channelId}`);
    }
    return deleted;
  }

  /**
   * Get channel by ID
   */
  getChannel(channelId: string): ChannelConfig | undefined {
    return this.channels.get(channelId);
  }

  /**
   * Get all channels
   */
  getAllChannels(): ChannelConfig[] {
    return Array.from(this.channels.values());
  }

  /**
   * Route alert to appropriate channels
   */
  route(alert: Alert): RoutingResult {
    const matchedChannels: string[] = [];

    for (const channel of this.channels.values()) {
      // Skip disabled channels
      if (!channel.enabled) continue;

      // Check if alert matches channel's routing rules
      if (this.matchesRules(alert, channel.routingRules)) {
        matchedChannels.push(channel.id);
      }
    }

    // If no channels matched, use default behavior
    if (matchedChannels.length === 0) {
      return this.getDefaultRouting(alert);
    }

    return {
      shouldRoute: true,
      channelIds: matchedChannels,
    };
  }

  /**
   * Route batch to appropriate channels
   */
  routeBatch(batch: AlertBatch): RoutingResult {
    // Batch routing uses the batch priority, not individual alert priorities
    const syntheticAlert: Alert = {
      id: batch.id,
      type: batch.type,
      priority: batch.priority,
      title: batch.summary,
      message: batch.summary,
      data: { alertCount: batch.alerts.length },
      timestamp: batch.timestamp,
    };

    return this.route(syntheticAlert);
  }

  /**
   * Check if alert matches all routing rules
   */
  private matchesRules(alert: Alert, rules: RoutingRule[]): boolean {
    // No rules means accept all
    if (rules.length === 0) return true;

    // All rules must match (AND logic)
    return rules.every(rule => this.matchesRule(alert, rule));
  }

  /**
   * Check if alert matches a single rule
   */
  private matchesRule(alert: Alert, rule: RoutingRule): boolean {
    let fieldValue: any;

    // Extract field value
    switch (rule.field) {
      case 'type':
        fieldValue = alert.type;
        break;
      case 'priority':
        fieldValue = alert.priority;
        break;
      case 'data':
        fieldValue = alert.data;
        break;
      default:
        return false;
    }

    // Apply operator
    switch (rule.operator) {
      case 'equals':
        return fieldValue === rule.value;

      case 'not_equals':
        return fieldValue !== rule.value;

      case 'contains':
        if (typeof fieldValue === 'string') {
          return fieldValue.includes(rule.value);
        }
        if (typeof fieldValue === 'object') {
          return Object.keys(fieldValue).some(key => 
            key.includes(rule.value) || String(fieldValue[key]).includes(rule.value)
          );
        }
        return false;

      case 'gte':
        return this.comparePriority(fieldValue, rule.value) >= 0;

      case 'lte':
        return this.comparePriority(fieldValue, rule.value) <= 0;

      case 'in':
        return Array.isArray(rule.value) && rule.value.includes(fieldValue);

      default:
        return false;
    }
  }

  /**
   * Compare priority levels
   */
  private comparePriority(a: AlertPriority, b: AlertPriority): number {
    const priorities: AlertPriority[] = [AlertPriority.LOW, AlertPriority.NORMAL, AlertPriority.HIGH, AlertPriority.CRITICAL];
    return priorities.indexOf(a) - priorities.indexOf(b);
  }

  /**
   * Get default routing based on priority
   */
  private getDefaultRouting(alert: Alert): RoutingResult {
    const enabledChannels = Array.from(this.channels.values())
      .filter(c => c.enabled)
      .map(c => c.id);

    // No channels available
    if (enabledChannels.length === 0) {
      return {
        shouldRoute: false,
        channelIds: [],
        reason: 'No enabled channels available',
      };
    }

    // Critical alerts go to all channels
    if (alert.priority === 'critical') {
      return {
        shouldRoute: true,
        channelIds: enabledChannels,
        reason: 'Critical alert - routing to all channels',
      };
    }

    // High priority goes to first 2 channels (or all if fewer)
    if (alert.priority === 'high') {
      return {
        shouldRoute: true,
        channelIds: enabledChannels.slice(0, 2),
        reason: 'High priority - routing to primary channels',
      };
    }

    // Normal/Low priority goes to first channel only
    return {
      shouldRoute: true,
      channelIds: [enabledChannels[0]],
      reason: 'Normal/Low priority - routing to primary channel',
    };
  }

  /**
   * Get routing statistics
   */
  getStats() {
    const channelStats: Record<string, any> = {};

    for (const [id, channel] of this.channels.entries()) {
      channelStats[id] = {
        type: channel.type,
        name: channel.name,
        enabled: channel.enabled,
        ruleCount: channel.routingRules.length,
      };
    }

    return {
      totalChannels: this.channels.size,
      enabledChannels: Array.from(this.channels.values()).filter(c => c.enabled).length,
      channelStats,
    };
  }

  /**
   * Update channel configuration
   */
  updateChannel(channelId: string, updates: Partial<ChannelConfig>): boolean {
    const channel = this.channels.get(channelId);
    if (!channel) return false;

    Object.assign(channel, updates);
    logger.info('AlertRouter', `Updated channel ${channelId}: ${channel.name}`);
    return true;
  }

  /**
   * Clear all channels
   */
  clear(): void {
    this.channels.clear();
    logger.info('AlertRouter', 'All channels cleared');
  }
}
