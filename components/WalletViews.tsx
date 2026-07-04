"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useStrike } from "@/lib/store";
import { useAuth } from "./auth/AuthContext";
import { fmt2, sol as fmtSol } from "@/lib/format";
import { shortAddress } from "@/lib/solana/wallet";
import { XLogo } from "./icons";

// Wallet / deposit / withdraw — the game runs on the user's native SOL.
//   Wallet SOL     = spendable SOL in the wallet (what you play + deposit with)
//   Drift margin   = SOL posted to Drift as collateral (backs live calls), shown as its USD value
//   deposit  = wallet SOL  → Drift collateral
//   withdraw = Drift collat → wallet SOL
// Everything is signed by the user's own wallet; STRIKE never takes custody.
export function WalletViews({ view }: { view: "wallet" | "deposit" | "withdraw" }) {
  const auth = useAuth();
  const solBal = useStrike((s) => s.solBalance);
  const collateral = useStrike((s) => s.driftCollateral); // USD value of Drift margin
  const openSheet = useStrike((s) => s.openSheet);
  const closeSheet = useStrike((s) => s.closeSheet);
  const showToast = useStrike((s) => s.showToast);
  const refreshBalance = useStrike((s) => s.refreshBalance);
  const refreshCollateral = useStrike((s) => s.refreshCollateral);
  const withdrawFn = useStrike((s) => s.withdrawFn);
  const depositFn = useStrike((s) => s.depositFn);
  const [amt, setAmt] = useState("");
  const [depAmt, setDepAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  const addr = auth.solAddress;

  useEffect(() => {
    refreshCollateral?.();
  }, [view, refreshCollateral]);

  useEffect(() => {
    if (view !== "deposit" || !addr) {
      setQr(null);
      return;
    }
    let on = true;
    QRCode.toDataURL(addr, { margin: 1, width: 320, color: { dark: "#12101F", light: "#FFFFFF" } })
      .then((url) => on && setQr(url))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [view, addr]);

  if (!auth.connected || !addr) {
    return (
      <>
        <div className="sub" style={{ marginBottom: 10 }}>connect 𝕏 to open your wallet</div>
        <button className="xgo" onClick={() => { closeSheet(); auth.login(); }}>
          <XLogo size={15} /> CONNECT 𝕏
        </button>
      </>
    );
  }
  const solNum = solBal ?? 0;

  const nudge = () => {
    setTimeout(() => { refreshBalance?.(); refreshCollateral?.(); }, 2500);
    setTimeout(() => { refreshBalance?.(); refreshCollateral?.(); }, 8000);
  };

  const card = (label: string, display: string, accent: string) => (
    <div style={{ flex: 1, borderRadius: 16, padding: "14px 14px", background: `${accent}12`, border: `1.5px solid ${accent}39` }}>
      <div style={{ fontSize: 10, letterSpacing: ".12em", color: "var(--wt4)", fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
      <div className="baloo" style={{ fontSize: 28, fontWeight: 800, marginTop: 3 }}>{display}</div>
    </div>
  );

  if (view === "wallet") {
    return (
      <>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          {card("Wallet SOL · your balance", solBal == null ? "…" : fmtSol(solBal), "#AB9FF2")}
          {card("Drift margin · tradable", collateral == null ? "—" : `$${fmt2(collateral)}`, "#8A8F98")}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="xgo" style={{ flex: 1 }} onClick={() => openSheet("deposit")}>
            DEPOSIT
          </button>
          <button
            className="xgo"
            style={{ flex: 1, background: "rgba(255,255,255,.1)", color: "#fff", border: "1.5px solid rgba(255,255,255,.2)" }}
            onClick={() => openSheet("withdraw")}
          >
            WITHDRAW
          </button>
        </div>
        <div className="mono" style={{ fontSize: 11, color: "var(--wt4)", marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={() => navigator.clipboard?.writeText(addr).then(() => showToast("address copied"))}
            style={{ background: "none", border: "none", color: "var(--wt7)", cursor: "pointer", padding: 0, font: "inherit" }}
            title="tap to copy"
          >
            {shortAddress(addr, 6, 6)} <i className="ph ph-copy" />
          </button>
        </div>
        <div className="sub" style={{ marginTop: 10 }}>
          your funds stay in your wallet — STRIKE never holds them. Deposit posts SOL as Drift collateral to back a live call; it unlocks the moment the position closes.
        </div>
      </>
    );
  }

  if (view === "deposit") {
    const depNum = Number(depAmt) || 0;
    const depValid = depNum > 0 && depNum <= solNum;
    return (
      <>
        <div className="sub" style={{ marginBottom: 10 }}>
          <b>1.</b> send SOL to your address below to fund your wallet · <b>2.</b> deposit it into Drift to back your calls.
        </div>
        <div style={{ borderRadius: 16, padding: "14px", background: "rgba(171,159,242,.07)", border: "1.5px solid rgba(171,159,242,.28)", marginBottom: 10 }}>
          <div style={{ fontSize: 10, letterSpacing: ".12em", color: "var(--wt4)", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>
            your Solana deposit address
          </div>
          {qr && (
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="deposit address QR" width={148} height={148} style={{ borderRadius: 12, background: "#fff", padding: 7 }} />
            </div>
          )}
          <button
            type="button"
            className="mono"
            onClick={() => navigator.clipboard?.writeText(addr).then(() => showToast("address copied")).catch(() => showToast("copy failed"))}
            title="tap to copy"
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, padding: "10px 11px", color: "#fff", fontSize: 12, cursor: "pointer", textAlign: "left" }}
          >
            <span style={{ wordBreak: "break-all", lineHeight: 1.35 }}>{addr}</span>
            <i className="ph ph-copy" style={{ color: "var(--acc)", flexShrink: 0, fontSize: 16 }} />
          </button>
          <div className="sub" style={{ marginTop: 8 }}>
            send <b>SOL</b> on <b>Solana</b> here from any exchange or wallet. Native SOL only — a wrong token or network may be lost.
          </div>
        </div>
        {card("in your wallet", solBal == null ? "…" : fmtSol(solBal), "#8A8F98")}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input
            className="xin"
            inputMode="decimal"
            placeholder="amount (SOL)"
            value={depAmt}
            onChange={(e) => setDepAmt(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            style={{ flex: 1 }}
          />
          <button className="xin" style={{ width: 64, cursor: "pointer", color: "var(--acc)" }} onClick={() => setDepAmt(String(Math.max(0, solNum - 0.03)))}>
            MAX
          </button>
        </div>
        <button
          className="xgo"
          disabled={!depValid || busy}
          style={{ opacity: depValid && !busy ? 1 : 0.5 }}
          onClick={async () => {
            if (!depositFn) return showToast("deposit goes live once your wallet is connected");
            setBusy(true);
            try {
              const r = await depositFn(depNum);
              showToast(r.txhash && !r.txhash.startsWith("(") ? `deposited · ${r.txhash.slice(0, 10)}…` : "signed (broadcast off)");
              setDepAmt("");
              nudge();
            } catch (e) {
              showToast(e instanceof Error ? e.message : "deposit failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "DEPOSITING…" : "DEPOSIT TO DRIFT"}
        </button>
        <div className="sub" style={{ marginTop: 10 }}>
          signed by your Privy wallet — one Solana transaction. Keep ~0.03 SOL for account rent + gas.
        </div>
      </>
    );
  }

  // withdraw — pull SOL out of Drift collateral back to your own wallet
  const amtNum = Number(amt) || 0;
  const valid = amtNum > 0;
  return (
    <>
      <div className="sub" style={{ marginBottom: 8 }}>
        withdraw <b>SOL</b> from Drift collateral back to your Solana wallet.
      </div>
      {card("Drift margin · available", collateral == null ? "—" : `$${fmt2(collateral)}`, "#AB9FF2")}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          className="xin"
          inputMode="decimal"
          placeholder="amount (SOL)"
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          style={{ flex: 1 }}
        />
      </div>
      <button
        className="xgo"
        disabled={!valid || busy}
        style={{ opacity: valid && !busy ? 1 : 0.5 }}
        onClick={async () => {
          if (!withdrawFn) return showToast("withdraw goes live once the wallet is funded");
          setBusy(true);
          try {
            const r = await withdrawFn(amtNum, addr);
            showToast(r.txhash && !r.txhash.startsWith("(") ? `sent · ${r.txhash.slice(0, 10)}…` : "signed (broadcast off)");
            setAmt("");
            nudge();
          } catch (e) {
            showToast(e instanceof Error ? e.message : "withdraw failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "SIGNING…" : "WITHDRAW"}
      </button>
      <div className="sub" style={{ marginTop: 10 }}>
        signed by your Privy wallet — SOL lands back in your own Solana wallet, no custody.
      </div>
    </>
  );
}
