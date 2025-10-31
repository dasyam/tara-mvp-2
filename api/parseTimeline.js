// api/parseTimeline.js
// Vercel serverless function (Edge Runtime)
// - Normalizes user intake into a strict timeline_json
// - Enforces canonical anchor names
// - Returns JSON only

export const config = { runtime: 'edge' };

// ---------- Utils ----------
const CANONICAL_ANCHORS = new Set([
  'Last Caffeine',
  'Dinner',
  'Screens End',
  'Lights Dim',
  'Lights Out',
  'Sleep Window Start',
  'Sleep Window End',
  'Wake',
  'Sunlight',
  'Morning Mobility'
]);

function safeJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

// Accepts H:MM or HH:MM, returns zero-padded HH:MM or null
function toHHMM(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  let hh = String(m[1]).padStart(2, '0');
  const mm = m[2];
  const h = Number(hh), mn = Number(mm);
  if (h > 23 || mn > 59) return null;
  return `${hh}:${mm}`;
}

function isHHMMStrict(s) {
  return typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
}

function stripUnknownFields(obj, allowed) {
  const out = {};
  for (const k of allowed) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// ---------- Simple IP rate limit (best-effort) ----------
const BUCKET = new Map();
const LIMIT = 10; // per hour
function rateLimit(ip) {
  const now = Date.now(), hour = 60 * 60 * 1000;
  const rec = BUCKET.get(ip) || { count: 0, start: now };
  if (now - rec.start > hour) { rec.count = 0; rec.start = now; }
  rec.count += 1;
  BUCKET.set(ip, rec);
  return rec.count <= LIMIT;
}

// ---------- Validation ----------
function validateAnchor(a) {
  if (!a || typeof a !== 'object') return false;
  if (typeof a.name !== 'string' || !CANONICAL_ANCHORS.has(a.name)) return false;
  if (!isHHMMStrict(a.time)) return false;
  if (a.confidence == null) return false;
  if (typeof a.confidence !== 'number' || a.confidence < 0 || a.confidence > 1) return false;
  return true;
}

function validateTimelineJson(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (!isHHMMStrict(obj.wake_time)) return false;
  if (!isHHMMStrict(obj.bedtime_target)) return false;
  if (typeof obj.bedtime_window !== 'string') return false;
  if (!Array.isArray(obj.anchors)) return false;
  for (const a of obj.anchors) if (!validateAnchor(a)) return false;
  if (typeof obj.notes !== 'string') return false;
  return true;
}

// ---------- Prompt ----------
function buildPrompt({ preferred_name, goal, bedtime_window, routine_text }) {
  return [
    'You are a sleep intake normalizer. Output JSON only.',
    'Task: parse the user’s routine into a normalized "timeline_json".',
    'Times: 24h HH:MM (zero-padded). If vague, infer from bedtime window midpoint.',
    'Anchors: use exact names from the enum. Include only anchors you can time; one row per name.',
    'Confidence: number in [0,1]; lower if inferred.',
    'Bedtime window: accept "22:00–23:00" or "22:00-23:00" as given.',
    '',
    'Anchor enum:',
    'Last Caffeine, Dinner, Screens End, Lights Dim, Lights Out, Sleep Window Start, Sleep Window End, Wake, Sunlight, Morning Mobility',
    '',
    `Preferred name: ${preferred_name || 'anonymous'}`,
    `Goal: ${goal || ''}`,
    `Bedtime window: ${bedtime_window || ''}`,
    'Routine:',
    routine_text || 'No details provided.',
    '',
    'Schema:',
    '{ "timeline_json": { "wake_time":"HH:MM", "bedtime_target":"HH:MM", "bedtime_window":"string", "anchors":[{"name":"<enum>","time":"HH:MM","confidence":0.0}], "notes":"string" } }'
  ].join('\n');
}

// ---------- Handler ----------
export default async function handler(req) {
  if (req.method !== 'POST') return safeJson({ error: 'Method not allowed' }, 405);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'ip:unknown';
  if (!rateLimit(ip)) return safeJson({ error: 'Too many requests' }, 429);

  let body;
  try {
    body = await req.json();
  } catch {
    return safeJson({ error: 'Invalid JSON body' }, 400);
  }

  const preferred_name = body?.preferred_name ?? null;
  const goal = body?.goal ?? '';
  const bedtime_window_in = body?.bedtime_window ?? '';
  const routine_text = body?.routine_text ?? '';

  const prompt = buildPrompt({ preferred_name, goal, bedtime_window: bedtime_window_in, routine_text });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return safeJson({ error: 'Server misconfigured: missing OPENAI_API_KEY' }, 500);

  // Call OpenAI
  const reqBody = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You output only JSON. No commentary.' },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2
  };

  let raw;
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(reqBody)
    });
    if (!resp.ok) {
      const t = await resp.text();
      return safeJson({ error: `OpenAI error: ${resp.status}`, detail: t.slice(0, 400) }, 502);
    }
    const data = await resp.json();
    raw = data.choices?.[0]?.message?.content;
  } catch {
    return safeJson({ error: 'OpenAI request failed' }, 502);
  }

  let out;
  try {
    out = JSON.parse(raw || '{}');
  } catch {
    return safeJson({ error: 'Model did not return valid JSON' }, 422);
  }

  // Keep only "timeline_json" and strictly validate
  const tj = out?.timeline_json;
  if (!tj || typeof tj !== 'object') return safeJson({ error: 'Missing timeline_json' }, 422);

  // Normalize times to HH:MM before final checks
  const norm = stripUnknownFields(tj, ['wake_time', 'bedtime_target', 'bedtime_window', 'anchors', 'notes']);
  norm.wake_time = toHHMM(norm.wake_time);
  norm.bedtime_target = toHHMM(norm.bedtime_target);
  norm.bedtime_window = typeof norm.bedtime_window === 'string'
    ? norm.bedtime_window
    : (bedtime_window_in || '');

  const anchorsIn = Array.isArray(norm.anchors) ? norm.anchors : [];
  const anchorsOut = [];
  for (const a of anchorsIn) {
    const name = typeof a?.name === 'string' ? a.name : '';
    const time = toHHMM(a?.time);
    const conf = Number(a?.confidence);
    if (!name || !CANONICAL_ANCHORS.has(name)) continue;
    if (!time) continue;
    const c = isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5;
    anchorsOut.push({ name, time, confidence: c });
  }
  norm.anchors = anchorsOut;
  if (typeof norm.notes !== 'string') norm.notes = '';

  // Fill missing bedtime_window from user input if model omitted it
  if (!norm.bedtime_window) norm.bedtime_window = bedtime_window_in || '';

  // Final strict validation
  if (!validateTimelineJson(norm)) return safeJson({ error: 'Invalid timeline_json' }, 422);

  // Respond with strict shape only
  return safeJson({ timeline_json: norm }, 200);
}




// The WP3 file:

// // Vercel serverless function
// export const config = {
//   runtime: 'edge' // faster cold starts
// };

// // Simple JSON schema checks without external deps
// function isHHMM(s) {
//   return typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
// }

// function validateTimelineJson(obj) {
//   if (!obj || typeof obj !== 'object') return false;
//   if (!isHHMM(obj.wake_time)) return false;
//   if (!isHHMM(obj.bedtime_target)) return false;
//   if (!Array.isArray(obj.anchors)) return false;
//   for (const a of obj.anchors) {
//     if (!a || typeof a !== 'object') return false;
//     if (typeof a.name !== 'string' || !isHHMM(a.time)) return false;
//     if (a.confidence != null && (typeof a.confidence !== 'number' || a.confidence < 0 || a.confidence > 1)) return false;
//   }
//   return true;
// }

// function validateRitual(r) {
//   const cats = ['Food','Movement','Mind','Sleep'];
//   const blocks = ['Morning','Day','Evening','Night'];
//   return r
//     && typeof r.name === 'string' && r.name.length >= 2
//     && typeof r.tagline === 'string' && r.tagline.length >= 4
//     && cats.includes(r.category)
//     && blocks.includes(r.time_block);
// }

// function safeJson(data, status = 200) {
//   return new Response(JSON.stringify(data), {
//     status,
//     headers: { 'content-type': 'application/json' }
//   });
// }

// // naive in-memory rate limit per IP (best effort only)
// const BUCKET = new Map();
// const LIMIT = 10; // per hour
// function rateLimit(ip) {
//   const now = Date.now();
//   const hour = 60 * 60 * 1000;
//   const rec = BUCKET.get(ip) || { count: 0, start: now };
//   if (now - rec.start > hour) {
//     rec.count = 0;
//     rec.start = now;
//   }
//   rec.count += 1;
//   BUCKET.set(ip, rec);
//   return rec.count <= LIMIT;
// }

// export default async function handler(req) {
//   if (req.method !== 'POST') {
//     return safeJson({ error: 'Method not allowed' }, 405);
//   }

//   const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'ip:unknown';
//   if (!rateLimit(ip)) {
//     return safeJson({ error: 'Too many requests' }, 429);
//   }

//   let body;
//   try {
//     body = await req.json();
//   } catch {
//     return safeJson({ error: 'Invalid JSON body' }, 400);
//   }

//   const {
//     preferred_name = null,
//     goal = '',
//     bedtime_window = '',
//     routine_text = ''
//   } = body || {};

//   const nameSnippet = preferred_name ? `Preferred name: ${preferred_name}\n` : '';
//   const windowSnippet = bedtime_window ? `Bedtime window: ${bedtime_window}\n` : '';

//   const prompt = [
//     'You are a sleep intake normalizer. Return only strict JSON.',
//     'Parse the user routine into a timeline and up to 3 simple rituals.',
//     'Times must be 24h HH:MM. If vague, make safe best guesses from the bedtime window.',
//     'Rituals should be easy and high leverage for the next 7 days.',
//     '',
//     nameSnippet,
//     `Primary goal: ${goal || 'Fall asleep faster'}`,
//     windowSnippet,
//     'Routine:',
//     routine_text || 'No details provided.',
//     '',
//     'JSON schema:',
//     `{
//       "timeline_json": {
//         "wake_time": "HH:MM",
//         "bedtime_target": "HH:MM",
//         "bedtime_window": "string",
//         "anchors": [{"name":"string","time":"HH:MM","confidence":0.0}],
//         "notes": "string"
//       }
//     }`
//   ].join('\n');

//   const apiKey = process.env.OPENAI_API_KEY;
//   if (!apiKey) {
//     return safeJson({ error: 'Server misconfigured: missing OPENAI_API_KEY' }, 500);
//   }

//   // Call OpenAI
//   const reqBody = {
//     model: 'gpt-4o-mini',
//     messages: [
//       { role: 'system', content: 'You output only JSON. No commentary.' },
//       { role: 'user', content: prompt }
//     ],
//     response_format: { type: 'json_object' },
//     temperature: 0.2
//   };

//   let raw;
//   try {
//     const resp = await fetch('https://api.openai.com/v1/chat/completions', {
//       method: 'POST',
//       headers: {
//         authorization: `Bearer ${apiKey}`,
//         'content-type': 'application/json'
//       },
//       body: JSON.stringify(reqBody)
//     });
//     if (!resp.ok) {
//       const t = await resp.text();
//       return safeJson({ error: `OpenAI error: ${resp.status} ${t.slice(0, 200)}` }, 502);
//     }
//     const data = await resp.json();
//     raw = data.choices?.[0]?.message?.content;
//   } catch (e) {
//     return safeJson({ error: 'OpenAI request failed' }, 502);
//   }

//   let parsed;
//   try {
//     parsed = JSON.parse(raw || '{}');
//   } catch {
//     return safeJson({ error: 'Model did not return valid JSON' }, 422);
//   }

//   // Basic schema validation
//   if (!validateTimelineJson(parsed.timeline_json)) {
//     return safeJson({ error: 'Invalid timeline_json' }, 422);
//   }
//   const rituals = Array.isArray(parsed.seed_rituals) ? parsed.seed_rituals : [];
//   if (rituals.some(r => !validateRitual(r))) {
//     return safeJson({ error: 'Invalid ritual item' }, 422);
//   }

//   // Fill missing bedtime_window from user input if model omitted it
//   if (!parsed.timeline_json.bedtime_window) {
//     parsed.timeline_json.bedtime_window = bedtime_window || '';
//   }

//   return safeJson(parsed, 200);
// }
