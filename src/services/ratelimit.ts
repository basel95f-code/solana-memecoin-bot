import { config } from '../config';

interface CooldownEntry {
  lastAlertTime: number;
  alertCount: number;
  hourStartTime: number;
}

class RateLimitService {
  // chatId -> (tokenMint -> cooldown info)
  private tokenCooldowns: Map<string, Map<string, CooldownEntry>> = new Map();

  private getCooldownMs(): number {
    return config.rateLimit.tokenCooldownMinutes * 60 * 1000;
  }

  private getOrCreateChatCooldowns(chatId: string): Map<string, CooldownEntry> {
    let chatCooldowns = this.tokenCooldowns.get(chatId);
    if (!chatCooldowns) {
      chatCooldowns = new Map();
      this.tokenCooldowns.set(chatId, chatCooldowns);
    }
    return chatCooldowns;
  }

  canSendAlert(chatId: string, tokenMint: string): boolean {
    const chatCooldowns = this.getOrCreateChatCooldowns(chatId);
    const entry = chatCooldowns.get(tokenMint);

    if (!entry) {
      return true;
    }

    const now = Date.now();
    const cooldownMs = this.getCooldownMs();

    // Check if cooldown has expired
    if (now - entry.lastAlertTime >= cooldownMs) {
      return true;
    }

    return false;
  }

  canSendAnyAlert(chatId: string): boolean {
    const chatCooldowns = this.getOrCreateChatCooldowns(chatId);
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    // Count alerts in the last hour
    let alertsInLastHour = 0;

    chatCooldowns.forEach(entry => {
      if (entry.lastAlertTime >= oneHourAgo) {
        alertsInLastHour++;
      }
    });

    return alertsInLastHour < config.rateLimit.maxAlertsPerHour;
  }

  markAlertSent(chatId: string, tokenMint: string): void {
    const chatCooldowns = this.getOrCreateChatCooldowns(chatId);
    const now = Date.now();

    const existing = chatCooldowns.get(tokenMint);

    chatCooldowns.set(tokenMint, {
      lastAlertTime: now,
      alertCount: (existing?.alertCount || 0) + 1,
      hourStartTime: existing?.hourStartTime || now,
    });
  }

  getCooldownRemaining(chatId: string, tokenMint: string): number {
    const chatCooldowns = this.tokenCooldowns.get(chatId);
    if (!chatCooldowns) return 0;

    const entry = chatCooldowns.get(tokenMint);
    if (!entry) return 0;

    const cooldownMs = this.getCooldownMs();
    const elapsed = Date.now() - entry.lastAlertTime;
    const remaining = cooldownMs - elapsed;

    return Math.max(0, Math.ceil(remaining / 1000)); // Return seconds
  }

  getAlertsRemainingThisHour(chatId: string): number {
    const chatCooldowns = this.tokenCooldowns.get(chatId);
    if (!chatCooldowns) return config.rateLimit.maxAlertsPerHour;

    const now = Date.now();
    const oneHourAgo = now - 3600000;

    let alertsInLastHour = 0;
    chatCooldowns.forEach(entry => {
      if (entry.lastAlertTime >= oneHourAgo) {
        alertsInLastHour++;
      }
    });

    return Math.max(0, config.rateLimit.maxAlertsPerHour - alertsInLastHour);
  }

  // Clean up old cooldown entries (call periodically)
  cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    this.tokenCooldowns.forEach((chatCooldowns, chatId) => {
      chatCooldowns.forEach((entry, tokenMint) => {
        if (now - entry.lastAlertTime > maxAge) {
          chatCooldowns.delete(tokenMint);
        }
      });

      // Remove empty chat maps
      if (chatCooldowns.size === 0) {
        this.tokenCooldowns.delete(chatId);
      }
    });
  }

  // Get stats for debugging
  getStats(): { chats: number; totalEntries: number } {
    let totalEntries = 0;
    this.tokenCooldowns.forEach(chatCooldowns => {
      totalEntries += chatCooldowns.size;
    });

    return {
      chats: this.tokenCooldowns.size,
      totalEntries,
    };
  }
}

export const rateLimitService = new RateLimitService();
