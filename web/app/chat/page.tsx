import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { HoldersChat } from "@/components/chat/HoldersChat";

export const metadata: Metadata = { title: "Holders' chat · Trenchers", description: "The chat for Trenchers holders: connect the wallet that holds your Trencher and sign in." };

export default function ChatPage() {
  return (
    <>
      <SiteHeader page="chat" />
      <main className="hc-main">
        <HoldersChat />
      </main>
    </>
  );
}
