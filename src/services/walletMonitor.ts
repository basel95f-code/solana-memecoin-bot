import { EventEmitter } from 'events';
import { Connection, PublicKey, ParsedTransactionWithMeta, ConfirmedSignatureInfo } from '@solana/web3.js';
import axios from 'axios';
import { config } from '../config';
import { storageService } from './storage';
import { solanaService } from './solana';
import { dexScreenerService } from './dexscreener';
import { TrackedWallet, WalletTransaction, WalletActivityAlert, SOL_MINT, DEFAULT_CATEGORY_PRIORITIES } from '../types';
import { logger } from '../utils/logger';

// Token metadata cache
interface TokenMetadataCache {
  symbol: string;
  name: string;
  priceUsd?: number;
  cachedAt: number;
}
const tokenMetadataCache = new Map<string, TokenMetadataCache>();
const METADATA_CACHE_TTL = 300000; // 5 minutes

// Known DEX program IDs for detecting swaps
const RAYDIUM_AMM_V4 = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const RAYDIUM_CLMM = 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';
const JUPITER_V6 = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const JUPITER_V4 = 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB';
const ORCA_WHIRLPOOL = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
const PUMPFUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMPSWAP_AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';

const DEX_PROGRAMS = new Set([
  RAYDIUM_AMM_V4,
  RAYDIUM_CLMM,
  JUPITER_V6,
  JUPITER_V4,
  ORCA_WHIRLPOOL,
  PUMPFUN_PROGRAM,
  PUMPSWAP_AMM,
]);

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// Configuration
const POLL_INTERVAL_MS = 15000; // 15 seconds - faster alerts
const MAX_SIGNATURES_PER_WALLET = 20;
const TX_CACHE_TTL_MS = 300000; // 5 minutes
const ALERT_COOLDOWN_MS = 10000; // 10 seconds between alerts for same wallet

interface WalletMonitorConfig {
  enabled: boolean;
  pollIntervalMs: number;
}

export class WalletMonitorService extends EventEmitter {
  private pollInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private txCache: Map<string, number> = new Map(); // signature -> timestamp (dedup)
  private connection: Connection;

  constructor() {
    super();
    this.connection = solanaService.getConnection();
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    logger.info('WalletMonitor', 'Wallet monitoring started');

    // Initial check
    await this.checkAllWallets();

    // Set up periodic checks
    this.pollInterval = setInterval(
      () => this.checkAllWallets(),
      POLL_INTERVAL_MS
    );
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
    logger.info('WalletMonitor', 'Wallet monitoring stopped');
  }

  private async checkAllWallets(): Promise<void> {
    try {
      const chatIds = storageService.getAllTrackedWalletChatIds();
      if (chatIds.length === 0) return;

      logger.info('WalletMonitor', `Polling ${chatIds.length} chats with tracked wallets`);

      // Cleanup old cache entries
      this.cleanupTxCache();

      // Process each chat's wallets
      for (const chatId of chatIds) {
        try {
          await this.checkWalletsForChat(chatId);
        } catch (error) {
          logger.silentError('WalletMonitor', `Error checking wallets for ${chatId}`, error as Error);
        }
      }
    } catch (error) {
      logger.silentError('WalletMonitor', 'Error in checkAllWallets', error as Error);
    }
  }

  private async checkWalletsForChat(chatId: string): Promise<void> {
    const settings = storageService.getUserSettings(chatId);

    // Check if wallet_activity alerts are enabled
    if (!settings.filters.alertsEnabled) return;
    // Default to true if wallet_activity category not set (backward compatibility)
    const walletAlertEnabled = settings.filters.alertCategories?.wallet_activity ?? true;
    if (!walletAlertEnabled) return;

    // Check quiet hours
    if (storageService.isQuietHours(chatId)) return;

    // Check priority level
    const alertPriority = DEFAULT_CATEGORY_PRIORITIES.wallet_activity;
    if (!storageService.shouldAlertForPriority(chatId, alertPriority)) return;

    const wallets = storageService.getTrackedWallets(chatId);
    if (wallets.length > 0) {
      logger.info('WalletMonitor', `Checking ${wallets.length} wallets for chat ${chatId}`);
    }
    const minSolValue = settings.filters.walletAlertMinSol || 0;

    for (const wallet of wallets) {
      try {
        const transactions = await this.fetchWalletTransactions(wallet);
        if (transactions.length > 0) {
          logger.info('WalletMonitor', `Found ${transactions.length} new tx for ${wallet.label}`);
        }

        for (const tx of transactions) {
          logger.info('WalletMonitor', `Processing tx: ${tx.type} ${tx.tokenMint.slice(0,8)}... SOL: ${tx.solAmount || 'N/A'}`);

          // Skip if below minimum SOL threshold
          if (minSolValue > 0 && tx.solAmount && tx.solAmount < minSolValue) {
            logger.debug('WalletMonitor', `Skipping: below min SOL threshold`);
            continue;
          }

          // Check cooldown for this wallet
          const now = Date.now();
          if (wallet.lastAlertedAt && now - wallet.lastAlertedAt < ALERT_COOLDOWN_MS) {
            logger.debug('WalletMonitor', `Skipping: cooldown active`);
            continue;
          }

          // Emit alert event
          const alert: WalletActivityAlert = {
            wallet,
            transaction: tx,
            chatId,
          };

          logger.info('WalletMonitor', `Emitting wallet activity alert for ${wallet.label}`);
          this.emit('walletActivity', alert);

          // Update last alerted time
          storageService.updateTrackedWallet(chatId, wallet.address, {
            lastAlertedAt: now,
          });
        }

        // Update last checked time and signature
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
        limit: MAX_SIGNATURES_PER_WALLET,
      });

      // Filter to signatures after lastSignature
      const newSignatures = this.filterNewSignatures(signatures, wallet.lastSignature);

      if (newSignatures.length === 0) return [];

      // Batch fetch transaction details
      for (const sig of newSignatures.slice(0, 10)) { // Limit to 10 per poll
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
      if (now - timestamp > TX_CACHE_TTL_MS) {
        this.txCache.delete(sig);
      }
    }
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getStats(): { trackedWallets: number; cachedTransactions: number } {
    let totalWallets = 0;
    const chatIds = storageService.getAllTrackedWalletChatIds();
    for (const chatId of chatIds) {
      totalWallets += storageService.getTrackedWallets(chatId).length;
    }

    return {
      trackedWallets: totalWallets,
      cachedTransactions: this.txCache.size,
    };
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
    if (cached && Date.now() - cached.cachedAt < METADATA_CACHE_TTL) {
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
        // Jupiter price API doesn't have name/symbol, try token info
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
