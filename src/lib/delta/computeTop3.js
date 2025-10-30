// src/lib/delta/computeTop3.js

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function minutesFromBlockStr(block) {
  // "20-21" => mid = 20:30 => 1230 minutes
  const m = String(block).match(/^(\d{2})-(\d{2})$/);
  if (!m) return null;
  const h1 = parseInt(m[1], 10), h2 = parseInt(m[2], 10);
  const midH = (h1 + h2) / 2;
  return Math.round(midH * 60);
}

function opportunityScore({ impact, effort, goal_weight, timing_penalty }) {
  const effort_penalty = (effort - 1) * 0.15; // 0, .15, .30
  return (impact / 5) * goal_weight * (1 - timing_penalty) - effort_penalty;
}

function impactTag(impact, opp) {
  if (impact >= 5 || opp >= 0.75) return 'High';
  if (opp >= 0.5) return 'Medium';
  return 'Low';
}
function effortTag(effort) { return effort === 1 ? 'Low' : effort === 2 ? 'Medium' : 'High'; }

function systemBlockFromId(item) { return item.system_block || 'Night'; }

function applyEffortOverrides(effort, id, user_context) {
  let e = effort;
  if (user_context?.has_kids) {
    if (id === 'early_dinner' || id === 'fixed_bedtime') e += 1;
  }
  if (user_context?.shift_worker) {
    if (id === 'fixed_bedtime') e += 1;
    if (id === 'sunlight_time') e += 0;
  }
  return Math.min(3, e);
}

function conflictFilter(sorted, pairs) {
  if (!pairs || pairs.length === 0) return sorted;
  const suppress = new Set();
  const res = [];
  for (const item of sorted) {
    if (suppress.has(item.id)) continue;
    res.push(item);
    for (const rule of pairs) {
      if (item.id === rule.prefer) suppress.add(rule.suppress);
    }
  }
  return res;
}

export function computeTop3({ normalized, canonical_goal, ideal_map, user_context, engine_version }) {
  const anchors = normalized.anchors || {};
  const avgConf = normalized.avg_confidence || 0;

  // Fallback if parse confidence low
  if (avgConf < 0.6) {
    const fallback = ['dim_lights_2030', 'no_screens_60m', 'sunlight_30m']
      .map(id => {
        const item = ideal_map.find(x => x.id === id);
        return item ? toTop3Item(item, 0.7, user_context) : null;
      }).filter(Boolean);
    return {
      top3_json: fallback,
      opportunity_scores: fallback.map((x, i) => ({ id: ['dim_lights_2030','no_screens_60m','sunlight_30m'][i], score: 0.7 })),
      usedFallback: true
    };
  }

  // Scoring
  const scored = ideal_map.map(item => {
    const goal_weight = (item.goal_weights?.[canonical_goal] ?? (
      canonical_goal === 'mixed'
        ? average(Object.values(item.goal_weights || { sleep_latency: 0.8, wake_freshness: 0.8, consistency: 0.8 }))
        : 0.8
    ));
    const idealMid = minutesFromBlockStr(item.block) ?? 0;

    // pick user anchor time
    const userTime = candidateUserTime(item.id, anchors);
    const timing_delta = (userTime === null || userTime === undefined) ? 999 : Math.abs(userTime - idealMid);
    const timing_penalty = clamp(timing_delta / 180, 0, 1); // 3h normalization

    const effortAdj = applyEffortOverrides(item.effort, item.id, user_context);
    const opp = opportunityScore({ impact: item.impact, effort: effortAdj, goal_weight, timing_penalty });

    return {
      id: item.id,
      category: item.category || 'sleep',
      system_block: systemBlockFromId(item),
      impact: item.impact,
      effort: effortAdj,
      goal_weight,
      timing_delta,
      timing_penalty,
      opp,
      ritual_name: item.ritual_name,
      why: item.why,
      how_to: item.how_to
    };
  });

  // Sort by opportunity, tie-breaker: lower effort, then larger timing_delta
  scored.sort((a, b) => {
    if (b.opp !== a.opp) return b.opp - a.opp;
    if (a.effort !== b.effort) return a.effort - b.effort;
    return b.timing_delta - a.timing_delta;
  });

  // Conflict pairs and block de-dup
  const pairs = [
    { prefer: 'no_screens_60m', suppress: 'late_screens' },
    { prefer: 'early_dinner', suppress: 'late_dinner' },
    { prefer: 'fixed_bedtime', suppress: 'variable_bedtime' }
  ];
  const afterPairs = conflictFilter(scored, pairs);

  const picked = [];
  const usedBlocks = new Set();
  for (const s of afterPairs) {
    const blk = s.system_block || 'Night';
    if (!usedBlocks.has(blk)) {
      picked.push(s);
      usedBlocks.add(blk);
    }
    if (picked.length === 3) break;
  }
  // If less than 3 due to block constraint, fill regardless of block
  if (picked.length < 3) {
    for (const s of afterPairs) {
      if (picked.find(p => p.id === s.id)) continue;
      picked.push(s);
      if (picked.length === 3) break;
    }
  }

  const top3_json = picked.map(s => toTop3Item(s, s.opp, user_context));
  const opportunity_scores = scored.map(s => ({ id: s.id, score: round2(s.opp) }));

  return { top3_json, opportunity_scores, usedFallback: false };
}

function toTop3Item(itemOrIdeal, opp, _ctx) {
  const impact_tag = impactTag(itemOrIdeal.impact || 5, typeof opp === 'number' ? opp : 0.7);
  const effort_tag = effortTag(itemOrIdeal.effort || 1);
  const system_block = itemOrIdeal.system_block || 'Night';
  const category = itemOrIdeal.category || 'sleep';
  return {
    ritual_name: itemOrIdeal.ritual_name || itemOrIdeal.id,
    impact_tag,
    effort_tag,
    why: itemOrIdeal.why || '',
    how_to: itemOrIdeal.how_to || '',
    system_block,
    category
  };
}

function candidateUserTime(id, anchors) {
  // Map module → most relevant anchor
  switch (id) {
    case 'early_dinner': return anchors?.dinner_time?.min ?? null;
    case 'dim_lights_2030': return anchors?.lights_dim_time?.min ?? null;
    case 'no_screens_60m': return anchors?.screens_end_time?.min ?? null;
    case 'cool_room': return anchors?.lights_out_time?.min ?? null;
    case 'sunlight_30m': return anchors?.sunlight_time?.min ?? anchors?.wake_time?.min ?? null;
    case 'caffeine_cutoff_14': return anchors?.last_caffeine_time?.min ?? null;
    default: return null;
  }
}

function average(arr) { if (!arr?.length) return 0.8; return arr.reduce((a,b)=>a+b,0)/arr.length; }
function round2(n) { return Math.round(n * 100) / 100; }
