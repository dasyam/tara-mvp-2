// src/js/home.js
import { ui } from "../lib/ui.js";
import { emitEvent } from "../lib/analytics.js";
import { supabase } from "../lib/supabase.js";
import seedNodes from "../data/seed-glowing-nodes.json";

const EMOJI_MAP = ["😞","😐","🙂","😄","🌞"]; // 1..5
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function todayIST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
}

/** Ensure engine run exists/fresh (weekly or after newer timeline). */
async function ensureDeltaComputed(session) {
  const user_id = session.user.id;

  const { data: runs } = await supabase
    .from("engine_runs")
    .select("created_at")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false })
    .limit(1);

  const { data: timelines } = await supabase
    .from("timelines")
    .select("created_at")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false })
    .limit(1);

  const lastRun = runs?.[0]?.created_at ? new Date(runs[0].created_at) : null;
  const lastTimeline = timelines?.[0]?.created_at ? new Date(timelines[0].created_at) : null;

  const needWeekly = !lastRun || (Date.now() - lastRun.getTime() > WEEK_MS);
  const newerTimeline = lastTimeline && (!lastRun || lastTimeline > lastRun);

  if (needWeekly || newerTimeline) {
    emitEvent("delta_compute_start", {});
    const { data: { session: fresh } } = await supabase.auth.getSession();
    const token = fresh?.access_token;
    if (token) {
      try {
        await fetch("/api/computeDelta", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({})
        });
      } catch {
        // best-effort; fallbacks will render
      }
    }
  }
}

/** Load latest Top-3 from engine_runs (if any). */
async function loadTop3() {
  const { data: run } = await supabase
    .from("engine_runs")
    .select("top3_json")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return run?.top3_json || [];
}

/** Render cards into #nodes. Prefers engine Top-3 → rituals(active) → seeds. */
export async function renderNodes() {
  const listEl = document.querySelector("#nodes");
  if (!listEl) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();

    // If logged-in, try to compute or refresh engine output first
    if (session?.user?.id) {
      await ensureDeltaComputed(session);

      // Try Top-3 from engine
      const top3 = await loadTop3();
      if (top3.length) {
        listEl.innerHTML = top3.slice(0,3).map(r => `
          <div class="rounded-2xl p-4 shadow-md bg-gradient-to-r from-brand/20 to-indigo-400/20 
                      animate-pulse hover:scale-[1.01] transition">
            <div class="font-semibold">${r.ritual_name}</div>
            <div class="text-sm opacity-80">${r.how_to || ""}</div>
            <div class="mt-2 flex gap-2">
              <span class="inline-block text-xs px-2 py-1 rounded-full bg-slate-100">${r.system_block || "Night"}</span>
              <span class="inline-block text-xs px-2 py-1 rounded-full bg-slate-100">Impact: ${r.impact_tag || "High"}</span>
              <span class="inline-block text-xs px-2 py-1 rounded-full bg-slate-100">Effort: ${r.effort_tag || "Low"}</span>
            </div>
          </div>
        `).join("");
        emitEvent("nodes_rendered", { source: "engine_top3", count: top3.length });
        return;
      }

      // Fallback: user-specific active rituals
      const { data: rituals } = await supabase
        .from("rituals")
        .select("*")
        .eq("active", true)
        .limit(5);

      if (rituals?.length) {
        listEl.innerHTML = rituals.slice(0,3).map(n => `
          <div class="rounded-2xl p-4 shadow-md bg-gradient-to-r from-brand/20 to-indigo-400/20 
                      animate-pulse hover:scale-[1.01] transition">
            <div class="font-semibold">${n.name}</div>
            <div class="text-sm opacity-80">${n.tagline || ""}</div>
          </div>
        `).join("");
        emitEvent("nodes_rendered", { source: "rituals_active", count: rituals.length });
        return;
      }
    }

    // Final fallback: seeds (for logged-out or no data)
    listEl.innerHTML = seedNodes.slice(0,3).map(n => `
      <div class="rounded-2xl p-4 shadow-md bg-gradient-to-r from-brand/20 to-indigo-400/20 
                  animate-pulse hover:scale-[1.01] transition">
        <div class="font-semibold">${n.name}</div>
        <div class="text-sm opacity-80">${n.tagline}</div>
      </div>
    `).join("");
    emitEvent("nodes_rendered", { source: "seed", count: seedNodes.length });
  } catch (e) {
    listEl.innerHTML = `<div class="text-red-600">Failed to load nodes.</div>`;
  }
}

export function setupEmojiRow() {
  const row = document.querySelector("#emoji-row");
  const submit = document.querySelector("#submit-rating");

  // initialize state
  if (submit) submit.disabled = true;

  row?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-v]");
    if (!btn) return;
    ui.set(Number(btn.dataset.v));
    [...row.querySelectorAll("button")].forEach(b => {
      b.classList.toggle("ring-2", Number(b.dataset.v) === ui.selected);
      b.classList.toggle("ring-brand", Number(b.dataset.v) === ui.selected);
    });
    if (submit) submit.disabled = !ui.selected;
  });

  submit?.addEventListener("click", async () => {
    if (!ui.selected) return;
    submit.disabled = true;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user_id = session?.user?.id;
      const payload = {
        user_id,
        date: todayIST(),
        metric: "sleep_quality",
        value: ui.selected
      };

      const { error } = await supabase.from("feedback").insert(payload);
      if (error) {
        if ((error.code && String(error.code).includes("23505")) ||
            String(error.message).toLowerCase().includes("duplicate")) {
          alert("Already recorded for today ✓");
        } else {
          alert("Could not save rating.");
          console.error(error);
          submit.disabled = false;
          return;
        }
      } else {
        submit.disabled = true;
        submit.classList.add("opacity-60", "cursor-not-allowed");
        submit.textContent = "Recorded for today ✓";
      }

      emitEvent("rating_submit", { value: ui.selected });

      const ripple = document.querySelector("#ripple");
      if (ripple) {
        ripple.classList.remove("opacity-0");
        ripple.classList.add("opacity-100");
        setTimeout(() => ripple.classList.add("opacity-0"), 600);
      }
    } catch (err) {
      alert("Unexpected error saving rating.");
      submit.disabled = false;
    }
  });
}
