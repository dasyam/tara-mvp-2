import { initAnalytics, emitEvent } from "../lib/analytics.js";
import { supabase } from "../lib/supabase.js";
// NEW: only needed on /systemmap.html (safe to import always; no cycles)
import { renderSystemMap } from "./map.js";

initAnalytics();

export async function requireAuth(redirectTo = "/login.html") {
  // Handle magic-link params in both query and hash
  const href = window.location.href;
  const hasMagicParams =
    href.includes("code=") ||
    href.includes("access_token=") ||
    (window.location.hash && window.location.hash.includes("access_token="));

  if (hasMagicParams) {
    try {
      await supabase.auth.exchangeCodeForSession(href);
      // Clean URL (keep path, drop tokens)
      const clean = new URL(window.location.origin + window.location.pathname + window.location.search);
      window.history.replaceState({}, "", clean);
    } catch (err) {
      console.error("exchangeCodeForSession failed", err);
      // Fall through; requireAuth will redirect if no session
    }
  }

  const { data: { session } } = await supabase.auth.getSession();

  // Prevent redirect loop on the login page
  const onLoginPage = window.location.pathname.endsWith("login.html");
  if (!session && !onLoginPage) {
    window.location.href = redirectTo;
    return null;
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