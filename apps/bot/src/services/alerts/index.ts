/**
 * Advanced Multi-Channel Alert System
 * Phase 30: Production-grade alerts with deduplication, batching, and routing
 */

export { AlertManager } from './AlertManager';
export { AlertDeduplicator } from './AlertDeduplicator';
export { AlertBatcher } from './AlertBatcher';
export { AlertRouter } from './AlertRouter';

// Channels
export { BaseChannel } from './channels/BaseChannel';
export { TelegramChannel } from './channels/TelegramChannel';
export { CustomWebhookChannel } from './channels/CustomWebhookChannel';

// Types
export * from './types';
