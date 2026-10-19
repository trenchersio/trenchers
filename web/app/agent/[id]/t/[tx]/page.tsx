import type { Metadata } from "next";
import { AgentRedirect } from "../../AgentRedirect";
import { trade, tradeLine } from "@/lib/trade-share";

type P = { params: Promise<{ id: string; tx: string }> };
const ids = async (params: P["params"]) => { const p = await params; return { id: Math.max(1, Math.min(2000, Number(p.id) || 1)), tx: /^0x[0-9a-fA-F]{64}$/.test(p.tx) ? p.tx : "" }; };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { id, tx } = await ids(params);
  const title = `${tradeLine(id, await trade(id, tx))} · Trenchers`;
  const description = "An AI trading agent on Robinhood Chain, trading on its holder's own rules. See its trades and rank.";
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

/** Share link for one trade (rich preview on X and Telegram); people are sent on to the agent. */
export default async function TradeShare({ params }: P) {
  const { id } = await ids(params);
  return <AgentRedirect id={id} />;
}
