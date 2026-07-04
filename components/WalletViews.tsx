"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useStrike } from "@/lib/store";
import { useAuth } from "./auth/AuthContext";
import { fmt2 } from "@/lib/format";
import { shortAddress } from "@/lib/solana/wallet";
import { XLogo } from "./icons";

// Wallet / deposit / withdraw — the user's real USDC (non-custodial; their Privy Solana wallet).
//   Wallet USDC      = spendable USDC sitting in the wallet (what you deposit FROM)
//   Drift collateral = USDC posted to Drift, the margin your calls actually trade against
//   deposit  = wallet USDC  → Drift collateral
//   withdraw = Drift collat → wallet USDC
// Everything is signed by the user's own wallet; STRIKE never takes custody.
export function WalletViews({ view }: { view: "wallet" | "deposit" | "withdraw" }) {
  const auth = useAuth();
  const bal = useStrike((s) => s.usdcBalance);
  const sol = useStrike((s) => s.solBalance);
  const collateral = useStrike((s) => s.driftCollateral);
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

  // load the live Drift collateral whenever the wallet/deposit/withdraw sheet opens
  useEffect(() => {
    refreshCollateral?.();
  }, [view, refreshCollateral]);

  // build a QR of the wallet address for the deposit view (generated locally, no external call)
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
        <button
          className="xgo"
          onClick={() => {
            // close the sheet first so the Privy login modal opens on a clean screen, never behind it
            closeSheet();
            auth.login();
          }}
        >
          <XLogo size={15} /> CONNECT 𝕏
        </button>
      </>
    );
  }
  const walletNum = bal ?? 0;
  const collatNum = collateral ?? 0;

  const nudge = () => {
    setTimeout(() => { refreshBalance?.(); refreshCollateral?.(); }, 2500);
    setTimeout(() => { refreshBalance?.(); refreshCollateral?.(); }, 8000);
  };

  const balCard = (label: string, value: number | null, accent: string) => (
    <div
      style={{
        flex: 1,
        borderRadius: 16,
        padding: "14px 14px",
        background: `${accent}12`,
        border: `1.5px solid ${accent}39`,
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: ".12em", color: "var(--wt4)", fontWeight: 700, textTransform: "uppercase" }}>
        {label}
      </div>
      <div className="baloo" style={{ fontSize: 28, fontWeight: 800, marginTop: 3 }}>
        {value == null ? "…" : `$${fmt2(value)}`}
      </div>
    </div>
  );

  if (view === "wallet") {
    return (
      <>
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          {balCard("Drift collateral · tradable", collateral, "#AB9FF2")}
          {balCard("Wallet USDC · idle", bal, "#8A8F98")}
        </div>
        <div
          className="mono"
          style={{ fontSize: 11, fontWeight: 700, textAlign: "center", marginBottom: 12, color: sol != null && sol < 0.003 ? "#FFB23E" : "var(--wt4)" }}
        >
          ◎ {sol == null ? "…" : sol.toFixed(3)} SOL for gas{sol != null && sol < 0.003 ? " · add a little for fees" : ""}
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
          your funds stay in your wallet — STRIKE never holds them. Only Drift collateral backs a live call; it unlocks the moment the position closes.
        </div>
      </>
    );
  }

  if (view === "deposit") {
    const depNum = Number(depAmt) || 0;
    const depValid = depNum > 0 && depNum <= walletNum;
    return (
      <>
        <div className="sub" style={{ marginBottom: 10 }}>
          <b>1.</b> send USDC to your address below to fund your wallet · <b>2.</b> deposit it into Drift to back your calls.
        </div>
        {/* deposit address — send USDC here to fund the wallet */}
        <div
          style={{
            borderRadius: 16,
            padding: "14px",
            background: "rgba(171,159,242,.07)",
            border: "1.5px solid rgba(171,159,242,.28)",
            marginBottom: 10,
          }}
        >
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
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              background: "rgba(255,255,255,.05)",
              border: "1px solid rgba(255,255,255,.12)",
              borderRadius: 10,
              padding: "10px 11px",
              color: "#fff",
              fontSize: 12,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ wordBreak: "break-all", lineHeight: 1.35 }}>{addr}</span>
            <i className="ph ph-copy" style={{ color: "var(--acc)", flexShrink: 0, fontSize: 16 }} />
          </button>
          <div className="sub" style={{ marginTop: 8 }}>
            send <b>USDC</b> (to trade) and a little <b>SOL</b> (for gas) on <b>Solana</b> here, from any exchange or wallet. Native SOL and USDC only — a different token or a wrong network may be lost.
          </div>
        </div>
        {balCard("in your wallet", bal, "#8A8F98")}
        <div
          className="mono"
          style={{ fontSize: 11, fontWeight: 700, textAlign: "center", marginTop: 8, color: sol != null && sol < 0.003 ? "#FFB23E" : "var(--wt4)" }}
        >
          ◎ {sol == null ? "…" : sol.toFixed(3)} SOL for gas
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input
            className="xin"
            inputMode="decimal"
            placeholder="amount (USDC)"
            value={depAmt}
            onChange={(e) => setDepAmt(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            style={{ flex: 1 }}
          />
          <button className="xin" style={{ width: 64, cursor: "pointer", color: "var(--accent, #00ff85)" }} onClick={() => setDepAmt(String(walletNum))}>
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
          signed by your Privy wallet — one Solana transaction. Needs a little SOL for gas.
        </div>
        <a
          className="xgo"
          href="https://jup.ag/swap/SOL-USDC"
          target="_blank"
          rel="noopener"
          style={{ textDecoration: "none", display: "block", textAlign: "center", marginTop: 8, background: "rgba(255,255,255,.08)", color: "#fff", border: "1px solid rgba(255,255,255,.16)" }}
        >
          NO USDC? GET SOME ON JUPITER ↗
        </a>
      </>
    );
  }

  // withdraw — pull USDC out of Drift collateral back to your own wallet
  const amtNum = Number(amt) || 0;
  const valid = amtNum > 0 && amtNum <= collatNum;
  return (
    <>
      <div className="sub" style={{ marginBottom: 8 }}>
        withdraw <b>USDC</b> from Drift collateral back to your Solana wallet.
      </div>
      {balCard("Drift collateral · available", collateral, "#AB9FF2")}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          className="xin"
          inputMode="decimal"
          placeholder="amount (USDC)"
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          style={{ flex: 1 }}
        />
        <button className="xin" style={{ width: 64, cursor: "pointer", color: "var(--accent, #00ff85)" }} onClick={() => setAmt(String(collatNum))}>
          MAX
        </button>
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
        signed by your Privy wallet — funds land in your own Solana wallet, no custody.
      </div>
    </>
  );
}
