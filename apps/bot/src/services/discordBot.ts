/**
 * Discord.js client for reading server messages
 * Uses Discord Bot Token for authentication
 */

import { Client, GatewayIntentBits, TextChannel, Collection, Message } from 'discord.js';
import { config } from '../config';
import { DISCORD_SENTIMENT } from '../constants';
import { RateLimiter, CircuitBreaker } from '../utils/retry';
import { logger } from '../utils/logger';

interface CachedMessages {
  messages: string[];
  fetchedAt: number;
}

interface ChannelInfo {
  id: string;
  name: string;
  guildName: string;
  guildId: string;
}

class DiscordBotService {
  private client: Client | null = null;
  private isConnected: boolean = false;
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private messageCache: Map<string, CachedMessages> = new Map();
  private reconnectAttempts: number = 0;

  constructor() {
    // Rate limiter: 5 tokens, refill 1 per 200ms (5 req/sec)
    this.rateLimiter = new RateLimiter(
      DISCORD_SENTIMENT.RATE_LIMIT_TOKENS,
      DISCORD_SENTIMENT.RATE_LIMIT_TOKENS, // tokens per second
      DISCORD_SENTIMENT.RATE_LIMIT_REFILL_MS
    );

    // Circuit breaker: 5 failures opens, 5 min reset
    this.circuitBreaker = new CircuitBreaker(
      DISCORD_SENTIMENT.CIRCUIT_BREAKER_THRESHOLD,
      DISCORD_SENTIMENT.CIRCUIT_BREAKER_RESET_MS
    );
  }

  async initialize(): Promise<void> {
    if (!config.discordBot.enabled) {
      logger.info('DiscordBot', 'Service disabled');
      return;
    }

    if (!config.discordBot.token) {
      logger.warn('DiscordBot', 'Missing bot token, service disabled');
      return;
    }

    try {
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
        ],
      });

      this.setupEventHandlers();
      await this.connect();
    } catch (error) {
      logger.error('DiscordBot', `Initialization failed: ${error}`);
    }
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on('ready', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      logger.info('DiscordBot', `Logged in as ${this.client?.user?.tag}`);
    });

    this.client.on('disconnect', () => {
      this.isConnected = false;
      logger.warn('DiscordBot', 'Disconnected');
      this.scheduleReconnect();
    });

    this.client.on('error', (error) => {
      logger.error('DiscordBot', `Client error: ${error}`);
    });
  }

  private async connect(): Promise<void> {
    if (!this.client || !config.discordBot.token) return;

    try {
      await this.client.login(config.discordBot.token);
    } catch (error) {
      logger.error('DiscordBot', `Login failed: ${error}`);
      this.isConnected = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= DISCORD_SENTIMENT.MAX_RECONNECT_ATTEMPTS) {
      logger.error('DiscordBot', 'Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = DISCORD_SENTIMENT.RECONNECT_DELAY_MS * this.reconnectAttempts;
    logger.info('DiscordBot', `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(err => {
        logger.error('DiscordBot', `Reconnect failed: ${err}`);
      });
    }, delay);
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.isConnected = false;
      logger.info('DiscordBot', 'Disconnected');
    }
  }

  isReady(): boolean {
    return this.isConnected && this.client !== null && !this.circuitBreaker.isOpen();
  }

  /**
   * Get messages from a Discord channel
   */
  async getChannelMessages(channelId: string): Promise<string[]> {
    if (!this.isReady()) {
      return this.getCachedMessages(channelId);
    }

    // Check cache first
    const cached = this.messageCache.get(channelId);
    if (cached && Date.now() - cached.fetchedAt < DISCORD_SENTIMENT.CACHE_TTL_MS) {
      return cached.messages;
    }

    try {
      await this.rateLimiter.acquire();

      const messages = await this.circuitBreaker.execute(async () => {
        return this.fetchMessages(channelId);
      });

      // Cache the messages
      this.messageCache.set(channelId, {
        messages,
        fetchedAt: Date.now(),
      });

      return messages;
    } catch (error) {
      logger.error('DiscordBot', `Failed to get messages from ${channelId}: ${error}`);
      return this.getCachedMessages(channelId);
    }
  }

  private async fetchMessages(channelId: string): Promise<string[]> {
    if (!this.client) return [];

    const messages: string[] = [];
    const cutoffTime = Date.now() - DISCORD_SENTIMENT.MESSAGE_AGE_LIMIT_MS;

    try {
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || !(channel instanceof TextChannel)) {
        logger.warn('DiscordBot', `Channel ${channelId} is not a text channel`);
        return [];
      }

      // Fetch recent messages
      const fetchedMessages: Collection<string, Message<true>> = await channel.messages.fetch({
        limit: DISCORD_SENTIMENT.MAX_MESSAGES,
      });

      for (const msg of fetchedMessages.values()) {
        // Skip old messages
        if (msg.createdTimestamp < cutoffTime) {
          continue;
        }

        // Skip bot messages
        if (msg.author.bot) {
          continue;
        }

        // Extract text content
        if (msg.content) {
          messages.push(msg.content);
        }
      }
    } catch (error) {
      logger.error('DiscordBot', `Error fetching messages: ${error}`);
      throw error;
    }

    return messages;
  }

  private getCachedMessages(channelId: string): string[] {
    const cached = this.messageCache.get(channelId);
    if (cached && Date.now() - cached.fetchedAt < DISCORD_SENTIMENT.STALE_CACHE_TTL_MS) {
      logger.info('DiscordBot', `Using stale cache for ${channelId}`);
      return cached.messages;
    }
    return [];
  }

  /**
   * Get info about a channel
   */
  async getChannelInfo(channelId: string): Promise<ChannelInfo | null> {
    if (!this.isReady()) return null;

    try {
      await this.rateLimiter.acquire();

      const channel = await this.client!.channels.fetch(channelId);

      if (!channel || !(channel instanceof TextChannel)) {
        return null;
      }

      return {
        id: channel.id,
        name: channel.name,
        guildName: channel.guild.name,
        guildId: channel.guild.id,
      };
    } catch (error) {
      logger.error('DiscordBot', `Failed to get channel info for ${channelId}: ${error}`);
      return null;
    }
  }

  /**
   * List all available text channels the bot can access
   */
  async listAvailableChannels(): Promise<ChannelInfo[]> {
    if (!this.isReady()) return [];

    const channels: ChannelInfo[] = [];

    try {
      for (const guild of this.client!.guilds.cache.values()) {
        for (const channel of guild.channels.cache.values()) {
          if (channel instanceof TextChannel) {
            // Check if bot has permission to read messages
            const permissions = channel.permissionsFor(this.client!.user!);
            if (permissions?.has('ViewChannel') && permissions?.has('ReadMessageHistory')) {
              channels.push({
                id: channel.id,
                name: channel.name,
                guildName: guild.name,
                guildId: guild.id,
              });
            }
          }
        }
      }
    } catch (error) {
      logger.error('DiscordBot', `Error listing channels: ${error}`);
    }

    return channels;
  }

  /**
   * Search for messages containing specific keywords
   */
  async searchMessages(channelId: string, keywords: string[]): Promise<string[]> {
    const allMessages = await this.getChannelMessages(channelId);

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

  getStats(): {
    isConnected: boolean;
    circuitState: string;
    cachedChannels: number;
    guilds: number;
  } {
    return {
      isConnected: this.isConnected,
      circuitState: this.circuitBreaker.getState(),
      cachedChannels: this.messageCache.size,
      guilds: this.client?.guilds.cache.size || 0,
    };
  }

  clearCache(): void {
    this.messageCache.clear();
  }
}

export const discordBotService = new DiscordBotService();
