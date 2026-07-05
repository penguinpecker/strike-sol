// Client-side, fire-and-forget persistence hooks. These POST gameplay to the server routes, which
// write to Supabase with the secret key. Every call is best-effort and swallows errors — persistence
// must never block or break the game loop.

export interface CallRecord {
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

export function recordCall(row: CallRecord): void {
  try {
    void fetch("/api/strike/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(row),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never throws into the game loop */
  }
}

export function recordPlayer(row: { wallet: string; handle?: string | null; avatar?: string | null }): void {
  try {
    void fetch("/api/strike/player", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(row),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* noop */
  }
}

/** Attribute the connected player to whoever referred them (an X username slug). */
export function recordReferral(row: { wallet: string; handle?: string | null; referrer: string }): void {
  try {
    void fetch("/api/strike/referral", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(row),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* noop */
  }
}
