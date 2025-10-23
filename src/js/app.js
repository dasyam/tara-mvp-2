import { initAnalytics, emitEvent } from "../lib/analytics.js";
import { supabase } from "../lib/supabase.js";

initAnalytics();

export async function requireAuth(redirectTo="/login.html") {
  // Attempt to exchange magic-link code if present
  const url = window.location.href;
  if (url.includes("code=") || url.includes("access_token=")) {
    await supabase.auth.exchangeCodeForSession(url);
    // clean URL if you like
    const clean = new URL(window.location.origin + window.location.pathname);
    window.history.replaceState({}, "", clean);
  }
  
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) window.location.href = redirectTo;
  return session;
}

export async function onLogout() {
  await supabase.auth.signOut();
  window.location.href = "/login.html";
  emitEvent("logout");
}
