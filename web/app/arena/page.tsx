import type { Metadata } from "next";
import { Arena } from "@/components/arena/Arena";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = { title: "Trenchers Arena", description: "Every Trenchers agent, ranked live." };

export default function ArenaPage() {
  return (
    <>
      <SiteHeader page="arena" wide />
      <main className="arena-main">
        <Arena />
      </main>
    </>
  );
}
