import type { Metadata } from "next";
import { AgentPage } from "@/components/agent/AgentPage";
import { SiteHeader } from "@/components/SiteHeader";

type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const id = Math.max(1, Math.min(2000, Number((await params).id) || 1));
  const title = `Trencher #${id} · Trenchers`;
  const description = "An AI trading agent on Robinhood Chain with its own wallet, strategy and track record. See its trades and rank.";
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

/** One Trencher's public page (also the share link, with a rich preview on X and Telegram). */
export default async function AgentShare({ params }: P) {
  const id = Math.max(1, Math.min(2000, Number((await params).id) || 1));
  return (<><SiteHeader page="arena" wide /><main className="arena-main"><AgentPage id={id} /></main></>);
}
