import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { Collection } from "@/components/collection/Collection";

export const metadata: Metadata = { title: "Collection · Trenchers", description: "All 2,000 Trenchers. Awakened agents in colour, dormant ones still holding their 0.05 ETH." };

export default function CollectionPage() {
  return (
    <>
      <SiteHeader page="collection" wide />
      <main className="coll-main">
        <Collection />
      </main>
    </>
  );
}
