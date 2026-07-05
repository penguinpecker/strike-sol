// gmx-rail — the safety layer every STRIKE trade goes through.
//
// Framework-agnostic and client-safe (no heavy import): input clamping, a min-notional precheck,
// a cost/breakeven preview, a per-account serial tx queue, and a typed error taxonomy. The actual
// on-chain signer plugs in behind `Signer` (see gmxSigner.ts).

import type { GmxPairConfig } from "./types";

export type Side = "long" | "short";

export class GmxRailError extends Error {
  constructor(
    public code:
      | "BELOW_MIN_NOTIONAL"
      | "BAD_INPUT"
      | "INSUFFICIENT_BALANCE"
      | "SIGNER_NOT_WIRED"
      | "MARKET_CLOSED"
      | "ORDER_CANCELLED"
      | "CHAIN_REJECTED"
      | "TIMEOUT",
    message: string,
  ) {
    super(message);
    this.name = "GmxRailError";
  }
}

export interface TapIntent {
  stake: number; // native AVAX collateral
  leverage: number;
  side: Side;
  slippage?: number; // fraction; default 0.01 (GMX cancels-not-fills beyond acceptablePrice)
}

export interface Validation {
  ok: boolean;
  code?: GmxRailError["code"];
  reason?: string;
}

// ── input clamping ──
export function validateInputs(t: TapIntent): Validation {
  if (!Number.isFinite(t.stake) || t.stake <= 0)
    return { ok: false, code: "BAD_INPUT", reason: "stake must be > 0" };
  if (!Number.isFinite(t.leverage) || t.leverage < 1)
    return { ok: false, code: "BAD_INPUT", reason: "leverage must be ≥ 1" };
  const slip = t.slippage ?? 0.01;
  if (!Number.isFinite(slip) || slip <= 0 || slip >= 1)
    return { ok: false, code: "BAD_INPUT", reason: "slippage must be in (0,1)" };
  if (t.side !== "long" && t.side !== "short")
    return { ok: false, code: "BAD_INPUT", reason: "side must be long|short" };
  return { ok: true };
}

// ── market minimum + leverage cap (USD-valued: the stake is AVAX) ──
export function validateNotional(t: TapIntent, cfg: GmxPairConfig, avaxUsd: number): Validation {
  if (avaxUsd > 0) {
    const stakeUsd = t.stake * avaxUsd;
    const notionalUsd = stakeUsd * t.leverage;
    if (notionalUsd < cfg.minPositionValue || stakeUsd < cfg.minCollateralUsd) {
      return {
        ok: false,
        code: "BELOW_MIN_NOTIONAL",
        reason: `position too small — GMX needs ≥ $${cfg.minCollateralUsd} margin and ≥ $${cfg.minPositionValue} size`,
      };
    }
  }
  if (t.leverage > cfg.maxLeverage) {
    return { ok: false, code: "BAD_INPUT", reason: `max leverage is ${cfg.maxLeverage}x` };
  }
  return { ok: true };
}

export function validateTap(t: TapIntent, cfg: GmxPairConfig, balance: number, avaxUsd: number): Validation {
  const inp = validateInputs(t);
  if (!inp.ok) return inp;
  if (t.stake > balance)
    return { ok: false, code: "INSUFFICIENT_BALANCE", reason: "not enough balance" };
  return validateNotional(t, cfg, avaxUsd);
}

// ── cost + breakeven preview (position fee both sides) ──
export interface CostQuote {
  notional: number; // in AVAX terms (stake currency), like every other figure here
  openFee: number;
  closeFee: number;
  platformFee: number; // STRIKE fee on the stake
  txFees: number; // 2 create txs + net keeper cost after execution-fee refunds (measured ~$0.002)
  roundTripCost: number;
  roundTripPctOfStake: number;
  breakevenMovePct: number;
  breakevenMoveUsd: (markPrice: number) => number;
}

const FIXED_TX_FEE = 0.0005; // AVAX per side — generous vs the ~0.0002 measured net cost
// Markets whose collateral isn't native AVAX route the stake through a swap leg on the way in AND
// out (WAVAX<->USDC for BTC), each ~15bps of the STAKE. hasSwapLeg tells the quote to include it.
const SWAP_LEG_FEE_RATE = 0.0015;

export function quoteCost(t: TapIntent, cfg: GmxPairConfig, platformFeeRate = 0, hasSwapLeg = false): CostQuote {
  const notional = t.stake * t.leverage;
  const openFee = notional * cfg.takerFeeRate;
  const closeFee = notional * cfg.takerFeeRate;
  // coerce a non-finite rate to 0 so a bad env value can never render the money display as NaN
  const feeRate = Number.isFinite(platformFeeRate) ? platformFeeRate : 0;
  const platformFee = t.stake * feeRate; // STRIKE fee on the stake, once per call
  // swap leg is charged on the collateral (stake), both directions
  const swapFees = hasSwapLeg ? t.stake * SWAP_LEG_FEE_RATE * 2 : 0;
  const txFees = FIXED_TX_FEE * 2;
  const roundTripCost = openFee + closeFee + platformFee + swapFees + txFees;
  const breakevenMovePct = (roundTripCost / notional) * 100;
  return {
    notional,
    openFee,
    closeFee,
    platformFee,
    txFees,
    roundTripCost,
    roundTripPctOfStake: (roundTripCost / t.stake) * 100,
    breakevenMovePct,
    breakevenMoveUsd: (markPrice: number) => (breakevenMovePct / 100) * markPrice,
  };
}

// ── per-account serial queue (prevents nonce races + self-racing closes) ──
// Every on-chain submission for one account goes through here: an in-flight open and the close
// that follows must never race (GMX cancels a decrease racing its own increase as EmptyPosition —
// and a cancelled order still burns its keeper fee).
export class TxQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(job: () => Promise<T>): Promise<T> {
    const out = this.tail.then(job, job);
    this.tail = out.then(
      () => undefined,
      () => undefined,
    );
    return out;
  }
}

// ── the signer the live write-path plugs into ──
export interface OpenResult {
  txhash: string;
  orderKey?: string;
  isLong: boolean;
  // "executed" = keeper fill confirmed on-chain; "pending" = tx broadcast but fill not yet confirmed
  // (slow confirmation) — the position may or may not exist yet, so the UI must not claim success.
  fill: "executed" | "pending";
}
export interface Signer {
  account: string;
  openMarket(t: TapIntent & { symbol: string; markPrice: number }): Promise<OpenResult>;
  // GMX keys positions by (account, market, collateralToken, isLong) — long and short on the same
  // market coexist and are NOT netted — so a close MUST target the exact side this call opened.
  closeMarket(p: { symbol: string; isLong: boolean; slippage?: number }): Promise<{ txhash: string }>;
}

export class UnwiredSigner implements Signer {
  account = "(unwired)";
  async openMarket(): Promise<OpenResult> {
    throw new GmxRailError(
      "SIGNER_NOT_WIRED",
      "live on-chain trading needs a connected wallet — running in paper mode",
    );
  }
  async closeMarket(_p: { symbol: string; isLong: boolean; slippage?: number }): Promise<{ txhash: string }> {
    throw new GmxRailError("SIGNER_NOT_WIRED", "no signer wired");
  }
}
