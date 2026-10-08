"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { EXPLORER, gmgnToken } from "@/lib/constants";
import { RangeTabs } from "@/components/arena/LineChart";
import { ethFmt, type CoinInfo } from "./coins";
import { compactUsd, tiny, usdPrice, useEthUsd } from "./usd";

/** "Chart" button: the coin's chart, fees and links in a popup. */
/** While the coin's trades are still being read, the popup opens straight away and fills in when they arrive. */
type Basic = { agent: number; coin: string; symbol: string };
export function CoinChartButton({ coin, fallback, label = "Chart" }: { coin: CoinInfo | null; fallback?: Basic; label?: string }) {
  const [open, setOpen] = useState(false);
  const shown: CoinInfo | null = coin ?? (fallback ? { ...fallback, wallet: "", curve: "", launchedAt: 0, feesEth: 0, feesExact: false, volumeEth: 0, trades: 0, graduated: false, price: null, chart: [] } : null);
  if (!shown) return null;
  return (
    <>
      <button type="button" className="tbtn coin-chart-btn" onClick={() => setOpen(true)}>{label}</button>
      {open && <CoinChartModal coin={shown} loading={!coin} onClose={() => setOpen(false)} />}
    </>
  );
}

const RANGES = ["1H", "6H", "24H", "7D", "All"] as const;
type Range = (typeof RANGES)[number];
const SPAN: Record<Range, number> = { "1H": 3600, "6H": 21600, "24H": 86400, "7D": 604800, All: Infinity };

/** The points inside a time window, starting from the price the coin had when the window opened. */
export function windowed(pts: { t: number; p: number }[], range: Range) {
  const span = SPAN[range];
  if (span === Infinity || !pts.length) return pts;
  const end = Math.max(pts[pts.length - 1].t, Date.now() / 1000), from = end - span;
  const inside = pts.filter((x) => x.t >= from), before = pts.filter((x) => x.t < from).at(-1);
  const out = before ? [{ t: from, p: before.p }, ...inside] : inside;
  if (out.length && out[out.length - 1].t < end) out.push({ t: end, p: out[out.length - 1].p });
  return out;
}

/** Money in the coin's units: USD when ETH's price is known, else ETH. */
function useMoney() {
  const usd = useEthUsd();
  return {
    usd,
    price: (eth: number) => (usd ? usdPrice(eth * usd) : `${tiny(eth)} ETH`),
    big: (eth: number) => (usd ? compactUsd(eth * usd) : `${ethFmt(eth)} ETH`),
    eth: (eth: number) => `${ethFmt(eth)} ETH`,
    sub: (eth: number) => (usd ? `≈ ${compactUsd(eth * usd)}` : ""),
  };
}

function CoinChartModal({ coin, loading, onClose }: { coin: CoinInfo; loading?: boolean; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const [range, setRange] = useState<Range>("All");
  const [mode, setMode] = useState<"mcap" | "price">("mcap");
  const m = useMoney();
  const supply = coin.supply ?? 1e9;
  const all = coin.chart;
  const pts = windowed(all, range);
  const first = all[0]?.p ?? null, last = all[all.length - 1]?.p ?? null;
  const w0 = pts[0]?.p ?? null;
  const change = w0 && last ? ((last - w0) / w0) * 100 : null;
  const sinceLaunch = first && last ? ((last - first) / first) * 100 : null;
  const val = (p: number) => (mode === "mcap" ? m.big(p * supply) : m.price(p));

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal coin-modal" role="dialog" aria-modal="true" aria-label={`$${coin.symbol} chart`}>
        <header className="cm-head">
          <span className="coin-face"><ArtCanvas id={coin.agent} size={88} /></span>
          <div className="cm-title">
            <h2 className="mono">${coin.symbol}</h2>
            <span className="mono coin-by">by Trencher #{coin.agent} · {coin.graduated ? "graduated to Uniswap" : "on the Pons curve"}</span>
          </div>
          <button type="button" className="tbtn cm-close" onClick={onClose} aria-label="Close">Close</button>
        </header>

        <div className="cm-body">
          <div className="cm-quote">
            <div>
              <span className="cm-label">{mode === "mcap" ? "Market cap" : "Price"}</span>
              <b className="mono cm-big">{last === null ? "—" : val(last)}</b>
              {change !== null && <span className={`mono cm-chg ${change >= 0 ? "up" : "down"}`}>{change >= 0 ? "+" : ""}{change.toFixed(1)}% <em>{range === "All" ? "since launch" : range}</em></span>}
            </div>
            <div className="cm-controls">
              <div className="lc-ranges mono" role="tablist" aria-label="Show">
                <button type="button" role="tab" aria-selected={mode === "mcap"} className={mode === "mcap" ? "on" : ""} onClick={() => setMode("mcap")}>MCap</button>
                <button type="button" role="tab" aria-selected={mode === "price"} className={mode === "price" ? "on" : ""} onClick={() => setMode("price")}>Price</button>
              </div>
              <RangeTabs value={range} options={RANGES} onChange={setRange} />
            </div>
          </div>

          {loading ? <div className="coin-chart empty" style={{ height: 300 }}><span className="mono">Reading the coin&apos;s trades from Robinhood Chain…</span></div>
            : <PriceChart pts={pts} h={300} fmt={val} />}

          <dl className="coin-stats">
            <div><dt>Creator fees</dt><dd className="mono up">{m.eth(coin.feesEth)}</dd><small className="mono">{m.sub(coin.feesEth)}</small></div>
            <div><dt>Price</dt><dd className="mono">{last === null ? "—" : m.price(last)}</dd><small className="mono">{last === null ? "" : m.usd ? `${tiny(last)} ETH` : ""}</small></div>
            <div><dt>Since launch</dt><dd className={`mono ${sinceLaunch === null ? "" : sinceLaunch >= 0 ? "up" : "down"}`}>{sinceLaunch === null ? "—" : `${sinceLaunch >= 0 ? "+" : ""}${sinceLaunch.toFixed(1)}%`}</dd><small /></div>
            <div><dt>Volume</dt><dd className="mono">{m.eth(coin.volumeEth)}</dd><small className="mono">{m.sub(coin.volumeEth)}</small></div>
            <div><dt>Trades</dt><dd className="mono">{coin.trades}</dd><small /></div>
          </dl>
        </div>

        <footer className="cm-foot">
          <p className="muted-note">Creator fees go to the agent&apos;s wallet. From the coin&apos;s trades on its Pons curve{coin.graduated ? " (Uniswap trading after graduation isn't included yet)" : ""}{m.usd ? `; USD at ETH = $${Math.round(m.usd).toLocaleString("en-US")}` : ""}.</p>
          <div className="agent-links">
            <a className="tbtn" href={gmgnToken(coin.coin)} target="_blank" rel="noreferrer">GMGN ↗</a>
            <a className="tbtn" href={`${EXPLORER}/token/${coin.coin}`} target="_blank" rel="noreferrer">Etherscan ↗</a>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** Price over time as an area chart, placed by real time, with a hover crosshair (value and time). */
export function PriceChart({ pts, h = 260, mini = false, fmt }: { pts: { t: number; p: number }[]; h?: number; mini?: boolean; fmt?: (p: number) => string }) {
  const W = 760, box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const geo = useMemo(() => {
    if (pts.length < 2) return null;
    const ts = pts.map((x) => x.t), ps = pts.map((x) => x.p);
    const t0 = Math.min(...ts), t1 = Math.max(...ts);
    let p0 = Math.min(...ps), p1 = Math.max(...ps);
    const pad = (p1 - p0) * 0.12 || p1 * 0.05 || 1e-12; p0 -= pad; p1 += pad;
    const X = (t: number) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * W), Y = (p: number) => h - ((p - p0) / (p1 - p0)) * h;
    // a stepped line: the price holds until the next trade
    let d = `M${X(pts[0].t).toFixed(1)},${Y(pts[0].p).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += `L${X(pts[i].t).toFixed(1)},${Y(pts[i - 1].p).toFixed(1)}L${X(pts[i].t).toFixed(1)},${Y(pts[i].p).toFixed(1)}`;
    return { line: d, area: `${d}L${W},${h}L0,${h}Z`, up: ps[ps.length - 1] >= ps[0], t0, t1, X, Y, p0: p0 + pad, p1: p1 - pad };
  }, [pts, h]);
  if (!geo) return <div className={`coin-chart empty${mini ? " mini" : ""}`} style={{ height: h }}><span className="mono">{mini ? "" : "No trades in this time frame."}</span></div>;
  const col = geo.up ? "var(--green)" : "#FF5C5C";
  const when = (t: number) => new Date(t * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect(); if (!r) return;
    const tt = geo.t0 + ((clientX - r.left) / r.width) * (geo.t1 - geo.t0);
    let i = 0; for (let k = 0; k < pts.length; k++) if (pts[k].t <= tt) i = k;
    setHover(i);
  };
  const hp = hover !== null ? pts[hover] : null;
  const gid = `cg${mini ? "m" : ""}${geo.up ? "u" : "d"}`;
  return (
    <div className={`coin-chart${mini ? " mini" : ""}`}>
      <div className="cc-plot" ref={box} style={{ height: h }}
        onPointerMove={mini ? undefined : (e) => pick(e.clientX)} onPointerDown={mini ? undefined : (e) => pick(e.clientX)} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h }} aria-label="Price chart">
          <defs><linearGradient id={gid} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={col} stopOpacity="0.28" /><stop offset="1" stopColor={col} stopOpacity="0" /></linearGradient></defs>
          {!mini && [0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} x2={W} y1={h * f} y2={h * f} stroke="rgba(232,236,233,.06)" vectorEffect="non-scaling-stroke" />)}
          <path d={geo.area} fill={`url(#${gid})`} />
          <path d={geo.line} fill="none" stroke={col} strokeWidth={mini ? 2 : 2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {!mini && fmt && !hp && <><span className="cc-y cc-hi mono">{fmt(geo.p1)}</span><span className="cc-y cc-lo mono">{fmt(geo.p0)}</span></>}
        {hp && fmt && (() => {
          const x = (geo.X(hp.t) / W) * 100, y = (geo.Y(hp.p) / h) * 100;
          return (<>
            <span className="cc-cross" style={{ left: `${x}%` }} />
            <span className="cc-dot" style={{ left: `${x}%`, top: `${y}%`, background: col }} />
            <span className={`cc-tip mono${x > 60 ? " left" : ""}`} style={{ left: `${x}%` }}><b>{fmt(hp.p)}</b><small>{when(hp.t)}</small></span>
          </>);
        })()}
      </div>
      {!mini && <div className="coin-chart-axis mono"><span>{when(geo.t0)}</span><span>{when(geo.t1)}</span></div>}
    </div>
  );
}
