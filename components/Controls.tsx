"use client";

import { useEffect } from "react";
import { useStrike } from "@/lib/store";
import { LEVS, STAKES, FULL_SEND } from "@/lib/constants";
import { quoteCost } from "@/lib/drift/rail";
import { fmt, fmt2, sol } from "@/lib/format";
import { config, baseAsset } from "@/lib/config";
import { blip, haptic } from "@/lib/audio";

function WinHint() {
  const stake = useStrike((s) => s.stake);
  const lev = useStrike((s) => s.levSel);
  const cfg = useStrike((s) => s.pairConfig);
  const solUsd = useStrike((s) => s.solPrice) || 0;
  const price = useStrike((s) => s.displayPrice) || 63000;

  const skull = lev >= FULL_SEND ? <> · bust = lose it all <i className="ph-fill ph-skull" /></> : null;

  if (cfg) {
    const q = quoteCost({ stake, leverage: lev, side: "long" }, cfg, config.platformFeeRate);
    // min position is a USD notional; the stake is SOL, so value it first.
    const notionalUsd = stake * solUsd * lev;
    if (config.mode === "live" && solUsd > 0 && notionalUsd < cfg.minPositionValue) {
      const minLev = Math.min(cfg.maxLeverage, Math.ceil(cfg.minPositionValue / (stake * solUsd || 1)));
      return (
        <>
          {sol(stake)} (~${fmt2(stake * solUsd)}) at {lev}x = ${fmt(notionalUsd)} — below ${cfg.minPositionValue} min · need <b>{minLev}x+</b>
        </>
      );
    }
    const beUsd = q.breakevenMoveUsd(price);
    return (
      <>
        {sol(stake)} at <b>{lev}x</b> — fees {sol(q.roundTripCost, 4)} · clear <b>${fmt(beUsd)}</b> to win{skull}
      </>
    );
  }
  return (
    <>
      {sol(stake)} at <b>{lev}x</b> — a typical 30s ride swings <b>±{sol(stake * lev * 0.005, 4)}</b>
      {skull}
    </>
  );
}

export function Controls() {
  const live = useStrike((s) => !!s.call);
  const stake = useStrike((s) => s.stake);
  const bal = useStrike((s) => s.solBalance);
  const levSel = useStrike((s) => s.levSel);
  const setStake = useStrike((s) => s.setStake);
  const setLev = useStrike((s) => s.setLev);
  const d = live ? "none" : undefined;

  // keep the selected stake within the real SOL balance — fall to the largest affordable preset.
  useEffect(() => {
    if (bal == null || stake <= bal) return;
    const fit = STAKES.filter((v) => v <= bal);
    setStake(fit.length ? Math.max(...fit) : STAKES[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bal]);

  // avoid an unused-import lint on baseAsset while keeping it available for market-aware copy
  void baseAsset;

  return (
    <>
      <div className="stakes" id="levs" style={{ paddingTop: "1.2vh", display: live ? "none" : "flex" }}>
        {LEVS.map(([l, c]) => (
          <div
            key={l}
            className={`sk lv${l === levSel ? " sel" : ""}`}
            style={{ ["--lc" as string]: c }}
            onClick={() => {
              setLev(l);
              haptic();
              blip(300 + l * 2, 0.08);
            }}
          >
            {l}x
          </div>
        ))}
      </div>

      <div className="stakes" id="stakes" style={{ display: d }}>
        {STAKES.map((s) => {
          const tooBig = bal != null && s > bal;
          return (
            <div
              key={s}
              className={`sk${s === stake ? " sel" : ""}${tooBig ? " dim" : ""}`}
              title={tooBig ? `needs ${sol(s)} · you have ${sol(bal ?? 0)}` : undefined}
              onClick={() => {
                setStake(s);
                haptic();
              }}
            >
              {sol(s)}
            </div>
          );
        })}
      </div>

      <div className="winhint" id="winhint" style={{ display: live ? "none" : "block" }}>
        <WinHint />
      </div>
    </>
  );
}
