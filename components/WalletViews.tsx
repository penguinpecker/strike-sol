"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useStrike } from "@/lib/store";
import { useAuth } from "./auth/AuthContext";
import { avax as fmtAvax } from "@/lib/format";
import { shortAddress, isEvmAddress } from "@/lib/evm/wallet";
import { XLogo } from "./icons";

// Wallet / deposit / withdraw — the game runs on the user's native AVAX, straight from the wallet.
// GMX has no venue margin account: collateral rides inside each position and returns on close, so
//   deposit  = send AVAX to your address (receive)
//   withdraw = send AVAX from your wallet to any address
// Everything is signed by the user's own wallet; STRIKE never takes custody.
export function WalletViews({ view }: { view: "wallet" | "deposit" | "withdraw" }) {
  const auth = useAuth();
  const avaxBal = useStrike((s) => s.avaxBalance);
  const openSheet = useStrike((s) => s.openSheet);
  const closeSheet = useStrike((s) => s.closeSheet);
  const showToast = useStrike((s) => s.showToast);
  const refreshBalance = useStrike((s) => s.refreshBalance);
  const withdrawFn = useStrike((s) => s.withdrawFn);
  const [amt, setAmt] = useState("");
  const [dest, setDest] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  const addr = auth.address;

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
  const balNum = avaxBal ?? 0;

  const nudge = () => {
    setTimeout(() => refreshBalance?.(), 2500);
    setTimeout(() => refreshBalance?.(), 8000);
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
          {card("Wallet AVAX · your balance", avaxBal == null ? "…" : fmtAvax(avaxBal), "#E84142")}
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
          your funds stay in your wallet — STRIKE never holds them. A live call locks its stake inside the GMX position and it returns the moment the position closes.
        </div>
      </>
    );
  }

  if (view === "deposit") {
    return (
      <>
        <div className="sub" style={{ marginBottom: 10 }}>
          send AVAX to your address below — it lands in seconds and you&apos;re ready to play.
        </div>
        <div style={{ borderRadius: 16, padding: "14px", background: "rgba(232,65,66,.07)", border: "1.5px solid rgba(232,65,66,.28)", marginBottom: 10 }}>
          <div style={{ fontSize: 10, letterSpacing: ".12em", color: "var(--wt4)", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>
            your Avalanche deposit address
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
            send <b>AVAX</b> on <b>Avalanche C-Chain</b> here from any exchange or wallet. Native AVAX only — a wrong token or network may be lost.
          </div>
        </div>
        {card("in your wallet", avaxBal == null ? "…" : fmtAvax(avaxBal), "#8A8F98")}
        <div className="sub" style={{ marginTop: 10 }}>
          that&apos;s it — no second step. Your wallet balance is your tradable balance; each call briefly fronts a ~0.01 AVAX execution deposit that refunds on fill.
        </div>
      </>
    );
  }

  // withdraw — send AVAX from the embedded wallet to any Avalanche address
  const amtNum = Number(amt) || 0;
  // leave headroom for gas + the refundable execution deposit of a live call
  const maxOut = Math.max(0, balNum - 0.02);
  const valid = amtNum > 0 && amtNum <= balNum && isEvmAddress(dest);
  return (
    <>
      <div className="sub" style={{ marginBottom: 8 }}>
        send <b>AVAX</b> from your game wallet to any <b>Avalanche C-Chain</b> address.
      </div>
      {card("in your wallet", avaxBal == null ? "…" : fmtAvax(avaxBal), "#E84142")}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          className="xin"
          inputMode="decimal"
          placeholder="amount (AVAX)"
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          style={{ flex: 1 }}
        />
        <button className="xin" style={{ width: 64, cursor: "pointer", color: "var(--acc)" }} onClick={() => setAmt(maxOut.toFixed(4))}>
          MAX
        </button>
      </div>
      <div style={{ marginTop: 8 }}>
        <input
          className="xin"
          placeholder="destination address (0x…)"
          value={dest}
          onChange={(e) => setDest(e.target.value.trim())}
          onKeyDown={(e) => e.stopPropagation()}
          style={{ width: "100%" }}
        />
      </div>
      <button
        className="xgo"
        disabled={!valid || busy}
        style={{ opacity: valid && !busy ? 1 : 0.5, marginTop: 10 }}
        onClick={async () => {
          if (!withdrawFn) return showToast("withdraw goes live once your wallet is connected");
          setBusy(true);
          try {
            const r = await withdrawFn(amtNum, dest);
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
        signed by your Privy wallet — one Avalanche transaction, ~1s finality, gas under a cent. Double-check the address.
      </div>
    </>
  );
}
