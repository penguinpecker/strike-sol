"use client";

import { useEffect } from "react";
import { useStrike } from "@/lib/store";
import { LEVS, STAKES, FULL_SEND } from "@/lib/constants";
import { quoteCost } from "@/lib/gmx/rail";
import { marketDef, TOKENS } from "@/lib/gmx/networks";
import { fmt, fmt2, avax } from "@/lib/format";
import { config, baseAsset } from "@/lib/config";
import { blip, haptic } from "@/lib/audio";

function WinHint() {
  const stake = useStrike((s) => s.stake);
  const lev = useStrike((s) => s.levSel);
  const cfg = useStrike((s) => s.pairConfig);
  const avaxUsd = useStrike((s) => s.avaxPrice) || 0;
  const price = useStrike((s) => s.displayPrice) || 63000;

  const skull = lev >= FULL_SEND ? <> · bust = lose it all <i className="ph-fill ph-skull" /></> : null;

  if (cfg) {
    const swapLeg = marketDef(cfg.symbol).collateralToken !== TOKENS.wavax;
    const q = quoteCost({ stake, leverage: lev, side: "long" }, cfg, config.platformFeeRate, swapLeg);
    // min position is a USD notional; the stake is AVAX, so value it first.
    const notionalUsd = stake * avaxUsd * lev;
    if (config.mode === "live" && avaxUsd > 0 && notionalUsd < cfg.minPositionValue) {
      const minLev = Math.min(cfg.maxLeverage, Math.ceil(cfg.minPositionValue / (stake * avaxUsd || 1)));
      return (
        <>
          {avax(stake)} (~${fmt2(stake * avaxUsd)}) at {lev}x = ${fmt(notionalUsd)} — below ${cfg.minPositionValue} min · need <b>{minLev}x+</b>
        </>
      );
    }
    const beUsd = q.breakevenMoveUsd(price);
    return (
      <>
        {avax(stake)} at <b>{lev}x</b> — fees {avax(q.roundTripCost, 4)} · clear <b>${fmt(beUsd)}</b> to win{skull}
      </>
    );
  }
  return (
    <>
      {avax(stake)} at <b>{lev}x</b> — a typical 60s ride swings <b>±{avax(stake * lev * 0.007, 4)}</b>
      {skull}
    </>
  );
}

export function Controls() {
  const live = useStrike((s) => !!s.call);
  const stake = useStrike((s) => s.stake);
  const bal = useStrike((s) => s.avaxBalance);
  const levSel = useStrike((s) => s.levSel);
  const setStake = useStrike((s) => s.setStake);
  const setLev = useStrike((s) => s.setLev);
  const d = live ? "none" : undefined;

  // keep the selected stake within the real AVAX balance — fall to the largest affordable preset.
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
              title={tooBig ? `needs ${avax(s)} · you have ${avax(bal ?? 0)}` : undefined}
              onClick={() => {
                setStake(s);
                haptic();
              }}
            >
              {avax(s)}
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
