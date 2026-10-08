"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { EXPLORER, gmgnToken } from "@/lib/constants";
import { ethFmt, type CoinInfo } from "./coins";

/** "Chart" button: the coin's price chart, fees and links in a popup. */
export function CoinChartButton({ coin, label = "Chart" }: { coin: CoinInfo; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="tbtn coin-chart-btn" onClick={() => setOpen(true)}>{label}</button>
      {open && <CoinChartModal coin={coin} onClose={() => setOpen(false)} />}
    </>
  );
}

function CoinChartModal({ coin, onClose }: { coin: CoinInfo; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const pts = coin.chart;
  const first = pts[0]?.p ?? null, last = pts[pts.length - 1]?.p ?? null;
  const change = first && last ? ((last - first) / first) * 100 : null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal coin-modal" role="dialog" aria-modal="true" aria-label={`$${coin.symbol} chart`}>
        <div className="modal-head">
          <div className="coin-modal-id">
            <span className="coin-face"><ArtCanvas id={coin.agent} size={88} /></span>
            <div><h2 className="mono">${coin.symbol}</h2><span className="mono coin-by">by Trencher #{coin.agent}{coin.graduated ? " · graduated to Uniswap" : " · on the Pons curve"}</span></div>
          </div>
          <button type="button" className="tbtn" onClick={onClose}>Close</button>
        </div>
        <PriceChart pts={pts} />
        <dl className="coin-stats">
          <div><dt>Creator fees earned</dt><dd className="mono up">{ethFmt(coin.feesEth)} ETH</dd></div>
          <div><dt>Price</dt><dd className="mono">{last === null ? "—" : `${last.toExponential(3)} ETH`}</dd></div>
          <div><dt>Since launch</dt><dd className={`mono ${change === null ? "" : change >= 0 ? "up" : "down"}`}>{change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}</dd></div>
          <div><dt>Volume</dt><dd className="mono">{ethFmt(coin.volumeEth)} ETH</dd></div>
          <div><dt>Trades</dt><dd className="mono">{coin.trades}</dd></div>
        </dl>
        <p className="muted-note">Creator fees go to the agent&apos;s wallet. Figures are from the coin&apos;s trades on its Pons launch curve{coin.graduated ? "; trading on its Uniswap pool after graduation isn't included yet" : ""}.</p>
        <div className="agent-links">
          <a className="tbtn" href={gmgnToken(coin.coin)} target="_blank" rel="noreferrer">GMGN ↗</a>
          <a className="tbtn" href={`${EXPLORER}/token/${coin.coin}`} target="_blank" rel="noreferrer">Etherscan ↗</a>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Price over time (ETH per coin), as a simple area chart. */
export function PriceChart({ pts, h = 260, mini = false }: { pts: { t: number; p: number }[]; h?: number; mini?: boolean }) {
  const W = 760;
  const geo = useMemo(() => {
    if (pts.length < 2) return null;
    const ts = pts.map((x) => x.t), ps = pts.map((x) => x.p);
    const t0 = Math.min(...ts), t1 = Math.max(...ts), p0 = Math.min(...ps), p1 = Math.max(...ps);
    const X = (t: number) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * W), Y = (p: number) => (p1 === p0 ? h / 2 : h - 8 - ((p - p0) / (p1 - p0)) * (h - 16));
    const line = pts.map((x, i) => `${i ? "L" : "M"}${X(x.t).toFixed(1)},${Y(x.p).toFixed(1)}`).join("");
    return { line, area: `${line}L${W},${h}L0,${h}Z`, up: ps[ps.length - 1] >= ps[0], t0, t1 };
  }, [pts, h]);
  if (!geo) return <div className={`coin-chart empty${mini ? " mini" : ""}`} style={{ height: h }}><span className="mono">{mini ? "" : "Not enough trades yet to draw a chart."}</span></div>;
  const col = geo.up ? "var(--green)" : "#FF5C5C";
  const day = (t: number) => new Date(t * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className={`coin-chart${mini ? " mini" : ""}`}>
      <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h }} aria-label="Price chart">
        <defs><linearGradient id="cg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={col} stopOpacity="0.28" /><stop offset="1" stopColor={col} stopOpacity="0" /></linearGradient></defs>
        <path d={geo.area} fill="url(#cg)" />
        <path d={geo.line} fill="none" stroke={col} strokeWidth={mini ? 2 : 2.5} vectorEffect="non-scaling-stroke" />
      </svg>
      {!mini && <div className="coin-chart-axis mono"><span>{day(geo.t0)}</span><span>{day(geo.t1)}</span></div>}
    </div>
  );
}
