"use client";

import { useEffect, useRef, useState } from "react";
import { useStrike, dirLabel } from "@/lib/store";
import { addrColor } from "@/lib/social";
import { fmt2, avax } from "@/lib/format";
import { Avatar } from "./Avatar";
import { useEngine } from "./engineContext";
import { useAuth } from "./auth/AuthContext";
import { WalletViews } from "./WalletViews";
import { shortAddress } from "@/lib/evm/wallet";
import { config } from "@/lib/config";
import type { SheetType } from "@/lib/store";
import type { RecentTrade } from "@/lib/gmx/types";

const ago = (ts: number) => {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const HEAD: Record<Exclude<SheetType, null>, [string, string]> = {
  feed: ["Live calls", "real-time · tap JOIN to ride the same call"],
  ranks: ["🏆 Top traders", "live · ranked by realized pnl on-chain"],
  you: ["You", ""],
  x: ["Sign in with 𝕏", "your pfp becomes your pin on the chart — entries, exits, PnL%"],
  wallet: ["Wallet", "your AVAX on Avalanche · non-custodial"],
  deposit: ["Deposit", "fund your wallet with AVAX"],
  withdraw: ["Withdraw", "send AVAX anywhere"],
};

export function FeedSheet() {
  const sheet = useStrike((s) => s.sheet);
  const feed = useStrike((s) => s.feed);
  const hist = useStrike((s) => s.hist);
  const leaderboard = useStrike((s) => s.leaderboard);
  const hits = useStrike((s) => s.hits);
  const total = useStrike((s) => s.total);
  const streak = useStrike((s) => s.streak);
  const avaxBalance = useStrike((s) => s.avaxBalance);
  const closeSheet = useStrike((s) => s.closeSheet);
  const setUser = useStrike((s) => s.setUser);
  const showToast = useStrike((s) => s.showToast);
  const { makeCall } = useEngine();
  const auth = useAuth();
  const identities = useStrike((s) => s.identities);
  const idName = (account: string | undefined, fb: string) =>
    (account && identities[account.toLowerCase()]?.name) || fb;
  const idAva = (account: string | undefined) =>
    account ? identities[account.toLowerCase()]?.avatar ?? null : null;
  const [myTrades, setMyTrades] = useState<RecentTrade[]>([]);

  // a feed row is joinable only if it's on the market STRIKE actually trades (BTC/USD); other-market
  // rows are view-only, so JOIN can never silently open a BTC position for an AVAX call.
  const joinable = (sym?: string) => !sym || sym === config.market;

  // load the connected wallet's real on-chain trade history (realized PnL) for the "you" tab
  useEffect(() => {
    if (sheet !== "you" || !auth.address) return;
    let on = true;
    fetch(`/api/gmx/my-trades?address=${auth.address}`)
      .then((r) => r.json())
      .then((d) => {
        if (on && Array.isArray(d)) setMyTrades(d as RecentTrade[]);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [sheet, auth.address]);

  // keep the last view during the slide-down so content doesn't vanish mid-animation
  const [view, setView] = useState<Exclude<SheetType, null>>("feed");
  useEffect(() => {
    if (sheet) setView(sheet);
  }, [sheet]);

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (sheet === "x") setTimeout(() => inputRef.current?.focus(), 250);
  }, [sheet]);

  const connect = () => {
    const h = (inputRef.current?.value || "").replace(/^@/, "").trim();
    if (!h) return;
    setUser(h);
    try {
      localStorage.setItem("strike_x", h);
    } catch {
      /* private mode */
    }
    showToast("welcome @" + h);
    closeSheet();
  };

  const [title, sub] = HEAD[view];
  const subText =
    view === "you"
      ? `${hits}/${total} called · streak ${streak}${avaxBalance != null ? ` · ${avax(avaxBalance)}` : ""}`
      : sub;

  return (
    <div
      id="sheet"
      data-overlay
      className={sheet ? "on" : undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).id === "sheet") closeSheet();
      }}
    >
      <div className="sc">
        <button className="closex" onClick={closeSheet}>
          ×
        </button>
        <h3>{title}</h3>
        <div className="sub">{subText}</div>

        {view === "feed" && (
          <>
            {feed.length === 0 && <div style={{ fontSize: 12, color: "var(--wt4)", fontWeight: 700 }}>calls incoming…</div>}
            {feed.map((f) => (
              <div className="fi" key={f.id}>
                <Avatar nm={idName(f.account, f.nm)} col={f.col} src={idAva(f.account)} />
                <div className="fx">
                  <div className="nm">
                    {idName(f.account, f.nm)}
                    {f.you ? " (you)" : ""}
                  </div>
                  <div className="ds">
                    {f.done ? (f.pnl >= 0 ? "called it ✓" : "fumbled ✗") : `called ${dirLabel(f.dir)} · live`}
                    {f.sym ? ` · ${f.sym}` : ""}
                  </div>
                </div>
                {f.done ? (
                  <span className="pn" style={{ color: f.pnl >= 0 ? "#00FF85" : "#FF8A93" }}>
                    {f.pnl >= 0 ? "+" : "−"}${fmt2(Math.abs(f.pnl))}
                  </span>
                ) : f.you ? (
                  <span className="pn">…live</span>
                ) : joinable(f.sym) ? (
                  <button
                    className="join"
                    onClick={() => {
                      closeSheet();
                      makeCall(f.dir);
                    }}
                  >
                    JOIN {f.dir > 0 ? "↑" : "↓"}
                  </button>
                ) : (
                  <span className="pn" style={{ color: "var(--wt4)" }}>
                    {f.dir > 0 ? "↑" : "↓"} {f.sym}
                  </span>
                )}
              </div>
            ))}
          </>
        )}

        {view === "ranks" &&
          (leaderboard.length ? (
            leaderboard.map((e) => (
              <div className="fi" key={e.account}>
                <Avatar nm={idName(e.account, shortAddress(e.account))} col={addrColor(e.account)} src={idAva(e.account)} />
                <div className="fx">
                  <div className="nm">{idName(e.account, shortAddress(e.account))}</div>
                  <div className="ds">{e.count} trades</div>
                </div>
                <span className="pn" style={{ color: e.pnl >= 0 ? "#00FF85" : "#FF8A93" }}>
                  {e.pnl >= 0 ? "+" : "−"}${fmt2(Math.abs(e.pnl))}
                </span>
              </div>
            ))
          ) : (
            <div className="sub">loading on-chain traders…</div>
          ))}

        {view === "you" && auth.address && (
          <div className="fi" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <i className="ph-fill ph-wallet" style={{ color: "#00FF85" }} />
              <div className="nm">Avalanche wallet</div>
            </div>
            <button
              className="mono"
              style={{
                background: "none",
                border: "none",
                color: "var(--wt7)",
                fontSize: 11,
                textAlign: "left",
                cursor: "pointer",
                padding: 0,
              }}
              onClick={() => {
                navigator.clipboard?.writeText(auth.address!).then(() => showToast("address copied"));
              }}
              title="tap to copy"
            >
              {shortAddress(auth.address, 8, 8)} <i className="ph ph-copy" />
            </button>
          </div>
        )}

        {view === "you" &&
          (() => {
            // real on-chain closed trades (realized PnL) — authoritative + persistent
            const closed = myTrades.filter((t) => !t.isOpen);
            if (closed.length)
              return closed.slice(0, 15).map((t, i) => (
                <div className="fi" key={t.txhash ?? i}>
                  <Avatar nm="you" col="#ffffff" />
                  <div className="fx">
                    <div className="nm">
                      {t.symbol} {t.isLong ? "↑" : "↓"}
                    </div>
                    <div className="ds">
                      {t.pnl >= 0 ? "called it ✓" : "fumbled ✗"} · {ago(t.ts)}
                    </div>
                  </div>
                  <span className="pn" style={{ color: t.pnl >= 0 ? "#00FF85" : "#FF8A93" }}>
                    {t.pnl >= 0 ? "+" : "−"}${fmt2(Math.abs(t.pnl))}
                  </span>
                </div>
              ));
            // fallback: this session's calls (until the chain indexes the latest close)
            if (hist.length)
              return hist.slice(0, 10).map((h, i) => (
                <div className="fi" key={i}>
                  <Avatar nm="you" col="#ffffff" />
                  <div className="fx">
                    <div className="nm">{dirLabel(h.dir, true)}</div>
                    <div className="ds">{h.win ? "called it ✓" : "fumbled ✗"}</div>
                  </div>
                  <span className="pn" style={{ color: h.pnl >= 0 ? "#00FF85" : "#FF8A93" }}>
                    {h.pnl >= 0 ? "+" : "−"}${fmt2(Math.abs(h.pnl))}
                  </span>
                </div>
              ));
            return <div className="sub">no closed trades yet — go make one</div>;
          })()}

        {view === "x" && (
          <>
            <input
              ref={inputRef}
              className="xin"
              placeholder="@yourhandle"
              autoComplete="off"
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") connect();
              }}
            />
            <button className="xgo" onClick={connect}>
              CONNECT 𝕏
            </button>
            <div className="sub" style={{ marginTop: 10 }}>
              prototype: pulls your real pfp · production uses X OAuth
            </div>
          </>
        )}

        {(view === "wallet" || view === "deposit" || view === "withdraw") && <WalletViews view={view} />}
      </div>
    </div>
  );
}
