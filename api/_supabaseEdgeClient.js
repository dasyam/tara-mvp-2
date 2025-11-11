// ❌ Remove this line from the helper file (keep it only in route files)
// export const config = { runtime: 'edge' };

import { createClient } from '@supabase/supabase-js';

/**
 * Create a Supabase client for Edge API routes.
 * Reads SUPABASE_URL / SUPABASE_ANON_KEY from env.
 * Forwards the caller's Bearer token for RLS (`auth.uid()`).
 */
export function supabaseFromRequest(req) {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL;

  const anon =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error('Supabase env missing: set SUPABASE_URL and SUPABASE_ANON_KEY');
  }

  // Headers on Vercel are case-insensitive; read both just in case.
  const authHeader =
    req.headers.get('authorization') ||
    req.headers.get('Authorization') ||
    '';

  return createClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        apikey: anon,
        // Pass through exactly as received (should already be "Bearer <jwt>")
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    },
  });
}
