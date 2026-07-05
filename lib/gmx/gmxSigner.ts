// makeGmxSigner — adapts the Privy EVM wallet into the rail `Signer` the engine drives.
//
// Every on-chain submission for one account runs through a per-account TxQueue (rail.TxQueue) so an
// in-flight open and the close that follows never race each other — GMX cancels a decrease that
// races its own increase (EmptyPosition), and a cancelled order still burns its keeper fee.
// Broadcast is gated by config.liveBroadcast (default false): the path validates end-to-end against
// live mainnet state but sends nothing until the gate is on.

"use client";

import { GmxRailError, TxQueue, type Signer } from "./rail";
import { config } from "@/lib/config";
import type { Eip1193Provider, LiveCtx } from "./gmxTrade";

export interface GmxSignerCtx {
  account: `0x${string}`;
  provider: Eip1193Provider;
  broadcast?: boolean;
}

// one serial queue per account address
const queues = new Map<string, TxQueue>();
function queueFor(account: string): TxQueue {
  let q = queues.get(account);
  if (!q) {
    q = new TxQueue();
    queues.set(account, q);
  }
  return q;
}

function liveCtx(ctx: GmxSignerCtx): LiveCtx {
  return {
    account: ctx.account,
    provider: ctx.provider,
    broadcast: ctx.broadcast ?? config.liveBroadcast,
  };
}

export function makeGmxSigner(ctx: GmxSignerCtx): Signer {
  const q = queueFor(ctx.account);
  const live = liveCtx(ctx);

  return {
    account: ctx.account,

    async openMarket(t) {
      // heavy path loads on first live action only
      const { openMarketLive } = await import("./gmxTrade");
      try {
        return await q.run(() =>
          openMarketLive(
            {
              symbol: t.symbol,
              stake: t.stake,
              leverage: t.leverage,
              side: t.side,
              slippage: t.slippage ?? 0.01,
            },
            live,
          ),
        );
      } catch (e) {
        if (e instanceof GmxRailError) throw e;
        throw new GmxRailError("CHAIN_REJECTED", e instanceof Error ? e.message : "open failed");
      }
    },

    async closeMarket(p) {
      const { closeMarketLive } = await import("./gmxTrade");
      try {
        return await q.run(() => closeMarketLive(p.symbol, p.isLong, live, p.slippage ?? 0.01));
      } catch (e) {
        if (e instanceof GmxRailError) throw e;
        throw new GmxRailError("CHAIN_REJECTED", e instanceof Error ? e.message : "close failed");
      }
    },
  };
}

/** Withdraw native AVAX from the embedded wallet to any address. */
export async function withdrawVia(
  ctx: GmxSignerCtx,
  amount: number,
  dest: string,
): Promise<{ txhash?: string }> {
  const { transferNative } = await import("./gmxTrade");
  return queueFor(ctx.account).run(() => transferNative(liveCtx(ctx), amount, dest as `0x${string}`));
}
