import { ui } from "../lib/ui.js";
import { emitEvent } from "../lib/analytics.js";
import { supabase } from "../lib/supabase.js";
import seedNodes from "../data/seed-glowing-nodes.json";

const EMOJI_MAP = ["😞","😐","🙂","😄","🌞"]; // 1..5

function todayISO() {
  const d = new Date(); return d.toISOString().slice(0,10);
}

export async function renderNodes() {

  const listEl = document.querySelector("#nodes");
  try {
    // try user-specific rituals
    const { data: rituals } = await supabase.from("rituals").select("*").eq("active", true).limit(5);
    const items = (rituals && rituals.length ? rituals : seedNodes);
    listEl.innerHTML = items.slice(0,3).map(n => `
      <div class="rounded-2xl p-4 shadow-md bg-gradient-to-r from-brand/20 to-indigo-400/20 
                  animate-pulse hover:scale-[1.01] transition">
        <div class="font-semibold">${n.name}</div>
        <div class="text-sm opacity-80">${n.tagline}</div>
      </div>
    `).join("");
    emitEvent("nodes_rendered",{count: items.length});
  } catch (e) {
    listEl.innerHTML = `<div class="text-red-600">Failed to load nodes.</div>`;
  }
}

export function setupEmojiRow() {
  const row = document.querySelector("#emoji-row");
  const submit = document.querySelector("#submit-rating");

  row.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-v]");
    if (!btn) return;
    ui.set(Number(btn.dataset.v));
    [...row.querySelectorAll("button")].forEach(b => {
      b.classList.toggle("ring-2", Number(b.dataset.v) === ui.selected);
      b.classList.toggle("ring-brand", Number(b.dataset.v) === ui.selected);
    });
    submit.disabled = !ui.selected;
  });

  submit.addEventListener("click", async () => {
    if (!ui.selected) return;
    submit.disabled = true;

    const { data: { session } } = await supabase.auth.getSession();
    const user_id = session?.user?.id;
    const payload = {
      user_id, date: todayISO(), metric: "sleep_quality", value: ui.selected
    };
    const { error } = await supabase.from("feedback").insert(payload);
    if (error && !String(error.message).includes("duplicate")) {
      alert("Could not save rating."); submit.disabled = false; return;
    }
    emitEvent("rating_submit", { value: ui.selected });
    const ripple = document.querySelector("#ripple");
    if (ripple) { ripple.classList.remove("opacity-0"); ripple.classList.add("opacity-100"); setTimeout(()=>ripple.classList.add("opacity-0"), 600); }
  });

  submit.disabled = true;
  const { error } = await supabase.from("feedback").insert(payload);
  if (error && !String(error.message).includes("duplicate")) {
    alert("Could not save rating."); 
    submit.disabled = false; 
    return;
  }
  // show ripple + keep disabled (prevent multiple submits)
}
