"use client";

import { useCallback } from "react";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { AnchorLikeWallet } from "@/lib/drift/driftTrade";

// Bridges the Privy Solana embedded wallet to an Anchor-compatible signer the Drift SDK accepts.
//
// Drift (via @solana/web3.js) hands `wallet.signTransaction` a (Versioned)Transaction OBJECT, but
// Privy's Solana `signTransaction` takes SERIALIZED BYTES (Uint8Array) and returns signed bytes.
// Passing the object straight through is what caused `TypeError: t.slice is not a function` inside
// Privy's decoder. So we serialize → sign → deserialize back to the same tx type.
export function usePrivySolanaSigner() {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const privyWallet =
    wallets.find((w) => w.standardWallet?.name === "Privy") ?? wallets[0] ?? null;
  const address = privyWallet?.address ?? null;

  const getWallet = useCallback((): AnchorLikeWallet | null => {
    if (!privyWallet?.address) return null;
    const publicKey = new PublicKey(privyWallet.address);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sign = async (tx: any) => {
      const legacy = Array.isArray(tx?.instructions) && typeof tx?.serializeMessage === "function";
      const serialized: Uint8Array = legacy
        ? tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        : tx.serialize();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out: any = await signTransaction({
        transaction: new Uint8Array(serialized),
        wallet: privyWallet,
        // request no confirmation modal (tap-to-trade); honored once the app's Privy dashboard
        // "enforce wallet UIs" is off (or embeddedWallets.showWalletUIs=false in Providers).
        options: { uiOptions: { showWalletUIs: false } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const signed: Uint8Array = out?.signedTransaction ?? out?.signature ?? out;
      return legacy ? Transaction.from(signed) : VersionedTransaction.deserialize(signed);
    };

    return {
      publicKey,
      signTransaction: sign,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      signAllTransactions: async (txs: any[]) => {
        const out = [];
        for (const t of txs) out.push(await sign(t));
        return out;
      },
    };
  }, [privyWallet, signTransaction]);

  return { getWallet, ready: !!address, address };
}
