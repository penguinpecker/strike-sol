// Stake + leverage chips. Stakes are in SOL (the wallet's native balance). Leverage tops out at
// Drift's real on-chain cap (~20x for BTC-PERP) — 20x = FULL SEND. Colors run cool→hot.
export const STAKES = [0.01, 0.05, 0.1] as const;
export const LEVS: [lev: number, color: string][] = [
  [2, "#8A8F98"],
  [5, "#FFFFFF"],
  [10, "#AB9FF2"],
  [20, "#FF3B4E"],
];
// leverage at/above this reads as "FULL SEND"
export const FULL_SEND = 20;
