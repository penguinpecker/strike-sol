// Client-readable config (NEXT_PUBLIC_*). Server-only values (RPC overrides, etc.) live in the
// route handlers via non-public env vars. Nothing here is a secret.

export type StrikeMode = "paper" | "live";

// Parse the fee rate defensively: empty/missing → the 0.69% default; explicit 0 disables it; a
// malformed or out-of-range value (which would otherwise render the money display as NaN or a
// fat-fingered "69") also falls back to the default. Sane range is [0, 0.1) (< 10%).
function parseFeeRate(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 0.0069;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n < 0.1 ? n : 0.0069;
}

export const config = {
  mode: (process.env.NEXT_PUBLIC_STRIKE_MODE as StrikeMode) || "paper",
  market: process.env.NEXT_PUBLIC_MARKET || "BTC/USD",
  // Chart/settlement price source. "gmx" (default) streams gmxinfra tickers — the public mirror
  // of the Chainlink Data Streams reports GMX keepers fill against, so the number you watch is
  // the fill basis (1s cadence). "binance" is a smoother-looking alternative that drifts from the
  // fill — demo aesthetics only.
  priceFeed: (process.env.NEXT_PUBLIC_PRICE_FEED as "gmx" | "binance") || "gmx",
  // Public Avalanche C-Chain RPC (~1s blocks). A dedicated RPC is optional — the public endpoint
  // held up in every live test. Used client-side for order sends + fill watching.
  avaxRpc: process.env.NEXT_PUBLIC_AVAX_RPC || "https://api.avax.network/ext/bc/C/rpc",
  // Privy app id (public). When set, real 𝕏 OAuth login activates and an EVM embedded wallet is
  // created on login; otherwise the prototype handle-entry flow is used. Create at
  // dashboard.privy.io, enable Twitter login, and add your domains to Allowed origins.
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || "",
  // round duration for one tap (ms) — the 30-second call
  roundMs: 60_000,
  // STRIKE platform fee, charged on the STAKE when OPENING a live call (default 0.69%). Collected
  // on-chain in the SAME open transaction (a sendWnt leg pays the treasury in WAVAX) — not just a
  // display deduction. Set the rate to 0 to disable. On GMX we ALSO carry a referral code + a
  // uiFeeReceiver, but those are separate protocol-level hooks.
  platformFeeRate: parseFeeRate(process.env.NEXT_PUBLIC_STRIKE_FEE_RATE),
  // Where the platform fee lands. Defaults to the STRIKE deployer/ops wallet. Plain EVM address;
  // when unset/zero the fee is skipped (and the live path logs it — never silent).
  feeTreasury: (process.env.NEXT_PUBLIC_STRIKE_TREASURY || "0x3377a17625ea82155d2508e48904bee4f562829e") as `0x${string}`,
  // GO-LIVE GATE. Even in mode "live", no transaction is broadcast unless this is "true". Lets us
  // wire + dry-run the entire live path (build + validate vs mainnet) against a funded wallet
  // before any real send. Flip to "true" only when ready to trade for real.
  liveBroadcast: process.env.NEXT_PUBLIC_STRIKE_LIVE_BROADCAST === "true",
} as const;

// The base symbol STRIKE trades, e.g. "BTC/USD" -> "BTC".
export function baseAsset(market = config.market): string {
  return market.split("/")[0]?.toUpperCase() || "BTC";
}
export function binanceSymbol(market = config.market): string {
  return `${baseAsset(market)}USDT`.toLowerCase();
}
export function coinbaseProduct(market = config.market): string {
  return `${baseAsset(market)}-USD`;
}
