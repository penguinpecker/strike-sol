// Stake + leverage chips. Stakes are in AVAX (the wallet's native balance) — at ~$7/AVAX these are
// roughly $1.75 / $3.50 / $7 of margin, all above GMX's $1 on-chain floor. Leverage tops out well
// inside GMX's real caps (100x BTC / ~60x AVAX) — 20x = FULL SEND. Colors run cool→hot.
export const STAKES = [0.25, 0.5, 1] as const;
export const LEVS: [lev: number, color: string][] = [
  [2, "#8A8F98"],
  [5, "#FFFFFF"],
  [10, "#AB9FF2"],
  [20, "#FF3B4E"],
];
// leverage at/above this reads as "FULL SEND"
export const FULL_SEND = 20;
