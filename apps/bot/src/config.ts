import dotenv from 'dotenv';
import type { ExtendedBotConfig } from './types';

dotenv.config();

function getEnvVar(name: string, required: boolean = true): string {
  const value = process.env[name];
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value || '';
}

function getEnvNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    console.warn(`Invalid number for ${name}, using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

function getEnvBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.toLowerCase();
  if (!value) return defaultValue;
  return value === 'true' || value === '1' || value === 'yes';
}

export function loadConfig(): ExtendedBotConfig {
  return {
    // Core settings
    solanaRpcUrl: getEnvVar('SOLANA_RPC_URL'),
    solanaWsUrl: getEnvVar('SOLANA_WS_URL', false) ||
      getEnvVar('SOLANA_RPC_URL').replace('https://', 'wss://').replace('http://', 'ws://'),
    telegramBotToken: getEnvVar('TELEGRAM_BOT_TOKEN'),
    telegramChatId: getEnvVar('TELEGRAM_CHAT_ID'),
    rugcheckApiKey: getEnvVar('RUGCHECK_API_KEY', false),
    minLiquidityUsd: getEnvNumber('MIN_LIQUIDITY_USD', 1000),
    minRiskScore: getEnvNumber('MIN_RISK_SCORE', 0),

    // Monitor settings
    monitors: {
      raydium: {
        enabled: getEnvBoolean('RAYDIUM_ENABLED', true),
      },
      pumpfun: {
        enabled: getEnvBoolean('PUMPFUN_ENABLED', true),
        pollInterval: getEnvNumber('PUMPFUN_POLL_INTERVAL', 10000),
      },
      jupiter: {
        enabled: getEnvBoolean('JUPITER_ENABLED', true),
        pollInterval: getEnvNumber('JUPITER_POLL_INTERVAL', 30000),
      },
      meteora: {
        enabled: getEnvBoolean('METEORA_ENABLED', true),
        pollInterval: getEnvNumber('METEORA_POLL_INTERVAL', 15000),
      },
      orca: {
        enabled: getEnvBoolean('ORCA_ENABLED', true),
        pollInterval: getEnvNumber('ORCA_POLL_INTERVAL', 15000),
      },
    },
    maxRequestsPerMinute: getEnvNumber('MAX_REQUESTS_PER_MINUTE', 60),

    // Watchlist settings
    watchlist: {
      enabled: getEnvBoolean('WATCHLIST_ENABLED', true),
      maxTokensPerUser: getEnvNumber('WATCHLIST_MAX_TOKENS', 20),
      checkInterval: getEnvNumber('WATCHLIST_CHECK_INTERVAL', 300000), // 5 minutes
      priceAlertThreshold: getEnvNumber('WATCHLIST_ALERT_THRESHOLD', 20), // 20%
    },

    // Rate limiting
    rateLimit: {
      tokenCooldownMinutes: getEnvNumber('TOKEN_COOLDOWN_MINUTES', 30),
      maxAlertsPerHour: getEnvNumber('MAX_ALERTS_PER_HOUR', 20),
    },

    // Discovery settings
    discovery: {
      enabled: getEnvBoolean('DISCOVERY_ENABLED', true),
      cacheMinutes: getEnvNumber('DISCOVERY_CACHE_MINUTES', 5),
      newTokenHours: getEnvNumber('NEW_TOKEN_HOURS', 24),
    },

    // Storage settings
    storage: {
      dataDir: getEnvVar('DATA_DIR', false) || 'data',
    },

    // Wallet monitoring
    walletMonitor: {
      enabled: getEnvBoolean('WALLET_MONITOR_ENABLED', true),
      pollIntervalMs: getEnvNumber('WALLET_MONITOR_INTERVAL', 60000), // 60 seconds
      maxWalletsPerUser: getEnvNumber('WALLET_MAX_PER_USER', 10),
    },

    // Telegram MTProto (for sentiment analysis)
    telegramMtproto: {
      apiId: getEnvNumber('TELEGRAM_API_ID', 0),
      apiHash: getEnvVar('TELEGRAM_API_HASH', false),
      sessionString: getEnvVar('TELEGRAM_SESSION', false),
      enabled: getEnvBoolean('TELEGRAM_SENTIMENT_ENABLED', false),
    },

    // Discord Bot (for sentiment analysis)
    discordBot: {
      token: getEnvVar('DISCORD_BOT_TOKEN', false),
      enabled: getEnvBoolean('DISCORD_SENTIMENT_ENABLED', false),
    },

    // Multi-platform sentiment settings
    sentiment: {
      enabled: getEnvBoolean('SENTIMENT_ENABLED', true),
      twitterEnabled: getEnvBoolean('TWITTER_SENTIMENT_ENABLED', true),
      telegramEnabled: getEnvBoolean('TELEGRAM_SENTIMENT_ENABLED', false),
      discordEnabled: getEnvBoolean('DISCORD_SENTIMENT_ENABLED', false),
      defaultTelegramChannels: getEnvVar('DEFAULT_TELEGRAM_CHANNELS', false)
        .split(',')
        .map(c => c.trim())
        .filter(c => c.length > 0),
      defaultDiscordChannels: getEnvVar('DEFAULT_DISCORD_CHANNELS', false)
        .split(',')
        .map(c => c.trim())
        .filter(c => c.length > 0),
    },
  };
}

export const config = loadConfig();
