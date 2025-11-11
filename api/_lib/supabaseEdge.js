// api/_lib/supabaseEdge.js
import { createClient } from '@supabase/supabase-js';

/**
 * Create a Supabase client for Edge routes with RLS (auth.uid()).
 * Reads SUPABASE_URL / SUPABASE_ANON_KEY and forwards caller's Bearer token.
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

  const authHeader =
    req.headers.get('authorization') ||
    req.headers.get('Authorization') ||
    '';

  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: {
        apikey: anon,
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    },
  });
}

/**
 * Service-role client for trusted server operations (no RLS).
 */
export function getServiceClient() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { apikey: key } },
  });
}

/**
 * Verify JWT and return current user from Authorization header.
 */
export async function getUserOrThrow(req) {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL;
  const anon =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  const authHeader =
    req.headers.get('authorization') ||
    req.headers.get('Authorization') ||
    '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) throw { code: 'UNAUTHORIZED', message: 'Missing Authorization Bearer token' };

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { apikey: anon, Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) throw { code: 'UNAUTHORIZED', message: 'Invalid or expired session' };
  return data.user;
}
