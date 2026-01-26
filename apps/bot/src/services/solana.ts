import type {
  AccountInfo,
  ParsedAccountData
} from '@solana/web3.js';
import {
  Connection,
  PublicKey,
} from '@solana/web3.js';
import type {
  Mint
} from '@solana/spl-token';
import {
  getMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID
} from '@solana/spl-token';
import { config } from '../config';
import type { TokenInfo, TokenMetadata } from '../types';
import { withRetry, ResilientExecutor } from '../utils/retry';
import { logger } from '../utils/logger';
import axios from 'axios';

// Resilient executor for RPC calls with enhanced configuration
const rpcExecutor = new ResilientExecutor({
  circuitBreaker: { threshold: 10, resetTimeMs: 30000 },
  rateLimiter: { maxTokens: 20, refillRate: 5 },
  retry: {
    maxRetries: 3,
    initialDelayMs: 500,
    maxDelayMs: 15000,
    backoffMultiplier: 2,
    retryableErrors: [
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'ENOTFOUND',
      '429',
      '500',
      '502',
      '503',
      '504',
      'timeout',
      'network',
    ],
  },
});

class SolanaService {
  private connection: Connection;
  private wsConnection: Connection;

  constructor() {
    this.connection = new Connection(config.solanaRpcUrl, {
      commitment: 'confirmed',
      wsEndpoint: config.solanaWsUrl,
    });
    this.wsConnection = new Connection(config.solanaRpcUrl, {
      commitment: 'confirmed',
      wsEndpoint: config.solanaWsUrl,
    });
  }

  getConnection(): Connection {
    return this.connection;
  }

  getWsConnection(): Connection {
    return this.wsConnection;
  }

  async verifyConnection(): Promise<void> {
    try {
      const version = await rpcExecutor.execute(
        () => this.connection.getVersion(),
        'verifyConnection'
      );
      logger.info('Solana', `RPC connected: ${config.solanaRpcUrl}`);
      logger.info('Solana', `Version: ${version['solana-core']}`);
    } catch (error) {
      logger.error('Solana', `Failed to connect to RPC: ${(error as Error).message}`);
      throw new Error(`Unable to connect to Solana network. Please check your RPC endpoint.`);
    }
  }

  async getTokenInfo(mintAddress: string): Promise<TokenInfo | null> {
    try {
      // Validate address
      let mintPubkey: PublicKey;
      try {
        mintPubkey = new PublicKey(mintAddress);
      } catch {
        logger.warn('Solana', `Invalid token address: ${mintAddress}`);
        return null;
      }

      // Try Token Program first, then Token-2022, with retry logic
      const mint = await rpcExecutor.execute(async () => {
        try {
          return await getMint(this.connection, mintPubkey, 'confirmed', TOKEN_PROGRAM_ID);
        } catch {
          return await getMint(this.connection, mintPubkey, 'confirmed', TOKEN_2022_PROGRAM_ID);
        }
      }, `getMint:${mintAddress.slice(0, 8)}`);

      // Validate mint data
      if (!mint || typeof mint.decimals !== 'number' || mint.decimals < 0 || mint.decimals > 18) {
        logger.warn('Solana', `Invalid mint data for ${mintAddress}`);
        return null;
      }

      const metadata = await this.getTokenMetadata(mintAddress);

      return {
        mint: mintAddress,
        name: metadata?.name || 'Unknown',
        symbol: metadata?.symbol || 'UNKNOWN',
        decimals: mint.decimals,
        supply: Number(mint.supply) / Math.pow(10, mint.decimals),
        metadata: metadata ?? undefined,
      };
    } catch (error) {
      logger.error('Solana', `Failed to get token info for ${mintAddress}: ${(error as Error).message}`);
      return null;
    }
  }

  async getTokenMetadata(mintAddress: string): Promise<TokenMetadata | null> {
    try {
      // Try to fetch from Metaplex metadata with retry
      const metadataPDA = this.getMetadataPDA(mintAddress);
      const accountInfo = await rpcExecutor.execute(
        () => this.connection.getAccountInfo(metadataPDA),
        `getMetadata:${mintAddress.slice(0, 8)}`
      );

      if (accountInfo) {
        const metadata = this.parseMetadata(accountInfo.data);

        // Validate parsed metadata
        if (!metadata.name && !metadata.symbol) {
          logger.debug('Solana', `Invalid parsed metadata for ${mintAddress}`);
        } else {
          // If there's a URI, fetch additional metadata
          if (metadata.uri) {
            const extendedMetadata = await this.fetchMetadataUri(metadata.uri);
            return { ...metadata, ...extendedMetadata };
          }
          return metadata;
        }
      }

      // Fallback: try Jupiter token list
      const jupiterData = await this.getJupiterMetadata(mintAddress);
      if (jupiterData) {
        return jupiterData;
      }

      logger.debug('Solana', `No metadata found for ${mintAddress}`);
      return null;
    } catch (error) {
      logger.debug('Solana', `Failed to get metadata for ${mintAddress}: ${(error as Error).message}`);
      return null;
    }
  }

  private getMetadataPDA(mint: string): PublicKey {
    const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('metadata'),
        METADATA_PROGRAM_ID.toBuffer(),
        new PublicKey(mint).toBuffer(),
      ],
      METADATA_PROGRAM_ID
    );
    return pda;
  }

  private parseMetadata(data: Buffer): TokenMetadata {
    try {
      // Skip discriminator and update authority
      let offset = 1 + 32 + 32;

      // Read name
      const nameLength = data.readUInt32LE(offset);
      offset += 4;
      const name = data.slice(offset, offset + nameLength).toString('utf8').replace(/\0/g, '').trim();
      offset += nameLength;

      // Read symbol
      const symbolLength = data.readUInt32LE(offset);
      offset += 4;
      const symbol = data.slice(offset, offset + symbolLength).toString('utf8').replace(/\0/g, '').trim();
      offset += symbolLength;

      // Read URI
      const uriLength = data.readUInt32LE(offset);
      offset += 4;
      const uri = data.slice(offset, offset + uriLength).toString('utf8').replace(/\0/g, '').trim();

      return { name, symbol, uri };
    } catch {
      return { name: 'Unknown', symbol: 'UNKNOWN' };
    }
  }

  private async fetchMetadataUri(uri: string): Promise<Partial<TokenMetadata>> {
    try {
      // Validate URI
      if (!uri || typeof uri !== 'string' || uri.trim().length === 0) {
        return {};
      }

      // Handle IPFS URIs
      let fetchUri = uri;
      if (fetchUri.startsWith('ipfs://')) {
        fetchUri = `https://ipfs.io/ipfs/${fetchUri.slice(7)}`;
      }

      const response = await withRetry(
        () => axios.get(fetchUri, { timeout: 5000 }),
        { maxRetries: 2, initialDelayMs: 300 }
      );

      // Validate response data
      if (!response.data || typeof response.data !== 'object') {
        logger.debug('Solana', `Invalid metadata from URI: ${uri}`);
        return {};
      }

      const data = response.data;

      return {
        image: data.image || undefined,
        description: data.description || undefined,
        twitter: data.twitter || data.extensions?.twitter || undefined,
        telegram: data.telegram || data.extensions?.telegram || undefined,
        website: data.website || data.external_url || data.extensions?.website || undefined,
      };
    } catch (error) {
      logger.debug('Solana', `Failed to fetch metadata URI ${uri}: ${(error as Error).message}`);
      return {};
    }
  }

  private async getJupiterMetadata(mintAddress: string): Promise<TokenMetadata | null> {
    try {
      const response = await withRetry(
        () => axios.get(`https://token.jup.ag/strict`, { timeout: 10000 }),
        { maxRetries: 2, initialDelayMs: 500 }
      );

      const token = response.data.find((t: any) => t.address === mintAddress);
      if (token) {
        return {
          name: token.name,
          symbol: token.symbol,
          image: token.logoURI,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async getTokenHolders(mintAddress: string, limit: number = 20): Promise<Array<{ address: string; balance: number }>> {
    try {
      // Method 1: Use getTokenLargestAccounts (most reliable standard RPC method)
      const largestAccounts = await this.getTokenLargestAccountsRPC(mintAddress, limit);
      if (largestAccounts.length > 0) {
        return largestAccounts;
      }

      // Method 2: Try Helius DAS API
      const heliusHolders = await this.getTokenHoldersHelius(mintAddress, limit);
      if (heliusHolders.length > 0) {
        return heliusHolders;
      }

      // Method 3: Fallback to getParsedProgramAccounts (slowest, may timeout)
      const mintPubkey = new PublicKey(mintAddress);

      const accounts = await rpcExecutor.execute(
        () => this.connection.getParsedProgramAccounts(
          TOKEN_PROGRAM_ID,
          {
            filters: [
              { dataSize: 165 },
              { memcmp: { offset: 0, bytes: mintPubkey.toBase58() } },
            ],
          }
        ),
        `getHolders:${mintAddress.slice(0, 8)}`
      );

      const holders = accounts
        .map((account) => {
          const parsed = (account.account.data as ParsedAccountData).parsed;
          return {
            address: account.pubkey.toBase58(),
            balance: parsed.info.tokenAmount.uiAmount || 0,
          };
        })
        .filter((h) => h.balance > 0)
        .sort((a, b) => b.balance - a.balance)
        .slice(0, limit);

      return holders;
    } catch (error) {
      console.error(`Failed to get token holders for ${mintAddress}:`, error);
      return [];
    }
  }

  /**
   * Use standard Solana RPC getTokenLargestAccounts - most reliable method
   * Note: This returns token account addresses, we need to resolve owners
   */
  private async getTokenLargestAccountsRPC(mintAddress: string, limit: number = 20): Promise<Array<{ address: string; balance: number }>> {
    try {
      const mintPubkey = new PublicKey(mintAddress);
      const response = await this.connection.getTokenLargestAccounts(mintPubkey);

      if (response.value && response.value.length > 0) {
        // Need to get owner addresses for each token account
        const holders: Array<{ address: string; balance: number }> = [];

        // Batch fetch account info to get owners
        const accountPubkeys = response.value.slice(0, limit).map(acc => acc.address);
        const accountInfos = await this.connection.getMultipleParsedAccounts(accountPubkeys);

        for (let i = 0; i < accountInfos.value.length; i++) {
          const accountInfo = accountInfos.value[i];
          const largestAccount = response.value[i];

          if (accountInfo && accountInfo.data && 'parsed' in accountInfo.data) {
            const parsed = accountInfo.data.parsed;
            const owner = parsed?.info?.owner;
            const balance = parseFloat(largestAccount.uiAmountString || '0');

            if (owner && balance > 0) {
              holders.push({
                address: owner,
                balance: balance,
              });
            }
          }
        }

        return holders;
      }

      return [];
    } catch (error) {
      console.error(`getTokenLargestAccounts failed for ${mintAddress}:`, (error as Error).message);
      return [];
    }
  }

  /**
   * Get token holders using Helius DAS API (handles large datasets with pagination)
   * FIX #11: Added explicit logging when Helius API key not found
   */
  private async getTokenHoldersHelius(mintAddress: string, limit: number = 20): Promise<Array<{ address: string; balance: number }>> {
    try {
      // Extract API key from RPC URL (supports both query param and path formats)
      const apiKeyMatch = config.solanaRpcUrl.match(/api-key=([^&]+)/) || 
                          config.solanaRpcUrl.match(/\/([a-zA-Z0-9-]{32,})(?:\/|$)/);
      if (!apiKeyMatch) {
        // FIX #11: Log explicitly that Helius method is skipped due to missing API key
        logger.debug('Solana', 'Helius API key not found in RPC URL, skipping Helius holder lookup');
        return []; // Not using Helius, skip
      }

      const apiKey = apiKeyMatch[1];

      // First get token decimals
      const mintInfo = await this.getMintInfo(mintAddress);
      const decimals = mintInfo?.decimals ?? 6;

      // Use Helius REST API for token holders (more reliable)
      const response = await axios.get(
        `https://api.helius.xyz/v0/addresses/${mintAddress}/balances?api-key=${apiKey}`,
        { timeout: 15000 }
      );

      // If that doesn't work, try the RPC method with proper params
      if (!response.data?.tokens) {
        // Fallback: use getTokenLargestAccounts RPC method
        const rpcResponse = await axios.post(
          config.solanaRpcUrl,
          {
            jsonrpc: '2.0',
            id: 'largest-accounts',
            method: 'getTokenLargestAccounts',
            params: [mintAddress],
          },
          { timeout: 15000 }
        );

        if (rpcResponse.data?.result?.value) {
          const accounts = rpcResponse.data.result.value;
          return accounts
            .map((acc: any) => ({
              address: acc.address,
              balance: parseFloat(acc.uiAmountString) || (acc.amount / Math.pow(10, decimals)),
            }))
            .filter((h: any) => h.balance > 0)
            .sort((a: any, b: any) => b.balance - a.balance)
            .slice(0, limit);
        }
      }

      return [];
    } catch (error) {
      console.error(`Helius holder fetch failed for ${mintAddress}:`, (error as Error).message);
      return [];
    }
  }

  async getAccountBalance(address: string): Promise<number> {
    try {
      const pubkey = new PublicKey(address);
      const balance = await rpcExecutor.execute(
        () => this.connection.getBalance(pubkey),
        `getBalance:${address.slice(0, 8)}`
      );
      return balance / 1e9; // Convert lamports to SOL
    } catch {
      return 0;
    }
  }

  async getMintInfo(mintAddress: string): Promise<Mint | null> {
    try {
      const mintPubkey = new PublicKey(mintAddress);
      return await rpcExecutor.execute(async () => {
        try {
          return await getMint(this.connection, mintPubkey, 'confirmed', TOKEN_PROGRAM_ID);
        } catch {
          return await getMint(this.connection, mintPubkey, 'confirmed', TOKEN_2022_PROGRAM_ID);
        }
      }, `getMintInfo:${mintAddress.slice(0, 8)}`);
    } catch {
      return null;
    }
  }

  subscribeToProgram(
    programId: string,
    callback: (accountInfo: AccountInfo<Buffer>, pubkey: PublicKey) => void
  ): number {
    const programPubkey = new PublicKey(programId);
    return this.connection.onProgramAccountChange(
      programPubkey,
      (info) => callback(info.accountInfo, info.accountId),
      'confirmed'
    );
  }

  async unsubscribe(subscriptionId: number): Promise<void> {
    await this.connection.removeProgramAccountChangeListener(subscriptionId);
  }
}

export const solanaService = new SolanaService();
