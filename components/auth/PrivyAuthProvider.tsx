"use client";

import { useEffect, useMemo } from "react";
import { usePrivy, useLogin, useWallets } from "@privy-io/react-auth";
import { useStrike } from "@/lib/store";
import { avatarUrl } from "@/lib/social";
import { recordPlayer, recordReferral } from "@/lib/persist";
import { getRef } from "@/lib/ref";
import { AuthContext, type AuthValue } from "./AuthContext";

// Real 𝕏 OAuth via Privy. The login returns the user's Twitter profile (handle, name, pfp)
// directly — no separate X/Twitter API needed — and spins up an EVM embedded wallet.
export function PrivyAuthProvider({ children }: { children: React.ReactNode }) {
  const { authenticated, user, logout } = usePrivy();
  const { login } = useLogin();
  const { wallets } = useWallets();
  const setUser = useStrike((s) => s.setUser);

  const tw = user?.twitter;
  const handle = authenticated && tw?.username ? tw.username : null;
  const name = tw?.name ?? handle;
  const avatar = tw?.profilePictureUrl ?? (handle ? avatarUrl(handle) : null);

  // The Twitter login spins up a Privy EVM embedded wallet; its 0x address is the account we
  // trade GMX perps with on Avalanche. No key handling — Privy signs on demand.
  const embedded = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const address = authenticated && embedded?.address ? embedded.address : null;

  // keep store.user in sync so chart pins + avatars resolve to the logged-in handle
  useEffect(() => {
    setUser(handle);
  }, [handle, setUser]);

  // poll the user's real native AVAX balance + the live AVAX/USD price (values AVAX stakes for
  // the on-chain min-size check + the USD hint)
  const setAvaxBalance = useStrike((s) => s.setAvaxBalance);
  const setAvaxPrice = useStrike((s) => s.setAvaxPrice);
  const setRefreshBalance = useStrike((s) => s.setRefreshBalance);
  useEffect(() => {
    if (!address) {
      setAvaxBalance(null);
      setRefreshBalance(null);
      return;
    }
    let alive = true;
    const fetchBal = async () => {
      try {
        const [rb, rp] = await Promise.all([
          fetch(`/api/gmx/balance?address=${address}`),
          fetch(`/api/gmx/price?symbol=AVAX/USD`),
        ]);
        if (rb.ok && alive) {
          const d = await rb.json();
          // on an RPC error the route returns null — keep the last known value rather than
          // flashing 0 (which would read as an empty wallet and reject taps).
          if (typeof d.avax === "number") setAvaxBalance(d.avax);
        }
        if (rp.ok && alive) {
          const p = await rp.json();
          if (typeof p.price === "number") setAvaxPrice(p.price);
        }
      } catch {
        /* network — keep last known values */
      }
    };
    fetchBal();
    setRefreshBalance(() => fetchBal());
    const h = setInterval(fetchBal, 20_000);
    return () => {
      alive = false;
      clearInterval(h);
      setRefreshBalance(null);
    };
  }, [address, setAvaxBalance, setAvaxPrice, setRefreshBalance]);

  // register the connected user's 𝕏 identity keyed by their wallet address, so their own trades
  // in the feed/rails (which arrive by on-chain address) render with their real name + avatar.
  const setIdentity = useStrike((s) => s.setIdentity);
  useEffect(() => {
    if (address && handle) {
      setIdentity(address, { name: name || handle, avatar });
      recordPlayer({ wallet: address, handle, avatar });
      // attribute this signup to whoever referred them (if they arrived via a ?ref link and it
      // isn't their own handle) — server enforces first-touch + no self-referral
      const ref = getRef();
      if (ref && ref.toLowerCase() !== handle.toLowerCase()) {
        recordReferral({ wallet: address, handle, referrer: ref });
      }
    }
  }, [address, handle, name, avatar, setIdentity]);

  // track the connected wallet address so the engine can dedupe the user's own trades out of
  // the community feed (they show via the local "you" item / "Your Past Trades" instead).
  const setMyAddress = useStrike((s) => s.setMyAddress);
  useEffect(() => {
    setMyAddress(address);
  }, [address, setMyAddress]);

  const value = useMemo<AuthValue>(
    () => ({
      connected: !!handle,
      handle,
      name,
      avatar,
      link: handle ? `https://x.com/${handle}` : null,
      address,
      login: () => login(),
      logout: () => logout(),
      usingPrivy: true,
    }),
    [handle, name, avatar, address, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
