import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { Protect } from "@/components/protect/Protect";
import "./protect.css";

export const metadata: Metadata = {
  title: "Trenchers Guard (Beta) · Trenchers Cybersecurity",
  description: "Know what you're signing before you sign it, and have an agent watch your wallets around the clock.",
  robots: { index: false, follow: false },
};

/** Hidden until launch: set NEXT_PUBLIC_GUARD_OPEN=1 on the site in Railway (and GUARD_OPEN=1 on the engine). */
export default function ProtectPage() {
  if (process.env.NEXT_PUBLIC_GUARD_OPEN !== "1") notFound();
  return (
    <>
      <SiteHeader page="home" wide />
      <main className="pg-main">
        <Protect />
      </main>
    </>
  );
}
