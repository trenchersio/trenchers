"use client";
/**
 * The trading terminal: Bitcoin's live price (TradingView Lightweight Charts) as candles or a line, with your calls
 * marked on the chart, an order ticket for the next 5-minute round, the running round, your calls and the best traders.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { DESK } from "@/lib/trenchies-catalog";
import { Icon } from "./icons";
import type { Call, DeskLog, DeskView } from "./model";

type LC = typeof import("lightweight-charts");
type Chart = import("lightweight-charts").IChartApi;
type Area = import("lightweight-charts").ISeriesApi<"Area">;
type Candles = import("lightweight-charts").ISeriesApi<"Candlestick">;
type PriceLine = import("lightweight-charts").IPriceLine;
type T = import("lightweight-charts").UTCTimestamp;
type Bar = { time: T; open: number; high: number; low: number; close: number };

const KEEP = 30 * 60;
const TFS = [{ s: 1, l: "1s" }, { s: 5, l: "5s" }, { s: 15, l: "15s" }, { s: 60, l: "1m" }] as const;
const UP = "#2fd27a", DOWN = "#f0516a";
const px = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "–" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const sgn = (v: number, d = 2) => `${v >= 0 ? "+" : "−"}${px(Math.abs(v), d)}`;
const mmss = (s: number) => { const x = Math.max(0, Math.ceil(s)); return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
const hms = (t: number) => new Date(t * 1000).toISOString().slice(11, 19);
const hhmm = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);

/** Seconds into candles of `tf` seconds. */
function bars(series: [number, number][], tf: number): Bar[] {
  const out: Bar[] = [];
  for (const [t, p] of series) {
    const b = (Math.floor(t / tf) * tf) as T, last = out[out.length - 1];
    if (last && last.time === b) { last.high = Math.max(last.high, p); last.low = Math.min(last.low, p); last.close = p; }
    else out.push({ time: b, open: last ? last.close : p, high: Math.max(p, last?.close ?? p), low: Math.min(p, last?.close ?? p), close: p });
  }
  return out;
}

export function Terminal({ call, onTicker, onSettled, say, max, onMax, onClose }: {
  call: Call; onTicker: (s: [number, number][]) => void; onSettled: () => void; say: (m: string) => void;
  max: boolean; onMax?: () => void; onClose: () => void;
}) {
  const [v, setV] = useState<DeskView | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState<"up" | "down" | null>(null);
  const [clock, setClock] = useState(() => Date.now() / 1000), [tf, setTf] = useState(5), [tab, setTab] = useState<"calls" | "top" | "rules">("calls");
  const [flash, setFlash] = useState<"up" | "down" | null>(null), [ready, setReady] = useState(false);
  const box = useRef<HTMLDivElement>(null), chart = useRef<Chart | null>(null), area = useRef<Area | null>(null), candles = useRef<Candles | null>(null), openLine = useRef<PriceLine | null>(null), lc = useRef<LC | null>(null);
  const series = useRef<[number, number][]>([]), last = useRef(0), skew = useRef(0), seenLog = useRef<number | null>(null), prev = useRef<number | null>(null), tfRef = useRef(tf);
  const cb = useRef({ onTicker, onSettled, say }); cb.current = { onTicker, onSettled, say };
  const view = useRef<DeskView | null>(null);

  /** Redraws the whole chart (on load and when the timeframe changes). */
  const redraw = () => {
    if (!area.current || !candles.current) return;
    const s = series.current, t = tfRef.current;
    area.current.applyOptions({ visible: t === 1 }); candles.current.applyOptions({ visible: t !== 1 });
    if (t === 1) { area.current.setData(s.map(([x, p]) => ({ time: x as T, value: p }))); candles.current.setData([]); }
    else { candles.current.setData(bars(s, t)); area.current.setData([]); }
    marks();
  };
  /** Your calls as arrows at the start of each round. */
  const marks = () => {
    const j = view.current, t = tfRef.current, ser = t === 1 ? area.current : candles.current; if (!j || !ser || !series.current.length) return;
    const first = series.current[0][0];
    const list = [...j.log.map((x) => ({ r: x.r, call: x.call, res: x.result as string })), ...(j.live.call ? [{ r: j.live.round, call: j.live.call, res: "live" }] : [])]
      .filter((x) => x.r * DESK.round >= first).sort((a, b) => a.r - b.r)
      .map((x) => ({ time: (Math.floor((x.r * DESK.round) / t) * t) as T, position: x.call === "up" ? "belowBar" as const : "aboveBar" as const, shape: x.call === "up" ? "arrowUp" as const : "arrowDown" as const,
        color: x.res === "win" ? UP : x.res === "loss" ? DOWN : x.res === "live" ? "#ffd84d" : "#8a948f", text: x.res === "win" ? "won" : x.res === "loss" ? "lost" : x.res === "live" ? "you" : "" }));
    ser.setMarkers(list);
  };

  // the chart
  useEffect(() => {
    let alive = true, ro: ResizeObserver | null = null;
    import("lightweight-charts").then((L) => {
      if (!alive || !box.current) return;
      lc.current = L;
      const c = (chart.current = L.createChart(box.current, {
        width: box.current.clientWidth, height: Math.max(160, box.current.clientHeight),
        layout: { background: { type: L.ColorType.Solid, color: "transparent" }, textColor: "#7d8a84", fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, attributionLogo: true },
        grid: { vertLines: { color: "rgba(255,255,255,0.035)" }, horzLines: { color: "rgba(255,255,255,0.045)" } },
        rightPriceScale: { borderColor: "rgba(255,255,255,0.08)", scaleMargins: { top: 0.12, bottom: 0.08 } },
        timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: true, rightOffset: 8, barSpacing: 7 },
        crosshair: { mode: L.CrosshairMode.Normal, horzLine: { color: "rgba(255,255,255,.25)", labelBackgroundColor: "#26302b" }, vertLine: { color: "rgba(255,255,255,.25)", labelBackgroundColor: "#26302b" } },
        localization: { locale: "en-US", priceFormatter: (p: number) => px(p) },
      }));
      area.current = c.addAreaSeries({ lineColor: UP, topColor: "rgba(47,210,122,0.22)", bottomColor: "rgba(47,210,122,0)", lineWidth: 2, priceLineColor: UP, priceLineStyle: L.LineStyle.Dotted, lastPriceAnimation: L.LastPriceAnimationMode.Continuous });
      candles.current = c.addCandlestickSeries({ upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, priceLineStyle: L.LineStyle.Dotted });
      redraw(); setReady(true);
      ro = new ResizeObserver(() => { if (box.current) c.applyOptions({ width: box.current.clientWidth, height: Math.max(160, box.current.clientHeight) }); });
      ro.observe(box.current);
    }).catch(() => setErr("The chart couldn't load."));
    return () => { alive = false; ro?.disconnect(); chart.current?.remove(); chart.current = null; area.current = null; candles.current = null; openLine.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { tfRef.current = tf; redraw(); chart.current?.timeScale().scrollToRealTime(); }, [tf]); // eslint-disable-line react-hooks/exhaustive-deps

  // prices, once a second
  useEffect(() => {
    let alive = true, t: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const j = (await call("desk", undefined, { since: String(last.current) })) as DeskView;
        if (!alive) return;
        skew.current = j.now - Date.now() / 1000; view.current = j;
        const fresh = j.series.filter(([s]) => s > last.current);
        if (fresh.length) {
          const first = series.current.length === 0;
          series.current = [...series.current, ...fresh].filter(([s]) => s >= j.now - KEEP); last.current = fresh[fresh.length - 1][0];
          const f = tfRef.current;
          if (first || fresh.length > 60) redraw();
          else if (f === 1) for (const [s, p] of fresh) area.current?.update({ time: s as T, value: p });
          else { const from = Math.floor(fresh[0][0] / f) * f; for (const b of bars(series.current.filter(([s]) => s >= from - f), f)) if (b.time >= from) candles.current?.update(b); }
          cb.current.onTicker(series.current.slice(-300));
        }
        const p = j.price; if (p !== null && prev.current !== null && p !== prev.current) { setFlash(p > prev.current ? "up" : "down"); setTimeout(() => setFlash(null), 450); } prev.current = p;
        const ser = tfRef.current === 1 ? area.current : candles.current;
        if (ser) { if (openLine.current) { try { ser.removePriceLine(openLine.current); } catch { /* the other series */ } openLine.current = null; }
          if (j.live.open) openLine.current = ser.createPriceLine({ price: j.live.open, color: "#ffd84d", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "round open" }); }
        const top = j.log[0]?.r ?? -1;
        if (seenLog.current !== null && top > seenLog.current && j.log[0]) { cb.current.say(resultText(j.log[0])); cb.current.onSettled(); }
        if (seenLog.current !== top || fresh.length) marks();
        seenLog.current = top;
        setV(j); setErr(null);
      } catch (e) { if (alive) setErr((e as Error).message); }
      if (alive) t = setTimeout(tick, document.hidden ? 5000 : 1000);
    };
    void tick();
    const c = setInterval(() => setClock(Date.now() / 1000), 250);
    return () => { alive = false; if (t) clearTimeout(t); clearInterval(c); };
  }, [call]); // eslint-disable-line react-hooks/exhaustive-deps

  const make = async (dir: "up" | "down") => {
    setBusy(dir); setErr(null);
    try { const j = (await call("desk/call", { call: dir, since: last.current })) as DeskView; view.current = { ...j, series: [] }; setV(j); say(`Called ${dir === "up" ? "UP" : "DOWN"} for the ${hhmm(j.next.start)} round`); }
    catch (e) { setErr((e as Error).message); }
    setBusy(null);
  };

  const now = clock + skew.current, live = v?.live, next = v?.next, price = v?.price ?? null;
  const ch = price !== null && live?.open ? price - live.open : null, chPct = ch !== null && live?.open ? (ch / live.open) * 100 : null;
  const range = useMemo(() => { const s = series.current; if (!s.length) return null; let hi = -Infinity, lo = Infinity; for (const [, p] of s) { if (p > hi) hi = p; if (p < lo) lo = p; } return { hi, lo, from: s[0][1] }; }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  const leftLive = live ? live.end - now : 0, leftNext = next ? next.start - now : 0;
  const winning = live?.call && ch !== null && ch !== 0 ? (live.call === "up") === ch > 0 : null;
  const crowdN = next ? next.crowd.up + next.crowd.down : 0, upShare = crowdN ? next!.crowd.up / crowdN : 0.5;
  const streakNow = v?.streak ?? 0, bonus = Math.min(DESK.streak.max, streakNow);
  const winPay = { xp: DESK.win.xp + bonus * DESK.streak.xp, coins: DESK.win.coins + bonus * DESK.streak.coins };
  const settled = (v?.log ?? []).filter((x) => x.result === "win" || x.result === "loss"), wins = settled.filter((x) => x.result === "win").length;
  const liveCls = winning === true ? "win" : winning === false ? "lose" : "";

  return (
    <section className={`tt${max ? " max" : ""}`} aria-label="Trading terminal">
      {/* ------------------------------------------------ header */}
      <header className="tt-head">
        <div className="tt-pair">
          <span className="tt-coin">₿</span>
          <div><b>BTC<span>/USD</span></b><small><i className={`tt-dot${v?.feed && v.feed !== "off" && v.feed !== "starting" ? " on" : ""}`} />{v?.feed ?? "connecting"}</small></div>
        </div>
        <div className={`tt-last mono${flash ? ` f-${flash}` : ""}`}>{px(price)}</div>
        <dl className="tt-stats mono">
          <div><dt>Round chg</dt><dd className={ch === null ? "" : ch >= 0 ? "up" : "down"}>{ch === null ? "–" : `${sgn(ch)} (${sgn(chPct!, 3)}%)`}</dd></div>
          <div><dt>30m high</dt><dd>{px(range?.hi)}</dd></div>
          <div><dt>30m low</dt><dd>{px(range?.lo)}</dd></div>
          <div className="tt-hide-s"><dt>Round</dt><dd>#{live ? live.round % 288 + 1 : "–"} / 288</dd></div>
          <div className="tt-hide-s"><dt>UTC</dt><dd>{hms(now)}</dd></div>
        </dl>
        <div className="tt-win">
          {onMax && <button type="button" className="tt-ib tt-hide-s" onClick={onMax} title={max ? "Show picks next to it" : "Maximize"} aria-label={max ? "Restore" : "Maximize"}><Icon n={max ? "restore" : "maximize"} size={14} /></button>}
          <button type="button" className="tt-ib" onClick={onClose} aria-label="Close"><Icon n="close" size={14} /></button>
        </div>
      </header>

      <div className="tt-body">
        {/* ------------------------------------------------ chart */}
        <div className="tt-chartcol">
          <div className="tt-toolbar">
            <div className="tt-seg" role="radiogroup" aria-label="Timeframe">{TFS.map((x) => <button key={x.s} type="button" role="radio" aria-checked={tf === x.s} className={tf === x.s ? "on" : ""} onClick={() => setTf(x.s)}>{x.l}</button>)}</div>
            <span className="tt-legend mono"><i className="o" />round open {px(live?.open)}<i className="u" />your calls</span>
            <span className="tt-src mono tt-hide-s">Coinbase spot</span>
          </div>
          <div className="tt-chart" ref={box}>{!ready || !v ? <p className="tt-wait">Connecting to the live price…</p> : null}</div>
          <div className="tt-roundbar">
            <span className="mono">{live ? `${hhmm(live.start)}–${hhmm(live.end)}` : "–"}</span>
            <span className="tt-prog"><i style={{ width: `${Math.min(100, Math.max(0, (1 - leftLive / DESK.round) * 100))}%` }} /></span>
            <span className="mono tt-left">{mmss(leftLive)}</span>
          </div>
        </div>

        {/* ------------------------------------------------ order ticket */}
        <aside className="tt-ticket">
          <div className="tt-box">
            <div className="tt-box-h"><span>Next round</span><b className="mono">{next ? `${hhmm(next.start)}–${hhmm(next.start + DESK.round)}` : "–"}</b></div>
            <div className="tt-count"><small>Calls lock in</small><b className={`mono${leftNext < 30 ? " soon" : ""}`}>{mmss(leftNext)}</b></div>
            <div className="tt-ud">
              <button type="button" className={`up${next?.call === "up" ? " on" : ""}`} disabled={!!busy || !price} onClick={() => void make("up")}><Icon n="up" size={18} /><b>Up</b><small>{next?.call === "up" ? "your call" : "closes higher"}</small></button>
              <button type="button" className={`down${next?.call === "down" ? " on" : ""}`} disabled={!!busy || !price} onClick={() => void make("down")}><Icon n="down" size={18} /><b>Down</b><small>{next?.call === "down" ? "your call" : "closes lower"}</small></button>
            </div>
            <dl className="tt-kv mono">
              <div><dt>If right</dt><dd className="up">+{winPay.xp} XP · +{winPay.coins} coins</dd></div>
              <div><dt>Beat the crowd</dt><dd>+{DESK.crowd.xp} XP · +{DESK.crowd.coins} coins</dd></div>
              <div><dt>Paid calls left</dt><dd>{v?.paidLeft ?? DESK.paidPerDay} / {DESK.paidPerDay}</dd></div>
            </dl>
            <div className="tt-sent"><div className="tt-sent-bar"><i style={{ width: `${upShare * 100}%` }} /></div><p className="mono"><span className="up">{next?.crowd.up ?? 0} up</span><span>crowd</span><span className="down">{next?.crowd.down ?? 0} down</span></p></div>
          </div>
          <div className={`tt-box tt-live ${liveCls}`}>
            <div className="tt-box-h"><span>Running round</span><b className="mono">{mmss(leftLive)} left</b></div>
            <dl className="tt-kv mono">
              <div><dt>Open</dt><dd>{px(live?.open)}</dd></div>
              <div><dt>Last</dt><dd>{px(price)}</dd></div>
              <div><dt>Your call</dt><dd className={live?.call ?? ""}>{live?.call ? live.call.toUpperCase() : "none"}</dd></div>
              <div><dt>Status</dt><dd className={winning === true ? "up" : winning === false ? "down" : ""}>{!live?.call ? "–" : winning === null ? "level" : winning ? `winning ${ch !== null ? `by ${px(Math.abs(ch))}` : ""}` : `behind ${ch !== null ? `by ${px(Math.abs(ch))}` : ""}`}</dd></div>
            </dl>
          </div>
          <dl className="tt-perf mono">
            <div><dt>Streak</dt><dd>{streakNow}</dd></div><div><dt>Best</dt><dd>{v?.best ?? 0}</dd></div>
            <div><dt>Hit rate</dt><dd>{settled.length ? `${Math.round((wins / settled.length) * 100)}%` : "–"}</dd></div>
          </dl>
        </aside>
      </div>

      {/* ------------------------------------------------ positions */}
      <div className="tt-foot">
        <div className="tt-tabs" role="tablist">
          {([["calls", `Your calls${v?.log.length ? ` (${v.log.length})` : ""}`], ["top", "Best traders"], ["rules", "Rules"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
          {err && <span className="tt-err">{err}</span>}
        </div>
        <div className="tt-table">
          {tab === "calls" && (!v || v.log.length === 0 ? <p className="tt-empty">No settled calls yet. Call the next round on the right.</p> : (
            <table className="mono"><thead><tr><th>Round</th><th>Call</th><th>Open</th><th>Close</th><th>Move</th><th>Result</th><th>Paid</th></tr></thead>
              <tbody>{v.log.map((x) => { const mv = x.open !== null && x.close !== null ? x.close - x.open : null; return (
                <tr key={x.r} className={x.result}><td>{hhmm(x.r * DESK.round)}</td><td className={x.call}>{x.call.toUpperCase()}</td><td>{px(x.open)}</td><td>{px(x.close)}</td>
                  <td className={mv === null ? "" : mv >= 0 ? "up" : "down"}>{mv === null ? "–" : sgn(mv)}</td>
                  <td><span className={`tt-pill ${x.result}`}>{x.result === "win" ? (x.crowd ? "won · crowd" : "won") : x.result === "loss" ? "lost" : x.result === "push" ? "level" : "no price"}</span></td>
                  <td>{x.xp ? `+${x.xp} XP` : "–"}{x.coins ? ` · +${x.coins}` : ""}</td></tr>); })}</tbody></table>
          ))}
          {tab === "top" && (!v || v.top.length === 0 ? <p className="tt-empty">Nobody has won a call yet.</p> : (
            <table className="mono"><thead><tr><th>#</th><th>Trader</th><th>Won</th><th>Calls</th><th>Hit rate</th><th>Best streak</th></tr></thead>
              <tbody>{v.top.map((p) => <tr key={p.name}><td>{p.rank}</td><td className="tt-who"><ArtCanvas id={p.nft} size={18} /><span>{p.name}</span></td><td className="up">{p.wins}</td><td>{p.calls}</td><td>{p.calls ? `${Math.round((p.wins / p.calls) * 100)}%` : "–"}</td><td>{p.best}</td></tr>)}</tbody></table>
          ))}
          {tab === "rules" && (
            <ul className="tt-rules">
              <li>Every 5 minutes is a round (288 a day, UTC). Call the <b>next</b> round Up or Down before it starts; you can change your mind until then.</li>
              <li>When the round ends, the price at its close is compared with the price at its open: higher means Up wins, lower means Down wins, the same is a draw.</li>
              <li>A right call pays +{DESK.win.xp} XP and +{DESK.win.coins} coins, +{DESK.streak.xp} XP and +{DESK.streak.coins} coins more for every win in a row (up to {DESK.streak.max}), and +{DESK.crowd.coins} more when you were on the smaller side and right. Every call counts +{DESK.play.xp} XP.</li>
              <li>The first {DESK.paidPerDay} settled calls each UTC day pay coins. If the price feed drops out for a round, that round doesn&apos;t count.</li>
              <li>Prices: BTC-USD from Coinbase, one price per second. Chart by <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a>.</li>
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export function resultText(x: DeskLog) {
  const t = hhmm(x.r * DESK.round);
  if (x.result === "win") return `${t} round: you called it${x.crowd ? " against the crowd" : ""}. +${x.xp} XP, +${x.coins} coins`;
  if (x.result === "loss") return `${t} round: Bitcoin went the other way${x.xp ? ` (+${x.xp} XP for playing)` : ""}`;
  if (x.result === "push") return `${t} round closed level`;
  return `${t} round had no price, so it doesn't count`;
}
