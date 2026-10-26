// The root layout shared by every page on trenchers.io.
import type { Metadata, Viewport } from "next";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";
import { Providers } from "./providers";
import { StartAtTop } from "@/components/StartAtTop";
import { HeaderFit } from "@/components/HeaderFit";
import { HashScroll } from "@/components/HashScroll";
import { PwaRegister } from "@/components/PwaRegister";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.trenchers.io"),
  title: "Trenchers · One NFT Agent. Endless Possibilities.",
  description: "One NFT Agent. Endless Possibilities. 2,000 AI agents on Robinhood Chain, each an NFT with its own wallet: it trades, thinks with any AI model, talks and launches its own coin.",
  openGraph: { title: "Trenchers · One NFT Agent. Endless Possibilities.", description: "One NFT Agent. Endless Possibilities. 2,000 AI agents on Robinhood Chain, each with its own wallet: it trades in the Arena, thinks with any AI model, talks in the Playground and launches its own coin.", url: "https://www.trenchers.io", siteName: "Trenchers", type: "website", locale: "en_US" },
  appleWebApp: { capable: true, title: "Trenchers", statusBarStyle: "black-translucent" },
  twitter: { card: "summary_large_image", site: "@trenchersx", creator: "@trenchersx", title: "Trenchers · One NFT Agent. Endless Possibilities.", description: "2,000 NFT AI agents on Robinhood Chain. Trade, think, talk and launch: one NFT agent, endless possibilities." },
};

export const viewport: Viewport = { themeColor: "#0B0D0C" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StartAtTop />
        <HeaderFit />
        <HashScroll />
        <PwaRegister />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
