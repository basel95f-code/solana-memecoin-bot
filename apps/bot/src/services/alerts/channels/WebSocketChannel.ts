/**
 * WebSocket Alert Channel
 * Broadcasts alerts to connected frontend clients via WebSocket
 */

import WebSocket from 'ws';
const WebSocketServer = WebSocket.Server;
import { logger } from '../../../utils/logger';
import { BaseChannel } from './BaseChannel';
import type { Alert, AlertBatch, DeliveryResult, ChannelType } from '../types';

export interface WebSocketConfig {
  port?: number;
  path?: string;
  server?: any; // HTTP server to attach to
}

interface WebSocketMessage {
  type: 'alert' | 'batch' | 'ping' | 'pong';
  data: any;
  timestamp: number;
}

export class WebSocketChannel extends BaseChannel {
  private wss: InstanceType<typeof WebSocketServer> | null = null;
  private config: WebSocketConfig;
  private clients: Set<WebSocket> = new Set();
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(id: string, name: string, config: WebSocketConfig) {
    super(id, 'custom_webhook' as ChannelType, name);
    this.config = config;
  }

  /**
   * Initialize WebSocket server
   */
  async initialize(): Promise<void> {
    try {
      // Create WebSocket server
      const wsOptions: any = {
        path: this.config.path || '/alerts',
      };

      if (this.config.server) {
        wsOptions.server = this.config.server;
      } else if (this.config.port) {
        wsOptions.port = this.config.port;
      } else {
        wsOptions.port = 8080; // Default port
      }

      this.wss = new WebSocketServer(wsOptions);

      this.wss.on('connection', (ws: WebSocket) => {
        this.handleConnection(ws);
      });

      this.wss.on('error', (error: Error) => {
        logger.error('WebSocketChannel', 'WebSocket server error:', error);
      });

      // Start ping interval to keep connections alive
      this.startPingInterval();

      const location = this.config.server 
        ? `path: ${wsOptions.path}`
        : `port: ${wsOptions.port}`;

      logger.info('WebSocketChannel', `WebSocket server initialized (${location})`);
    } catch (error: any) {
      logger.error('WebSocketChannel', 'Failed to initialize WebSocket server:', error);
      throw error;
    }
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket): void {
    this.clients.add(ws);
    logger.info('WebSocketChannel', `Client connected (total: ${this.clients.size})`);

    // Send welcome message
    this.sendToClient(ws, {
      type: 'ping',
      data: { message: 'Connected to Solana Alert Bot' },
      timestamp: Date.now(),
    });

    // Handle messages from client
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(ws, message);
      } catch (error) {
        logger.warn('WebSocketChannel', 'Invalid message from client:', error);
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      this.clients.delete(ws);
      logger.info('WebSocketChannel', `Client disconnected (total: ${this.clients.size})`);
    });

    // Handle errors
    ws.on('error', (error: Error) => {
      logger.error('WebSocketChannel', 'Client connection error:', error);
      this.clients.delete(ws);
    });
  }

  /**
   * Handle message from client
   */
  private handleClientMessage(ws: WebSocket, message: any): void {
    if (message.type === 'ping') {
      this.sendToClient(ws, {
        type: 'pong',
        data: {},
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Send message to specific client
   */
  private sendToClient(ws: WebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        logger.error('WebSocketChannel', 'Failed to send to client:', error);
      }
    }
  }

  /**
   * Broadcast message to all clients
   */
  private broadcast(message: WebSocketMessage): void {
    let sent = 0;
    let failed = 0;

    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(message));
          sent++;
        } catch (error) {
          logger.error('WebSocketChannel', 'Failed to broadcast to client:', error);
          failed++;
        }
      } else {
        // Remove dead connections
        this.clients.delete(ws);
      }
    });

    logger.debug('WebSocketChannel', `Broadcast sent to ${sent} clients (${failed} failed)`);
  }

  /**
   * Send alert to WebSocket clients
   */
  async send(alert: Alert): Promise<DeliveryResult> {
    try {
      if (this.clients.size === 0) {
        logger.debug('WebSocketChannel', `No clients connected, skipping alert ${alert.id}`);
        return this.createSuccessResult(alert.id); // Not an error, just no clients
      }

      const message: WebSocketMessage = {
        type: 'alert',
        data: this.formatAlert(alert),
        timestamp: Date.now(),
      };

      this.broadcast(message);

      logger.info('WebSocketChannel', `Broadcast alert ${alert.id} to ${this.clients.size} clients`);
      
      return this.createSuccessResult(alert.id);
    } catch (error: any) {
      logger.error('WebSocketChannel', `Failed to send alert ${alert.id}:`, error);
      return this.createFailureResult(error.message, alert.id);
    }
  }

  /**
   * Send batch to WebSocket clients
   */
  async sendBatch(batch: AlertBatch): Promise<DeliveryResult> {
    try {
      if (this.clients.size === 0) {
        logger.debug('WebSocketChannel', `No clients connected, skipping batch ${batch.id}`);
        return this.createSuccessResult(batch.id);
      }

      const message: WebSocketMessage = {
        type: 'batch',
        data: this.formatBatch(batch),
        timestamp: Date.now(),
      };

      this.broadcast(message);

      logger.info('WebSocketChannel', `Broadcast batch ${batch.id} to ${this.clients.size} clients`);
      
      return this.createSuccessResult(batch.id);
    } catch (error: any) {
      logger.error('WebSocketChannel', `Failed to send batch ${batch.id}:`, error);
      return this.createFailureResult(error.message, batch.id);
    }
  }

  /**
   * Format alert for WebSocket
   */
  private formatAlert(alert: Alert): any {
    return {
      id: alert.id,
      type: alert.type,
      priority: alert.priority,
      title: alert.title,
      message: alert.message,
      data: alert.data,
      timestamp: alert.timestamp,
      userId: alert.userId,
      chatId: alert.chatId,
    };
  }

  /**
   * Format batch for WebSocket
   */
  private formatBatch(batch: AlertBatch): any {
    return {
      id: batch.id,
      type: batch.type,
      priority: batch.priority,
      summary: batch.summary,
      alertCount: batch.alerts.length,
      alerts: batch.alerts.map(a => this.formatAlert(a)),
      timestamp: batch.timestamp,
    };
  }

  /**
   * Start ping interval to keep connections alive
   */
  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      const message: WebSocketMessage = {
        type: 'ping',
        data: {},
        timestamp: Date.now(),
      };

      this.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify(message));
          } catch (error) {
            // Remove dead connection
            this.clients.delete(ws);
          }
        } else {
          this.clients.delete(ws);
        }
      });
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      return this.wss !== null && this.wss.address() !== null;
    } catch (error) {
      logger.error('WebSocketChannel', 'Health check failed:', error);
      return false;
    }
  }

  /**
   * Shutdown WebSocket server
   */
  async shutdown(): Promise<void> {
    logger.info('WebSocketChannel', 'Shutting down WebSocket server...');

    this.stopPingInterval();

    // Close all client connections
    this.clients.forEach(ws => {
      try {
        ws.close(1000, 'Server shutting down');
      } catch (error) {
        logger.error('WebSocketChannel', 'Error closing client connection:', error);
      }
    });

    this.clients.clear();

    // Close server
    if (this.wss) {
      return new Promise((resolve) => {
        this.wss!.close(() => {
          logger.info('WebSocketChannel', 'WebSocket server closed');
          this.wss = null;
          resolve();
        });
      });
    }
  }
}
