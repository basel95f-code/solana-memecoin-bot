import { EventEmitter } from 'events';
import { Connection, PublicKey, ParsedTransactionWithMeta, ConfirmedSignatureInfo, Logs } from '@solana/web3.js';
import axios from 'axios';
import { config } from '../config';
import { storageService } from './storage';
import { solanaService } from './solana';
import { dexScreenerService } from './dexscreener';
import { TrackedWallet, WalletTransaction, WalletActivityAlert, SOL_MINT, DEFAULT_CATEGORY_PRIORITIES } from '../types';
import { logger } from '../utils/logger';
import { WALLET_MONITOR, DEX_PROGRAMS as DEX_PROGRAM_IDS } from '../constants';

// Token metadata cache
interface TokenMetadataCache {
  symbol: string;
  name: string;
  priceUsd?: number;
  cachedAt: number;
}
const tokenMetadataCache = new Map<string, TokenMetadataCache>();

// Known DEX program IDs for detecting swaps
const DEX_PROGRAMS = new Set([
  DEX_PROGRAM_IDS.RAYDIUM_AMM,
  DEX_PROGRAM_IDS.RAYDIUM_CPMM,
  DEX_PROGRAM_IDS.JUPITER_V6,
  DEX_PROGRAM_IDS.ORCA_WHIRLPOOL,
  DEX_PROGRAM_IDS.PUMPFUN,
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', // Jupiter V4
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', // PumpSwap AMM
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CLMM
]);

interface WalletSubscription {
  walletAddress: string;
  chatId: string;
  subscriptionId: number;
  lastSignature?: string;
}

export class WalletMonitorService extends EventEmitter {
  private pollInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private txCache: Map<string, number> = new Map(); // signature -> timestamp (dedup)
  private connection: Connection;
  private wsConnection: Connection | null = null;
  private subscriptions: Map<string, WalletSubscription> = new Map(); // walletAddress -> subscription
  private useWebSocket: boolean = true;
  private reconnectAttempts: number = 0;
  private processingSignatures: Set<string> = new Set(); // Prevent duplicate processing

  constructor() {
    super();
    this.connection = solanaService.getConnection();
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    logger.info('WalletMonitor', 'Wallet monitoring started');

    // Try to start WebSocket monitoring
    await this.initializeWebSocket();

    // Start fallback polling (runs less frequently when WS is active)
    this.startFallbackPolling();
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Cleanup WebSocket subscriptions
    this.cleanupSubscriptions();

    this.isRunning = false;
    logger.info('WalletMonitor', 'Wallet monitoring stopped');
  }

  /**
   * Initialize WebSocket connection and subscriptions
   */
  private async initializeWebSocket(): Promise<void> {
    try {
      // Create a separate connection for WebSocket subscriptions
      // Let the library derive the WebSocket URL from the HTTP URL automatically
      this.wsConnection = new Connection(config.solanaRpcUrl, {
        commitment: 'confirmed',
      });

      // Subscribe to all tracked wallets
      await this.subscribeToAllWallets();

      this.useWebSocket = true;
      this.reconnectAttempts = 0;
      logger.info('WalletMonitor', 'WebSocket monitoring active - real-time alerts enabled');
    } catch (error) {
      logger.warn('WalletMonitor', `WebSocket initialization failed: ${(error as Error).message}`);
      this.useWebSocket = false;
      logger.info('WalletMonitor', 'Falling back to polling mode');
    }
  }

  /**
   * Subscribe to logs for all tracked wallets
   */
  private async subscribeToAllWallets(): Promise<void> {
    if (!this.wsConnection) return;

    const chatIds = storageService.getAllTrackedWalletChatIds();

    for (const chatId of chatIds) {
      const wallets = storageService.getTrackedWallets(chatId);
      for (const wallet of wallets) {
        await this.subscribeToWallet(wallet, chatId);
      }
    }
  }

  /**
   * Subscribe to a single wallet's transactions via WebSocket
   */
  private async subscribeToWallet(wallet: TrackedWallet, chatId: string): Promise<void> {
    if (!this.wsConnection) return;

    // Skip if already subscribed
    if (this.subscriptions.has(wallet.address)) return;

    try {
      const pubkey = new PublicKey(wallet.address);

      // Subscribe to logs mentioning this wallet
      const subscriptionId = this.wsConnection.onLogs(
        pubkey,
        (logs: Logs) => {
          this.handleWalletLogs(logs, wallet, chatId).catch((error) => {
            logger.silentError('WalletMonitor', `Unhandled error in logs handler for ${wallet.label}`, error as Error);
          });
        },
        'confirmed'
      );

      this.subscriptions.set(wallet.address, {
        walletAddress: wallet.address,
        chatId,
        subscriptionId,
        lastSignature: wallet.lastSignature,
      });

      logger.debug('WalletMonitor', `WebSocket subscribed to ${wallet.label} (${wallet.address.slice(0, 8)}...)`);
    } catch (error) {
      logger.silentError('WalletMonitor', `Failed to subscribe to ${wallet.address.slice(0, 8)}...`, error as Error);
    }
  }

  /**
   * Handle incoming logs from WebSocket subscription
   */
  private async handleWalletLogs(logs: Logs, wallet: TrackedWallet, chatId: string): Promise<void> {
    try {
      // Skip if transaction had an error
      if (logs.err) return;

      const signature = logs.signature;

      // Skip if already processed
      if (this.txCache.has(signature) || this.processingSignatures.has(signature)) {
        return;
      }

      // Mark as processing to prevent duplicates
      this.processingSignatures.add(signature);

      // Small delay to let transaction finalize
      await this.sleep(WALLET_MONITOR.SIGNATURE_PROCESS_DELAY_MS);

      try {
        // Fetch full transaction details
        const tx = await this.connection.getParsedTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (tx) {
          const parsed = this.parseTransaction(tx, wallet.address);
          if (parsed) {
            // Check if we should alert for this transaction
            const shouldAlert = await this.shouldAlertForTransaction(parsed, wallet, chatId);
            if (shouldAlert) {
              await this.emitWalletAlert(wallet, parsed, chatId);
            }

            // Cache the signature
            this.txCache.set(signature, Date.now());

            // Update subscription's last signature
            const sub = this.subscriptions.get(wallet.address);
            if (sub) {
              sub.lastSignature = signature;
            }
          }
        }
      } finally {
        this.processingSignatures.delete(signature);
      }
    } catch (error) {
      this.processingSignatures.delete(logs.signature);
      logger.silentError('WalletMonitor', `Error handling logs for ${wallet.label}`, error as Error);
    }
  }

  /**
   * Check if we should alert for this transaction
   */
  private async shouldAlertForTransaction(tx: WalletTransaction, wallet: TrackedWallet, chatId: string): Promise<boolean> {
    const settings = storageService.getUserSettings(chatId);

    // Check if alerts are enabled
    if (!settings.filters.alertsEnabled) return false;

    // Check if wallet_activity category is enabled
    const walletAlertEnabled = settings.filters.alertCategories?.wallet_activity ?? true;
    if (!walletAlertEnabled) return false;

    // Check quiet hours
    if (storageService.isQuietHours(chatId)) return false;

    // Check priority level
    const alertPriority = DEFAULT_CATEGORY_PRIORITIES.wallet_activity;
    if (!storageService.shouldAlertForPriority(chatId, alertPriority)) return false;

    // Check minimum SOL threshold
    const minSolValue = settings.filters.walletAlertMinSol || 0;
    if (minSolValue > 0 && tx.solAmount && tx.solAmount < minSolValue) {
      logger.debug('WalletMonitor', `Skipping: below min SOL threshold (${tx.solAmount} < ${minSolValue})`);
      return false;
    }

    // Check cooldown for this wallet
    const now = Date.now();
    if (wallet.lastAlertedAt && now - wallet.lastAlertedAt < WALLET_MONITOR.ALERT_COOLDOWN_MS) {
      logger.debug('WalletMonitor', `Skipping: cooldown active for ${wallet.label}`);
      return false;
    }

    return true;
  }

  /**
   * Emit wallet activity alert
   */
  private async emitWalletAlert(wallet: TrackedWallet, tx: WalletTransaction, chatId: string): Promise<void> {
    const alert: WalletActivityAlert = {
      wallet,
      transaction: tx,
      chatId,
    };

    logger.info('WalletMonitor', `[REAL-TIME] ${wallet.label} ${tx.type} ${tx.tokenMint.slice(0, 8)}...`);
    this.emit('walletActivity', alert);

    // Update last alerted time
    storageService.updateTrackedWallet(chatId, wallet.address, {
      lastAlertedAt: Date.now(),
      lastSignature: tx.signature,
    });
  }

  /**
   * Cleanup all WebSocket subscriptions
   */
  private cleanupSubscriptions(): void {
    if (!this.wsConnection) return;

    for (const [address, sub] of this.subscriptions) {
      try {
        this.wsConnection.removeOnLogsListener(sub.subscriptionId);
        logger.debug('WalletMonitor', `Unsubscribed from ${address.slice(0, 8)}...`);
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    this.subscriptions.clear();
  }

  /**
   * Start fallback polling (less frequent when WebSocket is active)
   */
  private startFallbackPolling(): void {
    // Clear existing interval if any
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    // Poll less frequently when WebSocket is active
    const interval = this.useWebSocket ? WALLET_MONITOR.FALLBACK_POLL_INTERVAL_MS * 2 : WALLET_MONITOR.FALLBACK_POLL_INTERVAL_MS;

    this.pollInterval = setInterval(
      () => this.checkAllWalletsFallback(),
      interval
    );

    logger.debug('WalletMonitor', `Fallback polling started (interval: ${interval / 1000}s)`);
  }

  /**
   * Fallback polling check for all wallets
   */
  private async checkAllWalletsFallback(): Promise<void> {
    try {
      const chatIds = storageService.getAllTrackedWalletChatIds();
      if (chatIds.length === 0) return;

      // Cleanup old cache entries
      this.cleanupTxCache();

      // Check if we need to refresh subscriptions
      await this.refreshSubscriptionsIfNeeded();

      // Only do full polling if WebSocket is down
      if (!this.useWebSocket) {
        logger.debug('WalletMonitor', `Fallback polling ${chatIds.length} chats`);
        for (const chatId of chatIds) {
          try {
            await this.checkWalletsForChat(chatId);
          } catch (error) {
            logger.silentError('WalletMonitor', `Error checking wallets for ${chatId}`, error as Error);
          }
        }
      }
    } catch (error) {
      logger.silentError('WalletMonitor', 'Error in fallback polling', error as Error);
    }
  }

  /**
   * Refresh WebSocket subscriptions if wallets have changed
   */
  private async refreshSubscriptionsIfNeeded(): Promise<void> {
    if (!this.useWebSocket || !this.wsConnection) return;

    const chatIds = storageService.getAllTrackedWalletChatIds();
    const currentWallets = new Set<string>();

    // Collect all current wallets
    for (const chatId of chatIds) {
      const wallets = storageService.getTrackedWallets(chatId);
      for (const wallet of wallets) {
        currentWallets.add(wallet.address);

        // Subscribe if not already subscribed
        if (!this.subscriptions.has(wallet.address)) {
          await this.subscribeToWallet(wallet, chatId);
        }
      }
    }

    // Unsubscribe from removed wallets
    for (const [address, sub] of this.subscriptions) {
      if (!currentWallets.has(address)) {
        try {
          this.wsConnection.removeOnLogsListener(sub.subscriptionId);
          this.subscriptions.delete(address);
          logger.debug('WalletMonitor', `Unsubscribed from removed wallet ${address.slice(0, 8)}...`);
        } catch (error) {
          // Ignore
        }
      }
    }
  }

  private async checkWalletsForChat(chatId: string): Promise<void> {
    const settings = storageService.getUserSettings(chatId);

    // Check if wallet_activity alerts are enabled
    if (!settings.filters.alertsEnabled) return;
    const walletAlertEnabled = settings.filters.alertCategories?.wallet_activity ?? true;
    if (!walletAlertEnabled) return;

    // Check quiet hours
    if (storageService.isQuietHours(chatId)) return;

    // Check priority level
    const alertPriority = DEFAULT_CATEGORY_PRIORITIES.wallet_activity;
    if (!storageService.shouldAlertForPriority(chatId, alertPriority)) return;

    const wallets = storageService.getTrackedWallets(chatId);
    const minSolValue = settings.filters.walletAlertMinSol || 0;

    for (const wallet of wallets) {
      try {
        const transactions = await this.fetchWalletTransactions(wallet);

        for (const tx of transactions) {
          // Skip if below minimum SOL threshold
          if (minSolValue > 0 && tx.solAmount && tx.solAmount < minSolValue) {
            continue;
          }

          // Check cooldown for this wallet
          const now = Date.now();
          if (wallet.lastAlertedAt && now - wallet.lastAlertedAt < WALLET_MONITOR.ALERT_COOLDOWN_MS) {
            continue;
          }

          await this.emitWalletAlert(wallet, tx, chatId);
        }

        // Update last checked time
        const latestSig = transactions[0]?.signature;
        storageService.updateTrackedWallet(chatId, wallet.address, {
          lastChecked: Date.now(),
          ...(latestSig ? { lastSignature: latestSig } : {}),
        });
      } catch (error) {
        logger.silentError('WalletMonitor', `Error checking wallet ${wallet.address.slice(0, 8)}...`, error as Error);
      }
    }
  }

  private async fetchWalletTransactions(wallet: TrackedWallet): Promise<WalletTransaction[]> {
    const transactions: WalletTransaction[] = [];

    try {
      const pubkey = new PublicKey(wallet.address);

      // Get recent signatures
      const signatures = await this.connection.getSignaturesForAddress(pubkey, {
        limit: WALLET_MONITOR.MAX_SIGNATURES_PER_WALLET,
      });

      // Filter to signatures after lastSignature
      const newSignatures = this.filterNewSignatures(signatures, wallet.lastSignature);

      if (newSignatures.length === 0) return [];

      // Batch fetch transaction details
      for (const sig of newSignatures.slice(0, 10)) {
        // Skip if already processed
        if (this.txCache.has(sig.signature)) continue;

        try {
          const tx = await this.connection.getParsedTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          });

          if (tx) {
            const parsed = this.parseTransaction(tx, wallet.address);
            if (parsed) {
              transactions.push(parsed);
              this.txCache.set(sig.signature, Date.now());
            }
          }
        } catch (error) {
          // Skip failed transaction fetches
        }
      }
    } catch (error) {
      logger.silentError('WalletMonitor', `Error fetching transactions for ${wallet.address.slice(0, 8)}...`, error as Error);
    }

    return transactions;
  }

  private filterNewSignatures(
    signatures: ConfirmedSignatureInfo[],
    lastSignature?: string
  ): ConfirmedSignatureInfo[] {
    if (!lastSignature) {
      // First time checking - only return most recent
      return signatures.slice(0, 3);
    }

    const newSigs: ConfirmedSignatureInfo[] = [];
    for (const sig of signatures) {
      if (sig.signature === lastSignature) break;
      newSigs.push(sig);
    }
    return newSigs;
  }

  private parseTransaction(
    tx: ParsedTransactionWithMeta,
    walletAddress: string
  ): WalletTransaction | null {
    try {
      if (!tx.meta || tx.meta.err) return null;

      const signature = tx.transaction.signatures[0];
      const timestamp = (tx.blockTime || Date.now() / 1000) * 1000;

      // Check if this is a swap transaction
      const isSwap = this.isSwapTransaction(tx);

      if (isSwap) {
        return this.parseSwapTransaction(tx, walletAddress, signature, timestamp);
      }

      // Check for simple token transfers
      return this.parseTransferTransaction(tx, walletAddress, signature, timestamp);
    } catch (error) {
      return null;
    }
  }

  private isSwapTransaction(tx: ParsedTransactionWithMeta): boolean {
    const instructions = tx.transaction.message.instructions;

    for (const ix of instructions) {
      if ('programId' in ix) {
        const programId = ix.programId.toBase58();
        if (DEX_PROGRAMS.has(programId)) {
          return true;
        }
      }
    }

    // Also check inner instructions
    const innerInstructions = tx.meta?.innerInstructions || [];
    for (const inner of innerInstructions) {
      for (const ix of inner.instructions) {
        if ('programId' in ix) {
          const programId = ix.programId.toBase58();
          if (DEX_PROGRAMS.has(programId)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private parseSwapTransaction(
    tx: ParsedTransactionWithMeta,
    walletAddress: string,
    signature: string,
    timestamp: number
  ): WalletTransaction | null {
    try {
      // Get pre and post token balances
      const preBalances = tx.meta?.preTokenBalances || [];
      const postBalances = tx.meta?.postTokenBalances || [];

      // Find token balance changes for the wallet
      const walletPreBalances = new Map<string, number>();
      const walletPostBalances = new Map<string, number>();

      for (const bal of preBalances) {
        if (bal.owner === walletAddress) {
          walletPreBalances.set(bal.mint, bal.uiTokenAmount.uiAmount || 0);
        }
      }

      for (const bal of postBalances) {
        if (bal.owner === walletAddress) {
          walletPostBalances.set(bal.mint, bal.uiTokenAmount.uiAmount || 0);
        }
      }

      // Calculate balance changes
      const balanceChanges: { mint: string; change: number }[] = [];
      const allMints = new Set([...walletPreBalances.keys(), ...walletPostBalances.keys()]);

      for (const mint of allMints) {
        const pre = walletPreBalances.get(mint) || 0;
        const post = walletPostBalances.get(mint) || 0;
        const change = post - pre;

        if (Math.abs(change) > 0.000001) { // Filter dust
          balanceChanges.push({ mint, change });
        }
      }

      if (balanceChanges.length < 1) return null;

      // Determine transaction type
      // Look for the non-SOL token that changed
      const nonSolChange = balanceChanges.find(c => c.mint !== SOL_MINT);
      const solChange = balanceChanges.find(c => c.mint === SOL_MINT);

      if (!nonSolChange) return null;

      // Check SOL balance change (lamports)
      const preSOL = (tx.meta?.preBalances?.[0] || 0) / 1e9;
      const postSOL = (tx.meta?.postBalances?.[0] || 0) / 1e9;
      const solBalanceChange = postSOL - preSOL;

      // Determine buy or sell
      const isBuy = nonSolChange.change > 0;
      const type = isBuy ? 'buy' : 'sell';

      return {
        signature,
        timestamp,
        type,
        tokenMint: nonSolChange.mint,
        amount: Math.abs(nonSolChange.change),
        solAmount: Math.abs(solBalanceChange),
      };
    } catch (error) {
      return null;
    }
  }

  private parseTransferTransaction(
    tx: ParsedTransactionWithMeta,
    walletAddress: string,
    signature: string,
    timestamp: number
  ): WalletTransaction | null {
    try {
      // Look for token transfer instructions
      const instructions = tx.transaction.message.instructions;

      for (const ix of instructions) {
        if ('parsed' in ix && ix.program === 'spl-token') {
          const info = ix.parsed?.info;
          if (!info) continue;

          const isTransfer = ix.parsed.type === 'transfer' || ix.parsed.type === 'transferChecked';
          if (!isTransfer) continue;

          // Check if wallet is source or destination
          const isSource = info.authority === walletAddress || info.source === walletAddress;
          const isDestination = info.destination === walletAddress;

          if (!isSource && !isDestination) continue;

          // Get token mint from the instruction or balances
          let tokenMint = info.mint;
          if (!tokenMint) {
            // Try to find from token balances
            const balances = tx.meta?.postTokenBalances || [];
            const relevant = balances.find(b => b.owner === walletAddress);
            tokenMint = relevant?.mint;
          }

          if (!tokenMint) continue;

          // Skip WSOL transfers
          if (tokenMint === SOL_MINT) continue;

          const amount = info.tokenAmount?.uiAmount || parseFloat(info.amount || '0');

          return {
            signature,
            timestamp,
            type: 'transfer',
            tokenMint,
            amount: Math.abs(amount),
          };
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  private cleanupTxCache(): void {
    const now = Date.now();
    for (const [sig, timestamp] of this.txCache) {
      if (now - timestamp > WALLET_MONITOR.TX_CACHE_TTL_MS) {
        this.txCache.delete(sig);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isActive(): boolean {
    return this.isRunning;
  }

  isWebSocketActive(): boolean {
    return this.useWebSocket && this.subscriptions.size > 0;
  }

  getStats(): {
    trackedWallets: number;
    cachedTransactions: number;
    wsSubscriptions: number;
    mode: 'websocket' | 'polling';
  } {
    let totalWallets = 0;
    const chatIds = storageService.getAllTrackedWalletChatIds();
    for (const chatId of chatIds) {
      totalWallets += storageService.getTrackedWallets(chatId).length;
    }

    return {
      trackedWallets: totalWallets,
      cachedTransactions: this.txCache.size,
      wsSubscriptions: this.subscriptions.size,
      mode: this.useWebSocket ? 'websocket' : 'polling',
    };
  }

  // Add a wallet subscription dynamically
  async addWalletSubscription(wallet: TrackedWallet, chatId: string): Promise<void> {
    if (this.useWebSocket && this.wsConnection) {
      await this.subscribeToWallet(wallet, chatId);
    }
  }

  // Remove a wallet subscription dynamically
  removeWalletSubscription(walletAddress: string): void {
    const sub = this.subscriptions.get(walletAddress);
    if (sub && this.wsConnection) {
      try {
        this.wsConnection.removeOnLogsListener(sub.subscriptionId);
        this.subscriptions.delete(walletAddress);
        logger.debug('WalletMonitor', `Removed subscription for ${walletAddress.slice(0, 8)}...`);
      } catch (error) {
        // Ignore
      }
    }
  }

  // Fetch recent activity for a wallet (for /wallet command)
  async getRecentActivity(walletAddress: string, limit: number = 10): Promise<WalletTransaction[]> {
    const transactions: WalletTransaction[] = [];

    try {
      const pubkey = new PublicKey(walletAddress);
      const signatures = await this.connection.getSignaturesForAddress(pubkey, { limit });

      for (const sig of signatures) {
        try {
          const tx = await this.connection.getParsedTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          });

          if (tx) {
            const parsed = this.parseTransaction(tx, walletAddress);
            if (parsed) {
              transactions.push(parsed);
            }
          }
        } catch {
          // Skip failed fetches
        }
      }
    } catch (error) {
      logger.silentError('WalletMonitor', `Error getting activity for ${walletAddress.slice(0, 8)}...`, error as Error);
    }

    return transactions;
  }

  // Enrich transaction with token metadata
  async enrichTransaction(tx: WalletTransaction): Promise<WalletTransaction> {
    const mint = tx.tokenMint;

    // Check cache first
    const cached = tokenMetadataCache.get(mint);
    if (cached && Date.now() - cached.cachedAt < WALLET_MONITOR.METADATA_CACHE_TTL_MS) {
      tx.tokenSymbol = cached.symbol;
      tx.tokenName = cached.name;
      if (cached.priceUsd && tx.amount) {
        tx.priceUsd = cached.priceUsd * tx.amount;
      }
      return tx;
    }

    // Try DexScreener first
    try {
      const dexData = await dexScreenerService.getTokenData(mint);
      if (dexData?.baseToken) {
        tx.tokenSymbol = dexData.baseToken.symbol;
        tx.tokenName = dexData.baseToken.name;
        const price = dexData.priceUsd ? parseFloat(dexData.priceUsd) : undefined;
        if (price && tx.amount) {
          tx.priceUsd = price * tx.amount;
        }
        // Cache it
        tokenMetadataCache.set(mint, {
          symbol: dexData.baseToken.symbol,
          name: dexData.baseToken.name,
          priceUsd: price,
          cachedAt: Date.now(),
        });
        return tx;
      }
    } catch {
      // Try next source
    }

    // Try Jupiter token list
    try {
      const jupResponse = await axios.get(`https://price.jup.ag/v6/price?ids=${mint}`, { timeout: 5000 });
      if (jupResponse.data?.data?.[mint]) {
        const jupData = jupResponse.data.data[mint];
        const tokenInfo = await solanaService.getTokenInfo(mint);
        tx.tokenSymbol = tokenInfo?.symbol || mint.slice(0, 6);
        tx.tokenName = tokenInfo?.name || 'Unknown';
        if (jupData.price && tx.amount) {
          tx.priceUsd = jupData.price * tx.amount;
        }
        tokenMetadataCache.set(mint, {
          symbol: tx.tokenSymbol,
          name: tx.tokenName,
          priceUsd: jupData.price,
          cachedAt: Date.now(),
        });
        return tx;
      }
    } catch {
      // Try next source
    }

    // Fallback: on-chain metadata
    try {
      const tokenInfo = await solanaService.getTokenInfo(mint);
      if (tokenInfo) {
        tx.tokenSymbol = tokenInfo.symbol;
        tx.tokenName = tokenInfo.name;
        tokenMetadataCache.set(mint, {
          symbol: tokenInfo.symbol,
          name: tokenInfo.name,
          cachedAt: Date.now(),
        });
      }
    } catch {
      // Last resort: use truncated mint
      tx.tokenSymbol = mint.slice(0, 6);
      tx.tokenName = 'Unknown Token';
    }

    return tx;
  }

  // Clear metadata cache (for testing)
  clearMetadataCache(): void {
    tokenMetadataCache.clear();
  }
}

export const walletMonitorService = new WalletMonitorService();
