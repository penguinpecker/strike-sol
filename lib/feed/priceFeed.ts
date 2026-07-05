// Real-time price feed for the chart + settlement reference.
//
//   primary:  gmxinfra tickers — the public mirror of the Chainlink Data Streams reports GMX
//             keepers fill against, so the number you watch is the number your position fills at
//             (no display-vs-fill divergence). REST at a 1s server cadence; we poll at 700ms.
//   fallback: Binance trade stream (wss) → Coinbase ticker (wss) → REST polling.
//
// A staleness watchdog forces failover if the active source silently stops ticking (a stalled
// poll loop or a half-open socket), so the chart never freezes on a live-looking-but-dead price.
// Client-side only.

import { GMX_ORACLE_URL } from "@/lib/gmx/networks";

export type FeedSource = "gmx" | "binance" | "coinbase" | "rest" | "none";
export interface PriceTick {
  price: number;
  ts: number; // local receive time (ms)
  source: FeedSource;
}
export type FeedStatus = "connecting" | "live" | "reconnecting" | "down";

interface FeedOpts {
  primary: "gmx" | "binance";
  base: string; // gmxinfra tokenSymbol, e.g. "BTC" / "AVAX"
  indexTokenDecimals: number; // raw ticker scale = USD*1e30 / 10^decimals
  binanceSymbol: string; // e.g. "btcusdt"
  coinbaseProduct: string; // e.g. "BTC-USD"
  onTick: (t: PriceTick) => void;
  onStatus?: (s: FeedStatus, source: FeedSource) => void;
}

const STALE_MS = 6000; // no tick for this long on a "live" source → treat as dead, fail over
const GMX_POLL_MS = 700;

export class PriceFeed {
  private ws: WebSocket | null = null;
  private gmxTimer: ReturnType<typeof setInterval> | null = null;
  private restTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private source: FeedSource = "none";
  private attempts = 0;
  private stopped = false;
  private last = 0;
  private lastTickAt = 0;
  private gmxErrors = 0;

  constructor(private opts: FeedOpts) {}

  start() {
    this.stopped = false;
    this.lastTickAt = Date.now();
    this.startWatchdog();
    if (this.opts.primary === "gmx") this.connectGmx();
    else this.connectBinance();
  }

  stop() {
    this.stopped = true;
    this.cleanup();
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
  }

  get latest() {
    return this.last;
  }
  get currentSource() {
    return this.source;
  }

  private status(s: FeedStatus) {
    this.opts.onStatus?.(s, this.source);
  }

  private emit(price: number, source: FeedSource) {
    if (!Number.isFinite(price) || price <= 0) return;
    this.last = price;
    this.lastTickAt = Date.now();
    this.opts.onTick({ price, ts: this.lastTickAt, source });
  }

  // If the active source goes quiet while claiming "live", tear it down and fail over.
  private startWatchdog() {
    this.watchdog = setInterval(() => {
      if (this.stopped || this.source === "none") return;
      if (Date.now() - this.lastTickAt > STALE_MS) {
        this.status("reconnecting");
        this.cleanup();
        this.failover();
      }
    }, 2000);
  }

  private cleanup() {
    if (this.ws) {
      try {
        this.ws.onopen = this.ws.onmessage = this.ws.onerror = this.ws.onclose = null;
        this.ws.close();
      } catch {
        /* noop */
      }
      this.ws = null;
    }
    if (this.gmxTimer) {
      clearInterval(this.gmxTimer);
      this.gmxTimer = null;
    }
    if (this.restTimer) {
      clearInterval(this.restTimer);
      this.restTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ── gmxinfra tickers (primary) — the fill-basis price, polled at 700ms ──
  private connectGmx() {
    if (this.stopped) return;
    this.source = "gmx";
    this.status(this.attempts === 0 ? "connecting" : "reconnecting");
    this.gmxErrors = 0;
    const scale = 10 ** (30 - this.opts.indexTokenDecimals);
    let inflight = false;
    const poll = async () => {
      if (inflight || this.stopped) return;
      inflight = true;
      try {
        const r = await fetch(`${GMX_ORACLE_URL}/prices/tickers`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const list = (await r.json()) as { tokenSymbol: string; minPrice: string; maxPrice: string }[];
        const t = list.find((x) => x.tokenSymbol === this.opts.base);
        if (!t) throw new Error("no ticker");
        const mid = (Number(t.minPrice) + Number(t.maxPrice)) / 2;
        this.emit(mid / scale, "gmx");
        this.gmxErrors = 0;
        this.attempts = 0;
        this.status("live");
      } catch {
        // transient errors ride; a burst of failures escalates to Binance before the watchdog bites
        this.gmxErrors++;
        if (this.gmxErrors >= 4) {
          this.cleanup();
          this.connectBinance();
        }
      } finally {
        inflight = false;
      }
    };
    void poll();
    this.gmxTimer = setInterval(poll, GMX_POLL_MS);
  }

  // ── Binance (fallback / alt-primary) ──
  private connectBinance() {
    if (this.stopped) return;
    this.source = "binance";
    this.status(this.attempts === 0 ? "connecting" : "reconnecting");
    const url = `wss://stream.binance.com:9443/ws/${this.opts.binanceSymbol}@trade`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return this.connectCoinbase();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.status("live");
    };
    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data as string);
        if (d.p) this.emit(parseFloat(d.p), "binance");
      } catch {
        /* ignore malformed frame */
      }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (this.stopped) return;
      if (this.attempts < 2) {
        this.attempts++;
        this.scheduleReconnect(() => this.connectBinance());
      } else {
        this.attempts = 0;
        this.connectCoinbase();
      }
    };
  }

  // ── Coinbase (fallback) ──
  private connectCoinbase() {
    if (this.stopped) return;
    this.source = "coinbase";
    this.status("reconnecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");
    } catch {
      return this.startRest();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.status("live");
      ws.send(
        JSON.stringify({
          type: "subscribe",
          product_ids: [this.opts.coinbaseProduct],
          channels: ["ticker"],
        }),
      );
    };
    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data as string);
        if (d.type === "ticker" && d.price) this.emit(parseFloat(d.price), "coinbase");
      } catch {
        /* ignore */
      }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (this.stopped) return;
      if (this.attempts < 2) {
        this.attempts++;
        this.scheduleReconnect(() => this.connectCoinbase());
      } else {
        this.attempts = 0;
        this.startRest();
      }
    };
  }

  // ── REST polling (last resort) — Coinbase spot (works where Binance REST is geo-blocked) ──
  private startRest() {
    if (this.stopped) return;
    this.source = "rest";
    this.status("reconnecting");
    const poll = async () => {
      try {
        const r = await fetch(
          `https://api.exchange.coinbase.com/products/${this.opts.coinbaseProduct}/ticker`,
        );
        if (!r.ok) throw new Error(String(r.status));
        const d = await r.json();
        if (d.price) {
          this.emit(parseFloat(d.price), "rest");
          this.status("live");
        } else {
          this.status("down");
        }
      } catch {
        this.status("down");
      }
    };
    poll();
    this.restTimer = setInterval(poll, 1000);
    // periodically try to climb back to the primary
    this.reconnectTimer = setTimeout(() => {
      this.cleanup();
      this.attempts = 0;
      if (this.opts.primary === "gmx") this.connectGmx();
      else this.connectBinance();
    }, 20_000);
  }

  private failover() {
    if (this.stopped) return;
    if (this.source === "gmx") this.connectBinance();
    else if (this.source === "binance") this.connectCoinbase();
    else if (this.source === "coinbase") this.startRest();
    else {
      // rest already the floor — bounce back to the top and retry
      this.attempts = 0;
      if (this.opts.primary === "gmx") this.connectGmx();
      else this.connectBinance();
    }
  }

  private scheduleReconnect(fn: () => void) {
    const delay = Math.min(8000, 500 * 2 ** this.attempts);
    this.reconnectTimer = setTimeout(fn, delay);
  }
}
