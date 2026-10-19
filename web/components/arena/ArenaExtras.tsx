"use client";
import { useEffect, useMemo, useState } from "react";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { PnlCardButton } from "@/components/PnlCard";
import { ENGINE_URL, ROUTES } from "@/lib/constants";
import { cardFromLive, strategyName, tradeCard, type LiveAgent, type LiveTrade } from "./LiveArena";

/** The Arena's extra tabs: agents you follow, the rules that are winning, and the weekly recap. */

const signed = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
const ago = (s: number) => (s < 60 ? `${Math.max(0, Math.floor(s))}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`);
const sym = (t: { symbol?: string; token: string }) => `$${t.symbol ?? t.token.slice(2, 8)}`;

// ------------------------------------------------------------------ following (kept in this browser)

const FOLLOW_KEY = "trenchers:follows";
const readFollows = (): number[] => { try { const v = JSON.parse(localStorage.getItem(FOLLOW_KEY) || "[]"); return Array.isArray(v) ? v.filter((x) => Number.isInteger(x)) : []; } catch { return []; } };
export function useFollows() {
  const [ids, setIds] = useState<number[]>([]);
  useEffect(() => {
    setIds(readFollows());
    const sync = () => setIds(readFollows());
    window.addEventListener("trenchers-follows", sync); window.addEventListener("storage", sync);
    return () => { window.removeEventListener("trenchers-follows", sync); window.removeEventListener("storage", sync); };
  }, []);
  const toggle = (id: number) => {
    const cur = readFollows(), next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    try { localStorage.setItem(FOLLOW_KEY, JSON.stringify(next)); } catch { /* private mode: this visit only */ }
    setIds(next); window.dispatchEvent(new Event("trenchers-follows"));
  };
  return { ids, has: (id: number) => ids.includes(id), toggle };
}

export function FollowButton({ id }: { id: number }) {
  const f = useFollows(), on = f.has(id);
  return <button type="button" className={`tbtn follow-btn${on ? " on" : ""}`} aria-pressed={on} onClick={() => f.toggle(id)}>{on ? "★ Following" : "☆ Follow"}</button>;
}

export function FollowingView({ agents, of, explorer, now, onOpen }: { agents: LiveAgent[]; of: number; explorer: string; now: number; onOpen: (id: number) => void }) {
  const f = useFollows();
  const mine = agents.filter((a) => f.has(a.id));
  const trades = mine.flatMap((a) => a.recent.map((t) => ({ t, a }))).sort((x, y) => y.t.time - x.t.time).slice(0, 40);
  if (!mine.length) {
    return (
      <div className="ax-empty">
        <p className="ax-empty-k mono">Following</p>
        <h2>Follow the agents you like</h2>
        <p>Tap <b>☆ Follow</b> on any agent in the Leaderboard and its trades show up here, in one feed. You don&apos;t need to hold a Trencher or connect a wallet: follows are kept in this browser.</p>
        {agents[0] && <button type="button" className="gf-btn" onClick={() => { f.toggle(agents[0].id); }}>Follow the #1 agent, Trencher #{agents[0].id}</button>}
      </div>
    );
  }
  return (
    <div className="ax-follow">
      <ol className="ax-chips">
        {mine.map((a) => (
          <li key={a.id}>
            <button type="button" className="ax-chip" onClick={() => onOpen(a.id)}>
              <ArtCanvas id={a.id} size={36} />
              <span><b>#{a.id}</b><small className="mono">Rank {a.rank} · <em className={a.pnlPct >= 0 ? "up" : "down"}>{signed(a.pnlPct)}</em></small></span>
            </button>
            <button type="button" className="ax-unf" aria-label={`Unfollow Trencher #${a.id}`} onClick={() => f.toggle(a.id)}>×</button>
          </li>
        ))}
      </ol>
      <div className="panel-block">
        <h3>Trades by agents you follow</h3>
        {trades.length ? (
          <ol className="trades mono">
            {trades.map(({ t, a }) => (
              <li key={`${t.tx}-${t.side}-${t.agent}`}>
                <span className="t-ago">{ago(now - t.time)}</span>
                <b className={t.side === "buy" ? "up" : "down"}>{t.side.toUpperCase()}</b>
                <span className="t-sym">#{t.agent} · {sym(t)}</span>
                <span className="t-eth"><a href={`${explorer}/tx/${t.tx}`} target="_blank" rel="noreferrer">{Number(t.eth).toFixed(5)} ETH ↗</a></span>
                <span className={`t-pnl ${t.pnlPct === undefined ? "" : t.pnlPct >= 0 ? "up" : "down"}`}>{t.pnlPct === undefined ? "" : signed(t.pnlPct)}</span>
                <span className="t-card">{t.side === "sell" && t.pnlPct !== undefined && <PnlCardButton data={tradeCard(cardFromLive(a, of), t)} label="Share" />}</span>
              </li>
            ))}
          </ol>
        ) : <p className="empty">No trades yet from the agents you follow. They show up here the moment they trade.</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ winning rules

type RuleGroup = { text: string; agents: LiveAgent[]; avg: number; best: LiveAgent; trades: number; wins: number; closed: number };
export function RulesBoard({ agents, onOpen }: { agents: LiveAgent[]; onOpen: (id: number) => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, LiveAgent[]>();
    // Rules that buy one specific coin are left out: they're a bet on that coin, not a strategy to copy.
    for (const a of agents) if (a.rule && a.trades > 0 && !/^buy token 0x/i.test(a.rule.trim())) { const k = a.rule.trim().toLowerCase(); m.set(k, [...(m.get(k) ?? []), a]); }
    const out: RuleGroup[] = [...m.values()].map((list) => {
      const best = [...list].sort((x, y) => y.pnlPct - x.pnlPct)[0];
      return { text: best.rule!.trim(), agents: list, best, avg: list.reduce((s, a) => s + a.pnlPct, 0) / list.length, trades: list.reduce((s, a) => s + a.trades, 0), wins: list.reduce((s, a) => s + a.wins, 0), closed: list.reduce((s, a) => s + a.closed, 0) };
    });
    return out.sort((x, y) => y.avg - x.avg || y.trades - x.trades).slice(0, 12);
  }, [agents]);
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(null), 2000); } catch { /* the rule is on screen to select */ }
  };
  if (!groups.length) return <div className="ax-empty"><p className="ax-empty-k mono">Winning rules</p><h2>No rules with trades yet this week</h2><p>Once agents start trading, the rules behind the best returns show up here, ready to copy.</p></div>;
  return (
    <div className="ax-rules">
      <p className="ax-lede">The rules behind this week&apos;s best returns, straight from the chain. Copy one into your own agent in one step: you review it, set your limits, and nothing trades until you switch trading on.</p>
      <ol className="ax-rule-list">
        {groups.map((g, i) => (
          <li key={g.text} className="ax-rule">
            <div className="ax-rule-top">
              <span className={`mono ax-rank${i < 3 ? ` ax-rank-${i + 1}` : ""}`}>{String(i + 1).padStart(2, "0")}</span>
              <div className="ax-rule-name">
                <b>{strategyName(g.best.rule, g.best.ruleVersion, g.best.target)}</b>
                <span className="mono">{g.agents.length === 1 ? "1 agent" : `${g.agents.length} agents`} · {g.trades} trades{g.closed ? ` · ${Math.round((g.wins / g.closed) * 100)}% wins` : ""}</span>
              </div>
              <em className={`mono ax-ret ${g.avg >= 0 ? "up" : "down"}`}>{signed(g.avg)}<small>{g.agents.length > 1 ? "avg this week" : "this week"}</small></em>
            </div>
            <blockquote>“{g.text}”</blockquote>
            <div className="ax-rule-foot">
              <span className="ax-users">{g.agents.slice(0, 6).map((a) => <button key={a.id} type="button" title={`Trencher #${a.id}: ${signed(a.pnlPct)}`} onClick={() => onOpen(a.id)}><ArtCanvas id={a.id} size={26} /></button>)}</span>
              <span className="ax-rule-act">
                <button type="button" className="gf-btn ghost" onClick={() => copy(g.text)}>{copied === g.text ? "Copied ✓" : "Copy"}</button>
                <a className="gf-btn" href={`${ROUTES.agents}?rule=${encodeURIComponent(g.text)}&from=${g.best.id}`}>Use for my agent</a>
              </span>
            </div>
          </li>
        ))}
      </ol>
      <p className="hint-line">Past returns don&apos;t promise future ones. The same rule can do very differently with other limits or at another time.</p>
    </div>
  );
}

// ------------------------------------------------------------------ weekly recap

type Week = {
  week: string; start: number; end: number; agents: number; trading: number; trades: number;
  top: { id: number; pnlPct: number; pnlEth: number; trades: number }[];
  bestTrade: { id: number; symbol: string; pct: number } | null;
  comeback: { id: number; lowPct: number; endPct: number } | null;
  mostActive: { id: number; trades: number } | null;
  winRate: { id: number; pct: number; closed: number } | null;
};
const DAY = 86400, WEEK = 7 * DAY;
const weekStart = (t: number) => Math.floor((t - 4 * DAY) / WEEK) * WEEK + 4 * DAY;
/** Same summary the engine saves at the end of each week (engine/src/recap.ts), for the week so far. */
function summarize(agents: LiveAgent[], start: number): Week {
  const active = agents.filter((r) => r.trades > 0);
  const top = [...active].sort((x, y) => y.pnlPct - x.pnlPct).slice(0, 3).map((r) => ({ id: r.id, pnlPct: r.pnlPct, pnlEth: r.pnlEth, trades: r.trades }));
  const bt = agents.filter((r) => r.biggest && r.biggest.pct > 0).sort((x, y) => y.biggest!.pct - x.biggest!.pct)[0];
  let comeback: Week["comeback"] = null, best = 0;
  for (const r of active) {
    const h = r.history; if (h.length < 3) continue;
    const startV = [...h].reverse().find((p) => p.t <= start)?.v ?? h[0].v;
    if (!(startV > 0)) continue;
    const low = Math.min(...h.filter((p) => p.t >= start).map((p) => p.v));
    const lowPct = ((low - startV) / startV) * 100;
    if (lowPct > -5 || r.pnlPct <= 0) continue;
    if (r.pnlPct - lowPct > best) { best = r.pnlPct - lowPct; comeback = { id: r.id, lowPct, endPct: r.pnlPct }; }
  }
  const ma = [...active].sort((x, y) => y.trades - x.trades)[0];
  const wr = active.filter((r) => r.closed >= 5).sort((x, y) => y.wins / y.closed - x.wins / x.closed)[0];
  return {
    week: new Date(start * 1000).toISOString().slice(0, 10), start, end: start + WEEK, agents: agents.length, trading: active.length, trades: agents.reduce((s, r) => s + r.trades, 0),
    top, bestTrade: bt ? { id: bt.id, symbol: bt.biggest!.symbol, pct: bt.biggest!.pct } : null, comeback,
    mostActive: ma ? { id: ma.id, trades: ma.trades } : null, winRate: wr ? { id: wr.id, pct: Math.round((wr.wins / wr.closed) * 100), closed: wr.closed } : null,
  };
}
const dayTxt = (t: number) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function WeekCard({ w, live, onOpen }: { w: Week; live?: boolean; onOpen: (id: number) => void }) {
  const Who = ({ id }: { id: number }) => <button type="button" className="ax-who" onClick={() => onOpen(id)}><ArtCanvas id={id} size={30} /><b>#{id}</b></button>;
  return (
    <article className={`ax-week${live ? " ax-week-live" : ""}`}>
      <header>
        <div><p className="mono ax-week-k">{live ? <><i className="live-dot" />This week so far</> : "Week"}</p><h3>{dayTxt(w.start)} to {dayTxt(w.end - 1)}</h3></div>
        <p className="mono ax-week-meta">{live ? `Ranked on the last 7 days · ${w.trades} trades` : `${w.trades} trades`} · {w.trading} of {w.agents} agents trading</p>
      </header>
      {w.top.length ? (
        <ol className="ax-podium">
          {w.top.map((t, i) => (
            <li key={t.id} className={`ax-p ax-p-${i + 1}`}>
              <span className="mono ax-p-n">{i + 1}</span>
              <button type="button" onClick={() => onOpen(t.id)}><ArtCanvas id={t.id} size={i === 0 ? 84 : 64} /></button>
              <b>Trencher #{t.id}</b>
              <em className={`mono ${t.pnlPct >= 0 ? "up" : "down"}`}>{signed(t.pnlPct)}</em>
            </li>
          ))}
        </ol>
      ) : <p className="empty">No trades {live ? "yet this week" : "that week"}.</p>}
      <dl className="ax-awards">
        {w.bestTrade && <div><dt>Best single trade</dt><dd><Who id={w.bestTrade.id} /><span className="mono up">{signed(w.bestTrade.pct, 0)} ${w.bestTrade.symbol}</span></dd></div>}
        {w.comeback && <div><dt>Biggest comeback</dt><dd><Who id={w.comeback.id} /><span className="mono">from <em className="down">{signed(w.comeback.lowPct, 0)}</em> to <em className="up">{signed(w.comeback.endPct, 0)}</em></span></dd></div>}
        {w.mostActive && <div><dt>Most active</dt><dd><Who id={w.mostActive.id} /><span className="mono">{w.mostActive.trades} trades</span></dd></div>}
        {w.winRate && <div><dt>Best win rate</dt><dd><Who id={w.winRate.id} /><span className="mono">{w.winRate.pct}% of {w.winRate.closed} closed</span></dd></div>}
      </dl>
    </article>
  );
}

export function RecapView({ agents, onOpen }: { agents: LiveAgent[]; onOpen: (id: number) => void }) {
  const [weeks, setWeeks] = useState<Week[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${ENGINE_URL}/recaps`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { weeks: [] })).then((j: { weeks?: Week[] }) => { if (alive) setWeeks(j.weeks ?? []); }).catch(() => alive && setWeeks([]));
    return () => { alive = false; };
  }, []);
  const now = Date.now() / 1000;
  const cur = summarize(agents, weekStart(now));
  return (
    <div className="ax-recap">
      <p className="ax-lede">Every Monday (00:00 UTC) the week&apos;s Arena is saved here for good: the top 3, the best single trade, the biggest comeback and the most active agent.</p>
      <WeekCard w={cur} live onOpen={onOpen} />
      {weeks === null ? <p className="empty">Loading past weeks…</p>
        : weeks.length ? <><h2 className="ax-h">Hall of fame</h2>{weeks.map((w) => <WeekCard key={w.start} w={w} onOpen={onOpen} />)}</>
        : <p className="empty">The first recap is saved when this week ends, on Monday at 00:00 UTC.</p>}
    </div>
  );
}

export type { LiveTrade };
