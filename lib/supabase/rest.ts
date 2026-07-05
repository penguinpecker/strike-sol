// Server-only Supabase writer. Persists STRIKE gameplay to the "strike" Supabase project via
// PostgREST + the secret key (bypasses RLS). No SDK dependency — just fetch. Every function is a
// graceful no-op when Supabase env vars are missing, so the game never breaks if it's unconfigured.

import "server-only";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const supabaseConfigured = () => !!URL && !!SECRET;

function headers(extra: Record<string, string> = {}) {
  return {
    apikey: SECRET,
    authorization: `Bearer ${SECRET}`,
    "content-type": "application/json",
    ...extra,
  };
}

async function post(path: string, body: unknown, prefer: string): Promise<boolean> {
  if (!supabaseConfigured()) return false;
  try {
    const r = await fetch(`${URL}/rest/v1/${path}`, {
      method: "POST",
      headers: headers({ prefer }),
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return r.ok;
  } catch {
    return false;
  }
}

export interface CallRow {
  wallet?: string | null;
  handle?: string | null;
  symbol?: string;
  dir: number;
  entry?: number;
  lev?: number;
  stake?: number;
  mode?: string;
  how?: string;
  win?: boolean;
  pnl?: number;
  pct?: number;
  secs?: number;
  txhash?: string | null;
}

export interface PlayerRow {
  wallet: string;
  handle?: string | null;
  avatar?: string | null;
}

export interface ReferralRow {
  referee_wallet: string;
  referee_handle?: string | null;
  referrer_handle: string; // an X username slug
}

/** Insert one settled call. */
export function insertCall(row: CallRow): Promise<boolean> {
  return post("strike_calls", row, "return=minimal");
}

/** Upsert a player by wallet (updates handle/avatar/last_seen on repeat). */
export function upsertPlayer(row: PlayerRow): Promise<boolean> {
  return post(
    "strike_players?on_conflict=wallet",
    { ...row, last_seen: new Date().toISOString() },
    "return=minimal,resolution=merge-duplicates",
  );
}

/** Record who referred a player. First-touch: ignore-duplicates keeps the original referrer, so a
 *  later visit through someone else's link never re-attributes the referee. */
export function insertReferral(row: ReferralRow): Promise<boolean> {
  return post("strike_referrals?on_conflict=referee_wallet", row, "return=minimal,resolution=ignore-duplicates");
}
