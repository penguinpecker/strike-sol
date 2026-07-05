"use client";

import type { RefObject } from "react";
import { useStrike } from "@/lib/store";
import { useEngine } from "./engineContext";

export function CashOut({ cashBtnRef }: { cashBtnRef: RefObject<HTMLButtonElement | null> }) {
  const live = useStrike((s) => !!s.call);
  const showToast = useStrike((s) => s.showToast);
  const { cashOut } = useEngine();

  return (
    <>
      <div id="cash" style={{ display: live ? "block" : "none" }}>
        <button id="cashBtn" ref={cashBtnRef} onClick={cashOut}>
          CASH OUT · 0.50 AVAX
        </button>
        <button className="esc" id="rideBtn" onClick={() => showToast("riding to the buzzer 🚀")}>
          …or ride it to the buzzer
        </button>
      </div>
      <div className="kbd">press ↑ / ↓ to call it · SPACE to cash out</div>
    </>
  );
}
