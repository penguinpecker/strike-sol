import type { Config } from "tailwindcss";

// Tailwind is available for new UI work; the core game screen keeps its bespoke,
// hand-tuned CSS in globals.css (preserving the exact look + 60fps feel).
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0C0A16",
        ink2: "#171326",
        win: "#00E676",
        lose: "#FF3B4E",
        ng: "#00FF85",
        nr: "#FF3B4E",
        acc: "#AB9FF2",
        acc2: "#C77DFF",
      },
      fontFamily: {
        baloo: ["var(--font-baloo)", "cursive"],
        mono: ["var(--font-mono)", "monospace"],
        sans: ["Satoshi", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
