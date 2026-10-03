import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { MyAgents } from "@/components/agents/MyAgents";

export const metadata: Metadata = { title: "NFT / Agent Profile · Trenchers", description: "Register your Trencher as an agent, fund it, set its strategy and launch its own token on Pons." };

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
