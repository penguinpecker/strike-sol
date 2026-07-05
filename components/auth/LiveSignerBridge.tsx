"use client";

import { useEffect } from "react";
import { useStrike } from "@/lib/store";
import { useAuth } from "./AuthContext";
import { useEngine } from "../engineContext";
import { usePrivyEvmSigner } from "./usePrivyEvmSigner";
import { makeGmxSigner, withdrawVia } from "@/lib/gmx/gmxSigner";

// Renders nothing. While a Privy EVM wallet is connected, it injects a live GMX signer into the
// engine (so live-mode taps open/close real perps on Avalanche) and registers the withdraw handler
// the wallet sheet calls. The signer is rebuilt whenever the connected address changes, so an
// account switch can never trade with a previous user's wallet.
export function LiveSignerBridge() {
  const { getProvider, ready, address } = usePrivyEvmSigner();
  const { address: authAddress } = useAuth();
  const { setSigner } = useEngine();
  const setWithdrawFn = useStrike((s) => s.setWithdrawFn);

  useEffect(() => {
    const account = (authAddress || address) as `0x${string}` | null;
    if (!ready || !account) {
      setSigner(null);
      setWithdrawFn(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const provider = await getProvider();
      if (cancelled) return;
      if (!provider) {
        setSigner(null);
        setWithdrawFn(null);
        return;
      }
      const ctx = { account, provider };
      setSigner(makeGmxSigner(ctx));
      setWithdrawFn(async (amount, dest) => withdrawVia(ctx, amount, dest));
    })();

    return () => {
      cancelled = true;
      setSigner(null);
      setWithdrawFn(null);
    };
  }, [ready, address, authAddress, getProvider, setSigner, setWithdrawFn]);

  return null;
}
