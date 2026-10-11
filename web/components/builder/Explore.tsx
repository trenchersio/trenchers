"use client";
// Every coin launched through the builder: a filterable wall of cards, each with its rules and a price line.
import { useMemo, useState } from "react";
import { moduleDef, quoteSymbol, bps, type BuilderCoin } from "@/lib/v4builder";
import { Avatar, Line, ago, q } from "./bits";

type Sort = "new" | "volume" | "cap";

export function Explore({ coins, failed }: { coins: BuilderCoin[] | null; failed: boolean }) {
  const [pair, setPair] = useState<"all" | "ETH" | "TRENCHERS">("all");
  const [sort, setSort] = useState<Sort>("new");
  const [find, setFind] = useState("");
  const list = useMemo(() => {
    const f = find.trim().toLowerCase();
    return (coins ?? [])
      .filter((c) => pair === "all" || quoteSymbol(c.quote) === pair)
      .filter((c) => !f || c.name.toLowerCase().includes(f) || c.symbol.toLowerCase().includes(f) || c.token.toLowerCase() === f)
      .sort((a, b) => sort === "new" ? b.launchedAt - a.launchedAt
        : sort === "volume" ? Number(BigInt(b.volumeQuote) - BigInt(a.volumeQuote) > 0n) * 2 - 1
        : Number(BigInt(b.marketCapQuote ?? "0") - BigInt(a.marketCapQuote ?? "0") > 0n) * 2 - 1);
  }, [coins, pair, sort, find]);

  return (
    <div className="vb-explore">
      <div className="vb-filters">
        <div className="vb-seg" role="group" aria-label="Pair">
          {(["all", "ETH", "TRENCHERS"] as const).map((p) => <button key={p} type="button" className={pair === p ? "on" : ""} onClick={() => setPair(p)}>{p === "all" ? "All pairs" : p === "ETH" ? "ETH" : "$TRENCHERS"}</button>)}
        </div>
        <div className="vb-seg" role="group" aria-label="Sort">
          {([["new", "Newest"], ["volume", "Volume"], ["cap", "Value"]] as const).map(([k, l]) => <button key={k} type="button" className={sort === k ? "on" : ""} onClick={() => setSort(k)}>{l}</button>)}
        </div>
        <input className="vb-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find by name, ticker or address" aria-label="Find a coin" />
      </div>

      {coins === null ? (
        <div className="vb-wall">{Array.from({ length: 6 }, (_, i) => <div key={i} className="vb-coin vb-coin-ghost" />)}</div>
      ) : list.length === 0 ? (
        <div className="vb-none">
          <b>{failed ? "The coin list couldn't be loaded." : coins.length ? "Nothing matches." : "No coins yet."}</b>
          <span>{failed ? "Try again in a moment." : coins.length ? "Try another filter." : "Be the first: design one above and launch it."}</span>
        </div>
      ) : (
        <div className="vb-wall">
          {list.map((c) => {
            const qs = quoteSymbol(c.quote);
            const first = c.chart?.[0]?.p, last = c.chart?.[c.chart.length - 1]?.p;
            const chg = first && last ? ((last - first) / first) * 100 : null;
            return (
              <a key={c.token} className="vb-coin" href={`?coin=${c.token}`}>
                <div className="vb-coin-top">
                  <Avatar image={c.image} symbol={c.symbol} size={40} />
                  <div className="vb-coin-id">
                    <b>{c.name}</b>
                    <span className="mono">${c.symbol} <i className={`vb-q vb-q-${qs === "ETH" ? "e" : "t"}`}>{qs === "ETH" ? "ETH" : "TRENCHERS"}</i></span>
                  </div>
                  <span className="vb-coin-age mono">{ago(c.launchedAt)}</span>
                </div>
                <Line points={c.chart ?? []} w={280} h={54} className="vb-coin-line" />
                <div className="vb-coin-nums mono">
                  <div><span>value · {qs === "ETH" ? "eth" : "trenchers"}</span><b>{q(c.marketCapQuote, 3)}</b></div>
                  <div><span>volume</span><b>{q(c.volumeQuote, 3)}</b></div>
                  <div><span>change</span><b className={chg === null ? "" : chg >= 0 ? "up" : "down"}>{chg === null ? "–" : `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`}</b></div>
                </div>
                <div className="vb-coin-mods">
                  {c.modules.length === 0 ? <span className="vb-tag vb-tag-plain">plain v4</span> : c.modules.slice(0, 3).map((m, i) => <span key={i} className="vb-tag">{m === "unknown" as never ? "custom" : moduleDef(m)?.name ?? m}</span>)}
                  {c.modules.length > 3 && <span className="vb-tag vb-tag-more">+{c.modules.length - 3}</span>}
                  <span className="vb-coin-fee mono">{bps(c.creatorBuyBps)} / {bps(c.creatorSellBps)}</span>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
