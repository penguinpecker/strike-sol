// Shared game-domain types for STRIKE.

export type Dir = 1 | -1;

export interface Call {
  dir: Dir;
  entry: number;
  lev: number;
  stake: number;
  t0: number;
  dur: number;
  value: number;
  cost?: number; // round-trip fee (position fee x2 + tx), applied to PnL live and at settle
  _lastS?: number;
  orderKey?: string; // GMX order key of the live open (fill tracking / debugging)
  txhash?: string; // live open tx hash (for persistence)
}

export interface FeedItem {
  id: number;
  nm: string;
  col?: string;
  sym?: string; // market symbol for real on-chain trades (e.g. "ETH/USD")
  dir: Dir;
  entry?: number;
  done: boolean;
  pnl: number;
  you?: boolean;
  account?: string; // raw 0x address (for resolving a real 𝕏 identity at display time)
  ts?: number; // trade timestamp (ms) for "time ago"
  lev?: number; // leverage (notional / collateral)
}

export interface HistItem {
  dir: Dir;
  pnl: number;
  win: boolean;
}

// A real trader on the live leaderboard (aggregated from on-chain trades).
export interface LeaderEntry {
  account: string;
  pnl: number; // total realized pnl (USDC)
  count: number; // trades seen
}

// On-chart social-proof pin (entry chevron / exit pnl tag), time-anchored.
export interface Marker {
  t: number;
  price: number;
  dir: Dir;
  h: string; // handle (twitter) or "you"
  kind: "in" | "out";
  pnl: number;
  lev: number;
}

export type ResolveHow = "bust" | "buzzer" | "cash";

export interface ResolveData {
  how: ResolveHow;
  win: boolean;
  pnl: number;
  pct: number;
  entry: number;
  dir: Dir;
  lev: number;
  secs: number;
  streak: number;
}

export interface KolData {
  handle: string; // "you" or twitter handle
  resolvedHandle: string | null; // the actual @handle (null if you + not connected)
  live: boolean;
  pct: number;
  dir: Dir;
  entry: number;
  lev: number;
}

export type Tab = "call" | "feed" | "ranks" | "you";
