"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { useStrike } from "@/lib/store";
import { fmt, fmt2 } from "@/lib/format";
import { BrandMark } from "./icons";
import { useAuth } from "./auth/AuthContext";

export function ResolveOverlay() {
  const r = useStrike((s) => s.resolve);
  const clearResolve = useStrike((s) => s.clearResolve);
  const showToast = useStrike((s) => s.showToast);
  const base = useStrike((s) => s.market).split("/")[0];
  const { handle } = useAuth();

  useEffect(() => {
    if (!r) return;
    gsap.fromTo("#res .big", { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: "back.out(2)" });
    gsap.fromTo("#card", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, delay: 0.15, ease: "back.out(1.4)" });
    gsap.fromTo(".rbtns", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, delay: 0.25 });
  }, [r]);

  if (!r) return null;
  const { how, win, pnl, pct, entry, dir, lev, secs, streak } = r;

  const share = async () => {
    const txt = `I just ${win ? "CALLED" : "fumbled"} ${base} on STRIKE ${(pct >= 0 ? "+" : "") + pct}%${handle ? ` — x.com/${handle}` : ""}`;
    try {
      if (navigator.share) await navigator.share({ text: txt });
      else {
        await navigator.clipboard.writeText(txt);
        showToast("copied — go flex");
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <div id="res" data-overlay style={{ display: "flex" }}>
      <div className="big" id="rbig">
        {(pnl >= 0 ? "+" : "−") + "$" + fmt2(Math.abs(pnl))}
      </div>
      <div className="word" id="rword">
        {how === "bust" ? (
          <>
            REKT <i className="ph-fill ph-skull" />
          </>
        ) : win ? (
          "CALLED IT ✓"
        ) : (
          "FUMBLED ✗"
        )}
      </div>
      <div className="meta" id="rmeta">
        {dir > 0 ? "↑ higher" : "↓ lower"} from ${fmt(entry)} ·{" "}
        {how === "cash" ? "cashed early" : how === "bust" ? "liquidated" : "buzzer"} ·{" "}
        <i className="ph-fill ph-fire" style={{ color: "#FFB23E" }} /> streak {streak}
      </div>
      <div className="card" id="card">
        <div className="ch">
          <span style={{ display: "flex", alignItems: "center", gap: "7px" }}>
            <BrandMark size={18} />
            <b style={{ fontSize: "14px" }}>STRIKE</b>
          </span>
          <span id="cdate">today</span>
        </div>
        <div className="cp" id="cpnl" style={{ color: win ? "#CFFFE2" : "#FFD9D4" }}>
          {(pct >= 0 ? "+" : "") + pct}%
        </div>
        <div className="cm" id="cmeta">
          called {base} {dir > 0 ? "↑" : "↓"} at ${fmt(entry)} · {lev}x · {secs}s
        </div>
        <div className="ref">{handle ? `@${handle}` : "your call"} — come fumble with me</div>
      </div>
      <div className="rbtns">
        <button id="shareBtn" onClick={share}>
          SHARE <i className="ph-fill ph-share-fat" />
        </button>
        <button id="againBtn" onClick={clearResolve}>
          RUN IT BACK
        </button>
      </div>
    </div>
  );
}
