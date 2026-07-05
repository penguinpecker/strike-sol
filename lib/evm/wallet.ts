// EVM address helpers. Privy's embedded wallet is a plain secp256k1 EOA whose 0x address works on
// every EVM chain — Avalanche needs no derivation or bridging. Display-only utilities.

/** Loose EVM address check (0x + 40 hex chars). */
export function isEvmAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr.trim());
}

/** Short display form, e.g. 0x33…829e. */
export function shortAddress(addr: string, head = 4, tail = 4): string {
  if (!addr) return "";
  return addr.length <= head + tail + 1 ? addr : `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}
