"use client";

import { useEffect, useState } from "react";
import { useStrike, dirLabel } from "@/lib/store";
import { fmt2, avax } from "@/lib/format";
import { config } from "@/lib/config";
import { Avatar } from "./Avatar";
import { useEngine } from "./engineContext";
import { useAuth } from "./auth/AuthContext";
import type { RecentTrade } from "@/lib/gmx/types";

// Compact "time ago" for the rail (2m, 3h, 1d).
const ago = (ts: number) => {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

// Floating glass rails over the chart (desktop ≥1100px; hidden on mobile via CSS).
//   LEFT  = ⚡ live calls (JOIN) + 🕘 ALL TRADES (the full community / GMX-wide feed).
//   RIGHT = 👤 YOUR PAST TRADES (the connected wallet's own settled history) + your summary.
export function NotiRails() {
  const notis = useStrike((s) => s.notis);
  const feed = useStrike((s) => s.feed);
  const avaxBalance = useStrike((s) => s.avaxBalance);
  const hits = useStrike((s) => s.hits);
  const total = useStrike((s) => s.total);
  const streak = useStrike((s) => s.streak);
  const identities = useStrike((s) => s.identities);
  const { makeCall } = useEngine();
  const auth = useAuth();

  const idName = (a: string | undefined, fb: string) => (a && identities[a.toLowerCase()]?.name) || fb;
  const past = feed.filter((f) => f.done); // ALL TRADES — community / GMX-wide
  // JOIN only opens the market STRIKE trades (BTC/USD); other-market rows stay view-only.
  const joinable = (sym?: string) => !sym || sym === config.market;

  // YOUR PAST TRADES — the connected wallet's own real on-chain settled history.
  const [mine, setMine] = useState<RecentTrade[]>([]);
  useEffect(() => {
    const addr = auth.address;
    if (!addr) {
      setMine([]);
      return;
    }
    let on = true;
    const load = () =>
      fetch(`/api/gmx/my-trades?address=${addr}`)
        .then((r) => r.json())
        .then((d) => on && Array.isArray(d) && setMine(d as RecentTrade[]))
        .catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [auth.address]);
  const myPast = mine.filter((t) => !t.isOpen);

  const pnlMeta = { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 } as const;

  return (
    <>
      <div id="notisL" className="notis">
        <div className="nhead">
          <i className="ph-fill ph-lightning" /> live calls
        </div>
        {notis.map((f) => (
          <div className="np" key={f.id}>
            <div className="fx">
              <div className="nm">{idName(f.account, f.nm)}</div>
              <div className="ds">
                {f.done ? (f.pnl >= 0 ? "called it ✓" : "fumbled ✗") : `called ${dirLabel(f.dir)}`}
                {f.lev ? ` · ${f.lev}×` : ""}
                {f.sym ? ` · ${f.sym}` : ""}
                {f.done ? "" : " · live"}
              </div>
            </div>
            {f.done ? (
              <span className="pn" style={{ color: f.pnl >= 0 ? "#00FF85" : "#FF8A93" }}>
                {f.pnl >= 0 ? "+" : "−"}${fmt2(Math.abs(f.pnl))}
              </span>
            ) : joinable(f.sym) ? (
              <button className="join" onClick={() => makeCall(f.dir)}>
                JOIN {f.dir > 0 ? "↑" : "↓"}
              </button>
            ) : (
              <span className="pn" style={{ color: "var(--wt4)" }}>
                {f.dir > 0 ? "↑" : "↓"}
              </span>
            )}
          </div>
        ))}

        <div className="nhead" style={{ marginTop: 12 }}>
          <i className="ph-fill ph-globe-hemisphere-west" /> all trades
        </div>
        {past.length === 0 && (
          <div className="np">
            <div className="fx">
              <div className="ds">no settled trades yet…</div>
            </div>
          </div>
        )}
        {past.slice(0, 5).map((f) => (
          <div className="np" key={f.id}>
            <div className="fx">
              <div className="nm">{idName(f.account, f.nm)}</div>
              <div className="ds">
                {f.dir > 0 ? "↑ LONG" : "↓ SHORT"}
                {f.lev ? ` · ${f.lev}×` : ""}
                {f.sym ? ` · ${f.sym}` : ""}
              </div>
            </div>
            <div style={pnlMeta}>
              <span className="pn" style={{ color: f.pnl >= 0 ? "#00FF85" : "#FF8A93" }}>
                {f.pnl >= 0 ? "+" : "−"}${fmt2(Math.abs(f.pnl))}
              </span>
              <span className="ds">
                {f.pnl >= 0 ? "won ✓" : "lost ✗"}
                {f.ts ? ` · ${ago(f.ts)}` : ""}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div id="notisR" className="notis">
        <div className="nhead">
          <i className="ph-fill ph-clock-counter-clockwise" /> your past trades
        </div>
        {!auth.connected && (
          <div className="np">
            <div className="fx">
              <div className="ds">connect 𝕏 to see your trades</div>
            </div>
          </div>
        )}
        {auth.connected && myPast.length === 0 && (
          <div className="np">
            <div className="fx">
              <div className="ds">no trades yet — make a call ↑/↓</div>
            </div>
          </div>
        )}
        {myPast.slice(0, 5).map((t, i) => (
          <div className="np" key={t.txhash ?? i}>
            <div className="fx">
              <div className="nm">
                {t.symbol} {t.isLong ? "↑" : "↓"}
              </div>
              <div className="ds">
                {t.isLong ? "LONG" : "SHORT"}
                {t.leverage ? ` · ${t.leverage}×` : ""} · {ago(t.ts)}
              </div>
            </div>
            <div style={pnlMeta}>
              <span className="pn" style={{ color: t.pnl >= 0 ? "#00FF85" : "#FF8A93" }}>
                {t.pnl >= 0 ? "+" : "−"}${fmt2(Math.abs(t.pnl))}
              </span>
              <span className="ds">{t.pnl >= 0 ? "called it ✓" : "fumbled ✗"}</span>
            </div>
          </div>
        ))}
        <div className="np" style={{ borderColor: "rgba(255,255,255,.3)" }}>
          <Avatar nm="you" col="#ffffff" />
          <div className="fx">
            <div className="nm">you</div>
            <div className="ds">
              {avaxBalance != null ? `${avax(avaxBalance)} · ` : ""}
              {hits}/{total} called
            </div>
          </div>
          <span className="pn" style={{ color: "#FFB23E" }}>
            <i className="ph-fill ph-fire" />
            {streak}
          </span>
        </div>
      </div>
    </>
  );
}
