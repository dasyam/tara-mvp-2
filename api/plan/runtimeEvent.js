export const config = { runtime: 'edge' };

import { createClient } from '@supabase/supabase-js';

function supabaseFromReq(req) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  const client = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, detectSessionInUrl: false }
  });
  return client;
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const supabase = supabaseFromReq(req);
  let body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const { plan_id, action, reason } = body || {};
  if (!plan_id || !action) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 422 });

  const { data: { user }, error: uErr } = await supabase.auth.getUser();
  if (uErr || !user) return new Response('Unauthorized', { status: 401 });

  // Fetch plan to ensure ownership
  const { data: plan, error: pErr } = await supabase
    .from('evening_plans')
    .select('id, user_id')
    .eq('id', plan_id)
    .single();

  if (pErr || !plan || plan.user_id !== user.id) return new Response('Not found', { status: 404 });

  let patch = {};
  if (action === 'shield_done') patch = { completed_evening: 'done' };
  if (action === 'shield_snooze') patch = {}; // handled client side by rescheduling
  if (action === 'shield_skip') patch = { completed_evening: 'skipped', skip_reason: reason || null };

  if (Object.keys(patch).length > 0) {
    const { error: upErr } = await supabase.from('evening_plans').update(patch).eq('id', plan_id);
    if (upErr) return new Response(JSON.stringify({ error: upErr.message }), { status: 400 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
