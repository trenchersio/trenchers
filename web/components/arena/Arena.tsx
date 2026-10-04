"use client";
import { PnlCardButton } from "@/components/PnlCard";
import type { PnlCardData } from "@/lib/pnl-card";
import { gmgnToken } from "@/lib/constants";
import { AgentLinks } from "@/components/AgentLinks";
import { short } from "@/lib/wallet";
import { useEffect, useRef, useState } from "react";
import { createSim, step, pct, ago, signalLabel, type Agent, type Sim } from "@/lib/arena-sim";
import { LineChart } from "./LineChart";
import { useWallet } from "@/lib/wallet";
import { liveAgentIds } from "@/lib/agents-store";

const ROW_H = 58;
type Filter = "all" | "guided" | "template" | "mine";

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
  const [filter, setFilter] = useState<Filter>("all");
  const { address } = useWallet();
  const [mine, setMine] = useState<number[]>([]);
  useEffect(() => {
    const load = () => setMine(liveAgentIds(address));
    load();
    window.addEventListener("trenchers-agents-changed", load);
    return () => window.removeEventListener("trenchers-agents-changed", load);
  }, [address]);
  const detailRef = useRef<HTMLElement>(null);
  // Deep link from the Collection: arena#agent-123 opens that agent.
  useEffect(() => {
    const m = /^#agent-(\d+)$/.exec(window.location.hash);
    if (m) setSelected(Number(m[1]));
  }, []);

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
        <div className="stat"><span className="stat-label">Self-funding paid</span><span className="stat-value mono">{(sim.agentFees + sim.agents.reduce((t, x) => t + x.tokenFees, 0)).toFixed(2)} <small>ETH</small></span><span className="stat-sub">agent coins + 10% of $TRENCHERS fees</span></div>
        <div className="stat"><span className="stat-label">Weekly prize pool</span><span className="stat-value mono">{sim.prizePool.toFixed(3)} <small>ETH</small></span><span className="stat-sub">top 10 agents</span></div>
        <div className="stat"><span className="stat-label">Week ends in</span><span className="stat-value mono">{countdown(nextEpochEnd(now) - now)}</span><span className="stat-sub">Monday 00:00 UTC</span></div>
        <div className="stat stat-launches">
          <span className="stat-label">Live Pons signals</span>
          <ul className="mono signals">{sim.events.slice(0, 3).map((e) => <li key={`${e.t}-${e.kind}-${e.sym}`}><span className={`sig sig-${e.kind}`} />{signalLabel(e)}</li>)}</ul>
        </div>
      </section>

      <div className="arena-grid">
        <section className="board" aria-label="Leaderboard">
          <div className="board-head">
            <div className="bh-title"><h1>Leaderboard</h1><span className="board-meta">{sim.agents.length} agents · ranked by weekly PnL</span></div>
            <span className="sample">Sample data</span>
          </div>
          <div className="podium" aria-label="Top 3">
            {[0, 1, 2].map((rk) => { const a = sim.agents.find((x) => x.rank === rk)!; const pr = pct(a); return (
              <button key={rk} type="button" className={`pod pod-${rk + 1}${sel?.id === a.id ? " on" : ""}`} onClick={() => choose(a.id)}>
                <span className="pod-rank mono">{rk + 1}</span>
                <img src={`nft/${a.id}.webp`} alt="" width={44} height={44} />
                <span className="pod-txt"><b>#{a.id}</b><span className={`mono ${pr >= 0 ? "up" : "down"}`}>{signed(pr)}</span></span>
              </button>
            ); })}
          </div>
          <div className="board-filters" role="tablist" aria-label="Filter">
            {([["all", "All"], ["guided", "Guided"], ["template", "Templates"], ...(mine.length ? [["mine", "Yours"]] : [])] as [Filter, string][]).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={filter === k} className={`tbtn${filter === k ? " tbtn-on" : ""}`} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          <div className="board-cols mono" aria-hidden="true">
            <span>#</span><span>Agent</span><span className="col-num">PnL</span><span className="col-spark">7d</span><span className="col-num col-val">Value</span><span className="col-last">Last trade</span>
          </div>
          <div className="board-scroll">
            {(() => {
              const shown = [...sim.agents].filter((a) => filter === "all" || (filter === "guided" ? !!a.rule : filter === "template" ? !a.rule : mine.includes(a.id))).sort((x, y) => x.rank - y.rank);
              const pos = new Map(shown.map((a, i) => [a.id, i]));
              return (
                <ol className="board-rows" style={{ height: shown.length * ROW_H }}>
                  {sim.agents.map((a) => pos.has(a.id) ? <Row key={a.id} a={a} slot={pos.get(a.id)!} now={now} mine={mine.includes(a.id)} active={a.id === sel?.id} onClick={() => choose(a.id)} /> : null)}
                </ol>
              );
            })()}
          </div>
        </section>

        <section className="detail" ref={detailRef} aria-label="Agent details">
          {sel && <Detail a={sel} sim={sim} now={now} />}
        </section>
      </div>
    </div>
  );
}

function Spark({ data }: { data: number[] }) {
  const d = data.slice(-90); if (d.length < 2) return <svg className="spark" />;
  const lo = Math.min(...d), hi = Math.max(...d), span = hi - lo || 1;
  const pts = d.map((v, i) => `${(i / (d.length - 1)) * 64},${20 - ((v - lo) / span) * 18 - 1}`).join(" ");
  const up = d[d.length - 1] >= d[0];
  return <svg className="spark" viewBox="0 0 64 20" preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={up ? "#39FF88" : "#FF4D4D"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
}

function Row({ a, slot, now, active, mine, onClick }: { a: Agent; slot: number; now: number; active: boolean; mine: boolean; onClick: () => void }) {
  const r = pct(a);
  const moved = a.prevRank - a.rank;
  const fresh = now - a.lastTradeAt < 1400;
  const last = a.trades[0];
  return (
    <li
      className={`row${active ? " active" : ""}${moved > 0 ? " rising" : ""}${fresh ? (a.lastSide === "BUY" ? " flash-buy" : " flash-sell") : ""}`}
      style={{ transform: `translateY(${slot * ROW_H}px)` }}
    >
      <button type="button" onClick={onClick} aria-label={`Trencher #${a.id}, rank ${a.rank + 1}, ${signed(r)}`}>
        <span className={`mono rank${a.rank < 3 ? ` rank-top rank-${a.rank + 1}` : ""}`}>{a.rank + 1}{moved !== 0 && a.rank >= 3 && <i className={moved > 0 ? "up" : "down"}>{moved > 0 ? "▲" : "▼"}</i>}</span>
        <span className="who">
          <img src={`nft/${a.id}.webp`} alt="" width={34} height={34} />
          <span className="who-txt">
            <b>Trencher #{a.id}{a.house && <em className="house">House</em>}{mine && <em className="mine">Yours</em>}</b>
            <small>{a.rule ? <><i className="dot-g" />Guided</> : <><i className="dot-t" />{a.strategy}</>}{a.token && <span className="coin-sm"> · ${a.token}</span>}</small>
          </span>
        </span>
        <span className="col-num"><em className={`pnl mono ${r >= 0 ? "pnl-up" : "pnl-down"}`}>{signed(r)}</em></span>
        <span className="col-spark"><Spark data={a.history} /></span>
        <span className="mono col-num col-val">{a.nav.toFixed(3)}<small> ETH</small></span>
        <span className="mono col-last">{last ? <><b className={`side ${last.side === "BUY" ? "side-buy" : "side-sell"}`}>{last.side}</b><span className="sym">${last.sym}</span><span className="ago">{ago(now - last.t)}</span></> : "—"}</span>
      </button>
    </li>
  );
}

function cardData(a: Agent, sim: Sim): PnlCardData {
  const best = a.trades.filter((t) => t.side === "SELL" && t.pnlPct != null).sort((x, y) => (y.pnlPct ?? 0) - (x.pnlPct ?? 0))[0];
  return {
    id: a.id, returnPct: pct(a), pnlEth: a.nav - a.epochStart, balanceEth: a.nav,
    biggest: best ? { sym: best.sym, pct: best.pnlPct ?? 0 } : null,
    strategy: a.rule ? "Guided by its holder" : a.strategy,
    rank: { pos: a.rank + 1, of: sim.agents.length }, period: "This week",
  };
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
          <p className="mono who-line">Holder {a.owner.startsWith("0x") ? short(a.owner) : a.owner}</p>
          <p className="mono who-line">Agent wallet {short(a.wallet)}</p>
          <AgentLinks wallet={a.wallet} />
          <PnlCardButton data={cardData(a, sim)} />
        </div>
      </header>

      <dl className="kpis">
        <div><dt>Value</dt><dd className="mono">{a.nav.toFixed(3)} ETH</dd></div>
        <div><dt>PnL this week</dt><dd className={`mono ${r >= 0 ? "up" : "down"}`}>{signed(r)}</dd></div>
        <div><dt>Deposited</dt><dd className="mono">{a.deposited.toFixed(2)} ETH</dd></div>
        <div><dt>Trades</dt><dd className="mono">{a.trades.length}</dd></div>
        <div><dt>Win rate</dt><dd className="mono">{a.closed ? `${winRate.toFixed(0)}%` : "—"}</dd></div>
        <div><dt>Cash</dt><dd className="mono">{a.cash.toFixed(3)} ETH</dd></div>
      </dl>

      <div className="panel-block">
        <h3>Value, last {Math.round(a.history.length / 60)} minutes</h3>
        <LineChart data={a.history} height={150} baseline={a.epochStart} />
      </div>

      <div className="panel-block selffund">
        <h3>Self-funding</h3>
        <dl>
          <div><dt>Funding</dt><dd className="mono">{a.token && a.tokenAddress ? <a className="fund-coin" href={gmgnToken(a.tokenAddress)} target="_blank" rel="noreferrer">Coin ${a.token} ↗</a> : <span className="fund-self">Self-funded</span>}</dd></div>
          <div><dt>Coin fees earned</dt><dd className="mono">{a.tokenFees.toFixed(4)} ETH</dd></div>
          <div><dt>$TRENCHERS fee share</dt><dd className="mono">{a.shareFees.toFixed(4)} ETH</dd></div>
        </dl>
        <p className="hint-line">Fee income is added to the agent wallet like a deposit, so it funds trading but doesn&apos;t count as PnL.</p>
      </div>

      <div className="panel-block">
        <h3>Strategy · {a.rule ? "Custom, guided by its holder" : `${a.strategy} (house template)`}</h3>
        {a.guidance && <blockquote className="guide"><span className="mono">Latest guidance</span>“{a.guidance}”</blockquote>}
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
