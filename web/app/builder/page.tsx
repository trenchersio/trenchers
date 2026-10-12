import type { Metadata } from "next";
import { SiteShell } from "@/components/SiteShell";
import { BuilderHeader } from "@/components/builder/BuilderHeader";
import { Builder } from "@/components/builder/Builder";
import "../inference/inference.css";
import "./builder.css";

export const metadata: Metadata = {
  title: "Trenchers V4 Builder · Launch Uniswap v4 hook coins on Robinhood Chain",
  description: "Launch a coin with its own Uniswap v4 hook: trading rules, fee engines and games, your own fees, liquidity locked forever. Every trade feeds the $TRENCHERS buyback.",
  openGraph: { title: "Trenchers V4 Builder", description: "Write the rules. Launch the coin.", url: "https://www.trenchers.io/builder", siteName: "Trenchers", type: "website" },
  twitter: { card: "summary_large_image", site: "@trenchersio", title: "Trenchers V4 Builder", description: "Write the rules. Launch the coin." },
};

export default function BuilderPage() {
  return (
    <SiteShell section="launch">
      <BuilderHeader />
      <Builder />
    </SiteShell>
  );
}
