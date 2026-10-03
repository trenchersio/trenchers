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
  title: "Trenchers",
  description: "An on-chain AI trading agent ecosystem: 2,000 agents on Robinhood Chain.",
  openGraph: { title: "Trenchers", description: "An on-chain AI trading agent ecosystem.", url: "https://trenchers.io", siteName: "Trenchers" },
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
