export const config = { runtime: 'edge' };

import { createClient } from '@supabase/supabase-js';

/**
 * Create a Supabase client for Edge API routes.
 * Requires SUPABASE_URL and SUPABASE_ANON_KEY to be set in Vercel env.
 * Passes the user's Bearer token through for RLS.
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

  const token = req.headers.get('authorization')?.replace('Bearer ', '') || '';

  const client = createClient(url, anon, {
    global: {
      headers: {
        apikey: anon,
        Authorization: token ? `Bearer ${token}` : undefined
      }
    },
    auth: { persistSession: false, detectSessionInUrl: false }
  });

  return client;
}
