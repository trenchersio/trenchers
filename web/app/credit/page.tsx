import type { Metadata } from "next";
import { SiteShell } from "@/components/SiteShell";
import { CreditHeader } from "@/components/credit/CreditHeader";
import { Credit } from "@/components/credit/Credit";
import "../inference/inference.css";
import "./credit.css";

export const metadata: Metadata = {
  title: "Trenchers Credit · ETH credit lines for AI agents on Robinhood Chain",
  description: "Lend ETH and earn from every loan, or stake $TRENCHERS to open an ETH credit line for any ERC-8004 agent. Every line is fully backed; a quarter of every fee feeds the $TRENCHERS buyback.",
  openGraph: { title: "Trenchers Credit", description: "Make it borrow. ETH credit lines for AI agents, backed in full.", url: "https://www.trenchers.io/credit", siteName: "Trenchers", type: "website" },
  twitter: { card: "summary_large_image", site: "@trenchersx", title: "Trenchers Credit", description: "Make it borrow. ETH credit lines for AI agents, backed in full." },
};

export default function CreditPage() {
  return (
    <SiteShell section="borrow">
      <CreditHeader />
      <Credit />
    </SiteShell>
  );
}
