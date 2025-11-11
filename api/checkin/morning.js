// api/checkin/morning.js
export const config = { runtime: 'edge' };
import { supabaseFromRequest } from '../_lib/supabaseEdge.js';

/** IST date as YYYY-MM-DD for a Date (default: now) */
function isoDateIST(d = new Date()) {
  return new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
/** Previous IST date (YYYY-MM-DD -> YYYY-MM-DD) */
function prevDateIST(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const ist = new Date(dt.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  ist.setDate(ist.getDate() - 1);
  return isoDateIST(ist);
}
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  // 1) Supabase client (with forwarded Authorization header)
  let supabase;
  try {
    supabase = supabaseFromRequest(req);
  } catch (e) {
    return json({ error: e?.message || 'Supabase init failed' }, 500);
  }

  // 2) Parse JSON
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  // 3) Validate inputs
  const {
    date = isoDateIST(),             // optional, defaults to today IST
    sleep_rating_1_5,
    completed_evening,               // 'done' | 'partly' | 'skipped'
  } = body || {};

  const rating = Number(sleep_rating_1_5);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return json({ error: 'sleep_rating_1_5 must be an integer between 1 and 5' }, 422);
  }
  const ALLOWED = new Set(['done', 'partly', 'skipped']);
  if (!ALLOWED.has(completed_evening)) {
    return json({ error: "completed_evening must be 'done' | 'partly' | 'skipped'" }, 422);
  }

  // 4) Auth (required for RLS)
  const { data: userRes, error: uErr } = await supabase.auth.getUser();
  if (uErr || !userRes?.user) return json({ error: 'Unauthorized' }, 401);
  const user = userRes.user;

  // 5) Upsert morning check-in
  const { error: ciErr } = await supabase
    .from('daily_sleep_checkins')
    .upsert([{ user_id: user.id, date, sleep_rating_1_5: rating }], { onConflict: 'user_id,date' });

  if (ciErr) {
    return json(
      {
        error: 'daily_sleep_checkins upsert failed',
        message: ciErr.message,
        details: ciErr.details,
        hint: ciErr.hint,
        code: ciErr.code,
      },
      400
    );
  }

  // 6) Close the evening plan: try provided date first, then previous IST date
  const tryUpdate = async (ymd) => {
    const { data, error } = await supabase
      .from('evening_plans')
      .update({ completed_evening })
      .eq('user_id', user.id)
      .eq('date', ymd)
      .select('id'); // so we can count affected rows
    return { rows: Array.isArray(data) ? data.length : 0, error };
  };

  let usedDate = date;
  let { rows, error: updErr } = await tryUpdate(date);
  if (!updErr && rows === 0) {
    const prev = prevDateIST(date);
    const res2 = await tryUpdate(prev);
    if (!res2.error && res2.rows > 0) {
      usedDate = prev;
      rows = res2.rows;
    } else if (res2.error) {
      updErr = res2.error;
    }
  }
  if (updErr) {
    return json(
      {
        error: 'evening_plans update failed',
        message: updErr.message,
        details: updErr.details,
        hint: updErr.hint,
        code: updErr.code,
      },
      400
    );
  }

  const warning =
    rows === 0
      ? 'No evening_plans row matched for provided or previous IST date; saved morning check-in only.'
      : undefined;

  return json({ ok: true, closed_evening_for: rows > 0 ? usedDate : null, warning });
}
