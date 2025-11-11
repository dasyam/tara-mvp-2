// api/_lib/supabaseEdge.js
import { createClient } from '@supabase/supabase-js';
import { supabaseFromRequest as _supabaseFromRequest } from '../_supabaseEdgeClient.js';

/**
 * RLS client bound to caller's Bearer token (uses anon key).
 * Thin wrapper re-export so routes only import from _lib/ going forward.
 */
export function supabaseFromRequest(req) {
  return _supabaseFromRequest(req);
}

/**
 * Service-role client for trusted server ops (no RLS).
 * NEVER expose this to the browser. Requires SUPABASE_SERVICE_ROLE_KEY.
 */
export function getServiceClient() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL;

  const service =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !service) {
    throw new Error('Supabase env missing: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { apikey: service } }
  });
}

/**
 * Extract the authenticated user from the incoming JWT using the anon client.
 * Throws { code, message } on failure.
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

  if (!url || !anon) {
    throw { code: 'CONFIG', message: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY' };
  }

  const authHeader =
    req.headers.get('authorization') ||
    req.headers.get('Authorization') ||
    '';

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) throw { code: 'UNAUTHORIZED', message: 'Missing Authorization Bearer token' };

  const anonClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { apikey: anon, Authorization: `Bearer ${token}` } }
  });

  const { data, error } = await anonClient.auth.getUser();
  if (error || !data?.user) throw { code: 'UNAUTHORIZED', message: 'Invalid or expired session' };
  return data.user;
}
