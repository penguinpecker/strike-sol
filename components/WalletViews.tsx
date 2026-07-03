"use client";

import { useEffect, useState } from "react";
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
  const collateral = useStrike((s) => s.driftCollateral);
  const openSheet = useStrike((s) => s.openSheet);
  const showToast = useStrike((s) => s.showToast);
  const refreshBalance = useStrike((s) => s.refreshBalance);
  const refreshCollateral = useStrike((s) => s.refreshCollateral);
  const withdrawFn = useStrike((s) => s.withdrawFn);
  const depositFn = useStrike((s) => s.depositFn);
  const [amt, setAmt] = useState("");
  const [depAmt, setDepAmt] = useState("");
  const [busy, setBusy] = useState(false);

  const addr = auth.solAddress;

  // load the live Drift collateral whenever the wallet/deposit/withdraw sheet opens
  useEffect(() => {
    refreshCollateral?.();
  }, [view, refreshCollateral]);

  if (!auth.connected || !addr) {
    return (
      <>
        <div className="sub" style={{ marginBottom: 10 }}>connect 𝕏 to open your wallet</div>
        <button className="xgo" onClick={auth.login}>
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
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          {balCard("Drift collateral · tradable", collateral, "#AB9FF2")}
          {balCard("Wallet USDC · idle", bal, "#8A8F98")}
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
        <div className="sub" style={{ marginBottom: 8 }}>
          move USDC from your wallet into <b>Drift</b> collateral so it can back your calls.
        </div>
        {balCard("in your wallet", bal, "#8A8F98")}
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
