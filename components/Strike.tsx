"use client";

import { useEffect, useMemo, useRef } from "react";
import { GameEngine, type EngineRefs } from "@/lib/game/engine";
import { config } from "@/lib/config";
import { marketDef } from "@/lib/gmx/networks";
import { useStrike } from "@/lib/store";
import { EngineContext, type EngineActions } from "./engineContext";
import type { Dir } from "@/lib/types";
import { Header } from "./Header";
import { NotiRails } from "./NotiRails";
import { CallStage } from "./CallStage";
import { MarketSelect } from "./MarketSelect";
import { Arrows } from "./Arrows";
import { Controls } from "./Controls";
import { CashOut } from "./CashOut";
import { Nav } from "./Nav";
import { ResolveOverlay } from "./ResolveOverlay";
import { KolCard } from "./KolCard";
import { Toast } from "./Toast";
import { FeedSheet } from "./FeedSheet";
import { FeedChip } from "./FeedChip";
import { LiveSignerBridge } from "./auth/LiveSignerBridge";

// Root client component. React owns structure + discrete state (the store); the imperative
// GameEngine owns the 60fps hot path (canvas, price/pnl text, eased background) via refs.
export default function Strike() {
  const appRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const priceRef = useRef<HTMLDivElement>(null);
  const pnlRef = useRef<HTMLDivElement>(null);
  const lsubRef = useRef<HTMLDivElement>(null);
  const cashBtnRef = useRef<HTMLButtonElement>(null);
  const tleftRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const resolving = useStrike((s) => !!s.resolve);

  useEffect(() => {
    // capture a referral slug from the share link (?ref=<x username>) on first landing
    void import("@/lib/ref").then((m) => m.captureRef());
    // restore the prototype handle only when Privy isn't the auth backend
    if (!config.privyAppId) {
      try {
        const sv = localStorage.getItem("strike_x");
        if (sv) useStrike.getState().setUser(sv);
      } catch {
        /* private mode */
      }
    }
    const refs: EngineRefs = {
      app: appRef,
      chart: chartRef,
      price: priceRef,
      pnl: pnlRef,
      lsub: lsubRef,
      cashBtn: cashBtnRef,
      tleft: tleftRef,
      ring: ringRef,
    };
    const def = marketDef(config.market);
    const engine = new GameEngine(refs, {
      mode: config.mode,
      market: config.market,
      roundMs: config.roundMs,
      primary: config.priceFeed,
      base: def.base,
      indexTokenDecimals: def.indexTokenDecimals,
      binanceSymbol: def.binanceSymbol,
      coinbaseProduct: def.coinbaseProduct,
      onStatus: (s, src) => useStrike.getState().setFeedStatus(s, src),
    });
    engineRef.current = engine;
    engine.init();
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  const actions = useMemo<EngineActions>(
    () => ({
      makeCall: (d: Dir) => engineRef.current?.makeCall(d),
      cashOut: () => engineRef.current?.cashOut(),
      setSigner: (s) => engineRef.current?.setSigner(s),
      setMarket: (m: string) => {
        engineRef.current?.setMarket(m);
        useStrike.getState().setMarket(m);
      },
    }),
    [],
  );

  return (
    <EngineContext.Provider value={actions}>
      <div id="app" ref={appRef}>
        <canvas id="chart" ref={chartRef} />
        <Header />
        <NotiRails />
        <div className={resolving ? "layout hide" : "layout"}>
          <section className="colmid">
            <MarketSelect />
            <CallStage priceRef={priceRef} pnlRef={pnlRef} lsubRef={lsubRef} tleftRef={tleftRef} ringRef={ringRef} />
            <Arrows />
            <Controls />
            <CashOut cashBtnRef={cashBtnRef} />
          </section>
        </div>
        <Nav />
        <ResolveOverlay />
        <KolCard />
        <Toast />
        <FeedSheet />
        <FeedChip />
        {config.privyAppId ? <LiveSignerBridge /> : null}
      </div>
    </EngineContext.Provider>
  );
}
