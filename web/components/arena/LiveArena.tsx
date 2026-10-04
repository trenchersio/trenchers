"use client";
import { useEffect, useState } from "react";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { PnlCardButton } from "@/components/PnlCard";
import type { PnlCardData } from "@/lib/pnl-card";
import { ENGINE_URL } from "@/lib/constants";
import { short } from "@/lib/wallet";
import { LineChart, RangeTabs } from "./LineChart";

/** The live Arena: real agents and trades, straight from the trading engine's /arena feed. */
type LiveTrade = { agent: number; wallet: string; token: string; symbol?: string; side: "buy" | "sell"; eth: string; time: number; tx: string; pnlPct?: number };
type LiveAgent = {
  rank: number; id: number; wallet: string; owner?: string; live: boolean; rule: string | null; ruleVersion: number;
  understood: string[]; ruleWarning: string | null; nav: number; cash: number; pnlEth: number; pnlPct: number;
  trades: number; wins: number; closed: number; biggest: { symbol: string; pct: number } | null;
  positions: { token: string; symbol?: string; cost: number; value: number; since: number }[];
  history: { t: number; v: number }[]; recent: LiveTrade[];
};
type Feed = { updatedAt: number; chainId: number; nft: string; paused: boolean; agents: LiveAgent[]; feed: LiveTrade[] };

const EXPLORERS: Record<number, string> = { 46630: "https://explorer.testnet.chain.robinhood.com", 4663: "https://robin.etherscan.io" };
const signed = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
const ethTxt = (v: number) => (Math.abs(v) >= 0.01 ? v.toFixed(4) : v.toFixed(6));
const ago = (s: number) => (s < 60 ? `${Math.max(0, Math.floor(s))}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`);
const sym = (t: { symbol?: string; token: string }) => `$${t.symbol ?? t.token.slice(2, 8)}`;

function useFeed() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`${ENGINE_URL}/arena`, { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "The engine isn't ready yet");
        if (alive) { setFeed(j); setError(null); }
      } catch (e) { if (alive) setError((e as Error).message); }
    };
    load();
    const iv = setInterval(load, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  return { feed, error };
}

export function cardFromLive(a: LiveAgent, of: number): PnlCardData {
  return {
    id: a.id, returnPct: a.pnlPct, pnlEth: a.pnlEth, balanceEth: a.nav,
    biggest: a.biggest ? { sym: a.biggest.symbol, pct: a.biggest.pct } : null,
    strategy: a.rule ? (a.rule.length > 34 ? `Guided · rule v${a.ruleVersion}` : a.rule) : "No rule yet",
    rank: { pos: a.rank, of }, period: "This week",
  };
}

export function LiveArena() {
  const { feed, error } = useFeed();
  const [selected, setSelected] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(t); }, []);

  if (!feed) return <div className="arena-loading mono">{error ? `Live Arena unavailable: ${error}` : "Connecting to the trading engine…"}</div>;
  const explorer = EXPLORERS[feed.chainId] ?? EXPLORERS[46630];
  const testnet = feed.chainId === 46630;
  const sel = feed.agents.find((a) => a.id === selected) ?? feed.agents[0] ?? null;
  const total = feed.agents.reduce((t, a) => t + a.nav, 0);
  const weekTrades = feed.agents.reduce((t, a) => t + a.trades, 0);
  const trading = feed.agents.filter((a) => a.live).length;

  return (
    <div className="arena live-arena">
      {feed.paused && <p className="live-paused mono">Emergency stop is on: the team has paused all trading. Holders can still withdraw.</p>}
      <section className="arena-stats" aria-label="Arena totals">
        <div className="stat stat-main">
          <span className="stat-label">Total value of all agents</span>
          <span className="stat-value mono">{ethTxt(total)} <small>ETH</small></span>
          <span className="mono stat-delta">{feed.agents.length} awakened · {trading} trading</span>
        </div>
        <div className="stat"><span className="stat-label">Trades this week</span><span className="stat-value mono">{weekTrades}</span><span className="stat-sub">on Pons{testnet ? " (test launchpad)" : ""}</span></div>
        <div className="stat"><span className="stat-label">Network</span><span className="stat-value mono">{testnet ? "Testnet" : "Mainnet"}</span><span className="stat-sub">Robinhood Chain</span></div>
        <div className="stat"><span className="stat-label">Updated</span><span className="stat-value mono">{ago(now - feed.updatedAt)}</span><span className="stat-sub">every 5 seconds</span></div>
      </section>

      <div className="arena-grid">
        <section className="board" aria-label="Live leaderboard">
          <div className="board-head">
            <div className="bh-title"><h1>Leaderboard</h1><span className="board-meta">{feed.agents.length} agents · ranked by weekly PnL</span></div>
            <span className="sample live-badge">{testnet ? "Live · testnet" : "Live"}</span>
          </div>
          {feed.agents.length === 0 && <p className="empty live-empty">No awakened agents yet. Mint a Trencher, awaken it and give it a rule, and it appears here.</p>}
          <ol className="live-rows">
            {feed.agents.map((a) => {
              const last = a.recent[0];
              return (
                <li key={a.id}>
                  <button type="button" className={`live-row${sel?.id === a.id ? " active" : ""}`} onClick={() => setSelected(a.id)}>
                    <span className={`mono rank${a.rank <= 3 ? ` rank-top rank-${a.rank}` : ""}`}>{a.rank <= 3 ? `0${a.rank}` : a.rank}</span>
                    <span className="who">
                      <ArtCanvas id={a.id} size={40} />
                      <span className="who-txt">
                        <b>Trencher #{a.id}</b>
                        <small>{a.live ? <><i className="dot-g" />Trading</> : <><i className="dot-t" />Paused</>}{a.rule ? ` · rule v${a.ruleVersion}` : " · no rule yet"}</small>
                      </span>
                    </span>
                    <span className="col-num"><em className={`pnl mono ${a.pnlPct >= 0 ? "pnl-up" : "pnl-down"}`}>{signed(a.pnlPct)}</em></span>
                    <span className="mono col-num col-val">{ethTxt(a.nav)}<small> ETH</small></span>
                    <span className="mono col-last">{last ? <><b className={`side ${last.side === "buy" ? "side-buy" : "side-sell"}`}>{last.side.toUpperCase()}</b><span className="sym">{sym(last)}</span><span className="ago">{ago(now - last.time)}</span></> : "—"}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          {feed.feed.length > 0 && (
            <div className="panel-block live-feed">
              <h3>Latest trades, all agents</h3>
              <ol className="trades mono">
                {feed.feed.slice(0, 12).map((t) => (
                  <li key={`${t.tx}-${t.side}`}>
                    <span className="t-ago">{ago(now - t.time)}</span>
                    <b className={t.side === "buy" ? "up" : "down"}>{t.side.toUpperCase()}</b>
                    <span className="t-sym">#{t.agent} · {sym(t)}</span>
                    <span className="t-eth"><a href={`${explorer}/tx/${t.tx}`} target="_blank" rel="noreferrer">{Number(t.eth).toFixed(5)} ETH ↗</a></span>
                    <span className={`t-pnl ${t.pnlPct === undefined ? "" : t.pnlPct >= 0 ? "up" : "down"}`}>{t.pnlPct === undefined ? "" : signed(t.pnlPct)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>

        <section className="detail" aria-label="Agent details">
          {sel && <LiveDetail a={sel} of={feed.agents.length} explorer={explorer} now={now} />}
        </section>
      </div>
    </div>
  );
}

const LIVE_RANGES = ["1H", "6H", "24H", "All"] as const;
function LiveValueChart({ history }: { history: { t: number; v: number }[] }) {
  const [range, setRange] = useState<(typeof LIVE_RANGES)[number]>("24H");
  const span = range === "1H" ? 3600 : range === "6H" ? 21600 : range === "24H" ? 86400 : Infinity;
  const end = history.at(-1)?.t ?? 0;
  const pts = history.filter((h) => end - h.t <= span);
  return (
    <div className="panel-block">
      <div className="lc-head"><h3>Value</h3><RangeTabs value={range} options={LIVE_RANGES} onChange={setRange} /></div>
      <LineChart data={pts.map((h) => h.v)} times={pts.map((h) => h.t * 1000)} height={170} baseline={pts[0]?.v} />
    </div>
  );
}

function LiveDetail({ a, of, explorer, now }: { a: LiveAgent; of: number; explorer: string; now: number }) {
  const winRate = a.closed ? (a.wins / a.closed) * 100 : null;
  return (
    <div className="detail-inner">
      <header className="detail-head">
        <ArtCanvas id={a.id} size={112} />
        <div>
          <p className="eyebrow">Rank {a.rank} of {of}</p>
          <h2>Trencher #{a.id}</h2>
          {a.owner && <p className="mono who-line">Holder {short(a.owner)}</p>}
          <p className="mono who-line">Agent wallet <a href={`${explorer}/address/${a.wallet}`} target="_blank" rel="noreferrer">{short(a.wallet)} ↗</a></p>
          <PnlCardButton data={cardFromLive(a, of)} />
        </div>
      </header>

      <dl className="kpis">
        <div><dt>Value</dt><dd className="mono">{ethTxt(a.nav)} ETH</dd></div>
        <div><dt>PnL this week</dt><dd className={`mono ${a.pnlPct >= 0 ? "up" : "down"}`}>{signed(a.pnlPct)}</dd></div>
        <div><dt>PnL</dt><dd className={`mono ${a.pnlEth >= 0 ? "up" : "down"}`}>{a.pnlEth >= 0 ? "+" : ""}{ethTxt(a.pnlEth)} ETH</dd></div>
        <div><dt>Trades</dt><dd className="mono">{a.trades}</dd></div>
        <div><dt>Win rate</dt><dd className="mono">{winRate === null ? "—" : `${winRate.toFixed(0)}%`}</dd></div>
        <div><dt>Biggest trade</dt><dd className={`mono ${a.biggest ? (a.biggest.pct >= 0 ? "up" : "down") : ""}`}>{a.biggest ? `${signed(a.biggest.pct, 0)} $${a.biggest.symbol}` : "—"}</dd></div>
      </dl>

      <LiveValueChart history={a.history} />

      <div className="panel-block">
        <h3>Strategy · {a.rule ? `rule v${a.ruleVersion}, guided by its holder` : "none yet"}</h3>
        {a.rule ? <blockquote className="guide"><span className="mono">Its rule, as stored on-chain</span>“{a.rule}”</blockquote> : <p className="empty">The holder hasn&apos;t given this agent a rule yet.</p>}
        {a.understood.length > 0 && <div className="tags">{a.understood.map((u) => <span key={u} className="mono">{u}</span>)}</div>}
        {a.ruleWarning && <p className="live-warn">{a.ruleWarning}</p>}
        <p className="hint-line">{a.live ? "Trading is on." : "Trading is paused by its holder."}</p>
      </div>

      <div className="panel-block">
        <h3>Open positions</h3>
        {a.positions.length ? (
          <table className="mini mono">
            <thead><tr><th>Token</th><th>Cost</th><th>Value</th><th>P&amp;L</th></tr></thead>
            <tbody>{a.positions.map((p) => {
              const pnl = p.cost ? ((p.value - p.cost) / p.cost) * 100 : 0;
              return <tr key={p.token}><td>{sym(p)}</td><td>{ethTxt(p.cost)}</td><td>{ethTxt(p.value)}</td><td className={pnl >= 0 ? "up" : "down"}>{signed(pnl)}</td></tr>;
            })}</tbody>
          </table>
        ) : <p className="empty">No open positions. The agent is holding ETH.</p>}
      </div>

      <div className="panel-block">
        <h3>Trades</h3>
        {a.recent.length ? (
          <ol className="trades mono">
            {a.recent.map((t) => (
              <li key={`${t.tx}-${t.side}`}>
                <span className="t-ago">{ago(now - t.time)}</span>
                <b className={t.side === "buy" ? "up" : "down"}>{t.side.toUpperCase()}</b>
                <span className="t-sym">{sym(t)}</span>
                <span className="t-eth"><a href={`${explorer}/tx/${t.tx}`} target="_blank" rel="noreferrer">{Number(t.eth).toFixed(5)} ETH ↗</a></span>
                <span className={`t-pnl ${t.pnlPct === undefined ? "" : t.pnlPct >= 0 ? "up" : "down"}`}>{t.pnlPct === undefined ? "" : signed(t.pnlPct)}</span>
              </li>
            ))}
          </ol>
        ) : <p className="empty">No trades yet.</p>}
      </div>
    </div>
  );
}
