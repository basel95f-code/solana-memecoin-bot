import { Telegraf } from 'telegraf';
import { config } from '../config';
import { TokenAnalysis, RiskLevel, WatchedToken, DexScreenerPair } from '../types';
import { registerAllCommands, incrementAlertsSent } from '../telegram/commands';
import { formatTokenAlert, formatWatchlistAlert } from '../telegram/formatters';
import { alertActionKeyboard } from '../telegram/keyboards';
import { storageService } from './storage';
import { dexScreenerService } from './dexscreener';

class TelegramService {
  private bot: Telegraf;
  private defaultChatId: string;
  private initialized: boolean = false;

  constructor() {
    this.bot = new Telegraf(config.telegramBotToken);
    this.defaultChatId = config.telegramChatId;
  }

  getBot(): Telegraf {
    return this.bot;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Register all modular commands
      registerAllCommands(this.bot);

      // Verify bot token by calling getMe (validates token before starting)
      const botInfo = await this.bot.telegram.getMe();
      console.log(`Telegram bot authenticated as @${botInfo.username}`);

      // Start bot in polling mode (non-blocking, runs in background)
      // launch() returns a promise that resolves only when bot stops
      this.bot.launch().catch((error) => {
        console.error('Telegram bot polling error:', error);
      });

      this.initialized = true;
      console.log('Telegram bot initialized with all commands');
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

      await this.bot.telegram.sendMessage(targetChatId, message, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...alertActionKeyboard(analysis.token.mint),
      });

      incrementAlertsSent();
    } catch (error) {
      console.error('Failed to send Telegram alert:', error);
    }
  }

  async sendWatchlistAlert(chatId: string, token: WatchedToken): Promise<void> {
    // Check if alerts are muted
    if (storageService.isAlertsMuted(chatId)) {
      return;
    }

    try {
      const message = formatWatchlistAlert(token);

      await this.bot.telegram.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...alertActionKeyboard(token.mint),
      });
    } catch (error) {
      console.error('Failed to send watchlist alert:', error);
    }
  }

  async sendMessage(message: string, chatId?: string): Promise<void> {
    const targetChatId = chatId || this.defaultChatId;

    try {
      await this.bot.telegram.sendMessage(targetChatId, message, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      console.error('Failed to send message:', error);
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
