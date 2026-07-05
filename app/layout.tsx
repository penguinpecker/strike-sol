import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "STRIKE — call it",
  description:
    "Tap-to-trade BTC perps. Call ↑ or ↓ on the live price, ride 60 seconds, cash out. On-chain on Avalanche via GMX.",
  openGraph: {
    title: "STRIKE — call it",
    description: "Where's BTC in 60 seconds? Tap ↑/↓, ride the chart, flex the call.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0C0A16",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=JetBrains+Mono:wght@500;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://api.fontshare.com/v2/css?f[]=satoshi@500,700,900&display=swap"
          rel="stylesheet"
        />
        {/* Phosphor icon webfont (used via <i class="ph ph-*"> and <i class="ph-fill ph-*">) */}
        <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css" />
        <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/fill/style.css" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
