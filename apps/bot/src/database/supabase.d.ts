/**
 * Supabase Client Setup
 * Centralized Supabase client configuration for PostgreSQL database
 */
import { SupabaseClient } from '@supabase/supabase-js';
/**
 * Get or create Supabase client
 * Uses service role key for full database access
 */
export declare function getSupabaseClient(): SupabaseClient;
/**
 * Get anon client (limited access)
 * Used for read-only operations where service role is not needed
 */
export declare function getSupabaseAnonClient(): SupabaseClient;
/**
 * Test database connection
 */
export declare function testConnection(): Promise<boolean>;
/**
 * Helper: Convert Unix timestamp (seconds) to ISO string for Supabase
 */
export declare function unixToISO(unixTimestamp: number): string;
/**
 * Helper: Convert ISO string to Unix timestamp (seconds)
 */
export declare function isoToUnix(isoString: string): number;
/**
 * Helper: Get current timestamp in ISO format
 */
export declare function nowISO(): string;
/**
 * Helper: Get current Unix timestamp (seconds)
 */
export declare function nowUnix(): number;
/**
 * Close all Supabase connections
 */
export declare function closeSupabaseClient(): void;
/**
 * Health check
 */
export declare function healthCheck(): Promise<{
    healthy: boolean;
    latencyMs?: number;
    error?: string;
}>;
export default getSupabaseClient;
//# sourceMappingURL=supabase.d.ts.map