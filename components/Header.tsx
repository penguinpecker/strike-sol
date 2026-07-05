"use client";

import { useStrike } from "@/lib/store";
import { avax } from "@/lib/format";
import { BrandMark, XLogo } from "./icons";
import { useAuth } from "./auth/AuthContext";

export function Header() {
  const avaxBalance = useStrike((s) => s.avaxBalance);
  const openSheet = useStrike((s) => s.openSheet);
  const { connected, handle, avatar, login } = useAuth();

  return (
    <header>
      <div className="brand">
        <BrandMark />
        <b>STRIKE</b>
        <span>BTC PERP · AVALANCHE</span>
      </div>
      <div style={{ display: "flex", alignItems: "center" }}>
        <button id="xbtn" onClick={login}>
          {connected ? (
            <>
              {avatar && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt="" />
              )}{" "}
              @{handle}
            </>
          ) : (
            <>
              <XLogo /> Connect
            </>
          )}
        </button>
        <div
          className="bal"
          onClick={() => openSheet("wallet")}
          style={{ cursor: "pointer" }}
          title={connected ? "wallet · deposit / withdraw" : "connect to deposit"}
        >
          <span className="l">wallet ›</span>
          <span className="v" key={String(avaxBalance)} id="bal">
            {connected ? (avaxBalance == null ? "…" : avax(avaxBalance)) : "—"}
          </span>
        </div>
      </div>
    </header>
  );
}
