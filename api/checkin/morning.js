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

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const supabase = supabaseFromReq(req);
  let body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const {
    date = todayIST(),
    sleep_rating_1_5,
    completed_evening // 'done' | 'partly' | 'skipped'
  } = body || {};

  if (!sleep_rating_1_5 || !['done', 'partly', 'skipped'].includes(completed_evening)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid fields' }), { status: 422 });
  }

  const { data: { user }, error: uErr } = await supabase.auth.getUser();
  if (uErr || !user) return new Response('Unauthorized', { status: 401 });

  // Upsert checkin for date
  const { error: ciErr } = await supabase
    .from('daily_sleep_checkins')
    .upsert({ user_id: user.id, date, sleep_rating_1_5 }, { onConflict: 'user_id,date' });

  if (ciErr) return new Response(JSON.stringify({ error: ciErr.message }), { status: 400 });

  // Update evening plan completion if exists
  await supabase
    .from('evening_plans')
    .update({ completed_evening })
    .eq('user_id', user.id)
    .eq('date', date);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
