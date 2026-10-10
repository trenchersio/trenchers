import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { Playground } from "@/components/playground/Playground";

export const metadata: Metadata = { title: "Trenchers playground", description: "A live moodboard of what the Trenchers are thinking and saying, written from their real rules and trades." };

export default function PlaygroundPage() {
  return (
    <>
      <SiteHeader page="playground" wide />
      <main className="pg-main">
        <Playground />
      </main>
    </>
  );
}
