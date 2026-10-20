import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Weekly Arena recap: once a week (Monday 00:00 UTC) the finished week's leaderboard is saved for good:
 * the top 3, the best single trade, the biggest comeback and the most active agent.
 * Built from the Arena data the site already reads (no extra chain reads). Kept next to the chat
 * (e.g. /data/recaps.json), or wherever RECAP_FILE says.
 */
type Row = { id: number; rank: number; pnlPct: number; pnlEth: number; nav: number; trades: number; wins: number; closed: number; biggest: { symbol: string; pct: number } | null; history: { t: number; v: number }[] };
type Arena = { updatedAt: number; agents: Row[] };
export type RecapWeek = {
  week: string; start: number; end: number; agents: number; trading: number; trades: number;
  top: { id: number; pnlPct: number; pnlEth: number; trades: number }[];
  bestTrade: { id: number; symbol: string; pct: number } | null;
  comeback: { id: number; lowPct: number; endPct: number } | null;
  mostActive: { id: number; trades: number } | null;
  winRate: { id: number; pct: number; closed: number } | null;
  /** Every agent's place that week (for the weekly report and badges). */
  ranks?: { id: number; rank: number; pnlPct: number; trades: number; best: { symbol: string; pct: number } | null }[];
};

const DAY = 86400, WEEK = 7 * DAY;
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const FILE = clean(process.env.RECAP_FILE) || `${dirname(clean(process.env.CHAT_FILE) || "./chat.json")}/recaps.json`;
/** Monday 00:00 UTC of the week that contains `t` (seconds). 1970-01-01 was a Thursday. */
export const weekStart = (t: number) => Math.floor((t - 4 * DAY) / WEEK) * WEEK + 4 * DAY;
/** Only snapshot within this long after the week ends: later, the rolling leaderboard has moved on too far. */
const GRACE = 6 * 3600;

export function summarize(a: Arena, start: number): RecapWeek {
  const end = start + WEEK;
  const active = a.agents.filter((r) => r.trades > 0);
  const top = [...active].sort((x, y) => y.pnlPct - x.pnlPct).slice(0, 3).map((r) => ({ id: r.id, pnlPct: +r.pnlPct.toFixed(2), pnlEth: +r.pnlEth.toFixed(6), trades: r.trades }));
  const bt = a.agents.filter((r) => r.biggest && r.biggest.pct > 0).sort((x, y) => y.biggest!.pct - x.biggest!.pct)[0];
  let comeback: RecapWeek["comeback"] = null, best = 0;
  for (const r of active) {
    const h = r.history; if (h.length < 3) continue;
    const startV = [...h].reverse().find((p) => p.t <= start)?.v ?? h[0].v;
    if (!(startV > 0)) continue;
    const low = Math.min(...h.filter((p) => p.t >= start).map((p) => p.v));
    const lowPct = ((low - startV) / startV) * 100;
    if (lowPct > -5 || r.pnlPct <= 0) continue;
    const score = r.pnlPct - lowPct;
    if (score > best) { best = score; comeback = { id: r.id, lowPct: +lowPct.toFixed(1), endPct: +r.pnlPct.toFixed(1) }; }
  }
  const ma = [...active].sort((x, y) => y.trades - x.trades)[0];
  const wr = active.filter((r) => r.closed >= 5).sort((x, y) => y.wins / y.closed - x.wins / x.closed)[0];
  return {
    week: new Date(start * 1000).toISOString().slice(0, 10), start, end,
    agents: a.agents.length, trading: active.length, trades: a.agents.reduce((s, r) => s + r.trades, 0),
    top, bestTrade: bt ? { id: bt.id, symbol: bt.biggest!.symbol, pct: +bt.biggest!.pct.toFixed(1) } : null,
    comeback, mostActive: ma ? { id: ma.id, trades: ma.trades } : null,
    winRate: wr ? { id: wr.id, pct: Math.round((wr.wins / wr.closed) * 100), closed: wr.closed } : null,
    ranks: [...a.agents].sort((x, y) => y.pnlPct - x.pnlPct).map((r, i) => ({ id: r.id, rank: i + 1, pnlPct: +r.pnlPct.toFixed(2), trades: r.trades, best: r.biggest ? { symbol: r.biggest.symbol, pct: +r.biggest.pct.toFixed(1) } : null })),
  };
}

export class Recaps {
  weeks: RecapWeek[] = [];
  /** Called once when a week's recap is saved (the weekly report). */
  onSaved: ((week: RecapWeek, previous: RecapWeek | null) => void) | null = null;
  /** Per Trencher: weeks in the top 10, on the podium, won, and comebacks (for badges). */
  honors() {
    const m = new Map<number, { weeks: number; top10: number; podium: number; won: number; comeback: number }>();
    const h = (id: number) => { let x = m.get(id); if (!x) m.set(id, (x = { weeks: 0, top10: 0, podium: 0, won: 0, comeback: 0 })); return x; };
    for (const w of this.weeks) {
      for (const r of w.ranks ?? []) if (r.trades > 0) { const x = h(r.id); x.weeks++; if (r.rank <= 10) x.top10++; }
      w.top.forEach((t, i) => { const x = h(t.id); if (!w.ranks) x.top10++; x.podium++; if (i === 0) x.won++; });
      if (w.comeback) h(w.comeback.id).comeback++;
    }
    return m;
  }
  constructor(private log: (m: string) => void) {
    try { if (existsSync(FILE)) this.weeks = (JSON.parse(readFileSync(FILE, "utf8")) as { weeks: RecapWeek[] }).weeks ?? []; } catch { /* start empty */ }
  }
  private save() {
    try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(`${FILE}.tmp`, JSON.stringify({ weeks: this.weeks })); renameSync(`${FILE}.tmp`, FILE); } catch { /* keep in memory */ }
  }
  /** Called every minute with the (cached) Arena: saves last week's recap once, right after the week ends. */
  async check(arena: () => Promise<Arena>, now = Date.now() / 1000) {
    const start = weekStart(now) - WEEK; // the week that just ended
    if (now - (start + WEEK) > GRACE || this.weeks.some((w) => w.start === start)) return;
    const a = await arena();
    if (!a?.agents?.length) return;
    const r = summarize(a, start);
    this.weeks.unshift(r); this.weeks.sort((x, y) => y.start - x.start); this.weeks = this.weeks.slice(0, 104);
    this.save();
    try { this.onSaved?.(r, this.weeks.find((w) => w.start === start - WEEK) ?? null); } catch { /* the report must not block the recap */ }
    this.log(`Recap: week of ${r.week} saved (${r.trades} trades, top #${r.top[0]?.id ?? "none"})`);
  }
  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (path !== "/recaps") return false;
    res.setHeader("cache-control", "public, max-age=300");
    res.end(JSON.stringify({ weeks: this.weeks.map(({ ranks, ...w }) => w), nextAt: (weekStart(Date.now() / 1000) + WEEK) * 1000 }));
    return true;
  }
}
