"use client";

import { useCallback, useEffect } from "react";
import { useWallets } from "@privy-io/react-auth";
import { CHAIN_ID } from "@/lib/gmx/networks";
import type { Eip1193Provider } from "@/lib/gmx/gmxTrade";

// Bridges the Privy EVM embedded wallet to the plain EIP-1193 provider the GMX layer signs with.
// Privy embedded EOAs are chain-agnostic secp256k1 keys; we pin the wallet to Avalanche (43114)
// once on wire-up so every eth_sendTransaction lands on the right chain. Auto-sign (no modal per
// tap) comes from embeddedWallets.showWalletUIs=false in Providers + the dashboard setting.
export function usePrivyEvmSigner() {
  const { wallets } = useWallets();

  const privyWallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0] ?? null;
  const address = privyWallet?.address ?? null;

  // keep the embedded wallet on Avalanche — harmless if already there
  useEffect(() => {
    if (!privyWallet) return;
    privyWallet.switchChain(CHAIN_ID).catch(() => {
      /* wallet not ready yet — the getProvider path retries the switch on demand */
    });
  }, [privyWallet]);

  const getProvider = useCallback(async (): Promise<Eip1193Provider | null> => {
    if (!privyWallet) return null;
    try {
      await privyWallet.switchChain(CHAIN_ID);
      return (await privyWallet.getEthereumProvider()) as Eip1193Provider;
    } catch {
      return null;
    }
  }, [privyWallet]);

  return { getProvider, ready: !!address, address };
}
