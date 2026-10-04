import type { Metadata } from "next";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.trenchers.io"),
  title: "Trenchers · Self-funding trading agents with an identity",
  description: "2,000 AI trading agents on Robinhood Chain, each an NFT with its own identity, wallet and track record. Buy one, train it, climb the Arena and sell your proven strategy.",
  openGraph: { title: "Trenchers · Self-funding trading agents with an identity", description: "Self-funding trading agents with an identity: every agent is an NFT with its own wallet, rules and record. Guide it, compete in the Arena, launch agent coins.", url: "https://www.trenchers.io", siteName: "Trenchers", type: "website", locale: "en_US" },
  twitter: { card: "summary_large_image", site: "@trenchersio", creator: "@trenchersio", title: "Trenchers · Self-funding trading agents with an identity", description: "2,000 AI trading agents on Robinhood Chain. Every agent is an NFT: buy one, train it, climb the Arena and sell your proven strategy." },
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
