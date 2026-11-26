import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_PROJECT_ID = 'gapgwryagjpwpyxkcxck';
export const DEFAULT_SUPABASE_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co`;
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_K-OIqMYg7Q9Aju3jPdtFuA_q2Ee42ci';

let supabaseSingleton: SupabaseClient | null = null;

export function getSupabaseUrl(): string {
  const configured = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
  return configured || DEFAULT_SUPABASE_URL;
}

export function getSupabaseAnonKey(): string {
  const configured = String(
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      ''
  ).trim();
  return configured || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
}

export function hasSupabaseBackend(): boolean {
  return getSupabaseUrl().length > 0 && getSupabaseAnonKey().length > 0;
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!hasSupabaseBackend()) return null;
  if (!supabaseSingleton) {
    supabaseSingleton = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: {
          'x-client-info': 'pykachu-go-pwa',
        },
      },
    });
  }
  return supabaseSingleton;
}
