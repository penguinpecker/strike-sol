// Avalanche / GMX v2 network constants for the STRIKE read + write layers.
//
// All addresses verified against live mainnet (2026-07-05 survey): the exact instruction bytes our
// builder produces byte-match real production orders, and every sim (open/close/min-size) passed.
// GMX market addresses are stable per deployment, so we pin them directly.

export const CHAIN_ID = 43114; // Avalanche C-Chain

// Public C-Chain RPC — no key, ~1s blocks, generous limits. Override via env for dedicated infra.
export const DEFAULT_RPC = "https://api.avax.network/ext/bc/C/rpc";
// The api.avax.network WSS delivers logs (~1.7s push lag). publicnode's WSS accepts and never
// delivers — do not use it (verified 2026-07-05).
export const DEFAULT_WSS = "wss://api.avax.network/ext/bc/C/ws";

// GMX's free price mirror of the Chainlink Data Streams reports keepers fill against — charting
// THIS means the number on screen is the fill basis (1s update cadence, verified live).
export const GMX_ORACLE_URL = "https://avalanche-api.gmxinfra.io";
// GMX's own indexer (order/trade history; lags chain head by ~3-56 blocks — history only).
export const GMX_SUBSQUID_URL = "https://gmx.squids.live/gmx-synthetics-avalanche/graphql";

// ── GMX v2 contracts (Avalanche deployment) ──
export const CONTRACTS = {
  exchangeRouter: "0x8f550E53DFe96C055D5Bdb267c21F268fCAF63B2",
  orderVault: "0xD3D60D22d415aD43b7e64b510D86A30f19B1B12C",
  dataStore: "0x2F0b22339414ADeD7D5F06f9D604c7fF5b2fe3f6",
  reader: "0x62Cb8740E6986B29dC671B2EB596676f60590A5B", // SyntheticsReader (Avalanche), per @gmx-io/sdk configs
  eventEmitter: "0xDb17B211c34240B014ab6d61d4A31FA0C0e20c26",
  referralStorage: "0x827ED045002eCdAbEb6e2b0d1604cf5fC3d322F8",
} as const;

// ── tokens ──
export const TOKENS = {
  wavax: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
  usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  btcb: "0x152b9d0FdC40C096757F570A51E494bd4b943E50",
} as const;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;
export const ZERO_BYTES32 = ("0x" + "0".repeat(64)) as `0x${string}`;

// STRIKE revenue hooks. The referral code pays STRIKE 5% of position fees (tier 0) and discounts
// the trader 5%; the uiFeeReceiver collects the ui fee at whatever factor the receiver registered
// on-chain via setUiFeeFactor (0 until registered — attaching it is always safe).
// Ops wallet = the STRIKE operator key (also holds the exit liquidity on Base).
export const STRIKE_UI_FEE_RECEIVER = "0x3377a17625ea82155d2508e48904bee4f562829e" as `0x${string}`;
// bytes32 of the ASCII code "STRIKE" (right-padded) — registered on ReferralStorage by the ops
// wallet. If registration finds it taken, update this constant with the fallback code used.
// (hex spelled out — no Buffer in the client bundle)
export const STRIKE_REFERRAL_CODE = ("0x535452494b45" + "0".repeat(52)) as `0x${string}`;

export interface MarketDef {
  /** Display symbol, e.g. "BTC/USD". */
  symbol: string;
  /** Base asset symbol — also the gmxinfra tickers tokenSymbol. */
  base: string;
  /** GM market (pool) address the position lives in. */
  marketAddress: `0x${string}`;
  /** Index token decimals (price scale: USD*1e30 / 10^decimals per contract unit). */
  indexTokenDecimals: number;
  /** Collateral token our opens fund (positions margin in this). */
  collateralToken: `0x${string}`;
  /** Collateral token decimals. */
  collateralDecimals: number;
  /** The market's long token (longs' PnL pays out in this; shorts' in USDC). */
  longToken: `0x${string}`;
  /** Markets the AVAX->collateral swap routes through on open (reverse on close). [] = no swap. */
  swapPath: `0x${string}`[];
  /** PnL-token→collateral swap mode on decrease (1 = SwapPnlTokenToCollateralToken). */
  decreaseSwapType: number;
  /** Binance ws pair (aesthetic fallback feed only). */
  binanceSymbol: string;
  /** Coinbase product (aesthetic fallback feed only). */
  coinbaseProduct: string;
}

// BTC/USD [BTC-USDC]: fund with native AVAX, router swaps WAVAX->USDC through the AVAX/USD pool
// (swap leg ~15bps of collateral each way); close swaps back and unwraps to native AVAX.
// AVAX/USD [AVAX-USDC]: fund with native AVAX as WAVAX collateral directly — no swap either way.
export const MARKETS: Record<string, MarketDef> = {
  "BTC/USD": {
    symbol: "BTC/USD",
    base: "BTC",
    marketAddress: "0xFb02132333A79C8B5Bd0b64E3AbccA5f7fAf2937",
    indexTokenDecimals: 8,
    collateralToken: TOKENS.usdc,
    collateralDecimals: 6,
    longToken: TOKENS.btcb,
    swapPath: ["0x913C1F46b48b3eD35E7dc3Cf754d4ae8499F31CF"],
    decreaseSwapType: 1,
    binanceSymbol: "btcusdt",
    coinbaseProduct: "BTC-USD",
  },
  "AVAX/USD": {
    symbol: "AVAX/USD",
    base: "AVAX",
    marketAddress: "0x913C1F46b48b3eD35E7dc3Cf754d4ae8499F31CF",
    indexTokenDecimals: 18,
    collateralToken: TOKENS.wavax,
    collateralDecimals: 18,
    longToken: TOKENS.wavax,
    swapPath: [],
    decreaseSwapType: 0,
    binanceSymbol: "avaxusdt",
    coinbaseProduct: "AVAX-USD",
  },
};

export function marketDef(symbol = "BTC/USD"): MarketDef {
  return MARKETS[symbol] ?? MARKETS["BTC/USD"];
}

/** Server RPC override (AVAX_RPC) falls back to the public default. */
export function rpcUrl(): string {
  return process.env.AVAX_RPC || process.env.NEXT_PUBLIC_AVAX_RPC || DEFAULT_RPC;
}
