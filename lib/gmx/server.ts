// Server-only GMX/Avalanche read layer. Keeps every heavy dependency out of the client bundle:
// prices come from gmxinfra tickers (the Chainlink Data Streams mirror keepers fill against),
// balances from a plain eth JSON-RPC read, market config from live DataStore reads (cached), and
// the community tape from GMX's subsquid indexer. The live write path (gmxTrade.ts) is client-only.

import "server-only";
import { keccak256, encodeAbiParameters, encodeFunctionData } from "viem";
import { MARKETS, CONTRACTS, GMX_ORACLE_URL, GMX_SUBSQUID_URL, rpcUrl, TOKENS } from "./networks";
import type { GmxMarket, GmxPairConfig, RecentTrade } from "./types";

const TIMEOUT_MS = 6000;
const RETRIES = 2;

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

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const d = await fetchJSON<{ result?: T; error?: { message?: string } }>(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (d.error) throw new Error(d.error.message || "rpc error");
  return d.result as T;
}

// ── prices (gmxinfra tickers; raw scale USD*1e30/10^tokenDecimals) ──
interface Ticker {
  tokenSymbol: string;
  minPrice: string;
  maxPrice: string;
  timestamp: number;
}
let tickersCache: { at: number; list: Ticker[] } | null = null;

async function tickers(): Promise<Ticker[]> {
  if (tickersCache && Date.now() - tickersCache.at < 900) return tickersCache.list;
  const list = await fetchJSON<Ticker[]>(`${GMX_ORACLE_URL}/prices/tickers`);
  tickersCache = { at: Date.now(), list };
  return list;
}

export async function getPrice(symbol: string): Promise<number | null> {
  const def = MARKETS[symbol];
  if (!def) return null;
  try {
    const t = (await tickers()).find((x) => x.tokenSymbol === def.base);
    if (!t) return null;
    const mid = (BigInt(t.minPrice) + BigInt(t.maxPrice)) / 2n;
    return Number(mid) / 10 ** (30 - def.indexTokenDecimals);
  } catch {
    return null;
  }
}

// ── pair config: live DataStore reads, cached 10 min, with safe fallbacks ──
// Keys follow GMX's hashData scheme: keccak(abi.encode(keccak(abi.encode(name)), ...args)).
const str = (s: string) => keccak256(encodeAbiParameters([{ type: "string" }], [s]));
const keyAddr = (name: string, addr: string) =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [str(name), addr as `0x${string}`]));
const keyAddrBool = (name: string, addr: string, b: boolean) =>
  keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "bool" }],
      [str(name), addr as `0x${string}`, b],
    ),
  );

const GET_UINT_ABI = [
  {
    type: "function",
    name: "getUint",
    stateMutability: "view",
    inputs: [{ name: "key", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

async function dataStoreUint(key: `0x${string}`): Promise<bigint> {
  const data = encodeFunctionData({ abi: GET_UINT_ABI, functionName: "getUint", args: [key] });
  const out = await rpc<string>("eth_call", [{ to: CONTRACTS.dataStore, data }, "latest"]);
  return BigInt(out);
}

const FALLBACK_CFG: Record<string, GmxPairConfig> = {
  "BTC/USD": {
    symbol: "BTC/USD",
    marketAddress: MARKETS["BTC/USD"].marketAddress,
    takerFeeRate: 0.0006,
    makerFeeRate: 0.0004,
    minPositionValue: 1,
    minCollateralUsd: 1,
    maxLeverage: 100,
  },
  "AVAX/USD": {
    symbol: "AVAX/USD",
    marketAddress: MARKETS["AVAX/USD"].marketAddress,
    takerFeeRate: 0.0006,
    makerFeeRate: 0.0004,
    minPositionValue: 1,
    minCollateralUsd: 1,
    maxLeverage: 60,
  },
};

const cfgCache = new Map<string, { at: number; cfg: GmxPairConfig }>();

export async function getPairConfig(symbol: string): Promise<GmxPairConfig | null> {
  const def = MARKETS[symbol];
  if (!def) return null;
  const cached = cfgCache.get(symbol);
  if (cached && Date.now() - cached.at < 600_000) return cached.cfg;
  const fallback = FALLBACK_CFG[symbol];
  try {
    const [minColFactor, feeNeg, feePos, minPosUsd, minColUsd] = await Promise.all([
      dataStoreUint(keyAddr("MIN_COLLATERAL_FACTOR", def.marketAddress)),
      dataStoreUint(keyAddrBool("POSITION_FEE_FACTOR", def.marketAddress, false)),
      dataStoreUint(keyAddrBool("POSITION_FEE_FACTOR", def.marketAddress, true)),
      dataStoreUint(str("MIN_POSITION_SIZE_USD")),
      dataStoreUint(str("MIN_COLLATERAL_USD")),
    ]);
    const cfg: GmxPairConfig = {
      symbol,
      marketAddress: def.marketAddress,
      // negative-impact side is the conservative per-side rate the game budgets with
      takerFeeRate: Number(feeNeg) / 1e30 || fallback.takerFeeRate,
      makerFeeRate: Number(feePos) / 1e30 || fallback.makerFeeRate,
      minPositionValue: Number(minPosUsd) / 1e30 || fallback.minPositionValue,
      minCollateralUsd: Number(minColUsd) / 1e30 || fallback.minCollateralUsd,
      maxLeverage: minColFactor > 0n ? Math.floor(1e30 / Number(minColFactor)) : fallback.maxLeverage,
    };
    cfgCache.set(symbol, { at: Date.now(), cfg });
    return cfg;
  } catch {
    return fallback;
  }
}

export async function getMarkets(): Promise<GmxMarket[]> {
  const syms = Object.keys(MARKETS);
  const [prices, cfgs] = await Promise.all([
    Promise.all(syms.map((s) => getPrice(s))),
    Promise.all(syms.map((s) => getPairConfig(s))),
  ]);
  return syms.map((s, i) => ({
    symbol: s,
    base: MARKETS[s].base,
    marketAddress: MARKETS[s].marketAddress,
    price: prices[i] ?? 0,
    oiLong: 0,
    oiShort: 0,
    volume: 0,
    maxLeverage: cfgs[i]?.maxLeverage ?? 100,
    status: "open" as const,
  }));
}

// ── native AVAX balance ──
export async function getAvaxBalance(address: string): Promise<number> {
  if (!address) return 0;
  const out = await rpc<string>("eth_getBalance", [address, "latest"]);
  return Number(BigInt(out)) / 1e18;
}

// ── community tape via GMX's subsquid indexer (best-effort; [] on any failure) ──
// Lags chain head by ~20s (measured) — fine for the social feed, never for fill confirmation.
interface RawAction {
  eventName: string;
  orderType: number;
  account: string;
  marketAddress: string;
  sizeDeltaUsd: string;
  initialCollateralDeltaAmount: string;
  initialCollateralTokenAddress: string | null;
  isLong: boolean | null;
  timestamp: number;
  transactionHash: string | null;
  executionPrice?: string | null;
  basePnlUsd?: string | null;
}

const ACTION_FIELDS_FULL =
  "eventName orderType account marketAddress sizeDeltaUsd initialCollateralDeltaAmount initialCollateralTokenAddress isLong timestamp transactionHash executionPrice basePnlUsd";
const ACTION_FIELDS_MIN =
  "eventName orderType account marketAddress sizeDeltaUsd initialCollateralDeltaAmount initialCollateralTokenAddress isLong timestamp transactionHash";

async function squid(where: string, limit: number, fields: string): Promise<RawAction[]> {
  const query = `query { tradeActions(where:{${where}}, orderBy:[timestamp_DESC], limit:${limit}) { ${fields} } }`;
  const d = await fetchJSON<{ data?: { tradeActions?: RawAction[] }; errors?: unknown[] }>(GMX_SUBSQUID_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (d.errors?.length) throw new Error("squid schema error");
  return d.data?.tradeActions ?? [];
}

const MARKET_BY_ADDR = new Map(Object.values(MARKETS).map((m) => [m.marketAddress.toLowerCase(), m]));

function collateralUsd(a: RawAction, avaxPx: number, btcPx: number): number {
  const amt = Number(a.initialCollateralDeltaAmount || 0);
  const tok = (a.initialCollateralTokenAddress || "").toLowerCase();
  if (tok === TOKENS.usdc.toLowerCase()) return amt / 1e6;
  if (tok === TOKENS.wavax.toLowerCase()) return (amt / 1e18) * avaxPx;
  if (tok === TOKENS.btcb.toLowerCase()) return (amt / 1e8) * btcPx;
  return 0;
}

function mapActions(actions: RawAction[], avaxPx: number, btcPx: number): RecentTrade[] {
  const out: RecentTrade[] = [];
  for (const a of actions) {
    const def = MARKET_BY_ADDR.get(a.marketAddress.toLowerCase());
    if (!def || a.isLong == null) continue;
    const sizeUsd = Number(a.sizeDeltaUsd) / 1e30;
    if (!sizeUsd) continue;
    const colUsd = collateralUsd(a, avaxPx, btcPx);
    out.push({
      account: a.account,
      symbol: def.symbol,
      isLong: a.isLong,
      isOpen: a.orderType === 2,
      price: a.executionPrice ? Number(a.executionPrice) / 10 ** (30 - def.indexTokenDecimals) : 0,
      pnl: a.basePnlUsd ? Number(a.basePnlUsd) / 1e30 : 0,
      // leverage = notional / collateral, but the collateral DELTA of a size-only increase can be
      // ~0 → an absurd ratio. Only report it when the collateral is a real margin ($0.50+) and the
      // result is plausible (≤ GMX's 100x cap, +buffer); otherwise 0 (unknown), never a garbage row.
      leverage: (() => {
        if (colUsd < 0.5) return 0;
        const lev = Math.round(sizeUsd / colUsd);
        return lev >= 1 && lev <= 250 ? lev : 0;
      })(),
      ts: a.timestamp * 1000,
      txhash: a.transactionHash ?? undefined,
    });
  }
  return out;
}

async function tapePrices(): Promise<{ avaxPx: number; btcPx: number }> {
  const [avaxPx, btcPx] = await Promise.all([getPrice("AVAX/USD"), getPrice("BTC/USD")]);
  return { avaxPx: avaxPx ?? 0, btcPx: btcPx ?? 0 };
}

export async function getRecentTrades(limit = 40): Promise<RecentTrade[]> {
  const where = `eventName_eq:"OrderExecuted", orderType_in:[2,4]`;
  try {
    const { avaxPx, btcPx } = await tapePrices();
    try {
      return mapActions(await squid(where, limit * 3, ACTION_FIELDS_FULL), avaxPx, btcPx).slice(0, limit);
    } catch {
      // a schema mismatch on the optional fields — retry with the confirmed-minimal set
      return mapActions(await squid(where, limit * 3, ACTION_FIELDS_MIN), avaxPx, btcPx).slice(0, limit);
    }
  } catch {
    return [];
  }
}

export async function getAccountTrades(address: string, limit = 30): Promise<RecentTrade[]> {
  // only a well-formed 0x address is ever interpolated into the GraphQL query (no injection surface)
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return [];
  const where = `eventName_eq:"OrderExecuted", orderType_in:[2,4], account_eq:"${address}"`;
  try {
    const { avaxPx, btcPx } = await tapePrices();
    try {
      return mapActions(await squid(where, limit, ACTION_FIELDS_FULL), avaxPx, btcPx);
    } catch {
      return mapActions(await squid(where, limit, ACTION_FIELDS_MIN), avaxPx, btcPx);
    }
  } catch {
    return [];
  }
}
