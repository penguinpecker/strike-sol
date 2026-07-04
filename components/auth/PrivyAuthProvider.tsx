"use client";

import { useEffect, useMemo } from "react";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import { useStrike } from "@/lib/store";
import { avatarUrl } from "@/lib/social";
import { recordPlayer } from "@/lib/persist";
import { config } from "@/lib/config";
import { AuthContext, type AuthValue } from "./AuthContext";

// Real 𝕏 OAuth via Privy. The login returns the user's Twitter profile (handle, name, pfp)
// directly — no separate X/Twitter API needed — and spins up a Solana embedded wallet.
export function PrivyAuthProvider({ children }: { children: React.ReactNode }) {
  const { authenticated, user, logout } = usePrivy();
  const { login } = useLogin();
  const { wallets } = useWallets();
  const setUser = useStrike((s) => s.setUser);

  const tw = user?.twitter;
  const handle = authenticated && tw?.username ? tw.username : null;
  const name = tw?.name ?? handle;
  const avatar = tw?.profilePictureUrl ?? (handle ? avatarUrl(handle) : null);

  // The Twitter login spins up a Privy Solana embedded wallet; its base58 address is the account
  // we trade Drift perps with. No key handling — Privy signs on demand.
  const embedded = wallets.find((w) => w.standardWallet?.name === "Privy") ?? wallets[0];
  const solAddress = authenticated && embedded?.address ? embedded.address : null;

  // keep store.user in sync so chart pins + avatars resolve to the logged-in handle
  useEffect(() => {
    setUser(handle);
  }, [handle, setUser]);

  // poll the user's real USDC (collateral) + native SOL (gas) balances + the live SOL/USD price
  const setUsdcBalance = useStrike((s) => s.setUsdcBalance);
  const setSolBalance = useStrike((s) => s.setSolBalance);
  const setSolPrice = useStrike((s) => s.setSolPrice);
  const setRefreshBalance = useStrike((s) => s.setRefreshBalance);
  useEffect(() => {
    if (!solAddress) {
      setUsdcBalance(null);
      setSolBalance(null);
      setRefreshBalance(null);
      return;
    }
    let alive = true;
    const fetchBal = async () => {
      try {
        const [rb, rp] = await Promise.all([
          fetch(`/api/drift/balance?address=${solAddress}&network=${config.network}`),
          fetch(`/api/drift/price?symbol=SOL/USD`),
        ]);
        if (rb.ok && alive) {
          const d = await rb.json();
          // on an RPC error the route returns null — keep the last known value rather than
          // flashing $0 (which would read as an empty wallet and reject taps).
          if (typeof d.usdc === "number") setUsdcBalance(d.usdc);
          if (typeof d.sol === "number") setSolBalance(d.sol);
        }
        if (rp.ok && alive) {
          const p = await rp.json();
          if (typeof p.price === "number") setSolPrice(p.price);
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
  }, [solAddress, setUsdcBalance, setSolBalance, setSolPrice, setRefreshBalance]);

  // register the connected user's 𝕏 identity keyed by their wallet address, so their own trades
  // in the feed/rails (which arrive by on-chain address) render with their real name + avatar.
  const setIdentity = useStrike((s) => s.setIdentity);
  useEffect(() => {
    if (solAddress && handle) {
      setIdentity(solAddress, { name: name || handle, avatar });
      recordPlayer({ wallet: solAddress, handle, avatar });
    }
  }, [solAddress, handle, name, avatar, setIdentity]);

  // track the connected wallet address so the engine can dedupe the user's own trades out of
  // the community feed (they show via the local "you" item / "Your Past Trades" instead).
  const setMyAddress = useStrike((s) => s.setMyAddress);
  useEffect(() => {
    setMyAddress(solAddress);
  }, [solAddress, setMyAddress]);

  const value = useMemo<AuthValue>(
    () => ({
      connected: !!handle,
      handle,
      name,
      avatar,
      link: handle ? `https://x.com/${handle}` : null,
      solAddress,
      login: () => login(),
      logout: () => logout(),
      usingPrivy: true,
    }),
    [handle, name, avatar, solAddress, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
