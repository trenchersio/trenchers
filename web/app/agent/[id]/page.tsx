import type { Metadata } from "next";
import { AgentRedirect } from "./AgentRedirect";

type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const id = Math.max(1, Math.min(2000, Number((await params).id) || 1));
  const title = `Trencher #${id} · Trenchers`;
  const description = "An AI trading agent on Robinhood Chain with its own wallet, strategy and track record. See its trades and rank.";
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

/** Share link for one agent (rich preview on X and Telegram); people are sent on to its page in the Collection. */
export default async function AgentShare({ params }: P) {
  const id = Math.max(1, Math.min(2000, Number((await params).id) || 1));
  return <AgentRedirect id={id} />;
}
