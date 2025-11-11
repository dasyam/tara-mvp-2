import { getSupabase } from "./supabase.js";

const BASE = "";

async function authHeader() {
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

async function doFetch(path, { method="GET", body, headers={}, retries=2 } = {}) {
  const h = {
    "Content-Type": "application/json",
    "X-Contracts-Version": "v1.0",
    ...(await authHeader()),
    ...headers
  };
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  if ((res.status === 429 || res.status >= 500) && retries > 0) {
    await new Promise(r => setTimeout(r, Math.min(1500 * (3 - retries), 3000)));
    return doFetch(path, { method, body, headers, retries: retries - 1 });
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    return { ok: false, data: null, error: data?.error || { code: `${res.status}`, message: res.statusText } };
  }
  if (data && typeof data.ok === "boolean") return data; // already in envelope
  return { ok: true, data, error: null };
}

export const API = {
  parseTimeline: (payload) => doFetch("/api/parseTimeline", { method:"POST", body: payload }),
  computeDelta: (payload) => doFetch("/api/computeDelta", { method:"POST", body: payload }),
  plan: {
    createTonight: (payload) => doFetch("/api/plan/createTonight", { method:"POST", body: payload }),
    runtimeEvent: (payload) => doFetch("/api/plan/runtimeEvent", { method:"POST", body: payload }),
    last7: () => doFetch("/api/plan/last7")
  },
  checkin: {
    morning: (payload) => doFetch("/api/checkin/morning", { method:"POST", body: payload })
  }
};
