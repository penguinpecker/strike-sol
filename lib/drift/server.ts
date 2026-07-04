// Server-only Drift/Solana read layer. Keeps the heavy Drift SDK out of both bundles: prices come
// from Pyth Hermes (the oracle Drift settles against), the wallet's USDC balance from a plain
// Solana JSON-RPC read, and market/fee config from sane Drift defaults. The live-trade write path
// (driftTrade.ts) is the only place the SDK loads, and only on the client on a real action.

import "server-only";
import { clusterConfig, marketDef, resolveCluster, rpcUrl, MARKETS } from "./networks";
import type { DriftMarket, DriftPairConfig, RecentTrade } from "./types";

const TIMEOUT_MS = 6000;
const RETRIES = 2;
const HERMES = "https://hermes.pyth.network";

// Drift taker/leverage defaults per market (refined by the SDK on the live path; these drive the
// pre-trade validation + cost preview). Drift majors run ~10 bps taker, ~20x max.
const PAIR_DEFAULTS: Record<string, { taker: number; maker: number; minNotional: number; maxLev: number }> = {
  "BTC/USD": { taker: 0.001, maker: 0.0004, minNotional: 5, maxLev: 20 },
  "ETH/USD": { taker: 0.001, maker: 0.0004, minNotional: 5, maxLev: 20 },
  "SOL/USD": { taker: 0.001, maker: 0.0004, minNotional: 5, maxLev: 20 },
};

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { accept: "application/json", ...(init?.headers || {}) },
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(t);
    }
    if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
  }
  throw new Error(`request failed after ${RETRIES + 1} attempts: ${String(lastErr)}`);
}

// ── Pyth price (matches the client feed + the Drift fill oracle) ──
export async function getPrice(symbol: string): Promise<number | null> {
  const def = marketDef(symbol);
  const url = `${HERMES}/v2/updates/price/latest?ids%5B%5D=${encodeURIComponent(def.pythFeedId)}&parsed=true&encoding=hex`;
  try {
    const d = await fetchJSON<{ parsed?: { price: { price: string; expo: number } }[] }>(url);
    const p = d.parsed?.[0]?.price;
    return p ? Number(p.price) * 10 ** p.expo : null;
  } catch {
    return null;
  }
}

export async function getMarkets(net?: string): Promise<DriftMarket[]> {
  const syms = Object.keys(MARKETS);
  const prices = await Promise.all(syms.map((s) => getPrice(s)));
  return syms.map((s, i) => {
    const def = MARKETS[s];
    const d = PAIR_DEFAULTS[s] ?? { maxLev: 20 };
    return {
      symbol: s,
      base: def.base,
      marketIndex: -1, // resolved at trade time via the SDK
      price: prices[i] ?? 0,
      oiLong: 0,
      oiShort: 0,
      volume: 0,
      maxLeverage: d.maxLev,
      status: "open" as const,
    };
  });
}

export async function getPairConfig(symbol: string, _net?: string): Promise<DriftPairConfig | null> {
  const def = MARKETS[symbol];
  if (!def) return null;
  const d = PAIR_DEFAULTS[symbol] ?? { taker: 0.001, maker: 0.0004, minNotional: 5, maxLev: 20 };
  return {
    symbol,
    marketIndex: -1,
    takerFeeRate: d.taker,
    makerFeeRate: d.maker,
    minPositionValue: d.minNotional,
    maxLeverage: d.maxLev,
  };
}

// ── wallet USDC balance via Solana JSON-RPC (getTokenAccountsByOwner) ──
export async function getUsdcBalance(address: string, net?: string): Promise<number> {
  if (!address) return 0;
  const { usdcMint } = clusterConfig(net);
  try {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [address, { mint: usdcMint }, { encoding: "jsonParsed" }],
    };
    const d = await fetchJSON<{
      result?: { value?: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }[] };
    }>(rpcUrl(net), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const accts = d.result?.value ?? [];
    let total = 0;
    for (const a of accts) total += a.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
    return total;
  } catch {
    // Distinguish RPC failure from empty wallet at the call site by throwing; the route maps it.
    throw new Error("rpc balance read failed");
  }
}

// ── native SOL balance (for gas) via getBalance ──
export async function getSolBalance(address: string, net?: string): Promise<number> {
  if (!address) return 0;
  const body = { jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] };
  const d = await fetchJSON<{ result?: { value?: number } }>(rpcUrl(net), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (d.result?.value ?? 0) / 1e9;
}

// ── recent trades tape (best-effort) ──
// Drift's public data API is Cloudflare-gated for anonymous callers, so this is best-effort: it
// returns [] on any failure and the community feed simply stays quiet (mainnet trades are sparse
// anyway). Set DRIFT_DATA_API_KEY to enable an authenticated data source if you have one.
export async function getRecentTrades(net?: string, limit = 40): Promise<RecentTrade[]> {
  const key = process.env.DRIFT_DATA_API_KEY;
  if (!key) return [];
  const n = resolveCluster(net);
  try {
    const d = await fetchJSON<{ trades?: RawTrade[] }>(
      `https://data.api.drift.trade/trades/perp?limit=${limit}`,
      { headers: { "x-api-key": key } },
    );
    return (d.trades || []).slice(0, limit).map((t) => mapTrade(t, n));
  } catch {
    return [];
  }
}

export async function getAccountTrades(address: string, net?: string, limit = 30): Promise<RecentTrade[]> {
  const key = process.env.DRIFT_DATA_API_KEY;
  if (!key || !address) return [];
  const n = resolveCluster(net);
  try {
    const d = await fetchJSON<{ trades?: RawTrade[] }>(
      `https://data.api.drift.trade/user/${encodeURIComponent(address)}/trades?limit=${limit}`,
      { headers: { "x-api-key": key } },
    );
    return (d.trades || []).slice(0, limit).map((t) => mapTrade(t, n));
  } catch {
    return [];
  }
}

interface RawTrade {
  authority?: string;
  user?: string;
  marketIndex?: number;
  baseAssetSymbol?: string;
  direction?: string; // "long" | "short"
  action?: string; // "open" | "close" | "reduce"
  price?: number | string;
  quoteAssetAmountFilled?: number | string;
  pnl?: number | string;
  ts?: number | string;
  txSig?: string;
}

function mapTrade(t: RawTrade, _net: string): RecentTrade {
  const sym = t.baseAssetSymbol ? `${t.baseAssetSymbol}/USD` : "BTC/USD";
  return {
    account: t.authority || t.user || "",
    symbol: sym,
    marketIndex: t.marketIndex ?? -1,
    isLong: (t.direction || "").toLowerCase() === "long",
    isOpen: (t.action || "open").toLowerCase() === "open",
    price: Number(t.price) || 0,
    pnl: Number(t.pnl) || 0,
    leverage: 0,
    ts: Number(t.ts) ? Number(t.ts) * (String(t.ts).length > 12 ? 1 : 1000) : Date.now(),
    txhash: t.txSig,
  };
}
