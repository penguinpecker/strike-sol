"use client";

// First-touch referral capture. A shared link carries the sharer's X username as a slug —
// `strikeit.app/?ref=<username>`. We store it once (localStorage) so it survives navigation until
// the visitor signs up, then attribute their signup to that referrer. First touch wins; a later
// `?ref` never overwrites an existing one.

const KEY = "strike_ref";

/** Read `?ref=` from the URL on load, normalize it, and store it (first-touch only). Strips it from
 *  the visible URL so the referred user's own address bar doesn't carry someone else's ref. */
export function captureRef(): void {
  if (typeof window === "undefined") return;
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("ref");
    if (!raw) return;
    const ref = raw.trim().replace(/^@/, "").slice(0, 40);
    if (ref && /^[A-Za-z0-9_]+$/.test(ref) && !localStorage.getItem(KEY)) {
      localStorage.setItem(KEY, ref);
    }
    // clean the URL (keep other params, drop ref)
    params.delete("ref");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
  } catch {
    /* private mode / no storage — referral just isn't captured */
  }
}

/** The stored referrer's X username, or null. */
export function getRef(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
