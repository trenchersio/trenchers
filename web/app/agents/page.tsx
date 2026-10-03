import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { MyAgents } from "@/components/agents/MyAgents";

export const metadata: Metadata = { title: "Your agents · Trenchers", description: "Register, fund and launch your Trenchers agents." };

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
