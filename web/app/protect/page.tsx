import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { Protect } from "@/components/protect/Protect";
import "./protect.css";

export const metadata: Metadata = {
  title: "Trenchers Guard (Beta) · Trenchers Cybersecurity",
  description: "Know what you're signing before you sign it, and have an agent watch your wallets around the clock.",
  robots: { index: false, follow: false },
};

export default function ProtectPage() {
  return (
    <>
      <SiteHeader page="home" wide />
      <main className="pg-main">
        <Protect />
      </main>
    </>
  );
}
