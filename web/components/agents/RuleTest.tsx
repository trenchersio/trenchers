"use client";
import { useEffect, useState } from "react";
import { ENGINE_URL } from "@/lib/constants";

type T = { symbol: string; token: string; in: number; out: number; pct: number; why: string; open: boolean };
type R = { ok: true; rule: string; from: number; to: number; coins: number; trades: number; wins: number; losses: number; open: number; winRate: number; avgPct: number; pnlEth: number; size: number; best: T | null; worst: T | null; sample: T[]; notes: string[] } | { ok: false; error: string };
const signed = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
const day = (t: number) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * "Test on last week": replays a rule over the last 7 days of Pons coins (the engine's /backtest) and shows how it
 * would have done. `auto` runs it straight away; otherwise it waits for the button.
 */
export function RuleTest({ rule, size = 0.01, auto = false, label = "Test on last week" }: { rule: string; size?: number; auto?: boolean; label?: string }) {
  const [res, setRes] = useState<R | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const r = await fetch(`${ENGINE_URL}/backtest?rule=${encodeURIComponent(rule)}&size=${size}`); setRes((await r.json()) as R); }
    catch { setRes({ ok: false, error: "Couldn't reach the trading engine. Try again in a moment." }); }
    setBusy(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setRes(null); if (auto && rule.trim()) void run(); }, [rule, auto]);
  if (!res) return <button type="button" className="gf-btn ghost rt-btn" onClick={run} disabled={busy || !rule.trim()}>{busy ? "Testing on last week…" : label}</button>;
  if (!res.ok) return <div className="rt rt-err"><p>{res.error}</p><button type="button" className="linkish" onClick={() => setRes(null)}>Close</button></div>;
  return (
    <div className="rt">
      <div className="rt-head">
        <p className="mono rt-k">Replayed on {day(res.from)} to {day(res.to)} · {res.coins.toLocaleString("en-US")} Pons coins</p>
        <button type="button" className="linkish" onClick={() => setRes(null)}>Close</button>
      </div>
      {res.trades === 0 ? <p className="rt-none">This rule wouldn&apos;t have bought anything last week.</p> : (<>
        <dl className="rt-kpis">
          <div><dt>Trades</dt><dd className="mono">{res.trades}</dd></div>
          <div><dt>Win rate</dt><dd className="mono">{res.winRate}%</dd></div>
          <div><dt>Avg per trade</dt><dd className={`mono ${res.avgPct >= 0 ? "up" : "down"}`}>{signed(res.avgPct)}</dd></div>
          <div><dt>At {res.size} ETH a trade</dt><dd className={`mono ${res.pnlEth >= 0 ? "up" : "down"}`}>{res.pnlEth >= 0 ? "+" : ""}{res.pnlEth.toFixed(4)} ETH</dd></div>
        </dl>
        {res.best && <p className="rt-line mono">Best <b className="up">{signed(res.best.pct, 0)} ${res.best.symbol}</b>{res.worst && res.worst !== res.best ? <> · worst <b className={res.worst.pct >= 0 ? "up" : "down"}>{signed(res.worst.pct, 0)} ${res.worst.symbol}</b></> : null}{res.open ? ` · ${res.open} still open` : ""}</p>}
        <ol className="rt-list mono">
          {res.sample.slice(0, 6).map((t) => <li key={`${t.token}-${t.in}`}><span>{day(t.in)}</span><span>${t.symbol}</span><span>{t.open ? "open" : t.why}</span><b className={t.pct >= 0 ? "up" : "down"}>{signed(t.pct)}</b></li>)}
        </ol>
      </>)}
      <p className="rt-note">A replay of last week, not a promise: real trades also pay price impact and can miss entries. {res.notes.join(" ")}</p>
    </div>
  );
}
