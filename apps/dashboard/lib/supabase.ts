import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Lazy-create client only when needed (avoid build-time errors)
let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  // Only check env vars at runtime, not module load time
  if (typeof window === 'undefined') {
    // During SSR/build, return null
    return null;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  if (!_supabase) {
    _supabase = createClient(supabaseUrl, supabaseAnonKey);
  }
  return _supabase;
}

// Real-time subscription helpers
export function subscribeToDiscoveries(
  callback: (payload: any) => void
) {
  const client = getSupabase();
  if (!client) return null;
  return client
    .channel('pool_discovery_changes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'pool_discovery' },
      callback
    )
    .subscribe();
}

export function subscribeToAlerts(
  callback: (payload: any) => void
) {
  const client = getSupabase();
  if (!client) return null;
  return client
    .channel('alert_history_changes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'alert_history' },
      callback
    )
    .subscribe();
}

export function subscribeToBotStatus(
  callback: (payload: any) => void
) {
  const client = getSupabase();
  if (!client) return null;
  return client
    .channel('bot_status_changes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'bot_status' },
      callback
    )
    .subscribe();
}
