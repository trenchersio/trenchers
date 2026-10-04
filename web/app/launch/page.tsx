import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { MainnetLaunch } from "@/components/launch/MainnetLaunch";

export const metadata: Metadata = {
  title: "Mainnet launch · Trenchers",
  description: "Team console for deploying Trenchers on Robinhood Chain mainnet.",
  robots: { index: false, follow: false },
};

export default function LaunchPage() {
  return (
    <>
      <SiteHeader page="agents" wide />
      <main className="agents-main arena-main">
        <MainnetLaunch />
      </main>
    </>
  );
}
