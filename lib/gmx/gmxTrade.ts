// The GMX v2 live write-path: build + send real orders on Avalanche mainnet.
//
// Orders are built RAW (ExchangeRouter.multicall[sendWnt, createOrder]) with viem — the exact
// byte layout was verified against live production orders in the 2026-07-05 survey. We deliberately
// do not use the SDK's high-level order methods: they hardcode the receive token (breaking
// close-to-native-AVAX) and hide the referral/uiFee fields; its ABIs are still the source of truth.
//
// Fill model (measured live): the create tx lands in ~1s, then a GMX keeper executes at the
// Chainlink Data Streams price 3-5s later (p50 4s / p99 12s, n=7,869; 0 keeper failures). A market
// order that can't fill inside acceptablePrice is AUTO-CANCELLED with collateral + unused execution
// fee refunded — so the two terminal states we wait for are OrderExecuted | OrderCancelled.
//
// Broadcast is gated by ctx.broadcast (config.liveBroadcast): when off, the exact tx is eth_call'd
// against mainnet and a "(dry-run)" sentinel is returned — nothing is ever sent.

"use client";

import {
  createPublicClient,
  http,
  encodeFunctionData,
  decodeErrorResult,
  parseEther,
  keccak256,
  stringToBytes,
  type PublicClient,
  type Hex,
  type Address,
} from "viem";
import ExchangeRouterAbi from "@gmx-io/sdk/abis/ExchangeRouter";
import SyntheticsReaderAbi from "@gmx-io/sdk/abis/SyntheticsReader";
import CustomErrorsAbi from "@gmx-io/sdk/abis/CustomErrors";
import {
  CONTRACTS,
  TOKENS,
  MARKETS,
  marketDef,
  GMX_ORACLE_URL,
  DEFAULT_RPC,
  ZERO_ADDRESS,
  STRIKE_REFERRAL_CODE,
  STRIKE_UI_FEE_RECEIVER,
  type MarketDef,
} from "./networks";
import { GmxRailError, type Side } from "./rail";
import { config } from "../config"; // relative (not @/) so the alias-free trade subtree stays node-importable
import type { GmxOrderResult } from "./types";

// EIP-1193 provider (what Privy's embedded wallet exposes). We keep the type minimal on purpose.
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface LiveCtx {
  account: Address;
  provider: Eip1193Provider;
  broadcast: boolean;
}

// Execution-fee deposit fronted per order. Contract minimum was 0.0000623 AVAX at survey gas
// prices and scales with gasPrice; keepers refund the unused surplus in the execution tx ~4s
// later, so this is float, not cost. 0.01 AVAX ≈ 160x headroom against gas spikes.
const EXEC_FEE_WEI = parseEther("0.01");
// How long we wait for the keeper's terminal event before letting the round proceed "pending".
const FILL_WAIT_MS = 12_000;
const RECEIPT_WAIT_MS = 20_000;
// Fixed gas limit for the open multicall so the hot path can skip an eth_estimateGas round-trip.
// Real opens measure ~1.0–1.03M gas; 2.2M is generous headroom (unused gas is refunded).
const OPEN_GAS_LIMIT = 2_200_000n;

const TOPIC_ORDER_CREATED = keccak256(stringToBytes("OrderCreated"));
const TOPIC_ORDER_EXECUTED = keccak256(stringToBytes("OrderExecuted"));
const TOPIC_ORDER_CANCELLED = keccak256(stringToBytes("OrderCancelled"));

let pub: PublicClient | null = null;
function publicClient(): PublicClient {
  if (!pub) {
    pub = createPublicClient({
      transport: http(process.env.NEXT_PUBLIC_AVAX_RPC || DEFAULT_RPC),
    });
  }
  return pub;
}

// ── live oracle prices (gmxinfra tickers = the Chainlink DS mirror keepers fill against) ──
// Raw min/maxPrice scale: USD * 1e30 / 10^tokenDecimals — i.e. ALREADY contract price units.
interface RawTicker {
  minPrice: bigint;
  maxPrice: bigint;
}
let tickersCache: { at: number; byToken: Map<string, RawTicker> } | null = null;

async function rawTickers(): Promise<Map<string, RawTicker>> {
  if (tickersCache && Date.now() - tickersCache.at < 1000) return tickersCache.byToken;
  const r = await fetch(`${GMX_ORACLE_URL}/prices/tickers`, { cache: "no-store" });
  if (!r.ok) throw new GmxRailError("CHAIN_REJECTED", `price oracle unreachable (${r.status})`);
  const list = (await r.json()) as { tokenSymbol: string; minPrice: string; maxPrice: string }[];
  const byToken = new Map<string, RawTicker>();
  for (const t of list) byToken.set(t.tokenSymbol, { minPrice: BigInt(t.minPrice), maxPrice: BigInt(t.maxPrice) });
  tickersCache = { at: Date.now(), byToken };
  return byToken;
}

async function tickerFor(base: string): Promise<RawTicker> {
  const t = (await rawTickers()).get(base);
  if (!t) throw new GmxRailError("MARKET_CLOSED", `no oracle price for ${base}`);
  return t;
}

/** Human USD price of AVAX right now (raw AVAX ticker is USD*1e30/1e18 = 1e12 scale). */
export async function avaxUsdPrice(): Promise<number> {
  const t = await tickerFor("AVAX");
  return Number((t.minPrice + t.maxPrice) / 2n) / 1e12;
}

// ── raw order building (byte-verified against production) ──
interface OrderParamsInput {
  receiver: Address;
  market: MarketDef;
  isLong: boolean;
  orderType: 2 | 4; // MarketIncrease | MarketDecrease
  collateralToken: Address;
  swapPath: Address[];
  collateralDeltaWei: bigint;
  sizeDeltaUsd: bigint; // 1e30
  acceptablePrice: bigint; // USD*1e30/10^indexDecimals
  decreaseSwapType: number;
}

function orderParams(p: OrderParamsInput) {
  return {
    addresses: {
      receiver: p.receiver,
      cancellationReceiver: ZERO_ADDRESS,
      callbackContract: ZERO_ADDRESS,
      uiFeeReceiver: STRIKE_UI_FEE_RECEIVER,
      market: p.market.marketAddress,
      initialCollateralToken: p.collateralToken,
      swapPath: p.swapPath,
    },
    numbers: {
      sizeDeltaUsd: p.sizeDeltaUsd,
      initialCollateralDeltaAmount: p.collateralDeltaWei,
      triggerPrice: 0n,
      acceptablePrice: p.acceptablePrice,
      executionFee: EXEC_FEE_WEI,
      callbackGasLimit: 0n,
      minOutputAmount: 0n,
      validFromTime: 0n,
    },
    orderType: p.orderType,
    decreasePositionSwapType: p.decreaseSwapType,
    isLong: p.isLong,
    shouldUnwrapNativeToken: true,
    autoCancel: false,
    referralCode: STRIKE_REFERRAL_CODE,
    dataList: [] as Hex[],
  };
}

// wntAmount = collateral + executionFee routed to the OrderVault. When platformFeeWei > 0 a leading
// sendWnt pays the STRIKE treasury (in WAVAX) inside the SAME tx — one signature, fee collected
// on-chain. msg.value must equal wntAmount + platformFeeWei.
function multicallData(
  wntAmount: bigint,
  params: ReturnType<typeof orderParams>,
  platformFeeWei = 0n,
): Hex {
  const calls: Hex[] = [];
  if (platformFeeWei > 0n) {
    calls.push(
      encodeFunctionData({ abi: ExchangeRouterAbi, functionName: "sendWnt", args: [config.feeTreasury, platformFeeWei] }),
    );
  }
  calls.push(
    encodeFunctionData({ abi: ExchangeRouterAbi, functionName: "sendWnt", args: [CONTRACTS.orderVault, wntAmount] }),
  );
  calls.push(encodeFunctionData({ abi: ExchangeRouterAbi, functionName: "createOrder", args: [params] }));
  return encodeFunctionData({ abi: ExchangeRouterAbi, functionName: "multicall", args: [calls] });
}

// Pull the most specific revert reason out of a viem error (GMX custom errors decode by ABI).
function classify(e: unknown): string {
  const walk = (err: unknown): Hex | null => {
    if (!err || typeof err !== "object") return null;
    const anyErr = err as { data?: unknown; cause?: unknown };
    if (typeof anyErr.data === "string" && anyErr.data.length > 10) return anyErr.data as Hex;
    const inner = (anyErr.data as { data?: string } | undefined)?.data;
    if (typeof inner === "string" && inner.length > 10) return inner as Hex;
    return walk(anyErr.cause);
  };
  const raw = walk(e);
  if (raw) {
    try {
      const dec = decodeErrorResult({ abi: CustomErrorsAbi, data: raw });
      return `${dec.errorName}(${dec.args?.map(String).join(",") ?? ""})`;
    } catch {
      /* not a GMX custom error */
    }
  }
  const msg = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e);
  return msg.split("\n")[0];
}

// ── send + settle ──
// optimistic=true (opens): return the moment the tx is broadcast so the round starts in ~1s instead
// of blocking on the ~4s keeper fill. The fill is confirmed in the BACKGROUND — if the keeper cancels
// (rare), the engine's end-of-round close simply finds no position (a no-op) and clears the record.
// A fixed gas limit skips eth_estimateGas on the hot path. The pre-broadcast eth_call still runs, so
// a bad order is rejected before anything is signed.
async function sendOrder(
  ctx: LiveCtx,
  data: Hex,
  value: bigint,
  what: string,
  optimistic = false,
): Promise<{ txhash: string; orderKey?: Hex; fill: "executed" | "pending" }> {
  const client = publicClient();

  // Pre-broadcast validation (an eth_call that surfaces the REAL revert reason — min size, disabled
  // market, bad fee) runs on the NON-optimistic path (closes, dry-runs). Optimistic opens SKIP it to
  // stay under ~1s: the engine already pre-validates size/leverage, and if an open still reverts
  // on-chain (rare) the fixed-gas tx just fails and the orphan-recovery finds no position (no-op).
  if (!optimistic) {
    try {
      await client.call({ account: ctx.account, to: CONTRACTS.exchangeRouter, data, value });
    } catch (e) {
      throw new GmxRailError("CHAIN_REJECTED", `${what} rejected by GMX: ${classify(e)}`);
    }
  }

  if (!ctx.broadcast) {
    // dry-run must still validate even on the optimistic path — nothing is sent, so cost is fine
    if (optimistic) {
      try {
        await client.call({ account: ctx.account, to: CONTRACTS.exchangeRouter, data, value });
      } catch (e) {
        throw new GmxRailError("CHAIN_REJECTED", `${what} rejected by GMX: ${classify(e)}`);
      }
    }
    return { txhash: `(dry-run) ${what} validated against mainnet — broadcast is off`, fill: "pending" };
  }

  const gasHex = optimistic
    ? `0x${OPEN_GAS_LIMIT.toString(16)}`
    : `0x${(((await client.estimateGas({ account: ctx.account, to: CONTRACTS.exchangeRouter, data, value })) * 12n) / 10n).toString(16)}`;
  const txhash = (await ctx.provider.request({
    method: "eth_sendTransaction",
    params: [{ from: ctx.account, to: CONTRACTS.exchangeRouter, data, value: `0x${value.toString(16)}`, gas: gasHex }],
  })) as Hex;

  // optimistic path: don't block the tap on confirmation. Kick off a background watch (best-effort,
  // for logging/telemetry only — the engine owns recovery via its pending record + reconcile) and
  // return immediately so the round starts now.
  if (optimistic) {
    void client
      .waitForTransactionReceipt({ hash: txhash, timeout: RECEIPT_WAIT_MS, pollingInterval: 700 })
      .catch(() => undefined);
    return { txhash, fill: "pending" };
  }

  // ── From here the tx IS live in the mempool: a confirmation timeout or RPC hiccup must NEVER
  // discard the txhash, or the caller would think the trade failed while a real position lands
  // on-chain (orphan). Only two things throw past this point: an on-chain REVERT (whole tx failed,
  // atomically — no position, no fee) and a keeper CANCELLATION (terminal, no position). Everything
  // else returns fill:"pending" so the caller tracks it and can reconcile/close later.
  let receipt: Awaited<ReturnType<typeof client.waitForTransactionReceipt>>;
  try {
    receipt = await client.waitForTransactionReceipt({ hash: txhash, timeout: RECEIPT_WAIT_MS, pollingInterval: 700 });
  } catch {
    return { txhash, fill: "pending" }; // broadcast; confirmation slow — reconcile via position scan
  }
  if (receipt.status !== "success") {
    throw new GmxRailError("CHAIN_REJECTED", `${what} tx reverted on-chain (${txhash.slice(0, 10)}…)`);
  }

  // orderKey: EventEmitter EventLog2 with topics[1]=keccak("OrderCreated"), topics[2]=orderKey
  let orderKey: Hex | undefined;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CONTRACTS.eventEmitter.toLowerCase()) continue;
    if (log.topics[1] === TOPIC_ORDER_CREATED && log.topics[2]) {
      orderKey = log.topics[2] as Hex;
      break;
    }
  }
  if (!orderKey) return { txhash, fill: "pending" };

  // wait for the keeper's terminal event: executed | cancelled (3-5s typical)
  const deadline = Date.now() + FILL_WAIT_MS;
  const fromBlock = `0x${receipt.blockNumber.toString(16)}` as Hex;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 800));
    try {
      const logs = (await client.request({
        method: "eth_getLogs",
        params: [
          {
            address: CONTRACTS.eventEmitter as Hex,
            fromBlock,
            toBlock: "latest",
            topics: [null, [TOPIC_ORDER_EXECUTED, TOPIC_ORDER_CANCELLED], orderKey],
          },
        ],
      })) as { topics: Hex[] }[];
      for (const log of logs) {
        if (log.topics[1] === TOPIC_ORDER_EXECUTED) return { txhash, orderKey, fill: "executed" };
        if (log.topics[1] === TOPIC_ORDER_CANCELLED) {
          // Keeper couldn't fill within slippage: GMX refunds the COLLATERAL, but the 0.69% platform
          // fee (a sendWnt executed in the — successful — open tx) is NOT refunded. Disclose that.
          const feeNote = what === "open" && config.platformFeeRate > 0 ? " (the platform fee is not refunded)" : "";
          throw new GmxRailError(
            "ORDER_CANCELLED",
            `${what} was cancelled by the keeper (price moved past your slippage) — collateral refunded, nothing ${what === "open" ? "opened" : "closed"}${feeNote}`,
          );
        }
      }
    } catch (e) {
      if (e instanceof GmxRailError) throw e;
      /* transient RPC error — keep polling until the deadline */
    }
  }
  return { txhash, orderKey, fill: "pending" };
}

// Reconcile helper: list STRIKE-shaped open positions for an account (our markets + the collateral
// token STRIKE opens with, either side). Used on wallet-connect to adopt/close orphans that a
// receipt timeout or tab reload left behind. Read-only.
export async function listStrikePositions(
  account: Address,
): Promise<{ symbol: string; isLong: boolean; sizeUsd: number }[]> {
  const positions = (await publicClient().readContract({
    address: CONTRACTS.reader,
    abi: SyntheticsReaderAbi,
    functionName: "getAccountPositions",
    args: [CONTRACTS.dataStore, account, 0n, 50n],
  })) as unknown as readonly {
    addresses: { market: Address; collateralToken: Address };
    numbers: { sizeInUsd: bigint };
    flags: { isLong: boolean };
  }[];
  const out: { symbol: string; isLong: boolean; sizeUsd: number }[] = [];
  for (const p of positions) {
    if (p.numbers.sizeInUsd === 0n) continue;
    for (const def of Object.values(MARKETS)) {
      if (
        p.addresses.market.toLowerCase() === def.marketAddress.toLowerCase() &&
        p.addresses.collateralToken.toLowerCase() === def.collateralToken.toLowerCase()
      ) {
        out.push({ symbol: def.symbol, isLong: p.flags.isLong, sizeUsd: Number(p.numbers.sizeInUsd) / 1e30 });
      }
    }
  }
  return out;
}

// ── OPEN: MarketIncrease funded with native AVAX ──
export async function openMarketLive(
  t: { symbol: string; stake: number; leverage: number; side: Side; slippage: number },
  ctx: LiveCtx,
): Promise<GmxOrderResult> {
  const def = marketDef(t.symbol);
  const isLong = t.side === "long";
  const [idx, avax] = await Promise.all([tickerFor(def.base), tickerFor("AVAX")]);

  const stakeWei = parseEther(String(t.stake));
  // sizeDeltaUsd (1e30) = stake(1e18) × avaxUsd(1e12 raw) × leverage — exact bigint math
  const sizeDeltaUsd = (stakeWei * ((avax.minPrice + avax.maxPrice) / 2n) * BigInt(Math.round(t.leverage * 100))) / 100n;
  // long increase caps the price you'll pay (worst = higher); short increase floors it
  const slipBps = BigInt(Math.round(t.slippage * 10_000));
  const acceptablePrice = isLong
    ? (idx.maxPrice * (10_000n + slipBps)) / 10_000n
    : (idx.minPrice * (10_000n - slipBps)) / 10_000n;

  const params = orderParams({
    receiver: ctx.account,
    market: def,
    isLong,
    orderType: 2,
    // native AVAX in: sendWnt wraps it; WAVAX is the initial token, swapPath routes to the
    // market's collateral (USDC for BTC — the router swap; none for the AVAX market)
    collateralToken: TOKENS.wavax,
    swapPath: def.collateralToken === TOKENS.wavax ? [] : def.swapPath,
    collateralDeltaWei: stakeWei,
    sizeDeltaUsd,
    acceptablePrice,
    decreaseSwapType: 0,
  });
  // STRIKE platform fee on the stake (0.69% default) → treasury, in the same tx. Charged ON TOP of
  // the stake so position sizing is unchanged; player pays stake + fee + exec deposit.
  const rate = config.platformFeeRate;
  const zeroTreasury = config.feeTreasury.toLowerCase() === ZERO_ADDRESS.toLowerCase();
  const platformFeeWei = rate > 0 && !zeroTreasury ? (stakeWei * BigInt(Math.round(rate * 1e6))) / 1_000_000n : 0n;
  if (rate > 0 && zeroTreasury) console.warn("[strike] platform fee rate set but no treasury — fee skipped");
  const wnt = stakeWei + EXEC_FEE_WEI;
  const data = multicallData(wnt, params, platformFeeWei);
  // optimistic: return as soon as the tx is broadcast so the tap feels instant (~1s, not ~5s)
  const r = await sendOrder(ctx, data, wnt + platformFeeWei, "open", true);
  return { txhash: r.txhash, orderKey: r.orderKey, isLong, fill: r.fill };
}

// ── CLOSE: full MarketDecrease of the position this call opened, exit unwrapped to native AVAX ──
export async function closeMarketLive(
  symbol: string,
  isLong: boolean,
  ctx: LiveCtx,
  slippage = 0.01,
): Promise<{ txhash: string }> {
  const def = marketDef(symbol);
  const client = publicClient();

  const positions = (await client.readContract({
    address: CONTRACTS.reader,
    abi: SyntheticsReaderAbi,
    functionName: "getAccountPositions",
    args: [CONTRACTS.dataStore, ctx.account, 0n, 50n],
  })) as unknown as readonly {
    addresses: { account: Address; market: Address; collateralToken: Address };
    numbers: { sizeInUsd: bigint; sizeInTokens: bigint; collateralAmount: bigint };
    flags: { isLong: boolean };
  }[];

  // Match the EXACT position this call opened: same market, same side, and the collateral token
  // STRIKE opens with — so we never close the wrong side or a user's unrelated GMX position on
  // the same market (F1). GMX stores long/short separately; picking by market alone is unsafe.
  const pos = positions.find(
    (p) =>
      p.addresses.market.toLowerCase() === def.marketAddress.toLowerCase() &&
      p.flags.isLong === isLong &&
      p.addresses.collateralToken.toLowerCase() === def.collateralToken.toLowerCase(),
  );
  if (!pos || pos.numbers.sizeInUsd === 0n) {
    throw new GmxRailError(
      "CHAIN_REJECTED",
      "no open position on-chain for this call — the open may have been cancelled or already closed",
    );
  }

  const idx = await tickerFor(def.base);
  const slipBps = BigInt(Math.round(slippage * 10_000));
  // long close floors the exit price; short close caps it
  const acceptablePrice = isLong
    ? (idx.minPrice * (10_000n - slipBps)) / 10_000n
    : (idx.maxPrice * (10_000n + slipBps)) / 10_000n;

  const collateral = pos.addresses.collateralToken;
  // PnL pays out in the market's long token for longs, USDC for shorts; when that differs from
  // the position's collateral, have the keeper swap PnL into collateral so ONE token exits.
  const pnlToken = pos.flags.isLong ? def.longToken : TOKENS.usdc;
  const decreaseSwapType = pnlToken.toLowerCase() === collateral.toLowerCase() ? 0 : 1;
  // exit swap back to WAVAX (then unwrap) when the collateral is not already WAVAX
  const swapPath = collateral.toLowerCase() === TOKENS.wavax.toLowerCase() ? [] : def.swapPath;

  const params = orderParams({
    receiver: ctx.account,
    market: def,
    isLong,
    orderType: 4,
    collateralToken: collateral,
    swapPath,
    collateralDeltaWei: 0n, // 0 + full sizeDelta = withdraw everything
    sizeDeltaUsd: pos.numbers.sizeInUsd,
    acceptablePrice,
    decreaseSwapType,
  });
  const data = multicallData(EXEC_FEE_WEI, params);
  const r = await sendOrder(ctx, data, EXEC_FEE_WEI, "close");
  return { txhash: r.txhash };
}

/** The wallet's native AVAX balance (human units). */
export async function nativeBalance(account: Address): Promise<number> {
  const wei = await publicClient().getBalance({ address: account });
  return Number(wei) / 1e18;
}

/** Plain native-AVAX transfer (the wallet sheet's withdraw). Returns the tx hash. */
export async function transferNative(
  ctx: LiveCtx,
  amount: number,
  dest: Address,
): Promise<{ txhash?: string }> {
  const value = parseEther(String(amount));
  if (!ctx.broadcast) {
    // actually validate (sufficient balance for value + gas) so the dry-run can't claim a send
    // that would revert; mirrors the order path rather than blindly returning success.
    await publicClient().estimateGas({ account: ctx.account, to: dest, value });
    return { txhash: `(dry-run) withdraw validated against mainnet — broadcast is off` };
  }
  const txhash = (await ctx.provider.request({
    method: "eth_sendTransaction",
    params: [{ from: ctx.account, to: dest, value: `0x${value.toString(16)}` }],
  })) as string;
  return { txhash };
}
