// Stake + leverage chips. Leverage colors run cool→hot (200x = FULL SEND).
export const STAKES = [5, 25, 100] as const;
export const LEVS: [lev: number, color: string][] = [
  [10, "#8A8F98"],
  [25, "#FFFFFF"],
  [50, "#AB9FF2"],
  [100, "#FF8A93"],
  [200, "#FF3B4E"],
];
