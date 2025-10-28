// Vercel serverless function
export const config = {
  runtime: 'edge' // faster cold starts
};

// Simple JSON schema checks without external deps
function isHHMM(s) {
  return typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
}

function validateTimelineJson(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (!isHHMM(obj.wake_time)) return false;
  if (!isHHMM(obj.bedtime_target)) return false;
  if (!Array.isArray(obj.anchors)) return false;
  for (const a of obj.anchors) {
    if (!a || typeof a !== 'object') return false;
    if (typeof a.name !== 'string' || !isHHMM(a.time)) return false;
    if (a.confidence != null && (typeof a.confidence !== 'number' || a.confidence < 0 || a.confidence > 1)) return false;
  }
  return true;
}

function validateRitual(r) {
  const cats = ['Food','Movement','Mind','Sleep'];
  const blocks = ['Morning','Day','Evening','Night'];
  return r
    && typeof r.name === 'string' && r.name.length >= 2
    && typeof r.tagline === 'string' && r.tagline.length >= 4
    && cats.includes(r.category)
    && blocks.includes(r.time_block);
}

function safeJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

// naive in-memory rate limit per IP (best effort only)
const BUCKET = new Map();
const LIMIT = 10; // per hour
function rateLimit(ip) {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const rec = BUCKET.get(ip) || { count: 0, start: now };
  if (now - rec.start > hour) {
    rec.count = 0;
    rec.start = now;
  }
  rec.count += 1;
  BUCKET.set(ip, rec);
  return rec.count <= LIMIT;
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return safeJson({ error: 'Method not allowed' }, 405);
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'ip:unknown';
  if (!rateLimit(ip)) {
    return safeJson({ error: 'Too many requests' }, 429);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return safeJson({ error: 'Invalid JSON body' }, 400);
  }

  const {
    preferred_name = null,
    goal = '',
    bedtime_window = '',
    routine_text = ''
  } = body || {};

  const nameSnippet = preferred_name ? `Preferred name: ${preferred_name}\n` : '';
  const windowSnippet = bedtime_window ? `Bedtime window: ${bedtime_window}\n` : '';

  const prompt = [
    'You are a sleep intake normalizer. Return only strict JSON.',
    'Parse the user routine into a timeline and up to 3 simple rituals.',
    'Times must be 24h HH:MM. If vague, make safe best guesses from the bedtime window.',
    'Rituals should be easy and high leverage for the next 7 days.',
    '',
    nameSnippet,
    `Primary goal: ${goal || 'Fall asleep faster'}`,
    windowSnippet,
    'Routine:',
    routine_text || 'No details provided.',
    '',
    'JSON schema:',
    `{
      "timeline_json": {
        "wake_time": "HH:MM",
        "bedtime_target": "HH:MM",
        "bedtime_window": "string",
        "anchors": [{"name":"string","time":"HH:MM","confidence":0.0}],
        "notes": "string"
      },
      "seed_rituals": [{
        "name":"string",
        "tagline":"string",
        "category":"Food|Movement|Mind|Sleep",
        "time_block":"Morning|Day|Evening|Night",
        "color":"string optional"
      }]
    }`
  ].join('\n');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return safeJson({ error: 'Server misconfigured: missing OPENAI_API_KEY' }, 500);
  }

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
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(reqBody)
    });
    if (!resp.ok) {
      const t = await resp.text();
      return safeJson({ error: `OpenAI error: ${resp.status} ${t.slice(0, 200)}` }, 502);
    }
    const data = await resp.json();
    raw = data.choices?.[0]?.message?.content;
  } catch (e) {
    return safeJson({ error: 'OpenAI request failed' }, 502);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    return safeJson({ error: 'Model did not return valid JSON' }, 422);
  }

  // Basic schema validation
  if (!validateTimelineJson(parsed.timeline_json)) {
    return safeJson({ error: 'Invalid timeline_json' }, 422);
  }
  const rituals = Array.isArray(parsed.seed_rituals) ? parsed.seed_rituals : [];
  if (rituals.some(r => !validateRitual(r))) {
    return safeJson({ error: 'Invalid ritual item' }, 422);
  }

  // Fill missing bedtime_window from user input if model omitted it
  if (!parsed.timeline_json.bedtime_window) {
    parsed.timeline_json.bedtime_window = bedtime_window || '';
  }

  return safeJson(parsed, 200);
}
