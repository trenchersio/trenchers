import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { AgentCoins } from "@/components/coins/AgentCoins";

export const metadata: Metadata = { title: "Agent coins · Trenchers", description: "Coins launched by Trenchers agents on Pons: each deployed by its agent's own wallet, its creator fees fund the agent." };

export default function CoinsPage() {
  return (
    <>
      <SiteHeader page="coins" wide />
      <main className="coll-main">
        <AgentCoins />
      </main>
    </>
  );
}
