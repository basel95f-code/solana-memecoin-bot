import { EventEmitter } from 'events';
import { dexScreenerService } from './dexscreener';
import { solanaService } from './solana';
import { tokenCache } from './cache';
import { DexScreenerPair } from '../types';

// Alert types for advanced monitoring
export type AlertType = 'volume_spike' | 'whale_movement' | 'liquidity_drain' | 'authority_change';

export interface AdvancedAlert {
  type: AlertType;
  tokenMint: string;
  symbol: string;
  name: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  details: Record<string, any>;
  timestamp: Date;
}

interface TokenSnapshot {
  mint: string;
  symbol: string;
  name: string;
  volume1h: number;
  volume24h: number;
  liquidity: number;
  price: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  topHolders: { address: string; percent: number }[];
  timestamp: number;
}

// Thresholds for alerts
const VOLUME_SPIKE_MULTIPLIER = 5; // 5x normal volume in 1h
const LIQUIDITY_DRAIN_PERCENT = 30; // 30% liquidity removed
const WHALE_MOVEMENT_PERCENT = 3; // 3% of supply moved

export class AdvancedMonitorService extends EventEmitter {
  private isRunning = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private tokenSnapshots: Map<string, TokenSnapshot> = new Map();
  private watchedTokens: Set<string> = new Set();
  private alertHistory: Map<string, number> = new Map(); // token:type -> last alert time
  private readonly ALERT_COOLDOWN = 30 * 60 * 1000; // 30 minutes between same alerts

  constructor() {
    super();
  }

  /**
   * Start advanced monitoring for specified tokens
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log('Starting advanced monitor...');
    this.isRunning = true;

    // Initial snapshot of watched tokens
    await this.refreshSnapshots();

    // Poll every 2 minutes
    this.pollInterval = setInterval(() => {
      this.checkForAlerts().catch((error) => {
        console.error('Error in advanced monitor polling:', error);
      });
    }, 120000);

    console.log('Advanced monitor started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.isRunning = false;
    console.log('Advanced monitor stopped');
  }

  /**
   * Add a token to watch for advanced alerts
   */
  watchToken(mint: string): void {
    this.watchedTokens.add(mint);
  }

  /**
   * Remove a token from advanced monitoring
   */
  unwatchToken(mint: string): void {
    this.watchedTokens.delete(mint);
    this.tokenSnapshots.delete(mint);
  }

  /**
   * Get all watched tokens
   */
  getWatchedTokens(): string[] {
    return Array.from(this.watchedTokens);
  }

  /**
   * Take snapshots of all watched tokens
   */
  private async refreshSnapshots(): Promise<void> {
    for (const mint of this.watchedTokens) {
      try {
        const snapshot = await this.takeSnapshot(mint);
        if (snapshot) {
          this.tokenSnapshots.set(mint, snapshot);
        }
      } catch (error) {
        console.error(`Error taking snapshot for ${mint}:`, error);
      }
    }
  }

  /**
   * Take a snapshot of a token's current state
   */
  private async takeSnapshot(mint: string): Promise<TokenSnapshot | null> {
    try {
      const [dexData, mintInfo, holders] = await Promise.all([
        dexScreenerService.getTokenData(mint),
        solanaService.getMintInfo(mint),
        solanaService.getTokenHolders(mint, 10),
      ]);

      if (!dexData) return null;

      const totalSupply = Number(mintInfo?.supply || 0);
      const topHolders = holders.map(h => ({
        address: h.address,
        percent: totalSupply > 0 ? (h.balance / totalSupply) * 100 : 0,
      }));

      return {
        mint,
        symbol: dexData.baseToken.symbol,
        name: dexData.baseToken.name,
        volume1h: dexData.volume?.h1 || 0,
        volume24h: dexData.volume?.h24 || 0,
        liquidity: dexData.liquidity?.usd || 0,
        price: parseFloat(dexData.priceUsd || '0'),
        mintAuthority: mintInfo?.mintAuthority?.toBase58() || null,
        freezeAuthority: mintInfo?.freezeAuthority?.toBase58() || null,
        topHolders,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(`Error taking snapshot for ${mint}:`, error);
      return null;
    }
  }

  /**
   * Check all watched tokens for alert conditions
   */
  private async checkForAlerts(): Promise<void> {
    for (const mint of this.watchedTokens) {
      try {
        const previousSnapshot = this.tokenSnapshots.get(mint);
        const currentSnapshot = await this.takeSnapshot(mint);

        if (!currentSnapshot) continue;

        // Store new snapshot
        this.tokenSnapshots.set(mint, currentSnapshot);

        if (!previousSnapshot) continue;

        // Check for various alert conditions
        await this.checkVolumeSpike(previousSnapshot, currentSnapshot);
        await this.checkLiquidityDrain(previousSnapshot, currentSnapshot);
        await this.checkAuthorityChange(previousSnapshot, currentSnapshot);
        await this.checkWhaleMovement(previousSnapshot, currentSnapshot);
      } catch (error) {
        console.error(`Error checking alerts for ${mint}:`, error);
      }
    }
  }

  /**
   * Check for volume spike
   */
  private async checkVolumeSpike(prev: TokenSnapshot, current: TokenSnapshot): Promise<void> {
    if (prev.volume1h === 0) return;

    const volumeIncrease = current.volume1h / prev.volume1h;

    if (volumeIncrease >= VOLUME_SPIKE_MULTIPLIER) {
      const alertKey = `${current.mint}:volume_spike`;
      if (this.shouldAlert(alertKey)) {
        const alert: AdvancedAlert = {
          type: 'volume_spike',
          tokenMint: current.mint,
          symbol: current.symbol,
          name: current.name,
          severity: volumeIncrease >= 10 ? 'critical' : 'warning',
          message: `Volume spike detected: ${volumeIncrease.toFixed(1)}x increase`,
          details: {
            previousVolume1h: prev.volume1h,
            currentVolume1h: current.volume1h,
            multiplier: volumeIncrease,
            currentPrice: current.price,
          },
          timestamp: new Date(),
        };

        this.emit('alert', alert);
        this.alertHistory.set(alertKey, Date.now());
      }
    }
  }

  /**
   * Check for liquidity drain
   */
  private async checkLiquidityDrain(prev: TokenSnapshot, current: TokenSnapshot): Promise<void> {
    if (prev.liquidity === 0) return;

    const liquidityChange = ((prev.liquidity - current.liquidity) / prev.liquidity) * 100;

    if (liquidityChange >= LIQUIDITY_DRAIN_PERCENT) {
      const alertKey = `${current.mint}:liquidity_drain`;
      if (this.shouldAlert(alertKey)) {
        const severity = liquidityChange >= 50 ? 'critical' : 'warning';
        const alert: AdvancedAlert = {
          type: 'liquidity_drain',
          tokenMint: current.mint,
          symbol: current.symbol,
          name: current.name,
          severity,
          message: `Liquidity removed: ${liquidityChange.toFixed(1)}% decrease`,
          details: {
            previousLiquidity: prev.liquidity,
            currentLiquidity: current.liquidity,
            percentRemoved: liquidityChange,
            amountRemoved: prev.liquidity - current.liquidity,
          },
          timestamp: new Date(),
        };

        this.emit('alert', alert);
        this.alertHistory.set(alertKey, Date.now());
      }
    }
  }

  /**
   * Check for authority changes (mint/freeze authority revoked or granted)
   */
  private async checkAuthorityChange(prev: TokenSnapshot, current: TokenSnapshot): Promise<void> {
    // Check mint authority change
    if (prev.mintAuthority !== current.mintAuthority) {
      const alertKey = `${current.mint}:authority_change_mint`;
      if (this.shouldAlert(alertKey)) {
        const wasRevoked = prev.mintAuthority !== null && current.mintAuthority === null;
        const wasGranted = prev.mintAuthority === null && current.mintAuthority !== null;

        const alert: AdvancedAlert = {
          type: 'authority_change',
          tokenMint: current.mint,
          symbol: current.symbol,
          name: current.name,
          severity: wasGranted ? 'critical' : 'info',
          message: wasRevoked
            ? 'Mint authority revoked (good!)'
            : wasGranted
              ? 'Mint authority granted (danger!)'
              : 'Mint authority changed',
          details: {
            authorityType: 'mint',
            previousAuthority: prev.mintAuthority,
            currentAuthority: current.mintAuthority,
            wasRevoked,
            wasGranted,
          },
          timestamp: new Date(),
        };

        this.emit('alert', alert);
        this.alertHistory.set(alertKey, Date.now());
      }
    }

    // Check freeze authority change
    if (prev.freezeAuthority !== current.freezeAuthority) {
      const alertKey = `${current.mint}:authority_change_freeze`;
      if (this.shouldAlert(alertKey)) {
        const wasRevoked = prev.freezeAuthority !== null && current.freezeAuthority === null;
        const wasGranted = prev.freezeAuthority === null && current.freezeAuthority !== null;

        const alert: AdvancedAlert = {
          type: 'authority_change',
          tokenMint: current.mint,
          symbol: current.symbol,
          name: current.name,
          severity: wasGranted ? 'critical' : 'info',
          message: wasRevoked
            ? 'Freeze authority revoked (good!)'
            : wasGranted
              ? 'Freeze authority granted (danger!)'
              : 'Freeze authority changed',
          details: {
            authorityType: 'freeze',
            previousAuthority: prev.freezeAuthority,
            currentAuthority: current.freezeAuthority,
            wasRevoked,
            wasGranted,
          },
          timestamp: new Date(),
        };

        this.emit('alert', alert);
        this.alertHistory.set(alertKey, Date.now());
      }
    }
  }

  /**
   * Check for whale movements (large holder % changes)
   */
  private async checkWhaleMovement(prev: TokenSnapshot, current: TokenSnapshot): Promise<void> {
    // Compare top holder positions
    for (const currentHolder of current.topHolders) {
      const prevHolder = prev.topHolders.find(h => h.address === currentHolder.address);

      if (!prevHolder) continue;

      const percentChange = Math.abs(currentHolder.percent - prevHolder.percent);

      if (percentChange >= WHALE_MOVEMENT_PERCENT) {
        const alertKey = `${current.mint}:whale_${currentHolder.address.slice(0, 8)}`;
        if (this.shouldAlert(alertKey)) {
          const isSelling = currentHolder.percent < prevHolder.percent;
          const alert: AdvancedAlert = {
            type: 'whale_movement',
            tokenMint: current.mint,
            symbol: current.symbol,
            name: current.name,
            severity: percentChange >= 10 ? 'critical' : 'warning',
            message: `Whale ${isSelling ? 'selling' : 'buying'}: ${percentChange.toFixed(1)}% supply moved`,
            details: {
              whaleAddress: currentHolder.address,
              previousPercent: prevHolder.percent,
              currentPercent: currentHolder.percent,
              percentChange,
              isSelling,
            },
            timestamp: new Date(),
          };

          this.emit('alert', alert);
          this.alertHistory.set(alertKey, Date.now());
        }
      }
    }
  }

  /**
   * Check if we should send an alert (cooldown check)
   */
  private shouldAlert(alertKey: string): boolean {
    const lastAlert = this.alertHistory.get(alertKey);
    if (!lastAlert) return true;

    return Date.now() - lastAlert >= this.ALERT_COOLDOWN;
  }

  /**
   * Manually trigger analysis for a token
   */
  async analyzeToken(mint: string): Promise<AdvancedAlert[]> {
    const alerts: AdvancedAlert[] = [];

    try {
      const snapshot = await this.takeSnapshot(mint);
      if (!snapshot) return alerts;

      // Check for immediate concerns
      // 1. Very low liquidity
      if (snapshot.liquidity < 1000) {
        alerts.push({
          type: 'liquidity_drain',
          tokenMint: mint,
          symbol: snapshot.symbol,
          name: snapshot.name,
          severity: snapshot.liquidity < 100 ? 'critical' : 'warning',
          message: `Very low liquidity: $${snapshot.liquidity.toFixed(0)}`,
          details: { liquidity: snapshot.liquidity },
          timestamp: new Date(),
        });
      }

      // 2. Mint authority still active
      if (snapshot.mintAuthority) {
        alerts.push({
          type: 'authority_change',
          tokenMint: mint,
          symbol: snapshot.symbol,
          name: snapshot.name,
          severity: 'critical',
          message: 'Mint authority is still active',
          details: { mintAuthority: snapshot.mintAuthority },
          timestamp: new Date(),
        });
      }

      // 3. Freeze authority still active
      if (snapshot.freezeAuthority) {
        alerts.push({
          type: 'authority_change',
          tokenMint: mint,
          symbol: snapshot.symbol,
          name: snapshot.name,
          severity: 'warning',
          message: 'Freeze authority is still active',
          details: { freezeAuthority: snapshot.freezeAuthority },
          timestamp: new Date(),
        });
      }

      // 4. Whale concentration
      const top1Percent = snapshot.topHolders[0]?.percent || 0;
      if (top1Percent > 30) {
        alerts.push({
          type: 'whale_movement',
          tokenMint: mint,
          symbol: snapshot.symbol,
          name: snapshot.name,
          severity: top1Percent > 50 ? 'critical' : 'warning',
          message: `Single wallet holds ${top1Percent.toFixed(1)}% of supply`,
          details: {
            whaleAddress: snapshot.topHolders[0]?.address,
            percent: top1Percent,
          },
          timestamp: new Date(),
        });
      }

    } catch (error) {
      console.error(`Error analyzing token ${mint}:`, error);
    }

    return alerts;
  }

  /**
   * Get current stats
   */
  getStats(): { watchedTokens: number; snapshotCount: number; alertHistory: number } {
    return {
      watchedTokens: this.watchedTokens.size,
      snapshotCount: this.tokenSnapshots.size,
      alertHistory: this.alertHistory.size,
    };
  }

  /**
   * Clear old alert history entries
   */
  cleanupAlertHistory(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const [key, timestamp] of this.alertHistory.entries()) {
      if (now - timestamp > maxAge) {
        this.alertHistory.delete(key);
      }
    }
  }
}

export const advancedMonitor = new AdvancedMonitorService();
