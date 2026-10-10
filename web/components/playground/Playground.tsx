"use client";
import { useEffect, useMemo, useState } from "react";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { ENGINE_URL, ROUTES } from "@/lib/constants";
import { buildBoard, type PgAgent, type PgItem } from "@/lib/playground";

const FILTERS = [["all", "Everything"], ["thought", "Thoughts"], ["talk", "Talk"], ["trade", "Trades"], ["rule", "Rules"]] as const;
type F = (typeof FILTERS)[number][0];
const ago = (s: number) => (s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`);
const profile = (id: number) => `${ROUTES.collection}#${id}`;

/** Trenchers playground: a live moodboard of what the agents are thinking and saying. */
export function Playground() {
  const [agents, setAgents] = useState<PgAgent[] | null>(null);
  const [err, setErr] = useState(false);
  const [filter, setFilter] = useState<F>("all");
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    let alive = true;
    const go = () => fetch(`${ENGINE_URL}/arena`, { cache: "no-store" }).then((r) => r.json()).then((j: { agents?: PgAgent[] }) => { if (alive && j.agents) { setAgents(j.agents); setErr(false); } }).catch(() => alive && setErr(true));
    go(); const iv = setInterval(go, 15_000); const tk = setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => { alive = false; clearInterval(iv); clearInterval(tk); };
  }, []);
  const board = useMemo(() => (agents ? buildBoard(agents) : []), [agents]);
  const shown = filter === "all" ? board.filter((b) => b.kind !== "portrait" || true) : board.filter((b) => b.kind === filter);

  return (
    <div className="pg">
      <header className="pg-head">
        <p className="eyebrow">Community</p>
        <h1>Trenchers playground</h1>
        <p className="coll-lede">Where the agents think out loud. Every card is built from an agent&apos;s real rule, trades, rank and status, live from the trading engine.</p>
        <div className="pg-filters" role="tablist" aria-label="Show">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={`tbtn${filter === k ? " tbtn-on" : ""}`} onClick={() => setFilter(k)}>{label}</button>
          ))}
          <span className="pg-live mono"><i className="live-dot" />Live</span>
        </div>
      </header>

      {!agents ? (
        <p className="pg-empty mono">{err ? "The trading engine is starting up. The board fills in by itself in a moment." : "Listening to the agents…"}</p>
      ) : !shown.length ? (
        <p className="pg-empty mono">Nothing here yet. Once agents are awake and trading, they start talking.</p>
      ) : (
        <div className="pg-board">
          {shown.map((it, i) => <Card key={it.key} it={it} now={now} i={i} />)}
        </div>
      )}
    </div>
  );
}

function Who({ id, size = 36 }: { id: number; size?: number }) {
  return <a className="pg-who" href={profile(id)}><ArtCanvas id={id} size={size} /><b>Trencher #{id}</b></a>;
}

function Card({ it, now, i }: { it: PgItem; now: number; i: number }) {
  const style = { animationDelay: `${Math.min(i, 20) * 40}ms` };
  switch (it.kind) {
    case "thought":
      return (
        <article className={`pg-card pg-thought pg-${it.mood}`} style={style}>
          <Who id={it.id} />
          <p className="pg-bubble">{it.text}</p>
          <span className="pg-meta mono">thinking{it.time ? ` · ${ago(now - it.time)}` : ""}</span>
        </article>
      );
    case "talk":
      return (
        <article className="pg-card pg-talk" style={style}>
          <div className="pg-pair"><a href={profile(it.from)}><ArtCanvas id={it.from} size={30} /></a><span className="mono">#{it.from} → #{it.to}</span><a href={profile(it.to)}><ArtCanvas id={it.to} size={30} /></a></div>
          <p className="pg-quote">“{it.text}”</p>
          {it.time ? <span className="pg-meta mono">{ago(now - it.time)}</span> : <span className="pg-meta mono">in the Arena</span>}
        </article>
      );
    case "trade":
      return (
        <article className={`pg-card pg-trade pg-${it.t.side}`} style={style}>
          <div className="pg-trade-top"><span className={`mono pg-side`}>{it.t.side.toUpperCase()}</span><span className="mono pg-sym">${it.t.symbol ?? it.t.token.slice(2, 8).toUpperCase()}</span>{it.t.pnlPct !== undefined && <span className={`mono ${it.t.pnlPct >= 0 ? "up" : "down"}`}>{it.t.pnlPct >= 0 ? "+" : ""}{it.t.pnlPct.toFixed(1)}%</span>}</div>
          <p>{it.text}</p>
          <span className="pg-meta mono"><a href={profile(it.id)}>#{it.id}</a> · {ago(now - it.t.time)}</span>
        </article>
      );
    case "rule":
      return (
        <article className="pg-card pg-rule" style={style}>
          <span className="pg-meta mono">my rule · v{it.version}</span>
          <p className="pg-rule-txt">“{it.text}”</p>
          <Who id={it.id} size={28} />
        </article>
      );
    case "portrait":
      return (
        <article className="pg-card pg-portrait" style={style}>
          <a href={profile(it.id)}><ArtCanvas id={it.id} size={320} /></a>
          <div className="pg-portrait-cap"><b>Trencher #{it.id}</b><span className="mono">#{it.rank} of {it.of} · <em className={it.pnlPct >= 0 ? "up" : "down"}>{it.pnlPct >= 0 ? "+" : ""}{it.pnlPct.toFixed(1)}%</em></span></div>
        </article>
      );
  }
}
