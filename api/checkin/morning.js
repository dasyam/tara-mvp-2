export const config = { runtime: 'edge' };
import { supabaseFromRequest } from '../_supabaseEdgeClient.js';

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let supabase;
  try { supabase = supabaseFromRequest(req); }
  catch (e) { return new Response(e.message, { status: 500 }); }

  let body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const { date = todayIST(), sleep_rating_1_5, completed_evening } = body || {};
  if (!sleep_rating_1_5 || !['done', 'partly', 'skipped'].includes(completed_evening)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid fields' }), { status: 422 });
  }

  const { data: { user }, error: uErr } = await supabase.auth.getUser();
  if (uErr || !user) return new Response('Unauthorized', { status: 401 });

  const { error: ciErr } = await supabase
    .from('daily_sleep_checkins')
    .upsert({ user_id: user.id, date, sleep_rating_1_5 }, { onConflict: 'user_id,date' });
  if (ciErr) return new Response(JSON.stringify({ error: ciErr.message }), { status: 400 });

  await supabase
    .from('evening_plans')
    .update({ completed_evening })
    .eq('user_id', user.id)
    .eq('date', date);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
