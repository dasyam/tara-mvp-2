import { supabase } from "../lib/supabase.js";
import { emitEvent } from "../lib/analytics.js";
import INTERVENTION from "../data/interventions/no-screens-60m.json"; 

// IST helpers
export function todayIST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
}
function timeToHM(dateObj = new Date(), tz = "Asia/Kolkata") {
  const d = new Date(dateObj);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
}
function hmStringToMinutes(hm) {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}
function minutesToHM(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

// Fetch helpers
async function getSessionToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}
async function getUserProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("user_profile")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return null;
  return data;
}
async function getLatestTimeline() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("timelines")
    .select("id, timeline_json")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data?.timeline_json || null;
}
async function getTonightPlan() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("evening_plans")
    .select("*")
    .eq("user_id", user.id)
    .eq("date", todayIST())
    .maybeSingle();
  return data || null;
}

async function engineSuggestsNoScreens() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from("engine_runs")
    .select("top3_json")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return false;
  const items = data.top3_json || [];
  return items.some(it =>
    /no[\s_-]?screens/i.test(it.ritual_name || "") ||
    /no[\s_-]?screens/i.test(it.id || "")
  );
}

// Shield default time rule: bedtime_target - 60 min or fallback 22:00
function defaultShieldTimeFromTimeline(timeline_json) {
  const bedtime = timeline_json?.bedtime_target || "22:00";
  const bedtimeM = hmStringToMinutes(bedtime);
  const shieldM = bedtimeM - 60;
  const hm = minutesToHM(shieldM);
  const fallback = "22:00";
  return hm || fallback;
}

// UI builders
function entryCardHTML() {
  return `
  <div id="winddown-entry-card" class="rounded-2xl p-4 bg-zinc-900/60 border border-zinc-800">
    <div class="text-lg font-semibold">Let’s catch when screens begin</div>
    <div class="text-sm text-zinc-400 mt-1">We will set a 30-second plan for tonight</div>
    <button id="wd-build-btn" class="mt-3 px-4 py-2 rounded-xl bg-violet-600 text-white">Build my wind-down</button>
  </div>`;
}

function builderSheetHTML(profile, timeline_json) {
  const hasKids = !!profile?.has_kids;
  const small = hasKids ? `<div class="text-xs text-zinc-400 mt-1">Kid bedtime chaos is real. We will keep this simple.</div>` : ``;

  // Detect options
  const A = INTERVENTION.detect.options.trigger_time_anchor;
  const B = INTERVENTION.detect.options.trigger_place;
  const C = INTERVENTION.detect.options.trigger_mood;

  const defaultShieldTime = defaultShieldTimeFromTimeline(timeline_json);

  // CHANGED: add z-40 to overlay and z-50 + text-zinc-100 to panel
  return `
  <div id="wd-sheet" class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-end">
    <div class="z-50 w-full rounded-t-2xl bg-zinc-950 text-zinc-100 border-t border-zinc-800 p-4">
      <div class="h-1.5 w-12 bg-zinc-700 rounded-full mx-auto mb-4"></div>
      <div id="wd-steps">
        <!-- Step 1: Detect -->
        <div id="wd-step-detect">
          <div class="text-base font-semibold">Let’s catch the moment scrolling begins. 30 seconds.</div>
          ${small}
          <div class="mt-3 text-sm font-medium">When does it usually start?</div>
          <div class="mt-2 grid grid-cols-2 gap-2">
            ${A.map(o => `<button data-key="trigger_time_anchor" data-val="${o}" class="wd-opt w-full rounded-lg px-3 py-2 text-left border border-zinc-800 text-zinc-200 hover:bg-zinc-900/60">${o}</button>`).join("")}
            <button data-key="trigger_time_anchor" data-val="Other" class="wd-opt col-span-2 w-full rounded-lg px-3 py-2 text-left border border-zinc-800 text-zinc-200 hover:bg-zinc-900/60">Other</button>
          </div>
          <input id="wd-other-input" class="mt-2 hidden w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm" maxlength="30" placeholder="Type other…"/>
          <div class="mt-4 text-sm font-medium">Where is the phone then?</div>
          <div class="mt-2 grid grid-cols-2 gap-2">
            ${B.map(o => `<button data-key="trigger_place" data-val="${o}" class="wd-opt w-full rounded-lg px-3 py-2 text-left border border-zinc-800 text-zinc-200 hover:bg-zinc-900/60">${o}</button>`).join("")}
          </div>
          <div class="mt-4 text-sm font-medium">Tonight I feel mostly…</div>
          <div class="mt-2 grid grid-cols-2 gap-2">
            ${C.map(o => `<button data-key="trigger_mood" data-val="${o}" class="wd-opt w-full rounded-lg px-3 py-2 text-left border border-zinc-800 text-zinc-200 hover:bg-zinc-900/60">${o}</button>`).join("")}
          </div>
          <button id="wd-next-disarm" class="mt-4 w-full px-4 py-2 rounded-xl bg-violet-600 text-white disabled:opacity-40" disabled>Next</button>
        </div>

        <!-- Step 2: Disarm -->
        <div id="wd-step-disarm" class="hidden">
          <div class="text-base font-semibold">Choose a shield for that moment</div>
          <div class="text-sm text-zinc-400">Makes the cue invisible.</div>
          <div id="wd-shield-list" class="mt-3 grid grid-cols-1 gap-2"></div>
          <div class="mt-3">
            <div class="text-sm font-medium">Time</div>
            <input id="wd-shield-time" class="mt-1 w-40 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm" value="${defaultShieldTime}" />
            <div class="text-xs text-zinc-500 mt-1">Default is bedtime minus 60 minutes, or 22:00.</div>
          </div>
          <button id="wd-next-divert" class="mt-4 w-full px-4 py-2 rounded-xl bg-violet-600 text-white disabled:opacity-40" disabled>Next</button>
        </div>

        <!-- Step 3: Divert -->
        <div id="wd-step-divert" class="hidden">
          <div class="text-base font-semibold">Pick a 10-minute swap for tonight</div>
          <div id="wd-divert-list" class="mt-3 grid grid-cols-1 gap-2"></div>
          <div class="mt-4 rounded-xl border border-zinc-800 p-3">
            <div class="text-sm font-semibold">Tonight at <span id="wd-confirm-time">${defaultShieldTime}</span></div>
            <div class="text-sm text-zinc-300 mt-1" id="wd-confirm-shield">Shield</div>
            <div class="text-sm text-zinc-300" id="wd-confirm-divert">Swap</div>
            <div class="flex gap-2 mt-3">
              <button id="wd-set-tonight" class="flex-1 px-4 py-2 rounded-xl bg-violet-600 text-white">Set for tonight</button>
              <button id="wd-start-now" class="px-4 py-2 rounded-xl border border-zinc-700 text-zinc-200">Start now for 2 minutes</button>
            </div>
          </div>
        </div>

      </div>
      <button id="wd-close" class="w-full mt-3 py-2 text-sm text-zinc-400">Close</button>
    </div>
  </div>
  `;
}

// Runtime banners
function runtimeBannerHTML(text, primaryLabel, secondaryLabel, tertiaryLabel) {
  return `
  <div id="wd-runtime" class="fixed bottom-4 inset-x-0 px-4">
    <div class="mx-auto max-w-md rounded-2xl bg-zinc-950 border border-zinc-800 p-4 shadow-lg">
      <div class="text-sm text-zinc-100">${text}</div>
      <div class="flex gap-2 mt-3">
        <button id="wd-primary" class="flex-1 px-4 py-2 rounded-xl bg-violet-600 text-white">${primaryLabel}</button>
        ${secondaryLabel ? `<button id="wd-secondary" class="px-4 py-2 rounded-xl border border-zinc-700 text-zinc-200">${secondaryLabel}</button>` : ``}
        ${tertiaryLabel ? `<button id="wd-tertiary" class="px-4 py-2 rounded-xl border border-zinc-700 text-zinc-200">${tertiaryLabel}</button>` : ``}
      </div>
    </div>
  </div>`;
}

// Morning micro-check
function morningCardHTML() {
  return `
  <div id="wd-morning-card" class="rounded-2xl p-4 bg-zinc-900/60 border border-zinc-800">
    <div class="text-base font-semibold">How was your sleep?</div>
    <div class="flex gap-2 mt-2">
      ${[1,2,3,4,5].map(n => `<button class="wd-rate rounded-lg px-3 py-2 border border-zinc-800 text-zinc-200 hover:bg-zinc-900/60" data-v="${n}">${n}</button>`).join("")}
    </div>
    <div class="text-sm font-medium mt-3">Did the plan happen?</div>
    <div class="flex gap-2 mt-2">
      ${['Yes','Partly','No'].map(v => `<button class="wd-result rounded-lg px-3 py-2 border border-zinc-800 text-zinc-200 hover:bg-zinc-900/60" data-v="${v.toLowerCase()}">${v}</button>`).join("")}
    </div>
    <button id="wd-morning-submit" class="mt-3 px-4 py-2 rounded-xl bg-violet-600 text-white disabled:opacity-40" disabled>Submit</button>
  </div>`;
}

// Mount helpers
function mountHTML(containerSel, html) {
  const el = document.querySelector(containerSel);
  if (!el) return null;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const node = wrap.firstElementChild;
  el.prepend(node);
  return node;
}

// State store
const state = {
  detect: { trigger_time_anchor: null, trigger_place: null, trigger_mood: null, other: "" },
  disarm: { shield_type: null, shield_label: null, shield_time: null },
  divert: { divert_ritual: null },
  timers: { shieldTimer: null, bedtimeMinusTimer: null }
};

// Entry card decision: show if Top-3 includes no_screens_60m and no plan exists today
export async function maybeRenderWinddownEntry(containerSel = "#nodes") {
  try {
    const plan = await getTonightPlan();
    if (plan) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let show = false;

    // Check active rituals
    const { data: rituals } = await supabase
      .from("rituals")
      .select("name, active")
      .eq("user_id", user.id)
      .eq("active", true)
      .limit(20);
    if ((rituals || []).some(r => /no[\s_-]?screens/i.test(r.name))) show = true;

    // Fallback to engine_runs if not found
    if (!show) show = await engineSuggestsNoScreens();

    if (!show) return;

    const card = mountHTML(containerSel, entryCardHTML());
    if (!card) return;

    document.getElementById("wd-build-btn").addEventListener("click", async () => {
      emitEvent("wb_builder_start", { card_id: "no_screens_60m" });
      const profile = await getUserProfile();
      const tline = await getLatestTimeline();
      openBuilder(profile, tline);
    });
  } catch {}
}

function openBuilder(profile, timeline_json) {
  const sheet = mountHTML("body", builderSheetHTML(profile, timeline_json));
  if (!sheet) return;

  const selected = state.detect;
  const stepDetect = sheet.querySelector("#wd-step-detect");
  const stepDisarm = sheet.querySelector("#wd-step-disarm");
  const stepDivert = sheet.querySelector("#wd-step-divert");
  const otherInput = sheet.querySelector("#wd-other-input");

  function updateNextButton() {
    const ok = selected.trigger_time_anchor && selected.trigger_place && selected.trigger_mood;
    sheet.querySelector("#wd-next-disarm").disabled = !ok;
  }

  sheet.querySelectorAll(".wd-opt").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      const val = btn.dataset.val;
      if (key === "trigger_time_anchor" && val === "Other") {
        otherInput.classList.remove("hidden");
        otherInput.focus();
      } else if (key === "trigger_time_anchor") {
        otherInput.classList.add("hidden");
        selected.other = "";
      }
      selected[key] = val;
      emitEvent("wb_detect_answer", { key, value: val });
      updateNextButton();
    });
  });

  otherInput?.addEventListener("input", (e) => {
    state.detect.other = e.target.value;
    if (state.detect.other?.length > 0) {
      state.detect.trigger_time_anchor = `Other:${state.detect.other}`;
    }
    updateNextButton();
  });

  sheet.querySelector("#wd-next-disarm").addEventListener("click", () => {
    stepDetect.classList.add("hidden");
    stepDisarm.classList.remove("hidden");

    // populate shields based on answer
    const anchor = state.detect.trigger_time_anchor || "";
    const shields = INTERVENTION.disarm.shields.filter(s =>
      (s.if || []).some(k => anchor.includes(k)) || (s.if || []).length === 0
    );
    const list = sheet.querySelector("#wd-shield-list");
    list.innerHTML = shields.map(s =>
      `<button class="wd-shield w-full rounded-lg px-3 py-2 text-left border border-zinc-800 text-zinc-200 hover:bg-zinc-900/60" data-id="${s.id}" data-label="${s.label}">${s.label}</button>`
    ).join("");

    // selection
    list.querySelectorAll(".wd-shield").forEach(b => {
      b.addEventListener("click", () => {
        state.disarm.shield_type = b.dataset.id;
        state.disarm.shield_label = b.dataset.label;
        sheet.querySelector("#wd-next-divert").disabled = false;
        emitEvent("wb_shield_select", { shield_type: state.disarm.shield_type });
      });
    });

    const st = sheet.querySelector("#wd-shield-time");
    const confirmTime = sheet.querySelector("#wd-confirm-time");
    const onTimeChange = () => {
      state.disarm.shield_time = st.value;
      if (confirmTime) confirmTime.textContent = st.value;
    };
    st.addEventListener("input", onTimeChange);
    onTimeChange();
  });

  sheet.querySelector("#wd-next-divert").addEventListener("click", () => {
    stepDisarm.classList.add("hidden");
    stepDivert.classList.remove("hidden");

    const mood = state.detect.trigger_mood;
    const swaps = INTERVENTION.divert.by_mood[mood] || [];
    const list = sheet.querySelector("#wd-divert-list");
    list.innerHTML = swaps.map(s => `<button class="wd-divert w-full rounded-lg px-3 py-2 text-left border border-zinc-800 text-zinc-200 hover:bg-zinc-900/60" data-val="${s}">${s}</button>`).join("");

    const cShield = sheet.querySelector("#wd-confirm-shield");
    const cDivert = sheet.querySelector("#wd-confirm-divert");
    cShield.textContent = state.disarm.shield_label || "Shield";
    cDivert.textContent = "Swap not chosen";

    list.querySelectorAll(".wd-divert").forEach(b => {
      b.addEventListener("click", () => {
        state.divert.divert_ritual = b.dataset.val;
        cDivert.textContent = state.divert.divert_ritual;
        emitEvent("wb_divert_select", { ritual: state.divert.divert_ritual });
      });
    });

    sheet.querySelector("#wd-set-tonight").addEventListener("click", async () => {
      await submitTonightPlan();
      closeBuilder();
    });

    sheet.querySelector("#wd-start-now").addEventListener("click", async () => {
      await submitTonightPlan({ started_now: true });
      // Start a 2-minute starter
      startTwoMinuteStarter();
      closeBuilder();
    });
  });

  sheet.querySelector("#wd-close").addEventListener("click", () => closeBuilder());
}

function closeBuilder() {
  const el = document.getElementById("wd-sheet");
  if (el) el.remove();
}

async function submitTonightPlan(extra = {}) {
  const tok = await getSessionToken();
  const payload = {
    date: todayIST(),
    trigger_time_anchor: state.detect.trigger_time_anchor,
    trigger_place: state.detect.trigger_place,
    trigger_mood: state.detect.trigger_mood,
    shield_type: state.disarm.shield_type,
    shield_time: state.disarm.shield_time,
    divert_ritual: state.divert.divert_ritual,
    ...extra
  };

  const res = await fetch("/api/plan/createTonight", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
    body: JSON.stringify(payload)
  });
  if (!res.ok) return;
  emitEvent("wb_plan_set", { date: payload.date });
  scheduleRuntimeReminders(payload.shield_time);
}

function startTwoMinuteStarter() {
  const html = runtimeBannerHTML("Two minutes to shift your state.", "Finish", null, null);
  const banner = mountHTML("body", html);
  setTimeout(() => {
    if (banner) banner.remove();
    emitEvent("wb_starter_now", { ritual: state.divert.divert_ritual });
  }, 120000);
  banner.querySelector("#wd-primary").addEventListener("click", () => {
    banner.remove();
    emitEvent("wb_starter_now", { ritual: state.divert.divert_ritual });
  });
}

// In-app reminders only P0
function scheduleRuntimeReminders(shieldHM) {
  clearRuntimeTimers();
  const tz = "Asia/Kolkata";
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: tz });
  const [hh, mm] = shieldHM.split(":").map(Number);
  const target = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  target.setHours(hh, mm, 0, 0);
  const delay = Math.max(0, target - new Date(new Date().toLocaleString('en-US', { timeZone: tz })));

  state.timers.shieldTimer = setTimeout(() => {
    fireShieldBanner();
  }, delay);

  // bedtime minus 60 banner already equals shield, but also show a soft banner at same time for clarity
  state.timers.bedtimeMinusTimer = setTimeout(() => {
    fireSoftBedtimeBanner();
  }, delay);
}

function clearRuntimeTimers() {
  if (state.timers.shieldTimer) clearTimeout(state.timers.shieldTimer);
  if (state.timers.bedtimeMinusTimer) clearTimeout(state.timers.bedtimeMinusTimer);
  state.timers.shieldTimer = null;
  state.timers.bedtimeMinusTimer = null;
}

async function fireShieldBanner() {
  const html = runtimeBannerHTML("Ready to put the phone to sleep?", "Done", "Snooze 10", "Skip");
  const banner = mountHTML("body", html);
  const tok = await getSessionToken();
  const plan = await getTonightPlan();

  const postEvent = async (action, reason) => {
    await fetch("/api/plan/runtimeEvent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
      body: JSON.stringify({ plan_id: plan?.id, action, reason })
    });
    emitEvent("wb_runtime_shield", { action, reason });
  };

  banner.querySelector("#wd-primary").addEventListener("click", async () => {
    await postEvent("shield_done");
    banner.remove();
    // Prompt to start swap with a 2-minute starter
    const next = runtimeBannerHTML("Start your swap for 2 minutes?", "Start", "Later", null);
    const b2 = mountHTML("body", next);
    b2.querySelector("#wd-primary").addEventListener("click", () => {
      startTwoMinuteStarter();
      b2.remove();
    });
    b2.querySelector("#wd-secondary").addEventListener("click", () => b2.remove());
  });

  banner.querySelector("#wd-secondary").addEventListener("click", () => {
    banner.remove();
    // Snooze 10 min
    setTimeout(fireShieldBanner, 10 * 60 * 1000);
    postEvent("shield_snooze");
  });

  banner.querySelector("#wd-tertiary").addEventListener("click", async () => {
    // Quick skip reason modal
    banner.remove();
    quickSkipReason();
  });
}

function quickSkipReason() {
  const opts = INTERVENTION.skip_reasons;
  const html = `
  <div id="wd-skip" class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end">
    <div class="w-full rounded-t-2xl bg-zinc-950 border-t border-zinc-800 p-4">
      <div class="h-1.5 w-12 bg-zinc-700 rounded-full mx-auto mb-3"></div>
      <div class="text-base font-semibold text-zinc-100">What made it hard?</div>
      <div class="mt-2 grid grid-cols-1 gap-2">
        ${opts.map(o => `<button class="wd-skip-opt w-full rounded-lg px-3 py-2 text-left border border-zinc-800 text-zinc-200 hover:bg-zinc-900/60" data-reason="${o}">${o}</button>`).join("")}
      </div>
      <button id="wd-skip-close" class="w-full mt-3 py-2 text-sm text-zinc-400">Close</button>
    </div>
  </div>`;
  const node = mountHTML("body", html);
  const onClose = () => node.remove();
  node.querySelectorAll(".wd-skip-opt").forEach(b => {
    b.addEventListener("click", async () => {
      const tok = await getSessionToken();
      const plan = await getTonightPlan();
      await fetch("/api/plan/runtimeEvent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body: JSON.stringify({ plan_id: plan?.id, action: "shield_skip", reason: b.dataset.reason })
      });
      emitEvent("wb_runtime_shield", { action: "shield_skip", reason: b.dataset.reason });
      onClose();
    });
  });
  node.querySelector("#wd-skip-close").addEventListener("click", onClose);
}

function fireSoftBedtimeBanner() {
  const html = runtimeBannerHTML("Blue-light shield on. You planned this earlier.", "OK", null, null);
  const banner = mountHTML("body", html);
  banner.querySelector("#wd-primary").addEventListener("click", () => banner.remove());
}

// Morning micro-check
export async function maybeRenderMorningCheck(containerSel = "#nodes") {
  const plan = await getTonightPlan(); // P0 simple: show for today
  const card = mountHTML(containerSel, morningCardHTML());
  if (!card) return;

  let rating = null;
  let result = null;
  card.querySelectorAll(".wd-rate").forEach(b => {
    b.addEventListener("click", () => {
      rating = Number(b.dataset.v);
      card.querySelector("#wd-morning-submit").disabled = !(rating && result);
    });
  });
  card.querySelectorAll(".wd-result").forEach(b => {
    b.addEventListener("click", () => {
      result = b.dataset.v; // yes|partly|no
      card.querySelector("#wd-morning-submit").disabled = !(rating && result);
    });
  });

  card.querySelector("#wd-morning-submit").addEventListener("click", async () => {
    const map = { yes: "done", partly: "partly", no: "skipped" };
    const tok = await getSessionToken();
    const body = { date: todayIST(), sleep_rating_1_5: rating, completed_evening: map[result] };
    const res = await fetch("/api/checkin/morning", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      emitEvent("wb_debrief_submit", { result, rating });
      card.remove();
    } else {
      // NEW: surface the exact error body in console for quick diagnosis
      const errBody = await res.json().catch(() => ({}));
      console.error("morning POST failed", res.status, errBody);
    }
  });
}
