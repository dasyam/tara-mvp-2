// api/computeDelta.js
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { mapUserGoalToCanonical, canonicalOrMixed } from '../src/lib/delta/goalMap.js';
import { normalizeAnchors } from '../src/lib/delta/normalizeAnchors.js';
import { computeTop3 } from '../src/lib/delta/computeTop3.js';

const ENGINE_VERSION = 'v1.0';

// Load ideal map without ESM JSON assert (works in CJS)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const idealPath = path.join(process.cwd(), 'src', 'data', 'ideal-sleep.json');
let idealMap = [];
try {
  idealMap = JSON.parse(fs.readFileSync(idealPath, 'utf-8'));
} catch (e) {
  console.error('Failed to load ideal-sleep.json at', idealPath, e);
}

// Env with fallback to VITE_ names
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).json({ error: 'Missing Supabase env', detail: 'Set SUPABASE_URL & SUPABASE_ANON_KEY (or VITE_ equivalents).' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Missing auth token' });
    return;
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      res.status(401).json({ error: 'Unauthorized', detail: userErr?.message });
      return;
    }

    // Latest timeline
    const { data: timelines, error: tErr } = await supabase
      .from('timelines').select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (tErr) { res.status(500).json({ error: 'DB timelines error', detail: tErr.message }); return; }
    if (!timelines?.length) { res.status(404).json({ error: 'No timeline found' }); return; }
    const timeline = timelines[0];

    // Profile
    const { data: profile, error: pErr } = await supabase
      .from('user_profile')
      .select('goal, has_kids, shift_worker')
      .eq('user_id', user.id).single();
    if (pErr) { res.status(500).json({ error: 'DB profile error', detail: pErr.message }); return; }

    // Canonical goal
    const canonicalGoal = canonicalOrMixed(mapUserGoalToCanonical(profile?.goal || 'mixed'));

    // Normalize anchors
    const rules = {
      night_block: '18:00-06:00',
      map_00_03_to_previous_night: true,
      window_midpoint_delta: true,
      same_episode_grace_mins: 90,
      rollover_flag_key: 'rollover_anomaly'
    };
    const norm = normalizeAnchors(timeline.timeline_json || {}, rules);

    // Compute
    const userContext = { has_kids: !!profile?.has_kids, shift_worker: !!profile?.shift_worker };
    const { top3_json, opportunity_scores, usedFallback } = computeTop3({
      normalized: norm,
      canonical_goal: canonicalGoal,
      ideal_map: idealMap,
      user_context: userContext,
      engine_version: ENGINE_VERSION
    });

    // Persist run
    const { error: eErr } = await supabase.from('engine_runs').insert({
      user_id: user.id,
      timeline_id: timeline.id,
      engine_version: ENGINE_VERSION,
      goal: canonicalGoal,
      top3_json,
      opportunity_scores
    });
    if (eErr) { res.status(500).json({ error: 'Insert engine_runs failed', detail: eErr.message }); return; }

    // Upsert rituals
    const palette = { sleep:'#8B5CF6', food:'#F59E0B', mind:'#06B6D4', movement:'#22C55E' };
    const timeBlockBySystem = b => (b==='Morning'||b==='Day'||b==='Evening') ? b : 'Night';

    for (const r of top3_json) {
      const category = (r.category || 'sleep').toLowerCase();
      const name = r.ritual_name;
      const payload = {
        user_id: user.id,
        name,
        tagline: r.how_to || '',
        category: category.charAt(0).toUpperCase() + category.slice(1),
        time_block: timeBlockBySystem(r.system_block),
        color: palette[category] || '#8B5CF6',
        active: true
      };
      await supabase.from('rituals').upsert(payload, { onConflict: 'user_id,category,time_block,name' });
    }

    res.status(200).json({
      engine_version: ENGINE_VERSION,
      top3_json,
      opportunity_scores,
      fallback_used: usedFallback === true
    });
  } catch (e) {
    res.status(500).json({ error: 'Unhandled', detail: String(e) });
  }
}
