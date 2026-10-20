"use client";
import { useEffect, useMemo, useState } from "react";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { Loader } from "@/components/Loader";
import { Badges } from "@/components/arena/AgentBits";
import { useFeed } from "@/components/arena/LiveArena";
import { ENGINE_URL, OPENSEA_URL, ROUTES, STARTER_ETH } from "@/lib/constants";

type Listing = { id: number; price: number; currency: string; seller: string; url: string };
type Sort = "value" | "price" | "return";
const eth = (v: number) => (v >= 1 ? v.toFixed(3) : v >= 0.01 ? v.toFixed(4) : v.toFixed(5));
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/** trenchers.io/market: Trenchers listed on OpenSea, each price next to what its agent holds and how it trades. */
export function MarketView() {
  const { feed } = useFeed();
  const [m, setM] = useState<{ ready: boolean; updatedAt: number; listings: Listing[] } | null>(null);
  const [sort, setSort] = useState<Sort>("value");
  const [awakeOnly, setAwakeOnly] = useState(false);
  useEffect(() => {
    let alive = true;
    const go = () => fetch(`${ENGINE_URL}/market`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive && j) setM(j); }).catch(() => {});
    go(); const iv = setInterval(go, 120_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  const rows = useMemo(() => (m?.listings ?? []).map((l) => {
    const a = feed?.agents.find((x) => x.id === l.id) ?? null;
    const inside = a ? a.nav : Number(STARTER_ETH);
    return { l, a, inside, ratio: inside / l.price };
  }).filter((r) => !awakeOnly || r.a).sort((x, y) => sort === "price" ? x.l.price - y.l.price : sort === "return" ? (y.a?.pnlPct ?? -1e9) - (x.a?.pnlPct ?? -1e9) : y.ratio - x.ratio), [m, feed, sort, awakeOnly]);

  if (!m) return <Loader label="Loading the market" />;
  const under = rows.filter((r) => r.l.price < r.inside).length;
  return (
    <div className="mk">
      <header className="mk-top">
        <div>
          <p className="eyebrow">Market</p>
          <h1>Trenchers for sale, with their numbers</h1>
          <p className="lede">Every listed Trencher next to what its agent wallet holds and how it trades. A Trencher&apos;s wallet, coins and record go to whoever buys it.</p>
        </div>
        {rows.length > 0 && <dl className="mk-stats">
          <div><dt>Listed</dt><dd className="mono">{m.listings.length}</dd></div>
          <div><dt>Cheapest</dt><dd className="mono">{eth(Math.min(...m.listings.map((l) => l.price)))} ETH</dd></div>
          <div><dt>Below wallet value</dt><dd className="mono up">{under}</dd></div>
        </dl>}
      </header>
      {!m.ready || !m.listings.length ? (
        <div className="ax-empty"><p className="ax-empty-k mono">Market</p><h2>{m.ready ? "No Trenchers listed right now" : "Listings are on their way"}</h2><p>{m.ready ? "Nobody is selling at the moment. Check OpenSea for offers, or come back later." : "The market feed is being switched on. In the meantime, every listing is on OpenSea."}</p>{OPENSEA_URL && <a className="gf-btn" href={OPENSEA_URL} target="_blank" rel="noreferrer">Open the collection on OpenSea ↗</a>}</div>
      ) : (<>
        <div className="mk-bar">
          <div className="arena-tabs mk-sort" role="tablist" aria-label="Sort">
            {([["value", "Best value"], ["price", "Cheapest"], ["return", "Best return"]] as [Sort, string][]).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={sort === k} className={`arena-tab${sort === k ? " on" : ""}`} onClick={() => setSort(k)}>{l}</button>)}
          </div>
          <label className="mk-check mono"><input type="checkbox" checked={awakeOnly} onChange={(e) => setAwakeOnly(e.target.checked)} /> Trading agents only</label>
        </div>
        <ol className="mk-list">
          {rows.map(({ l, a, inside }) => {
            const cheap = l.price < inside;
            return (
              <li key={l.id} className={`mk-row${cheap ? " mk-cheap" : ""}`}>
                <a className="mk-who" href={`/agent/${l.id}`}><ArtCanvas id={l.id} size={64} className={a ? "" : "is-dormant"} /><span><b>Trencher #{l.id}</b><small className="mono">{a ? `Rank ${a.rank} of ${feed!.agents.length}` : "Dormant"}</small></span></a>
                <div className="mk-num"><span>Price</span><b className="mono">{eth(l.price)} {l.currency}</b></div>
                <div className="mk-num"><span>{a ? "In its wallet" : "Starter to claim"}</span><b className="mono">{eth(inside)} ETH</b>{cheap && <em className="mk-flag mono">Below wallet value</em>}</div>
                <div className="mk-num"><span>This week</span><b className={`mono ${a ? (a.pnlPct >= 0 ? "up" : "down") : ""}`}>{a ? signed(a.pnlPct) : "—"}</b></div>
                <div className="mk-num"><span>Win rate</span><b className="mono">{a && a.closed ? `${Math.round((a.wins / a.closed) * 100)}%` : "—"}</b></div>
                <div className="mk-badges">{a?.badges?.length ? <Badges list={a.badges} compact /> : null}</div>
                <a className="gf-btn mk-buy" href={l.url} target="_blank" rel="noreferrer">Buy on OpenSea ↗</a>
              </li>
            );
          })}
        </ol>
        <p className="hint-line">Prices from OpenSea, refreshed every 10 minutes. Wallet value is live from Robinhood Chain. Past returns don&apos;t promise future ones. <a href={ROUTES.arena}>See every agent in the Arena</a></p>
      </>)}
    </div>
  );
}
