import { Telegraf } from 'telegraf';
import { config } from '../config';
import type { TokenAnalysis, WatchedToken, WalletActivityAlert, TrackedWallet, WalletTransaction } from '../types';
import type { TradingSignal } from '../signals/types';
import { registerAllCommands, incrementAlertsSent } from '../telegram/commands';
import { registerTopicEnforcer } from '../middleware/topicEnforcer';
import { formatTokenAlert, formatWatchlistAlert, formatSignalAlert } from '../telegram/formatters';
import { alertActionKeyboard, signalActionKeyboard } from '../telegram/keyboards';
import { storageService } from './storage';
import { dexScreenerService } from './dexscreener';
import { TELEGRAM } from '../constants';
import { logger } from '../utils/logger';

class TelegramService {
  private bot: Telegraf;
  private defaultChatId: string;
  private initialized: boolean = false;

  constructor() {
    this.bot = new Telegraf(config.telegramBotToken);
    this.defaultChatId = config.telegramChatId;
  }

  /**
   * Retry a function with exponential backoff
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    context: string,
    maxRetries: number = TELEGRAM.MAX_RETRIES
  ): Promise<T> {
    let lastError: Error | undefined;
    let delay = TELEGRAM.RETRY_DELAY_MS;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        const isRetryable = this.isRetryableError(error);

        if (!isRetryable || attempt === maxRetries) {
          logger.silentError('Telegram', `${context} failed after ${attempt} attempts`, lastError);
          throw lastError;
        }

        logger.debug('Telegram', `${context} attempt ${attempt} failed, retrying in ${delay}ms...`);
        await this.sleep(delay);
        delay *= TELEGRAM.RETRY_BACKOFF_MULTIPLIER;
      }
    }

    throw lastError;
  }

  /**
   * Check if an error is retryable (network/timeout issues)
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Retry on network errors, rate limits, and timeouts
      return (
        message.includes('etimedout') ||
        message.includes('econnreset') ||
        message.includes('econnrefused') ||
        message.includes('network') ||
        message.includes('429') || // Rate limited
        message.includes('timeout') ||
        message.includes('socket hang up')
      );
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getBot(): Telegraf {
    return this.bot;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Register topic enforcer middleware (before commands)
      registerTopicEnforcer(this.bot);

      // Register all modular commands
      registerAllCommands(this.bot);

      // Verify bot token by calling getMe (validates token before starting)
      const botInfo = await this.bot.telegram.getMe();
      console.log(`Telegram bot authenticated as @${botInfo.username}`);

      // Start bot in polling mode (non-blocking, runs in background)
      // launch() returns a promise that resolves only when bot stops
      this.bot.launch().catch((error) => {
        logger.error('Telegram', 'Bot polling error', error as Error);
      });

      this.initialized = true;
      console.log('Telegram bot initialized with topic-aware middleware and all commands');
    } catch (error) {
      console.error('Failed to initialize Telegram bot:', error);
      throw error;
    }
  }

  async sendAlert(
    analysis: TokenAnalysis,
    mlPrediction?: { rugProbability: number; confidence: number; recommendation: string },
    chatId?: string
  ): Promise<void> {
    const targetChatId = chatId || this.defaultChatId;

    // Check if alerts are muted for this chat
    if (storageService.isAlertsMuted(targetChatId)) {
      console.log(`Alerts muted for ${targetChatId}, skipping`);
      return;
    }

    // Check quiet hours
    if (storageService.isQuietHours(targetChatId)) {
      console.log(`Quiet hours active for ${targetChatId}, skipping`);
      return;
    }

    try {
      // Get additional data from DexScreener
      const dexData = await dexScreenerService.getTokenData(analysis.token.mint);

      // Format the alert with ML prediction
      const message = formatTokenAlert(analysis, dexData || undefined, mlPrediction);

      await this.withRetry(
        () => this.bot.telegram.sendMessage(targetChatId, message, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...alertActionKeyboard(analysis.token.mint),
        }),
        `sendAlert for ${analysis.token.symbol}`
      );

      incrementAlertsSent();
    } catch (error) {
      logger.silentError('Telegram', `Failed to send alert for ${analysis.token.symbol}`, error as Error);
    }
  }

  async sendWatchlistAlert(chatId: string, token: WatchedToken): Promise<void> {
    // Check if alerts are muted
    if (storageService.isAlertsMuted(chatId)) {
      return;
    }

    try {
      const message = formatWatchlistAlert(token);

      await this.withRetry(
        () => this.bot.telegram.sendMessage(chatId, message, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...alertActionKeyboard(token.mint),
        }),
        `sendWatchlistAlert for ${token.symbol}`
      );
    } catch (error) {
      logger.silentError('Telegram', `Failed to send watchlist alert for ${token.symbol}`, error as Error);
    }
  }

  async sendSignalAlert(signal: TradingSignal, chatId?: string): Promise<void> {
    const targetChatId = chatId || this.defaultChatId;

    // Check if alerts are muted
    if (storageService.isAlertsMuted(targetChatId)) {
      return;
    }

    // Check quiet hours
    if (storageService.isQuietHours(targetChatId)) {
      return;
    }

    try {
      const message = formatSignalAlert(signal);

      await this.withRetry(
        () => this.bot.telegram.sendMessage(targetChatId, message, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...signalActionKeyboard(signal.id, signal.mint),
        }),
        `sendSignalAlert for ${signal.symbol}`
      );

      incrementAlertsSent();
    } catch (error) {
      logger.silentError('Telegram', `Failed to send signal alert for ${signal.symbol}`, error as Error);
    }
  }

  async sendWalletActivityAlert(alert: WalletActivityAlert): Promise<void> {
    const { wallet, transaction, chatId } = alert;

    // Check if alerts are muted
    if (storageService.isAlertsMuted(chatId)) {
      return;
    }

    // Check quiet hours
    if (storageService.isQuietHours(chatId)) {
      return;
    }

    try {
      const message = this.formatWalletActivityAlert(wallet, transaction);

      await this.withRetry(
        () => this.bot.telegram.sendMessage(chatId, message, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        }),
        `sendWalletActivityAlert for ${wallet.label}`
      );

      incrementAlertsSent();
    } catch (error) {
      logger.silentError('Telegram', `Failed to send wallet activity alert for ${wallet.label}`, error as Error);
    }
  }

  private formatWalletActivityAlert(wallet: TrackedWallet, tx: WalletTransaction): string {
    const typeEmoji = tx.type === 'buy' ? '🟢' : tx.type === 'sell' ? '🔴' : '↔️';
    const actionText = tx.type === 'buy' ? 'BOUGHT' : tx.type === 'sell' ? 'SOLD' : 'TRANSFERRED';

    let msg = `<b>👛 Wallet Activity</b>\n\n`;

    // Wallet info
    msg += `<b>${wallet.label}</b>\n`;
    msg += `<code>${wallet.address.slice(0, 4)}...${wallet.address.slice(-4)}</code>\n\n`;

    // Transaction type and token
    msg += `${typeEmoji} <b>${actionText}</b>`;

    // Token amount with symbol
    if (tx.amount) {
      const formattedAmount = tx.amount >= 1000000
        ? `${(tx.amount / 1000000).toFixed(2)}M`
        : tx.amount >= 1000
        ? `${(tx.amount / 1000).toFixed(2)}K`
        : tx.amount.toLocaleString(undefined, { maximumFractionDigits: 2 });

      msg += ` ${formattedAmount}`;
      if (tx.tokenSymbol) {
        msg += ` <b>${tx.tokenSymbol}</b>`;
      }
    }
    msg += `\n`;

    // Token name (if different from symbol)
    if (tx.tokenName && tx.tokenSymbol && tx.tokenName !== tx.tokenSymbol) {
      msg += `📍 ${tx.tokenName}\n`;
    }

    // Value in SOL and USD
    if (tx.solAmount && tx.solAmount > 0.0001) {
      msg += `💰 <b>${tx.solAmount.toFixed(4)} SOL</b>`;
      if (tx.priceUsd && tx.priceUsd > 0.01) {
        msg += ` (~$${tx.priceUsd.toFixed(2)})`;
      }
      msg += `\n`;
    }

    msg += `\n`;

    // Links row
    msg += `🔗 <a href="https://solscan.io/tx/${tx.signature}">Transaction</a>`;
    if (tx.tokenMint) {
      msg += ` • <a href="https://dexscreener.com/solana/${tx.tokenMint}">Chart</a>`;
      msg += ` • <a href="https://birdeye.so/token/${tx.tokenMint}?chain=solana">Birdeye</a>`;
    }
    msg += `\n\n`;

    // Quick action
    msg += `🔍 <code>/check ${tx.tokenMint}</code>`;

    return msg;
  }

  async sendMessage(message: string, chatId?: string): Promise<void> {
    const targetChatId = chatId || this.defaultChatId;

    try {
      await this.withRetry(
        () => this.bot.telegram.sendMessage(targetChatId, message, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        }),
        'sendMessage'
      );
    } catch (error) {
      logger.silentError('Telegram', 'Failed to send message', error as Error);
    }
  }

  async sendStartupMessage(): Promise<void> {
    const monitors = [];
    if (config.monitors.raydium.enabled) monitors.push('Raydium');
    if (config.monitors.pumpfun.enabled) monitors.push('Pump.fun');
    if (config.monitors.jupiter.enabled) monitors.push('Jupiter');

    const message = [
      `🚀 <b>Solana Memecoin Monitor Started</b>`,
      ``,
      `<b>Active Monitors:</b>`,
      monitors.map(m => `✅ ${m}`).join('\n'),
      ``,
      `<b>Features:</b>`,
      `✅ Token analysis`,
      `✅ Risk classification`,
      config.watchlist.enabled ? `✅ Watchlist alerts` : `❌ Watchlist`,
      config.discovery.enabled ? `✅ Token discovery` : `❌ Discovery`,
      ``,
      `Type /help for all commands.`,
    ].join('\n');

    await this.sendMessage(message);
  }

  stop(): void {
    this.bot.stop();
  }
}

export const telegramService = new TelegramService();
