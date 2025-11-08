export const config = { runtime: 'edge' };
import { supabaseFromRequest } from '../_supabaseEdgeClient.js';

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let supabase;
  try { supabase = supabaseFromRequest(req); }
  catch (e) { return new Response(e.message, { status: 500 }); }

  let body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  const { plan_id, action, reason } = body || {};
  if (!plan_id || !action) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 422 });

  const { data: { user }, error: uErr } = await supabase.auth.getUser();
  if (uErr || !user) return new Response('Unauthorized', { status: 401 });

  const { data: plan, error: pErr } = await supabase
    .from('evening_plans')
    .select('id, user_id')
    .eq('id', plan_id)
    .single();

  if (pErr || !plan || plan.user_id !== user.id) return new Response('Not found', { status: 404 });

  let patch = {};
  if (action === 'shield_done') patch = { completed_evening: 'done' };
  if (action === 'shield_snooze') patch = {}; // client handles reschedule
  if (action === 'shield_skip') patch = { completed_evening: 'skipped', skip_reason: reason || null };

  if (Object.keys(patch).length > 0) {
    const { error: upErr } = await supabase.from('evening_plans').update(patch).eq('id', plan_id);
    if (upErr) return new Response(JSON.stringify({ error: upErr.message }), { status: 400 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
