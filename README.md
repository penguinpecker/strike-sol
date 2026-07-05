<div align="center">

# STRIKE

**Tap-to-trade perpetuals on Avalanche.**

Call the price up or down on a live chart, ride a 60-second round, cash out — or get liquidated.
Every tap opens a **real leveraged perp on GMX v2**, funded in native AVAX. No paper layer: the number
on the chart is the price your position fills at, and the PnL is real on-chain money.

[**▶ Play → strike-avalanche.vercel.app**](https://strike-avalanche.vercel.app)

</div>

---

## Highlights

- **Real perps, arcade speed.** Each tap opens and closes an actual GMX v2 position; the round is a 60-second timer over live money.
- **Native AVAX in and out.** Fund a trade with AVAX, receive AVAX back — the swap into and out of the venue's collateral happens inside the same transaction.
- **Self-custodial.** No STRIKE backend holds funds. The player's Privy embedded wallet signs; GMX's contracts settle; collateral escrows in GMX's own vaults.
- **Sub-second entry.** Opens are optimistic — the round starts the instant the transaction is broadcast, and the keeper fill confirms in the background.
- **Crash-safe.** A live position is real leveraged money with no auto-close; STRIKE mirrors every open to storage and reconciles/closes any stranded position on reconnect, so a reload can never orphan exposure.

---

## How it works

Tap **↑** or **↓** on the live BTC or AVAX price. A 60-second round opens; you win or lose based on the real price move × your leverage, and you can cash out early at any time. Stakes are in AVAX (0.25 / 0.5 / 1); the asset price you bet on is shown in USD.

STRIKE is a thin, fast game loop wrapped around a real derivatives venue. GMX is an oracle-and-keeper perps protocol built for deliberate trading, and STRIKE drives it like an arcade cabinet — a new leveraged position every few seconds. Most of the engineering is in making that safe and honest: real fills, real money, no orphaned positions, and a displayed number that reflects what actually leaves the wallet.

The whole thing runs client-side against public infrastructure — no matching engine, no custody, no server that holds funds.

---

## Execution — GMX v2, built raw

Positions live on [GMX v2](https://gmx.io) (the Synthetics deployment) on the Avalanche C-Chain. Orders are built by hand with `viem` rather than through GMX's high-level SDK, because the game needs native-AVAX in *and* out, a platform-fee leg in the same transaction, and full control over acceptable-price bounds. The SDK is still used — as a source of verified contract ABIs and addresses.

An **open** is a single `ExchangeRouter.multicall`:

```
multicall([
  sendWnt(treasury,   feeWei),          // 0.69% platform fee, paid as WAVAX
  sendWnt(orderVault, collateral + exec),// the stake + a refundable keeper deposit
  createOrder({ MarketIncrease, ... })   // the position request
])
```

`sendWnt` wraps the native AVAX attached as `msg.value` and routes it — part to the fee treasury, the rest to GMX's order vault. For the **BTC** market the order carries a `swapPath` so the router swaps WAVAX→USDC into the position's collateral in the same call; the **AVAX** market takes WAVAX collateral directly with no swap. A **close** is the mirror: a full-size `MarketDecrease` that swaps the collateral back and unwraps it, so proceeds land in the wallet as native AVAX. The instruction bytes are verified byte-for-byte against live production GMX orders.

### The fill model

GMX doesn't fill synchronously. A transaction *creates* an order; a GMX **keeper** executes it a few seconds later at the Chainlink Data Streams oracle price. So an open is two on-chain events — the create transaction, then an `OrderExecuted` (or `OrderCancelled`) from the keeper. Measured latency on Avalanche is 3–5 seconds. Because fills come from the GM pool against an oracle price, fill *quality* is independent of market volume — a small order fills with essentially zero slippage. If the keeper can't fill within the acceptable-price band, the order is cancelled and the collateral refunded.

---

## Price feed

The chart streams from **GMX's oracle mirror** (`gmxinfra` tickers) — the public feed of the same Chainlink Data Streams reports the keepers fill against. Charting that feed makes the displayed price the *fill basis*: no divergence between what you watch and what you get. It updates once per second, polled at ~700 ms with a staleness watchdog that fails over to Binance → Coinbase → REST if the primary goes quiet, so the chart can never freeze on a stale-but-live-looking price.

---

## Wallet

Auth and signing run through [Privy](https://privy.io): an X/Twitter login mints a self-custodial EVM embedded wallet (secp256k1), pinned to Avalanche (chain 43114). It exposes a standard EIP-1193 provider — every tap is one `eth_sendTransaction`, and with wallet UIs disabled it signs without a modal, so tapping stays instant. STRIKE never sees or holds a key.

---

## Safety — no orphaned positions

A GMX position is real leveraged money with **no auto-close**; the round is only a client-side timer. STRIKE closes that gap on several fronts:

- **A broadcast transaction never loses its hash.** A receipt-wait timeout or RPC hiccup returns a *pending* result rather than throwing, so the round still tracks the position and can close it. Only an on-chain revert or a keeper cancellation (both mean no position exists) aborts the tap.
- **Every live open is mirrored to storage** at open time and cleared only once its close *confirms*. On the next wallet connect the app reconciles: if that exact market-and-side position is still open on-chain, it closes it — touching only the position STRIKE recorded opening, never an unrelated GMX position.
- **Closes retry with backoff**, and if every attempt fails the record is kept for the next session to reconcile, with a persistent warning rather than a transient toast.
- A **beforeunload guard** warns before navigating away mid-round.

A per-account serial transaction queue guarantees an open and the close that follows can never race.

---

## Fees

Two things are charged per round trip. All figures below are **decoded from real on-chain trades** (GMX `PositionFeesCollected` / `SwapFeesCollected` events), not estimates.

- **STRIKE platform fee** — 0.69% of the stake, collected on-chain in the open transaction and paid to the treasury as WAVAX. It is shown in the pre-trade cost and deducted from displayed PnL.
- **GMX protocol fees** — a position fee of **0.04% (favorable side) / 0.06% (unfavorable side) of notional** per side (read from GMX's DataStore, identical on both markets), plus, on the BTC market only, a WAVAX↔USDC swap leg.

Every order also carries a GMX referral code and a UI-fee receiver — the protocol's built-in revenue hooks.

### Worked example — a 10× round trip, as % of the capital staked

| Fee | BTC | AVAX |
|---|---|---|
| GMX position fee (open + close) | ~1.00% | ~1.00% |
| GMX swap leg (WAVAX↔USDC) | 0.075% | **0.000%** — native WAVAX collateral, no swap |
| STRIKE platform fee | 0.690% | 0.690% |
| Network gas (both txs) | ~0.031% | ~0.013% |
| Borrowing + funding (sub-minute hold) | 0.000% | 0.000% |
| **Total round-trip cost** | **~1.80%** | **~1.72%** |
| Execution-fee deposit | — | — refundable float, not a cost |

**Reading it:**

- The **GMX position fee scales with leverage** — it's charged on notional, so at 10× it's ~1.0% of the capital staked; at 20× it's ~2.0%. The **STRIKE fee is fixed** at 0.69% of the stake regardless of leverage.
- **AVAX trades are cheaper than BTC by exactly the swap leg (~0.075% of capital)**, because AVAX is the native collateral and skips the WAVAX↔USDC conversion. The AVAX market's executions emit *zero* swap-fee events.
- At 10× the total round-trip cost is ~1.8% of the stake, so **break-even is roughly a 0.18% price move** in the called direction.
- **Gas is negligible** on Avalanche (~$0.001 per round trip), and the ~0.01 AVAX execution deposit per order is refundable float — the keeper's unused portion is returned in the execution transaction.

---

## Tech stack

Next.js 15 (App Router) · React 19 · TypeScript · Zustand · viem · GMX v2 · Privy · Supabase · Vercel. A hand-tuned canvas engine drives the 60fps hot path (price / PnL / chart / timer) imperatively via refs, outside React; React owns only the discrete UI state.

---

## Layout

```
app/api/gmx/*         server read layer — prices, market config (from DataStore), the trade tape
lib/gmx/gmxTrade.ts   the raw order builder + fill watcher + reconciliation reads
lib/gmx/gmxSigner.ts  the Privy EIP-1193 signer + per-account transaction queue
lib/gmx/server.ts     gmxinfra prices, cached pair config, the GMX indexer tape
lib/game/engine.ts    the imperative 60fps game loop (chart, PnL, timer, live open/close)
lib/feed/priceFeed.ts the oracle price feed with failover + staleness watchdog
```
