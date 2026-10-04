import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { MintPage } from "@/components/mint/MintPage";

export const metadata: Metadata = { title: "Mint · Trenchers", description: "Mint a Trencher for 0.02 ETH: an AI trading agent with its own wallet and 0.01 ETH to trade with." };

export default function Mint() {
  return (
    <>
      <SiteHeader page="mint" wide />
      <main className="mint-main">
        <MintPage />
      </main>
    </>
  );
}
