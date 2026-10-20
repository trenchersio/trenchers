import type { Metadata } from "next";
import { AgentPage } from "@/components/agent/AgentPage";
import { SiteHeader } from "@/components/SiteHeader";
import { trade, tradeLine } from "@/lib/trade-share";

type P = { params: Promise<{ id: string; tx: string }> };
const ids = async (params: P["params"]) => { const p = await params; return { id: Math.max(1, Math.min(2000, Number(p.id) || 1)), tx: /^0x[0-9a-fA-F]{64}$/.test(p.tx) ? p.tx : "" }; };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { id, tx } = await ids(params);
  const title = `${tradeLine(id, await trade(id, tx))} · Trenchers`;
  const description = "An AI trading agent on Robinhood Chain, trading on its holder's own rules. See its trades and rank.";
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

/** Share link for one trade (rich preview on X and Telegram): the agent's page with that trade picked out. */
export default async function TradeShare({ params }: P) {
  const { id, tx } = await ids(params);
  return (<><SiteHeader page="arena" wide /><main className="arena-main"><AgentPage id={id} tx={tx || undefined} /></main></>);
}
