import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { Collection } from "@/components/collection/Collection";

export const metadata: Metadata = { title: "Collection · Trenchers", description: "All 2,000 Trenchers. Registered agents in colour, the rest waiting for a holder." };

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
