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

function todayISTISO() {
  const d = new Date();
  const str = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
  return str;
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const supabase = supabaseFromReq(req);

  let body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const {
    date = todayISTISO(),
    trigger_time_anchor,
    trigger_place,
    trigger_mood,
    shield_type,
    shield_time,
    divert_ritual,
    started_now = false
  } = body || {};

  if (!shield_type || !shield_time || !divert_ritual || !trigger_mood) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 422 });
  }

  // Fetch user id from auth
  const { data: { user }, error: uErr } = await supabase.auth.getUser();
  if (uErr || !user) return new Response('Unauthorized', { status: 401 });

  // Upsert plan for date
  const insert = {
    user_id: user.id,
    date,
    trigger_time_anchor,
    trigger_place,
    trigger_mood,
    shield_type,
    shield_time,
    divert_ritual,
    started_now,
    armed_at: started_now ? new Date().toISOString() : null
  };

  // Use upsert on unique(user_id, date)
  const { data, error } = await supabase
    .from('evening_plans')
    .upsert(insert, { onConflict: 'user_id,date' })
    .select('id,date')
    .single();

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });

  return new Response(JSON.stringify({ plan_id: data.id, date: data.date }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
