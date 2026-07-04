"use client";

import type { RefObject } from "react";
import gsap from "gsap";
import confetti from "canvas-confetti";
import { PriceFeed, type FeedSource, type FeedStatus } from "@/lib/feed/priceFeed";
import { quoteCost, validateInputs, UnwiredSigner, DriftRailError, type Side, type Signer } from "@/lib/drift/rail";
import { useStrike } from "@/lib/store";
import { config } from "@/lib/config";
import { fmt, fmt2, sol } from "@/lib/format";
import { blip, chime, thud, haptic } from "@/lib/audio";
import { loadAvatar, avatarImage, addrColor } from "@/lib/social";
import { recordCall } from "@/lib/persist";
import { marketDef } from "@/lib/drift/networks";
import { shortAddress } from "@/lib/solana/wallet";
import type { Dir, Call, Marker } from "@/lib/types";
import type { RecentTrade } from "@/lib/drift/types";

export interface EngineRefs {
  app: RefObject<HTMLDivElement | null>;
  chart: RefObject<HTMLCanvasElement | null>;
  price: RefObject<HTMLDivElement | null>;
  pnl: RefObject<HTMLDivElement | null>;
  lsub: RefObject<HTMLDivElement | null>;
  cashBtn: RefObject<HTMLButtonElement | null>;
  tleft: RefObject<HTMLDivElement | null>;
  ring: RefObject<SVGCircleElement | null>;
}

export interface EngineOpts {
  mode: "paper" | "live";
  market: string;
  roundMs: number;
  primary: "pyth" | "binance";
  pythFeedId: string;
  binanceSymbol: string;
  coinbaseProduct: string;
  network: string;
  onStatus?: (s: FeedStatus, src: FeedSource) => void;
}

type RGB = [number, number, number];
const INK: RGB = [12, 10, 22];
// fluorescent violet (#C77DFF) — the chart's neon glow; the core line stays white on top of it
const CHART: string = "199,125,255";
const WIN: RGB = [0, 230, 118];
const WIN2: RGB = [0, 78, 42];
const LOSE: RGB = [255, 59, 78];
const LOSE2: RGB = [100, 14, 22];
const lerp = (a: RGB, b: RGB, t: number): RGB =>
  a.map((v, i) => Math.round(v + (b[i] - v) * t)) as RGB;

const store = () => useStrike.getState();

export class GameEngine {
  private feed: PriceFeed;
  private signer: Signer;

  // hot-path state (NOT in React)
  private price = 0;
  private headP = 0;
  private activeCall: Call | null = null;
  // guards the multi-second live-open window: a second tap while a real order is in flight must
  // NOT open a second position. Set BEFORE the await, cleared when the open settles.
  private opening = false;

  // chart
  private pts: { t: number; p: number }[] = [];
  private pulse = 0;
  private smMn: number | null = null;
  private smMx: number | null = null;
  private readonly SPAN_MS = 80_000;
  private lastSample = 0;
  private lastPxPush = 0;
  private lastPriceText = 0;
  private bgCur: RGB = INK;

  // social pins
  private markers: Marker[] = [];
  private markerHits: { x: number; y: number; m: Marker }[] = [];
  private lastTradesPoll = 0;
  private seenTrades = new Set<string>();
  private tradesSeeded = false;

  // loops
  private rafId = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private booted = false;
  private listeners = new AbortController();

  constructor(private refs: EngineRefs, private opts: EngineOpts) {
    this.signer = new UnwiredSigner();
    this.feed = new PriceFeed({
      primary: opts.primary,
      pythFeedId: opts.pythFeedId,
      binanceSymbol: opts.binanceSymbol,
      coinbaseProduct: opts.coinbaseProduct,
      onTick: (t) => this.onPrice(t.price),
      onStatus: opts.onStatus,
    });
  }

  // ── lifecycle ──
  async init() {
    if (this.booted) return;
    this.booted = true;
    await Promise.all([this.loadSeed(), this.loadPairConfig()]);
    this.wireGlobalListeners();
    this.feed.start();
    this.tickTimer = setInterval(() => this.tick(), 260);
    const raf = () => {
      this.rafId = requestAnimationFrame(raf);
      this.draw();
    };
    raf();
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.feed.stop();
    this.listeners.abort();
    this.booted = false;
  }

  // ── data loads ──
  private async loadSeed() {
    try {
      const r = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${this.opts.binanceSymbol.toUpperCase()}&interval=1s&limit=80`,
      );
      const k = (await r.json()) as unknown[][];
      if (Array.isArray(k) && k.length) {
        this.pts = k.map((row) => ({ t: Number(row[0]), p: parseFloat(row[4] as string) }));
        const last = this.pts[this.pts.length - 1].p;
        this.price = last;
        this.headP = last;
        return;
      }
    } catch {
      /* flat seed fallback (e.g. Binance geo-blocked) — the live Pyth feed fills in instantly */
    }
    const p0 = this.price || 63000;
    const now = Date.now();
    const n = Math.floor(this.SPAN_MS / 260);
    this.pts = Array.from({ length: n }, (_, i) => ({ t: now - this.SPAN_MS + i * 260, p: p0 }));
    this.price = p0;
    this.headP = p0;
  }

  private async loadPairConfig() {
    try {
      const r = await fetch(
        `/api/drift/pair-config?symbol=${encodeURIComponent(this.opts.market)}&network=${this.opts.network}`,
      );
      if (r.ok) store().setPairConfig(await r.json());
    } catch {
      /* validation falls back to permissive */
    }
  }

  // ── price feed ──
  private onPrice(p: number) {
    this.price = p;
    if (this.headP === 0) this.headP = p;
  }
  get livePrice() {
    return this.headP;
  }

  // ── 260ms tick: sample chart, cull, advance live + tape ──
  private tick() {
    const now = Date.now();
    if (now - this.lastSample >= 240) {
      this.pts.push({ t: now, p: this.price });
      this.lastSample = now;
    }
    const cut = now - this.SPAN_MS - 4000;
    while (this.pts.length && this.pts[0].t < cut) this.pts.shift();
    if (now - this.lastPxPush > 480) {
      this.lastPxPush = now;
      store().setDisplayPrice(this.price);
    }
    if (this.activeCall) this.liveTick();
    this.pollTrades();
  }

  // The live on-chain signer is injected by the Privy bridge; null reverts to paper-only.
  // If a live position is open, keep the existing signer so its close can still fire.
  setSigner(s: Signer | null) {
    if (s === null && this.activeCall && this.opts.mode === "live") return;
    this.signer = s ?? new UnwiredSigner();
  }

  // Switch the traded market (e.g. BTC/USD <-> SOL/USD). Blocked mid-call. Swaps the price feed
  // to the new market's Pyth feed, resets the chart, and reloads its pair config; trades then
  // resolve to the new market's Drift perp automatically.
  setMarket(market: string) {
    if (this.activeCall || this.opening || market === this.opts.market) return;
    const def = marketDef(market);
    this.opts.market = market;
    this.opts.pythFeedId = def.pythFeedId;
    this.opts.binanceSymbol = def.binanceSymbol;
    this.opts.coinbaseProduct = def.coinbaseProduct;
    this.feed.stop();
    this.feed = new PriceFeed({
      primary: this.opts.primary,
      pythFeedId: def.pythFeedId,
      binanceSymbol: def.binanceSymbol,
      coinbaseProduct: def.coinbaseProduct,
      onTick: (t) => this.onPrice(t.price),
      onStatus: this.opts.onStatus,
    });
    this.pts = [];
    this.price = 0;
    this.headP = 0;
    this.smMn = null;
    this.smMx = null;
    this.markers = [];
    store().setPairConfig(null);
    store().setDisplayPrice(0);
    void this.loadSeed();
    void this.loadPairConfig();
    this.feed.start();
  }

  // Re-poll the connected wallet's real USDC shortly after a trade settles on-chain
  // (open locks collateral; close returns it ± pnl). The 20s poll is the backstop.
  private refreshBalanceSoon() {
    if (!store().refreshBalance) return;
    setTimeout(() => store().refreshBalance?.(), 2500);
    setTimeout(() => store().refreshBalance?.(), 7000);
  }

  // ── making a call (price-dependent → drives the store) ──
  uh() {
    const u = store().user;
    return u ? u.h : "you";
  }

  async makeCall(dir: Dir) {
    if (this.activeCall || this.opening) return; // guard covers the whole in-flight open window
    const s = store();
    if (!s.user) return s.showToast("connect 𝕏 to trade");
    const bal = s.solBalance ?? 0;
    const intent = { stake: s.stake, leverage: s.levSel, side: (dir > 0 ? "long" : "short") as Side };
    const lowBal = () =>
      s.showToast(bal <= 0 ? "no SOL — send some to play" : `${sol(intent.stake)} stake > your ${sol(bal)} — lower it`);
    const inp = validateInputs(intent);
    if (!inp.ok) return s.showToast(inp.reason || "bad input");
    if (intent.stake > bal) return lowBal();
    // live: enforce Drift's real leverage cap + min position, valued in USD (the stake is in SOL)
    if (this.opts.mode === "live" && s.pairConfig) {
      const cfg = s.pairConfig;
      if (intent.leverage > cfg.maxLeverage) return s.showToast(`max leverage is ${cfg.maxLeverage}x`);
      const solUsd = s.solPrice ?? 0;
      const stakeUsd = intent.stake * solUsd;
      if (solUsd > 0 && stakeUsd * intent.leverage < cfg.minPositionValue) {
        const need = Math.ceil(cfg.minPositionValue / (stakeUsd || 1));
        return need > cfg.maxLeverage
          ? s.showToast(`stake too small — raise it (min position $${cfg.minPositionValue})`)
          : s.showToast(`~$${fmt2(stakeUsd)} needs ≥${need}x to clear the $${cfg.minPositionValue} min`);
      }
    }

    let marketIndex: number | undefined;
    let openTxhash: string | undefined;
    if (this.opts.mode === "live") {
      this.opening = true;
      try {
        const r = await this.signer.openMarket({ ...intent, symbol: this.opts.market, markPrice: this.price });
        marketIndex = r.marketIndex;
        openTxhash = r.txhash;
      } catch (e) {
        this.opening = false;
        return s.showToast(e instanceof DriftRailError ? e.message : "live trade failed");
      }
    }
    // round-trip cost (taker both sides + STRIKE fee + tx) — subtracted from PnL LIVE and at
    // settle, so the running number already includes fees and doesn't jump when the round ends.
    const cost = s.pairConfig
      ? quoteCost({ stake: s.stake, leverage: s.levSel, side: intent.side }, s.pairConfig, config.platformFeeRate).roundTripCost
      : 0;
    const call: Call = {
      dir,
      entry: this.price,
      lev: s.levSel,
      stake: s.stake,
      t0: Date.now(),
      dur: this.opts.roundMs,
      value: s.stake,
      cost,
      marketIndex,
      txhash: openTxhash,
    };
    this.activeCall = call;
    this.opening = false;
    s.startCall(call);
    this.refreshBalanceSoon();
    haptic(20);
    blip(420, 0.08);
    this.addMarker(this.uh(), dir, "in", 0, call.lev);
  }

  private liveTick() {
    const c = this.activeCall!;
    const t = Date.now() - c.t0;
    const move = ((this.price - c.entry) / c.entry) * c.dir;
    c.value = Math.max(0, c.stake * (1 + move * c.lev));
    const left = Math.max(0, c.dur - t);
    if (left <= 5000 && left > 0 && Math.ceil(left / 1000) !== c._lastS) {
      c._lastS = Math.ceil(left / 1000);
      blip(600 + (5 - c._lastS) * 80, 0.05);
      haptic(8);
    }
    if (c.value - (c.cost ?? 0) <= 0) return this.resolve("bust");
    if (t >= c.dur) return this.resolve("buzzer");
  }

  cashOut() {
    if (!this.activeCall) return;
    const c = this.activeCall;
    const move = ((this.price - c.entry) / c.entry) * c.dir;
    c.value = Math.max(0, c.stake * (1 + move * c.lev));
    this.resolve("cash");
  }

  // Close the real position on-chain when a live call settles. The UI settles on the local loop
  // immediately; the chain close reconciles in the background with one retry (Drift nets one
  // position per market, so closing the market closes the position this call opened).
  private liveClose(c: Call) {
    if (this.opts.mode !== "live") return;
    const attempt = (n: number): Promise<unknown> =>
      this.signer.closeMarket({ symbol: this.opts.market, slippage: 0.02 }).catch((e) => {
        if (n < 1) return attempt(n + 1);
        console.warn("[strike] live close failed", e);
        store().showToast(e instanceof DriftRailError ? e.message : "on-chain close pending — check your Drift positions");
      });
    void attempt(0);
  }

  private resolve(how: "bust" | "buzzer" | "cash") {
    const c = this.activeCall!;
    this.activeCall = null;
    this.liveClose(c);
    const s = store();
    const cost =
      c.cost ??
      (s.pairConfig
        ? quoteCost(
            { stake: c.stake, leverage: c.lev, side: c.dir > 0 ? "long" : "short" },
            s.pairConfig,
            config.platformFeeRate,
          ).roundTripCost
        : 0);
    const value = Math.max(0, c.value - cost);
    const win = value > c.stake;
    const pnl = value - c.stake;
    const pct = Math.round((pnl / c.stake) * 100);
    const streak = win ? s.streak + 1 : 0;
    this.addMarker(this.uh(), c.dir, "out", pct, c.lev);
    const fid = s.nextFeedId();
    const secs = Math.round((Date.now() - c.t0) / 1000);
    s.endCall(
      { how, win, pnl, pct, entry: c.entry, dir: c.dir, lev: c.lev, secs, streak },
      { id: fid, nm: "you", you: true, dir: c.dir, pnl, done: true },
    );
    // persist the settled call to Supabase (fire-and-forget; never blocks the game)
    recordCall({
      wallet: s.myAddress,
      handle: s.user?.h ?? null,
      symbol: this.opts.market,
      dir: c.dir,
      entry: c.entry,
      lev: c.lev,
      stake: c.stake,
      mode: this.opts.mode,
      how,
      win,
      pnl,
      pct,
      secs,
      txhash: c.txhash ?? null,
    });
    this.refreshBalanceSoon();
    if (win) {
      this.confettiBurst();
      chime();
    } else {
      thud();
      const app = this.refs.app.current;
      if (app) gsap.fromTo(app, { x: 0 }, { keyframes: { x: [-8, 8, -5, 3, 0] }, duration: 0.4 });
    }
    haptic(win ? [20, 40, 20] : 60);
  }

  // ── social / tape / markers ──
  private addMarker(h: string, dir: Dir, kind: "in" | "out", pnlPct: number, lev: number) {
    loadAvatar(h);
    this.markers.push({ t: Date.now(), price: this.price, dir, h, kind, pnl: pnlPct || 0, lev: lev || 10 });
    while (this.markers.length > 16) this.markers.shift();
  }

  // Poll REAL on-chain trades → the live feed + sentiment counts. Best-effort: Drift's public data
  // API is gated, so the tape may be quiet — the game does not depend on it.
  private async pollTrades() {
    const now = Date.now();
    if (now - this.lastTradesPoll < 8000) return;
    this.lastTradesPoll = now;
    try {
      const r = await fetch(`/api/drift/trades?network=${this.opts.network}&limit=80`);
      if (!r.ok) return;
      const trades = (await r.json()) as RecentTrade[];
      if (!Array.isArray(trades) || !trades.length) return;
      const s = store();
      const longs = trades.filter((t) => t.isLong).length;
      s.setCounts(longs, trades.length - longs); // real long/short sentiment
      // real leaderboard: aggregate recent on-chain trades by account, rank by realized pnl
      const agg = new Map<string, { pnl: number; count: number }>();
      for (const t of trades) {
        const e = agg.get(t.account) ?? { pnl: 0, count: 0 };
        e.pnl += t.pnl;
        e.count += 1;
        agg.set(t.account, e);
      }
      s.setLeaderboard(
        [...agg.entries()]
          .map(([account, v]) => ({ account, pnl: v.pnl, count: v.count }))
          .sort((a, b) => b.pnl - a.pnl)
          .slice(0, 6),
      );
      const key = (t: RecentTrade) => `${t.account}:${t.ts}:${t.marketIndex}:${t.price}`;
      // API is newest-first; add oldest→newest so the newest lands on top of the feed.
      const ordered = [...trades].reverse();
      const toAdd = this.tradesSeeded ? ordered : ordered.slice(-10);
      for (const t of toAdd) {
        if (this.seenTrades.has(key(t))) continue;
        this.seenTrades.add(key(t));
        // skip the connected user's own trades — they already appear via the local "you" item.
        if (s.myAddress && t.account.toLowerCase() === s.myAddress) continue;
        const id = s.nextFeedId();
        const item = {
          id,
          account: t.account,
          nm: shortAddress(t.account),
          col: addrColor(t.account),
          sym: t.symbol,
          dir: (t.isLong ? 1 : -1) as Dir,
          done: !t.isOpen,
          pnl: t.pnl,
          ts: t.ts,
          lev: t.leverage,
        };
        s.addFeed(item);
        if (t.isOpen) s.addNoti(item);
      }
      if (!this.tradesSeeded) {
        for (const t of ordered) this.seenTrades.add(key(t));
        this.tradesSeeded = true;
      }
      if (this.seenTrades.size > 400) this.seenTrades = new Set([...this.seenTrades].slice(-200));
    } catch {
      /* network */
    }
  }

  // ── chart-pin hit-testing → KOL card (store) ──
  private hitMarker(e: MouseEvent | PointerEvent): Marker | null {
    const c = this.refs.chart.current;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const cx = e.clientX - r.left,
      cy = e.clientY - r.top;
    let best: Marker | null = null,
      bd = 20;
    for (const hh of this.markerHits) {
      const d = Math.hypot(hh.x - cx, hh.y - cy);
      if (d < bd) {
        bd = d;
        best = hh.m;
      }
    }
    return best;
  }

  private openKol(m: Marker) {
    const u = store().user;
    const resolvedHandle = m.h === "you" ? (u ? u.h : null) : m.h;
    const live = m.kind === "in";
    const pct = live ? m.dir * ((this.headP - m.price) / m.price) * (m.lev || 10) * 100 : m.pnl;
    store().setKol({ handle: m.h, resolvedHandle, live, pct, dir: m.dir, entry: m.price, lev: m.lev || 10 });
    haptic(12);
    blip(520, 0.06);
  }

  private wireGlobalListeners() {
    const sig = this.listeners.signal;
    addEventListener(
      "keydown",
      (e) => {
        if (e.repeat) return;
        const s = store();
        if (s.resolve) {
          if (e.key === "Enter" || e.key.toLowerCase() === "r") s.clearResolve();
          return;
        }
        if (s.sheet || s.kol) return;
        if (!this.activeCall && !this.opening) {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            this.makeCall(1);
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            this.makeCall(-1);
          }
        } else if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          this.cashOut();
        }
      },
      { signal: sig },
    );
    document.addEventListener(
      "click",
      (e) => {
        const t = e.target as HTMLElement;
        if (t?.closest?.("button,a,input,.np,.sk,nav,[data-overlay],header,#cash")) return;
        const m = this.hitMarker(e);
        if (m) this.openKol(m);
      },
      { signal: sig },
    );
    document.addEventListener(
      "pointermove",
      (e) => {
        const t = e.target as HTMLElement;
        if (t?.closest?.("button,a,input,.np,nav,[data-overlay]")) return;
        document.body.style.cursor = this.hitMarker(e) ? "pointer" : "";
      },
      { signal: sig },
    );
  }

  // ── juice ──
  private confettiBurst() {
    const e = Date.now() + 700;
    const fr = () => {
      confetti({
        particleCount: 6,
        angle: 90,
        spread: 90,
        startVelocity: 45,
        origin: { x: 0.5, y: 0.45 },
        colors: ["#fff", "#CFFFE2", "#FFD166"],
      });
      if (Date.now() < e) requestAnimationFrame(fr);
    };
    fr();
  }

  // ── the 60fps render: canvas + hot-path text + eased background ──
  private draw() {
    this.headP += (this.price - this.headP) * 0.24;
    this.drawBackground();
    this.drawChart();
    this.drawHud();
  }

  private targetBG(): RGB {
    const s = store();
    if (this.activeCall) {
      const c = this.activeCall;
      const pnl = Math.max(0, c.value - (c.cost ?? 0)) - c.stake;
      const inten = Math.min(1, Math.abs(pnl) / (c.stake * 0.8));
      return pnl >= 0 ? lerp(WIN, WIN2, Math.min(1, inten * 0.7)) : lerp(LOSE, LOSE2, Math.min(1, inten * 0.7));
    }
    if (s.resolve) return s.resolve.win ? lerp(WIN, WIN2, 0.7) : lerp(LOSE, LOSE2, 0.7);
    return INK;
  }

  private drawBackground() {
    const app = this.refs.app.current;
    if (!app) return;
    const tgt = this.targetBG();
    this.bgCur = lerp(this.bgCur, tgt, 0.12);
    const col = `rgb(${this.bgCur[0]},${this.bgCur[1]},${this.bgCur[2]})`;
    app.style.backgroundColor = col;
    const meta = document.querySelector("meta[name=theme-color]");
    if (meta) meta.setAttribute("content", col);
  }

  private drawHud() {
    if (!this.activeCall) {
      // ~4 ticks/sec off the RAW live price, with moving cents (rendered small) so the number
      // visibly ticks and reads as a live, sensitive ticker even when the price barely moves.
      const now = Date.now();
      if (now - this.lastPriceText >= 250) {
        this.lastPriceText = now;
        const price = this.refs.price.current;
        if (price) {
          const p = this.price;
          const cents = (Math.abs(p) % 1).toFixed(2).slice(1); // ".42"
          price.innerHTML = "<small>$</small>" + fmt(Math.floor(p)) + `<small>${cents}</small>`;
        }
      }
      return;
    }
    const c = this.activeCall;
    const move = ((this.headP - c.entry) / c.entry) * c.dir;
    // net of the round-trip fees (same cost applied at settle) so the live PnL doesn't jump
    const val = Math.max(0, c.stake * (1 + move * c.lev) - (c.cost ?? 0));
    const pnl = val - c.stake;
    const pnlEl = this.refs.pnl.current;
    if (pnlEl) pnlEl.textContent = (pnl >= 0 ? "+" : "−") + sol(Math.abs(pnl), 4);
    const lsub = this.refs.lsub.current;
    if (lsub) lsub.textContent = `${this.opts.market.split("/")[0]} $${fmt2(this.headP)} · entry $${fmt2(c.entry)} · ${c.lev}x`;
    const cashBtn = this.refs.cashBtn.current;
    if (cashBtn) cashBtn.textContent = "CASH OUT · " + sol(val, 4);
    const now = Date.now();
    const left = Math.max(0, c.dur - (now - c.t0));
    const tleft = this.refs.tleft.current;
    if (tleft) tleft.textContent = String(Math.ceil(left / 1000));
    const ring = this.refs.ring.current;
    if (ring) ring.style.strokeDashoffset = String(144.5 * (1 - left / c.dur));
  }

  private drawChart() {
    const cv = this.refs.chart.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth,
      H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const x = cv.getContext("2d");
    if (!x) return;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, W, H);
    if (this.pts.length < 2) return;
    const now = Date.now();
    const RG = W * 0.045,
      TOP = H * 0.05,
      BH = H * 0.86;
    const pxMs = (W - RG) / this.SPAN_MS;
    const X = (t: number) => W - RG - (now - t) * pxMs;
    let mn = Infinity,
      mx = -Infinity;
    for (const q of this.pts) {
      if (q.p < mn) mn = q.p;
      if (q.p > mx) mx = q.p;
    }
    mn = Math.min(mn, this.headP);
    mx = Math.max(mx, this.headP);
    if (this.activeCall) {
      mn = Math.min(mn, this.activeCall.entry);
      mx = Math.max(mx, this.activeCall.entry);
    }
    // tighter padding + faster range adaptation = a more sensitive chart (small moves read bigger)
    const pad = (mx - mn) * 0.07 || 0.3;
    mn -= pad;
    mx += pad;
    this.smMn = this.smMn == null ? mn : this.smMn + (mn - this.smMn) * 0.17;
    this.smMx = this.smMx == null ? mx : this.smMx + (mx - this.smMx) * 0.17;
    const sMn = this.smMn,
      sMx = this.smMx;
    const Y = (p: number) => TOP + (1 - (p - sMn) / (sMx - sMn || 1)) * BH;
    const AC = CHART;

    x.font = "700 11px JetBrains Mono";
    x.textAlign = "right";
    for (let g = 0; g < 5; g++) {
      const gy = TOP + (g / 4) * BH,
        gp = sMx - (g / 4) * (sMx - sMn);
      x.strokeStyle = "rgba(255,255,255,.05)";
      x.lineWidth = 1;
      x.beginPath();
      x.moveTo(0, gy);
      x.lineTo(W, gy);
      x.stroke();
      x.fillStyle = "rgba(255,255,255,.35)";
      x.fillText("$" + fmt(gp), W - 10, gy - 5);
    }
    const path = () => {
      x.beginPath();
      let st = false;
      for (const q of this.pts) {
        const qx = X(q.t);
        if (qx < -12) continue;
        const qy = Y(q.p);
        st ? x.lineTo(qx, qy) : (x.moveTo(qx, qy), (st = true));
      }
      x.lineTo(W - RG, Y(this.headP));
    };
    path();
    x.lineTo(W - RG, H);
    x.lineTo(0, H);
    x.closePath();
    const gr = x.createLinearGradient(0, TOP, 0, H);
    gr.addColorStop(0, `rgba(${AC},.14)`);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = gr;
    x.fill();
    x.lineJoin = "round";
    x.lineCap = "round";
    path();
    x.strokeStyle = `rgba(${AC},.10)`;
    x.lineWidth = 11;
    x.stroke();
    path();
    x.strokeStyle = `rgba(${AC},.22)`;
    x.lineWidth = 6;
    x.stroke();
    path();
    x.strokeStyle = "rgba(255,255,255,.95)";
    x.lineWidth = 2.6;
    x.stroke();
    if (this.activeCall) {
      const ey = Y(this.activeCall.entry);
      x.setLineDash([7, 7]);
      x.strokeStyle = "rgba(255,255,255,.75)";
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(0, ey);
      x.lineTo(W, ey);
      x.stroke();
      x.setLineDash([]);
      x.fillStyle = "rgba(255,255,255,.85)";
      x.textAlign = "left";
      x.font = "800 12px JetBrains Mono";
      x.fillText("ENTRY $" + fmt(this.activeCall.entry), 12, ey - 8);
    }
    // social pins
    this.markers = this.markers.filter((m) => X(m.t) > -24);
    this.markerHits.length = 0;
    for (const m of this.markers) {
      const mx2 = X(m.t),
        my2 = Y(m.price);
      this.markerHits.push({ x: mx2, y: my2, m });
      const ring = m.kind === "out" ? (m.pnl >= 0 ? "#00E676" : "#FF3B4E") : "#FFFFFF";
      x.beginPath();
      x.arc(mx2, my2, 13, 0, 7);
      x.fillStyle = ring;
      x.fill();
      x.save();
      x.beginPath();
      x.arc(mx2, my2, 11, 0, 7);
      x.clip();
      const im = avatarImage(m.h);
      if (im && im.complete && im.naturalWidth) {
        try {
          x.drawImage(im, mx2 - 11, my2 - 11, 22, 22);
        } catch {
          /* decoding */
        }
      } else {
        x.fillStyle = "#2a2a2e";
        x.fillRect(mx2 - 11, my2 - 11, 22, 22);
        x.fillStyle = "#fff";
        x.font = '800 12px "Baloo 2"';
        x.textAlign = "center";
        x.fillText((m.h[0] || "?").toUpperCase(), mx2, my2 + 4);
      }
      x.restore();
      if (m.kind === "in") {
        x.fillStyle = m.dir > 0 ? "#00FF85" : "#FF3B4E";
        x.beginPath();
        if (m.dir > 0) {
          x.moveTo(mx2, my2 - 22);
          x.lineTo(mx2 - 5, my2 - 15);
          x.lineTo(mx2 + 5, my2 - 15);
        } else {
          x.moveTo(mx2, my2 + 22);
          x.lineTo(mx2 - 5, my2 + 15);
          x.lineTo(mx2 + 5, my2 + 15);
        }
        x.closePath();
        x.fill();
      } else {
        const txt = (m.pnl >= 0 ? "+" : "") + m.pnl.toFixed(0) + "%";
        x.font = '800 11px "JetBrains Mono"';
        const tw = x.measureText(txt).width + 12;
        x.fillStyle = m.pnl >= 0 ? "rgba(0,220,110,.95)" : "rgba(255,59,78,.95)";
        x.beginPath();
        x.roundRect(mx2 + 15, my2 - 9, tw, 18, 7);
        x.fill();
        x.fillStyle = "#fff";
        x.textAlign = "left";
        x.fillText(txt, mx2 + 21, my2 + 4);
      }
    }
    // live head dot
    this.pulse += 0.16;
    const lx = W - RG,
      ly = Y(this.headP);
    x.beginPath();
    x.arc(lx, ly, 8 + Math.sin(this.pulse) * 2.5, 0, 7);
    x.fillStyle = `rgba(${AC},.25)`;
    x.fill();
    x.beginPath();
    x.arc(lx, ly, 4.5, 0, 7);
    x.fillStyle = `rgb(${AC})`;
    x.fill();
    x.beginPath();
    x.arc(lx, ly, 7, 0, 7);
    x.strokeStyle = `rgba(${AC},.45)`;
    x.lineWidth = 2;
    x.stroke();
  }
}
