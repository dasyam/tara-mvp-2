export const config = { runtime: 'edge' };
import { supabaseFromRequest } from '../_supabaseEdgeClient.js';

/** YYYY-MM-DD in IST for "now" (or given Date) */
function isoDateIST(d = new Date()) {
  return new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
/** Previous calendar day in IST, given YYYY-MM-DD */
function prevDateIST(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // shift to IST wall time, subtract a day, then read back as IST date
  const istNow = new Date(dt.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  istNow.setDate(istNow.getDate() - 1);
  return isoDateIST(istNow);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  // 1) Supabase client (preserves auth from request)
  let supabase;
  try {
    supabase = supabaseFromRequest(req);
  } catch (e) {
    return json({ error: e?.message || 'Supabase init failed' }, 500);
  }

  // 2) Parse & validate body
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  const {
    // FE can send date; default to "today in IST"
    date = isoDateIST(),
    sleep_rating_1_5,
    completed_evening,
  } = body || {};

  const rating = Number(sleep_rating_1_5);
  const allowedOutcome = new Set(['done', 'partly', 'skipped']);

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return json({ error: 'sleep_rating_1_5 must be an integer between 1 and 5' }, 422);
  }
  if (!allowedOutcome.has(completed_evening)) {
    return json({ error: "completed_evening must be 'done' | 'partly' | 'skipped'" }, 422);
  }

  // 3) Auth (RLS requires auth.uid() = user_id)
  const { data: userRes, error: uErr } = await supabase.auth.getUser();
  if (uErr || !userRes?.user) return json({ error: 'Unauthorized' }, 401);
  const user = userRes.user;

  // 4) Upsert morning check-in → daily_sleep_checkins
  const { error: ciErr } = await supabase
    .from('daily_sleep_checkins')
    .upsert(
      [{ user_id: user.id, date, sleep_rating_1_5: rating }],
      { onConflict: 'user_id,date' }
    );

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

  // 5) Close the evening plan → evening_plans.completed_evening
  // Try with provided date first; if no row was touched, try previous IST date (common morning flow).
  const tryUpdate = async (ymd) => {
    const { data, error } = await supabase
      .from('evening_plans')
      .update({ completed_evening })
      .eq('user_id', user.id)
      .eq('date', ymd)
      .select('id'); // returns updated rows if any
    return { rows: Array.isArray(data) ? data.length : 0, error };
  };

  let usedDate = date;
  let { rows, error: updErr } = await tryUpdate(date);

  if (!updErr && rows === 0) {
    // No plan on provided date; try last night in IST
    const prev = prevDateIST(date);
    const res2 = await tryUpdate(prev);
    usedDate = res2.error ? usedDate : (res2.rows > 0 ? prev : usedDate);
    rows = res2.rows;
    updErr = res2.error || updErr;
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

  // If neither date matched, we still return 200 (check-in saved),
  // but surface a soft warning so you can backfill later if needed.
  const warning =
    rows === 0
      ? 'No evening_plans row matched for provided or previous IST date; saved morning check-in only.'
      : undefined;

  return json({ ok: true, closed_evening_for: rows > 0 ? usedDate : null, warning });
}
