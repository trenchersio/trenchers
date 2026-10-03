"use client";
import { useEffect, useRef, useState } from "react";
import { createSim, step, pct, ago, signalLabel, type Agent, type Sim } from "@/lib/arena-sim";
import { LineChart } from "./LineChart";
import { useWallet } from "@/lib/wallet";
import { liveAgentIds } from "@/lib/agents-store";

const ROW_H = 52;

function useSim() {
  const ref = useRef<Sim | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    ref.current = createSim();
    setTick((t) => t + 1);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const iv = setInterval(() => { if (ref.current) { step(ref.current, 1000); setTick((t) => t + 1); } }, reduce ? 3000 : 1000);
    return () => clearInterval(iv);
  }, []);
  return ref.current;
}

function nextEpochEnd(now: number) {
  const d = new Date(now);
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat; epochs end Monday 00:00 UTC
  const add = ((8 - day) % 7) || 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add);
}
function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${d}d ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
const signed = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;

export function Arena() {
  const sim = useSim();
  const [selected, setSelected] = useState<number | null>(null);
  const { address } = useWallet();
  const [mine, setMine] = useState<number[]>([]);
  useEffect(() => {
    const load = () => setMine(liveAgentIds(address));
    load();
    window.addEventListener("trenchers-agents-changed", load);
    return () => window.removeEventListener("trenchers-agents-changed", load);
  }, [address]);
  const detailRef = useRef<HTMLElement>(null);

  const leaderId = sim?.agents.find((a) => a.rank === 0)?.id ?? null;
  const sel = sim?.agents.find((a) => a.id === (selected ?? leaderId)) ?? null;

  if (!sim) {
    return <div className="arena-loading mono">Loading the Arena…</div>;
  }

  const total = sim.totalHistory.at(-1) ?? 0;
  const total0 = sim.totalHistory[0] ?? total;
  const now = Date.now();

  function choose(id: number) {
    setSelected(id);
    if (window.matchMedia("(max-width: 1000px)").matches) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="arena">
      <section className="arena-stats" aria-label="Arena totals">
        <div className="stat stat-main">
          <span className="stat-label">Total value of all agents</span>
          <span className="stat-value mono">{total.toFixed(2)} <small>ETH</small></span>
          <span className={`mono stat-delta ${total >= total0 ? "up" : "down"}`}>{signed(((total - total0) / total0) * 100, 2)} last 4 min</span>
          <LineChart data={sim.totalHistory} height={64} compact />
        </div>
        <div className="stat"><span className="stat-label">Active agents</span><span className="stat-value mono">{sim.agents.length}</span><span className="stat-sub">of 2,000</span></div>
        <div className="stat"><span className="stat-label">Trades today</span><span className="stat-value mono">{sim.tradesToday.toLocaleString()}</span><span className="stat-sub">across all agents</span></div>
        <div className="stat"><span className="stat-label">Weekly prize pool</span><span className="stat-value mono">{sim.prizePool.toFixed(3)} <small>ETH</small></span><span className="stat-sub">top 10 agents</span></div>
        <div className="stat"><span className="stat-label">Epoch ends in</span><span className="stat-value mono">{countdown(nextEpochEnd(now) - now)}</span><span className="stat-sub">Monday 00:00 UTC</span></div>
        <div className="stat stat-launches">
          <span className="stat-label">Live Pons signals</span>
          <ul className="mono signals">{sim.events.slice(0, 3).map((e) => <li key={`${e.t}-${e.kind}-${e.sym}`}><span className={`sig sig-${e.kind}`} />{signalLabel(e)}</li>)}</ul>
        </div>
      </section>

      <div className="arena-grid">
        <section className="board" aria-label="Leaderboard">
          <div className="board-head">
            <h1>Leaderboard</h1>
            <span className="board-meta">{sim.agents.length} agents · ranked by epoch return</span>
            <span className="sample">Sample data</span>
          </div>
          <div className="board-cols mono" aria-hidden="true">
            <span>#</span><span>Agent</span><span className="col-strat">Strategy</span><span className="col-num">Value ETH</span><span className="col-num">Epoch</span><span className="col-last">Last trade</span>
          </div>
          <div className="board-scroll">
            <ol className="board-rows" style={{ height: sim.agents.length * ROW_H }}>
              {sim.agents.map((a) => <Row key={a.id} a={a} now={now} mine={mine.includes(a.id)} active={a.id === sel?.id} onClick={() => choose(a.id)} />)}
            </ol>
          </div>
        </section>

        <section className="detail" ref={detailRef} aria-label="Agent details">
          {sel && <Detail a={sel} sim={sim} now={now} />}
        </section>
      </div>
    </div>
  );
}

function Row({ a, now, active, mine, onClick }: { a: Agent; now: number; active: boolean; mine: boolean; onClick: () => void }) {
  const r = pct(a);
  const moved = a.prevRank - a.rank;
  const fresh = now - a.lastTradeAt < 1400;
  const last = a.trades[0];
  return (
    <li
      className={`row${active ? " active" : ""}${moved > 0 ? " rising" : ""}${fresh ? (a.lastSide === "BUY" ? " flash-buy" : " flash-sell") : ""}`}
      style={{ transform: `translateY(${a.rank * ROW_H}px)` }}
    >
      <button type="button" onClick={onClick} aria-label={`Trencher #${a.id}, rank ${a.rank + 1}, ${signed(r)}`}>
        <span className="mono rank">{a.rank + 1}<i className={moved > 0 ? "up" : moved < 0 ? "down" : ""}>{moved > 0 ? "▲" : moved < 0 ? "▼" : ""}</i></span>
        <span className="who">
          <img src={`nft/${a.id}.webp`} alt="" width={32} height={32} />
          <span><span className="tname">Trencher </span>#{a.id}{a.house && <em className="house">House</em>}{mine && <em className="mine">Yours</em>}</span>
        </span>
        <span className="col-strat">{a.strategy}</span>
        <span className="mono col-num">{a.nav.toFixed(3)}</span>
        <span className={`mono col-num ${r >= 0 ? "up" : "down"}`}>{signed(r)}</span>
        <span className="mono col-last">{last ? <><b className={last.side === "BUY" ? "up" : "down"}>{last.side}</b> ${last.sym}</> : "—"}</span>
      </button>
    </li>
  );
}

function Detail({ a, sim, now }: { a: Agent; sim: Sim; now: number }) {
  const r = pct(a);
  const winRate = a.closed ? (a.wins / a.closed) * 100 : 0;
  const positions = [...a.positions.values()].map((p) => {
    const t = sim.tokens.get(p.sym);
    const value = t && !t.dead ? p.qty * t.price * 0.97 : 0;
    return { ...p, value, pnl: p.cost ? ((value - p.cost) / p.cost) * 100 : 0 };
  });
  return (
    <div className="detail-inner">
      <header className="detail-head">
        <img src={`nft/${a.id}.webp`} alt={`Trencher #${a.id}`} width={112} height={112} />
        <div>
          <p className="eyebrow">Rank {a.rank + 1} of {sim.agents.length}{a.house ? " · House agent" : ""}</p>
          <h2>Trencher #{a.id}</h2>
          <p className="mono who-line">Holder {a.owner}</p>
          <p className="mono who-line">Agent wallet {a.wallet}</p>
        </div>
      </header>

      <dl className="kpis">
        <div><dt>Value</dt><dd className="mono">{a.nav.toFixed(3)} ETH</dd></div>
        <div><dt>Epoch return</dt><dd className={`mono ${r >= 0 ? "up" : "down"}`}>{signed(r)}</dd></div>
        <div><dt>Deposited</dt><dd className="mono">{a.deposited.toFixed(2)} ETH</dd></div>
        <div><dt>Trades</dt><dd className="mono">{a.trades.length}</dd></div>
        <div><dt>Win rate</dt><dd className="mono">{a.closed ? `${winRate.toFixed(0)}%` : "—"}</dd></div>
        <div><dt>Cash</dt><dd className="mono">{a.cash.toFixed(3)} ETH</dd></div>
      </dl>

      <div className="panel-block">
        <h3>Value, last {Math.round(a.history.length / 60)} minutes</h3>
        <LineChart data={a.history} height={150} baseline={a.epochStart} />
      </div>

      <div className="panel-block">
        <h3>Strategy · {a.strategy}</h3>
        <div className="tags">{a.params.map((p) => <span key={p} className="mono">{p}</span>)}</div>
      </div>

      <div className="panel-block">
        <h3>Open positions</h3>
        {positions.length ? (
          <table className="mini mono">
            <thead><tr><th>Token</th><th>Cost</th><th>Value</th><th>P&amp;L</th></tr></thead>
            <tbody>{positions.map((p) => (
              <tr key={p.sym}><td>${p.sym}</td><td>{p.cost.toFixed(4)}</td><td>{p.value.toFixed(4)}</td><td className={p.pnl >= 0 ? "up" : "down"}>{signed(p.pnl)}</td></tr>
            ))}</tbody>
          </table>
        ) : <p className="empty">No open positions. The agent is holding ETH.</p>}
      </div>

      <div className="panel-block">
        <h3>Trades</h3>
        <ol className="trades mono">
          {a.trades.slice(0, 30).map((t, i) => (
            <li key={`${t.t}-${i}`}>
              <span className="t-ago">{ago(now - t.t)}</span>
              <b className={t.side === "BUY" ? "up" : "down"}>{t.side}</b>
              <span className="t-sym">${t.sym}{t.why && <i className="t-why">{t.why}</i>}</span>
              <span className="t-eth">{t.eth.toFixed(4)} ETH</span>
              <span className={`t-pnl ${t.pnlPct === undefined ? "" : t.pnlPct >= 0 ? "up" : "down"}`}>{t.pnlPct === undefined ? "" : signed(t.pnlPct)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
