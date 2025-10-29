import { supabase } from '../lib/supabase.js';
import { emitEvent } from './events.js';

const form = document.getElementById('intakeForm');
const banner = document.getElementById('intakeBanner');
const submitBtn = document.getElementById('submitBtn');
const skipBtn = document.getElementById('skipBtn');
const progress = document.getElementById('progress');
const progressText = document.getElementById('progressText');

function showBanner(msg, tone = 'info') {
  banner.classList.remove('hidden');
  banner.textContent = msg;
  banner.classList.remove('border-amber-300', 'bg-amber-50', 'text-amber-900');
  if (tone === 'warn') {
    banner.classList.add('border-amber-300', 'bg-amber-50', 'text-amber-900');
  }
}

function hideBanner() {
  banner.classList.add('hidden');
  banner.textContent = '';
}

function setBusy(busy, label = 'Submitting...') {
  submitBtn.disabled = busy;
  skipBtn.disabled = busy;
  progress.classList.toggle('hidden', !busy);
  progressText.textContent = label;
}

async function getUserOrRedirect() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    location.href = '/login.html';
    return null;
  }
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

function validateInputs() {
  const preferred_name = document.getElementById('preferredName').value.trim();
  const goal = document.getElementById('goal').value.trim();
  const bedtime_window = document.getElementById('bedtimeWindow').value.trim();
  const routine_text = document.getElementById('routineText').value.trim();
  const has_goal = !!goal;
  const text_len = routine_text.length;

  emitEvent('intake_submit_click', {
    has_name: !!preferred_name,
    has_goal,
    has_window: !!bedtime_window,
    text_len
  });

  if (!has_goal) {
    showBanner('Please select your primary goal.', 'warn');
    return null;
  }
  return { preferred_name, goal, bedtime_window, routine_text };
}

async function callParseAPI(payload) {
  const res = await fetch('/api/parseTimeline', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });
  if (res.status === 429) {
    throw new Error('Rate limit. Please try again in a bit.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.error || `Intake parse failed with ${res.status}`;
    throw new Error(msg);
  }
  return res.json();
}

async function upsertProfile(user_id, preferred_name, goal, bedtime_window) {
  const { error } = await supabase
    .from('user_profile')
    .upsert(
      { user_id, preferred_name, goal, bedtime_window },
      { onConflict: 'user_id' }
    );
  if (error) throw new Error(`Profile upsert failed: ${error.message}`);
}

async function insertTimeline(user_id, goal, bedtime_window, timeline_json) {
  const { error } = await supabase
    .from('timelines')
    .insert({ user_id, goal, bedtime_window, timeline_json });
  if (error) throw new Error(`Timeline insert failed: ${error.message}`);
}

async function upsertRituals(user_id, rituals = []) {
  for (const r of rituals) {
    const row = {
      user_id,
      name: r.name,
      tagline: r.tagline,
      category: r.category,
      time_block: r.time_block,
      color: r.color || null,
      active: true
    };
    const { error } = await supabase
      .from('rituals')
      .upsert(row, { onConflict: 'user_id,category,time_block,name' });
    if (error) throw new Error(`Ritual upsert failed: ${error.message}`);
  }
}

async function happyRedirect() {
  emitEvent('intake_complete_redirect', { destination: '/home.html' });
  location.href = '/home.html';
}

// Log raw + parsed intake for analytics/audit
async function logIntakeSubmission({ user_id, goal, bedtime_window, routine_text, response, parsed }) {
  const { error } = await supabase
    .from('intake_submissions')
    .insert({
      user_id,
      goal: goal || null,
      bedtime_window: bedtime_window || null,
      routine_text: routine_text || null,
      parsed: !!parsed,
      response: response || null
    });
  if (error) throw new Error(`Intake log failed: ${error.message}`);
}


function seedDefaultPayload(values) {
  // Fallback if user clicks Skip
  return {
    timeline_json: {
      wake_time: '06:30',
      bedtime_target: '23:00',
      bedtime_window: values.bedtime_window || '22:30–23:30',
      anchors: [
        { name: 'Lights Out', time: '23:00', confidence: 0.7 },
        { name: 'Wake', time: '06:30', confidence: 0.8 }
      ],
      notes: 'Default seed from Skip'
    },
    seed_rituals: [
      {
        name: 'Sun AM Light',
        tagline: '5–10 min outdoor light within 60 min of wake',
        category: 'Sleep',
        time_block: 'Morning',
        color: '#8b5cf6'
      }
    ]
  };
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideBanner();
  const user = await getUserOrRedirect();
  if (!user) return;

  const values = validateInputs();
  if (!values) return;

  try {
    setBusy(true, 'Parsing your routine...');
    
    // Prepare payload
    const payload = {
      preferred_name: values.preferred_name,
      goal: values.goal,
      bedtime_window: values.bedtime_window,
      routine_text: values.routine_text
    };

    // Call API with payload
    const parsed = await callParseAPI(payload);
    emitEvent('intake_parse_success', {
      anchors_count: parsed?.timeline_json?.anchors?.length || 0,
      rituals_count: parsed?.seed_rituals?.length || 0
    });

    setBusy(true, 'Saving to your profile...');
    // Log the intake (raw + parsed) before mutating runtime tables
    await logIntakeSubmission({
      user_id: user.id,
      goal: values.goal,
      bedtime_window: values.bedtime_window,
      routine_text: values.routine_text,
      response: parsed,
      parsed: true
    });

    await upsertProfile(user.id, values.preferred_name, values.goal, values.bedtime_window);
    await insertTimeline(user.id, values.goal, values.bedtime_window, parsed.timeline_json);
    await upsertRituals(user.id, parsed.seed_rituals);

    emitEvent('intake_supabase_upsert_success', { tables: 'user_profile,timelines,rituals' });
    // Redirect to Home after successful onboarding
    emitEvent('intake_complete_redirect', { destination: '/home.html' });
    location.href = '/home.html';
  } catch (err) {
    console.error(err);
    emitEvent('intake_parse_error', { error_stage: 'submit', error_code: err?.message?.slice(0, 64) });
    showBanner(err.message || 'Something went wrong.', 'warn');
    setBusy(false);
  }
});

skipBtn?.addEventListener('click', async () => {
  hideBanner();
  const user = await getUserOrRedirect();
  if (!user) return;

  const goalEl = document.getElementById('goal');
  const windowEl = document.getElementById('bedtimeWindow');
  const nameEl = document.getElementById('preferredName');

  const values = {
    preferred_name: nameEl.value.trim() || null,
    goal: goalEl.value.trim() || 'Fall asleep faster',
    bedtime_window: windowEl.value.trim() || '22:30–23:30'
  };

  try {
    setBusy(true, 'Seeding defaults...');
    const fallback = seedDefaultPayload(values);
    // Log the skip as a parsed=true event with fallback response
    await logIntakeSubmission({
      user_id: user.id,
      goal: values.goal,
      bedtime_window: values.bedtime_window,
      routine_text: '(SKIP)',
      response: fallback,
      parsed: true
    });
    await upsertProfile(user.id, values.preferred_name, values.goal, values.bedtime_window);
    await insertTimeline(user.id, values.goal, values.bedtime_window, fallback.timeline_json);
    await upsertRituals(user.id, fallback.seed_rituals);
    emitEvent('intake_supabase_upsert_success', { tables: 'user_profile,timelines,rituals', mode: 'skip' });
    emitEvent('intake_complete_redirect', { destination: '/home.html' });
    location.href = '/home.html';
  } catch (err) {
    console.error(err);
    emitEvent('intake_parse_error', { error_stage: 'skip', error_code: err?.message?.slice(0, 64) });
    showBanner(err.message || 'Could not complete skip flow.', 'warn');
    setBusy(false);
  }
});

// Screen view
emitEvent('intake_view', { screen_name: 'intake' });
