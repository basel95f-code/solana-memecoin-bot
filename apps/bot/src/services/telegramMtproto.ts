/**
 * Telegram MTProto client for reading public groups/channels
 * Uses gramjs library with API ID/Hash from my.telegram.org
 */

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { config } from '../config';
import { TELEGRAM_SENTIMENT } from '../constants';
import { RateLimiter, CircuitBreaker } from '../utils/retry';
import { logger } from '../utils/logger';

interface CachedMessages {
  messages: string[];
  fetchedAt: number;
}

interface ChannelInfo {
  id: string;
  title: string;
  username?: string;
  participantsCount?: number;
}

class TelegramMtprotoService {
  private client: TelegramClient | null = null;
  private isConnected: boolean = false;
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private messageCache: Map<string, CachedMessages> = new Map();
  private reconnectAttempts: number = 0;

  constructor() {
    // Rate limiter: 20 requests per minute
    this.rateLimiter = new RateLimiter(
      TELEGRAM_SENTIMENT.RATE_LIMIT_REQUESTS,
      TELEGRAM_SENTIMENT.RATE_LIMIT_REQUESTS / 60, // tokens per second
      1000
    );

    // Circuit breaker: 5 failures opens, 5 min reset
    this.circuitBreaker = new CircuitBreaker(
      TELEGRAM_SENTIMENT.CIRCUIT_BREAKER_THRESHOLD,
      TELEGRAM_SENTIMENT.CIRCUIT_BREAKER_RESET_MS
    );
  }

  async initialize(): Promise<void> {
    if (!config.telegramMtproto.enabled) {
      logger.info('TelegramMtproto', 'Service disabled');
      return;
    }

    if (!config.telegramMtproto.apiId || !config.telegramMtproto.apiHash) {
      logger.warn('TelegramMtproto', 'Missing API credentials, service disabled');
      return;
    }

    try {
      const session = new StringSession(config.telegramMtproto.sessionString || '');

      this.client = new TelegramClient(
        session,
        config.telegramMtproto.apiId,
        config.telegramMtproto.apiHash,
        {
          connectionRetries: TELEGRAM_SENTIMENT.MAX_RECONNECT_ATTEMPTS,
          useWSS: true,
        }
      );

      await this.connect();
    } catch (error) {
      logger.error('TelegramMtproto', `Initialization failed: ${error}`);
    }
  }

  private async connect(): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.connect();
      this.isConnected = true;
      this.reconnectAttempts = 0;
      logger.info('TelegramMtproto', 'Connected');

      // Get session string for saving (for subsequent runs)
      const sessionString = this.client.session.save() as unknown as string;
      if (sessionString && !config.telegramMtproto.sessionString) {
        logger.info('TelegramMtproto', `Save this session string to TELEGRAM_SESSION env var: ${sessionString}`);
      }
    } catch (error) {
      logger.error('TelegramMtproto', `Connection failed: ${error}`);
      this.isConnected = false;
      await this.scheduleReconnect();
    }
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= TELEGRAM_SENTIMENT.MAX_RECONNECT_ATTEMPTS) {
      logger.error('TelegramMtproto', 'Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = TELEGRAM_SENTIMENT.RECONNECT_DELAY_MS * this.reconnectAttempts;
    logger.info('TelegramMtproto', `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(err => {
        logger.error('TelegramMtproto', `Reconnect failed: ${err}`);
      });
    }, delay);
  }

  async stop(): Promise<void> {
    if (this.client && this.isConnected) {
      await this.client.disconnect();
      this.isConnected = false;
      logger.info('TelegramMtproto', 'Disconnected');
    }
  }

  isReady(): boolean {
    return this.isConnected && this.client !== null && !this.circuitBreaker.isOpen();
  }

  /**
   * Get messages from a public channel or group
   */
  async getChannelMessages(channelUsername: string): Promise<string[]> {
    if (!this.isReady()) {
      // Try to return cached messages if available
      return this.getCachedMessages(channelUsername);
    }

    // Check cache first
    const cached = this.messageCache.get(channelUsername);
    if (cached && Date.now() - cached.fetchedAt < TELEGRAM_SENTIMENT.CACHE_TTL_MS) {
      return cached.messages;
    }

    try {
      await this.rateLimiter.acquire();

      const messages = await this.circuitBreaker.execute(async () => {
        return this.fetchMessages(channelUsername);
      });

      // Cache the messages
      this.messageCache.set(channelUsername, {
        messages,
        fetchedAt: Date.now(),
      });

      return messages;
    } catch (error: any) {
      // Handle flood wait errors
      if (error.message?.includes('FLOOD_WAIT')) {
        const waitSeconds = parseInt(error.message.match(/\d+/)?.[0] || '60', 10);
        logger.warn('TelegramMtproto', `Flood wait: ${waitSeconds}s`);
        // Return stale cache if available
        return this.getCachedMessages(channelUsername);
      }

      logger.error('TelegramMtproto', `Failed to get messages from ${channelUsername}: ${error}`);
      return this.getCachedMessages(channelUsername);
    }
  }

  private async fetchMessages(channelUsername: string): Promise<string[]> {
    if (!this.client) return [];

    const messages: string[] = [];
    const cutoffTime = Date.now() - TELEGRAM_SENTIMENT.MESSAGE_AGE_LIMIT_MS;

    try {
      // Resolve the channel entity
      const entity = await this.client.getEntity(channelUsername);

      // Get messages
      const result = await this.client.getMessages(entity, {
        limit: TELEGRAM_SENTIMENT.MAX_MESSAGES,
      });

      for (const msg of result) {
        // Skip old messages
        if (msg.date && msg.date * 1000 < cutoffTime) {
          continue;
        }

        // Extract text content
        if (msg.message) {
          messages.push(msg.message);
        }
      }
    } catch (error) {
      logger.error('TelegramMtproto', `Error fetching messages: ${error}`);
      throw error;
    }

    return messages;
  }

  private getCachedMessages(channelUsername: string): string[] {
    const cached = this.messageCache.get(channelUsername);
    if (cached && Date.now() - cached.fetchedAt < TELEGRAM_SENTIMENT.STALE_CACHE_TTL_MS) {
      logger.info('TelegramMtproto', `Using stale cache for ${channelUsername}`);
      return cached.messages;
    }
    return [];
  }

  /**
   * Resolve channel info by username
   */
  async getChannelInfo(channelUsername: string): Promise<ChannelInfo | null> {
    if (!this.isReady()) return null;

    try {
      await this.rateLimiter.acquire();

      const entity = await this.client!.getEntity(channelUsername);

      if (entity instanceof Api.Channel || entity instanceof Api.Chat) {
        return {
          id: entity.id.toString(),
          title: (entity as any).title || channelUsername,
          username: (entity as any).username,
          participantsCount: (entity as any).participantsCount,
        };
      }

      return null;
    } catch (error) {
      logger.error('TelegramMtproto', `Failed to get channel info for ${channelUsername}: ${error}`);
      return null;
    }
  }

  /**
   * Search for messages containing specific keywords
   */
  async searchMessages(channelUsername: string, keywords: string[]): Promise<string[]> {
    const allMessages = await this.getChannelMessages(channelUsername);

    if (keywords.length === 0) {
      return allMessages;
    }

    // Filter messages containing any of the keywords (case-insensitive)
    const lowerKeywords = keywords.map(k => k.toLowerCase());
    return allMessages.filter(msg => {
      const lowerMsg = msg.toLowerCase();
      return lowerKeywords.some(keyword => lowerMsg.includes(keyword));
    });
  }

  getStats(): { isConnected: boolean; circuitState: string; cachedChannels: number } {
    return {
      isConnected: this.isConnected,
      circuitState: this.circuitBreaker.getState(),
      cachedChannels: this.messageCache.size,
    };
  }

  clearCache(): void {
    this.messageCache.clear();
  }
}

export const telegramMtprotoService = new TelegramMtprotoService();
