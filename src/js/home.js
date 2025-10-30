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

/**
 * Call the delta engine when needed:
 * - if no engine_runs yet, or
 * - if last engine_run is older than 7 days, or
 * - if a newer timeline exists after the last engine_run.
 */
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
      await fetch("/api/computeDelta", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({})
      }).catch(() => {});
    }
  }
}

/**
 * Load latest Top-3 from engine_runs.
 */
async function loadTop3() {
  const { data: run } = await supabase
    .from("engine_runs")
    .select("engine_version, top3_json")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    top3: run?.top3_json || [],
    engine_version: run?.engine_version || null
  };
}

/**
 * Render Top-3 if present; fallback to rituals (active) else seed nodes.
 */
export async function renderNodes() {
  const listEl = document.querySelector("#nodes");
  if (!listEl) return;

  try {
    // Try Top-3 from engine
    const { top3 } = await loadTop3();

    if (top3 && top3.length) {
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

    // Fallback to user-specific rituals (active)
    const { data: rituals } = await supabase
      .from("rituals")
      .select("*")
      .eq("active", true)
      .limit(5);

    const items = (rituals && rituals.length ? rituals : seedNodes);
    listEl.innerHTML = items.slice(0, 3).map(n => `
      <div class="rounded-2xl p-4 shadow-md bg-gradient-to-r from-brand/20 to-indigo-400/20 
                  animate-pulse hover:scale-[1.01] transition">
        <div class="font-semibold">${n.name || n.ritual_name || "Ritual"}</div>
        <div class="text-sm opacity-80">${n.tagline || n.how_to || ""}</div>
      </div>
    `).join("");

    emitEvent("nodes_rendered", { source: rituals?.length ? "rituals_active" : "seed", count: items.length });
  } catch (e) {
    const listEl = document.querySelector("#nodes");
    if (listEl) listEl.innerHTML = `<div class="text-red-600">Failed to load nodes.</div>`;
  }
}

async function latestEngineVersion() {
  const { data: run } = await supabase
    .from("engine_runs")
    .select("engine_version")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return run?.engine_version || null;
}

export function setupEmojiRow() {
  const row = document.querySelector("#emoji-row");
  const submit = document.querySelector("#submit-rating");

  // initialize state
  if (submit) submit.disabled = true;

  if (row) {
    row.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-v]");
      if (!btn) return;
      ui.set(Number(btn.dataset.v));
      [...row.querySelectorAll("button")].forEach(b => {
        b.classList.toggle("ring-2", Number(b.dataset.v) === ui.selected);
        b.classList.toggle("ring-brand", Number(b.dataset.v) === ui.selected);
      });
      if (submit) submit.disabled = !ui.selected;
    });
  }

  if (submit) {
    submit.addEventListener("click", async () => {
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
          // Handle duplicate gracefully (Postgres code 23505)
          if ((error.code && String(error.code).includes("23505")) || String(error.message).toLowerCase().includes("duplicate")) {
            alert("Already recorded for today ✓");
          } else {
            alert("Could not save rating.");
            console.error(error);
            submit.disabled = false;
            return;
          }
        } else {
          // Success: disable button and change label
          submit.disabled = true;
          submit.classList.add("opacity-60", "cursor-not-allowed");
          submit.textContent = "Recorded for today ✓";
        }

        // Attach engine_version if available
        const engine_version = await latestEngineVersion();
        emitEvent("rating_submit", { value: ui.selected, engine_version: engine_version || "na" });

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
}

// Boot sequence for Home page
document.addEventListener("DOMContentLoaded", async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  // Compute delta if needed, then render nodes
  await ensureDeltaComputed(session);
  await renderNodes();
});
