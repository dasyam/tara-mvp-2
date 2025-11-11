export const config = { runtime: 'edge' };
import { supabaseFromRequest } from '../_lib/supabaseEdge.js';

function todayISTISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let supabase;
  try { supabase = supabaseFromRequest(req); }
  catch (e) { return new Response(e.message, { status: 500 }); }

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

  const { data: { user }, error: uErr } = await supabase.auth.getUser();
  if (uErr || !user) return new Response('Unauthorized', { status: 401 });

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

  const { data, error } = await supabase
    .from('evening_plans')
    .upsert(insert, { onConflict: 'user_id,date' })
    .select('id,date')
    .single();

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });

  return new Response(JSON.stringify({ plan_id: data.id, date: data.date }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
