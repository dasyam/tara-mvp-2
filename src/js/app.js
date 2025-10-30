import { initAnalytics, emitEvent } from "../lib/analytics.js";
import { supabase } from "../lib/supabase.js";
// NEW: only needed on /systemmap.html (safe to import always; no cycles)
import { renderSystemMap } from "./map.js";

initAnalytics();

export async function requireAuth(redirectTo = "/login.html") {
  // --- Magic-link / token-in-URL handling (query or hash) ---
  const href = window.location.href;
  const hasMagicParams =
    href.includes("code=") ||
    href.includes("access_token=") ||
    (window.location.hash && window.location.hash.includes("access_token="));

  if (hasMagicParams) {
    try {
      await supabase.auth.exchangeCodeForSession(href);
      // Clean URL (keep path + query, drop tokens)
      const clean = new URL(window.location.origin + window.location.pathname + window.location.search);
      window.history.replaceState({}, "", clean.toString());
    } catch (err) {
      console.error("exchangeCodeForSession failed", err);
      // fall through; we'll redirect if no session
    }
  }

  // --- Session gate ---
  const { data: { session } } = await supabase.auth.getSession();
  const path = window.location.pathname;
  const onLogin = path.endsWith("/login.html") || path.endsWith("login.html");
  const onIntake = path.endsWith("/intake.html") || path.endsWith("intake.html");

  if (!session) {
    if (!onLogin) window.location.href = redirectTo;
    return null;
  }

  // --- Onboarding enforcement with Intake-flash fix ---
  try {
    const user_id = session.user.id;

    // Lightweight existence checks
    const [tlRes, erRes] = await Promise.all([
      supabase.from("timelines").select("id").eq("user_id", user_id).limit(1),
      supabase.from("engine_runs").select("id").eq("user_id", user_id).limit(1)
    ]);

    const hasTimeline = Array.isArray(tlRes.data) && tlRes.data.length > 0 && !tlRes.error;
    const hasEngine = Array.isArray(erRes.data) && erRes.data.length > 0 && !erRes.error;
    const onboarded = hasTimeline || hasEngine;

    // If NOT onboarded → force Intake (unless already there or on login)
    if (!onboarded && !onIntake && !onLogin) {
      window.location.replace("/intake.html");
      return null;
    }

    // If onboarded and user hits Intake → send to Home
    if (onboarded && onIntake) {
      window.location.replace("/home.html");
      return null;
    }
  } catch (e) {
    // Conservative fallback: keep user on Intake unless already on login
    if (!onIntake && !onLogin) {
      window.location.replace("/intake.html");
      return null;
    }
  }

  return session;
}



export async function onLogout() {
  await supabase.auth.signOut();
  emitEvent("logout");
  window.location.href = "/login.html";
}

// 🔹 Auto-guard + boot page-specific features
document.addEventListener("DOMContentLoaded", async () => {
  console.log("[app] DOM ready:", location.pathname);
  const session = await requireAuth();
  console.log("[app] session?", !!session);

  if (location.pathname.endsWith("systemmap.html")) {
    console.log("[app] booting system map…");
    try {
      await renderSystemMap();
      console.log("[app] renderSystemMap() returned");
    } catch (e) {
      console.error("[app] renderSystemMap error", e);
    }
  }
});