import { createClient } from "@supabase/supabase-js";

let _client;

/**
 * Returns the singleton Supabase browser client.
 * Uses VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from env.
 */
export function getSupabase() {
  if (!_client) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!url || !anon) {
      console.warn("Supabase env vars missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
    }

    _client = createClient(url, anon);
  }
  return _client;
}

// Optional named export for convenience
export const supabase = getSupabase();
