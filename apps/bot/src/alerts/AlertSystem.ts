/**
 * Integrated Alert System
 * Combines RuleEngine + Dispatcher + Multi-Channel Delivery
 */

import { EventEmitter } from 'events';
import { Telegraf } from 'telegraf';
import { logger } from '../utils/logger';
import { RuleEngine } from './RuleEngine';
import { Dispatcher } from './Dispatcher';
import { AlertManager } from '../services/alerts/AlertManager';
import { TelegramChannel } from '../services/alerts/channels/TelegramChannel';
import { DiscordChannel } from '../services/alerts/channels/DiscordChannel';
import { EmailChannel, type EmailConfig } from '../services/alerts/channels/EmailChannel';
import { WebSocketChannel } from '../services/alerts/channels/WebSocketChannel';
import type { 
  AlertRule, 
  EvaluationContext, 
  EvaluationResult 
} from './RuleEngine';
import type { 
  ChannelConfig, 
  DiscordConfig,
  TelegramConfig,
  WebhookConfig 
} from '../services/alerts/types';
import { AlertType, ChannelType } from '../services/alerts/types';

export interface AlertSystemConfig {
  // Deduplication
  enableDeduplication?: boolean;
  dedupWindowMs?: number;
  
  // Batching
  enableBatching?: boolean;
  batchWindowMs?: number;
  
  // Retry
  maxRetries?: number;
  initialRetryDelayMs?: number;
  
  // Channels
  telegram?: {
    bot: Telegraf;
    defaultChatId?: string;
  };
  discord?: {
    webhookUrl?: string;
    username?: string;
  };
  email?: EmailConfig;
  websocket?: WebSocketConfig;
}

export class AlertSystem extends EventEmitter {
  private ruleEngine: RuleEngine;
  private dispatcher: Dispatcher;
  private alertManager: AlertManager;
  private initialized = false;

  constructor(private config: AlertSystemConfig = {}) {
    super();

    // Initialize AlertManager
    this.alertManager = new AlertManager({
      dedup: {
        enabled: config.enableDeduplication ?? true,
        windowMs: config.dedupWindowMs ?? 5 * 60 * 1000,
        algorithm: 'hash',
      },
      batch: {
        enabled: config.enableBatching ?? true,
        windowMs: config.batchWindowMs ?? 30 * 1000,
        maxSize: 10,
        minSize: 2,
        types: [AlertType.NEW_TOKEN, AlertType.VOLUME_SPIKE, AlertType.PRICE_ALERT, AlertType.WALLET_ACTIVITY],
      },
      retryConfig: {
        enabled: true,
        maxRetries: config.maxRetries ?? 3,
        initialDelayMs: config.initialRetryDelayMs ?? 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      },
    });

    // Initialize RuleEngine
    this.ruleEngine = new RuleEngine();

    // Initialize Dispatcher
    this.dispatcher = new Dispatcher(this.alertManager, {
      enableDeduplication: config.enableDeduplication,
      enableBatching: config.enableBatching,
      dedupWindowMs: config.dedupWindowMs,
      batchWindowMs: config.batchWindowMs,
    });

    // Forward events
    this.alertManager.on('alert_event', (event) => {
      this.emit('alert_event', event);
    });

    logger.info('AlertSystem', 'Initialized alert system');
  }

  /**
   * Initialize channels
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('AlertSystem', 'Already initialized');
      return;
    }

    // Initialize Telegram channel if configured
    if (this.config.telegram?.bot) {
      await this.setupTelegramChannel(this.config.telegram.bot, this.config.telegram.defaultChatId);
    }

    // Initialize Discord channel if configured
    if (this.config.discord?.webhookUrl) {
      await this.setupDiscordChannel(this.config.discord);
    }

    // Initialize Email channel if configured
    if (this.config.email) {
      await this.setupEmailChannel(this.config.email);
    }

    // Initialize WebSocket channel if configured
    if (this.config.websocket) {
      await this.setupWebSocketChannel(this.config.websocket);
    }

    this.initialized = true;
    logger.info('AlertSystem', `Initialized with ${this.alertManager.getAllChannels().length} channels`);
  }

  /**
   * Setup Telegram channel
   */
  private async setupTelegramChannel(bot: Telegraf, defaultChatId?: string): Promise<void> {
    try {
      const config: TelegramConfig = {
        chatId: defaultChatId || '',
      };

      const channel = new TelegramChannel('telegram-default', 'Telegram', config, bot);
      
      const channelConfig: ChannelConfig = {
        id: 'telegram-default',
        type: ChannelType.TELEGRAM,
        name: 'Telegram',
        enabled: true,
        config,
        routingRules: [],
        rateLimitConfig: {
          enabled: true,
          maxPerMinute: 20,
          maxPerHour: 100,
          burstSize: 5,
        },
        createdAt: Date.now(),
      };

      this.alertManager.registerChannel(channel, channelConfig);
      logger.info('AlertSystem', 'Telegram channel registered');
    } catch (error) {
      logger.error('AlertSystem', 'Failed to setup Telegram channel:', error);
    }
  }

  /**
   * Setup Discord channel
   */
  private async setupDiscordChannel(config: DiscordConfig & { webhookUrl: string }): Promise<void> {
    try {
      const channel = new DiscordChannel('discord-default', 'Discord', config);
      
      const channelConfig: ChannelConfig = {
        id: 'discord-default',
        type: ChannelType.DISCORD,
        name: 'Discord',
        enabled: true,
        config,
        routingRules: [],
        rateLimitConfig: {
          enabled: true,
          maxPerMinute: 5,
          maxPerHour: 30,
          burstSize: 2,
        },
        createdAt: Date.now(),
      };

      this.alertManager.registerChannel(channel, channelConfig);
      logger.info('AlertSystem', 'Discord channel registered');
    } catch (error) {
      logger.error('AlertSystem', 'Failed to setup Discord channel:', error);
    }
  }

  /**
   * Setup Email channel
   */
  private async setupEmailChannel(config: EmailConfig): Promise<void> {
    try {
      const channel = new EmailChannel('email-default', 'Email', config);
      
      const channelConfig: ChannelConfig = {
        id: 'email-default',
        type: ChannelType.CUSTOM_WEBHOOK,
        name: 'Email',
        enabled: true,
        config: {} as any,
        routingRules: [],
        rateLimitConfig: {
          enabled: true,
          maxPerMinute: 2,
          maxPerHour: 10,
          burstSize: 1,
        },
        createdAt: Date.now(),
      };

      this.alertManager.registerChannel(channel, channelConfig);
      logger.info('AlertSystem', 'Email channel registered');
    } catch (error) {
      logger.error('AlertSystem', 'Failed to setup Email channel:', error);
    }
  }

  /**
   * Setup WebSocket channel
   */
  private async setupWebSocketChannel(config: WebSocketConfig): Promise<void> {
    try {
      const channel = new WebSocketChannel('websocket-default', 'WebSocket', config);
      await channel.initialize();
      
      const channelConfig: ChannelConfig = {
        id: 'websocket-default',
        type: ChannelType.CUSTOM_WEBHOOK,
        name: 'WebSocket',
        enabled: true,
        config: {} as any,
        routingRules: [],
        rateLimitConfig: {
          enabled: false,
          maxPerMinute: 0,
          maxPerHour: 0,
          burstSize: 0,
        },
        createdAt: Date.now(),
      };

      this.alertManager.registerChannel(channel, channelConfig);
      logger.info('AlertSystem', 'WebSocket channel registered');
    } catch (error) {
      logger.error('AlertSystem', 'Failed to setup WebSocket channel:', error);
    }
  }

  /**
   * Evaluate token data against all rules
   */
  async evaluateToken(context: EvaluationContext): Promise<EvaluationResult[]> {
    const results = await this.ruleEngine.evaluate(context);

    // Dispatch triggered rules
    for (const result of results) {
      if (result.matched) {
        const rule = this.ruleEngine.getRule(result.ruleId);
        if (rule) {
          await this.dispatcher.dispatch(rule, result, context as any);
        }
      }
    }

    return results;
  }

  /**
   * Create a new alert rule
   */
  createRule(rule: Omit<AlertRule, 'id' | 'createdAt' | 'triggerCount'>): AlertRule {
    return this.ruleEngine.createRule(rule);
  }

  /**
   * Update an existing rule
   */
  updateRule(id: string, updates: Partial<AlertRule>): AlertRule | null {
    return this.ruleEngine.updateRule(id, updates as any);
  }

  /**
   * Delete a rule
   */
  deleteRule(id: string): boolean {
    return this.ruleEngine.deleteRule(id);
  }

  /**
   * Get a rule by ID
   */
  getRule(id: string): AlertRule | null {
    return this.ruleEngine.getRule(id);
  }

  /**
   * List all rules
   */
  listRules(filter?: { userId?: string; enabled?: boolean; tags?: string[] }): AlertRule[] {
    return this.ruleEngine.listRules(filter);
  }

  /**
   * Toggle a rule on/off
   */
  toggleRule(id: string): AlertRule | null {
    return this.ruleEngine.toggleRule(id);
  }

  /**
   * Test a rule's delivery
   */
  async testRule(ruleId: string, context?: Record<string, any>): Promise<any> {
    const rule = this.ruleEngine.getRule(ruleId);
    if (!rule) {
      throw new Error(`Rule ${ruleId} not found`);
    }

    return await this.dispatcher.testDelivery(rule, context);
  }

  /**
   * Get system statistics
   */
  getStats(): any {
    return {
      rules: {
        total: this.ruleEngine.listRules().length,
        enabled: this.ruleEngine.listRules({ enabled: true }).length,
        disabled: this.ruleEngine.listRules({ enabled: false }).length,
      },
      dispatcher: this.dispatcher.getStats(),
      alerts: this.alertManager.getStats(),
      channels: this.alertManager.getAllChannels().map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
      })),
    };
  }

  /**
   * Export rules to JSON
   */
  exportRules(): AlertRule[] {
    return this.ruleEngine.exportRules();
  }

  /**
   * Import rules from JSON
   */
  importRules(rules: AlertRule[]): void {
    this.ruleEngine.importRules(rules);
  }

  /**
   * Shutdown the system
   */
  async shutdown(): Promise<void> {
    logger.info('AlertSystem', 'Shutting down alert system...');
    
    // Flush pending batches
    this.alertManager.flushBatches();
    
    // Stop alert manager
    this.alertManager.stop();
    
    // Shutdown WebSocket channels
    const channels = this.alertManager.getAllChannels();
    for (const channel of channels) {
      if (channel instanceof WebSocketChannel) {
        await channel.shutdown();
      }
    }
    
    logger.info('AlertSystem', 'Alert system shut down');
  }
}

// Singleton instance
let alertSystemInstance: AlertSystem | null = null;

/**
 * Get or create alert system instance
 */
export function getAlertSystem(config?: AlertSystemConfig): AlertSystem {
  if (!alertSystemInstance) {
    alertSystemInstance = new AlertSystem(config);
  }
  return alertSystemInstance;
}

/**
 * Initialize alert system
 */
export async function initializeAlertSystem(config?: AlertSystemConfig): Promise<AlertSystem> {
  const system = getAlertSystem(config);
  await system.initialize();
  return system;
}
