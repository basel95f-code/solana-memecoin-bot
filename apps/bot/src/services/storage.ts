import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type {
  UserSettings,
  FilterSettings,
  FilterProfile,
  WatchedToken,
  AlertCategories,
  AlertCategory,
  BlacklistEntry,
  BlacklistType,
  AlertPriority,
  AlertPrioritySettings,
  TrackedWallet,
  MonitoredChannel,
  SentimentChannelConfig,
  FilterPresetSettings,
  SharedPreset} from '../types';
import {
  FILTER_PRESETS,
  DEFAULT_ALERT_CATEGORIES,
  DEFAULT_PRIORITY_SETTINGS,
  PRIORITY_ORDER
} from '../types';

// Configuration constants
const MAX_WALLETS_PER_USER = 10;

const DATA_DIR = path.join(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const TEMP_FILE = path.join(DATA_DIR, 'settings.tmp.json');
const BACKUP_FILE = path.join(DATA_DIR, 'settings.backup.json');

/**
 * Validate that an object is a valid UserSettings
 */
function isValidUserSettings(obj: any): obj is UserSettings {
  // Note: trackedWallets is optional for backward compatibility
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.chatId === 'string' &&
    typeof obj.filters === 'object' &&
    Array.isArray(obj.watchlist) &&
    typeof obj.createdAt === 'number' &&
    typeof obj.updatedAt === 'number'
  );
}

/**
 * Validate that an object is a valid FilterSettings
 */
function isValidFilterSettings(obj: any): obj is FilterSettings {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.profile === 'string' &&
    typeof obj.minLiquidity === 'number' &&
    typeof obj.maxTop10Percent === 'number' &&
    typeof obj.minHolders === 'number' &&
    typeof obj.minRiskScore === 'number' &&
    typeof obj.minTokenAge === 'number'
  );
}

class StorageService {
  private settings: Map<string, UserSettings> = new Map();
  private loaded: boolean = false;
  private saveQueue: Promise<void> = Promise.resolve();
  private pendingSave: boolean = false;

  constructor() {
    // Sync directory creation is OK at startup
    this.ensureDataDirSync();
    // Load synchronously at startup to have data ready
    this.loadSync();
  }

  private ensureDataDirSync(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /**
   * Synchronous load for startup
   */
  private loadSync(): void {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
        this.parseAndLoadSettings(data);
      }
      this.loaded = true;
    } catch (error) {
      console.error('Storage: Failed to load settings:', error);
      // Try backup file
      this.tryLoadBackup();
    }
  }

  /**
   * Try loading from backup file
   */
  private tryLoadBackup(): void {
    try {
      if (fs.existsSync(BACKUP_FILE)) {
        console.log('Storage: Attempting to load from backup...');
        const data = fs.readFileSync(BACKUP_FILE, 'utf-8');
        this.parseAndLoadSettings(data);
        console.log('Storage: Loaded from backup successfully');
      }
    } catch (error) {
      console.error('Storage: Backup load also failed:', error);
    }
    this.settings = new Map();
    this.loaded = true;
  }

  /**
   * Parse JSON and validate settings
   */
  private parseAndLoadSettings(data: string): void {
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) {
      let validCount = 0;
      let invalidCount = 0;

      parsed.forEach((entry: any) => {
        if (isValidUserSettings(entry)) {
          // Validate and fix filters if needed
          if (!isValidFilterSettings(entry.filters)) {
            entry.filters = this.getDefaultFilters();
          }
          // Ensure alertCategories exists (migrate old settings)
          if (!entry.filters.alertCategories) {
            entry.filters.alertCategories = { ...DEFAULT_ALERT_CATEGORIES };
          }
          // Ensure alertPriority exists (migrate old settings)
          if (!entry.filters.alertPriority) {
            entry.filters.alertPriority = { ...DEFAULT_PRIORITY_SETTINGS };
          }
          // Ensure trackedWallets exists (migrate old settings)
          if (!Array.isArray(entry.trackedWallets)) {
            entry.trackedWallets = [];
          }
          this.settings.set(entry.chatId, entry);
          validCount++;
        } else {
          invalidCount++;
        }
      });

      if (invalidCount > 0) {
        console.warn(`Storage: Skipped ${invalidCount} invalid settings entries`);
      }
      console.log(`Storage: Loaded ${validCount} user settings`);
    }
  }

  /**
   * Async save with atomic write (write to temp, then rename)
   * Debounced to avoid excessive disk writes
   */
  private async saveAsync(): Promise<void> {
    if (this.pendingSave) return;

    this.pendingSave = true;

    // Debounce - wait 100ms before saving to batch multiple changes
    await new Promise(resolve => setTimeout(resolve, 100));

    this.pendingSave = false;

    this.saveQueue = this.saveQueue.then(async () => {
      try {
        const data = Array.from(this.settings.values());
        const json = JSON.stringify(data, null, 2);

        // Write to temp file first
        await fsPromises.writeFile(TEMP_FILE, json, 'utf-8');

        // Create backup of current file if it exists
        try {
          await fsPromises.access(SETTINGS_FILE);
          await fsPromises.copyFile(SETTINGS_FILE, BACKUP_FILE);
        } catch {
          // No existing file to backup
        }

        // Atomic rename
        await fsPromises.rename(TEMP_FILE, SETTINGS_FILE);
      } catch (error) {
        console.error('Storage: Failed to save settings:', error);
        // Try to clean up temp file
        try {
          await fsPromises.unlink(TEMP_FILE);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    await this.saveQueue;
  }

  /**
   * Non-blocking save trigger
   */
  private save(): void {
    this.saveAsync().catch(err => {
      console.error('Storage: Save error:', err);
    });
  }

  getDefaultFilters(): FilterSettings {
    return {
      profile: 'balanced',
      ...FILTER_PRESETS.balanced,
      alertsEnabled: true,
      alertCategories: { ...DEFAULT_ALERT_CATEGORIES },
      alertPriority: { ...DEFAULT_PRIORITY_SETTINGS },
      timezone: 'UTC',
    };
  }

  getUserSettings(chatId: string): UserSettings {
    let settings = this.settings.get(chatId);
    if (!settings) {
      settings = {
        chatId,
        filters: this.getDefaultFilters(),
        watchlist: [],
        blacklist: [],
        trackedWallets: [],
        presets: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.settings.set(chatId, settings);
      this.save();
    }
    // Ensure blacklist exists (migrate old settings)
    if (!settings.blacklist) {
      settings.blacklist = [];
    }
    // Ensure trackedWallets exists (migrate old settings)
    if (!settings.trackedWallets) {
      settings.trackedWallets = [];
    }
    // Ensure presets exists (migrate old settings)
    if (!settings.presets) {
      settings.presets = [];
    }
    // Ensure alertPriority exists (migrate old settings)
    if (!settings.filters.alertPriority) {
      settings.filters.alertPriority = { ...DEFAULT_PRIORITY_SETTINGS };
    }
    return settings;
  }

  updateUserSettings(chatId: string, updates: Partial<UserSettings>): UserSettings {
    const current = this.getUserSettings(chatId);
    const updated = {
      ...current,
      ...updates,
      updatedAt: Date.now(),
    };
    this.settings.set(chatId, updated);
    this.save();
    return updated;
  }

  setFilterProfile(chatId: string, profile: FilterProfile): FilterSettings {
    const current = this.getUserSettings(chatId);
    let newFilters: FilterSettings;

    if (profile === 'custom') {
      newFilters = {
        ...current.filters,
        profile: 'custom',
      };
    } else {
      newFilters = {
        ...current.filters,
        profile,
        ...FILTER_PRESETS[profile],
      };
    }

    this.updateUserSettings(chatId, { filters: newFilters });
    return newFilters;
  }

  setFilterParam(chatId: string, param: keyof FilterSettings, value: any): FilterSettings {
    const current = this.getUserSettings(chatId);
    const newFilters: FilterSettings = {
      ...current.filters,
      [param]: value,
      profile: 'custom', // Switch to custom when manually editing
    };
    this.updateUserSettings(chatId, { filters: newFilters });
    return newFilters;
  }

  resetFilters(chatId: string): FilterSettings {
    return this.setFilterProfile(chatId, 'balanced');
  }

  // Alerts
  setAlertsEnabled(chatId: string, enabled: boolean): void {
    const current = this.getUserSettings(chatId);
    this.updateUserSettings(chatId, {
      filters: { ...current.filters, alertsEnabled: enabled },
    });
  }

  setMuteUntil(chatId: string, until: number | undefined): void {
    this.updateUserSettings(chatId, { muteUntil: until });
  }

  isAlertsMuted(chatId: string): boolean {
    const settings = this.getUserSettings(chatId);
    if (!settings.filters.alertsEnabled) return true;
    if (settings.muteUntil && Date.now() < settings.muteUntil) return true;
    return false;
  }

  // Quiet hours
  setQuietHours(chatId: string, start: number | undefined, end: number | undefined): void {
    const current = this.getUserSettings(chatId);
    this.updateUserSettings(chatId, {
      filters: {
        ...current.filters,
        quietHoursStart: start,
        quietHoursEnd: end,
      },
    });
  }

  isQuietHours(chatId: string): boolean {
    const settings = this.getUserSettings(chatId);
    const { quietHoursStart, quietHoursEnd } = settings.filters;

    if (quietHoursStart === undefined || quietHoursEnd === undefined) return false;

    const now = new Date();
    const hour = now.getUTCHours(); // Simplified - use timezone library for proper TZ support

    if (quietHoursStart <= quietHoursEnd) {
      return hour >= quietHoursStart && hour < quietHoursEnd;
    } else {
      // Spans midnight
      return hour >= quietHoursStart || hour < quietHoursEnd;
    }
  }

  // Timezone
  setTimezone(chatId: string, timezone: string): void {
    const current = this.getUserSettings(chatId);
    this.updateUserSettings(chatId, {
      filters: { ...current.filters, timezone },
    });
  }

  // Alert Categories
  setAlertCategory(chatId: string, category: AlertCategory, enabled: boolean): AlertCategories {
    const current = this.getUserSettings(chatId);
    const categories = current.filters.alertCategories || { ...DEFAULT_ALERT_CATEGORIES };
    const newCategories: AlertCategories = {
      ...categories,
      [category]: enabled,
    };
    this.updateUserSettings(chatId, {
      filters: { ...current.filters, alertCategories: newCategories },
    });
    return newCategories;
  }

  toggleAlertCategory(chatId: string, category: AlertCategory): boolean {
    const current = this.getUserSettings(chatId);
    const categories = current.filters.alertCategories || { ...DEFAULT_ALERT_CATEGORIES };
    const newState = !categories[category];
    this.setAlertCategory(chatId, category, newState);
    return newState;
  }

  getAlertCategories(chatId: string): AlertCategories {
    const settings = this.getUserSettings(chatId);
    return settings.filters.alertCategories || { ...DEFAULT_ALERT_CATEGORIES };
  }

  isAlertCategoryEnabled(chatId: string, category: AlertCategory): boolean {
    const categories = this.getAlertCategories(chatId);
    return categories[category] ?? true;
  }

  setAllAlertCategories(chatId: string, enabled: boolean): AlertCategories {
    const newCategories: AlertCategories = {
      new_token: enabled,
      volume_spike: enabled,
      whale_movement: enabled,
      liquidity_drain: enabled,
      authority_change: enabled,
      price_alert: enabled,
      smart_money: enabled,
      wallet_activity: enabled,
    };
    const current = this.getUserSettings(chatId);
    this.updateUserSettings(chatId, {
      filters: { ...current.filters, alertCategories: newCategories },
    });
    return newCategories;
  }

  // Alert Priority
  getAlertPriority(chatId: string): AlertPrioritySettings {
    const settings = this.getUserSettings(chatId);
    return settings.filters.alertPriority || { ...DEFAULT_PRIORITY_SETTINGS };
  }

  setMinPriority(chatId: string, priority: AlertPriority): AlertPrioritySettings {
    const current = this.getUserSettings(chatId);
    const newPriority: AlertPrioritySettings = {
      ...current.filters.alertPriority,
      minPriority: priority,
    };
    this.updateUserSettings(chatId, {
      filters: { ...current.filters, alertPriority: newPriority },
    });
    return newPriority;
  }

  setSoundEnabled(chatId: string, enabled: boolean): AlertPrioritySettings {
    const current = this.getUserSettings(chatId);
    const newPriority: AlertPrioritySettings = {
      ...current.filters.alertPriority,
      soundEnabled: enabled,
    };
    this.updateUserSettings(chatId, {
      filters: { ...current.filters, alertPriority: newPriority },
    });
    return newPriority;
  }

  shouldAlertForPriority(chatId: string, priority: AlertPriority): boolean {
    const settings = this.getAlertPriority(chatId);
    const minIndex = PRIORITY_ORDER.indexOf(settings.minPriority);
    const alertIndex = PRIORITY_ORDER.indexOf(priority);
    return alertIndex >= minIndex;
  }

  // Watchlist
  addToWatchlist(chatId: string, token: WatchedToken): WatchedToken[] {
    const current = this.getUserSettings(chatId);
    const exists = current.watchlist.find(t => t.mint === token.mint);
    if (exists) {
      return current.watchlist;
    }
    const newWatchlist = [...current.watchlist, token];
    this.updateUserSettings(chatId, { watchlist: newWatchlist });
    return newWatchlist;
  }

  removeFromWatchlist(chatId: string, mint: string): WatchedToken[] {
    const current = this.getUserSettings(chatId);
    const newWatchlist = current.watchlist.filter(t => t.mint !== mint);
    this.updateUserSettings(chatId, { watchlist: newWatchlist });
    return newWatchlist;
  }

  getWatchlist(chatId: string): WatchedToken[] {
    return this.getUserSettings(chatId).watchlist;
  }

  clearWatchlist(chatId: string): void {
    this.updateUserSettings(chatId, { watchlist: [] });
  }

  updateWatchlistToken(chatId: string, mint: string, updates: Partial<WatchedToken>): void {
    const current = this.getUserSettings(chatId);
    const newWatchlist = current.watchlist.map(t => {
      if (t.mint === mint) {
        return { ...t, ...updates };
      }
      return t;
    });
    this.updateUserSettings(chatId, { watchlist: newWatchlist });
  }

  // Get all chat IDs with watchlists
  getAllWatchlistChatIds(): string[] {
    return Array.from(this.settings.entries())
      .filter(([_, settings]) => settings.watchlist.length > 0)
      .map(([chatId]) => chatId);
  }

  // Blacklist management
  addToBlacklist(chatId: string, entry: BlacklistEntry): BlacklistEntry[] {
    const current = this.getUserSettings(chatId);
    const exists = current.blacklist.find(
      e => e.address === entry.address && e.type === entry.type
    );
    if (exists) {
      return current.blacklist;
    }
    const newBlacklist = [...current.blacklist, entry];
    this.updateUserSettings(chatId, { blacklist: newBlacklist });
    return newBlacklist;
  }

  removeFromBlacklist(chatId: string, address: string): BlacklistEntry[] {
    const current = this.getUserSettings(chatId);
    const newBlacklist = current.blacklist.filter(e => e.address !== address);
    this.updateUserSettings(chatId, { blacklist: newBlacklist });
    return newBlacklist;
  }

  getBlacklist(chatId: string): BlacklistEntry[] {
    return this.getUserSettings(chatId).blacklist || [];
  }

  getBlacklistByType(chatId: string, type: BlacklistType): BlacklistEntry[] {
    const blacklist = this.getBlacklist(chatId);
    return blacklist.filter(e => e.type === type);
  }

  clearBlacklist(chatId: string): void {
    this.updateUserSettings(chatId, { blacklist: [] });
  }

  isBlacklisted(chatId: string, address: string): boolean {
    const blacklist = this.getBlacklist(chatId);
    return blacklist.some(e => e.address === address);
  }

  isTokenBlacklisted(chatId: string, mint: string): boolean {
    const blacklist = this.getBlacklist(chatId);
    return blacklist.some(e => e.type === 'token' && e.address === mint);
  }

  isCreatorBlacklisted(chatId: string, creator: string): boolean {
    const blacklist = this.getBlacklist(chatId);
    return blacklist.some(e => e.type === 'creator' && e.address === creator);
  }

  // Delete user settings
  deleteUserSettings(chatId: string): void {
    this.settings.delete(chatId);
    this.save();
  }

  // Get all settings (for admin/debug)
  getAllSettings(): UserSettings[] {
    return Array.from(this.settings.values());
  }

  // Force an immediate save (useful for shutdown)
  async flush(): Promise<void> {
    await this.saveQueue;
  }

  // ============================================
  // Wallet Tracking Methods
  // ============================================

  // Add wallet to track
  addTrackedWallet(chatId: string, wallet: TrackedWallet): TrackedWallet[] {
    const current = this.getUserSettings(chatId);

    // Check if already at limit
    if (current.trackedWallets.length >= MAX_WALLETS_PER_USER) {
      throw new Error(`Maximum ${MAX_WALLETS_PER_USER} wallets per user`);
    }

    // Check if already tracked
    const exists = current.trackedWallets.find(w => w.address === wallet.address);
    if (exists) {
      return current.trackedWallets;
    }

    const newTrackedWallets = [...current.trackedWallets, wallet];
    this.updateUserSettings(chatId, { trackedWallets: newTrackedWallets });
    return newTrackedWallets;
  }

  // Remove tracked wallet
  removeTrackedWallet(chatId: string, address: string): TrackedWallet[] {
    const current = this.getUserSettings(chatId);
    const newTrackedWallets = current.trackedWallets.filter(w => w.address !== address);
    this.updateUserSettings(chatId, { trackedWallets: newTrackedWallets });
    return newTrackedWallets;
  }

  // Get user's tracked wallets
  getTrackedWallets(chatId: string): TrackedWallet[] {
    return this.getUserSettings(chatId).trackedWallets;
  }

  // Update wallet (lastChecked, lastSignature, etc.)
  updateTrackedWallet(chatId: string, address: string, updates: Partial<TrackedWallet>): void {
    const current = this.getUserSettings(chatId);
    const newTrackedWallets = current.trackedWallets.map(w => {
      if (w.address === address) {
        return { ...w, ...updates };
      }
      return w;
    });
    this.updateUserSettings(chatId, { trackedWallets: newTrackedWallets });
  }

  // Get all chat IDs with tracked wallets (for batch processing)
  getAllTrackedWalletChatIds(): string[] {
    return Array.from(this.settings.entries())
      .filter(([_, settings]) => settings.trackedWallets && settings.trackedWallets.length > 0)
      .map(([chatId]) => chatId);
  }

  // Check if wallet is already tracked
  isWalletTracked(chatId: string, address: string): boolean {
    const trackedWallets = this.getTrackedWallets(chatId);
    return trackedWallets.some(w => w.address === address);
  }

  // Get wallet tracking config
  getMaxWalletsPerUser(): number {
    return MAX_WALLETS_PER_USER;
  }

  // ============================================
  // Sentiment Channel Management
  // ============================================

  private getDefaultSentimentChannels(): SentimentChannelConfig {
    return {
      telegramChannels: [],
      discordChannels: [],
      enabled: true,
    };
  }

  getSentimentChannels(chatId: string): SentimentChannelConfig {
    const settings = this.getUserSettings(chatId);
    return settings.sentimentChannels || this.getDefaultSentimentChannels();
  }

  addSentimentChannel(chatId: string, channel: MonitoredChannel): SentimentChannelConfig {
    const current = this.getUserSettings(chatId);
    const channels = current.sentimentChannels || this.getDefaultSentimentChannels();

    if (channel.platform === 'telegram') {
      // Check if already exists
      const exists = channels.telegramChannels.find(c => c.id === channel.id);
      if (!exists) {
        channels.telegramChannels.push(channel);
      }
    } else if (channel.platform === 'discord') {
      // Check if already exists
      const exists = channels.discordChannels.find(c => c.id === channel.id);
      if (!exists) {
        channels.discordChannels.push(channel);
      }
    }

    this.updateUserSettings(chatId, { sentimentChannels: channels });
    return channels;
  }

  removeSentimentChannel(chatId: string, channelId: string, platform: 'telegram' | 'discord'): SentimentChannelConfig {
    const current = this.getUserSettings(chatId);
    const channels = current.sentimentChannels || this.getDefaultSentimentChannels();

    if (platform === 'telegram') {
      channels.telegramChannels = channels.telegramChannels.filter(c => c.id !== channelId);
    } else if (platform === 'discord') {
      channels.discordChannels = channels.discordChannels.filter(c => c.id !== channelId);
    }

    this.updateUserSettings(chatId, { sentimentChannels: channels });
    return channels;
  }

  toggleSentimentChannels(chatId: string): boolean {
    const current = this.getUserSettings(chatId);
    const channels = current.sentimentChannels || this.getDefaultSentimentChannels();
    channels.enabled = !channels.enabled;
    this.updateUserSettings(chatId, { sentimentChannels: channels });
    return channels.enabled;
  }

  setSentimentChannelsEnabled(chatId: string, enabled: boolean): SentimentChannelConfig {
    const current = this.getUserSettings(chatId);
    const channels = current.sentimentChannels || this.getDefaultSentimentChannels();
    channels.enabled = enabled;
    this.updateUserSettings(chatId, { sentimentChannels: channels });
    return channels;
  }

  clearSentimentChannels(chatId: string, platform?: 'telegram' | 'discord'): SentimentChannelConfig {
    const current = this.getUserSettings(chatId);
    const channels = current.sentimentChannels || this.getDefaultSentimentChannels();

    if (!platform) {
      channels.telegramChannels = [];
      channels.discordChannels = [];
    } else if (platform === 'telegram') {
      channels.telegramChannels = [];
    } else if (platform === 'discord') {
      channels.discordChannels = [];
    }

    this.updateUserSettings(chatId, { sentimentChannels: channels });
    return channels;
  }

  // ============================================
  // Preset Management Methods
  // ============================================

  // Save current filters as a preset
  savePreset(chatId: string, name: string, description?: string): FilterPresetSettings {
    const current = this.getUserSettings(chatId);
    
    // Check if preset name already exists
    const existingIndex = current.presets.findIndex(p => p.name === name);
    
    const preset: FilterPresetSettings = {
      name,
      filters: { ...current.filters },
      createdAt: Date.now(),
      description,
    };

    let newPresets: FilterPresetSettings[];
    if (existingIndex >= 0) {
      // Update existing preset
      newPresets = [...current.presets];
      newPresets[existingIndex] = preset;
    } else {
      // Add new preset
      newPresets = [...current.presets, preset];
    }

    this.updateUserSettings(chatId, { presets: newPresets });
    return preset;
  }

  // Load a preset by name
  loadPreset(chatId: string, name: string): FilterSettings | null {
    const current = this.getUserSettings(chatId);
    const preset = current.presets.find(p => p.name === name);
    
    if (!preset) {
      return null;
    }

    // Apply the preset filters
    this.updateUserSettings(chatId, { filters: preset.filters });
    return preset.filters;
  }

  // Delete a preset
  deletePreset(chatId: string, name: string): boolean {
    const current = this.getUserSettings(chatId);
    const newPresets = current.presets.filter(p => p.name !== name);
    
    if (newPresets.length === current.presets.length) {
      return false; // Preset not found
    }

    this.updateUserSettings(chatId, { presets: newPresets });
    return true;
  }

  // Get all presets for a user
  getPresets(chatId: string): FilterPresetSettings[] {
    return this.getUserSettings(chatId).presets;
  }

  // Get a specific preset
  getPreset(chatId: string, name: string): FilterPresetSettings | null {
    const current = this.getUserSettings(chatId);
    return current.presets.find(p => p.name === name) || null;
  }

  // Export preset as shareable base64 code
  exportPreset(chatId: string, name: string): string | null {
    const preset = this.getPreset(chatId, name);
    if (!preset) {
      return null;
    }

    // Create a shareable version (without user-specific settings)
    const shareable: SharedPreset = {
      name: preset.name,
      filters: {
        profile: preset.filters.profile,
        minLiquidity: preset.filters.minLiquidity,
        maxLiquidity: preset.filters.maxLiquidity,
        maxTop10Percent: preset.filters.maxTop10Percent,
        maxSingleHolderPercent: preset.filters.maxSingleHolderPercent,
        minHolders: preset.filters.minHolders,
        minRiskScore: preset.filters.minRiskScore,
        minOpportunityScore: preset.filters.minOpportunityScore,
        minTokenAge: preset.filters.minTokenAge,
        maxTokenAge: preset.filters.maxTokenAge,
        minMcap: preset.filters.minMcap,
        maxMcap: preset.filters.maxMcap,
        requireMintRevoked: preset.filters.requireMintRevoked,
        requireFreezeRevoked: preset.filters.requireFreezeRevoked,
        requireLPBurned: preset.filters.requireLPBurned,
        lpBurnedMinPercent: preset.filters.lpBurnedMinPercent,
        requireSocials: preset.filters.requireSocials,
        minBondingCurve: preset.filters.minBondingCurve,
        maxBondingCurve: preset.filters.maxBondingCurve,
        volumeSpikeMultiplier: preset.filters.volumeSpikeMultiplier,
        minPriceChange1h: preset.filters.minPriceChange1h,
        maxPriceChange1h: preset.filters.maxPriceChange1h,
        minVolume24h: preset.filters.minVolume24h,
        fastMode: preset.filters.fastMode,
        walletAlertMinSol: preset.filters.walletAlertMinSol,
      },
      description: preset.description,
      version: 1,
    };

    // Encode as base64
    const json = JSON.stringify(shareable);
    return Buffer.from(json).toString('base64');
  }

  // Import preset from base64 code
  importPreset(chatId: string, code: string): FilterPresetSettings | null {
    try {
      // Decode base64
      const json = Buffer.from(code, 'base64').toString('utf-8');
      const shareable: SharedPreset = JSON.parse(json);

      // Validate version (for future compatibility)
      if (shareable.version !== 1) {
        throw new Error('Unsupported preset version');
      }

      // Get current user settings to merge alert settings
      const current = this.getUserSettings(chatId);

      // Create full filter settings by merging with current alert settings
      const filters: FilterSettings = {
        ...shareable.filters,
        alertsEnabled: current.filters.alertsEnabled,
        alertCategories: current.filters.alertCategories,
        alertPriority: current.filters.alertPriority,
        quietHoursStart: current.filters.quietHoursStart,
        quietHoursEnd: current.filters.quietHoursEnd,
        timezone: current.filters.timezone,
      };

      // Check if name already exists and append number if needed
      let finalName = shareable.name;
      let counter = 1;
      while (current.presets.some(p => p.name === finalName)) {
        finalName = `${shareable.name} (${counter})`;
        counter++;
      }

      // Save as a new preset
      return this.savePreset(chatId, finalName, shareable.description);
    } catch (error) {
      console.error('Failed to import preset:', error);
      return null;
    }
  }

  /**
   * Get filter performance data for a user
   * Returns tracking data for win rates per profile
   */
  getFilterPerformance(chatId: string): FilterPerformanceData | null {
    // TODO: Implement filter performance tracking
    // This is a stub to fix compilation errors
    // Performance tracking should store:
    // - Profile stats (wins, losses, win rate, avg price change)
    // - Smart money correlation
    // - First/last outcome timestamps
    return null;
  }
}

// Type for filter performance data
export interface FilterPerformanceData {
  profileStats: {
    [profile: string]: {
      total: number;
      winners: number;
      losers: number;
      winRate: number;
      avgPriceChange24h: number;
      avgRiskScore?: number;
    };
  };
  smartMoneyCorrelation?: {
    correlation: number;
    sampleSize: number;
    tokensWithSmartMoney: number;
    tokensWithoutSmartMoney: number;
    winnerWithSmartMoney: number;
    winnerWithoutSmartMoney: number;
  };
  firstOutcome?: number;
  lastUpdated: number;
}

export const storageService = new StorageService();
