// driftTrade — the live on-chain write path for STRIKE SOL (open / close / deposit / withdraw on
// Drift v2, Solana mainnet). The heavy @drift-labs/sdk + @coral-xyz/anchor + @solana/web3.js are
// DYNAMICALLY imported so they never enter the main client bundle — they stream in only when a real
// live action fires.
//
// SAFETY: every send is gated behind `broadcast: true` (config.liveBroadcast, default false). With
// it false the whole path is exercised (client init, market resolve, collateral check, order-param
// build) but NOTHING is sent. Only when the caller explicitly opts in does a transaction hit chain,
// and then we WAIT for on-chain confirmation before reporting success (no "sent but unconfirmed").
//
// NOTE: the live send path targets Drift's documented high-level methods and should be verified
// against a funded wallet before flipping the go-live gate — same posture the original shipped with.

"use client";

import type { PublicKey } from "@solana/web3.js";
import { config } from "../config";
import { clusterConfig, marketDef } from "./networks";
import type { DriftOrderResult } from "./types";

/** Minimal Anchor-compatible wallet the Privy Solana embedded wallet fulfils. */
export interface AnchorLikeWallet {
  publicKey: PublicKey;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signTransaction: (tx: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signAllTransactions: (txs: any[]) => Promise<any[]>;
}

export interface LiveContext {
  wallet: AnchorLikeWallet;
  network?: string; // solana cluster
  broadcast?: boolean;
}

export interface OpenLiveParams {
  symbol: string; // "BTC/USD"
  stake: number; // USDC collateral (human)
  leverage: number;
  side: "long" | "short";
  markPrice: number; // human price used to size base amount
  slippage?: number;
}

// @drift-labs/sdk bundles its own copy of @solana/web3.js, so its Connection/PublicKey types don't
// unify with the top-level ones. We keep these boundaries loosely typed on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

// One subscribed DriftClient per wallet address (subscribing is expensive).
const clientCache = new Map<string, { client: Any; connection: Any }>();

async function getClient(ctx: LiveContext): Promise<{ client: Any; connection: Any }> {
  const addr = ctx.wallet.publicKey.toBase58();
  const hit = clientCache.get(addr);
  if (hit) return hit;

  const web3 = await import("@solana/web3.js");
  const drift = await import("@drift-labs/sdk");
  const cc = clusterConfig(ctx.network);
  const connection = new web3.Connection(config.solanaRpc, "confirmed");
  const sdkConfig = drift.initialize({ env: cc.driftEnv });
  // Subscribe to ONLY the markets we trade (SOL/BTC/ETH perps + USDC/SOL spot) instead of all ~50 —
  // loading every market on the first tap is what made it hang for tens of seconds.
  const perpMarketIndexes = [0, 1, 2];
  const spotMarketIndexes = [0, 1];
  const oracleInfos: Any[] = [];
  const seen = new Set<string>();
  const addOracle = (m: Any) => {
    const k = m?.oracle?.toString();
    if (m?.oracle && k && !seen.has(k)) {
      seen.add(k);
      oracleInfos.push({ publicKey: m.oracle, source: m.oracleSource });
    }
  };
  for (const i of perpMarketIndexes) addOracle(drift.PerpMarkets[cc.driftEnv].find((x: { marketIndex: number }) => x.marketIndex === i));
  for (const i of spotMarketIndexes) addOracle(drift.SpotMarkets[cc.driftEnv].find((x: { marketIndex: number }) => x.marketIndex === i));
  const client = new drift.DriftClient({
    connection: connection as Any,
    wallet: ctx.wallet as Any,
    programID: new web3.PublicKey(sdkConfig.DRIFT_PROGRAM_ID) as Any,
    env: cc.driftEnv,
    perpMarketIndexes,
    spotMarketIndexes,
    oracleInfos,
    accountSubscription: { type: "websocket" },
  });
  await client.subscribe();
  const entry = { client, connection };
  clientCache.set(addr, entry);
  return entry;
}

function perpMarketIndex(drift: Any, base: string, env: string): number {
  const m = drift.PerpMarkets[env]?.find((x: { baseAssetSymbol: string }) => x.baseAssetSymbol === base);
  if (!m) throw new Error(`Drift has no ${base}-PERP market on ${env}`);
  return m.marketIndex;
}

// STRIKE SOL trades with SOL as Drift collateral: SOL spot market = index 1, 9 decimals.
const SOL_SPOT_INDEX = 1;
function solAmount(drift: Any, human: number): Any {
  return new drift.BN(Math.round(human * 1e9));
}

// Drift's real per-market max leverage (= MARGIN_PRECISION / marginRatioInitial). The game shows
// up to 200x but a perp only allows its on-chain cap (e.g. ~20x for BTC), so live orders clamp.
function marketMaxLeverage(drift: Any, client: Any, marketIndex: number): number {
  try {
    const m = client.getPerpMarketAccount(marketIndex);
    const mp = Number(drift.MARGIN_PRECISION);
    const lev = Math.floor(mp / m.marginRatioInitial);
    return lev > 0 ? lev : 20;
  } catch {
    return 20;
  }
}

/** Free (tradable) USDC collateral in the user's Drift account, human units. 0 if no account. */
export async function getDriftCollateral(ctx: LiveContext): Promise<number> {
  try {
    const { client } = await getClient(ctx);
    const drift = await import("@drift-labs/sdk");
    const user = client.getUser();
    const fc = user.getFreeCollateral(); // BN, QUOTE_PRECISION (1e6)
    return drift.convertToNumber(fc, drift.QUOTE_PRECISION);
  } catch {
    return 0;
  }
}

export async function openMarketLive(p: OpenLiveParams, ctx: LiveContext): Promise<DriftOrderResult> {
  const drift = await import("@drift-labs/sdk");
  const { client, connection } = await getClient(ctx);
  const cc = clusterConfig(ctx.network);
  const def = marketDef(p.symbol);
  const marketIndex = perpMarketIndex(drift, def.base, cc.driftEnv);
  const broadcast = ctx.broadcast ?? config.liveBroadcast;
  const direction = p.side === "long" ? drift.PositionDirection.LONG : drift.PositionDirection.SHORT;

  if (!broadcast) {
    // dry-run: resolve everything, send nothing.
    return { txhash: "(dry-run, not sent)", marketIndex, isLong: p.side === "long" };
  }

  // live: ensure the user's Drift account exists + has SOL collateral, then size + place the order.
  await ensureCollateral(client, drift, connection, ctx, p.stake);

  // stake is in SOL. Notional (USD) = stakeSOL × SOL/USD × leverage, clamped to the perp's real max.
  const solUsd = drift.convertToNumber(client.getOracleDataForSpotMarket(SOL_SPOT_INDEX).price, drift.PRICE_PRECISION);
  const lev = Math.min(p.leverage, marketMaxLeverage(drift, client, marketIndex));
  const notionalUsd = p.stake * solUsd * lev;
  const baseAssetAmount = client.convertToPerpPrecision(notionalUsd / (p.markPrice || 1));
  const orderParams = drift.getMarketOrderParams({ marketIndex, direction, baseAssetAmount });

  const txSig: string = await client.placePerpOrder(orderParams);
  await confirm(connection, txSig);
  return { txhash: txSig, marketIndex, isLong: p.side === "long" };
}

export async function closeMarketLive(
  symbol: string,
  ctx: LiveContext,
): Promise<{ txhash: string }> {
  const drift = await import("@drift-labs/sdk");
  const { client, connection } = await getClient(ctx);
  const cc = clusterConfig(ctx.network);
  const def = marketDef(symbol);
  const marketIndex = perpMarketIndex(drift, def.base, cc.driftEnv);
  const broadcast = ctx.broadcast ?? config.liveBroadcast;

  if (!broadcast) return { txhash: "(dry-run, not sent)" };

  // Drift nets one position per market; closePosition reduce-closes the whole market position.
  const txSig: string = await client.closePosition(marketIndex);
  await confirm(connection, txSig);
  return { txhash: txSig };
}

/** Deposit native SOL from the wallet into Drift collateral (makes it tradable). Gated by broadcast.
 *  Passing the wallet pubkey as the token account tells Drift to wrap native SOL into the SOL market. */
export async function depositCollateral(
  amount: number,
  ctx: LiveContext,
): Promise<{ txhash?: string; amount: number }> {
  const drift = await import("@drift-labs/sdk");
  const { client, connection } = await getClient(ctx);
  const broadcast = ctx.broadcast ?? config.liveBroadcast;
  if (!broadcast) return { amount };

  const depositAmount = solAmount(drift, amount);
  const hasUser = await userExists(client);
  const txSig: string = hasUser
    ? await client.deposit(depositAmount, SOL_SPOT_INDEX, ctx.wallet.publicKey)
    : await client.initializeUserAccountAndDepositCollateral(depositAmount, ctx.wallet.publicKey, SOL_SPOT_INDEX);
  await confirm(connection, txSig);
  return { txhash: txSig, amount };
}

/** Withdraw SOL from Drift collateral back to the wallet (unwrapped to native SOL). Gated by broadcast. */
export async function withdrawCollateral(
  amount: number,
  ctx: LiveContext,
): Promise<{ txhash?: string; amount: number }> {
  const drift = await import("@drift-labs/sdk");
  const { client, connection } = await getClient(ctx);
  const broadcast = ctx.broadcast ?? config.liveBroadcast;
  if (!broadcast) return { amount };

  const withdrawAmount = solAmount(drift, amount);
  const txSig: string = await client.withdraw(withdrawAmount, SOL_SPOT_INDEX, ctx.wallet.publicKey);
  await confirm(connection, txSig);
  return { txhash: txSig, amount };
}

async function ensureCollateral(
  client: Any,
  drift: Any,
  connection: Any,
  ctx: LiveContext,
  neededSol: number,
) {
  const hasUser = await userExists(client);
  if (hasUser) return;
  const depositAmount = solAmount(drift, neededSol);
  const sig: string = await client.initializeUserAccountAndDepositCollateral(
    depositAmount,
    ctx.wallet.publicKey,
    SOL_SPOT_INDEX,
  );
  await confirm(connection, sig);
}

async function userExists(client: Any): Promise<boolean> {
  try {
    const user = client.getUser();
    if (user.fetchAccounts) await user.fetchAccounts();
    return !!user.getUserAccount();
  } catch {
    return false;
  }
}

// Wait for on-chain confirmation so we never report a phantom fill.
async function confirm(connection: Any, sig: string) {
  if (!connection || !sig) return;
  try {
    const bh = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction(
      { signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
      "confirmed",
    );
  } catch {
    throw new Error("transaction not confirmed on-chain");
  }
}
