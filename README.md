# STRIKE SOL

Tap-to-trade BTC & SOL perps on **Solana**. Call ↑ or ↓ on a giant live price, ride 30 seconds, cash out — or get liquidated. A fluorescent-purple neon chart, a live moving-cents ticker, PnL floods, and 𝕏-pfp pins for every call.

**Live:** https://strike-sol.vercel.app

## Stack

- **App:** Next.js 15 (App Router) · React 19 · Zustand · TypeScript. A hand-tuned canvas engine drives the 60fps hot path (price / PnL / chart / timer) imperatively via refs, outside React.
- **Liquidity / execution:** [Drift Protocol v2](https://drift.trade) (`@drift-labs/sdk`) — real perps, **SOL as collateral**.
- **Price:** [Pyth](https://pyth.network) Hermes stream — the same oracle family Drift settles against, so the number you watch matches the on-chain fill within sub-second latency.
- **Wallet / auth:** [Privy](https://privy.io) — 𝕏 OAuth + a native Solana embedded wallet (Ed25519). Privy signs; no key ever leaves it.
- **Persistence:** [Supabase](https://supabase.com) — players + settled calls + a leaderboard view (server-side writes, RLS public-read).
- **Hosting:** Vercel.

## How it works

- Tap ↑/↓ on the live **BTC** or **SOL** price (segmented selector up top). 30-second round; you win or lose based on the real price move × your leverage.
- **Your money is in SOL** — balance, stakes (◎0.01 / 0.05 / 0.1) and PnL are all SOL; the *asset price* you bet on stays in USD.
- In **live** mode a tap deposits your SOL as Drift collateral, opens a real perp, and auto-closes after 30s (or on cash-out). Leverage clamps to Drift's real on-chain cap (~20x for BTC — the UI never offers more). PnL settles in USDC per Drift.

## Modes & the go-live gate

Trading is gated behind two explicit env flags so you can wire and dry-run the whole path before real money moves:

- **`paper`** (default) — real Pyth prices, local settlement, **nothing on-chain**.
- **`live`** — real Drift orders, but only when **both** `NEXT_PUBLIC_STRIKE_MODE=live` **and** `NEXT_PUBLIC_STRIKE_LIVE_BROADCAST=true`.

Live trading involves **real funds and liquidation risk**. Test at the smallest stake first.

## Run locally

```bash
npm install --legacy-peer-deps      # the Solana dep graph needs legacy peer resolution
cp .env.example .env.local          # fill in the values below
npm run dev                         # http://localhost:3000
```

Zero-config still runs: with no Privy app id it uses a prototype handle-login, and `paper` mode needs nothing on-chain.

> **A dedicated Solana RPC is required for live trading.** The public `api.mainnet-beta.solana.com` returns `403 Access forbidden` for the account/transaction calls Drift makes. Use a free [Helius](https://helius.dev) / [Triton](https://triton.one) / QuickNode endpoint and set it as `NEXT_PUBLIC_SOLANA_RPC`.

## Environment

All in `.env.local` (git-ignored, never committed). See `.env.example` for the full list.

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SOLANA_RPC` | Solana RPC for the Drift SDK — **use a dedicated endpoint for live** |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy app (𝕏 login + Solana embedded wallet) |
| `NEXT_PUBLIC_STRIKE_MODE` | `paper` \| `live` |
| `NEXT_PUBLIC_STRIKE_LIVE_BROADCAST` | `true` sends real transactions (both gates required for live) |
| `NEXT_PUBLIC_MARKET` | starting market, e.g. `BTC/USD` |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase (persistence, optional) |
| `SUPABASE_SECRET_KEY` | server-only Supabase write key |

## Security

- **No secrets in the repo or its history** — Privy app secret, Supabase service key, and any RPC keys live only in `.env.local` (git-ignored) and the Vercel environment.
- Supabase writes go through server routes with the service key; the client only ever holds public keys, and RLS is public-read / server-write.
- The Privy embedded wallet is non-custodial — STRIKE never holds funds or keys; every trade is signed by the user's own wallet.

## Layout

```
app/                 routes + read API (/api/drift/*, /api/strike/*)
components/          UI + auth/live-signer bridge (Privy → Drift)
lib/game/engine.ts   the imperative 60fps game engine
lib/feed/            Pyth price feed (+ fallback, staleness watchdog)
lib/drift/           Drift read layer (server) + live trade path (client, SOL collateral)
lib/supabase/        server-side persistence writer
```
