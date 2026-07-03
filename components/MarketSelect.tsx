"use client";

import { useStrike } from "@/lib/store";
import { useEngine } from "./engineContext";

// Markets exposed for trading in the UI. Both resolve to a live Drift perp (BTC-PERP / SOL-PERP)
// and their own Pyth feed; switching is blocked mid-call by the engine.
const TRADABLE = ["BTC/USD", "SOL/USD"];

export function MarketSelect() {
  const market = useStrike((s) => s.market);
  const inCall = useStrike((s) => !!s.call);
  const { setMarket } = useEngine();
  if (inCall) return null;

  return (
    <div className="mkt" data-overlay>
      {TRADABLE.map((m) => (
        <button key={m} className={m === market ? "on" : undefined} onClick={() => setMarket(m)}>
          {m.split("/")[0]}
        </button>
      ))}
    </div>
  );
}
