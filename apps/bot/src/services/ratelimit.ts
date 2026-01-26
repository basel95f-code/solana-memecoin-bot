/**
 * Rate Limiting Service
 * 
 * FIXES APPLIED:
 * - #3: Added mutex/lock mechanism to prevent race conditions during concurrent access
 */

import { config } from '../config';

interface CooldownEntry {
  lastAlertTime: number;
  alertCount: number;
  hourStartTime: number;
}

class RateLimitService {
  // chatId -> (tokenMint -> cooldown info)
  private tokenCooldowns: Map<string, Map<string, CooldownEntry>> = new Map();
  // chatId -> array of alert timestamps for sliding window counting
  private alertTimestamps: Map<string, number[]> = new Map();
  
  // FIX #3: Mutex locks to prevent race conditions
  private locks: Map<string, Promise<void>> = new Map();
  private lockResolvers: Map<string, () => void> = new Map();

  /**
   * FIX #3: Acquire a lock for a specific chat to prevent race conditions
   */
  private async acquireLock(chatId: string): Promise<void> {
    // Wait for any existing lock to be released
    const existingLock = this.locks.get(chatId);
    if (existingLock) {
      await existingLock;
    }
    
    // Create a new lock
    let resolver: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolver = resolve;
    });
    this.locks.set(chatId, lockPromise);
    this.lockResolvers.set(chatId, resolver!);
  }

  /**
   * FIX #3: Release a lock for a specific chat
   */
  private releaseLock(chatId: string): void {
    const resolver = this.lockResolvers.get(chatId);
    if (resolver) {
      resolver();
      this.locks.delete(chatId);
      this.lockResolvers.delete(chatId);
    }
  }

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

  /**
   * FIX #3: Made async with lock to prevent race condition
   */
  async canSendAlert(chatId: string, tokenMint: string): Promise<boolean> {
    await this.acquireLock(chatId);
    try {
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
    } finally {
      this.releaseLock(chatId);
    }
  }

  /**
   * FIX #3: Made async with lock to prevent race condition during timestamp mutation
   */
  async canSendAnyAlert(chatId: string): Promise<boolean> {
    await this.acquireLock(chatId);
    try {
      const timestamps = this.alertTimestamps.get(chatId);
      if (!timestamps || timestamps.length === 0) {
        return true;
      }

      const now = Date.now();
      const oneHourAgo = now - 3600000;

      // FIX #3: Create new array instead of mutating during iteration
      const validTimestamps = timestamps.filter(t => t >= oneHourAgo);
      this.alertTimestamps.set(chatId, validTimestamps);

      return validTimestamps.length < config.rateLimit.maxAlertsPerHour;
    } finally {
      this.releaseLock(chatId);
    }
  }

  /**
   * FIX #3: Made async with lock to prevent race condition
   */
  async markAlertSent(chatId: string, tokenMint: string): Promise<void> {
    await this.acquireLock(chatId);
    try {
      const chatCooldowns = this.getOrCreateChatCooldowns(chatId);
      const now = Date.now();

      const existing = chatCooldowns.get(tokenMint);

      chatCooldowns.set(tokenMint, {
        lastAlertTime: now,
        alertCount: (existing?.alertCount || 0) + 1,
        hourStartTime: existing?.hourStartTime || now,
      });

      // Add to sliding window timestamps
      let timestamps = this.alertTimestamps.get(chatId);
      if (!timestamps) {
        timestamps = [];
        this.alertTimestamps.set(chatId, timestamps);
      }
      timestamps.push(now);
    } finally {
      this.releaseLock(chatId);
    }
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
    const timestamps = this.alertTimestamps.get(chatId);
    if (!timestamps) return config.rateLimit.maxAlertsPerHour;

    const now = Date.now();
    const oneHourAgo = now - 3600000;

    // Prune old timestamps
    while (timestamps.length > 0 && timestamps[0] < oneHourAgo) {
      timestamps.shift();
    }

    return Math.max(0, config.rateLimit.maxAlertsPerHour - timestamps.length);
  }

  // Clean up old cooldown entries (call periodically)
  cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const oneHourAgo = now - 3600000;

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

    // Cleanup alert timestamps (remove old entries)
    this.alertTimestamps.forEach((timestamps, chatId) => {
      while (timestamps.length > 0 && timestamps[0] < oneHourAgo) {
        timestamps.shift();
      }
      if (timestamps.length === 0) {
        this.alertTimestamps.delete(chatId);
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
