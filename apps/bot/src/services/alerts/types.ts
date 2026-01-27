/**
 * Advanced Multi-Channel Alert System - Type Definitions
 * Phase 30: Production-grade alert system with deduplication, batching, routing
 */

// ============================================
// Core Alert Types
// ============================================

export enum AlertPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum AlertType {
  NEW_TOKEN = 'new_token',
  VOLUME_SPIKE = 'volume_spike',
  WHALE_MOVEMENT = 'whale_movement',
  LIQUIDITY_DRAIN = 'liquidity_drain',
  AUTHORITY_CHANGE = 'authority_change',
  PRICE_ALERT = 'price_alert',
  SMART_MONEY = 'smart_money',
  WALLET_ACTIVITY = 'wallet_activity',
  TRADING_SIGNAL = 'trading_signal',
  RUG_DETECTED = 'rug_detected',
  SYSTEM = 'system',
}

export enum ChannelType {
  TELEGRAM = 'telegram',
  DISCORD = 'discord',
  SLACK = 'slack',
  CUSTOM_WEBHOOK = 'custom_webhook',
}

export enum DeliveryStatus {
  PENDING = 'pending',
  SENDING = 'sending',
  SENT = 'sent',
  FAILED = 'failed',
  RETRYING = 'retrying',
  CANCELLED = 'cancelled',
}

// ============================================
// Alert Interfaces
// ============================================

export interface Alert {
  id: string;
  type: AlertType;
  priority: AlertPriority;
  title: string;
  message: string;
  data: Record<string, any>;
  dedupKey?: string; // Optional: for custom deduplication
  timestamp: number;
  userId?: string;
  chatId?: string;
}

export interface AlertBatch {
  id: string;
  type: AlertType;
  priority: AlertPriority;
  alerts: Alert[];
  summary: string;
  timestamp: number;
}

// ============================================
// Channel Configuration
// ============================================

export interface ChannelConfig {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  config: TelegramConfig | DiscordConfig | SlackConfig | WebhookConfig;
  routingRules: RoutingRule[];
  rateLimitConfig: RateLimitConfig;
  userId?: string;
  createdAt: number;
}

export interface TelegramConfig {
  chatId: string;
  threadId?: string;
}

export interface DiscordConfig {
  webhookUrl: string;
  username?: string;
  avatarUrl?: string;
}

export interface SlackConfig {
  webhookUrl: string;
  channel?: string;
}

export interface WebhookConfig {
  url: string;
  method: 'POST' | 'PUT';
  headers?: Record<string, string>;
  template?: string; // Optional: custom payload template
}

// ============================================
// Routing Rules
// ============================================

export interface RoutingRule {
  field: 'type' | 'priority' | 'data';
  operator: 'equals' | 'not_equals' | 'contains' | 'gte' | 'lte' | 'in';
  value: any;
}

export interface RoutingResult {
  shouldRoute: boolean;
  channelIds: string[];
  reason?: string;
}

// ============================================
// Delivery Tracking
// ============================================

export interface DeliveryRecord {
  id: string;
  alertId: string;
  channelId: string;
  status: DeliveryStatus;
  retryCount: number;
  lastError?: string;
  sentAt?: number;
  deliveredAt?: number;
  nextRetryAt?: number;
}

export interface DeliveryResult {
  deliveryId: string;
  channelId: string;
  channelType: ChannelType;
  success: boolean;
  error?: string;
  retryCount: number;
  timestamp: number;
}

// ============================================
// Deduplication
// ============================================

export interface DedupConfig {
  enabled: boolean;
  windowMs: number; // Time window for deduplication
  algorithm: 'hash' | 'fuzzy' | 'exact';
}

export interface DedupResult {
  isDuplicate: boolean;
  originalAlertId?: string;
  similarity?: number;
  reason?: string;
}

// ============================================
// Batching
// ============================================

export interface BatchConfig {
  enabled: boolean;
  windowMs: number; // Time window to collect alerts
  maxSize: number; // Max alerts per batch
  minSize: number; // Min alerts to trigger batch
  types: AlertType[]; // Which alert types to batch
}

// ============================================
// Rate Limiting
// ============================================

export interface RateLimitConfig {
  enabled: boolean;
  maxPerMinute: number;
  maxPerHour: number;
  burstSize: number; // Allow short bursts
}

export interface RateLimitState {
  tokens: number;
  lastRefill: number;
  minuteCount: number;
  hourCount: number;
  minuteReset: number;
  hourReset: number;
}

// ============================================
// Alert History
// ============================================

export interface AlertHistoryRecord {
  id: string;
  alertId: string;
  type: AlertType;
  priority: AlertPriority;
  content: string;
  dedupHash?: string;
  isBatched: boolean;
  batchId?: string;
  deliveries: DeliveryRecord[];
  createdAt: number;
}

// ============================================
// Manager Configuration
// ============================================

export interface AlertManagerConfig extends Record<string, unknown> {
  dedup: DedupConfig;
  batch: BatchConfig;
  retryConfig: RetryConfig;
  defaultChannels?: string[];
}

export interface RetryConfig extends Record<string, unknown> {
  enabled: boolean;
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

// ============================================
// Channel Interface (Abstract)
// ============================================

export interface IAlertChannel {
  id: string;
  type: ChannelType;
  name: string;
  send(alert: Alert): Promise<DeliveryResult>;
  sendBatch(batch: AlertBatch): Promise<DeliveryResult>;
  healthCheck(): Promise<boolean>;
}

// ============================================
// Event Types
// ============================================

export interface AlertEvent {
  type: 'sent' | 'failed' | 'retrying' | 'deduplicated' | 'batched';
  alertId: string;
  channelId?: string;
  timestamp: number;
  data?: any;
}

// ============================================
// Statistics
// ============================================

export interface AlertStats {
  totalAlerts: number;
  deduplicated: number;
  batched: number;
  sent: number;
  failed: number;
  pending: number;
  byType: Record<AlertType, number>;
  byPriority: Record<AlertPriority, number>;
  byChannel: Record<string, ChannelStats>;
}

export interface ChannelStats {
  channelId: string;
  sent: number;
  failed: number;
  avgDeliveryTimeMs: number;
  lastSentAt?: number;
}
