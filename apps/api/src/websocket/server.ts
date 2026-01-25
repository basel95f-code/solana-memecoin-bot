/**
 * WebSocket server for real-time updates
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HTTPServer } from 'http';
import { validateAPIKey } from '../auth/keyManager.js';
import { logger } from '../utils/logger.js';
import type { WebSocketMessage } from '../types/index.js';

interface AuthenticatedWebSocket extends WebSocket {
  isAuthenticated?: boolean;
  apiKeyId?: string;
  subscriptions?: Set<string>;
}

export class RealtimeWebSocketServer {
  private wss: WebSocketServer;
  private clients: Map<string, Set<AuthenticatedWebSocket>> = new Map();
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(server: HTTPServer) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws'
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    this.startHeartbeat();

    logger.info('WebSocket server initialized on /ws');
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: AuthenticatedWebSocket, req: any): void {
    logger.info('New WebSocket connection attempt');

    ws.isAuthenticated = false;
    ws.subscriptions = new Set();

    // Send initial message
    this.sendMessage(ws, {
      type: 'heartbeat',
      data: { message: 'Connected. Please authenticate.' },
      timestamp: new Date().toISOString()
    });

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        await this.handleMessage(ws, message);
      } catch (error) {
        logger.error('WebSocket message error:', error);
        this.sendMessage(ws, {
          type: 'error',
          data: { message: 'Invalid message format' },
          timestamp: new Date().toISOString()
        });
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(ws);
    });

    ws.on('error', (error) => {
      logger.error('WebSocket error:', error);
    });

    // Pong responses for heartbeat
    ws.on('pong', () => {
      // Client is alive
    });
  }

  /**
   * Handle incoming messages
   */
  private async handleMessage(ws: AuthenticatedWebSocket, message: any): Promise<void> {
    const { type, data } = message;

    switch (type) {
      case 'auth':
        await this.handleAuth(ws, data.apiKey);
        break;

      case 'subscribe':
        this.handleSubscribe(ws, data.channels);
        break;

      case 'unsubscribe':
        this.handleUnsubscribe(ws, data.channels);
        break;

      case 'ping':
        this.sendMessage(ws, {
          type: 'heartbeat',
          data: { pong: true },
          timestamp: new Date().toISOString()
        });
        break;

      default:
        this.sendMessage(ws, {
          type: 'error',
          data: { message: 'Unknown message type' },
          timestamp: new Date().toISOString()
        });
    }
  }

  /**
   * Handle authentication
   */
  private async handleAuth(ws: AuthenticatedWebSocket, apiKey: string): Promise<void> {
    if (!apiKey) {
      this.sendMessage(ws, {
        type: 'error',
        data: { message: 'API key required' },
        timestamp: new Date().toISOString()
      });
      ws.close();
      return;
    }

    const validKey = await validateAPIKey(apiKey);

    if (!validKey) {
      this.sendMessage(ws, {
        type: 'error',
        data: { message: 'Invalid API key' },
        timestamp: new Date().toISOString()
      });
      ws.close();
      return;
    }

    ws.isAuthenticated = true;
    ws.apiKeyId = validKey.id;

    // Add to clients map
    if (!this.clients.has(validKey.id)) {
      this.clients.set(validKey.id, new Set());
    }
    this.clients.get(validKey.id)!.add(ws);

    this.sendMessage(ws, {
      type: 'heartbeat',
      data: { message: 'Authenticated successfully', authenticated: true },
      timestamp: new Date().toISOString()
    });

    logger.info(`WebSocket authenticated: ${validKey.name}`);
  }

  /**
   * Handle channel subscriptions
   */
  private handleSubscribe(ws: AuthenticatedWebSocket, channels: string[]): void {
    if (!ws.isAuthenticated) {
      this.sendMessage(ws, {
        type: 'error',
        data: { message: 'Authentication required' },
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (!Array.isArray(channels)) {
      channels = [channels];
    }

    channels.forEach(channel => ws.subscriptions!.add(channel));

    this.sendMessage(ws, {
      type: 'heartbeat',
      data: { 
        message: 'Subscribed to channels',
        channels: Array.from(ws.subscriptions!)
      },
      timestamp: new Date().toISOString()
    });

    logger.info(`Client subscribed to channels: ${channels.join(', ')}`);
  }

  /**
   * Handle unsubscribe
   */
  private handleUnsubscribe(ws: AuthenticatedWebSocket, channels: string[]): void {
    if (!ws.isAuthenticated || !ws.subscriptions) return;

    if (!Array.isArray(channels)) {
      channels = [channels];
    }

    channels.forEach(channel => ws.subscriptions!.delete(channel));

    this.sendMessage(ws, {
      type: 'heartbeat',
      data: { 
        message: 'Unsubscribed from channels',
        channels: Array.from(ws.subscriptions!)
      },
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle disconnect
   */
  private handleDisconnect(ws: AuthenticatedWebSocket): void {
    if (ws.apiKeyId) {
      const keyClients = this.clients.get(ws.apiKeyId);
      if (keyClients) {
        keyClients.delete(ws);
        if (keyClients.size === 0) {
          this.clients.delete(ws.apiKeyId);
        }
      }
    }

    logger.info('WebSocket disconnected');
  }

  /**
   * Send message to a specific client
   */
  private sendMessage(ws: WebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast to all authenticated clients
   */
  public broadcast(message: WebSocketMessage, channel?: string): void {
    this.clients.forEach(clientSet => {
      clientSet.forEach(client => {
        if (!client.isAuthenticated) return;

        // If channel specified, only send to subscribed clients
        if (channel && !client.subscriptions?.has(channel)) return;

        this.sendMessage(client, message);
      });
    });
  }

  /**
   * Broadcast token update
   */
  public broadcastTokenUpdate(data: any): void {
    this.broadcast({
      type: 'token_update',
      data,
      timestamp: new Date().toISOString()
    }, 'tokens');
  }

  /**
   * Broadcast pattern detection
   */
  public broadcastPattern(data: any): void {
    this.broadcast({
      type: 'pattern_detected',
      data,
      timestamp: new Date().toISOString()
    }, 'patterns');
  }

  /**
   * Broadcast alert
   */
  public broadcastAlert(data: any): void {
    this.broadcast({
      type: 'alert',
      data,
      timestamp: new Date().toISOString()
    }, 'alerts');
  }

  /**
   * Start heartbeat to keep connections alive
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws: any) => {
        if (ws.isAlive === false) {
          return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30 seconds
  }

  /**
   * Cleanup
   */
  public close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.wss.close();
    logger.info('WebSocket server closed');
  }
}
