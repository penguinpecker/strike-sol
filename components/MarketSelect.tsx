"use client";

import { useStrike } from "@/lib/store";
import { useEngine } from "./engineContext";

// Markets exposed for trading in the UI. Both resolve to a live GMX v2 market on Avalanche
// and their own GMX oracle feed; switching is blocked mid-call by the engine.
const TRADABLE = ["BTC/USD", "AVAX/USD"];

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
