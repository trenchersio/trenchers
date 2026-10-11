"use client";
// Small shared pieces of the V4 Builder: number formatting, the coin avatar and the price line.
import { useMemo } from "react";

/** A 1e18-scaled integer (as text) to a short human number: 1.2K, 3.4M, 0.00042. */
export function q(raw: string | bigint | null | undefined, digits = 4): string {
  if (raw === null || raw === undefined) return "–";
  const n = Number(BigInt(raw)) / 1e18;
  return num(n, digits);
}
export function num(n: number, digits = 4): string {
  if (!isFinite(n)) return "–";
  if (n === 0) return "0";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  if (a >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (a >= 1e-4) return n.toPrecision(digits).replace(/0+$/, "").replace(/\.$/, "");
  // tiny prices: 0.0₇42 style
  const s = a.toExponential(2);
  const [m, e] = s.split("e-");
  const zeros = Number(e) - 1;
  return `${n < 0 ? "-" : ""}0.0${String(zeros).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]).join("")}${m.replace(".", "").slice(0, 3)}`;
}
export const ago = (t: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - t);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The coin's picture, or a monogram on a colour taken from its symbol when it has none (or the picture won't load). */
export function Avatar({ image, symbol, size = 40 }: { image?: string; symbol: string; size?: number }) {
  const hue = useMemo(() => [...symbol].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7), [symbol]);
  const style = { width: size, height: size, ["--h" as string]: hue } as React.CSSProperties;
  const src = image && /^ipfs:\/\//.test(image) ? `https://ipfs.io/ipfs/${image.slice(7)}` : image;
  if (src && (/^https:\/\//.test(src) || /^data:image\/(svg\+xml|png|jpeg|gif|webp);base64,/.test(src))) {
    return <span className="vb-av" style={style}><img src={src} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} /><i>{symbol.slice(0, 2)}</i></span>;
  }
  return <span className="vb-av" style={style}><i>{(symbol || "?").slice(0, 2)}</i></span>;
}

/** A price line: an area under the path, the last point marked. */
export function Line({ points, w = 240, h = 64, className = "", axis = false }: { points: { t: number; p: number }[]; w?: number; h?: number; className?: string; axis?: boolean }) {
  if (!points || points.length < 2) return <svg className={`vb-line ${className}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1={h / 2} x2={w} y2={h / 2} className="vb-line-flat" /></svg>;
  const ps = points.map((x) => x.p);
  const lo = Math.min(...ps), hi = Math.max(...ps), span = hi - lo || hi || 1;
  const t0 = points[0].t, t1 = points[points.length - 1].t, ts = t1 - t0 || 1;
  const pad = 4;
  const xy = points.map((x) => [((x.t - t0) / ts) * w, pad + (1 - (x.p - lo) / span) * (h - pad * 2)] as const);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const up = ps[ps.length - 1] >= ps[0];
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg className={`vb-line ${up ? "up" : "down"} ${className}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      {axis && [0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={w} y1={h * f} y2={h * f} className="vb-line-grid" />)}
      <path d={`${d} L${w} ${h} L0 ${h} Z`} className="vb-line-area" />
      <path d={d} className="vb-line-path" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="2.5" className="vb-line-dot" />
    </svg>
  );
}

/** Crop marks in each corner: the builder's panels are drawn like sheets on a drafting table. */
export const Marks = () => <><i className="vb-mk tl" /><i className="vb-mk tr" /><i className="vb-mk bl" /><i className="vb-mk br" /></>;
