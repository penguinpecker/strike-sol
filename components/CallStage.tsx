"use client";

import type { RefObject } from "react";
import { useStrike } from "@/lib/store";
import { FULL_SEND } from "@/lib/constants";

interface Props {
  priceRef: RefObject<HTMLDivElement | null>;
  pnlRef: RefObject<HTMLDivElement | null>;
  lsubRef: RefObject<HTMLDivElement | null>;
  tleftRef: RefObject<HTMLDivElement | null>;
  ringRef: RefObject<SVGCircleElement | null>;
}

// Both the idle "call" view and the live "trade" view are always mounted (so the engine's
// refs stay valid); visibility flips on store.call. The big price / pnl / timer text is
// written imperatively by the engine at 60fps via the refs.
export function CallStage({ priceRef, pnlRef, lsubRef, tleftRef, ringRef }: Props) {
  const call = useStrike((s) => s.call);
  const levSel = useStrike((s) => s.levSel);
  const base = useStrike((s) => s.market).split("/")[0];
  const live = !!call;

  return (
    <div className="stage">
      <div id="idleWrap" style={{ display: live ? "none" : "flex", flexDirection: "column", alignItems: "center" }}>
        <h1 className="q" id="q">
          {levSel >= FULL_SEND ? `FULL SEND — where's ${base} in 60 seconds?` : `Where's ${base} in 60 seconds?`}
        </h1>
        <div className="bignum mono" id="price" ref={priceRef}>
          <small>$</small>—
        </div>
        <div className="subnum" id="sub">
          live · tap an arrow to call it
        </div>
      </div>

      <div id="liveWrap" style={{ display: live ? "flex" : "none", flexDirection: "column", alignItems: "center" }}>
        <h1 className="q" id="lq">
          {call
            ? `You called ${call.dir > 0 ? "↑ HIGHER" : "↓ LOWER"}${call.lev >= FULL_SEND ? " · FULL SEND" : ` · ${call.lev}x`}`
            : ""}
        </h1>
        <div className="bignum" id="pnl" ref={pnlRef}>
          +$0
        </div>
        <div className="subnum mono" id="lsub" ref={lsubRef}>
          —
        </div>
        <div id="ring">
          <svg width="54" height="54">
            <circle cx="27" cy="27" r="23" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="5" />
            <circle
              ref={ringRef}
              cx="27"
              cy="27"
              r="23"
              fill="none"
              stroke="#fff"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray="144.5"
              strokeDashoffset="0"
            />
          </svg>
          <div className="tl" id="tleft" ref={tleftRef}>
            30
          </div>
        </div>
      </div>
    </div>
  );
}
