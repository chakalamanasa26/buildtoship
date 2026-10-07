import { createClient } from '@supabase/supabase-js';

// Read configuration from Vite or Next.js style environment variables
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  '';

const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabasePublishableKey &&
  supabaseUrl !== 'https://your-project.supabase.co'
);

if (!isSupabaseConfigured) {
  console.warn(
    '[MediVault] Supabase is not fully configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in your environment.'
  );
}

// Fallback dummy URL to prevent createClient from crashing if unconfigured
const clientUrl = isSupabaseConfigured ? supabaseUrl : 'https://dummy.supabase.co';
const clientKey = isSupabaseConfigured ? supabasePublishableKey : 'dummy-key';

export const supabase = createClient(clientUrl, clientKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
});
