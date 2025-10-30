// api/computeDelta.js
// Vercel serverless function
// Requires env: SUPABASE_URL, SUPABASE_ANON_KEY
// Client must send Authorization: Bearer <supabase access token>

import { createClient } from '@supabase/supabase-js';
// import idealMap from '../src/data/ideal-sleep.json' assert { type: 'json' };
import { readFile } from 'node:fs/promises';
const cfg = JSON.parse(
  await readFile(new URL('../src/data/ideal-sleep.json', import.meta.url), 'utf-8')
);
import { mapUserGoalToCanonical, canonicalOrMixed } from '../src/lib/delta/goalMap.js';
import { normalizeAnchors } from '../src/lib/delta/normalizeAnchors.js';
import { computeTop3 } from '../src/lib/delta/computeTop3.js';

export const config = { runtime: 'nodejs20.x' };


const ENGINE_VERSION = 'v1.0';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' }); return;
  }

  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) { res.status(401).json({ error: 'Missing auth token' }); return; }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    // Resolve user
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const user_id = user.id;

    // Fetch latest timeline
    const { data: timelines, error: tErr } = await supabase
      .from('timelines').select('*').eq('user_id', user_id)
      .order('created_at', { ascending: false }).limit(1);

    if (tErr) { res.status(500).json({ error: 'DB timelines error' }); return; }
    if (!timelines || timelines.length === 0) {
      res.status(404).json({ error: 'No timeline found' }); return;
    }
    const timeline = timelines[0];

    // Fetch profile (goal + flags)
    const { data: profile, error: pErr } = await supabase
      .from('user_profile')
      .select('goal, has_kids, shift_worker')
      .eq('user_id', user_id).single();

    if (pErr) { res.status(500).json({ error: 'DB profile error' }); return; }

    // Canonical goal
    const canonicalGoal = canonicalOrMixed(mapUserGoalToCanonical(profile?.goal || 'mixed'));

    // Normalize anchors with time rules
    const rules = {
      night_block: '18:00-06:00',
      map_00_03_to_previous_night: true,
      window_midpoint_delta: true,
      same_episode_grace_mins: 90,
      rollover_flag_key: 'rollover_anomaly'
    };
    const norm = normalizeAnchors(timeline.timeline_json || {}, rules);

    // User context for effort overrides
    const userContext = {
      has_kids: !!profile?.has_kids,
      shift_worker: !!profile?.shift_worker
    };

    // Compute deterministic Top-3
    const { top3_json, opportunity_scores, usedFallback } = computeTop3({
      normalized: norm,
      canonical_goal: canonicalGoal,
      ideal_map: idealMap,
      user_context: userContext,
      engine_version: ENGINE_VERSION
    });

    // Persist engine run
    const insertPayload = {
      user_id,
      timeline_id: timeline.id,
      engine_version: ENGINE_VERSION,
      goal: canonicalGoal,
      top3_json,
      opportunity_scores
    };

    const { error: eErr } = await supabase.from('engine_runs').insert(insertPayload);
    if (eErr) { res.status(500).json({ error: 'Insert engine_runs failed' }); return; }

    // Upsert rituals (active=true) based on Top-3
    // Map system_block → time_block and category → palette
    const palette = {
      sleep: '#8B5CF6',
      food: '#F59E0B',
      mind: '#06B6D4',
      movement: '#22C55E'
    };

    const timeBlockBySystem = (b) => {
      if (b === 'Morning') return 'Morning';
      if (b === 'Day') return 'Day';
      if (b === 'Evening') return 'Evening';
      return 'Night';
    };

    for (const r of top3_json) {
      const { ritual_name, system_block, category = 'sleep', tagline, how_to } = r;
      const payload = {
        user_id,
        name: ritual_name,
        tagline: tagline || how_to || '',
        category: capitalize(categoryToEnum(category)),
        time_block: timeBlockBySystem(system_block),
        color: palette[categoryToEnum(category)] || '#8B5CF6',
        active: true
      };
      // Idempotent upsert via unique(user_id, category, time_block, name)
      const { error: upErr } = await supabase.from('rituals').upsert(payload, {
        onConflict: 'user_id,category,time_block,name'
      });
      if (upErr) { /* swallow to avoid failing whole request */ }
    }

    // Telemetry (best-effort)
    try {
      fetch('https://www.google-analytics.com/mp/collect', { method: 'POST', body: '' });
    } catch {}

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

function categoryToEnum(cat) {
  const c = (cat || '').toLowerCase();
  if (c.startsWith('food')) return 'food';
  if (c.startsWith('move')) return 'movement';
  if (c.startsWith('mind')) return 'mind';
  return 'sleep';
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
