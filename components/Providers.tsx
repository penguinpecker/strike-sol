"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { avalanche } from "viem/chains";
import { config } from "@/lib/config";
import { MockAuthProvider } from "./auth/MockAuthProvider";
import { PrivyAuthProvider } from "./auth/PrivyAuthProvider";

// Activates real 𝕏 OAuth (Privy) when NEXT_PUBLIC_PRIVY_APP_ID is set; otherwise the app runs the
// prototype handle-entry flow so it always works without credentials. On login Privy creates an
// EVM embedded wallet (secp256k1) — the account we trade GMX perps with on Avalanche.
export function Providers({ children }: { children: React.ReactNode }) {
  if (config.privyAppId) {
    return (
      <PrivyProvider
        appId={config.privyAppId}
        config={{
          loginMethods: ["twitter"],
          appearance: { theme: "dark", accentColor: "#E84142", walletChainType: "ethereum-only" },
          // pin the embedded wallet to Avalanche C-Chain — every tx the game signs lands on 43114
          defaultChain: avalanche,
          supportedChains: [avalanche],
          embeddedWallets: {
            // auto-sign (no confirmation modal per tap) — tap-to-trade UX. Requires the app's
            // "enforce wallet UIs" to be OFF in the Privy dashboard for it to take full effect.
            showWalletUIs: false,
            ethereum: { createOnLogin: "users-without-wallets" },
          },
        }}
      >
        <PrivyAuthProvider>{children}</PrivyAuthProvider>
      </PrivyProvider>
    );
  }
  return <MockAuthProvider>{children}</MockAuthProvider>;
}
