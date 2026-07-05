// Shared GMX domain types (the subset STRIKE consumes). Human/display units throughout — contract
// scales (1e30 USD, token decimals) stay inside the trade layer, so the game/UI code stays clean.

export interface GmxMarket {
  symbol: string; // display symbol, e.g. "BTC/USD"
  base: string; // "BTC"
  marketAddress: string;
  price: number; // oracle mark price (human units)
  oiLong: number;
  oiShort: number;
  volume: number; // 24h notional
  maxLeverage: number;
  status: "open" | "closed";
}

// Per-market trading config (fees + the min order) used to pre-validate a tap and preview cost.
export interface GmxPairConfig {
  symbol: string;
  marketAddress: string;
  takerFeeRate: number; // fraction per side, e.g. 0.0006 (6 bps, negative-impact side)
  makerFeeRate: number; // GMX has no maker rebate; the positive-impact side rate lands here
  minPositionValue: number; // USD notional floor ($1 on this deployment, read on-chain)
  minCollateralUsd: number; // USD collateral floor ($1)
  maxLeverage: number;
}

// A real on-chain trade (from the GMX subsquid tape) — drives the live feed, leaderboard, pins.
export interface RecentTrade {
  account: string; // EVM address (0x…)
  symbol: string; // display symbol
  isLong: boolean;
  isOpen: boolean; // increase vs decrease
  price: number;
  pnl: number; // realized pnl in USD (decrease records), human units
  leverage: number; // notional / collateral (rounded)
  ts: number; // ms
  txhash?: string;
}

// A trader's live position (human units).
export interface GmxPosition {
  marketAddress: string;
  symbol: string;
  isLong: boolean;
  collateralUsd: number;
  sizeUsd: number;
  sizeInTokens: number;
  entryPrice: number;
  collateralToken: string;
  collateralAmount: number; // in collateral token human units
}

export interface GmxOrderResult {
  txhash: string;
  orderKey?: string;
  isLong: boolean;
  /** "executed" = keeper fill confirmed; "cancelled" throws instead; "pending" = fill unconfirmed within the wait window. */
  fill: "executed" | "pending";
}
