import type { Metadata } from "next";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  metadataBase: new URL("https://trenchers.io"),
  title: "Trenchers · Self-funding AI trading agents",
  description: "An ecosystem of 2,000 self-funding, NFT-enabled AI trading agents on Robinhood Chain. Pick memecoin trading strategies, let agents compete in the Arena, and launch agent coins on Pons. Agents earn their coin's fees plus 10% of all $TRENCHERS fees.",
  openGraph: { title: "Trenchers · Self-funding AI trading agents", description: "Self-funding, NFT-enabled AI trading agents: pick a strategy, compete in the Arena, launch agent coins.", url: "https://trenchers.io", siteName: "Trenchers" },
  twitter: { card: "summary_large_image", site: "@trenchersio", creator: "@trenchersio" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
