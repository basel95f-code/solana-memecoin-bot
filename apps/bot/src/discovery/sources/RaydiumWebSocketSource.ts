/**
 * Raydium WebSocket Source
 * Real-time monitoring via WebSocket for instant token discovery
 */

import WebSocket from 'ws';
import { logger } from '../../utils/logger';
import type { IDiscoverySource } from '../interfaces/IDiscoverySource';
import type { DiscoveredToken } from '../interfaces/DiscoveryTypes';

interface RaydiumWSConfig {
  wsUrl: string;
  programId: string;
  reconnectDelayMs: number;
  heartbeatIntervalMs: number;
}

export class RaydiumWebSocketSource implements IDiscoverySource {
  public readonly id: string;
  public readonly name: string;
  public readonly weight: number;

  private config: RaydiumWSConfig;
  private ws: WebSocket | null = null;
  private isRunning: boolean = false;
  private lastSeenTimestamp: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private consecutiveErrors: number = 0;
  private onDiscovery: (token: DiscoveredToken) => void;

  private readonly MAX_ERRORS = 5;

  constructor(
    id: string,
    name: string,
    weight: number,
    config: RaydiumWSConfig,
    onDiscovery: (token: DiscoveredToken) => void
  ) {
    this.id = id;
    this.name = name;
    this.weight = weight;
    this.config = config;
    this.onDiscovery = onDiscovery;
  }

  /**
   * Start WebSocket connection
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    await this.connect();

    logger.info('RaydiumWebSocketSource', `Started WebSocket source: ${this.name}`);
  }

  /**
   * Stop WebSocket connection
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    logger.info('RaydiumWebSocketSource', `Stopped WebSocket source: ${this.name}`);
  }

  /**
   * Manual discover (not applicable for WebSocket)
   */
  async discover(): Promise<DiscoveredToken[]> {
    logger.warn('RaydiumWebSocketSource', 'Manual discover not supported for WebSocket source');
    return [];
  }

  /**
   * Check if source is healthy
   */
  isHealthy(): boolean {
    const now = Date.now();
    const staleness = now - this.lastSeenTimestamp;
    const isStale = staleness > 5 * 60 * 1000; // 5 minutes

    return (
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN &&
      !isStale &&
      this.consecutiveErrors < this.MAX_ERRORS
    );
  }

  /**
   * Get last seen timestamp
   */
  getLastSeenTimestamp(): number {
    return this.lastSeenTimestamp;
  }

  /**
   * Connect to WebSocket
   */
  private async connect(): Promise<void> {
    try {
      logger.debug('RaydiumWebSocketSource', `Connecting to ${this.config.wsUrl}`);

      this.ws = new WebSocket(this.config.wsUrl);

      this.ws.on('open', () => this.onOpen());
      this.ws.on('message', (data: WebSocket.Data) => this.onMessage(data));
      this.ws.on('error', (error: Error) => this.onError(error));
      this.ws.on('close', (code: number, reason: string) => this.onClose(code, reason));

    } catch (error: any) {
      logger.error('RaydiumWebSocketSource', 'Connection error:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket open
   */
  private onOpen(): void {
    logger.info('RaydiumWebSocketSource', 'WebSocket connected');

    this.consecutiveErrors = 0;
    this.lastSeenTimestamp = Date.now();

    // Subscribe to new pool events
    this.subscribe();

    // Start heartbeat
    this.startHeartbeat();

    // Start health check
    this.startHealthCheck();
  }

  /**
   * Handle WebSocket message
   */
  private onMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      // Update last seen
      this.lastSeenTimestamp = Date.now();

      // Parse and emit discovered token
      if (message.method === 'poolCreated' || message.method === 'newPool') {
        const token = this.parsePoolEvent(message.params);
        if (token) {
          this.onDiscovery(token);
          logger.debug('RaydiumWebSocketSource', `Discovered: ${token.symbol}`);
        }
      }

    } catch (error: any) {
      logger.error('RaydiumWebSocketSource', 'Message parse error:', error);
      this.consecutiveErrors++;
    }
  }

  /**
   * Handle WebSocket error
   */
  private onError(error: Error): void {
    logger.error('RaydiumWebSocketSource', 'WebSocket error:', error);
    this.consecutiveErrors++;
  }

  /**
   * Handle WebSocket close
   */
  private onClose(code: number, reason: string): void {
    logger.warn('RaydiumWebSocketSource', `WebSocket closed: ${code} - ${reason}`);

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.isRunning) {
      this.scheduleReconnect();
    }
  }

  /**
   * Subscribe to pool events
   */
  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const subscribeMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        {
          mentions: [this.config.programId],
        },
        {
          commitment: 'confirmed',
        },
      ],
    };

    this.ws.send(JSON.stringify(subscribeMessage));
    logger.debug('RaydiumWebSocketSource', 'Subscribed to pool events');
  }

  /**
   * Parse pool creation event
   */
  private parsePoolEvent(params: any): DiscoveredToken | null {
    try {
      // Extract token info from Raydium pool event
      // This is a simplified version - real implementation would parse the transaction logs
      
      const mint = params.value?.logs?.[0]?.match(/mint: ([A-Za-z0-9]{32,44})/)?.[1];
      if (!mint) return null;

      return {
        mint,
        symbol: 'UNKNOWN', // Would need to fetch from token metadata
        name: 'Unknown Token',
        source: this.id,
        timestamp: Date.now(),
        metadata: {
          programId: this.config.programId,
          raw: params,
        },
      };

    } catch (error) {
      logger.error('RaydiumWebSocketSource', 'Parse error:', error);
      return null;
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, this.config.heartbeatIntervalMs);
  }

  /**
   * Start health check
   */
  private startHealthCheck(): void {
    if (this.healthCheckTimer) return;

    this.healthCheckTimer = setInterval(() => {
      if (!this.isHealthy()) {
        logger.warn('RaydiumWebSocketSource', 'Health check failed, reconnecting');
        this.reconnect();
      }
    }, 60 * 1000); // Check every minute
  }

  /**
   * Schedule reconnection
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    logger.info('RaydiumWebSocketSource', `Reconnecting in ${this.config.reconnectDelayMs}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isRunning) {
        this.reconnect();
      }
    }, this.config.reconnectDelayMs);
  }

  /**
   * Reconnect WebSocket
   */
  private async reconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    await this.connect();
  }
}
