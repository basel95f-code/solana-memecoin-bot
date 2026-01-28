/**
 * Supabase Client Setup
 * Centralized Supabase client configuration for PostgreSQL database
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';
import dotenv from 'dotenv';

dotenv.config();

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Connection pool configuration
const POOL_CONFIG = {
  auth: {
    persistSession: false, // Don't persist sessions (bot doesn't need user sessions)
  },
  global: {
    headers: {
      'x-client-info': 'solana-memecoin-bot/1.0.0',
    },
  },
};

/**
 * Supabase client instance (singleton)
 */
let supabaseClient: SupabaseClient | null = null;

/**
 * Get or create Supabase client
 * Uses service role key for full database access
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) {
    return supabaseClient;
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY ||
      SUPABASE_URL.includes('placeholder') || SUPABASE_SERVICE_ROLE_KEY.includes('placeholder')) {
    logger.warn('Supabase', 'Supabase not configured - some features will be unavailable');
    return null;
  }

  supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POOL_CONFIG);

  logger.info('Supabase', `Connected to ${SUPABASE_URL}`);

  return supabaseClient;
}

/**
 * Get anon client (limited access)
 * Used for read-only operations where service role is not needed
 */
export function getSupabaseAnonClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env');
  }

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, POOL_CONFIG);
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const client = getSupabaseClient();
    if (!client) {
      logger.error('Supabase', 'Client not initialized');
      return false;
    }
    const { error } = await client.from('sync_metadata').select('count').single();

    if (error) {
      logger.error('Supabase', 'Connection test failed', error as Error);
      return false;
    }

    logger.info('Supabase', '✅ Connection test successful');
    return true;
  } catch (error) {
    logger.error('Supabase', 'Connection test failed', error as Error);
    return false;
  }
}

/**
 * Helper: Convert Unix timestamp (seconds) to ISO string for Supabase
 */
export function unixToISO(unixTimestamp: number): string {
  return new Date(unixTimestamp * 1000).toISOString();
}

/**
 * Helper: Convert ISO string to Unix timestamp (seconds)
 */
export function isoToUnix(isoString: string): number {
  return Math.floor(new Date(isoString).getTime() / 1000);
}

/**
 * Helper: Get current timestamp in ISO format
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Helper: Get current Unix timestamp (seconds)
 */
export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Close all Supabase connections
 */
export function closeSupabaseClient(): void {
  if (supabaseClient) {
    // Supabase client doesn't have explicit close, connections are managed by pool
    logger.info('Supabase', 'Client connections released');
    supabaseClient = null;
  }
}

/**
 * Health check
 */
export async function healthCheck(): Promise<{
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}> {
  try {
    const start = Date.now();
    const client = getSupabaseClient();
    if (!client) {
      return { healthy: false, error: 'Client not initialized' };
    }

    const { error } = await client.from('sync_metadata').select('count').limit(1);

    const latencyMs = Date.now() - start;

    if (error) {
      return {
        healthy: false,
        error: error.message,
      };
    }

    return {
      healthy: true,
      latencyMs,
    };
  } catch (error) {
    return {
      healthy: false,
      error: (error as Error).message,
    };
  }
}

export default getSupabaseClient;

// Convenience export for named import
export const supabase = getSupabaseClient();
