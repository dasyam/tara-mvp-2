// src/lib/delta/normalizeAnchors.js
// Converts HH:MM into minutes since midnight; applies rollover & midpoint rules.

function hhmmToMin(t) {
  if (!t || typeof t !== 'string') return null;
  const m = t.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function normalizeAnchors(timeline_json, rules) {
  const anchors = timeline_json?.anchors || [];
  const confs = [];
  const anchorMap = {};

  for (const a of anchors) {
    const key = keyFromName(a.name);
    const min = hhmmToMin(a.time);
    if (key && min !== null) {
      anchorMap[key] = { min, confidence: a.confidence ?? 0.5 };
      confs.push(a.confidence ?? 0.5);
    }
  }

  // Window midpoint (if available)
  let windowMid = null;
  if (rules?.window_midpoint_delta && timeline_json?.bedtime_window) {
    const parts = String(timeline_json.bedtime_window).split('–');
    if (parts.length === 2) {
      const s = hhmmToMin(parts[0]); const e = hhmmToMin(parts[1]);
      if (s !== null && e !== null) windowMid = Math.round((s + e) / 2);
    }
  }

  // Rollover: map 00:00–03:00 to previous night (negative offset)
  const rolloverKeys = ['lights_out_time', 'screens_end_time'];
  let rollover_anomaly = false;
  if (rules?.map_00_03_to_previous_night) {
    for (const k of rolloverKeys) {
      const v = anchorMap[k]?.min;
      if (v !== undefined && v !== null && v <= 180) {
        anchorMap[k].min = v - 1440;
        rollover_anomaly = true;
      }
    }
  }

  const avg_conf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;

  return {
    anchors: anchorMap,
    window_mid: windowMid,
    avg_confidence: avg_conf,
    [rules?.rollover_flag_key || 'rollover_anomaly']: rollover_anomaly
  };
}

function keyFromName(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('dinner')) return 'dinner_time';
  if (n.includes('caffeine')) return 'last_caffeine_time';
  if (n.includes('screen')) return 'screens_end_time';
  if (n.includes('dim')) return 'lights_dim_time';
  if (n.includes('lights out') || n === 'lights out') return 'lights_out_time';
  if (n.includes('wake')) return 'wake_time';
  if (n.includes('sunlight')) return 'sunlight_time';
  if (n.includes('mobility') || n.includes('walk')) return 'morning_mobility_time';
  return null;
}
