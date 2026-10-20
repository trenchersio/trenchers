"use client";
/**
 * The trading desk: Bitcoin's live price second by second (TradingView Lightweight Charts), and 5-minute rounds.
 * You call the NEXT round up or down before it starts; when it ends, the close is compared with the open.
 */
import { useEffect, useRef, useState } from "react";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { DESK } from "@/lib/trenchies-catalog";
import { Icon } from "./icons";
import type { Call, DeskLog, DeskView } from "./model";

const usd = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "–" : `$${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const mmss = (s: number) => { const x = Math.max(0, Math.ceil(s)); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, "0")}`; };
const hhmm = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);
const KEEP = 15 * 60;

type Chart = import("lightweight-charts").IChartApi;
type Line = import("lightweight-charts").ISeriesApi<"Area">;
type PriceLine = import("lightweight-charts").IPriceLine;

export function DeskPanel({ call, onTicker, onSettled, say }: { call: Call; onTicker: (s: [number, number][]) => void; onSettled: () => void; say: (m: string) => void }) {
  const [v, setV] = useState<DeskView | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState<"up" | "down" | null>(null);
  const [clock, setClock] = useState(() => Date.now() / 1000);
  const box = useRef<HTMLDivElement>(null), chart = useRef<Chart | null>(null), line = useRef<Line | null>(null), openLine = useRef<PriceLine | null>(null);
  const series = useRef<[number, number][]>([]), last = useRef(0), skew = useRef(0), seenLog = useRef<number | null>(null);
  const cb = useRef({ onTicker, onSettled, say }); cb.current = { onTicker, onSettled, say };

  // the chart
  useEffect(() => {
    let alive = true, ro: ResizeObserver | null = null;
    import("lightweight-charts").then(({ createChart, ColorType, LineStyle }) => {
      if (!alive || !box.current) return;
      const css = getComputedStyle(box.current);
      const c = (chart.current = createChart(box.current, {
        height: box.current.clientHeight || 220, width: box.current.clientWidth,
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: css.getPropertyValue("--tg-dim").trim() || "#8fa39a", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, attributionLogo: true },
        grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.05)" } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.15, bottom: 0.1 } },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: true, rightOffset: 6 },
        crosshair: { horzLine: { labelBackgroundColor: "#1d2a24" }, vertLine: { labelBackgroundColor: "#1d2a24" } },
        handleScroll: false, handleScale: false,
        localization: { locale: "en-US", priceFormatter: (p: number) => p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
      }));
      line.current = c.addAreaSeries({ lineColor: "#39ff88", topColor: "rgba(57,255,136,0.28)", bottomColor: "rgba(57,255,136,0)", lineWidth: 2, priceLineColor: "#39ff88", priceLineStyle: LineStyle.Dotted });
      if (series.current.length) line.current.setData(series.current.map(([t, p]) => ({ time: t as import("lightweight-charts").UTCTimestamp, value: p })));
      ro = new ResizeObserver(() => { if (box.current) c.applyOptions({ width: box.current.clientWidth, height: box.current.clientHeight || 220 }); });
      ro.observe(box.current);
    }).catch(() => setErr("The chart couldn't load."));
    return () => { alive = false; ro?.disconnect(); chart.current?.remove(); chart.current = null; line.current = null; openLine.current = null; };
  }, []);

  // prices, once a second
  useEffect(() => {
    let alive = true, t: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const j = (await call("desk", undefined, { since: String(last.current) })) as DeskView;
        if (!alive) return;
        skew.current = j.now - Date.now() / 1000;
        const fresh = j.series.filter(([s]) => s > last.current);
        if (fresh.length) {
          const all = [...series.current, ...fresh], cut = j.now - KEEP;
          series.current = all.filter(([s]) => s >= cut); last.current = fresh[fresh.length - 1][0];
          if (line.current) {
            if (fresh.length > 30 || series.current.length === fresh.length) line.current.setData(series.current.map(([s, p]) => ({ time: s as import("lightweight-charts").UTCTimestamp, value: p })));
            else for (const [s, p] of fresh) line.current.update({ time: s as import("lightweight-charts").UTCTimestamp, value: p });
          }
          cb.current.onTicker(series.current.slice(-300));
        }
        // the open of the running round, as a line across the chart
        if (line.current) {
          if (openLine.current) { line.current.removePriceLine(openLine.current); openLine.current = null; }
          if (j.live.open) openLine.current = line.current.createPriceLine({ price: j.live.open, color: "#ffd84d", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "open" });
        }
        // a round just settled: say how it went
        const top = j.log[0]?.r ?? -1;
        if (seenLog.current !== null && top > seenLog.current && j.log[0]) { const x = j.log[0]; cb.current.say(resultText(x)); cb.current.onSettled(); }
        seenLog.current = top;
        setV(j); setErr(null);
      } catch (e) { if (alive) setErr((e as Error).message); }
      if (alive) t = setTimeout(tick, document.hidden ? 5000 : 1000);
    };
    void tick();
    const c = setInterval(() => setClock(Date.now() / 1000), 250);
    return () => { alive = false; if (t) clearTimeout(t); clearInterval(c); };
  }, [call]);

  const make = async (dir: "up" | "down") => {
    setBusy(dir); setErr(null);
    try { const j = (await call("desk/call", { call: dir, since: last.current })) as DeskView; setV((o) => (o ? { ...j, series: o.series } : j)); }
    catch (e) { setErr((e as Error).message); }
    setBusy(null);
  };

  const now = clock + skew.current;
  const live = v?.live, next = v?.next, price = v?.price ?? null;
  const ch = price !== null && live?.open ? price - live.open : null, chPct = ch !== null && live?.open ? (ch / live.open) * 100 : null;
  const leftLive = live ? live.end - now : 0, total = DESK.round;
  const ahead = live?.call && ch !== null ? (live.call === "up" ? ch > 0 : ch < 0) : null;
  const crowdN = next ? next.crowd.up + next.crowd.down : 0, upShare = crowdN ? next!.crowd.up / crowdN : 0.5;
  return (
    <div className="tg-pp tg-desk">
      <header className="tg-ph"><p className="tg-k">Trading desk</p><h2>Bitcoin: up or down in 5 minutes</h2></header>
      <div className="tg-desk-px">
        <span className="tg-desk-sym"><b>BTC</b><small>USD</small></span>
        <b className="mono tg-desk-price">{usd(price)}</b>
        {chPct !== null && <em className={`mono ${ch! >= 0 ? "up" : "down"}`}>{ch! >= 0 ? "+" : ""}{usd(ch, 2).replace("$-", "-$")} · {chPct >= 0 ? "+" : ""}{chPct.toFixed(3)}%</em>}
      </div>
      <div className="tg-desk-chart" ref={box}>{!v && <p className="tg-sub">Connecting to the live price…</p>}</div>

      <div className="tg-desk-rounds">
        <section className={`tg-round live${ahead === true ? " ahead" : ahead === false ? " behind" : ""}`}>
          <p className="tg-k">Running · {live ? hhmm(live.start) : "–"} to {live ? hhmm(live.end) : "–"} UTC</p>
          <div className="tg-round-row"><span>Open <b className="mono">{usd(live?.open)}</b></span><span className="mono tg-round-left">{mmss(leftLive)}</span></div>
          <span className="tg-round-bar"><i style={{ width: `${Math.min(100, Math.max(0, (1 - leftLive / total) * 100))}%` }} /></span>
          <p className="tg-round-you">{live?.call ? <>You called <b className={live.call}>{live.call === "up" ? "UP" : "DOWN"}</b>{ahead !== null && <> · {ahead ? "winning right now" : ch === 0 ? "level" : "losing right now"}</>}</> : "You have no call on this round."}</p>
        </section>
        <section className="tg-round next">
          <p className="tg-k">Next round · starts in <span className="mono">{mmss(next ? next.start - now : 0)}</span></p>
          <div className="tg-updown">
            <button type="button" className={`tg-ud up${next?.call === "up" ? " on" : ""}`} disabled={!!busy || !price} onClick={() => void make("up")}><Icon n="up" size={22} /><b>Up</b><small>{next?.call === "up" ? "your call" : "higher close"}</small></button>
            <button type="button" className={`tg-ud down${next?.call === "down" ? " on" : ""}`} disabled={!!busy || !price} onClick={() => void make("down")}><Icon n="down" size={22} /><b>Down</b><small>{next?.call === "down" ? "your call" : "lower close"}</small></button>
          </div>
          <div className="tg-crowd" title="How everyone has called the next round"><span className="up" style={{ width: `${upShare * 100}%` }} /><span className="down" /></div>
          <p className="tg-fine tg-crowd-t"><span>{next?.crowd.up ?? 0} up</span><span>{crowdN ? "the crowd" : "no calls yet"}</span><span>{next?.crowd.down ?? 0} down</span></p>
        </section>
      </div>
      {err && <p className="tg-err">{err}</p>}

      <dl className="tg-kpis tg-desk-kpis">
        <div><dt>Streak</dt><dd>{v?.streak ?? 0}</dd></div><div><dt>Best</dt><dd>{v?.best ?? 0}</dd></div>
        <div><dt>Paid calls left today</dt><dd>{v?.paidLeft ?? DESK.paidPerDay}</dd></div>
      </dl>
      <p className="tg-sub">A right call pays <b>+{DESK.win.xp} XP</b> and <b>+{DESK.win.coins} coins</b>, plus <b>+{DESK.streak.coins}</b> of each per win in a row (up to {DESK.streak.max}), and <b>+{DESK.crowd.coins}</b> more when you beat the crowd. Every call counts +{DESK.play.xp} XP.</p>

      <section className="tg-box">
        <h3><Icon n="clock" size={13} /> Your calls</h3>
        {!v || v.log.length === 0 ? <p className="tg-sub">No calls settled yet. Call the next round above.</p> : (
          <ol className="tg-desk-log">{v.log.map((x) => (
            <li key={x.r} className={x.result}>
              <span className="mono">{hhmm(x.r * DESK.round)}</span>
              <b className={x.call}>{x.call === "up" ? "Up" : "Down"}</b>
              <small className="mono">{usd(x.open, 0)} → {usd(x.close, 0)}</small>
              <em>{x.result === "win" ? `+${x.xp} XP · +${x.coins}` : x.result === "loss" ? (x.xp ? `+${x.xp} XP` : "missed") : x.result === "push" ? "level" : "no price"}</em>
            </li>))}</ol>
        )}
      </section>
      <section className="tg-box">
        <h3><Icon n="ranks" size={13} /> Best traders</h3>
        {!v || v.top.length === 0 ? <p className="tg-sub">Nobody has won a call yet. Be the first.</p> : (
          <ol className="tg-board">{v.top.map((p) => <li key={p.name}><div className="tg-board-row"><span className={`tg-rk${p.rank <= 3 ? " top" : ""}`}>{p.rank}</span><ArtCanvas id={p.nft} size={24} /><span className="tg-bn"><b>{p.name}</b><small>best streak {p.best}</small></span><em className="mono">{p.wins} won</em></div></li>)}</ol>
        )}
      </section>
      <p className="tg-fine">Prices are BTC-USD from Coinbase ({v?.feed ?? "starting"}). A round is won when the price at its close is above (Up) or below (Down) the price at its open. Calls lock when the round starts. The first {DESK.paidPerDay} settled calls each UTC day pay coins. Chart by <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a> Lightweight Charts.</p>
    </div>
  );
}

export function resultText(x: DeskLog) {
  const t = hhmm(x.r * DESK.round);
  if (x.result === "win") return `${t} round: you called it${x.crowd ? " against the crowd" : ""}. +${x.xp} XP, +${x.coins} coins`;
  if (x.result === "loss") return `${t} round: Bitcoin went the other way${x.xp ? ` (+${x.xp} XP for playing)` : ""}`;
  if (x.result === "push") return `${t} round closed level`;
  return `${t} round had no price, so it doesn't count`;
}
