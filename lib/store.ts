"use client";

import { create } from "zustand";
import type {
  Call,
  Dir,
  FeedItem,
  HistItem,
  KolData,
  LeaderEntry,
  ResolveData,
  Tab,
} from "./types";
import type { GmxPairConfig } from "./gmx/types";
import { config } from "./config";

// Discrete game state (everything React renders). The 60fps hot path — price, pnl,
// chart, timer — is NOT here; it lives in the imperative GameEngine driving refs.

export type SheetType = "feed" | "ranks" | "you" | "x" | "wallet" | "deposit" | "withdraw" | null;

interface StrikeState {
  market: string; // the market being traded, e.g. "BTC/USD" (switchable BTC <-> AVAX)
  stake: number;
  levSel: number;
  streak: number;
  hits: number;
  total: number;
  call: Call | null;
  hist: HistItem[];
  feed: FeedItem[]; // running list (sheet)
  notis: FeedItem[]; // live left-rail pills (max 5)
  upN: number;
  downN: number;
  leaderboard: LeaderEntry[];
  // wallet-address (0x…, lowercased) -> resolved 𝕏 identity (name + avatar). Seeded with the
  // connected user; extensible to other STRIKE users. Unknown addrs render as identicons.
  identities: Record<string, { name: string; avatar: string | null }>;
  myAddress: string | null; // connected wallet's 0x address (lowercased) — to dedupe the user's own trades
  user: { h: string } | null;
  tab: Tab;
  sheet: SheetType;
  resolve: ResolveData | null;
  kol: KolData | null;
  toast: { msg: string; id: number } | null;
  pairConfig: GmxPairConfig | null;
  displayPrice: number; // throttled (~2/s) live price for low-frequency UI (win-hint)
  feedStatus: { status: string; source: string };
  avaxBalance: number | null; // connected user's native AVAX (stake + gas; null = unknown)
  avaxPrice: number | null; // live AVAX/USD (to value AVAX stakes for the on-chain min-size check)
  // live withdraw handler (native AVAX transfer out), registered by the signer bridge
  withdrawFn: ((amount: number, dest: string) => Promise<{ txhash?: string }>) | null;
  // re-poll the connected wallet's real AVAX balance now (registered by the auth provider)
  refreshBalance: (() => void) | null;
  _fid: number;

  // pure actions
  setMarket: (m: string) => void;
  setStake: (s: number) => void;
  setLev: (l: number) => void;
  setUser: (h: string | null) => void;
  setTab: (t: Tab) => void;
  openSheet: (t: SheetType) => void;
  closeSheet: () => void;
  showToast: (msg: string) => void;
  setKol: (k: KolData | null) => void;
  setPairConfig: (c: GmxPairConfig | null) => void;
  setDisplayPrice: (p: number) => void;
  setFeedStatus: (status: string, source: string) => void;
  setAvaxBalance: (b: number | null) => void;
  setAvaxPrice: (p: number | null) => void;
  setWithdrawFn: (f: StrikeState["withdrawFn"]) => void;
  setRefreshBalance: (f: StrikeState["refreshBalance"]) => void;

  // game-state mutations (called by the engine with price-derived values)
  startCall: (call: Call) => void;
  endCall: (r: ResolveData, feed: FeedItem) => void;
  clearResolve: () => void;

  // feed / notis
  nextFeedId: () => number;
  addFeed: (f: FeedItem) => void;
  addNoti: (f: FeedItem) => void;
  resolveNoti: (id: number, pnl: number) => void;
  removeNoti: (id: number) => void;
  setCounts: (up: number, down: number) => void;
  setLeaderboard: (l: LeaderEntry[]) => void;
  setIdentity: (addr: string, id: { name: string; avatar: string | null }) => void;
  setMyAddress: (a: string | null) => void;
}

export const useStrike = create<StrikeState>((set, get) => ({
  market: config.market,
  stake: 0.5,
  levSel: 10,
  streak: 0,
  hits: 0,
  total: 0,
  call: null,
  hist: [],
  feed: [],
  notis: [],
  upN: 0,
  downN: 0,
  leaderboard: [],
  identities: {},
  myAddress: null,
  user: null,
  tab: "call",
  sheet: null,
  resolve: null,
  kol: null,
  toast: null,
  pairConfig: null,
  displayPrice: 0,
  feedStatus: { status: "connecting", source: "none" },
  avaxBalance: null,
  avaxPrice: null,
  withdrawFn: null,
  refreshBalance: null,
  _fid: 1,

  setMarket: (m) => set({ market: m }),
  setStake: (s) => set({ stake: s }),
  setLev: (l) => set({ levSel: l }),
  setUser: (h) => set({ user: h ? { h } : null }),
  setTab: (t) => set({ tab: t }),
  openSheet: (t) => set({ sheet: t }),
  closeSheet: () => set({ sheet: null }),
  showToast: (msg) => set({ toast: { msg, id: Date.now() } }),
  setKol: (k) => set({ kol: k }),
  setPairConfig: (c) => set({ pairConfig: c }),
  setDisplayPrice: (p) => set({ displayPrice: p }),
  setFeedStatus: (status, source) => set({ feedStatus: { status, source } }),
  setAvaxBalance: (b) => set({ avaxBalance: b }),
  setAvaxPrice: (p) => set({ avaxPrice: p }),
  setWithdrawFn: (f) => set({ withdrawFn: f }),
  setRefreshBalance: (f) => set({ refreshBalance: f }),

  startCall: (call) => set({ call, resolve: null }),

  endCall: (r, feed) =>
    set((s) => ({
      call: null,
      streak: r.win ? s.streak + 1 : 0,
      hits: r.win ? s.hits + 1 : s.hits,
      total: s.total + 1,
      hist: [{ dir: r.dir, pnl: r.pnl, win: r.win }, ...s.hist],
      feed: [feed, ...s.feed].slice(0, 30),
      resolve: r,
    })),

  clearResolve: () => set({ resolve: null }),

  nextFeedId: () => {
    const id = get()._fid;
    set({ _fid: id + 1 });
    return id;
  },
  addFeed: (f) => set((s) => ({ feed: [f, ...s.feed].slice(0, 30) })),
  addNoti: (f) => set((s) => ({ notis: [f, ...s.notis].slice(0, 5) })),
  resolveNoti: (id, pnl) =>
    set((s) => ({
      notis: s.notis.map((n) => (n.id === id ? { ...n, done: true, pnl } : n)),
      feed: s.feed.map((f) => (f.id === id ? { ...f, done: true, pnl } : f)),
    })),
  removeNoti: (id) => set((s) => ({ notis: s.notis.filter((n) => n.id !== id) })),
  setCounts: (up, down) => set({ upN: up, downN: down }),
  setLeaderboard: (l) => set({ leaderboard: l }),
  setIdentity: (addr, id) => set((s) => ({ identities: { ...s.identities, [addr.toLowerCase()]: id } })),
  setMyAddress: (a) => set({ myAddress: a ? a.toLowerCase() : null }),
}));

// Direction helper used across the UI.
export const dirLabel = (d: Dir, full = false) =>
  d > 0 ? (full ? "↑ HIGHER" : "↑ higher") : full ? "↓ LOWER" : "↓ lower";
