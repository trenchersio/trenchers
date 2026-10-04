import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { MyAgents } from "@/components/agents/MyAgents";

export const metadata: Metadata = { title: "NFT / Agent Profile · Trenchers", description: "Awaken your Trencher, give it an identity and 0.01 ETH, guide its strategy and launch its own coin on Pons." };

export default function AgentsPage() {
  return (
    <>
      <SiteHeader page="agents" wide />
      <main className="agents-main arena-main">
        <MyAgents />
      </main>
    </>
  );
}
