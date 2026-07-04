"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { config } from "@/lib/config";
import { MockAuthProvider } from "./auth/MockAuthProvider";
import { PrivyAuthProvider } from "./auth/PrivyAuthProvider";

// Activates real 𝕏 OAuth (Privy) when NEXT_PUBLIC_PRIVY_APP_ID is set; otherwise the app runs the
// prototype handle-entry flow so it always works without credentials. On login Privy creates a
// Solana embedded wallet (base58, Ed25519) — the account we trade Drift perps with.
export function Providers({ children }: { children: React.ReactNode }) {
  if (config.privyAppId) {
    // Privy needs Solana RPCs wired to initialize the embedded Solana wallet (create/sign). Without
    // this block the wallet fails to sync after 𝕏 login. Derive the ws endpoint from the http RPC.
    const rpc = config.solanaRpc;
    const ws = rpc.replace(/^http/i, "ws");
    const clusterKey = config.network === "devnet" ? "solana:devnet" : "solana:mainnet";
    return (
      <PrivyProvider
        appId={config.privyAppId}
        config={{
          loginMethods: ["twitter"],
          appearance: { theme: "dark", accentColor: "#AB9FF2", walletChainType: "solana-only" },
          embeddedWallets: {
            // auto-sign (no confirmation modal per tap) — tap-to-trade UX. Requires the app's
            // "enforce wallet UIs" to be OFF in the Privy dashboard for it to take full effect.
            showWalletUIs: false,
            solana: { createOnLogin: "users-without-wallets" },
          },
          solana: {
            rpcs: {
              [clusterKey]: {
                rpc: createSolanaRpc(rpc),
                rpcSubscriptions: createSolanaRpcSubscriptions(ws),
              },
            },
          },
          externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
        }}
      >
        <PrivyAuthProvider>{children}</PrivyAuthProvider>
      </PrivyProvider>
    );
  }
  return <MockAuthProvider>{children}</MockAuthProvider>;
}
