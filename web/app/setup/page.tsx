import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { TestnetSetup } from "@/components/testnet/TestnetSetup";

export const metadata: Metadata = {
  title: "Testnet setup · Trenchers",
  description: "Deploy and try Trenchers on Robinhood Chain testnet.",
  robots: { index: false, follow: false },
};

export default function SetupPage() {
  return (
    <>
      <SiteHeader page="agents" wide />
      <main className="agents-main arena-main">
        <TestnetSetup />
      </main>
    </>
  );
}
