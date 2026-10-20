"use client";
import { useEffect, useState } from "react";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { Loader } from "@/components/Loader";
import { FollowButton } from "@/components/arena/ArenaExtras";
import { LiveDetail, useFeed } from "@/components/arena/LiveArena";
import { ENGINE_URL, ROUTES, openseaItem } from "@/lib/constants";

type Week = { week: string; start: number; top: { id: number; pnlPct: number }[]; bestTrade: { id: number; symbol: string; pct: number } | null; comeback: { id: number } | null; mostActive: { id: number; trades: number } | null };
const EXPLORERS: Record<number, string> = { 46630: "https://explorer.testnet.chain.robinhood.com", 4663: "https://robin.etherscan.io" };
const day = (t: number) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** trenchers.io/agent/<id>: one Trencher's public page, live from the trading engine. */
export function AgentPage({ id, tx }: { id: number; tx?: string }) {
  const { feed, error } = useFeed();
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { fetch(`${ENGINE_URL}/recaps`).then((r) => (r.ok ? r.json() : { weeks: [] })).then((j: { weeks?: Week[] }) => setWeeks(j.weeks ?? [])).catch(() => {}); }, []);
  useEffect(() => { if (tx && feed) setTimeout(() => document.getElementById(`tx-${tx}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 300); }, [tx, !!feed]);

  if (!feed) return error ? <Dormant id={id} note="The live data can't be reached right now. Try again in a moment." /> : <Loader label={`Loading Trencher #${id}`} />;
  const a = feed.agents.find((x) => x.id === id);
  if (!a) return <Dormant id={id} />;
  const explorer = EXPLORERS[feed.chainId] ?? EXPLORERS[4663];
  const honors = weeks.flatMap((w) => {
    const out: { k: string; w: Week; v: string }[] = [];
    const i = w.top.findIndex((t) => t.id === id);
    if (i >= 0) out.push({ k: i === 0 ? "🏆 Week winner" : `🥇 #${i + 1} of the week`, w, v: `${w.top[i].pnlPct >= 0 ? "+" : ""}${w.top[i].pnlPct.toFixed(1)}%` });
    if (w.bestTrade?.id === id) out.push({ k: "💥 Best single trade", w, v: `+${w.bestTrade.pct.toFixed(0)}% $${w.bestTrade.symbol}` });
    if (w.comeback?.id === id) out.push({ k: "↗ Biggest comeback", w, v: "" });
    if (w.mostActive?.id === id) out.push({ k: "⚡ Most active", w, v: `${w.mostActive.trades} trades` });
    return out;
  });
  return (
    <div className="agp">
      <nav className="agp-crumbs mono"><a href={ROUTES.arena}>← Arena</a><span>·</span><a href={`${ROUTES.collection}#${id}`}>Collection</a></nav>
      <div className="arena live-arena agp-body">
        <section className="detail"><LiveDetail a={a} of={feed.agents.length} explorer={explorer} now={now} highlight={tx} /></section>
        {honors.length > 0 && (
          <section className="panel-block agp-honors">
            <h3>Hall of fame</h3>
            <ol>{honors.map((h, i) => <li key={i}><b>{h.k}</b><span className="mono">{day(h.w.start)}{h.v ? ` · ${h.v}` : ""}</span></li>)}</ol>
          </section>
        )}
      </div>
    </div>
  );
}

function Dormant({ id, note }: { id: number; note?: string }) {
  return (
    <div className="agp agp-dormant">
      <ArtCanvas id={id} size={220} className="is-dormant" />
      <div>
        <p className="eyebrow">Trencher #{id}</p>
        <h1>{note ? "Can't load the live data" : "Not trading yet"}</h1>
        <p className="lede">{note ?? "This Trencher hasn't been awakened, so it has no agent wallet or trades yet. Whoever holds it can awaken it and claim its starter balance in one step."}</p>
        <div className="actions"><FollowButton id={id} /><a className="gf-btn" href={openseaItem(id)} target="_blank" rel="noreferrer">See it on OpenSea ↗</a><a className="gf-btn ghost" href={ROUTES.arena}>The Arena</a></div>
      </div>
    </div>
  );
}
